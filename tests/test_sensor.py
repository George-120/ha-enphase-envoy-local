"""Setup and sensor tests."""

from __future__ import annotations

from unittest.mock import AsyncMock

from homeassistant.config_entries import ConfigEntryState
from homeassistant.const import CONF_HOST, CONF_PASSWORD, CONF_USERNAME
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.enphase_envoy_local.api import EnvoyConnectionError
from custom_components.enphase_envoy_local.const import (
    CONF_FIRMWARE,
    CONF_SERIAL,
    CONF_TOKEN,
    DOMAIN,
)

from .fixtures import SERIAL


def _entry(token: str) -> MockConfigEntry:
    return MockConfigEntry(
        domain=DOMAIN,
        unique_id=SERIAL,
        title=f"Envoy {SERIAL}",
        data={
            CONF_HOST: "192.168.1.50",
            CONF_SERIAL: SERIAL,
            CONF_FIRMWARE: "D8.2.4382",
            CONF_USERNAME: "me@example.com",
            CONF_PASSWORD: "secret",
            CONF_TOKEN: token,
        },
    )


async def test_setup_creates_sensors(
    hass: HomeAssistant, mock_client: AsyncMock, token: str, entity_registry: er.EntityRegistry
) -> None:
    """Metered gateway: totals, phases, consumption and microinverters."""
    entry = _entry(token)
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert entry.state is ConfigEntryState.LOADED

    ids = {e.unique_id for e in er.async_entries_for_config_entry(entity_registry, entry.entry_id)}
    for key in (
        "production_power",
        "production_today",
        "production_lifetime",
        "consumption_power",
        "net_power",
        "production_phase_voltage_l3",
        "token_expires",
    ):
        assert f"{SERIAL}_{key}" in ids
    assert "482211000001_inverter_power" in ids

    states = [s for s in hass.states.async_all("sensor") if s.attributes.get("unit_of_measurement") == "W"]
    values = {s.entity_id: s.state for s in states}
    assert "3012.4" in values.values()


async def test_setup_retry_when_unreachable(
    hass: HomeAssistant, mock_client: AsyncMock, token: str
) -> None:
    """Gateway down at startup -> retry later."""
    mock_client.async_get_production.side_effect = EnvoyConnectionError("down")
    entry = _entry(token)
    entry.add_to_hass(hass)
    await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert entry.state is ConfigEntryState.SETUP_RETRY


async def test_draw_and_reset_panel_layout(
    hass: HomeAssistant, mock_client: AsyncMock, token: str
) -> None:
    """A layout drawn in the card is stored and used; reset goes back."""
    entry = _entry(token)
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    coordinator = entry.runtime_data
    serial = next(iter(coordinator.data.inverters))

    await hass.services.async_call(
        DOMAIN,
        "set_panel_layout",
        {
            "serial": SERIAL,
            "arrays": [
                {
                    "label": "Voorkant",
                    "modules": [
                        {"serial": serial, "x": 50, "y": 100, "w": 200, "h": 100},
                        {"serial": "unknown", "x": 0, "y": 0},
                    ],
                }
            ],
        },
        blocking=True,
    )
    assert coordinator.layout["source"] == "manual"
    modules = coordinator.layout["arrays"][0]["modules"]
    assert [m["serial"] for m in modules] == [serial]
    assert (modules[0]["w"], modules[0]["h"]) == (200, 100)

    await hass.services.async_call(
        DOMAIN, "reset_panel_layout", {"serial": SERIAL}, blocking=True
    )
    assert coordinator.layout is None
