"""Buttons for Enphase Envoy Local."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from homeassistant.components.button import ButtonEntity, ButtonEntityDescription
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant

try:  # Home Assistant 2025.3+
    from homeassistant.helpers.entity_platform import (
        AddConfigEntryEntitiesCallback,
    )
except ImportError:  # pragma: no cover
    from homeassistant.helpers.entity_platform import (
        AddEntitiesCallback as AddConfigEntryEntitiesCallback,
    )

from .coordinator import EnvoyConfigEntry, EnvoyCoordinator
from .entity import EnvoyEntity

PARALLEL_UPDATES = 1


@dataclass(frozen=True, kw_only=True)
class EnvoyButtonDescription(ButtonEntityDescription):
    """Button with its action."""

    press_fn: Callable[[EnvoyCoordinator], Awaitable[None]]
    exists_fn: Callable[[EnvoyCoordinator], bool] = lambda c: True


async def _refresh(coordinator: EnvoyCoordinator) -> None:
    coordinator.force_full_refresh()
    await coordinator.async_request_refresh()


BUTTONS: tuple[EnvoyButtonDescription, ...] = (
    EnvoyButtonDescription(
        key="refresh",
        translation_key="refresh",
        entity_category=EntityCategory.DIAGNOSTIC,
        press_fn=_refresh,
    ),
    EnvoyButtonDescription(
        key="renew_token",
        translation_key="renew_token",
        entity_category=EntityCategory.DIAGNOSTIC,
        press_fn=lambda c: c.async_renew_token(),
        exists_fn=lambda c: c.client.requires_token and c.client.has_credentials,
    ),
    EnvoyButtonDescription(
        key="refresh_layout",
        translation_key="refresh_layout",
        entity_category=EntityCategory.DIAGNOSTIC,
        press_fn=lambda c: c.async_refresh_layout(),
        exists_fn=lambda c: c.client.has_credentials and bool(c.data.inverters),
    ),
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: EnvoyConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Set up buttons."""
    coordinator = entry.runtime_data
    async_add_entities(
        EnvoyButton(coordinator, desc) for desc in BUTTONS if desc.exists_fn(coordinator)
    )


class EnvoyButton(EnvoyEntity, ButtonEntity):
    """A button."""

    entity_description: EnvoyButtonDescription

    async def async_press(self) -> None:
        """Run the action."""
        await self.entity_description.press_fn(self.coordinator)
