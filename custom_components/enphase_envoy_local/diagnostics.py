"""Diagnostics for Enphase Envoy Local."""

from __future__ import annotations

from typing import Any

from homeassistant.components.diagnostics import async_redact_data
from homeassistant.const import CONF_PASSWORD, CONF_USERNAME
from homeassistant.core import HomeAssistant

from .const import CONF_TOKEN
from .coordinator import EnvoyConfigEntry

TO_REDACT = {CONF_PASSWORD, CONF_USERNAME, CONF_TOKEN}

PROBE_PATHS = [
    "/ivp/mod/603980032/mode/power",
    "/ivp/pdm/device_data",
    "/ivp/ss/pel_settings",
    "/ivp/ss/dpel",
    "/ivp/ss/gen_config",
    "/ivp/ensemble/inventory",
    "/ivp/ensemble/status",
    "/inventory.json",
    "/home.json",
    "/ivp/meters",
    "/ivp/livedata/status",
    "/admin/lib/tariff",
    "/ivp/arf/profile",
    "/installer/agf/details.json",
]


async def async_get_config_entry_diagnostics(
    hass: HomeAssistant, entry: EnvoyConfigEntry
) -> dict[str, Any]:
    """Return diagnostics for a config entry."""
    coordinator = entry.runtime_data
    client = coordinator.client
    expires = client.token_expires
    return {
        "entry": {
            "data": async_redact_data(dict(entry.data), TO_REDACT),
            "options": dict(entry.options),
        },
        "token": {
            "required": client.requires_token,
            "present": bool(client.token),
            "expires": expires.isoformat() if expires else None,
            "automatic_renewal": client.has_credentials,
            "last_error": coordinator.last_token_error,
        },
        "last_update_success": coordinator.last_update_success,
        "raw": coordinator.data.raw if coordinator.data else None,
        "daily": {k: v for k, v in coordinator._daily.items() if k not in ("efficiency", "effsum")},
        "forecast": {
            "calibration": coordinator.forecast.data.calibration if getattr(coordinator, "forecast", None) else None,
            "history_source": getattr(getattr(coordinator, "forecast", None), "history_source", None),
            "error": coordinator.forecast.data.error if getattr(coordinator, "forecast", None) else None,
        },
        "earnings": (
            {k: v for k, v in coordinator.earnings.data.items()} | {"error": coordinator.earnings.error}
            if getattr(coordinator, "earnings", None) else None
        ),
        "inverter_count": len(coordinator.data.inverters) if coordinator.data else 0,
        "layout": {
            "source": "enlighten" if coordinator.layout else "phases",
            "fetched": (coordinator.layout or {}).get("fetched"),
            "status": coordinator.layout_status,
            "trace": getattr(client, "layout_trace", None) or [],
        },
        "probe": await client.async_probe(PROBE_PATHS),
    }
