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
    weather = _weather(5)
    sun = {end: fc.sun_position(end - timedelta(minutes=30), LAT, LON) for end in weather.ghi}
    production = {
        end: 2.0 * fc.plane_irradiance(weather.ghi[end], weather.dni[end], weather.dhi[end], *sun[end], 40, 90)
        for end in weather.ghi
    }
    tilt, azimuth, error = fc.fit_orientation(production, weather, LAT, LON, sun)
    assert azimuth == pytest.approx(90, abs=15)
    assert tilt == pytest.approx(40, abs=10)
    assert error < 0.05
