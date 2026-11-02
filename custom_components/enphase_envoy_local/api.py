"""Small, dependency-free client for the local API of an Enphase IQ Gateway (Envoy).

Only aiohttp (shipped with Home Assistant) is used. The client:

* reads ``/info`` to learn the serial number and firmware version,
* gets an owner token from Enlighten for firmware 7 and newer and renews it
  before it expires,
* reads ``/production.json?details=1`` (plus ``/api/v1/production`` and
  ``/api/v1/production/inverters``) and turns it into an :class:`EnvoyData`.
"""

from __future__ import annotations

import asyncio
import base64
from dataclasses import dataclass, field
from datetime import UTC, datetime
import json
import logging
import re
from typing import Any
import xml.etree.ElementTree as ET

import aiohttp

_LOGGER = logging.getLogger(__name__)

ENLIGHTEN_LOGIN_URL = "https://enlighten.enphaseenergy.com/login/login.json"
ENTREZ_TOKEN_URL = "https://entrez.enphaseenergy.com/tokens"
ENLIGHTEN_URL = "https://enlighten.enphaseenergy.com"

# Enlighten is picky about headers (it answered 406 to custom ones), so the
# token is requested exactly like pyenphase does: a plain aiohttp session.

REQUEST_TIMEOUT = aiohttp.ClientTimeout(total=20)

# Production on/off; the gateway only allows this with an installer token.
POWER_MODE_PATH = "/ivp/mod/603980032/mode/power"


class EnvoyError(Exception):
    """Base error."""


class EnvoyConnectionError(EnvoyError):
    """The gateway (or Enlighten) could not be reached."""


class EnvoyAuthError(EnvoyError):
    """The gateway refused the token."""


class EnlightenAuthError(EnvoyError):
    """Enlighten refused the credentials. Never retried automatically."""


class EnlightenError(EnvoyError):
    """Temporary problem while getting a token from Enlighten."""


@dataclass(slots=True)
class PhaseData:
    """Values for a single phase."""

    power: float | None = None
    voltage: float | None = None
    current: float | None = None
    energy_today: float | None = None
    energy_lifetime: float | None = None


@dataclass(slots=True)
class InverterData:
    """A single microinverter."""

    serial: str
    power: float | None = None
    max_power: float | None = None
    last_report: datetime | None = None
    # /ivp/pdm/device_data (firmware 7.6+ / 8.x)
    dc_voltage: float | None = None
    dc_current: float | None = None
    ac_voltage: float | None = None
    ac_current: float | None = None
    ac_frequency: float | None = None
    temperature: float | None = None
    energy_today: float | None = None
    energy_yesterday: float | None = None
    energy_week: float | None = None
    energy_lifetime: float | None = None
    rssi: float | None = None
    # /inventory.json
    producing: bool | None = None
    communicating: bool | None = None
    phase: str | None = None
    firmware: str | None = None
    part_number: str | None = None
    status: list[str] = field(default_factory=list)
    # Health, compared with the other panels on the same roof surface
    array: str | None = None
    performance: float | None = None
    performance_week: float | None = None
    underperforming: bool | None = None
    no_output: bool | None = None
    # Last efficiency measured in daylight, kept for the evening.
    last_efficiency: float | None = None

    @property
    def dc_power(self) -> float | None:
        """DC input power."""
        if self.dc_voltage is None or self.dc_current is None:
            return None
        return round(self.dc_voltage * self.dc_current, 1)

    @property
    def efficiency(self) -> float | None:
        """AC output / DC input in %, only when there is enough sun to mean anything."""
        dc = self.dc_power
        if dc is None or dc < 10 or self.power is None:
            return None
        return round(max(0.0, min(100.0, self.power / dc * 100)), 1)


@dataclass(slots=True)
class NetworkData:
    """Connection of the gateway to Enlighten (/home.json)."""

    cloud_connected: bool | None = None
    last_report: datetime | None = None
    interface: str | None = None
    wifi_signal: float | None = None


@dataclass(slots=True)
class EnvoyData:
    """Everything read from the gateway in one update."""

    production_power: float | None = None
    production_today: float | None = None
    production_7days: float | None = None
    production_lifetime: float | None = None
    active_inverters: int | None = None
    production_metered: bool = False
    production_phases: list[PhaseData] = field(default_factory=list)

    consumption_metered: bool = False
    consumption_power: float | None = None
    consumption_today: float | None = None
    consumption_lifetime: float | None = None
    consumption_phases: list[PhaseData] = field(default_factory=list)
    net_power: float | None = None
    net_phases: list[PhaseData] = field(default_factory=list)

    # From /ivp/meters/readings (net-consumption CT): grid energy counters.
    grid_import_lifetime: float | None = None
    grid_export_lifetime: float | None = None
    grid_import_today: float | None = None
    grid_export_today: float | None = None
    frequency: float | None = None
    power_factor: float | None = None

    reading_time: datetime | None = None
    inverters: dict[str, InverterData] = field(default_factory=dict)
    network: NetworkData | None = None
    export_limit_enabled: bool | None = None
    production_forced_off: bool | None = None
    raw: dict[str, Any] = field(default_factory=dict)


def _num(value: Any) -> float | None:
    """Return a float or None."""
    if value is None or isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _ts(value: Any) -> datetime | None:
    """Unix timestamp to aware datetime."""
    number = _num(value)
    if not number:
        return None
    return datetime.fromtimestamp(number, tz=UTC)


def token_expiry(token: str | None) -> datetime | None:
    """Read the ``exp`` claim of a JWT without verifying it."""
    if not token or token.count(".") < 2:
        return None
    payload = token.split(".")[1]
    payload += "=" * (-len(payload) % 4)
    try:
        claims = json.loads(base64.urlsafe_b64decode(payload))
    except (ValueError, json.JSONDecodeError):
        return None
    exp = claims.get("exp")
    if not isinstance(exp, (int, float)):
        return None
    return datetime.fromtimestamp(exp, tz=UTC)


def firmware_major(firmware: str | None) -> int | None:
    """'D7.6.175' -> 7."""
    if not firmware:
        return None
    digits = ""
    for char in firmware.lstrip("DRdr"):
        if char.isdigit():
            digits += char
        else:
            break
    return int(digits) if digits else None


def parse_info(xml_text: str) -> dict[str, str | None]:
    """Parse the XML of ``/info``."""
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as err:
        raise EnvoyError(f"Unexpected answer from /info: {err}") from err
    device = root.find("device")
    if device is None:
        raise EnvoyError("No <device> in /info")

    def text(tag: str) -> str | None:
        node = device.find(tag)
        return node.text.strip() if node is not None and node.text else None

    return {
        "serial": text("sn"),
        "part_number": text("pn"),
        "firmware": text("software"),
        "imeter": text("imeter"),
    }


def _today_valid(today: float | None, lifetime: float | None) -> bool:
    """Firmware 8.x reports the lifetime counter as 'today' and 'last 7 days'."""
    if today is None or today < 0:
        return False
    if lifetime is not None and lifetime > 1000 and abs(today - lifetime) < 1:
        return False
    return True


def _phases(lines: Any) -> list[PhaseData]:
    if not isinstance(lines, list):
        return []
    return [
        PhaseData(
            power=_num(line.get("wNow")),
            voltage=_num(line.get("rmsVoltage")),
            current=_num(line.get("rmsCurrent")),
            energy_today=_num(line.get("whToday")),
            energy_lifetime=_num(line.get("whLifetime")),
        )
        for line in lines
        if isinstance(line, dict)
    ]


def parse_production(
    production: dict[str, Any],
    api_v1: dict[str, Any] | None = None,
    inverters: list[dict[str, Any]] | None = None,
    meters: list[dict[str, Any]] | None = None,
    readings: list[dict[str, Any]] | None = None,
) -> EnvoyData:
    """Turn the raw JSON documents into an EnvoyData object."""
    data = EnvoyData(
        raw={
            "production": production,
            "api_v1": api_v1,
            "meters": meters,
            "meter_readings": readings,
        }
    )

    prod_inv: dict[str, Any] = {}
    prod_eim: dict[str, Any] = {}
    for item in production.get("production") or []:
        if not isinstance(item, dict):
            continue
        if item.get("type") == "inverters":
            prod_inv = item
        elif item.get("type") == "eim" and item.get("measurementType", "production") == "production":
            prod_eim = item

    data.active_inverters = (
        int(prod_inv["activeCount"]) if _num(prod_inv.get("activeCount")) is not None else None
    )

    # A production CT is only present when the eim reports an active count.
    data.production_metered = bool(prod_eim) and (_num(prod_eim.get("activeCount")) or 0) > 0

    if data.production_metered:
        data.production_power = _num(prod_eim.get("wNow"))
        data.production_lifetime = _num(prod_eim.get("whLifetime"))
        today = _num(prod_eim.get("whToday"))
        seven = _num(prod_eim.get("whLastSevenDays"))
        if _today_valid(today, data.production_lifetime):
            data.production_today = today
        if _today_valid(seven, data.production_lifetime):
            data.production_7days = seven
        data.production_phases = _phases(prod_eim.get("lines"))
        data.reading_time = _ts(prod_eim.get("readingTime"))
    else:
        data.production_power = _num(prod_inv.get("wNow"))
        data.production_lifetime = _num(prod_inv.get("whLifetime")) or None
        data.reading_time = _ts(prod_inv.get("readingTime"))

    if api_v1 and not data.production_metered:
        if data.production_power is None:
            data.production_power = _num(api_v1.get("wattsNow"))
        if data.production_today is None:
            data.production_today = _num(api_v1.get("wattHoursToday"))
        if data.production_7days is None:
            data.production_7days = _num(api_v1.get("wattHoursSevenDays"))
        if not data.production_lifetime:
            data.production_lifetime = _num(api_v1.get("wattHoursLifetime"))

    # The production CT reads a few watts of noise at night; when the
    # microinverters themselves report nothing, production is zero.
    if (
        data.production_metered
        and _num(prod_inv.get("wNow")) == 0
        and (data.production_power or 0) < 20
    ):
        data.production_power = 0.0
        for phase in data.production_phases:
            if phase.power is not None and phase.power < 20:
                phase.power = 0.0

    # CT readings drift slightly below zero at night.
    if data.production_power is not None and data.production_power < 0:
        data.production_power = 0.0
    for phase in data.production_phases:
        if phase.power is not None and phase.power < 0:
            phase.power = 0.0

    for item in production.get("consumption") or []:
        if not isinstance(item, dict) or (_num(item.get("activeCount")) or 0) <= 0:
            continue
        kind = item.get("measurementType")
        if kind == "total-consumption":
            data.consumption_metered = True
            data.consumption_power = _num(item.get("wNow"))
            data.consumption_lifetime = _num(item.get("whLifetime"))
            today = _num(item.get("whToday"))
            if _today_valid(today, data.consumption_lifetime):
                data.consumption_today = today
            data.consumption_phases = _phases(item.get("lines"))
        elif kind == "net-consumption":
            data.consumption_metered = True
            data.net_power = _num(item.get("wNow"))
            data.net_phases = _phases(item.get("lines"))

    _parse_meters(data, meters, readings)

    for inv in inverters or []:
        if not isinstance(inv, dict) or not inv.get("serialNumber"):
            continue
        serial = str(inv["serialNumber"])
        data.inverters[serial] = InverterData(
            serial=serial,
            power=_num(inv.get("lastReportWatts")),
            max_power=_num(inv.get("maxReportWatts")),
            last_report=_ts(inv.get("lastReportDate")),
        )

    return data


_PHASES = {"ph-a": "L1", "ph-b": "L2", "ph-c": "L3"}


def merge_device_data(data: EnvoyData, device_data: Any) -> None:
    """Add DC/AC values, temperature and energy per microinverter."""
    if not isinstance(device_data, dict):
        return
    for dev in device_data.values():
        if not isinstance(dev, dict) or dev.get("devName") != "pcu" or not dev.get("sn"):
            continue
        if not dev.get("active", True):
            continue
        channels = dev.get("channels") or []
        if not channels or not isinstance(channels[0], dict):
            continue
        chan = channels[0]
        last = chan.get("lastReading") or {}
        watts = chan.get("watts") or {}
        wh = chan.get("wattHours") or {}
        lifetime = (chan.get("lifetime") or {}).get("joulesProduced")
        serial = str(dev["sn"])
        inv = data.inverters.setdefault(serial, InverterData(serial=serial))

        def milli(key: str) -> float | None:
            value = _num(last.get(key))
            return None if value is None else round(value / 1000, 3)

        if watts.get("now") is not None:
            inv.power = _num(watts.get("now"))
        if watts.get("max") is not None:
            inv.max_power = _num(watts.get("max"))
        if last.get("endDate"):
            inv.last_report = _ts(last.get("endDate"))
        inv.dc_voltage = milli("dcVoltageINmV")
        inv.dc_current = milli("dcCurrentINmA")
        inv.ac_voltage = milli("acVoltageINmV")
        inv.ac_current = milli("acCurrentInmA")
        inv.ac_frequency = milli("acFrequencyINmHz")
        inv.temperature = _num(last.get("channelTemp"))
        inv.rssi = _num(last.get("rssi"))
        inv.energy_today = _num(wh.get("today"))
        inv.energy_yesterday = _num(wh.get("yesterday"))
        inv.energy_week = _num(wh.get("week"))
        if _num(lifetime) is not None:
            inv.energy_lifetime = round(float(lifetime) / 3600, 1)


def merge_inventory(data: EnvoyData, inventory: dict[str, dict[str, Any]]) -> None:
    """Add producing/communicating, phase and firmware per microinverter."""
    for serial, info in inventory.items():
        if info.get("type") != "PCU":
            continue
        inv = data.inverters.get(serial)
        if inv is None:
            continue
        inv.producing = info.get("producing")
        inv.communicating = info.get("communicating")
        inv.phase = _PHASES.get(str(info.get("phase")), info.get("phase"))
        inv.firmware = info.get("firmware")
        inv.part_number = info.get("part_number")
        inv.status = info.get("status") or []


def parse_home(home: Any) -> NetworkData | None:
    """Connection info from /home.json."""
    if not isinstance(home, dict):
        return None
    net = home.get("network") or {}
    out = NetworkData(
        cloud_connected=net.get("web_comm"),
        last_report=_ts(net.get("last_enlighten_report_time")),
        interface=net.get("primary_interface"),
    )
    for iface in net.get("interfaces") or []:
        if not isinstance(iface, dict):
            continue
        if iface.get("interface") == out.interface:
            if iface.get("type") == "wifi" and iface.get("signal_strength_max"):
                out.wifi_signal = round(
                    100 * _num(iface.get("signal_strength")) / _num(iface.get("signal_strength_max"))
                )
            out.interface = {
                "ethernet": "ethernet",
                "wifi": "wifi",
                "cellular": "cellular",
            }.get(str(iface.get("type")), out.interface)
    return out


def parse_layout(raw: Any) -> dict[str, Any] | None:
    """Turn Enlighten's site_array_layout_x into absolute panel positions.

    Module x/y are offsets from the centre of their array; a panel is
    100 x 200 units, lying down (200 x 100) when rotated 90 or 270 degrees.
    """
    if not isinstance(raw, dict) or not isinstance(raw.get("arrays"), list):
        return None
    arrays = []
    for arr in raw["arrays"]:
        if not isinstance(arr, dict):
            continue
        ax, ay = _num(arr.get("x")) or 0.0, _num(arr.get("y")) or 0.0
        modules = []
        for mod in arr.get("modules") or []:
            if not isinstance(mod, dict):
                continue
            serial = (mod.get("inverter") or {}).get("serial_num")
            rotation = int(_num(mod.get("rotation")) or 0) % 360
            landscape = rotation in (90, 270)
            modules.append(
                {
                    "serial": str(serial) if serial else None,
                    "x": ax + (_num(mod.get("x")) or 0.0),
                    "y": ay + (_num(mod.get("y")) or 0.0),
                    "w": 200 if landscape else 100,
                    "h": 100 if landscape else 200,
                }
            )
        if modules:
            arrays.append(
                {
                    "label": arr.get("label") or "",
                    "azimuth": _num(arr.get("azimuth")),
                    "tilt": _num(arr.get("tilt")),
                    "modules": modules,
                }
            )
    if not arrays:
        return None
    return {"system_id": raw.get("system_id"), "arrays": arrays}


def parse_inventory(inventory: Any) -> dict[str, dict[str, Any]]:
    """Index /inventory.json by serial number."""
    out: dict[str, dict[str, Any]] = {}
    if not isinstance(inventory, list):
        return out
    for group in inventory:
        if not isinstance(group, dict):
            continue
        kind = group.get("type")
        for dev in group.get("devices") or []:
            if not isinstance(dev, dict) or not dev.get("serial_num"):
                continue
            status = dev.get("device_status") or []
            out[str(dev["serial_num"])] = {
                "type": kind,
                "part_number": dev.get("part_num"),
                "firmware": dev.get("img_pnum_running"),
                "producing": dev.get("producing"),
                "communicating": dev.get("communicating"),
                "provisioned": dev.get("provisioned"),
                "operating": dev.get("operating"),
                "status": [str(x) for x in status] if isinstance(status, list) else [],
                "phase": dev.get("phase"),
                "model": "IQ Microinverter" if kind == "PCU" else None,
            }
    return out


def _power_factor(reading: dict[str, Any]) -> float | None:
    """Power factor of a three-phase meter as active / apparent power.

    The gateway's own ``pwrFactor`` for the whole meter is the *sum* of the
    per-phase power factors (it can exceed 1), so it is recalculated here from
    the total powers. The apparent power is summed per phase when channels are
    present, which is the correct total for an unbalanced three-phase load.
    """
    channels = [c for c in reading.get("channels") or [] if isinstance(c, dict)]
    if channels:
        active = sum(_num(c.get("activePower")) or 0.0 for c in channels)
        apparent = sum(_num(c.get("apparentPower")) or 0.0 for c in channels)
    else:
        active = _num(reading.get("activePower")) or 0.0
        apparent = _num(reading.get("apparentPower")) or 0.0
    if apparent < 1:
        return None
    return round(min(abs(active) / apparent, 1.0), 3)


def _parse_meters(
    data: EnvoyData,
    meters: list[dict[str, Any]] | None,
    readings: list[dict[str, Any]] | None,
) -> None:
    """Grid import/export from the net-consumption meter (firmware 7+)."""
    if not meters or not readings:
        return
    kinds = {
        m.get("eid"): m.get("measurementType")
        for m in meters
        if isinstance(m, dict) and m.get("state") == "enabled"
    }
    for reading in readings:
        if not isinstance(reading, dict):
            continue
        kind = kinds.get(reading.get("eid"))
        if kind == "net-consumption":
            # Delivered = taken from the grid, received = fed into the grid.
            data.grid_import_lifetime = _num(reading.get("actEnergyDlvd"))
            data.grid_export_lifetime = _num(reading.get("actEnergyRcvd"))
            data.frequency = _num(reading.get("freq"))
            data.power_factor = _power_factor(reading)
        elif kind == "production" and data.frequency is None:
            data.frequency = _num(reading.get("freq"))


class EnvoyClient:
    """Talks to one gateway."""

    def __init__(
        self,
        envoy_session: aiohttp.ClientSession,
        web_session: aiohttp.ClientSession | None,
        host: str,
        *,
        serial: str | None = None,
        firmware: str | None = None,
        username: str | None = None,
        password: str | None = None,
        token: str | None = None,
    ) -> None:
        """Set up the client.

        ``envoy_session`` must not verify SSL: the gateway uses a self-signed
        certificate. ``web_session`` is used for Enlighten; when None a short-lived plain
        aiohttp session is created for each token request.
        """
        self._envoy = envoy_session
        self._web = web_session
        self.host = host.strip().rstrip("/")
        self.serial = serial
        self.firmware = firmware
        self.username = username or None
        self.password = password or None
        self.token = token or None
        self._scheme: str | None = None
        # Some endpoints (production on/off) only accept the session cookie
        # that /auth/check_jwt hands out, not just the bearer token.
        self._cookies: dict[str, str] = {}
        self._cookie_token: str | None = None

    # ------------------------------------------------------------------ info
    @property
    def requires_token(self) -> bool:
        """Firmware 7 and newer need a token."""
        major = firmware_major(self.firmware)
        return major is None or major >= 7

    @property
    def has_credentials(self) -> bool:
        """Whether a new token can be requested."""
        return bool(self.username and self.password and self.serial)

    @property
    def token_expires(self) -> datetime | None:
        """When the current token expires."""
        return token_expiry(self.token)

    async def async_get_info(self) -> dict[str, str | None]:
        """Read /info (no authentication needed) and remember serial/firmware."""
        last_err: Exception | None = None
        schemes = [self._scheme] if self._scheme else ["https", "http"]
        for scheme in schemes:
            try:
                async with self._envoy.get(
                    f"{scheme}://{self.host}/info", timeout=REQUEST_TIMEOUT
                ) as resp:
                    if resp.status != 200:
                        last_err = EnvoyError(f"/info returned HTTP {resp.status}")
                        continue
                    info = parse_info(await resp.text())
            except (aiohttp.ClientError, asyncio.TimeoutError) as err:
                last_err = err
                continue
            self._scheme = scheme
            self.serial = info["serial"] or self.serial
            self.firmware = info["firmware"] or self.firmware
            return info
        raise EnvoyConnectionError(
            f"Cannot reach the gateway at {self.host}: {last_err}"
        ) from last_err

    # ----------------------------------------------------------------- token
    async def async_fetch_token(self) -> str:
        """Get a new owner token from Enlighten."""
        if not self.has_credentials:
            raise EnlightenAuthError("No Enlighten e-mail/password configured")
        if self._web is not None:
            return await self._fetch_token(self._web)
        async with aiohttp.ClientSession(timeout=REQUEST_TIMEOUT) as session:
            return await self._fetch_token(session)

    async def async_fetch_layout(
        self, serials: set[str], system_id: str | None = None
    ) -> dict[str, Any] | None:
        """Get the panel layout (array layout) from Enlighten.

        Logs in with the Enlighten account, finds the system that holds these
        microinverters and returns parse_layout() of it. Returns None when the
        account has no layout for them.
        """
        if not self.has_credentials:
            return None
        async with aiohttp.ClientSession(timeout=REQUEST_TIMEOUT) as web:
            try:
                async with web.post(
                    ENLIGHTEN_LOGIN_URL,
                    data={"user[email]": self.username, "user[password]": self.password},
                ) as resp:
                    login_text = await resp.text()
                    try:
                        login_json = json.loads(login_text)
                    except json.JSONDecodeError:
                        login_json = {}
                    _LOGGER.debug("Layout login: HTTP %s", resp.status)
                    if resp.status != 200:
                        raise EnlightenError(f"Enlighten login returned HTTP {resp.status}")
                system_id = system_id or login_json.get("system_id")
                xhr = {
                    "Accept": "application/json, text/plain, */*",
                    "X-Requested-With": "XMLHttpRequest",
                }
                if login_json.get("manager_token"):
                    xhr["e-auth-token"] = str(login_json["manager_token"])
                candidates = [str(system_id)] if system_id else []
                if not candidates:
                    # Installer accounts: find the systems on the landing page.
                    async with web.get(f"{ENLIGHTEN_URL}/") as resp:
                        html = await resp.text()
                        landing = str(resp.url)
                    found = re.findall(r"/(?:systems|web)/(\d{4,})", landing + " " + html)
                    candidates = list(dict.fromkeys(found))[:10]
                    _LOGGER.debug("Layout: systems found %s", candidates)
                for candidate in candidates:
                    layout = await self._layout_of(web, candidate, xhr)
                    if layout is None:
                        continue
                    found_serials = {
                        m["serial"]
                        for a in layout["arrays"]
                        for m in a["modules"]
                        if m["serial"]
                    }
                    if not serials or found_serials & serials:
                        layout["system_id"] = layout.get("system_id") or candidate
                        layout["models"] = await self._models_of(web, candidate, xhr)
                        return layout
            except (aiohttp.ClientError, asyncio.TimeoutError) as err:
                raise EnlightenError(f"Enlighten unreachable: {err}") from err
        return None

    async def _layout_of(
        self, web: aiohttp.ClientSession, system: str, headers: dict[str, str]
    ) -> dict[str, Any] | None:
        """Owner accounts use /pv/..., installer accounts /systems/..."""
        for url in (
            f"{ENLIGHTEN_URL}/pv/systems/{system}/array_layout_x.json",
            f"{ENLIGHTEN_URL}/systems/{system}/site_array_layout_x",
        ):
            async with web.get(url, headers=headers) as resp:
                body = await resp.text()
            _LOGGER.debug("Layout %s: HTTP %s", url, resp.status)
            if resp.status != 200:
                continue
            try:
                layout = parse_layout(json.loads(body))
            except json.JSONDecodeError:
                continue
            if layout is not None:
                return layout
        return None

    async def _models_of(
        self, web: aiohttp.ClientSession, system: str, headers: dict[str, str]
    ) -> dict[str, str]:
        """Microinverter type per serial (IQ7+, IQ8M, ...)."""
        url = f"{ENLIGHTEN_URL}/service/array-builder/api/view/{system}/inverter-status"
        try:
            async with web.get(url, headers=headers) as resp:
                if resp.status != 200:
                    return {}
                raw = json.loads(await resp.text())
        except (aiohttp.ClientError, asyncio.TimeoutError, json.JSONDecodeError):
            return {}
        if not isinstance(raw, dict):
            return {}
        return {
            str(v["serialNum"]): str(v["type"])
            for v in raw.values()
            if isinstance(v, dict) and v.get("serialNum") and v.get("type")
        }

    async def _fetch_token(self, web: aiohttp.ClientSession) -> str:
        try:
            async with web.post(
                ENLIGHTEN_LOGIN_URL,
                data={"user[email]": self.username, "user[password]": self.password},
                timeout=REQUEST_TIMEOUT,
            ) as resp:
                text = await resp.text()
                status = resp.status
        except (aiohttp.ClientError, asyncio.TimeoutError) as err:
            raise EnlightenError(f"Enlighten unreachable: {err}") from err

        try:
            login = json.loads(text)
        except json.JSONDecodeError:
            login = {}
        if not isinstance(login, dict):
            login = {}
        message = str(login.get("message") or text[:120]).strip()
        _LOGGER.debug("Enlighten login: HTTP %s, keys %s", status, sorted(login))

        if status == 401 or "invalid" in message.lower():
            raise EnlightenAuthError(
                f"Enlighten rejected the e-mail or password (HTTP {status}: {message})"
            )
        if login.get("isBlocked"):
            raise EnlightenAuthError("The Enlighten account is blocked")
        if status >= 500 or status in (403, 406, 408, 429):
            raise EnlightenError(f"Enlighten login returned HTTP {status}: {message}")
        session_id = login.get("session_id")
        if status == 200 and not session_id:
            raise EnlightenAuthError(
                "Enlighten gave no session; the account probably uses "
                "two-factor authentication - paste a token instead"
            )
        if status != 200:
            raise EnlightenError(f"Enlighten login returned HTTP {status}: {message}")

        try:
            async with web.post(
                ENTREZ_TOKEN_URL,
                json={
                    "session_id": session_id,
                    "serial_num": self.serial,
                    "username": self.username,
                },
                timeout=REQUEST_TIMEOUT,
            ) as resp:
                token = (await resp.text()).strip()
                status = resp.status
        except (aiohttp.ClientError, asyncio.TimeoutError) as err:
            raise EnlightenError(f"Enphase token server unreachable: {err}") from err

        if status in (400, 401, 403, 404):
            raise EnlightenAuthError(
                "Enphase did not issue a token for this serial number "
                f"(HTTP {status}); is the gateway linked to this account?"
            )
        if status != 200 or token.count(".") < 2:
            raise EnlightenError(f"Enphase token server returned HTTP {status}")
        self.token = token
        return token

    # ------------------------------------------------------------------ data
    def _headers(self, accept: str = "application/json") -> dict[str, str]:
        headers = {"Accept": accept}
        if self.token and self.requires_token:
            headers["Authorization"] = f"Bearer {self.token}"
            if self._cookies and self._cookie_token == self.token:
                headers["Cookie"] = "; ".join(
                    f"{k}={v}" for k, v in self._cookies.items()
                )
        return headers

    async def async_check_jwt(self) -> bool:
        """Validate the token on the gateway and keep its session cookie."""
        if not (self.token and self.requires_token):
            return True
        if self._scheme is None:
            self._scheme = "https"
        try:
            async with self._envoy.get(
                f"{self._scheme}://{self.host}/auth/check_jwt",
                headers={"Authorization": f"Bearer {self.token}"},
                timeout=REQUEST_TIMEOUT,
            ) as resp:
                if resp.status != 200:
                    return False
                self._cookies = {k: v.value for k, v in resp.cookies.items()}
                self._cookie_token = self.token
                return True
        except (aiohttp.ClientError, asyncio.TimeoutError) as err:
            raise EnvoyConnectionError(f"/auth/check_jwt: {err}") from err

    async def _request(self, method: str, path: str, payload: Any = None) -> Any:
        """Send JSON to the gateway (PUT/POST) and return the JSON answer."""
        if self.requires_token and self._cookie_token != self.token:
            await self.async_check_jwt()
        url = f"{self._scheme or 'https'}://{self.host}{path}"
        try:
            async with self._envoy.request(
                method, url, headers=self._headers(), json=payload, timeout=REQUEST_TIMEOUT
            ) as resp:
                text = await resp.text()
                if resp.status in (401, 403):
                    raise EnvoyAuthError(f"{path}: HTTP {resp.status}")
                if resp.status not in (200, 201, 204):
                    raise EnvoyError(f"{path}: HTTP {resp.status} {text[:200]}")
        except (aiohttp.ClientError, asyncio.TimeoutError) as err:
            raise EnvoyConnectionError(f"{path}: {err}") from err
        try:
            return json.loads(text) if text.strip() else None
        except json.JSONDecodeError:
            return text

    async def _get(self, path: str) -> Any:
        """GET JSON from the gateway."""
        if self._scheme is None:
            self._scheme = "https" if self.requires_token else "http"
        headers = self._headers()
        url = f"{self._scheme}://{self.host}{path}"
        try:
            async with self._envoy.get(
                url, headers=headers, timeout=REQUEST_TIMEOUT
            ) as resp:
                if resp.status in (401, 403):
                    raise EnvoyAuthError(f"{path}: HTTP {resp.status}")
                if resp.status != 200:
                    raise EnvoyError(f"{path}: HTTP {resp.status}")
                text = await resp.text()
        except (aiohttp.ClientError, asyncio.TimeoutError) as err:
            raise EnvoyConnectionError(f"{path}: {err}") from err
        try:
            return json.loads(text)
        except json.JSONDecodeError as err:
            raise EnvoyError(f"{path}: no JSON in answer") from err

    async def async_get_production(self) -> dict[str, Any]:
        """Read /production.json?details=1."""
        result = await self._get("/production.json?details=1")
        if not isinstance(result, dict):
            raise EnvoyError("/production.json: unexpected answer")
        return result

    async def async_get_api_v1(self) -> dict[str, Any] | None:
        """Read /api/v1/production; not every firmware has it."""
        try:
            result = await self._get("/api/v1/production")
        except EnvoyError as err:
            # production.json decides about auth; this one is only extra.
            _LOGGER.debug("/api/v1/production unavailable: %s", err)
            return None
        return result if isinstance(result, dict) else None

    async def async_probe(self, paths: list[str]) -> dict[str, Any]:
        """GET a list of endpoints and report status and a short sample.

        Read-only; used by diagnostics to see what this gateway/token allows.
        """
        result: dict[str, Any] = {}
        try:
            result["/auth/check_jwt"] = {
                "ok": await self.async_check_jwt(),
                "cookies": sorted(self._cookies),
            }
        except EnvoyError as err:
            result["/auth/check_jwt"] = {"error": str(err)}
        headers = self._headers()
        for path in paths:
            try:
                async with self._envoy.get(
                    f"{self._scheme or 'https'}://{self.host}{path}",
                    headers=headers,
                    timeout=REQUEST_TIMEOUT,
                ) as resp:
                    text = await resp.text()
                    result[path] = {"status": resp.status, "sample": text[:2500]}
            except (aiohttp.ClientError, asyncio.TimeoutError) as err:
                result[path] = {"error": str(err)}
        return result

    async def async_get_optional(self, path: str) -> Any:
        """GET an endpoint that not every gateway or token supports."""
        try:
            return await self._get(path)
        except EnvoyError as err:
            _LOGGER.debug("%s unavailable: %s", path, err)
            return None

    async def async_get_production_mode(self) -> bool | None:
        """True when production is forced off; None when the token may not read it."""
        if self.requires_token and self._cookie_token != self.token:
            await self.async_check_jwt()
        result = await self.async_get_optional(POWER_MODE_PATH)
        if not isinstance(result, dict) or "powerForcedOff" not in result:
            return None
        return bool(result["powerForcedOff"])

    async def async_set_production(self, enabled: bool) -> None:
        """Stop (forced off) or resume production of all microinverters."""
        await self._request(
            "PUT", POWER_MODE_PATH, {"length": 1, "arr": [0 if enabled else 1]}
        )

    async def async_get_inventory(self) -> dict[str, dict[str, Any]] | None:
        """Read /inventory.json: part number, firmware and status per device."""
        try:
            result = await self._get("/inventory.json")
        except EnvoyError as err:
            _LOGGER.debug("Inventory unavailable: %s", err)
            return None
        return parse_inventory(result)

    async def async_get_meters(
        self,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]] | None:
        """Read /ivp/meters and /ivp/meters/readings (metered gateways only)."""
        try:
            meters = await self._get("/ivp/meters")
            readings = await self._get("/ivp/meters/readings")
        except EnvoyError as err:
            _LOGGER.debug("Meter readings unavailable: %s", err)
            return None
        if not isinstance(meters, list) or not isinstance(readings, list):
            return None
        return meters, readings

    async def async_get_inverters(self) -> list[dict[str, Any]] | None:
        """Read /api/v1/production/inverters."""
        try:
            result = await self._get("/api/v1/production/inverters")
        except EnvoyError as err:
            _LOGGER.debug("Microinverter data unavailable: %s", err)
            return None
        return result if isinstance(result, list) else None
