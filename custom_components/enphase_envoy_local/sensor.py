"""Sensors for Enphase Envoy Local."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorEntityDescription,
    SensorStateClass,
)
from homeassistant.const import (
    PERCENTAGE,
    EntityCategory,
    UnitOfElectricCurrent,
    UnitOfElectricPotential,
    UnitOfEnergy,
    UnitOfFrequency,
    UnitOfPower,
    UnitOfTemperature,
)
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.update_coordinator import CoordinatorEntity

try:  # Home Assistant 2025.3+
    from homeassistant.helpers.entity_platform import (
        AddConfigEntryEntitiesCallback,
    )
except ImportError:  # pragma: no cover
    from homeassistant.helpers.entity_platform import (
        AddEntitiesCallback as AddConfigEntryEntitiesCallback,
    )

from .api import EnvoyData, InverterData, PhaseData
from .const import DOMAIN
from .coordinator import EnvoyConfigEntry, EnvoyCoordinator
from .entity import EnvoyEntity, child_device_info

PARALLEL_UPDATES = 0

PHASE_NAMES = ("L1", "L2", "L3")

type ValueFn = Callable[[EnvoyData], float | datetime | int | None]
type ExistsFn = Callable[[EnvoyData], bool]


@dataclass(frozen=True, kw_only=True)
class EnvoySensorDescription(SensorEntityDescription):
    """Sensor reading a value from EnvoyData."""

    value_fn: ValueFn
    exists_fn: ExistsFn | None = None


@dataclass(frozen=True, kw_only=True)
class PhaseSensorDescription(SensorEntityDescription):
    """Sensor reading a value of one phase."""

    lines_fn: Callable[[EnvoyData], list[PhaseData]]
    value_fn: Callable[[PhaseData], float | None]


def _power(key: str, value_fn: ValueFn, **kwargs) -> EnvoySensorDescription:
    return EnvoySensorDescription(
        key=key,
        translation_key=key,
        native_unit_of_measurement=UnitOfPower.WATT,
        device_class=SensorDeviceClass.POWER,
        state_class=SensorStateClass.MEASUREMENT,
        suggested_display_precision=0,
        value_fn=value_fn,
        exists_fn=lambda d: value_fn(d) is not None,
        **kwargs,
    )


def _energy(
    key: str, value_fn: ValueFn, *, total: bool = True, **kwargs
) -> EnvoySensorDescription:
    return EnvoySensorDescription(
        key=key,
        translation_key=key,
        native_unit_of_measurement=UnitOfEnergy.WATT_HOUR,
        suggested_unit_of_measurement=UnitOfEnergy.KILO_WATT_HOUR,
        device_class=SensorDeviceClass.ENERGY,
        state_class=SensorStateClass.TOTAL_INCREASING if total else None,
        suggested_display_precision=2,
        value_fn=value_fn,
        exists_fn=lambda d: value_fn(d) is not None,
        **kwargs,
    )


SENSORS: tuple[EnvoySensorDescription, ...] = (
    _power("production_power", lambda d: d.production_power),
    _energy("production_today", lambda d: d.production_today),
    _energy("production_7days", lambda d: d.production_7days, total=False),
    _energy("production_lifetime", lambda d: d.production_lifetime),
    EnvoySensorDescription(
        key="active_inverters",
        translation_key="active_inverters",
        state_class=SensorStateClass.MEASUREMENT,
        value_fn=lambda d: d.active_inverters,
    ),
    _power("consumption_power", lambda d: d.consumption_power),
    _energy("consumption_today", lambda d: d.consumption_today),
    _energy("consumption_lifetime", lambda d: d.consumption_lifetime),
    _power("net_power", lambda d: d.net_power),
    _energy("grid_import_today", lambda d: d.grid_import_today),
    _energy("grid_export_today", lambda d: d.grid_export_today),
    _energy("grid_import_lifetime", lambda d: d.grid_import_lifetime),
    _energy("grid_export_lifetime", lambda d: d.grid_export_lifetime),
    EnvoySensorDescription(
        key="self_consumption_today",
        translation_key="self_consumption_today",
        native_unit_of_measurement=PERCENTAGE,
        state_class=SensorStateClass.MEASUREMENT,
        suggested_display_precision=0,
        value_fn=lambda d: _ratio(
            None
            if d.production_today is None or d.grid_export_today is None
            else d.production_today - d.grid_export_today,
            d.production_today,
        ),
        exists_fn=lambda d: d.grid_export_lifetime is not None
        and d.production_lifetime is not None,
    ),
    EnvoySensorDescription(
        key="self_sufficiency_today",
        translation_key="self_sufficiency_today",
        native_unit_of_measurement=PERCENTAGE,
        state_class=SensorStateClass.MEASUREMENT,
        suggested_display_precision=0,
        value_fn=lambda d: _ratio(
            None
            if d.consumption_today is None or d.grid_import_today is None
            else d.consumption_today - d.grid_import_today,
            d.consumption_today,
        ),
        exists_fn=lambda d: d.grid_import_lifetime is not None
        and d.consumption_lifetime is not None,
    ),
    EnvoySensorDescription(
        key="frequency",
        translation_key="frequency",
        native_unit_of_measurement=UnitOfFrequency.HERTZ,
        device_class=SensorDeviceClass.FREQUENCY,
        state_class=SensorStateClass.MEASUREMENT,
        suggested_display_precision=2,
        entity_category=EntityCategory.DIAGNOSTIC,
        value_fn=lambda d: d.frequency,
    ),
    EnvoySensorDescription(
        key="power_factor",
        translation_key="power_factor",
        device_class=SensorDeviceClass.POWER_FACTOR,
        state_class=SensorStateClass.MEASUREMENT,
        suggested_display_precision=2,
        entity_category=EntityCategory.DIAGNOSTIC,
        entity_registry_enabled_default=False,
        value_fn=lambda d: d.power_factor,
    ),
    EnvoySensorDescription(
        key="last_reading",
        translation_key="last_reading",
        device_class=SensorDeviceClass.TIMESTAMP,
        entity_category=EntityCategory.DIAGNOSTIC,
        value_fn=lambda d: d.reading_time,
    ),
)


def _ratio(part: float | None, whole: float | None) -> float | None:
    if part is None or not whole or whole < 10:
        return None
    return max(0.0, min(100.0, part / whole * 100))


def _phase(key: str, lines_fn, value_fn, unit, device_class, precision, **kw):
    return PhaseSensorDescription(
        key=key,
        translation_key=key,
        native_unit_of_measurement=unit,
        device_class=device_class,
        state_class=kw.pop("state_class", SensorStateClass.MEASUREMENT),
        suggested_display_precision=precision,
        lines_fn=lines_fn,
        value_fn=value_fn,
        **kw,
    )


PHASE_SENSORS: tuple[PhaseSensorDescription, ...] = (
    _phase(
        "production_phase_power",
        lambda d: d.production_phases,
        lambda p: p.power,
        UnitOfPower.WATT,
        SensorDeviceClass.POWER,
        0,
    ),
    _phase(
        "production_phase_voltage",
        lambda d: d.production_phases,
        lambda p: p.voltage,
        UnitOfElectricPotential.VOLT,
        SensorDeviceClass.VOLTAGE,
        1,
    ),
    _phase(
        "production_phase_current",
        lambda d: d.production_phases,
        lambda p: p.current,
        UnitOfElectricCurrent.AMPERE,
        SensorDeviceClass.CURRENT,
        2,
    ),
    _phase(
        "production_phase_lifetime",
        lambda d: d.production_phases,
        lambda p: p.energy_lifetime,
        UnitOfEnergy.WATT_HOUR,
        SensorDeviceClass.ENERGY,
        2,
        state_class=SensorStateClass.TOTAL_INCREASING,
        suggested_unit_of_measurement=UnitOfEnergy.KILO_WATT_HOUR,
        entity_registry_enabled_default=False,
    ),
    _phase(
        "consumption_phase_power",
        lambda d: d.consumption_phases,
        lambda p: p.power,
        UnitOfPower.WATT,
        SensorDeviceClass.POWER,
        0,
    ),
    _phase(
        "consumption_phase_current",
        lambda d: d.consumption_phases,
        lambda p: p.current,
        UnitOfElectricCurrent.AMPERE,
        SensorDeviceClass.CURRENT,
        2,
        entity_registry_enabled_default=False,
    ),
    _phase(
        "net_phase_power",
        lambda d: d.net_phases,
        lambda p: p.power,
        UnitOfPower.WATT,
        SensorDeviceClass.POWER,
        0,
    ),
)

LAYOUT_SENSOR = SensorEntityDescription(
    key="panel_layout",
    translation_key="panel_layout",
    entity_category=EntityCategory.DIAGNOSTIC,
)

TOKEN_SENSOR = SensorEntityDescription(
    key="token_expires",
    translation_key="token_expires",
    device_class=SensorDeviceClass.TIMESTAMP,
    entity_category=EntityCategory.DIAGNOSTIC,
)

@dataclass(frozen=True, kw_only=True)
class InverterSensorDescription(SensorEntityDescription):
    """Sensor of one microinverter."""

    value_fn: Callable[[InverterData], float | str | datetime | None]


def _inv(key: str, value_fn, unit=None, device_class=None, precision=None, **kw):
    return InverterSensorDescription(
        key=f"inverter_{key}",
        translation_key=f"inverter_{key}",
        native_unit_of_measurement=unit,
        device_class=device_class,
        state_class=kw.pop(
            "state_class",
            SensorStateClass.MEASUREMENT if unit and device_class not in (
                SensorDeviceClass.ENERGY,
            ) else None,
        ),
        suggested_display_precision=precision,
        value_fn=value_fn,
        **kw,
    )


INVERTER_SENSORS: tuple[InverterSensorDescription, ...] = (
    _inv("power", lambda i: i.power, UnitOfPower.WATT, SensorDeviceClass.POWER, 0),
    _inv("dc_power", lambda i: i.dc_power, UnitOfPower.WATT, SensorDeviceClass.POWER, 0),
    _inv(
        "efficiency",
        # Live in daylight; after sunset the last daylight value stays.
        lambda i: i.efficiency if i.efficiency is not None else i.last_efficiency,
        PERCENTAGE,
        None,
        1,
        state_class=SensorStateClass.MEASUREMENT,
    ),
    _inv("dc_voltage", lambda i: i.dc_voltage, UnitOfElectricPotential.VOLT, SensorDeviceClass.VOLTAGE, 1),
    _inv("dc_current", lambda i: i.dc_current, UnitOfElectricCurrent.AMPERE, SensorDeviceClass.CURRENT, 2),
    _inv("ac_voltage", lambda i: i.ac_voltage, UnitOfElectricPotential.VOLT, SensorDeviceClass.VOLTAGE, 1),
    _inv("ac_current", lambda i: i.ac_current, UnitOfElectricCurrent.AMPERE, SensorDeviceClass.CURRENT, 2),
    _inv(
        "ac_frequency",
        lambda i: i.ac_frequency,
        UnitOfFrequency.HERTZ,
        SensorDeviceClass.FREQUENCY,
        2,
        entity_category=EntityCategory.DIAGNOSTIC,
        entity_registry_enabled_default=False,
    ),
    _inv("temperature", lambda i: i.temperature, UnitOfTemperature.CELSIUS, SensorDeviceClass.TEMPERATURE, 0),
    _inv(
        "energy_today",
        lambda i: i.energy_today,
        UnitOfEnergy.WATT_HOUR,
        SensorDeviceClass.ENERGY,
        0,
        state_class=SensorStateClass.TOTAL_INCREASING,
    ),
    _inv(
        "energy_yesterday",
        lambda i: i.energy_yesterday,
        UnitOfEnergy.WATT_HOUR,
        SensorDeviceClass.ENERGY,
        0,
        entity_registry_enabled_default=False,
    ),
    _inv(
        "energy_week",
        lambda i: i.energy_week,
        UnitOfEnergy.WATT_HOUR,
        SensorDeviceClass.ENERGY,
        0,
        entity_registry_enabled_default=False,
    ),
    _inv(
        "energy_lifetime",
        lambda i: i.energy_lifetime,
        UnitOfEnergy.WATT_HOUR,
        SensorDeviceClass.ENERGY,
        1,
        state_class=SensorStateClass.TOTAL_INCREASING,
        suggested_unit_of_measurement=UnitOfEnergy.KILO_WATT_HOUR,
    ),
    _inv(
        "performance",
        lambda i: i.performance,
        PERCENTAGE,
        None,
        0,
        state_class=SensorStateClass.MEASUREMENT,
    ),
    _inv(
        "performance_week",
        lambda i: i.performance_week,
        PERCENTAGE,
        None,
        0,
        state_class=SensorStateClass.MEASUREMENT,
    ),
    _inv(
        "max_power",
        lambda i: i.max_power,
        UnitOfPower.WATT,
        SensorDeviceClass.POWER,
        0,
        entity_category=EntityCategory.DIAGNOSTIC,
        entity_registry_enabled_default=False,
    ),
    _inv(
        "phase",
        lambda i: i.phase,
        entity_category=EntityCategory.DIAGNOSTIC,
    ),
    _inv(
        "firmware",
        lambda i: i.firmware,
        entity_category=EntityCategory.DIAGNOSTIC,
        entity_registry_enabled_default=False,
    ),
    _inv(
        "signal",
        lambda i: i.rssi,
        entity_category=EntityCategory.DIAGNOSTIC,
        entity_registry_enabled_default=False,
        state_class=SensorStateClass.MEASUREMENT,
    ),
    _inv(
        "last_report",
        lambda i: i.last_report,
        None,
        SensorDeviceClass.TIMESTAMP,
        entity_category=EntityCategory.DIAGNOSTIC,
    ),
)

NETWORK_SENSORS: tuple[EnvoySensorDescription, ...] = (
    EnvoySensorDescription(
        key="last_cloud_report",
        translation_key="last_cloud_report",
        device_class=SensorDeviceClass.TIMESTAMP,
        entity_category=EntityCategory.DIAGNOSTIC,
        value_fn=lambda d: d.network.last_report if d.network else None,
        exists_fn=lambda d: d.network is not None,
    ),
    EnvoySensorDescription(
        key="network_interface",
        translation_key="network_interface",
        device_class=SensorDeviceClass.ENUM,
        options=["ethernet", "wifi", "cellular", "eth0", "wlan0"],
        entity_category=EntityCategory.DIAGNOSTIC,
        value_fn=lambda d: d.network.interface if d.network else None,
        exists_fn=lambda d: d.network is not None and d.network.interface is not None,
    ),
    EnvoySensorDescription(
        key="wifi_signal",
        translation_key="wifi_signal",
        native_unit_of_measurement=PERCENTAGE,
        state_class=SensorStateClass.MEASUREMENT,
        entity_category=EntityCategory.DIAGNOSTIC,
        value_fn=lambda d: d.network.wifi_signal if d.network else None,
        exists_fn=lambda d: d.network is not None and d.network.wifi_signal is not None,
    ),
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: EnvoyConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Set up sensors."""
    coordinator = entry.runtime_data
    data = coordinator.data
    serial = coordinator.config_entry.data["serial"]

    entities: list[SensorEntity] = []
    skipped: list[str] = []
    for desc in (*SENSORS, *NETWORK_SENSORS):
        if desc.exists_fn is None or desc.exists_fn(data):
            entities.append(EnvoySensor(coordinator, desc))
        else:
            skipped.append(f"{serial}_{desc.key}")
    for desc in PHASE_SENSORS:
        lines = desc.lines_fn(data)
        if len(lines) < 2:
            continue  # a single line is the same as the totals
        entities.extend(
            EnvoyPhaseSensor(coordinator, desc, index)
            for index in range(min(len(lines), len(PHASE_NAMES)))
        )
    if coordinator.client.requires_token:
        entities.append(EnvoyTokenSensor(coordinator, TOKEN_SENSOR))
    if data.inverters:
        entities.append(EnvoyLayoutSensor(coordinator, LAYOUT_SENSOR))
    async_add_entities(entities)

    # Values this gateway cannot deliver (e.g. 'last 7 days' on firmware 8)
    # are removed instead of staying 'unknown' forever.
    registry = er.async_get(hass)
    for unique_id in skipped:
        if entity_id := registry.async_get_entity_id("sensor", DOMAIN, unique_id):
            registry.async_remove(entity_id)

    known: set[str] = set()

    @callback
    def _add_inverters() -> None:
        new = [s for s in coordinator.data.inverters if s not in known]
        if not new:
            return
        known.update(new)
        async_add_entities(
            EnvoyInverterSensor(coordinator, desc, serial)
            for serial in new
            for desc in INVERTER_SENSORS
            if _inverter_supported(desc, coordinator.data.inverters[serial])
        )

    _add_inverters()
    entry.async_on_unload(coordinator.async_add_listener(_add_inverters))


class EnvoySensor(EnvoyEntity, SensorEntity):
    """Gateway-level sensor."""

    entity_description: EnvoySensorDescription

    @property
    def native_value(self) -> float | datetime | int | None:
        """Current value."""
        return self.entity_description.value_fn(self.coordinator.data)


class EnvoyPhaseSensor(EnvoyEntity, SensorEntity):
    """Sensor for a single phase."""

    entity_description: PhaseSensorDescription

    def __init__(
        self,
        coordinator: EnvoyCoordinator,
        description: PhaseSensorDescription,
        index: int,
    ) -> None:
        """Initialise."""
        super().__init__(coordinator, description)
        self._index = index
        phase = PHASE_NAMES[index]
        self._attr_unique_id = f"{self._serial}_{description.key}_{phase.lower()}"
        self._attr_translation_placeholders = {"phase": phase}

    @property
    def native_value(self) -> float | None:
        """Current value."""
        lines = self.entity_description.lines_fn(self.coordinator.data)
        if self._index >= len(lines):
            return None
        return self.entity_description.value_fn(lines[self._index])


def _fallback_layout(inverters: dict[str, InverterData]) -> dict:
    """Panels grouped per phase in rows when Enlighten has no layout."""
    groups: dict[str, list[str]] = {}
    for serial, inv in sorted(inverters.items()):
        groups.setdefault(inv.phase or "", []).append(serial)
    arrays, top = [], 0.0
    for label in sorted(groups):
        serials = groups[label]
        per_row = min(8, max(1, len(serials)))
        modules = []
        for index, serial in enumerate(serials):
            row, col = divmod(index, per_row)
            modules.append(
                {
                    "serial": serial,
                    "x": col * 100 + 50,
                    "y": top + row * 200 + 100,
                    "w": 100,
                    "h": 200,
                }
            )
        rows = (len(serials) + per_row - 1) // per_row
        arrays.append({"label": label or "?", "modules": modules})
        top += rows * 200 + 120
    return {"system_id": None, "arrays": arrays}


class EnvoyLayoutSensor(EnvoyEntity, SensorEntity):
    """Panel layout for the dashboard card (positions + entity ids)."""

    _unrecorded_attributes = frozenset(
        {"arrays", "source", "system_id", "serial", "gateway", "layout_status"}
    )

    def _layout(self) -> tuple[dict, str]:
        layout = self.coordinator.layout
        if not layout:
            return _fallback_layout(self.coordinator.data.inverters), "phases"
        source = layout.get("source") or "enlighten"
        if source == "manual":
            # Microinverters added after drawing: put them below the drawing.
            placed = {m["serial"] for a in layout["arrays"] for m in a["modules"]}
            missing = {
                s: inv for s, inv in self.coordinator.data.inverters.items() if s not in placed
            }
            if missing:
                bottom = max(
                    (m["y"] + m["h"] / 2 for a in layout["arrays"] for m in a["modules"]),
                    default=0,
                )
                extra = _fallback_layout(missing)["arrays"]
                for arr in extra:
                    for mod in arr["modules"]:
                        mod["y"] += bottom + 120
                layout = {**layout, "arrays": [*layout["arrays"], *extra]}
        return layout, source

    @property
    def native_value(self) -> int:
        """Number of panels."""
        layout, _ = self._layout()
        return sum(len(a["modules"]) for a in layout["arrays"])

    @property
    def extra_state_attributes(self) -> dict:
        """Positions with the entities of each microinverter."""
        layout, source = self._layout()
        registry = er.async_get(self.hass)
        inverters = self.coordinator.data.inverters

        def entity(serial: str, platform: str, key: str) -> str | None:
            return registry.async_get_entity_id(platform, DOMAIN, f"{serial}_{key}")

        arrays = []
        for arr in layout["arrays"]:
            modules = []
            for mod in arr["modules"]:
                serial = mod.get("serial")
                inv = inverters.get(serial) if serial else None
                modules.append(
                    {
                        **{k: mod[k] for k in ("x", "y", "w", "h")},
                        "serial": serial,
                        "phase": inv.phase if inv else None,
                        "max": inv.max_power if inv else None,
                        "power": serial and entity(serial, "sensor", "inverter_power"),
                        "temperature": serial
                        and entity(serial, "sensor", "inverter_temperature"),
                        "efficiency": serial
                        and entity(serial, "sensor", "inverter_efficiency"),
                        "dc_power": serial and entity(serial, "sensor", "inverter_dc_power"),
                        "today": serial and entity(serial, "sensor", "inverter_energy_today"),
                        "producing": serial
                        and entity(serial, "binary_sensor", "inverter_producing"),
                        "performance": serial
                        and entity(serial, "sensor", "inverter_performance"),
                        "performance_week": serial
                        and entity(serial, "sensor", "inverter_performance_week"),
                        "underperforming": serial
                        and entity(serial, "binary_sensor", "inverter_underperforming"),
                        "no_output": serial
                        and entity(serial, "binary_sensor", "inverter_no_output"),
                    }
                )
            arrays.append({"label": arr.get("label"), "modules": modules})
        gateway_keys = {
            "production_power": "sensor",
            "production_today": "sensor",
            "production_lifetime": "sensor",
            "consumption_power": "sensor",
            "consumption_today": "sensor",
            "net_power": "sensor",
            "grid_import_today": "sensor",
            "grid_export_today": "sensor",
            "self_consumption_today": "sensor",
            "self_sufficiency_today": "sensor",
            "active_inverters": "sensor",
            "token_expires": "sensor",
            "last_reading": "sensor",
            "cloud_connected": "binary_sensor",
            "refresh": "button",
        }
        gateway = {
            key: registry.async_get_entity_id(platform, DOMAIN, f"{self._serial}_{key}")
            for key, platform in gateway_keys.items()
        }
        return {
            "source": source,
            "system_id": layout.get("system_id"),
            "serial": self._serial,
            "gateway": {k: v for k, v in gateway.items() if v},
            "arrays": arrays,
            "layout_status": self.coordinator.layout_status,
        }


class EnvoyTokenSensor(EnvoyEntity, SensorEntity):
    """When the token expires."""

    @property
    def native_value(self) -> datetime | None:
        """Expiry time."""
        return self.coordinator.client.token_expires

    @property
    def extra_state_attributes(self) -> dict[str, str | bool | None]:
        """Whether the token can be renewed automatically."""
        return {
            "automatic_renewal": self.coordinator.client.has_credentials,
            "last_error": self.coordinator.last_token_error,
        }


def _inverter_supported(desc: InverterSensorDescription, inv: InverterData) -> bool:
    """Only create what this gateway reports for this inverter."""
    if desc.key == "inverter_power":
        return True
    if desc.key in ("inverter_efficiency", "inverter_dc_power"):
        return inv.dc_voltage is not None
    if desc.key in ("inverter_performance", "inverter_performance_week"):
        return inv.energy_today is not None
    return desc.value_fn(inv) is not None


class EnvoyInverterEntity(CoordinatorEntity[EnvoyCoordinator]):
    """Entity on a microinverter device."""

    _attr_has_entity_name = True

    def __init__(
        self,
        coordinator: EnvoyCoordinator,
        description,
        serial: str,
    ) -> None:
        """Initialise."""
        super().__init__(coordinator)
        self.entity_description = description
        self._inverter = serial
        self._attr_unique_id = f"{serial}_{description.key}"
        inv = coordinator.data.inverters.get(serial)
        details = coordinator.inverter_details.get(serial, {})
        self._attr_device_info = child_device_info(
            coordinator,
            serial,
            name=f"Microinverter {serial}",
            model=((coordinator.layout or {}).get("models") or {}).get(serial)
            or details.get("model")
            or "Microinverter",
            sw_version=(inv.firmware if inv else None) or details.get("firmware"),
            model_id=details.get("part_number"),
        )

    @property
    def _data(self) -> InverterData | None:
        return self.coordinator.data.inverters.get(self._inverter)

    @property
    def available(self) -> bool:
        """Only while the gateway still reports this inverter."""
        return super().available and self._data is not None


class EnvoyInverterSensor(EnvoyInverterEntity, SensorEntity):
    """Sensor of one microinverter."""

    entity_description: InverterSensorDescription

    @property
    def native_value(self) -> float | str | datetime | None:
        """Current value."""
        data = self._data
        return None if data is None else self.entity_description.value_fn(data)

    @property
    def extra_state_attributes(self) -> dict | None:
        """Status flags of the gateway for this inverter on the power sensor."""
        if self.entity_description.key != "inverter_power" or self._data is None:
            return None
        return {"status": self._data.status, "part_number": self._data.part_number}
