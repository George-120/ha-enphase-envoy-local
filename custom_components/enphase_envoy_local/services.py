"""Actions of Enphase Envoy Local: store or reset a panel layout drawn in the card."""

from __future__ import annotations

import voluptuous as vol

from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import config_validation as cv

from .const import DOMAIN

SERVICE_SET_LAYOUT = "set_panel_layout"
SERVICE_RESET_LAYOUT = "reset_panel_layout"

MODULE = vol.Schema(
    {
        vol.Required("serial"): cv.string,
        vol.Required("x"): vol.Coerce(float),
        vol.Required("y"): vol.Coerce(float),
        vol.Optional("w", default=100): vol.Coerce(float),
        vol.Optional("h", default=200): vol.Coerce(float),
    },
    extra=vol.REMOVE_EXTRA,
)
ARRAY = vol.Schema(
    {
        vol.Optional("label", default=""): cv.string,
        vol.Required("modules"): [MODULE],
    },
    extra=vol.REMOVE_EXTRA,
)
SET_SCHEMA = vol.Schema(
    {vol.Required("serial"): cv.string, vol.Required("arrays"): [ARRAY]}
)
RESET_SCHEMA = vol.Schema({vol.Required("serial"): cv.string})


def _coordinator(hass: HomeAssistant, serial: str):
    for entry in hass.config_entries.async_entries(DOMAIN):
        if entry.state is not ConfigEntryState.LOADED:
            continue
        coordinator = entry.runtime_data
        if str(coordinator.client.serial) == str(serial) or entry.unique_id == str(serial):
            return coordinator
    raise ServiceValidationError(
        translation_domain=DOMAIN,
        translation_key="unknown_gateway",
        translation_placeholders={"serial": str(serial)},
    )


def async_setup_services(hass: HomeAssistant) -> None:
    """Register the actions (once)."""

    async def set_layout(call: ServiceCall) -> None:
        await _coordinator(hass, call.data["serial"]).async_set_manual_layout(
            call.data["arrays"]
        )

    async def reset_layout(call: ServiceCall) -> None:
        await _coordinator(hass, call.data["serial"]).async_reset_layout()

    hass.services.async_register(DOMAIN, SERVICE_SET_LAYOUT, set_layout, schema=SET_SCHEMA)
    hass.services.async_register(DOMAIN, SERVICE_RESET_LAYOUT, reset_layout, schema=RESET_SCHEMA)
