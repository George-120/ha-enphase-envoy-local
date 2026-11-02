"""Switch for Enphase Envoy Local: production on/off.

The gateway only accepts this with an installer token; with an owner token the
setting cannot even be read, and then the switch is not created.
"""

from __future__ import annotations

from typing import Any

from homeassistant.components.switch import SwitchEntity, SwitchEntityDescription
from homeassistant.core import HomeAssistant

try:  # Home Assistant 2025.3+
    from homeassistant.helpers.entity_platform import (
        AddConfigEntryEntitiesCallback,
    )
except ImportError:  # pragma: no cover
    from homeassistant.helpers.entity_platform import (
        AddEntitiesCallback as AddConfigEntryEntitiesCallback,
    )

from .coordinator import EnvoyConfigEntry
from .entity import EnvoyEntity

PARALLEL_UPDATES = 1

PRODUCTION = SwitchEntityDescription(key="production", translation_key="production")


async def async_setup_entry(
    hass: HomeAssistant,
    entry: EnvoyConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Set up the switch when the token may control production."""
    coordinator = entry.runtime_data
    if coordinator.data.production_forced_off is not None:
        async_add_entities([EnvoyProductionSwitch(coordinator, PRODUCTION)])


class EnvoyProductionSwitch(EnvoyEntity, SwitchEntity):
    """Production of all microinverters."""

    @property
    def is_on(self) -> bool | None:
        """On = producing allowed."""
        off = self.coordinator.data.production_forced_off
        return None if off is None else not off

    async def async_turn_on(self, **kwargs: Any) -> None:
        """Resume production."""
        await self.coordinator.async_set_production(True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        """Stop production."""
        await self.coordinator.async_set_production(False)
