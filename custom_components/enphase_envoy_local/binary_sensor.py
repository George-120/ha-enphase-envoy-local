"""Binary sensors for Enphase Envoy Local."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from homeassistant.components.binary_sensor import (
    BinarySensorDeviceClass,
    BinarySensorEntity,
    BinarySensorEntityDescription,
)
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant, callback

try:  # Home Assistant 2025.3+
    from homeassistant.helpers.entity_platform import (
        AddConfigEntryEntitiesCallback,
    )
except ImportError:  # pragma: no cover
    from homeassistant.helpers.entity_platform import (
        AddEntitiesCallback as AddConfigEntryEntitiesCallback,
    )

from .api import EnvoyData, InverterData
from .coordinator import EnvoyConfigEntry
from .entity import EnvoyEntity
from .sensor import EnvoyInverterEntity

PARALLEL_UPDATES = 0


@dataclass(frozen=True, kw_only=True)
class EnvoyBinaryDescription(BinarySensorEntityDescription):
    """Binary sensor of the gateway."""

    value_fn: Callable[[EnvoyData], bool | None]


@dataclass(frozen=True, kw_only=True)
class InverterBinaryDescription(BinarySensorEntityDescription):
    """Binary sensor of a microinverter."""

    value_fn: Callable[[InverterData], bool | None]


GATEWAY: tuple[EnvoyBinaryDescription, ...] = (
    EnvoyBinaryDescription(
        key="cloud_connected",
        translation_key="cloud_connected",
        device_class=BinarySensorDeviceClass.CONNECTIVITY,
        entity_category=EntityCategory.DIAGNOSTIC,
        value_fn=lambda d: d.network.cloud_connected if d.network else None,
    ),
    EnvoyBinaryDescription(
        key="export_limit",
        translation_key="export_limit",
        entity_category=EntityCategory.DIAGNOSTIC,
        value_fn=lambda d: d.export_limit_enabled,
    ),
    EnvoyBinaryDescription(
        key="production_stopped",
        translation_key="production_stopped",
        device_class=BinarySensorDeviceClass.PROBLEM,
        value_fn=lambda d: d.production_forced_off,
    ),
)

INVERTER: tuple[InverterBinaryDescription, ...] = (
    InverterBinaryDescription(
        key="inverter_producing",
        translation_key="inverter_producing",
        device_class=BinarySensorDeviceClass.RUNNING,
        value_fn=lambda i: i.producing,
    ),
    InverterBinaryDescription(
        key="inverter_underperforming",
        translation_key="inverter_underperforming",
        device_class=BinarySensorDeviceClass.PROBLEM,
        value_fn=lambda i: i.underperforming,
    ),
    InverterBinaryDescription(
        key="inverter_no_output",
        translation_key="inverter_no_output",
        device_class=BinarySensorDeviceClass.PROBLEM,
        value_fn=lambda i: i.no_output,
    ),
    InverterBinaryDescription(
        key="inverter_communicating",
        translation_key="inverter_communicating",
        device_class=BinarySensorDeviceClass.CONNECTIVITY,
        entity_category=EntityCategory.DIAGNOSTIC,
        value_fn=lambda i: i.communicating,
    ),
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: EnvoyConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Set up binary sensors."""
    coordinator = entry.runtime_data
    async_add_entities(
        EnvoyBinarySensor(coordinator, desc)
        for desc in GATEWAY
        if desc.value_fn(coordinator.data) is not None
    )
    known: set[str] = set()

    @callback
    def _add_inverters() -> None:
        new = [
            s
            for s, inv in coordinator.data.inverters.items()
            if s not in known
            and (inv.communicating is not None or inv.energy_today is not None)
        ]
        if not new:
            return
        known.update(new)
        async_add_entities(
            EnvoyInverterBinarySensor(coordinator, desc, serial)
            for serial in new
            for desc in INVERTER
            if desc.key not in ("inverter_producing", "inverter_communicating")
            or coordinator.data.inverters[serial].communicating is not None
        )

    _add_inverters()
    entry.async_on_unload(coordinator.async_add_listener(_add_inverters))


class EnvoyBinarySensor(EnvoyEntity, BinarySensorEntity):
    """Gateway binary sensor."""

    entity_description: EnvoyBinaryDescription

    @property
    def is_on(self) -> bool | None:
        """State."""
        return self.entity_description.value_fn(self.coordinator.data)


class EnvoyInverterBinarySensor(EnvoyInverterEntity, BinarySensorEntity):
    """Microinverter binary sensor."""

    entity_description: InverterBinaryDescription

    @property
    def is_on(self) -> bool | None:
        """State."""
        data = self._data
        return None if data is None else self.entity_description.value_fn(data)
