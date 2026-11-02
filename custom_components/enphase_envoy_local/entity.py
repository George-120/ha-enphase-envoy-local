"""Base entities for Enphase Envoy Local."""

from __future__ import annotations

from homeassistant.const import CONF_HOST
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity import EntityDescription
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import CONF_FIRMWARE, CONF_SERIAL, DOMAIN, MANUFACTURER
from .coordinator import EnvoyCoordinator

# Home Assistant 2026.x replaced DeviceInfo(via_device=...) by via_device_id.
_FIELDS = set(getattr(DeviceInfo, "__dataclass_fields__", {})) | set(
    getattr(DeviceInfo, "__annotations__", {})
)
_HAS_VIA_DEVICE_ID = "via_device_id" in _FIELDS


def gateway_device_info(coordinator: EnvoyCoordinator) -> DeviceInfo:
    """Device info of the gateway itself."""
    entry = coordinator.config_entry
    serial = entry.data[CONF_SERIAL]
    info = coordinator.info
    metered = coordinator.data is not None and coordinator.data.production_metered
    return DeviceInfo(
        identifiers={(DOMAIN, serial)},
        manufacturer=MANUFACTURER,
        model="IQ Gateway Metered" if metered else "IQ Gateway",
        model_id=info.get("part_number"),
        name=f"Envoy {serial}",
        serial_number=serial,
        sw_version=entry.data.get(CONF_FIRMWARE),
        configuration_url=f"https://{entry.data[CONF_HOST]}",
    )


def ensure_gateway_device(coordinator: EnvoyCoordinator) -> str:
    """Create the gateway device now and return its registry id."""
    device_registry = dr.async_get(coordinator.hass)
    info = gateway_device_info(coordinator)
    kwargs = {
        key: value
        for key, value in dict(info).items()
        if key not in ("identifiers",)
    }
    device = device_registry.async_get_or_create(
        config_entry_id=coordinator.config_entry.entry_id,
        identifiers=info["identifiers"],
        **kwargs,
    )
    return device.id


def child_device_info(
    coordinator: EnvoyCoordinator,
    identifier: str,
    *,
    name: str,
    model: str,
    sw_version: str | None = None,
    model_id: str | None = None,
) -> DeviceInfo:
    """Device info of something connected to the gateway (microinverter, meter)."""
    serial = coordinator.config_entry.data[CONF_SERIAL]
    extra: dict = {}
    if _HAS_VIA_DEVICE_ID and coordinator.gateway_device_id:
        extra["via_device_id"] = coordinator.gateway_device_id
    else:
        extra["via_device"] = (DOMAIN, serial)
    return DeviceInfo(
        identifiers={(DOMAIN, identifier)},
        manufacturer=MANUFACTURER,
        model=model,
        model_id=model_id,
        name=name,
        serial_number=identifier,
        sw_version=sw_version,
        **extra,
    )


class EnvoyEntity(CoordinatorEntity[EnvoyCoordinator]):
    """An entity on the gateway device."""

    _attr_has_entity_name = True

    def __init__(
        self, coordinator: EnvoyCoordinator, description: EntityDescription
    ) -> None:
        """Initialise."""
        super().__init__(coordinator)
        self.entity_description = description
        self._serial: str = coordinator.config_entry.data[CONF_SERIAL]
        self._attr_unique_id = f"{self._serial}_{description.key}"
        self._attr_device_info = gateway_device_info(coordinator)
