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
    west = [v for k, v in shade.items() if int(k.split("_")[0]) * fc.SHADE_AZ >= 255]
    south = shade.get(fc.shade_cell(55, 180), 1.0)
    assert west and max(west) < 0.8
    assert south > 0.95
