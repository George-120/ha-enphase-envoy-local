"""Tests for the gateway client (no Home Assistant needed)."""

from __future__ import annotations

import asyncio
import importlib.util
import json
import pathlib
import sys

import pytest

from .fixtures import (
    API_V1,
    INFO_XML,
    INFO_XML_V5,
    INVERTERS,
    PRODUCTION_METERED,
    PRODUCTION_NOT_METERED,
    SERIAL,
    make_token,
)

_PATH = pathlib.Path(__file__).parents[1] / "custom_components/enphase_envoy_local/api.py"
_spec = importlib.util.spec_from_file_location("envoy_local_api", _PATH)
api = importlib.util.module_from_spec(_spec)
sys.modules["envoy_local_api"] = api
_spec.loader.exec_module(api)


class FakeResponse:
    def __init__(self, status: int, body):
        self.status = status
        self._body = body if isinstance(body, str) else json.dumps(body)

    async def text(self):
        return self._body

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


class FakeSession:
    """Routes 'METHOD url' to (status, body) or an exception."""

    def __init__(self, routes: dict):
        self.routes = routes
        self.calls: list[tuple[str, str, dict]] = []

    def _do(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        for key, value in self.routes.items():
            if f"{method} {url}".startswith(key):
                if isinstance(value, Exception):
                    raise value
                return FakeResponse(*value)
        raise api.aiohttp.ClientConnectionError(f"no route {method} {url}")

    def get(self, url, **kwargs):
        return self._do("GET", url, **kwargs)

    def post(self, url, **kwargs):
        return self._do("POST", url, **kwargs)


def run(coro):
    return asyncio.run(coro)


def test_parse_metered():
    data = api.parse_production(PRODUCTION_METERED, API_V1, INVERTERS)
    assert data.production_metered
    assert data.production_power == pytest.approx(3012.4)
    assert data.production_today == 8123.0
    assert data.production_lifetime == 12345678.0
    assert data.active_inverters == 16
    assert [round(p.voltage, 1) for p in data.production_phases] == [230.1, 230.4, 230.1]
    assert data.consumption_metered
    assert data.consumption_power == 812.0
    assert data.net_power == pytest.approx(-2200.4)
    assert len(data.net_phases) == 3
    assert set(data.inverters) == {"482211000001", "482211000002"}
    assert data.inverters["482211000001"].power == 188
    assert data.reading_time.timestamp() == 1793650010


def test_parse_not_metered_uses_inverters_and_api_v1():
    data = api.parse_production(PRODUCTION_NOT_METERED, API_V1)
    assert not data.production_metered
    assert not data.consumption_metered
    assert data.production_power == 0.0  # -3 clamped
    assert data.production_lifetime == 5000000
    assert data.production_today == 7000
    assert data.production_7days == 50000
    assert data.production_phases == []
    assert data.consumption_power is None


def test_parse_info_and_firmware():
    info = api.parse_info(INFO_XML)
    assert info["serial"] == SERIAL
    assert info["firmware"] == "D8.2.4382"
    assert api.firmware_major("D8.2.4382") == 8
    assert api.firmware_major("R5.0.62") == 5
    assert api.firmware_major("7.6.175") == 7
    assert api.firmware_major(None) is None


def test_token_expiry():
    token = make_token(3600)
    exp = api.token_expiry(token)
    assert exp is not None
    assert api.token_expiry("not-a-token") is None
    assert api.token_expiry(None) is None


def test_info_falls_back_to_http():
    envoy = FakeSession({"GET http://1.2.3.4/info": (200, INFO_XML_V5)})
    client = api.EnvoyClient(envoy, FakeSession({}), "1.2.3.4")
    info = run(client.async_get_info())
    assert info["serial"] == SERIAL
    assert not client.requires_token
    run_prod = FakeSession({"GET http://1.2.3.4/production.json": (200, PRODUCTION_NOT_METERED)})
    client._envoy = run_prod
    run(client.async_get_production())
    assert "Authorization" not in run_prod.calls[0][2]["headers"]


def test_fetch_token_and_read():
    token = make_token()
    web = FakeSession(
        {
            "POST https://enlighten.enphaseenergy.com/login/login.json": (
                200,
                {"message": "success", "session_id": "abc"},
            ),
            "POST https://entrez.enphaseenergy.com/tokens": (200, token),
        }
    )
    envoy = FakeSession(
        {
            "GET https://10.0.0.5/info": (200, INFO_XML),
            "GET https://10.0.0.5/production.json": (200, PRODUCTION_METERED),
        }
    )
    client = api.EnvoyClient(envoy, web, "10.0.0.5", username="a@b.nl", password="pw")
    run(client.async_get_info())
    assert client.requires_token and client.has_credentials
    assert run(client.async_fetch_token()) == token
    entrez = web.calls[1][2]["json"]
    assert entrez == {"session_id": "abc", "serial_num": SERIAL, "username": "a@b.nl"}
    run(client.async_get_production())
    assert envoy.calls[-1][2]["headers"]["Authorization"] == f"Bearer {token}"


@pytest.mark.parametrize(
    ("status", "body", "error"),
    [
        (401, {"message": "Invalid email or password"}, "EnlightenAuthError"),
        (200, {"message": "success", "requires_mfa": True}, "EnlightenAuthError"),
        (503, "down", "EnlightenError"),
    ],
)
def test_login_errors(status, body, error):
    web = FakeSession({"POST https://enlighten.enphaseenergy.com": (status, body)})
    client = api.EnvoyClient(FakeSession({}), web, "h", serial=SERIAL, username="u", password="p")
    with pytest.raises(getattr(api, error)):
        run(client.async_fetch_token())


def test_wrong_serial_is_auth_error():
    web = FakeSession(
        {
            "POST https://enlighten.enphaseenergy.com": (200, {"message": "success", "session_id": "s"}),
            "POST https://entrez.enphaseenergy.com": (403, "forbidden"),
        }
    )
    client = api.EnvoyClient(FakeSession({}), web, "h", serial=SERIAL, username="u", password="p")
    with pytest.raises(api.EnlightenAuthError):
        run(client.async_fetch_token())


def test_envoy_401_and_optional_endpoints():
    envoy = FakeSession(
        {
            "GET https://h/production.json": (401, ""),
            "GET https://h/api/v1/production/inverters": (401, ""),
            "GET https://h/api/v1/production": (404, ""),
        }
    )
    client = api.EnvoyClient(envoy, FakeSession({}), "h", firmware="D8.2.1", token=make_token())
    with pytest.raises(api.EnvoyAuthError):
        run(client.async_get_production())
    assert run(client.async_get_api_v1()) is None
    assert run(client.async_get_inverters()) is None


def test_unreachable():
    client = api.EnvoyClient(FakeSession({}), FakeSession({}), "h")
    with pytest.raises(api.EnvoyConnectionError):
        run(client.async_get_info())


DEVICE_DATA = {
    "553648384": {
        "devName": "pcu",
        "sn": "482211000001",
        "active": True,
        "channels": [
            {
                "wattHours": {"today": 262, "yesterday": 153, "week": 2263},
                "watts": {"now": 280, "max": 295},
                "lastReading": {
                    "endDate": 1793635986,
                    "duration": 300,
                    "acVoltageINmV": 237472,
                    "acFrequencyINmHz": 49977,
                    "dcVoltageINmV": 31199,
                    "dcCurrentINmA": 9500,
                    "acCurrentInmA": 1180,
                    "channelTemp": 31,
                    "rssi": 0,
                },
                "lifetime": {"joulesProduced": 5701367190},
            }
        ],
    },
    "deviceCount": 1,
}

INVENTORY = [
    {
        "type": "PCU",
        "devices": [
            {
                "part_num": "800-00631-r02",
                "serial_num": "482211000001",
                "device_status": ["envoy.global.ok"],
                "img_pnum_running": "520-00082-r01-v04.30.32",
                "producing": True,
                "communicating": True,
                "phase": "ph-c",
            }
        ],
    }
]


def test_device_data_efficiency_and_inventory():
    data = api.parse_production(PRODUCTION_METERED, None, INVERTERS)
    api.merge_device_data(data, DEVICE_DATA)
    api.merge_inventory(data, api.parse_inventory(INVENTORY))
    inv = data.inverters["482211000001"]
    assert inv.power == 280
    assert inv.dc_voltage == pytest.approx(31.199)
    assert inv.dc_current == pytest.approx(9.5)
    assert inv.dc_power == pytest.approx(296.4, abs=0.1)
    assert inv.efficiency == pytest.approx(94.5, abs=0.1)
    assert inv.ac_voltage == pytest.approx(237.472)
    assert inv.temperature == 31
    assert inv.energy_today == 262
    assert inv.energy_lifetime == pytest.approx(1583713.1, abs=0.1)
    assert inv.phase == "L3"
    assert inv.firmware == "520-00082-r01-v04.30.32"
    assert inv.producing is True


def test_efficiency_needs_sun():
    inv = api.InverterData(serial="x", power=0, dc_voltage=31.2, dc_current=0.008)
    assert inv.efficiency is None


def test_firmware8_today_is_lifetime():
    prod = {
        "production": [
            {"type": "eim", "activeCount": 1, "measurementType": "production",
             "wNow": 0, "whLifetime": 6081286.4, "whToday": 6081286.4,
             "whLastSevenDays": 6081286.4, "lines": []}
        ]
    }
    data = api.parse_production(prod)
    assert data.production_lifetime == 6081286.4
    assert data.production_today is None
    assert data.production_7days is None


def test_meters_grid_import_export():
    meters = [
        {"eid": 1, "state": "enabled", "measurementType": "production"},
        {"eid": 2, "state": "enabled", "measurementType": "net-consumption"},
    ]
    readings = [
        {"eid": 1, "actEnergyDlvd": 6081286.0, "freq": 50.01},
        {"eid": 2, "actEnergyDlvd": 4091637.8, "actEnergyRcvd": 3492825.6, "freq": 50.0, "pwrFactor": 0.73},
    ]
    data = api.parse_production(PRODUCTION_METERED, None, None, meters, readings)
    assert data.grid_import_lifetime == pytest.approx(4091637.8)
    assert data.grid_export_lifetime == pytest.approx(3492825.6)
    assert data.frequency == 50.0
    assert data.power_factor is None  # no power readings


def test_power_factor_from_active_and_apparent_power():
    # Real readings: the gateway reports pwrFactor 0.497, the sum of the phases.
    meters = [{"eid": 2, "state": "enabled", "measurementType": "net-consumption"}]
    readings = [{
        "eid": 2, "activePower": 102.534, "apparentPower": 476.776, "pwrFactor": 0.497,
        "channels": [
            {"activePower": 93.118, "apparentPower": 238.173, "pwrFactor": 0.375},
            {"activePower": 6.13, "apparentPower": 131.539, "pwrFactor": 0.055},
            {"activePower": 4.679, "apparentPower": 110.379, "pwrFactor": 0.066},
        ],
    }]
    data = api.parse_production(PRODUCTION_METERED, None, None, meters, readings)
    assert data.power_factor == pytest.approx(0.216, abs=0.001)
    # Exporting gives a negative active power; the factor stays positive.
    readings[0]["channels"] = [{"activePower": -900, "apparentPower": 1000}]
    data = api.parse_production(PRODUCTION_METERED, None, None, meters, readings)
    assert data.power_factor == pytest.approx(0.9)


def test_parse_home():
    net = api.parse_home(
        {
            "network": {
                "web_comm": True,
                "last_enlighten_report_time": 1793647094,
                "primary_interface": "eth0",
                "interfaces": [{"type": "ethernet", "interface": "eth0"}],
            }
        }
    )
    assert net.cloud_connected is True
    assert net.interface == "ethernet"
    assert net.wifi_signal is None


_HPATH = pathlib.Path(__file__).parents[1] / "custom_components/enphase_envoy_local/health.py"
_hsrc = _HPATH.read_text().replace("from .api import EnvoyData", "from envoy_local_api import EnvoyData")
health = type(sys)("envoy_local_health")
exec(compile(_hsrc, str(_HPATH), "exec"), health.__dict__)


def _inv(serial, today, week, power):
    return api.InverterData(serial=serial, energy_today=today, energy_week=week, power=power)


def test_health_flags_weak_panel_on_same_roof():
    data = api.EnvoyData()
    for n, (today, week, power) in enumerate(
        [(900, 6000, 200), (880, 5900, 198), (910, 6100, 205), (700, 4800, 150), (890, 6050, 0)]
    ):
        data.inverters[str(n)] = _inv(str(n), today, week, power)
    layout = {"arrays": [{"label": "Roof", "modules": [{"serial": str(n)} for n in range(5)]}]}
    health.apply_health(data, layout, 90)
    weak, dead, good = data.inverters["3"], data.inverters["4"], data.inverters["0"]
    assert weak.array == "Roof"
    assert weak.performance_week == pytest.approx(80.0, abs=0.1)
    assert weak.underperforming is True
    assert good.underperforming is False
    assert dead.no_output is True
    assert good.no_output is False


def test_health_waits_for_the_sun():
    data = api.EnvoyData()
    for n in range(4):
        data.inverters[str(n)] = _inv(str(n), 20, 300, 2)
    health.apply_health(data, None, 90)
    assert all(i.performance is None and i.no_output is False for i in data.inverters.values())


def test_night_noise_on_production_ct_is_zero():
    prod = {
        "production": [
            {"type": "inverters", "activeCount": 22, "wNow": 0, "whLifetime": 0},
            {"type": "eim", "activeCount": 1, "measurementType": "production", "wNow": 6.9,
             "whLifetime": 6081286.0, "lines": [{"wNow": 6.9}, {"wNow": 0}, {"wNow": 0}]},
        ]
    }
    data = api.parse_production(prod)
    assert data.production_power == 0.0
    assert data.production_phases[0].power == 0.0
