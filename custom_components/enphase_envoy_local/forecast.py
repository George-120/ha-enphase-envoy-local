"""Solar forecast for Enphase Envoy Local, calibrated on the system itself.

The irradiance forecast comes from Open-Meteo (free, no account): hourly
global tilted irradiance (W/m²) for the tilt and orientation of every roof
surface. How many watts a roof surface makes per W/m² is learned from what
its microinverters really produced on earlier days, so shade, dirt, panel
type and inverter limits are part of the forecast without any setup.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
import logging
from statistics import median
from typing import TYPE_CHECKING, Any

import aiohttp

from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import DOMAIN

if TYPE_CHECKING:
    from .coordinator import EnvoyCoordinator

_LOGGER = logging.getLogger(__name__)

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
STORAGE_VERSION = 1
PAST_DAYS = 7
FORECAST_DAYS = 3
MAX_SAMPLES = 30  # calibration days kept per roof surface
MIN_DAY_IRRADIANCE = 250  # Wh/m² - darker days say little about the system
DEFAULT_TILT = 35.0
DEFAULT_AZIMUTH = 180.0  # south
PERFORMANCE_RATIO = 0.85


@dataclass
class ForecastData:
    """What the sensors and cards show."""

    hourly: dict[datetime, float] = field(default_factory=dict)  # hour end (UTC) -> Wh in that hour
    today: float | None = None  # kWh
    tomorrow: float | None = None
    day_after: float | None = None
    so_far: float | None = None  # kWh expected until now today
    power_now: float | None = None  # W
    calibration: dict[str, dict[str, Any]] = field(default_factory=dict)
    updated: datetime | None = None
    error: str | None = None


def _surfaces(coordinator: EnvoyCoordinator) -> list[dict[str, Any]]:
    """Roof surfaces with their microinverters, tilt and orientation."""
    inverters = coordinator.data.inverters if coordinator.data else {}
    layout = coordinator.layout or {}
    surfaces: list[dict[str, Any]] = []
    placed: set[str] = set()
    for arr in layout.get("arrays") or []:
        serials = [m["serial"] for m in arr.get("modules") or [] if m.get("serial") in inverters]
        if not serials:
            continue
        placed.update(serials)
        tilt = arr.get("tilt")
        azimuth = arr.get("azimuth")
        surfaces.append(
            {
                "label": arr.get("label") or "",
                "serials": serials,
                "tilt": float(tilt) if isinstance(tilt, (int, float)) else DEFAULT_TILT,
                "azimuth": float(azimuth) if isinstance(azimuth, (int, float)) else DEFAULT_AZIMUTH,
            }
        )
    rest = [s for s in inverters if s not in placed]
    if rest:
        surfaces.append(
            {"label": "", "serials": rest, "tilt": DEFAULT_TILT, "azimuth": DEFAULT_AZIMUTH}
        )
    return surfaces


def _parse_hourly(raw: dict[str, Any]) -> dict[datetime, float]:
    """Open-Meteo hourly irradiance -> {end of hour (UTC): mean W/m² in that hour}."""
    hourly = raw.get("hourly") or {}
    out: dict[datetime, float] = {}
    for stamp, value in zip(hourly.get("time") or [], hourly.get("global_tilted_irradiance") or []):
        if value is None:
            continue
        moment = dt_util.parse_datetime(f"{stamp}:00+00:00") if len(stamp) == 16 else dt_util.parse_datetime(stamp)
        if moment is not None:
            out[moment] = max(0.0, float(value))
    return out


def _day_sum(series: dict[datetime, float], day_start: datetime) -> float:
    """Wh/m² of irradiance in one local day (hour values are preceding-hour means)."""
    end = day_start + timedelta(days=1)
    return sum(v for t, v in series.items() if day_start < t <= end)


def default_factor(coordinator: EnvoyCoordinator, serials: list[str]) -> float:
    """Wh per Wh/m² before any calibration: rated panel power times a typical ratio."""
    inverters = coordinator.data.inverters if coordinator.data else {}
    total = 0.0
    for serial in serials:
        inv = inverters.get(serial)
        # Panels are usually ~15 % larger than the microinverter's maximum output.
        peak = (inv.max_power or 290) * 1.15 if inv else 330
        total += peak / 1000 * PERFORMANCE_RATIO
    return total


class SolarForecast:
    """Fetches the irradiance forecast and turns it into expected production."""

    def __init__(self, hass: HomeAssistant, coordinator: EnvoyCoordinator) -> None:
        """Initialise."""
        self.hass = hass
        self.coordinator = coordinator
        self.data = ForecastData()
        self._store: Store[dict] = Store(
            hass, STORAGE_VERSION, f"{DOMAIN}.{coordinator.config_entry.entry_id}.forecast"
        )
        self._samples: dict[str, dict[str, float]] = {}
        self._irradiance: dict[str, dict[datetime, float]] = {}
        self._loaded = False

    async def async_update(self, *_: Any) -> None:
        """Refresh the forecast (hourly)."""
        if not self._loaded:
            stored = await self._store.async_load() or {}
            self._samples = stored.get("samples") or {}
            self._loaded = True
        lat, lon = self.hass.config.latitude, self.hass.config.longitude
        if lat is None or lon is None or not self.coordinator.data:
            return
        surfaces = _surfaces(self.coordinator)
        if not surfaces:
            return
        session = async_get_clientsession(self.hass)
        fetched: dict[tuple[float, float], dict[datetime, float]] = {}
        try:
            for surface in surfaces:
                key = (round(surface["tilt"]), round(surface["azimuth"]))
                if key in fetched:
                    continue
                params = {
                    "latitude": f"{lat:.3f}",
                    "longitude": f"{lon:.3f}",
                    "hourly": "global_tilted_irradiance",
                    "tilt": str(key[0]),
                    # Open-Meteo: 0 = south, -90 = east, 90 = west.
                    "azimuth": str(((key[1] - 180 + 180) % 360) - 180),
                    "past_days": str(PAST_DAYS),
                    "forecast_days": str(FORECAST_DAYS),
                    "timezone": "UTC",
                }
                async with session.get(
                    OPEN_METEO_URL, params=params, timeout=aiohttp.ClientTimeout(total=20)
                ) as resp:
                    resp.raise_for_status()
                    fetched[key] = _parse_hourly(await resp.json(content_type=None))
        except Exception as err:  # noqa: BLE001 - a forecast must never break the integration
            self.data.error = f"Open-Meteo: {err}"
            _LOGGER.info("Solar forecast not available: %s", err)
            self.coordinator.async_update_listeners()
            return

        for surface in surfaces:
            self._irradiance[surface["label"]] = fetched[(round(surface["tilt"]), round(surface["azimuth"]))]
        await self._async_calibrate(surfaces)
        self._compute(surfaces)
        self.coordinator.async_update_listeners()

    async def _async_calibrate(self, surfaces: list[dict[str, Any]]) -> None:
        """Learn Wh per Wh/m² of every roof surface from yesterday's production."""
        inverters = self.coordinator.data.inverters
        today = dt_util.start_of_local_day()
        yesterday = today - timedelta(days=1)
        key = yesterday.date().isoformat()
        changed = False
        for surface in surfaces:
            label = surface["label"]
            samples = self._samples.setdefault(label, {})
            if key in samples:
                continue
            values = [inverters[s].energy_yesterday for s in surface["serials"] if s in inverters]
            if not values or any(v is None for v in values):
                continue
            actual = float(sum(values))
            irradiance = _day_sum(self._irradiance[label], dt_util.as_utc(yesterday))
            if irradiance < MIN_DAY_IRRADIANCE or actual <= 0:
                continue
            samples[key] = round(actual / irradiance, 4)
            for old in sorted(samples)[:-MAX_SAMPLES]:
                del samples[old]
            changed = True
        if changed:
            await self._store.async_save({"samples": self._samples})

    def factor(self, surface: dict[str, Any]) -> tuple[float, int]:
        """Calibrated factor and the number of days it is based on."""
        samples = list((self._samples.get(surface["label"]) or {}).values())
        if samples:
            # Upper half of the days: a cloudy day where the model expected sun
            # would otherwise pull the forecast down for every day.
            ordered = sorted(samples)
            return median(ordered[len(ordered) // 2 :]), len(samples)
        return default_factor(self.coordinator, surface["serials"]), 0

    def _compute(self, surfaces: list[dict[str, Any]]) -> None:
        inverters = self.coordinator.data.inverters
        hourly: dict[datetime, float] = {}
        calibration: dict[str, dict[str, Any]] = {}
        for surface in surfaces:
            factor, days = self.factor(surface)
            # A microinverter cannot deliver more than its maximum (clipping).
            cap = sum((inverters[s].max_power or 10_000) for s in surface["serials"] if s in inverters)
            calibration[surface["label"] or "all"] = {
                "panels": len(surface["serials"]),
                "tilt": surface["tilt"],
                "azimuth": surface["azimuth"],
                "wh_per_wh_m2": round(factor, 3),
                "calibration_days": days,
            }
            for moment, value in self._irradiance[surface["label"]].items():
                hourly[moment] = hourly.get(moment, 0.0) + min(value * factor, cap)
        now = dt_util.utcnow()
        start = dt_util.as_utc(dt_util.start_of_local_day())

        def day_kwh(offset: int) -> float:
            begin = start + timedelta(days=offset)
            return round(sum(v for t, v in hourly.items() if begin < t <= begin + timedelta(days=1)) / 1000, 2)

        so_far = 0.0
        for moment, value in hourly.items():
            if start < moment <= now:
                so_far += value
            elif moment - timedelta(hours=1) < now < moment and moment > start:
                so_far += value * (now - (moment - timedelta(hours=1))) / timedelta(hours=1)
        current = next(
            (v for t, v in sorted(hourly.items()) if t - timedelta(hours=1) <= now < t), 0.0
        )
        self.data = ForecastData(
            hourly={t: round(v, 1) for t, v in sorted(hourly.items())},
            today=day_kwh(0),
            tomorrow=day_kwh(1),
            day_after=day_kwh(2),
            so_far=round(so_far / 1000, 2),
            power_now=round(current, 0),
            calibration=calibration,
            updated=now,
        )

    def hourly_attribute(self) -> list[list[Any]]:
        """[[hour end ISO, Wh], ...] for the cards and the Energy dashboard."""
        return [[t.isoformat(), v] for t, v in self.data.hourly.items()]
