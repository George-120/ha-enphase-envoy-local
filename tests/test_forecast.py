"""Solar forecast maths: sun position, plane irradiance and orientation fit."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from custom_components.enphase_envoy_local import forecast as fc

LAT, LON = 51.86, 4.71


def test_sun_position_known_values():
    elev, az = fc.sun_position(datetime(2026, 6, 21, 11, 40, tzinfo=UTC), LAT, LON)
    assert elev == pytest.approx(61.6, abs=0.5)
    assert az == pytest.approx(180, abs=3)
    elev, az = fc.sun_position(datetime(2026, 11, 2, 8, 0, tzinfo=UTC), LAT, LON)
    assert 5 < elev < 15 and 120 < az < 140  # low in the south-east


def _weather(days: int) -> fc.Weather:
    ghi, dni, dhi = {}, {}, {}
    start = datetime(2026, 10, 20, tzinfo=UTC)
    for h in range(days * 24):
        end = start + timedelta(hours=h + 1)
        elev, _ = fc.sun_position(end - timedelta(minutes=30), LAT, LON)
        clear = max(0.0, 900 * max(0.0, elev) / 90) if elev > 0 else 0.0
        dni[end] = clear * 1.4
        dhi[end] = 60.0 if elev > 0 else 0.0
        ghi[end] = dni[end] * max(0.0, __import__("math").sin(__import__("math").radians(elev))) + dhi[end]
    return fc.Weather(ghi=ghi, dni=dni, dhi=dhi)


def test_fit_orientation_finds_an_east_roof():
    weather = _weather(25)
    sun = {end: fc.sun_position(end - timedelta(minutes=30), LAT, LON) for end in weather.ghi}
    production = {
        end: 2.0 * fc.plane_irradiance(weather.ghi[end], weather.dni[end], weather.dhi[end], *sun[end], 40, 90)
        for end in weather.ghi
    }
    tilt, azimuth, error = fc.fit_orientation(production, weather, LAT, LON, sun)
    assert azimuth == pytest.approx(90, abs=15)
    assert tilt == pytest.approx(40, abs=10)
    assert error < 0.05


def test_weather_averages_several_models():
    raw = {
        "hourly": {
            "time": ["2026-06-01T12:00", "2026-06-01T13:00"],
            "shortwave_radiation_dwd_icon_seamless": [600, None],
            "shortwave_radiation_ecmwf_ifs025": [400, 300],
            "direct_normal_irradiance_dwd_icon_seamless": [500, 100],
            "direct_normal_irradiance_ecmwf_ifs025": [300, 100],
            "diffuse_radiation_dwd_icon_seamless": [100, 80],
            "diffuse_radiation_ecmwf_ifs025": [140, 80],
        }
    }
    weather = fc._weather_from(raw)
    first, second = sorted(weather.ghi)
    assert weather.ghi[first] == 500
    assert weather.ghi[second] == 300  # a missing model is skipped, not counted as 0
    assert weather.dni[first] == 400
    assert weather.dhi[first] == 120


def test_factor_skips_snow_days_and_learns_shade():
    weather = _weather(30)
    sun = {end: fc.sun_position(end - timedelta(minutes=30), LAT, LON) for end in weather.ghi}
    plane = fc.plane_series(weather, LAT, LON, 35, 180, sun)
    production = {}
    snow_day = None
    for end, value in plane.items():
        day = end.date()
        snow_day = snow_day or day
        shaded = sun[end][1] > 240  # a tree in the west
        production[end] = 0.0 if day == snow_day else value * 3.0 * (0.5 if shaded else 1.0)
    factor, days, shade = fc.learn_factor_and_shade(production, plane, sun)
    assert days == 29  # the snow day is left out
    west = [v for k, v in shade.items() if int(k.split("_")[0]) * fc.SHADE_AZ >= 240]
    south = shade.get(fc.shade_cell(55, 180), 1.0)
    assert west and max(west) < 0.95  # little low-sun light: the prior keeps it moderate
    assert south > 0.95


def test_weather_keeps_every_model_apart():
    raw = {
        "hourly": {
            "time": ["2026-06-01T12:00"],
            "shortwave_radiation_dwd_icon_seamless": [600],
            "shortwave_radiation_ecmwf_ifs025": [400],
            "direct_normal_irradiance_dwd_icon_seamless": [500],
            "direct_normal_irradiance_ecmwf_ifs025": [300],
            "diffuse_radiation_dwd_icon_seamless": [100],
            "diffuse_radiation_ecmwf_ifs025": [140],
            "relative_humidity_2m_dwd_icon_seamless": [90],
            "relative_humidity_2m_ecmwf_ifs025": [70],
            "snow_depth_dwd_icon_seamless": [0.0],
        }
    }
    weather = fc._weather_from(raw)
    moment = next(iter(weather.ghi))
    assert set(weather.models) == {"dwd_icon_seamless", "ecmwf_ifs025"}
    assert weather.models["dwd_icon_seamless"].ghi[moment] == 600
    assert weather.models["ecmwf_ifs025"].dni[moment] == 300
    assert weather.humidity[moment] == 80
    assert weather.snow[moment] == 0


def test_single_source_has_no_models():
    raw = {
        "hourly": {
            "time": ["2026-06-01T12:00"],
            "shortwave_radiation": [600],
            "direct_normal_irradiance": [500],
            "diffuse_radiation": [100],
        }
    }
    weather = fc._weather_from(raw)
    assert weather.models == {}
    assert list(weather.ghi.values()) == [600]


def test_off_hours_finds_a_switched_off_afternoon():
    weather = _weather(3)
    sun = {end: fc.sun_position(end - timedelta(minutes=30), LAT, LON) for end in weather.ghi}
    plane = fc.plane_series(weather, LAT, LON, 35, 180, sun)
    day = sorted({end.date() for end in plane})[1]
    production = {}
    for end, value in plane.items():
        stopped = end.date() == day and 11 <= end.hour <= 13
        # An overcast day still makes a tenth; switched off makes nothing.
        production[end] = 0.0 if stopped else value * 3.0 * (0.1 if end.date() != day else 1.0)
    off = fc.off_hours(production, sun, 35, 180, 3.0)
    assert {end.hour for end in off if end.date() == day} == {10, 11, 12, 13, 14}
    assert not [end for end in off if end.date() != day]  # dark clouds are weather


def test_fit_blend_trusts_the_model_that_is_right():
    import random

    rng = random.Random(1)
    rows = []
    for _ in range(600):
        truth = rng.uniform(100, 3000)
        good = truth * rng.uniform(0.9, 1.1)
        poor = truth * rng.uniform(0.3, 1.7)
        wet = rng.choice([0.0, 0.0, 1.0])
        rows.append(([good, poor], wet, truth * (0.8 if wet else 1.0)))
    weights, humidity = fc.fit_blend(rows)
    assert weights[0] > 0.7 > 0.3 > weights[1] >= 0
    assert humidity == pytest.approx(-0.2, abs=0.06)


def test_blend_value_without_and_with_weights():
    values = {"a": 1000.0, "b": 2000.0}
    assert fc.blend_value(values, 0.0, None) == 1500
    blend = {"weights": {"a": 0.75, "b": 0.25, "c": 0.0}, "humidity": -0.2}
    assert fc.blend_value(values, 0.0, blend) == pytest.approx(1250)
    assert fc.blend_value(values, 1.0, blend) == pytest.approx(1250 - 0.2 * 1500)
    # A model that is missing for an hour hands its weight to the others.
    assert fc.blend_value({"a": 1000.0}, 0.0, blend) == pytest.approx(1000)
    assert fc.blend_value({}, 0.0, blend) is None


def test_snow_and_energy_between():
    assert fc.snow_factor(None) == 1
    assert fc.snow_factor(0.005) == 1
    assert fc.snow_factor(0.05) == pytest.approx(0.5)
    end = datetime(2026, 6, 1, 12, tzinfo=UTC)
    hourly = {end: 1000.0, end + timedelta(hours=1): 2000.0}
    assert fc.energy_between(hourly, end - timedelta(minutes=30), end + timedelta(minutes=15)) == pytest.approx(1000)


def _two_models(days: int) -> tuple[fc.Weather, dict, dict]:
    """History with a model that is right and one that is 40 % too sunny."""
    truth = _weather(days)
    sunny = fc.Weather(
        ghi={t: v * 1.4 for t, v in truth.ghi.items()},
        dni={t: v * 1.4 for t, v in truth.dni.items()},
        dhi={t: v * 1.4 for t, v in truth.dhi.items()},
    )
    history = fc.Weather(
        ghi={t: v * 1.2 for t, v in truth.ghi.items()},
        dni={t: v * 1.2 for t, v in truth.dni.items()},
        dhi={t: v * 1.2 for t, v in truth.dhi.items()},
        models={"right": truth, "sunny": sunny},
    )
    sun = {end: fc.sun_position(end - timedelta(minutes=30), LAT, LON) for end in truth.ghi}
    info = {"tilt": 35.0, "azimuth": 180.0, "factor": 3.0, "year_factor": 3.0, "shade": {}}
    target = {
        t: v * 1.04  # the meter reads 4 % more than the microinverters
        for t, v in fc.expected_production(truth, [info], LAT, LON, sun, False).items()
    }
    return history, sun, {"info": info, "target": target}


def test_learn_blend_follows_the_meter():
    history, sun, extra = _two_models(40)
    blend = fc.learn_blend(history, [extra["info"]], LAT, LON, sun, extra["target"])
    assert blend["days"] >= 30
    # Both models have the same shape here, so only the level can be learned:
    # together they must land on the meter.
    level = blend["weights"]["right"] + 1.4 * blend["weights"]["sunny"]
    assert level == pytest.approx(1.04, abs=0.01)
    assert fc.learn_blend(history, [extra["info"]], LAT, LON, sun, dict(list(extra["target"].items())[:50])) is None


async def test_compute_uses_the_blend_and_tracks_what_it_said(hass):
    from types import SimpleNamespace

    from homeassistant.util import dt as dt_util

    history, sun, extra = _two_models(3)
    now = dt_util.utcnow()
    shift = now.replace(minute=0, second=0, microsecond=0) - sorted(history.ghi)[30]

    def moved(weather: fc.Weather) -> fc.Weather:
        return fc.Weather(
            ghi={t + shift: v for t, v in weather.ghi.items()},
            dni={t + shift: v for t, v in weather.dni.items()},
            dhi={t + shift: v for t, v in weather.dhi.items()},
            models={name: moved(model) for name, model in weather.models.items()},
        )

    weather = moved(history)
    sun = {end: fc.sun_position(end - timedelta(minutes=30), LAT, LON) for end in weather.ghi}
    coordinator = SimpleNamespace(
        config_entry=SimpleNamespace(entry_id="abc", data={}),
        data=SimpleNamespace(inverters={}, production_today=None, production_yesterday=4200.0),
    )
    forecast = fc.SolarForecast(hass, coordinator)
    surfaces = [{"label": "Roof", "serials": ["1"], "tilt": 35.0, "azimuth": 180.0}]
    forecast._learned = {"Roof": dict(extra["info"], calibration_days=40)}
    forecast._compute(surfaces, weather, sun, LAT, LON)
    plain = sum(forecast.data.hourly.values())
    forecast._blend = {"weights": {"right": 1.0, "sunny": 0.0}, "humidity": 0.0}
    forecast._compute(surfaces, weather, sun, LAT, LON)
    assert sum(forecast.data.hourly.values()) == pytest.approx(plain / 1.2, rel=0.01)
    assert forecast.data.blend["weights"]["right"] == 1.0
    # The forecast for tomorrow is remembered under tomorrow's date.
    tomorrow = (dt_util.now().date() + timedelta(days=1)).isoformat()
    assert forecast._issued[tomorrow] == forecast.data.tomorrow
    # Yesterday is judged against what was said then, once that is known.
    yesterday = (dt_util.now().date() - timedelta(days=1)).isoformat()
    forecast._issued[yesterday] = 5.0
    forecast._compute(surfaces, weather, sun, LAT, LON)
    assert forecast.data.yesterday == 5.0
    assert forecast.log == [[yesterday, 5.0, 4.2]]
