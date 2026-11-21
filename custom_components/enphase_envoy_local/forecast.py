"""Solar forecast for Enphase Envoy Local, calibrated on the system itself.

Weather comes from Open-Meteo (free, no account): hourly global, direct and
diffuse irradiance, temperature, wind, humidity and snow for the location of
Home Assistant, from six weather models (DWD ICON, ECMWF IFS, Meteo-France,
KNMI, UK Met Office and NOAA GFS). From the position of the sun the
integration computes the irradiance on every roof surface itself.

Everything else is learned from the system's own history (the long-term
statistics of the microinverters and of the production meter):

* the orientation and tilt of every roof surface, when the Enlighten layout
  does not have them (installers often leave them at 0 / south), by finding
  the orientation whose irradiance matches the shape of the production days;
* how many Wh a roof surface makes per Wh/m2, so dirt, panel type and the
  inverters' limits are part of the forecast without any setup;
* a shade map per roof surface: how much of the expected light really arrives
  for every position of the sun (trees, chimneys, neighbours, low winter sun);
* how much each weather model is to be trusted *at this location*: the
  forecasts the models made for the past year are weighed against what the
  system really produced (non-negative least squares). Clouds are already
  part of a model's irradiance; what the models get wrong is learned here.
  Fog and drizzle (very humid air) get their own correction.

Hours in which the system was switched off or curtailed (bright sky, almost
no production) are recognised and left out of everything that is learned.

Backtested walk-forward on a year of real production (22 panels, two roofs,
days with curtailment left out): error per day 8.9 % -> 7.8 % for today,
10.6 % -> 9.8 % for tomorrow, and the forecast no longer runs 3 % low.
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

from .const import CONF_SERIAL, DOMAIN

if TYPE_CHECKING:
    from .coordinator import EnvoyCoordinator

_LOGGER = logging.getLogger(__name__)

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
# Weather archive (reanalysis, back to 1940) for learning from a long history.
ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
# The forecasts the same models made in the past: learning from these makes the
# calibration match what the forecast will see.
HISTORICAL_URL = "https://historical-forecast-api.open-meteo.com/v1/forecast"
# Backtested on archived forecasts against real production: the average of
# these three beats every single model and every other combination tried.
WEATHER_MODELS = (
    "dwd_icon_seamless",
    "ecmwf_ifs025",
    "meteofrance_seamless",
    "knmi_seamless",
    "ukmo_seamless",
    "gfs_seamless",
)
HOURLY = (
    "shortwave_radiation,direct_normal_irradiance,diffuse_radiation,temperature_2m,"
    "wind_speed_10m,relative_humidity_2m,snow_depth"
)
LEARN_DAYS = 365
MODEL = 5  # bump when the learning changes: everything is learned again
STORAGE_VERSION = 1
PAST_DAYS = 7
FORECAST_DAYS = 4  # today in UTC can still be yesterday locally
MIN_DAY_IRRADIANCE = 250  # Wh/m² - darker days say little about the system
DEFAULT_TILT = 35.0
DEFAULT_AZIMUTH = 180.0  # compass degrees, 180 = south
PERFORMANCE_RATIO = 0.85
ALBEDO = 0.2
RELEARN_EVERY = timedelta(hours=20)
AZIMUTHS = range(0, 360, 15)  # coarse search, refined around the best
TILTS = (15, 25, 35, 45, 55)
MIN_FIT_DAYS = 20  # days of history before orientation and shade are learned
SHADE_AZ = 15  # shade map cells: degrees of sun azimuth ...
SHADE_EL = 5  # ... and sun elevation
SHADE_PRIOR = 1500.0  # Wh/m² of evidence before a cell may differ from 1
SHADE_LIMITS = (0.3, 1.6)
SNOW_RATIO = 0.25  # a bright day producing less than this share is snow/outage
RECENT_DAYS = 45  # the factor follows the season: learned again on the last weeks
RECENT_MIN_DAYS = 12
RECENT_LIMITS = (0.7, 1.4)
TEMP_COEFF = -0.0037  # per °C cell temperature above 25 °C (crystalline silicon)
CELL_HEATING = 0.032  # °C per W/m² in still air (open rack ~0.03)
INTRADAY_HOURS = 2.0  # how long the measured deviation of the last hour keeps counting
INTRADAY_WEIGHT = 0.6  # backtested: next hour 16.1 % -> 14.4 % error
OFF_RATIO = 0.03  # under a bright sky less than this share of clear-sky output = switched off
OFF_MIN_CLEAR = 100.0  # W/m² of clear-sky light on the roof before that is judged
BLEND_MIN_DAYS = 30  # days of history before the weather models are weighed
BLEND_RIDGE = 0.001
HUMID_FROM = 80.0  # % relative humidity where fog/drizzle starts to count
SNOW_FROM = 0.01  # m of forecast snow depth from which the panels are (partly) covered
SNOW_FULL = 0.02
SNOW_LOSS = 0.5  # backtested on a week of snow: error of those days 62 % -> 41 %
LOG_DAYS = 60


@dataclass
class ForecastData:
    """What the sensors and cards show."""

    hourly: dict[datetime, float] = field(default_factory=dict)  # hour end (UTC) -> Wh in that hour
    today: float | None = None  # kWh
    tomorrow: float | None = None
    day_after: float | None = None
    so_far: float | None = None  # kWh expected until now today
    yesterday: float | None = None  # kWh the forecast gave for yesterday
    next_hour: float | None = None  # Wh expected in the next full hour
    best_hour_tomorrow: datetime | None = None  # start of tomorrow's sunniest hour
    power_now: float | None = None  # W
    calibration: dict[str, dict[str, Any]] = field(default_factory=dict)
    blend: dict[str, Any] | None = None  # learned weight of every weather model
    error_30d: float | None = None  # % mean error per day of the day-ahead forecast
    intraday: float | None = None  # measured / expected over the last hour
    updated: datetime | None = None
    error: str | None = None


@dataclass
class Weather:
    """Hourly irradiance, keyed by the end of the hour (UTC), means over that hour."""

    ghi: dict[datetime, float]
    dni: dict[datetime, float]
    dhi: dict[datetime, float]
    temp: dict[datetime, float] = field(default_factory=dict)  # °C
    wind: dict[datetime, float] = field(default_factory=dict)  # km/h
    humidity: dict[datetime, float] = field(default_factory=dict)  # %
    snow: dict[datetime, float] = field(default_factory=dict)  # m on the ground
    # The same hours per weather model (empty for a single source); this object
    # then holds their average.
    models: dict[str, Weather] = field(default_factory=dict)


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
        if end not in sun or end not in weather.dni or end not in weather.dhi:
            continue
        elev, az = sun[end]
        g = plane_irradiance(ghi, weather.dni[end], weather.dhi[end], elev, az, tilt, azimuth)
        out[end] = g * temperature_factor(g, weather.temp.get(end), weather.wind.get(end))
    return out


def temperature_factor(irradiance: float, air: float | None, wind: float | None) -> float:
    """Panels lose ~0.37 %/°C above 25 °C: hot summer panels make less per W/m².

    Without this the calibration (mostly learned in summer) forecasts autumn
    and winter too low; backtested: bias -9 % -> -4 %.
    """
    if air is None or irradiance <= 0:
        return 1.0
    cell = air + irradiance * CELL_HEATING / (1 + 0.05 * (wind if wind is not None else 10.0))
    return max(0.7, min(1.2, 1 + TEMP_COEFF * (cell - 25)))


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


def _hours_for_fit(
    production: dict[datetime, float],
    weather: Weather,
    sun: dict[datetime, tuple[float, float]],
) -> list[tuple[float, ...]]:
    """Daylight hours with production as tuples ready for fast plane maths.

    (actual, ghi, beam, dhi, cos zenith, sin zenith * cos az, sin zenith * sin az)
    """
    rows = []
    for end, actual in production.items():
        ghi = weather.ghi.get(end)
        if ghi is None or end not in sun:
            continue
        elev, az = sun[end]
        if elev <= 2:
            continue
        zen = math.radians(90 - elev)
        a = math.radians(az)
        rows.append(
            (
                actual,
                ghi,
                weather.dni.get(end, 0.0),
                weather.dhi.get(end, 0.0),
                math.cos(zen),
                math.sin(zen) * math.cos(a),
                math.sin(zen) * math.sin(a),
            )
        )
    return rows


def _plane_fast(row: tuple[float, ...], ct: float, st: float, ca: float, sa: float) -> float:
    _, ghi, dni, dhi, cz, szc, szs = row
    if ghi <= 0:
        return 0.0
    cos_aoi = cz * ct + st * (szc * ca + szs * sa)
    return dni * max(0.0, cos_aoi) + dhi * (1 + ct) / 2 + ghi * ALBEDO * (1 - ct) / 2


def _shape_error(rows: list[tuple[float, ...]], tilt: float, azimuth: float) -> float:
    """1 - R² of production against plane irradiance with one free scale."""
    t, a = math.radians(tilt), math.radians(azimuth)
    ct, st, ca, sa = math.cos(t), math.sin(t), math.cos(a), math.sin(a)
    pg = gg = pp = 0.0
    for row in rows:
        g = _plane_fast(row, ct, st, ca, sa)
        p = row[0]
        pg += p * g
        gg += g * g
        pp += p * p
    if gg <= 0 or pp <= 0:
        return 1.0
    return 1 - pg * pg / (gg * pp)


def fit_orientation(
    production: dict[datetime, float],
    weather: Weather,
    lat: float,
    lon: float,
    sun: dict[datetime, tuple[float, float]],
) -> tuple[float, float, float] | None:
    """Orientation whose irradiance best explains the production, hour by hour.

    Returns (tilt, azimuth, fit error) or None without enough history. All
    daylight hours are used (not only clear days): over a year the weather
    evens out and the timing of production gives the orientation.
    """
    rows = _hours_for_fit(production, weather, sun)
    days = {dt_util.as_local(end).date() for end in production if end in weather.ghi}
    if len(days) < MIN_FIT_DAYS or len(rows) < MIN_FIT_DAYS * 6:
        return None
    best = min(
        ((float(t), float(a), _shape_error(rows, t, a)) for t in TILTS for a in AZIMUTHS),
        key=lambda x: x[2],
    )
    # Refine around the best coarse cell.
    fine = [
        (t, (best[1] + da) % 360)
        for t in (best[0] - 5, best[0], best[0] + 5)
        if 5 <= t <= 70
        for da in (-10, -5, 0, 5, 10)
    ]
    for t, a in fine:
        error = _shape_error(rows, t, a)
        if error < best[2]:
            best = (float(t), float(a), error)
    return best


def shade_cell(elevation: float, azimuth: float) -> str:
    """Key of the shade map cell for a sun position."""
    return f"{int(azimuth // SHADE_AZ)}_{int(max(0.0, elevation) // SHADE_EL)}"


def learn_factor_and_shade(
    production: dict[datetime, float],
    plane: dict[datetime, float],
    sun: dict[datetime, tuple[float, float]],
) -> tuple[float, int, dict[str, float]] | None:
    """Wh per Wh/m² of a roof surface and its shade map.

    Days with snow on the panels (or an outage) are left out: on a bright day
    they produce almost nothing and would drag the factor down.
    """
    by_day: dict[str, list[datetime]] = {}
    for end in production:
        if end in plane:
            by_day.setdefault(dt_util.as_local(end).date().isoformat(), []).append(end)
    days = [h for h in by_day.values() if len(h) >= 8 and sum(plane[x] for x in h) >= MIN_DAY_IRRADIANCE]
    if not days:
        return None
    sum_a = sum(production[x] for h in days for x in h)
    sum_g = sum(plane[x] for h in days for x in h)
    if sum_a <= 0 or sum_g <= 0:
        return None
    factor = sum_a / sum_g
    kept = [
        h for h in days
        if sum(production[x] for x in h) >= SNOW_RATIO * factor * sum(plane[x] for x in h)
    ]
    if not kept:
        return None
    sum_a = sum(production[x] for h in kept for x in h)
    sum_g = sum(plane[x] for h in kept for x in h)
    factor = sum_a / sum_g
    shade: dict[str, float] = {}
    if len(kept) >= MIN_FIT_DAYS:
        cells: dict[str, list[float]] = {}
        for h in kept:
            for x in h:
                if x not in sun or sun[x][0] <= 0:
                    continue
                c = cells.setdefault(shade_cell(*sun[x]), [0.0, 0.0])
                c[0] += production[x]
                c[1] += plane[x] * factor
        prior = SHADE_PRIOR * factor
        for key, (actual, expected) in cells.items():
            ratio = (actual + prior) / (expected + prior)
            ratio = min(SHADE_LIMITS[1], max(SHADE_LIMITS[0], ratio))
            if abs(ratio - 1) >= 0.02:
                shade[key] = round(ratio, 3)
    return factor, len(kept), shade


def recent_ratio(
    production: dict[datetime, float],
    plane: dict[datetime, float],
    sun: dict[datetime, tuple[float, float]],
    factor: float,
    shade: dict[str, float],
) -> tuple[float, int]:
    """Measured / expected over the last RECENT_DAYS (shade map included).

    Backtested walk-forward on the last 50 days: daily error 13 % -> 10.5 %,
    bias -4 % -> 0 %.
    """
    since = dt_util.utcnow() - timedelta(days=RECENT_DAYS)
    by_day: dict[str, list[datetime]] = {}
    for end in production:
        if end >= since and end in plane:
            by_day.setdefault(dt_util.as_local(end).date().isoformat(), []).append(end)
    actual = expected = 0.0
    days = 0
    for hours in by_day.values():
        exp = sum(
            plane[x] * factor * (shade.get(shade_cell(*sun[x]), 1.0) if x in sun and plane[x] else 1.0)
            for x in hours
        )
        act = sum(production[x] for x in hours)
        if len(hours) < 8 or exp < MIN_DAY_IRRADIANCE * factor or act < SNOW_RATIO * exp:
            continue
        actual += act
        expected += exp
        days += 1
    if days < RECENT_MIN_DAYS or expected <= 0:
        return 1.0, days
    return min(RECENT_LIMITS[1], max(RECENT_LIMITS[0], actual / expected)), days


WEATHER_FIELDS = {
    "ghi": ("shortwave_radiation", True),
    "dni": ("direct_normal_irradiance", True),
    "dhi": ("diffuse_radiation", True),
    "temp": ("temperature_2m", False),
    "wind": ("wind_speed_10m", True),
    "humidity": ("relative_humidity_2m", True),
    "snow": ("snow_depth", True),
}


def _weather_from(raw: dict[str, Any]) -> Weather:
    """Open-Meteo hourly answer -> Weather keyed by the end of the hour (UTC).

    With several weather models the answer has one series per model
    (``shortwave_radiation_dwd_icon_seamless``...): the result is their
    average, with every model on its own in ``models``.
    """
    hourly = raw.get("hourly") or {}
    times = []
    for stamp in hourly.get("time") or []:
        times.append(dt_util.parse_datetime(f"{stamp}:00+00:00" if len(stamp) == 16 else stamp))

    def column(values: list[Any], clamp: bool) -> dict[datetime, float]:
        # Open-Meteo radiation is the mean of the *preceding* hour: the label is
        # the end of the hour (verified against a year of real production).
        out: dict[datetime, float] = {}
        for i, t in enumerate(times):
            if t is None or i >= len(values) or values[i] is None:
                continue
            value = float(values[i])
            out[t] = max(0.0, value) if clamp else value
        return out

    def mean(columns: list[dict[datetime, float]]) -> dict[datetime, float]:
        total: dict[datetime, float] = {}
        count: dict[datetime, int] = {}
        for col in columns:
            for t, v in col.items():
                total[t] = total.get(t, 0.0) + v
                count[t] = count.get(t, 0) + 1
        return {t: v / count[t] for t, v in total.items()}

    per_model: dict[str, dict[str, dict[datetime, float]]] = {}
    for key, values in hourly.items():
        if key == "time" or not isinstance(values, list):
            continue
        for name, (variable, clamp) in WEATHER_FIELDS.items():
            if key == variable:
                per_model.setdefault("", {})[name] = column(values, clamp)
            elif key.startswith(f"{variable}_"):
                per_model.setdefault(key[len(variable) + 1 :], {})[name] = column(values, clamp)
    blended = {
        name: mean([fields[name] for fields in per_model.values() if name in fields])
        for name in WEATHER_FIELDS
    }
    models = {
        model: Weather(**{name: fields.get(name, {}) for name in WEATHER_FIELDS})
        for model, fields in per_model.items()
        if model and fields.get("ghi") and fields.get("dni") and fields.get("dhi")
    }
    return Weather(**blended, models=models)


def _merge_weather(target: Weather, source: Weather, until: datetime) -> None:
    """Complete ``target`` with the hours up to ``until`` that only ``source`` has."""
    for name in WEATHER_FIELDS:
        into, extra = getattr(target, name), getattr(source, name)
        for t, v in extra.items():
            if t <= until and t not in into:
                into[t] = v
    for model, weather in source.models.items():
        if model in target.models:
            _merge_weather(target.models[model], weather, until)


def expected_production(
    weather: Weather,
    infos: list[dict[str, Any]],
    lat: float,
    lon: float,
    sun: dict[datetime, tuple[float, float]],
    recent: bool,
) -> dict[datetime, float]:
    """Wh per hour of all roof surfaces together for one source of weather.

    ``recent``: with the factor of the last weeks (used while the weather
    models are not weighed yet); otherwise the plain factor of the year.
    """
    total: dict[datetime, float] = {}
    for info in infos:
        plane = plane_series(weather, lat, lon, info["tilt"], info["azimuth"], sun)
        factor = info["factor"] if recent else info.get("year_factor", info["factor"])
        shade = info.get("shade") or {}
        for moment, value in plane.items():
            corr = shade.get(shade_cell(*sun[moment]), 1.0) if value else 1.0
            total[moment] = total.get(moment, 0.0) + value * factor * corr
    return total


def learn_blend(
    history: Weather,
    infos: list[dict[str, Any]],
    lat: float,
    lon: float,
    sun: dict[datetime, tuple[float, float]],
    target: dict[datetime, float],
) -> dict[str, Any] | None:
    """Weigh the weather models against a year of real production."""
    if len(history.models) < 2:
        return None
    names = sorted(history.models)
    per_model = [expected_production(history.models[m], infos, lat, lon, sun, False) for m in names]
    rows: list[tuple[list[float], float, float]] = []
    days: set[Any] = set()
    for moment, actual in target.items():
        if moment not in sun or sun[moment][0] <= 0:
            continue
        values = [series.get(moment) for series in per_model]
        if any(v is None for v in values):
            continue
        rows.append((values, humid(history.humidity.get(moment)), actual))  # type: ignore[arg-type]
        days.add(dt_util.as_local(moment).date())
    if len(days) < BLEND_MIN_DAYS or len(rows) < BLEND_MIN_DAYS * 6:
        return None
    fitted = fit_blend(rows)
    if fitted is None:
        return None
    weights, wet = fitted
    return {
        "weights": {name: round(w, 4) for name, w in zip(names, weights, strict=True)},
        "humidity": round(wet, 4),
        "days": len(days),
    }


def energy_between(hourly: dict[datetime, float], begin: datetime, end: datetime) -> float:
    """Wh the hourly series (keyed by the end of the hour) holds between two moments."""
    hour = timedelta(hours=1)
    total = 0.0
    for moment, value in hourly.items():
        overlap = min(end, moment) - max(begin, moment - hour)
        if overlap > timedelta(0):
            total += value * (overlap / hour)
    return total


# ------------------------------------------------ switched off / curtailed


def clear_sky(elevation: float) -> tuple[float, float, float]:
    """(global, direct normal, diffuse) W/m² under a cloudless sky (Haurwitz)."""
    if elevation <= 0:
        return 0.0, 0.0, 0.0
    cos_zen = math.sin(math.radians(elevation))
    ghi = 1098 * cos_zen * math.exp(-0.057 / cos_zen)
    dhi = min(ghi, 0.1 * ghi + 25 * min(1.0, cos_zen * 5))
    dni = (ghi - dhi) / cos_zen if cos_zen > 0.02 else 0.0
    return ghi, dni, dhi


def off_hours(
    production: dict[datetime, float],
    sun: dict[datetime, tuple[float, float]],
    tilt: float,
    azimuth: float,
    capacity: float,
) -> set[datetime]:
    """Hours in which a roof surface was switched off, curtailed or snowed in.

    Even the thickest clouds leave some 10 % of the clear-sky light. A surface
    making under 3 % of its clear-sky output while the sun is well up was not
    limited by the weather (production stopped at negative prices, an outage,
    snow). Those hours, and the half hours next to them, teach nothing about
    the weather and are left out of the learning.
    ``capacity`` is the Wh the surface makes per Wh/m² (rated power is enough).
    """
    off: set[datetime] = set()
    hour = timedelta(hours=1)
    for end, actual in production.items():
        if end not in sun:
            continue
        elev, az = sun[end]
        clear = plane_irradiance(*clear_sky(elev), elev, az, tilt, azimuth)
        if clear >= OFF_MIN_CLEAR and actual < OFF_RATIO * clear * capacity:
            off.update((end - hour, end, end + hour))
    return off


# ----------------------------------------------------- weighing the models


def humid(value: float | None) -> float:
    """0..1: how far the air is into fog and drizzle (80 % -> 0, 100 % -> 1)."""
    if value is None:
        return 0.0
    return min(1.0, max(0.0, (value - HUMID_FROM) / (100.0 - HUMID_FROM)))


def fit_blend(rows: list[tuple[list[float], float, float]]) -> tuple[list[float], float] | None:
    """Weight of every weather model that best explains the real production.

    ``rows``: per hour ([expected Wh according to each model], humidity 0..1,
    measured Wh). Solves measured = sum(w_k * model_k) + h * mean(models) *
    humidity with w_k >= 0 (least squares with a little ridge, by coordinate
    descent - no numpy in Home Assistant). Returns (weights, humidity weight).

    One model that is right more often gets more weight; a model that adds
    nothing ends at 0. The sum of the weights also sets the level, so the
    forecast is unbiased against the meter it is learned on.
    """
    if not rows:
        return None
    count = len(rows[0][0])
    size = count + 1
    a = [[0.0] * size for _ in range(size)]
    b = [0.0] * size
    for values, wet, actual in rows:
        x = [*values, sum(values) / count * wet]
        for j in range(size):
            xj = x[j]
            if not xj:
                continue
            b[j] += xj * actual
            row = a[j]
            for k in range(j, size):
                row[k] += xj * x[k]
    for j in range(size):
        for k in range(j):
            a[j][k] = a[k][j]
        a[j][j] += a[j][j] * BLEND_RIDGE + 1e-6
    w = [0.0] * size
    for _ in range(400):
        for j in range(size):
            rest = b[j] - sum(a[j][k] * w[k] for k in range(size) if k != j)
            value = rest / a[j][j]
            # The models can only add; humidity may (and does) subtract.
            w[j] = max(0.0, value) if j < count else max(-1.0, min(0.5, value))
    if sum(w[:count]) <= 0:
        return None
    return w[:count], w[count]


def blend_value(
    values: dict[str, float], wet: float, blend: dict[str, Any] | None
) -> float | None:
    """Expected Wh from what every model expects, with the learned weights.

    Without learned weights: the plain average. A model that is missing for an
    hour hands its weight to the others.
    """
    if not values:
        return None
    mean = sum(values.values()) / len(values)
    weights = (blend or {}).get("weights") or {}
    known = {m: w for m, w in weights.items() if m in values}
    total = sum(weights.values())
    have = sum(known.values())
    if not known or have <= 0 or total <= 0:
        return mean
    level = sum(values[m] * w for m, w in known.items()) * total / have
    return max(0.0, level + (blend or {}).get("humidity", 0.0) * mean * wet)


def snow_factor(depth: float | None) -> float:
    """Share of the production that is left with snow on the ground."""
    if depth is None or depth < SNOW_FROM:
        return 1.0
    return 1 - SNOW_LOSS * min(1.0, depth / SNOW_FULL)


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
        self._blend: dict[str, Any] | None = None
        self._learned_at: datetime | None = None
        self._loaded = False
        self.history_source: str | None = None
        # (moment, Wh produced today) of the last updates: what the last hour
        # really made, against what was expected for it.
        self._samples: list[tuple[datetime, float]] = []
        # The forecast as it stood the evening before, per day, and how it turned
        # out: [[date, forecast kWh, produced kWh], ...].
        self._issued: dict[str, float] = {}
        self.log: list[list[Any]] = []

    def _stored(self) -> dict[str, Any]:
        return {
            "surfaces": self._learned,
            "blend": self._blend,
            "learned_at": self._learned_at.isoformat() if self._learned_at else None,
            "model": MODEL,
            "issued": self._issued,
            "log": self.log,
        }

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
            self._blend = stored.get("blend") or None
            self._issued = stored.get("issued") or {}
            self.log = stored.get("log") or []
            at = stored.get("learned_at")
            self._learned_at = dt_util.parse_datetime(at) if at else None
            if stored.get("model") != MODEL:
                self._learned_at = None
                self._blend = None
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
        await self.hass.async_add_executor_job(self._compute, surfaces, weather, sun, lat, lon)
        self.data.error = None
        self._store.async_delay_save(self._stored, 120)

    async def _async_get(self, url: str, params: dict[str, str], timeout: float) -> Weather:
        """One Open-Meteo request; without the chosen models if they are refused."""
        session = async_get_clientsession(self.hass)
        last: Exception | None = None
        for models in (",".join(WEATHER_MODELS), None):
            query = dict(params, models=models) if models else params
            try:
                async with session.get(
                    url, params=query, timeout=aiohttp.ClientTimeout(total=timeout)
                ) as resp:
                    resp.raise_for_status()
                    raw = await resp.json(content_type=None)
                weather = await self.hass.async_add_executor_job(_weather_from, raw)
                if weather.ghi:
                    return weather
            except Exception as err:  # noqa: BLE001 - try the default model
                last = err
        raise last or RuntimeError("no weather data")

    async def _async_weather(self, lat: float, lon: float) -> Weather:
        return await self._async_get(
            OPEN_METEO_URL,
            {
                "latitude": f"{lat:.3f}",
                "longitude": f"{lon:.3f}",
                "hourly": HOURLY,
                "past_days": str(PAST_DAYS),
                "forecast_days": str(FORECAST_DAYS),
                "timezone": "UTC",
            },
            30,
        )

    async def _async_history_weather(self, lat: float, lon: float, recent: Weather) -> Weather:
        """A year of past forecasts (or measured weather), completed with the recent days."""
        today = dt_util.now().date()
        params = {
            "latitude": f"{lat:.3f}",
            "longitude": f"{lon:.3f}",
            "start_date": (today - timedelta(days=LEARN_DAYS)).isoformat(),
            "end_date": (today - timedelta(days=1)).isoformat(),
            "hourly": HOURLY,
            "timezone": "UTC",
        }
        merged = Weather(ghi={}, dni={}, dhi={})
        self.history_source = None
        for url, name in ((HISTORICAL_URL, "historical forecasts"), (ARCHIVE_URL, "weather archive")):
            try:
                merged = await self._async_get(url, params, 120)
                self.history_source = name
                break
            except Exception as err:  # noqa: BLE001 - next source, or the recent days only
                _LOGGER.info("Open-Meteo %s not available: %s", name, err)
        if not merged.models and not merged.ghi:
            merged.models = {name: Weather(ghi={}, dni={}, dhi={}) for name in recent.models}
        _merge_weather(merged, recent, dt_util.utcnow())
        return merged

    async def _async_statistics(self, ids: set[str]) -> dict[str, dict[datetime, float]]:
        """Hourly mean (W = Wh per hour) of sensors, keyed by the end of the hour."""
        try:
            from homeassistant.components.recorder import get_instance
            from homeassistant.components.recorder.statistics import statistics_during_period
        except ImportError:
            return {}
        if not ids or "recorder" not in self.hass.config.components:
            return {}
        end = dt_util.utcnow().replace(minute=0, second=0, microsecond=0)
        start = end - timedelta(days=LEARN_DAYS)
        stats = await get_instance(self.hass).async_add_executor_job(
            statistics_during_period, self.hass, start, end, ids, "hour", None, {"mean"}
        )

        def to_dt(value: Any) -> datetime:
            if isinstance(value, (int, float)):
                return dt_util.utc_from_timestamp(value)
            return dt_util.as_utc(value)

        return {
            entity_id: {
                to_dt(r["start"]) + timedelta(hours=1): float(r["mean"])
                for r in rows
                if r.get("mean") is not None
            }
            for entity_id, rows in stats.items()
        }

    async def _async_production(self, surfaces: list[dict[str, Any]]) -> dict[str, dict[datetime, float]]:
        """Hourly production (Wh) per roof surface from the long-term statistics."""
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
        stats = await self._async_statistics({i for ids in per_serial.values() for i in ids})
        if not stats:
            return {}
        result: dict[str, dict[datetime, float]] = {}
        for surface in surfaces:
            total: dict[datetime, float] = {}
            count: dict[datetime, int] = {}
            complete = True
            for serial in surface["serials"]:
                best: dict[datetime, float] = {}
                for entity_id in per_serial.get(serial, []):
                    rows = stats.get(entity_id) or {}
                    if len(rows) > len(best):
                        best = rows
                if not best:
                    complete = False
                    break
                for t, v in best.items():
                    total[t] = total.get(t, 0.0) + max(0.0, v)
                    count[t] = count.get(t, 0) + 1
            # Only hours in which every microinverter of the surface has data.
            n = len(surface["serials"])
            total = {t: v for t, v in total.items() if count[t] == n}
            if complete and total:
                result[surface["label"]] = total
        return result

    async def _async_meter(self) -> dict[datetime, float]:
        """Hourly production (Wh) of the whole system as the production meter saw it.

        The microinverters report a few percent less than the production meter
        measures; the forecast is compared with the meter, so it is learned on
        the meter. Our own production sensor, completed with the history of the
        core Enphase integration (which often goes back further).
        """
        serial = str(self.coordinator.config_entry.data.get(CONF_SERIAL, ""))
        registry = er.async_get(self.hass)
        own = registry.async_get_entity_id("sensor", DOMAIN, f"{serial}_production_power")
        others = [
            state.entity_id
            for state in self.hass.states.async_all("sensor")
            if serial
            and serial in state.entity_id
            and state.entity_id.endswith("current_power_production")
            and state.attributes.get("unit_of_measurement") == "W"
        ]
        stats = await self._async_statistics({i for i in (own, *others) if i})
        meter: dict[datetime, float] = {}
        for entity_id in sorted(others, key=lambda i: len(stats.get(i) or {})):
            meter.update(stats.get(entity_id) or {})
        if own:
            meter.update(stats.get(own) or {})
        return {t: max(0.0, v) for t, v in meter.items()}

    async def _async_learn(
        self,
        surfaces: list[dict[str, Any]],
        weather: Weather,
        sun: dict[datetime, tuple[float, float]],
        lat: float,
        lon: float,
    ) -> None:
        """Learn the roof surfaces and how far every weather model is to be trusted."""
        production = await self._async_production(surfaces)
        learned: dict[str, dict[str, Any]] = {}
        clean: dict[str, dict[datetime, float]] = {}
        off_all: set[datetime] = set()
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
            # Hours in which the surface was switched off say nothing about the weather.
            rated = default_factor(self.coordinator, surface["serials"])
            off = await self.hass.async_add_executor_job(
                off_hours, prod, sun, entry["tilt"], entry["azimuth"], rated
            ) if prod else set()
            off_all |= off
            prod = clean[label] = {t: v for t, v in prod.items() if t not in off}
            # Wh per Wh/m² (total production over total irradiance, no bias in
            # backtests) and the shade map, without snow days.
            plane = await self.hass.async_add_executor_job(
                plane_series, weather, lat, lon, entry["tilt"], entry["azimuth"], sun
            )
            result = await self.hass.async_add_executor_job(learn_factor_and_shade, prod, plane, sun) if prod else None
            if result:
                factor, days, shade = result
                # The season changes what a roof makes per W/m² (low sun, cold,
                # wet panels): correct the year's factor with the last weeks.
                recent = recent_ratio(prod, plane, sun, factor, shade)
                entry.update(
                    factor=round(factor * recent[0], 4), year_factor=round(factor, 4),
                    recent_ratio=round(recent[0], 3), recent_days=recent[1],
                    calibration_days=days, shade=shade, off_hours=len(off) // 3,
                )
            elif previous.get("calibration_days"):
                entry.update(
                    factor=previous["factor"],
                    year_factor=previous.get("year_factor", previous["factor"]),
                    calibration_days=previous["calibration_days"],
                    shade=previous.get("shade") or {},
                )
            else:
                entry.update(factor=round(rated, 4), calibration_days=0, shade={})
            learned[label] = entry
        self._learned = learned
        blend = await self._async_learn_blend(surfaces, weather, sun, lat, lon, clean, off_all)
        if blend:
            # Without a new fit (history not available today) the last one stays.
            self._blend = blend
        self._learned_at = dt_util.utcnow()
        await self._store.async_save(self._stored())

    async def _async_learn_blend(
        self,
        surfaces: list[dict[str, Any]],
        weather: Weather,
        sun: dict[datetime, tuple[float, float]],
        lat: float,
        lon: float,
        production: dict[str, dict[datetime, float]],
        off: set[datetime],
    ) -> dict[str, Any] | None:
        """Weights of the weather models, learned on the production meter."""
        infos = [self._learned[s["label"]] for s in surfaces]
        if len(weather.models) < 2 or any(not i.get("calibration_days") for i in infos):
            return None
        # All surfaces together, only hours every surface has.
        inverters: dict[datetime, float] = {}
        seen: dict[datetime, int] = {}
        for surface in surfaces:
            for t, v in (production.get(surface["label"]) or {}).items():
                inverters[t] = inverters.get(t, 0.0) + v
                seen[t] = seen.get(t, 0) + 1
        inverters = {t: v for t, v in inverters.items() if seen[t] == len(surfaces) and t not in off}
        meter = await self._async_meter()
        # Where the meter has no history the microinverters stand in, lifted to
        # the level of the meter (it reads a few percent more).
        since = dt_util.utcnow() - timedelta(days=RECENT_DAYS)
        both = [(meter[t], v) for t, v in inverters.items() if t in meter and t >= since and v > 50]
        ratio = 1.0
        if len(both) >= 50:
            ratio = min(1.15, max(0.9, sum(m for m, _ in both) / sum(v for _, v in both)))
        target = {t: (meter[t] if t in meter else v * ratio) for t, v in inverters.items()}
        blend = await self.hass.async_add_executor_job(
            learn_blend, weather, infos, lat, lon, sun, target
        )
        if blend:
            blend["meter_ratio"] = round(ratio, 3)
            blend["meter_hours"] = sum(1 for t in target if t in meter)
        return blend

    def _compute(
        self,
        surfaces: list[dict[str, Any]],
        weather: Weather,
        sun: dict[datetime, tuple[float, float]],
        lat: float,
        lon: float,
    ) -> None:
        infos: list[dict[str, Any]] = []
        calibration: dict[str, dict[str, Any]] = {}
        for surface in surfaces:
            info = self._learned.get(surface["label"]) or {
                "tilt": surface["tilt"] or DEFAULT_TILT,
                "azimuth": surface["azimuth"] if surface["azimuth"] is not None else DEFAULT_AZIMUTH,
                "orientation": "default",
                "factor": default_factor(self.coordinator, surface["serials"]),
                "calibration_days": 0,
            }
            infos.append(info)
            calibration[surface["label"] or "all"] = {
                "panels": len(surface["serials"]),
                **{k: v for k, v in info.items() if k != "shade"},
                "shade_cells": len(info.get("shade") or {}),
            }
        # What every weather model expects, then their learned mix. Until the
        # models are weighed: their average with the factor of the last weeks.
        models = weather.models or {"": weather}
        blend = self._blend if self._blend and set(self._blend.get("weights") or {}) & set(models) else None
        per_model = {
            name: expected_production(source, infos, lat, lon, sun, blend is None)
            for name, source in models.items()
        }
        hourly: dict[datetime, float] = {}
        for moment in weather.ghi:
            values = {name: series[moment] for name, series in per_model.items() if moment in series}
            value = blend_value(values, humid(weather.humidity.get(moment)), blend)
            if value is not None:
                hourly[moment] = value * snow_factor(weather.snow.get(moment))
        now = dt_util.utcnow()
        start = dt_util.as_utc(dt_util.start_of_local_day())

        def day_kwh(offset: int) -> float:
            begin = start + timedelta(days=offset)
            return round(sum(v for t, v in hourly.items() if begin < t <= begin + timedelta(days=1)) / 1000, 2)

        so_far = energy_between(hourly, start, now)
        # The last hour tells how the weather really turned out: the next hours
        # of today follow that deviation, fading out quickly (clouds move on).
        produced = getattr(self.coordinator.data, "production_today", None)
        intraday = None
        if produced is not None:
            self._samples = [
                (t, v) for t, v in self._samples if now - t <= timedelta(hours=2) and v <= produced
            ]
            past = [
                s for s in self._samples
                if timedelta(minutes=40) <= now - s[0] <= timedelta(minutes=95) and s[0] >= start
            ]
            if past:
                then, before = min(past, key=lambda s: abs((now - s[0]) - timedelta(hours=1)))
                hours = (now - then) / timedelta(hours=1)
                expected = energy_between(hourly, then, now)
                if expected >= 100 * hours:
                    intraday = min(2.5, max(0.4, (produced - before) / expected))
                    weight = INTRADAY_WEIGHT * min(1.0, expected / hours / 300)
                    end_today = start + timedelta(days=1)
                    for moment in list(hourly):
                        if now < moment <= end_today:
                            ahead = max(0.0, (moment - timedelta(minutes=30) - now) / timedelta(hours=1))
                            hourly[moment] *= 1 + (intraday - 1) * weight * math.exp(-ahead / INTRADAY_HOURS)
            if not self._samples or now - self._samples[-1][0] >= timedelta(minutes=10):
                self._samples.append((now, produced))
        current = 0.0
        for moment, value in hourly.items():
            if moment - timedelta(hours=1) < now < moment:
                current = value
        next_end = now.replace(minute=0, second=0, microsecond=0) + timedelta(hours=2)
        tomorrow = [
            (v, t) for t, v in hourly.items()
            if start + timedelta(days=1) < t <= start + timedelta(days=2)
        ]
        best = max(tomorrow) if tomorrow else None
        today_kwh, tomorrow_kwh = day_kwh(0), day_kwh(1)
        issued_yesterday = self._track(today_kwh, tomorrow_kwh)
        self.data = ForecastData(
            hourly={t: round(v, 1) for t, v in sorted(hourly.items())},
            today=today_kwh,
            tomorrow=tomorrow_kwh,
            day_after=day_kwh(2),
            so_far=round(so_far / 1000, 2),
            yesterday=issued_yesterday if issued_yesterday is not None else day_kwh(-1),
            next_hour=round(hourly.get(next_end, 0.0), 0) if next_end in hourly else None,
            best_hour_tomorrow=best[1] - timedelta(hours=1) if best and best[0] > 0 else None,
            power_now=round(current, 0),
            calibration=calibration,
            blend=blend,
            error_30d=self._error_30d(),
            intraday=round(intraday, 2) if intraday is not None else None,
            updated=now,
        )

    def _track(self, today_kwh: float, tomorrow_kwh: float) -> float | None:
        """Remember the forecast as it was given, and how the day turned out.

        The value for a day is frozen at midnight: what "tomorrow" said the
        evening before. Returns that value for yesterday (None if unknown), so
        the accuracy sensor judges the forecast that was really shown.
        """
        today = dt_util.now().date()
        self._issued[(today + timedelta(days=1)).isoformat()] = tomorrow_kwh
        self._issued.setdefault(today.isoformat(), today_kwh)
        yesterday = (today - timedelta(days=1)).isoformat()
        for key in [k for k in self._issued if k < yesterday]:
            del self._issued[key]
        issued = self._issued.get(yesterday)
        actual = getattr(self.coordinator.data, "production_yesterday", None)
        if issued and actual is not None and all(row[0] != yesterday for row in self.log):
            self.log.append([yesterday, issued, round(actual / 1000, 2)])
            del self.log[:-LOG_DAYS]
        return issued

    def _error_30d(self) -> float | None:
        """Mean error per day of the day-ahead forecast over the last 30 days, in %."""
        rows = self.log[-30:]
        produced = sum(row[2] for row in rows)
        if len(rows) < 5 or produced <= 0:
            return None
        return round(sum(abs(row[1] - row[2]) for row in rows) / produced * 100, 1)

    def hourly_attribute(self) -> list[list[Any]]:
        """[[hour end ISO, Wh], ...] for the cards (yesterday onwards)."""
        since = dt_util.as_utc(dt_util.start_of_local_day()) - timedelta(days=1)
        return [[t.isoformat(), v] for t, v in self.data.hourly.items() if t > since]
