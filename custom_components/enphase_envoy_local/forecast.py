"""Solar forecast for Enphase Envoy Local, calibrated on the system itself.

Weather comes from Open-Meteo (free, no account): hourly global, direct and
diffuse irradiance for the location of Home Assistant. From the position of
the sun the integration computes the irradiance on every roof surface itself.

Everything else is learned from the system's own history (the long-term
statistics of the microinverters):

* the orientation and tilt of every roof surface, when the Enlighten layout
  does not have them (installers often leave them at 0° / south), by finding
  the orientation whose irradiance matches the shape of the production days;
* how many Wh a roof surface makes per Wh/m², so shade, dirt, panel type
  and the inverters' limits are part of the forecast without any setup.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
import logging
import math
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

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
# Weather archive (reanalysis, back to 1940) for learning from a long history.
ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
LEARN_DAYS = 365
MODEL = 2  # bump when the learning changes: everything is learned again
STORAGE_VERSION = 1
PAST_DAYS = 14
FORECAST_DAYS = 4  # today in UTC can still be yesterday locally
MIN_DAY_IRRADIANCE = 250  # Wh/m² - darker days say little about the system
DEFAULT_TILT = 35.0
DEFAULT_AZIMUTH = 180.0  # compass degrees, 180 = south
PERFORMANCE_RATIO = 0.85
ALBEDO = 0.2
RELEARN_EVERY = timedelta(hours=20)
AZIMUTHS = range(0, 360, 10)
TILTS = (10, 20, 30, 40, 50, 60)


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


@dataclass
class Weather:
    """Hourly irradiance, keyed by the end of the hour (UTC), means over that hour."""

    ghi: dict[datetime, float]
    dni: dict[datetime, float]
    dhi: dict[datetime, float]


# --------------------------------------------------------------- sun maths


def sun_position(moment: datetime, lat: float, lon: float) -> tuple[float, float]:
    """(elevation, azimuth) of the sun in degrees; azimuth from north, clockwise (NOAA)."""
    utc = dt_util.as_utc(moment)
    day = utc.timetuple().tm_yday
    hour = utc.hour + utc.minute / 60 + utc.second / 3600
    gamma = 2 * math.pi / 365 * (day - 1 + (hour - 12) / 24)
    eqtime = 229.18 * (
        0.000075 + 0.001868 * math.cos(gamma) - 0.032077 * math.sin(gamma)
        - 0.014615 * math.cos(2 * gamma) - 0.040849 * math.sin(2 * gamma)
    )
    decl = (
        0.006918 - 0.399912 * math.cos(gamma) + 0.070257 * math.sin(gamma)
        - 0.006758 * math.cos(2 * gamma) + 0.000907 * math.sin(2 * gamma)
        - 0.002697 * math.cos(3 * gamma) + 0.00148 * math.sin(3 * gamma)
    )
    true_solar = hour * 60 + eqtime + 4 * lon
    ha = math.radians(true_solar / 4 - 180)
    phi = math.radians(lat)
    cos_zen = math.sin(phi) * math.sin(decl) + math.cos(phi) * math.cos(decl) * math.cos(ha)
    zen = math.acos(max(-1.0, min(1.0, cos_zen)))
    return 90 - math.degrees(zen), _az_from_north(ha, phi, decl, zen)


def _az_from_north(ha: float, phi: float, decl: float, zen: float) -> float:
    """Solar azimuth from north, clockwise."""
    sin_az = -math.sin(ha) * math.cos(decl) / (math.sin(zen) or 1e-9)
    cos_az = (math.sin(decl) - math.sin(phi) * math.cos(zen)) / ((math.cos(phi) * math.sin(zen)) or 1e-9)
    return math.degrees(math.atan2(sin_az, cos_az)) % 360


def plane_irradiance(
    ghi: float, dni: float, dhi: float, elevation: float, sun_az: float, tilt: float, azimuth: float
) -> float:
    """W/m² on a plane (isotropic sky)."""
    if ghi <= 0:
        return 0.0
    t = math.radians(tilt)
    zen = math.radians(90 - elevation)
    cos_aoi = math.cos(zen) * math.cos(t) + math.sin(zen) * math.sin(t) * math.cos(
        math.radians(sun_az - azimuth)
    )
    beam = dni * max(0.0, cos_aoi) if elevation > 0 else 0.0
    sky = dhi * (1 + math.cos(t)) / 2
    ground = ghi * ALBEDO * (1 - math.cos(t)) / 2
    return max(0.0, beam + sky + ground)


def plane_series(
    weather: Weather, lat: float, lon: float, tilt: float, azimuth: float, sun: dict[datetime, tuple[float, float]]
) -> dict[datetime, float]:
    """Hourly W/m² on a roof surface (sun position at the middle of the hour)."""
    out: dict[datetime, float] = {}
    for end, ghi in weather.ghi.items():
        elev, az = sun[end]
        out[end] = plane_irradiance(
            ghi, weather.dni.get(end, 0.0), weather.dhi.get(end, 0.0), elev, az, tilt, azimuth
        )
    return out


# ------------------------------------------------------------- the model


def _surfaces(coordinator: EnvoyCoordinator) -> list[dict[str, Any]]:
    """Roof surfaces with their microinverters and (if known) tilt and orientation."""
    inverters = coordinator.data.inverters if coordinator.data else {}
    layout = coordinator.layout or {}
    surfaces: list[dict[str, Any]] = []
    placed: set[str] = set()
    for arr in layout.get("arrays") or []:
        serials = [m["serial"] for m in arr.get("modules") or [] if m.get("serial") in inverters]
        if not serials:
            continue
        placed.update(serials)
        tilt, azimuth = arr.get("tilt"), arr.get("azimuth")
        # Enlighten's untouched default is 0° tilt; treat it as unknown.
        known = isinstance(tilt, (int, float)) and tilt > 0 and isinstance(azimuth, (int, float))
        surfaces.append(
            {
                "label": arr.get("label") or "",
                "serials": serials,
                "tilt": float(tilt) if known else None,
                "azimuth": float(azimuth) if known else None,
            }
        )
    rest = [s for s in inverters if s not in placed]
    if rest:
        surfaces.append({"label": "", "serials": rest, "tilt": None, "azimuth": None})
    return surfaces


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


def fit_orientation(
    production: dict[datetime, float],
    weather: Weather,
    lat: float,
    lon: float,
    sun: dict[datetime, tuple[float, float]],
) -> tuple[float, float, float] | None:
    """Orientation whose irradiance best matches the shape of the production days.

    Returns (tilt, azimuth, fit error) or None without enough sunny history.
    Per day a scale is fitted, so the result only depends on *when* the
    surface produces, not on how much.
    """
    days: dict[str, list[datetime]] = {}
    for end, value in production.items():
        if end in weather.ghi and sun[end][0] > 3:
            days.setdefault(dt_util.as_local(end).date().isoformat(), []).append(end)
    def select(min_ghi: float, min_clear: float) -> list[list[datetime]]:
        chosen = []
        for hours in days.values():
            ghi_day = sum(weather.ghi[h] for h in hours)
            clear = sum(weather.dni.get(h, 0) for h in hours)
            if len(hours) >= 5 and ghi_day >= min_ghi and clear > min_clear * ghi_day and sum(production[h] for h in hours) > 0:
                chosen.append(hours)
        return chosen

    # Clear days tell the orientation best; a young system may only have dull ones.
    good = select(1500, 0.4)
    if len(good) < 5:
        good = select(MIN_DAY_IRRADIANCE, 0.25)
    if len(good) < 2:
        return None
    best: tuple[float, float, float] | None = None
    for tilt in TILTS:
        for azimuth in AZIMUTHS:
            error = 0.0
            for hours in good:
                g = [
                    plane_irradiance(weather.ghi[h], weather.dni.get(h, 0), weather.dhi.get(h, 0), *sun[h], tilt, azimuth)
                    for h in hours
                ]
                p = [production[h] for h in hours]
                gg = sum(x * x for x in g)
                if gg <= 0:
                    error += 1
                    continue
                k = sum(a * b for a, b in zip(p, g)) / gg
                pp = sum(x * x for x in p) or 1
                error += sum((a - k * b) ** 2 for a, b in zip(p, g)) / pp
            error /= len(good)
            if best is None or error < best[2]:
                best = (float(tilt), float(azimuth), error)
    return best


def _weather_from(raw: dict[str, Any]) -> Weather:
    """Open-Meteo hourly answer -> Weather keyed by the end of the hour (UTC)."""
    hourly = raw.get("hourly") or {}
    times = []
    for stamp in hourly.get("time") or []:
        times.append(dt_util.parse_datetime(f"{stamp}:00+00:00" if len(stamp) == 16 else stamp))

    def series(name: str) -> dict[datetime, float]:
        # Open-Meteo radiation is the mean of the *preceding* hour: the label is
        # the end of the hour (verified against real production: clearly better fit).
        return {
            t: max(0.0, float(v))
            for t, v in zip(times, hourly.get(name) or [])
            if t is not None and v is not None
        }

    return Weather(
        ghi=series("shortwave_radiation"),
        dni=series("direct_normal_irradiance"),
        dhi=series("diffuse_radiation"),
    )


class SolarForecast:
    """Fetches the weather and turns it into expected production."""

    def __init__(self, hass: HomeAssistant, coordinator: EnvoyCoordinator) -> None:
        """Initialise."""
        self.hass = hass
        self.coordinator = coordinator
        self.data = ForecastData()
        self._store: Store[dict] = Store(
            hass, STORAGE_VERSION, f"{DOMAIN}.{coordinator.config_entry.entry_id}.forecast"
        )
        self._learned: dict[str, dict[str, Any]] = {}
        self._learned_at: datetime | None = None
        self._loaded = False

    async def async_update(self, *_: Any) -> None:
        """Refresh the forecast (every 30 minutes)."""
        try:
            await self._async_update()
        except Exception as err:  # noqa: BLE001 - a forecast must never break the integration
            self.data.error = str(err)
            _LOGGER.info("Solar forecast not available: %s", err)
        self.coordinator.async_update_listeners()

    async def _async_update(self) -> None:
        if not self._loaded:
            stored = await self._store.async_load() or {}
            self._learned = stored.get("surfaces") or {}
            at = stored.get("learned_at")
            self._learned_at = dt_util.parse_datetime(at) if at else None
            if stored.get("model") != MODEL:
                self._learned_at = None
            self._loaded = True
        lat, lon = self.hass.config.latitude, self.hass.config.longitude
        if lat is None or lon is None or not self.coordinator.data:
            return
        surfaces = _surfaces(self.coordinator)
        if not surfaces:
            return
        weather = await self._async_weather(lat, lon)
        sun = {
            end: sun_position(end - timedelta(minutes=30), lat, lon) for end in weather.ghi
        }
        now = dt_util.utcnow()
        if self._learned_at is None or now - self._learned_at > RELEARN_EVERY or any(
            s["label"] not in self._learned for s in surfaces
        ):
            history = await self._async_history_weather(lat, lon, weather)
            history_sun = await self.hass.async_add_executor_job(
                lambda: {end: sun_position(end - timedelta(minutes=30), lat, lon) for end in history.ghi}
            )
            await self._async_learn(surfaces, history, history_sun, lat, lon)
        self._compute(surfaces, weather, sun, lat, lon)
        self.data.error = None

    async def _async_weather(self, lat: float, lon: float) -> Weather:
        session = async_get_clientsession(self.hass)
        params = {
            "latitude": f"{lat:.3f}",
            "longitude": f"{lon:.3f}",
            "hourly": "shortwave_radiation,direct_normal_irradiance,diffuse_radiation",
            "past_days": str(PAST_DAYS),
            "forecast_days": str(FORECAST_DAYS),
            "timezone": "UTC",
        }
        async with session.get(
            OPEN_METEO_URL, params=params, timeout=aiohttp.ClientTimeout(total=20)
        ) as resp:
            resp.raise_for_status()
            return _weather_from(await resp.json(content_type=None))

    async def _async_history_weather(self, lat: float, lon: float, recent: Weather) -> Weather:
        """A year of weather from the archive, completed with the recent days."""
        today = dt_util.now().date()
        params = {
            "latitude": f"{lat:.3f}",
            "longitude": f"{lon:.3f}",
            "start_date": (today - timedelta(days=LEARN_DAYS)).isoformat(),
            "end_date": (today - timedelta(days=1)).isoformat(),
            "hourly": "shortwave_radiation,direct_normal_irradiance,diffuse_radiation",
            "timezone": "UTC",
        }
        merged = Weather(ghi={}, dni={}, dhi={})
        try:
            session = async_get_clientsession(self.hass)
            async with session.get(
                ARCHIVE_URL, params=params, timeout=aiohttp.ClientTimeout(total=60)
            ) as resp:
                resp.raise_for_status()
                merged = _weather_from(await resp.json(content_type=None))
        except Exception as err:  # noqa: BLE001 - fall back to the recent days only
            _LOGGER.info("Weather archive not available, learning from recent days: %s", err)
        now = dt_util.utcnow()
        for name in ("ghi", "dni", "dhi"):
            target, source = getattr(merged, name), getattr(recent, name)
            for t, v in source.items():
                if t <= now and t not in target:
                    target[t] = v
        return merged

    async def _async_production(self, surfaces: list[dict[str, Any]]) -> dict[str, dict[datetime, float]]:
        """Hourly production (Wh) per roof surface from the long-term statistics."""
        try:
            from homeassistant.components.recorder import get_instance
            from homeassistant.components.recorder.statistics import statistics_during_period
        except ImportError:
            return {}
        if "recorder" not in self.hass.config.components:
            return {}
        registry = er.async_get(self.hass)
        per_serial: dict[str, list[str]] = {}
        for surface in surfaces:
            for serial in surface["serials"]:
                ids = []
                if own := registry.async_get_entity_id("sensor", DOMAIN, f"{serial}_inverter_power"):
                    ids.append(own)
                for state in self.hass.states.async_all("sensor"):
                    if (
                        serial not in state.entity_id
                        or state.entity_id in ids
                        or state.attributes.get("unit_of_measurement") != "W"
                    ):
                        continue
                    # Only AC power: not our DC or maximum power sensors.
                    reg = registry.async_get(state.entity_id)
                    if reg and reg.platform == DOMAIN:
                        continue
                    if any(word in state.entity_id for word in ("_dc", "max")):
                        continue
                    ids.append(state.entity_id)
                per_serial[serial] = ids
        all_ids = {i for ids in per_serial.values() for i in ids}
        if not all_ids:
            return {}
        end = dt_util.utcnow().replace(minute=0, second=0, microsecond=0)
        start = end - timedelta(days=LEARN_DAYS)
        stats = await get_instance(self.hass).async_add_executor_job(
            statistics_during_period, self.hass, start, end, all_ids, "hour", None, {"mean"}
        )

        def to_dt(value: Any) -> datetime:
            if isinstance(value, (int, float)):
                return dt_util.utc_from_timestamp(value)
            return dt_util.as_utc(value)

        result: dict[str, dict[datetime, float]] = {}
        for surface in surfaces:
            total: dict[datetime, float] = {}
            complete = True
            for serial in surface["serials"]:
                best: dict[datetime, float] = {}
                for entity_id in per_serial.get(serial, []):
                    rows = {
                        to_dt(r["start"]) + timedelta(hours=1): float(r["mean"])
                        for r in stats.get(entity_id, [])
                        if r.get("mean") is not None
                    }
                    if len(rows) > len(best):
                        best = rows
                if not best:
                    complete = False
                    break
                for t, v in best.items():
                    total[t] = total.get(t, 0.0) + max(0.0, v)
            if complete and total:
                result[surface["label"]] = total
        return result

    async def _async_learn(
        self,
        surfaces: list[dict[str, Any]],
        weather: Weather,
        sun: dict[datetime, tuple[float, float]],
        lat: float,
        lon: float,
    ) -> None:
        """Learn orientation (if unknown) and Wh per Wh/m² of every roof surface."""
        production = await self._async_production(surfaces)
        learned: dict[str, dict[str, Any]] = {}
        for surface in surfaces:
            label = surface["label"]
            previous = self._learned.get(label) or {}
            prod = production.get(label) or {}
            entry: dict[str, Any] = {}
            if surface["tilt"] is not None:
                entry.update(tilt=surface["tilt"], azimuth=surface["azimuth"], orientation="enlighten")
            else:
                fitted = await self.hass.async_add_executor_job(
                    fit_orientation, prod, weather, lat, lon, sun
                ) if prod else None
                if fitted:
                    entry.update(tilt=fitted[0], azimuth=fitted[1], orientation="learned", fit_error=round(fitted[2], 3))
                elif previous.get("orientation") == "learned":
                    entry.update({k: previous[k] for k in ("tilt", "azimuth", "orientation", "fit_error") if k in previous})
                else:
                    entry.update(tilt=DEFAULT_TILT, azimuth=DEFAULT_AZIMUTH, orientation="default")
            # Wh per Wh/m²: total production over total irradiance of the usable
            # days. Tested on real systems this has no bias (a median of the
            # better days overestimated by ~25 %).
            plane = plane_series(weather, lat, lon, entry["tilt"], entry["azimuth"], sun)
            ratios = []
            sum_actual = sum_irr = 0.0
            by_day: dict[str, list[datetime]] = {}
            for end in prod:
                if end in plane:
                    by_day.setdefault(dt_util.as_local(end).date().isoformat(), []).append(end)
            for hours in by_day.values():
                irr = sum(plane[h] for h in hours)
                actual = sum(prod[h] for h in hours)
                if irr >= MIN_DAY_IRRADIANCE and actual > 0 and len(hours) >= 8:
                    ratios.append(actual / irr)
                    sum_actual += actual
                    sum_irr += irr
            if ratios and sum_irr > 0:
                entry.update(factor=round(sum_actual / sum_irr, 4), calibration_days=len(ratios))
            elif previous.get("calibration_days"):
                entry.update(factor=previous["factor"], calibration_days=previous["calibration_days"])
            else:
                entry.update(factor=round(default_factor(self.coordinator, surface["serials"]), 4), calibration_days=0)
            learned[label] = entry
        self._learned = learned
        self._learned_at = dt_util.utcnow()
        await self._store.async_save(
            {"surfaces": learned, "learned_at": self._learned_at.isoformat(), "model": MODEL}
        )

    def _compute(
        self,
        surfaces: list[dict[str, Any]],
        weather: Weather,
        sun: dict[datetime, tuple[float, float]],
        lat: float,
        lon: float,
    ) -> None:
        inverters = self.coordinator.data.inverters
        hourly: dict[datetime, float] = {}
        calibration: dict[str, dict[str, Any]] = {}
        for surface in surfaces:
            info = self._learned.get(surface["label"]) or {
                "tilt": surface["tilt"] or DEFAULT_TILT,
                "azimuth": surface["azimuth"] if surface["azimuth"] is not None else DEFAULT_AZIMUTH,
                "orientation": "default",
                "factor": default_factor(self.coordinator, surface["serials"]),
                "calibration_days": 0,
            }
            calibration[surface["label"] or "all"] = {"panels": len(surface["serials"]), **info}
            plane = plane_series(weather, lat, lon, info["tilt"], info["azimuth"], sun)
            for moment, value in plane.items():
                hourly[moment] = hourly.get(moment, 0.0) + value * info["factor"]
        now = dt_util.utcnow()
        start = dt_util.as_utc(dt_util.start_of_local_day())

        def day_kwh(offset: int) -> float:
            begin = start + timedelta(days=offset)
            return round(sum(v for t, v in hourly.items() if begin < t <= begin + timedelta(days=1)) / 1000, 2)

        so_far = 0.0
        current = 0.0
        for moment, value in hourly.items():
            if start < moment <= now:
                so_far += value
            elif moment - timedelta(hours=1) < now < moment:
                current = value
                if moment > start:
                    so_far += value * ((now - (moment - timedelta(hours=1))) / timedelta(hours=1))
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
        """[[hour end ISO, Wh], ...] for the cards (yesterday onwards)."""
        since = dt_util.as_utc(dt_util.start_of_local_day()) - timedelta(days=1)
        return [[t.isoformat(), v] for t, v in self.data.hourly.items() if t > since]
