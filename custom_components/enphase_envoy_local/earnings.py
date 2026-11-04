"""What the solar panels earn, with day-ahead (EPEX SPOT) prices.

Prices: Energy-Charts (Fraunhofer ISE), free and without an account, every
European bidding zone, per quarter hour. Consumer price = (market + markup +
energy tax) x (1 + VAT), the same formula as the Easee Smart integration.

Every reading the production and the export since the previous reading are
valued at the price of that moment:

* self-use (production - export) saves the consumer price;
* export earns the consumer price with net metering ("salderen"), or the market
  price minus the export fee with a dynamic export contract.

Without an export meter all production is valued at the consumer price (the
same as net metering). The past is filled in once from the long-term
statistics, so totals and the payback time are there from the first day.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
import logging
from typing import TYPE_CHECKING, Any

import aiohttp

from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import DOMAIN

if TYPE_CHECKING:
    from .coordinator import EnvoyCoordinator

_LOGGER = logging.getLogger(__name__)

API_URL = "https://api.energy-charts.info/price"
STORAGE_VERSION = 1
BACKFILL_DAYS = 400
BACKFILL_VERSION = 1

CONF_EARNINGS = "earnings"
CONF_ZONE = "price_zone"
CONF_MARKUP = "price_markup"
CONF_ENERGY_TAX = "price_energy_tax"
CONF_VAT = "price_vat"
CONF_EXPORT_MODE = "export_mode"  # net_metering | dynamic
CONF_EXPORT_FEE = "export_fee"
CONF_INVESTMENT = "investment"

BIDDING_ZONES = [
    "NL", "BE", "DE-LU", "AT", "FR", "CH", "DK1", "DK2", "NO1", "NO2", "NO3", "NO4", "NO5",
    "SE1", "SE2", "SE3", "SE4", "FI", "PL", "CZ", "SK", "HU", "SI", "HR", "IT-North",
    "ES", "PT", "EE", "LV", "LT",
]
COUNTRY_ZONE = {
    "NL": "NL", "BE": "BE", "DE": "DE-LU", "LU": "DE-LU", "AT": "AT", "FR": "FR", "CH": "CH",
    "DK": "DK1", "NO": "NO1", "SE": "SE3", "FI": "FI", "PL": "PL", "CZ": "CZ", "SK": "SK",
    "HU": "HU", "SI": "SI", "HR": "HR", "IT": "IT-North", "ES": "ES", "PT": "PT",
    "EE": "EE", "LV": "LV", "LT": "LT",
}
ZONE_DEFAULTS = {
    "NL": {"energy_tax": 0.0916, "vat": 21.0, "export_mode": "net_metering"},
    "BE": {"energy_tax": 0.0, "vat": 6.0, "export_mode": "dynamic"},
    "DE-LU": {"energy_tax": 0.0, "vat": 19.0, "export_mode": "dynamic"},
    "AT": {"energy_tax": 0.0, "vat": 20.0, "export_mode": "dynamic"},
    "FR": {"energy_tax": 0.0, "vat": 20.0, "export_mode": "dynamic"},
}


def default_zone(hass: HomeAssistant) -> str:
    return COUNTRY_ZONE.get((hass.config.country or "").upper(), "NL")


def zone_defaults(zone: str) -> dict[str, Any]:
    return ZONE_DEFAULTS.get(zone, {"energy_tax": 0.0, "vat": 0.0, "export_mode": "dynamic"})


def consumer_price(market: float, markup: float, energy_tax: float, vat_pct: float) -> float:
    """(market + markup + energy tax) x (1 + VAT), EUR/kWh."""
    return (market + markup + energy_tax) * (1 + vat_pct / 100)


@dataclass
class Tariff:
    """The user's contract."""

    zone: str
    markup: float
    energy_tax: float
    vat: float
    export_mode: str
    export_fee: float

    def import_price(self, market: float) -> float:
        return consumer_price(market, self.markup, self.energy_tax, self.vat)

    def export_price(self, market: float) -> float:
        if self.export_mode == "net_metering":
            return self.import_price(market)
        return market - self.export_fee

    def value(self, market: float, production_wh: float, export_wh: float | None) -> dict[str, float]:
        """EUR saved by self-use and earned by export for these Wh."""
        if export_wh is None:
            return {"savings": production_wh / 1000 * self.import_price(market), "export": 0.0}
        export_wh = min(max(export_wh, 0.0), production_wh)
        self_use = production_wh - export_wh
        return {
            "savings": self_use / 1000 * self.import_price(market),
            "export": export_wh / 1000 * self.export_price(market),
        }


def parse_prices(data: dict[str, Any]) -> list[tuple[datetime, float]]:
    """[(start UTC, market EUR/kWh)] from an Energy-Charts answer."""
    out: list[tuple[datetime, float]] = []
    for ts, price in zip(data.get("unix_seconds") or [], data.get("price") or [], strict=False):
        if price is not None:
            out.append((datetime.fromtimestamp(int(ts), tz=UTC), float(price) / 1000))
    return sorted(out)


def price_at(points: list[tuple[datetime, float]], moment: datetime) -> float | None:
    """Market price of the slot that contains this moment."""
    found = None
    for start, price in points:
        if start <= moment:
            found = (start, price)
        else:
            break
    if found and moment - found[0] <= timedelta(hours=1):
        return found[1]
    return None


class Earnings:
    """Keeps what the panels saved and earned, per day, month, year and in total."""

    def __init__(self, hass: HomeAssistant, coordinator: EnvoyCoordinator) -> None:
        self.hass = hass
        self.coordinator = coordinator
        self._store: Store[dict] = Store(
            hass, STORAGE_VERSION, f"{DOMAIN}.{coordinator.config_entry.entry_id}.earnings"
        )
        self.data: dict[str, Any] = {}
        self.points: list[tuple[datetime, float]] = []
        self._fetched: datetime | None = None
        self.error: str | None = None
        self._last: tuple[float, float | None] | None = None  # production, export Wh
        self._loaded = False
        self._backfilling = False

    # --------------------------------------------------------------- tariff
    @property
    def tariff(self) -> Tariff:
        opts = self.coordinator.config_entry.options
        zone = opts.get(CONF_ZONE) or default_zone(self.hass)
        defaults = zone_defaults(zone)
        return Tariff(
            zone=zone,
            markup=float(opts.get(CONF_MARKUP, 0.0)),
            energy_tax=float(opts.get(CONF_ENERGY_TAX, defaults["energy_tax"])),
            vat=float(opts.get(CONF_VAT, defaults["vat"])),
            export_mode=opts.get(CONF_EXPORT_MODE, defaults["export_mode"]),
            export_fee=float(opts.get(CONF_EXPORT_FEE, 0.0)),
        )

    @property
    def investment(self) -> float | None:
        value = self.coordinator.config_entry.options.get(CONF_INVESTMENT)
        return float(value) if value else None

    # ----------------------------------------------------------------- prices
    async def _async_prices(self, start: datetime, end: datetime) -> list[tuple[datetime, float]]:
        session = async_get_clientsession(self.hass)
        params = {"bzn": self.tariff.zone, "start": start.date().isoformat(), "end": end.date().isoformat()}
        async with session.get(API_URL, params=params, timeout=aiohttp.ClientTimeout(total=60)) as resp:
            resp.raise_for_status()
            return parse_prices(await resp.json(content_type=None))

    async def _async_refresh_prices(self) -> None:
        now = dt_util.utcnow()
        has_tomorrow = any(
            dt_util.as_local(p[0]).date() == dt_util.now().date() + timedelta(days=1) for p in self.points
        )
        age = (now - self._fetched).total_seconds() if self._fetched else 1e9
        if self.points and age < (900 if not has_tomorrow and dt_util.now().hour >= 12 else 3 * 3600):
            return
        self._fetched = now
        try:
            today = dt_util.now()
            self.points = await self._async_prices(today - timedelta(days=1), today + timedelta(days=2))
            self.error = None
        except Exception as err:  # noqa: BLE001 - prices must never break the integration
            self.error = str(err) or type(err).__name__
            _LOGGER.info("Day-ahead prices not available: %s", self.error)

    # ---------------------------------------------------------------- buckets
    def _keys(self, moment: datetime) -> dict[str, str]:
        local = dt_util.as_local(moment)
        return {"day": local.date().isoformat(), "month": local.strftime("%Y-%m"), "year": str(local.year)}

    def _add(self, moment: datetime, savings: float, export: float, wh: float) -> None:
        for period, key in self._keys(moment).items():
            bucket = self.data.setdefault(period, {})
            if bucket.get("key") != key:
                bucket.clear()
                bucket["key"] = key
            bucket["savings"] = bucket.get("savings", 0.0) + savings
            bucket["export"] = bucket.get("export", 0.0) + export
            bucket["wh"] = bucket.get("wh", 0.0) + wh
        total = self.data.setdefault("total", {})
        total["savings"] = total.get("savings", 0.0) + savings
        total["export"] = total.get("export", 0.0) + export
        total["wh"] = total.get("wh", 0.0) + wh
        total.setdefault("since", moment.isoformat())

    def period(self, name: str) -> dict[str, float] | None:
        """{'savings', 'export', 'total', 'wh'} of 'day', 'month', 'year' or 'total'."""
        bucket = self.data.get(name)
        if not bucket:
            return None
        if name != "total" and bucket.get("key") != self._keys(dt_util.utcnow())[name]:
            return {"savings": 0.0, "export": 0.0, "total": 0.0, "wh": 0.0}
        return {
            "savings": round(bucket.get("savings", 0.0), 2),
            "export": round(bucket.get("export", 0.0), 2),
            "total": round(bucket.get("savings", 0.0) + bucket.get("export", 0.0), 2),
            "wh": bucket.get("wh", 0.0),
        }

    # ----------------------------------------------------------------- update
    async def async_update(self, *_: Any) -> None:
        """Called after every gateway reading."""
        if not self._loaded:
            self.data = await self._store.async_load() or {}
            self._loaded = True
        await self._async_refresh_prices()
        if self.data.get("backfill") != BACKFILL_VERSION and not self._backfilling:
            self._backfilling = True
            self.coordinator.config_entry.async_create_background_task(
                self.hass, self._async_backfill(), f"{DOMAIN} earnings backfill"
            )
        data = self.coordinator.data
        if data is None or data.production_lifetime is None:
            return
        now = dt_util.utcnow()
        current = (data.production_lifetime, data.grid_export_lifetime)
        previous, self._last = self._last, current
        market = price_at(self.points, now)
        if previous is None or market is None or self._backfilling:
            return
        produced = current[0] - previous[0]
        if produced <= 0 or produced > 5000:  # nothing, or a counter jump
            return
        exported = None
        if current[1] is not None and previous[1] is not None:
            exported = current[1] - previous[1]
            if exported < 0 or exported > 5000:
                exported = None
        value = self.tariff.value(market, produced, exported)
        self._add(now, value["savings"], value["export"], produced)
        self._store.async_delay_save(lambda: self.data, 60)

    # ---------------------------------------------------------- the past
    async def _async_backfill(self) -> None:
        """Value the past production once, from the hourly statistics."""
        try:
            await self._async_do_backfill()
        except Exception as err:  # noqa: BLE001
            _LOGGER.info("Could not fill in past earnings: %s", err)
        finally:
            self._backfilling = False

    async def _async_do_backfill(self) -> None:
        if "recorder" not in self.hass.config.components:
            self.data["backfill"] = BACKFILL_VERSION
            return
        from homeassistant.components.recorder import get_instance
        from homeassistant.components.recorder.statistics import statistics_during_period

        registry = er.async_get(self.hass)
        serial = self.coordinator.config_entry.data.get("serial")
        own_prod = registry.async_get_entity_id("sensor", DOMAIN, f"{serial}_production_lifetime")
        own_exp = registry.async_get_entity_id("sensor", DOMAIN, f"{serial}_grid_export_lifetime")
        # The longest production history: ours or another lifetime counter of this gateway.
        candidates = [own_prod] if own_prod else []
        for state in self.hass.states.async_all("sensor"):
            eid = state.entity_id
            if (
                serial and serial in eid and eid not in candidates
                and state.attributes.get("state_class") == "total_increasing"
                and state.attributes.get("unit_of_measurement") in ("Wh", "kWh", "MWh")
                and "produc" in eid and ("lifetime" in eid or "totaal" in eid) and "net" not in eid
            ):
                candidates.append(eid)
        exports = [own_exp] if own_exp else []
        end = dt_util.utcnow().replace(minute=0, second=0, microsecond=0)
        start = end - timedelta(days=BACKFILL_DAYS)
        ids = {*candidates, *exports}
        if not ids:
            self.data["backfill"] = BACKFILL_VERSION
            return
        stats = await get_instance(self.hass).async_add_executor_job(
            statistics_during_period, self.hass, start, end, ids, "hour", None, {"change"}
        )
        units = {eid: (self.hass.states.get(eid).attributes.get("unit_of_measurement") if self.hass.states.get(eid) else "kWh") for eid in ids}
        factor = {"Wh": 1.0, "kWh": 1000.0, "MWh": 1_000_000.0}

        def series(eid: str | None) -> dict[datetime, float]:
            out: dict[datetime, float] = {}
            for row in stats.get(eid, []) if eid else []:
                if row.get("change") is None:
                    continue
                s = row["start"]
                moment = dt_util.utc_from_timestamp(s) if isinstance(s, (int, float)) else dt_util.as_utc(s)
                wh = float(row["change"]) * factor.get(units.get(eid), 1000.0)
                if 0 <= wh <= 10_000:  # leave out counter jumps
                    out[moment] = wh
            return out

        production = max((series(eid) for eid in candidates), key=len, default={})
        export = series(exports[0]) if exports else {}
        if not production:
            self.data["backfill"] = BACKFILL_VERSION
            return
        first = min(production)
        # Only fill in what is older than what was tracked live.
        tracked_since = dt_util.parse_datetime(self.data.get("total", {}).get("since", "")) if self.data.get("total") else None
        until = tracked_since or end
        prices: list[tuple[datetime, float]] = []
        cursor = first
        while cursor < until:
            chunk_end = min(cursor + timedelta(days=60), until + timedelta(days=1))
            try:
                prices.extend(await self._async_prices(cursor, chunk_end))
            except Exception as err:  # noqa: BLE001
                _LOGGER.info("Past prices not available (%s): %s", cursor.date(), err)
            cursor = chunk_end
        prices = sorted(set(prices))
        hourly: dict[datetime, list[float]] = {}
        for moment, price in prices:
            hourly.setdefault(moment.replace(minute=0, second=0, microsecond=0), []).append(price)
        market = {k: sum(v) / len(v) for k, v in hourly.items()}
        tariff = self.tariff
        fresh: dict[str, Any] = {"total": {}}
        keep_total = self.data.get("total") or {}
        saved = self.data
        self.data = fresh
        for moment in sorted(production):
            if moment >= until or moment not in market:
                continue
            value = tariff.value(market[moment], production[moment], export.get(moment) if export else None)
            self._add(moment, value["savings"], value["export"], production[moment])
        # Add what was tracked live on top of the past.
        merged = self.data
        for key in ("savings", "export", "wh"):
            merged["total"][key] = merged["total"].get(key, 0.0) + keep_total.get(key, 0.0)
        merged["total"]["since"] = first.isoformat()
        for period in ("day", "month", "year"):
            live = saved.get(period)
            past = merged.get(period)
            if live and past and live.get("key") == past.get("key"):
                for key in ("savings", "export", "wh"):
                    past[key] = past.get(key, 0.0) + live.get(key, 0.0)
            elif live:
                merged[period] = live
        merged["backfill"] = BACKFILL_VERSION
        self.data = merged
        await self._store.async_save(self.data)
        self.coordinator.async_update_listeners()

    # ---------------------------------------------------------------- derived
    def payback_years(self) -> float | None:
        """Years left until the investment is earned back, at the pace so far."""
        investment = self.investment
        total = self.period("total")
        since = dt_util.parse_datetime(self.data.get("total", {}).get("since", "")) if total else None
        if not investment or not total or not since:
            return None
        days = max(1.0, (dt_util.utcnow() - since).total_seconds() / 86400)
        if days < 30 or total["total"] <= 0:
            return None
        per_year = total["total"] / days * 365
        return round(max(0.0, (investment - total["total"]) / per_year), 1)

    def price_now(self) -> tuple[float | None, float | None, float | None]:
        """(market, import, export) EUR/kWh now."""
        market = price_at(self.points, dt_util.utcnow())
        if market is None:
            return None, None, None
        t = self.tariff
        return market, round(t.import_price(market), 4), round(t.export_price(market), 4)

    def hourly_prices(self) -> list[list[Any]]:
        """[[start ISO, import EUR/kWh], ...] for today and tomorrow (for the card)."""
        t = self.tariff
        since = dt_util.as_utc(dt_util.start_of_local_day())
        return [[s.isoformat(), round(t.import_price(p), 4)] for s, p in self.points if s >= since]
