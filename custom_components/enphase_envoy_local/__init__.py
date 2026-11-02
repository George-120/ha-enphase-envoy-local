"""The Enphase Envoy Local integration."""

from __future__ import annotations

import logging
from pathlib import Path

from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.typing import ConfigType

from .const import DOMAIN
from .coordinator import EnvoyConfigEntry, EnvoyCoordinator
from .entity import ensure_gateway_device

_LOGGER = logging.getLogger(__name__)

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

CARD_URL = f"/{DOMAIN}/enphase-panel-layout-card.js"

PLATFORMS: list[Platform] = [
    Platform.BINARY_SENSOR,
    Platform.BUTTON,
    Platform.SENSOR,
    Platform.SWITCH,
]


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Serve the panel layout card and make dashboards load it."""
    if getattr(hass, "http", None) is None or "frontend" not in hass.config.components:
        # No web interface (e.g. tests or a headless setup): nothing to serve.
        return True
    from homeassistant.components.http import StaticPathConfig

    path = Path(__file__).parent / "frontend" / "enphase-panel-layout-card.js"
    stat = await hass.async_add_executor_job(path.stat)
    await hass.http.async_register_static_paths(
        [StaticPathConfig(CARD_URL, str(path), False)]
    )
    # The modification time busts the browser cache after every update.
    await _async_register_card(hass, f"{CARD_URL}?v={int(stat.st_mtime)}")
    return True


async def _async_register_card(hass: HomeAssistant, url: str) -> None:
    """Add the card as a dashboard resource (or an extra module in YAML mode).

    A dashboard resource is loaded every time a dashboard opens, so the card
    also works in browser tabs that were already open before an update.
    """
    from homeassistant.components.frontend import add_extra_js_url

    lovelace = hass.data.get("lovelace")
    resources = getattr(lovelace, "resources", None)
    mode = getattr(lovelace, "resource_mode", "storage")
    if resources is None or mode != "storage" or not hasattr(resources, "async_create_item"):
        add_extra_js_url(hass, url)
        return
    try:
        if not getattr(resources, "loaded", True):
            await resources.async_load()
            resources.loaded = True
        for item in resources.async_items():
            if str(item.get("url", "")).split("?")[0] == CARD_URL:
                if item.get("url") != url:
                    await resources.async_update_item(
                        item["id"], {"res_type": "module", "url": url}
                    )
                return
        await resources.async_create_item({"res_type": "module", "url": url})
    except Exception:  # noqa: BLE001 - never block setup on the card
        _LOGGER.exception("Could not add the panel layout card as dashboard resource")
        add_extra_js_url(hass, url)


async def async_setup_entry(hass: HomeAssistant, entry: EnvoyConfigEntry) -> bool:
    """Set up a gateway from a config entry."""
    coordinator = EnvoyCoordinator(hass, entry)
    await coordinator.async_config_entry_first_refresh()
    entry.runtime_data = coordinator
    coordinator.gateway_device_id = ensure_gateway_device(coordinator)
    entry.async_on_unload(entry.add_update_listener(_async_options_updated))
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    coordinator.async_schedule_layout_refresh()
    return True


async def _async_options_updated(hass: HomeAssistant, entry: EnvoyConfigEntry) -> None:
    """Reload when the options change (not when only the stored token changes)."""
    coordinator: EnvoyCoordinator = entry.runtime_data
    if dict(entry.options) != coordinator.options_snapshot:
        await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: EnvoyConfigEntry) -> bool:
    """Unload a config entry."""
    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unloaded:
        entry.runtime_data.async_clear_issues()
    return unloaded
