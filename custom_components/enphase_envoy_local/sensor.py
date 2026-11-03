"""Sensors for Enphase Envoy Local."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorEntityDescription,
    SensorStateClass,
)
from homeassistant.const import (
    PERCENTAGE,
    UnitOfApparentPower,
    UnitOfReactivePower,
    UnitOfTime,
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
        "grid_phase_voltage",
        lambda d: d.grid_phases,
        lambda p: p.voltage,
        UnitOfElectricPotential.VOLT,
        SensorDeviceClass.VOLTAGE,
        1,
    ),
    _phase(
        "grid_phase_current",
        lambda d: d.grid_phases,
        lambda p: p.current,
        UnitOfElectricCurrent.AMPERE,
        SensorDeviceClass.CURRENT,
        2,
    ),
    _phase(
        "grid_phase_power_factor",
        lambda d: d.grid_phases,
        lambda p: p.power_factor,
        None,
        SensorDeviceClass.POWER_FACTOR,
        2,
    ),
    _phase(
        "grid_phase_reactive_power",
        lambda d: d.grid_phases,
        lambda p: p.reactive_power,
        UnitOfReactivePower.VOLT_AMPERE_REACTIVE,
        SensorDeviceClass.REACTIVE_POWER,
        0,
        entity_registry_enabled_default=False,
    ),
    _phase(
        "grid_phase_apparent_power",
        lambda d: d.grid_phases,
        lambda p: p.apparent_power,
        UnitOfApparentPower.VOLT_AMPERE,
        SensorDeviceClass.APPARENT_POWER,
        0,
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

@dataclass(frozen=True, kw_only=True)
class ForecastSensorDescription(SensorEntityDescription):
    """Sensor from the solar forecast."""

    value_fn: Callable[[Any], float | None]


FORECAST_SENSORS: tuple[ForecastSensorDescription, ...] = (
    ForecastSensorDescription(
        key="forecast_today",
        translation_key="forecast_today",
        native_unit_of_measurement=UnitOfEnergy.KILO_WATT_HOUR,
        device_class=SensorDeviceClass.ENERGY,
        suggested_display_precision=1,
        value_fn=lambda f: f.today,
    ),
    ForecastSensorDescription(
        key="forecast_tomorrow",
        translation_key="forecast_tomorrow",
        native_unit_of_measurement=UnitOfEnergy.KILO_WATT_HOUR,
        device_class=SensorDeviceClass.ENERGY,
        suggested_display_precision=1,
        value_fn=lambda f: f.tomorrow,
    ),
    ForecastSensorDescription(
        key="forecast_day_after",
        translation_key="forecast_day_after",
        native_unit_of_measurement=UnitOfEnergy.KILO_WATT_HOUR,
        device_class=SensorDeviceClass.ENERGY,
        suggested_display_precision=1,
        entity_registry_enabled_default=False,
        value_fn=lambda f: f.day_after,
    ),
    ForecastSensorDescription(
        key="forecast_remaining_today",
        translation_key="forecast_remaining_today",
        native_unit_of_measurement=UnitOfEnergy.KILO_WATT_HOUR,
        device_class=SensorDeviceClass.ENERGY,
        suggested_display_precision=1,
        value_fn=lambda f: None if f.today is None else max(0.0, round(f.today - (f.so_far or 0), 2)),
    ),
    ForecastSensorDescription(
        key="forecast_power_now",
        translation_key="forecast_power_now",
        native_unit_of_measurement=UnitOfPower.WATT,
        device_class=SensorDeviceClass.POWER,
        state_class=SensorStateClass.MEASUREMENT,
        suggested_display_precision=0,
        value_fn=lambda f: f.power_now,
    ),
)

FORECAST_VS_ACTUAL = SensorEntityDescription(
    key="forecast_performance",
    translation_key="forecast_performance",
    native_unit_of_measurement=PERCENTAGE,
    state_class=SensorStateClass.MEASUREMENT,
    suggested_display_precision=0,
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

def _inverters_with_dc(d: EnvoyData) -> list[InverterData]:
    # Only microinverters that produce now: at night the last reports are stale.
    return [
        i for i in d.inverters.values()
        if i.dc_power is not None and i.power is not None and i.power > 0
    ]


def _dc_total(d: EnvoyData) -> float | None:
    invs = _inverters_with_dc(d)
    return round(sum(i.dc_power for i in invs), 0) if invs else None


def _losses(d: EnvoyData) -> float | None:
    invs = _inverters_with_dc(d)
    if not invs:
        return 0.0 if d.inverters else None
    return round(max(0.0, sum(i.dc_power - i.power for i in invs if i.dc_power >= 10)), 1)


def _fleet_efficiency(d: EnvoyData) -> float | None:
    invs = [i for i in _inverters_with_dc(d) if i.dc_power >= 10]
    dc = sum(i.dc_power for i in invs)
    if dc < 50:
        return None
    return round(min(100.0, sum(i.power for i in invs) / dc * 100), 1)


def _temps(d: EnvoyData) -> list[float]:
    return [i.temperature for i in d.inverters.values() if i.temperature is not None]


def _oldest_report(d: EnvoyData) -> float | None:
    times = [i.last_report for i in d.inverters.values() if i.last_report]
    if not times:
        return None
    return round((datetime.now(tz=min(times).tzinfo) - min(times)).total_seconds() / 60, 1)


def _imbalance(d: EnvoyData) -> float | None:
    currents = [p.current for p in d.grid_phases if p.current is not None]
    return round(max(currents) - min(currents), 2) if len(currents) >= 2 else None


def _volt(key: str, value_fn: ValueFn, **kw) -> EnvoySensorDescription:
    return EnvoySensorDescription(
        key=key,
        translation_key=key,
        native_unit_of_measurement=UnitOfElectricPotential.VOLT,
        device_class=SensorDeviceClass.VOLTAGE,
        state_class=SensorStateClass.MEASUREMENT,
        suggested_display_precision=1,
        value_fn=value_fn,
        exists_fn=lambda d: bool(d.grid_phases or d.production_phases),
        **kw,
    )


# For the curious: everything the meters and microinverters tell us.
NERD_SENSORS: tuple[EnvoySensorDescription, ...] = (
    _volt("grid_voltage_max_today", lambda d: d.grid_voltage_max_today),
    _volt("grid_voltage_min_today", lambda d: d.grid_voltage_min_today),
    EnvoySensorDescription(
        key="grid_voltage_max_time",
        translation_key="grid_voltage_max_time",
        device_class=SensorDeviceClass.TIMESTAMP,
        entity_category=EntityCategory.DIAGNOSTIC,
        value_fn=lambda d: d.grid_voltage_max_time,
        exists_fn=lambda d: bool(d.grid_phases or d.production_phases),
    ),
    EnvoySensorDescription(
        key="minutes_above_250v_today",
        translation_key="minutes_above_250v_today",
        native_unit_of_measurement=UnitOfTime.MINUTES,
        device_class=SensorDeviceClass.DURATION,
        state_class=SensorStateClass.MEASUREMENT,
        suggested_display_precision=0,
        value_fn=lambda d: d.minutes_above_250v_today,
        exists_fn=lambda d: bool(d.grid_phases or d.production_phases),
    ),
    _power("peak_power_today", lambda d: d.peak_power_today),
    EnvoySensorDescription(
        key="peak_power_time",
        translation_key="peak_power_time",
        device_class=SensorDeviceClass.TIMESTAMP,
        value_fn=lambda d: d.peak_power_time,
        exists_fn=lambda d: d.production_power is not None,
    ),
    EnvoySensorDescription(
        key="frequency_min_today",
        translation_key="frequency_min_today",
        native_unit_of_measurement=UnitOfFrequency.HERTZ,
        device_class=SensorDeviceClass.FREQUENCY,
        state_class=SensorStateClass.MEASUREMENT,
        suggested_display_precision=2,
        entity_category=EntityCategory.DIAGNOSTIC,
        value_fn=lambda d: d.frequency_min_today,
        exists_fn=lambda d: d.frequency is not None,
    ),
    EnvoySensorDescription(
        key="frequency_max_today",
        translation_key="frequency_max_today",
        native_unit_of_measurement=UnitOfFrequency.HERTZ,
        device_class=SensorDeviceClass.FREQUENCY,
        state_class=SensorStateClass.MEASUREMENT,
        suggested_display_precision=2,
        entity_category=EntityCategory.DIAGNOSTIC,
        value_fn=lambda d: d.frequency_max_today,
        exists_fn=lambda d: d.frequency is not None,
    ),
    EnvoySensorDescription(
        key="grid_reactive_power",
        translation_key="grid_reactive_power",
        native_unit_of_measurement=UnitOfReactivePower.VOLT_AMPERE_REACTIVE,
        device_class=SensorDeviceClass.REACTIVE_POWER,
        state_class=SensorStateClass.MEASUREMENT,
        suggested_display_precision=0,
        value_fn=lambda d: d.grid_reactive_power,
        exists_fn=lambda d: d.grid_reactive_power is not None,
    ),
    EnvoySensorDescription(
        key="grid_apparent_power",
        translation_key="grid_apparent_power",
        native_unit_of_measurement=UnitOfApparentPower.VOLT_AMPERE,
        device_class=SensorDeviceClass.APPARENT_POWER,
        state_class=SensorStateClass.MEASUREMENT,
        suggested_display_precision=0,
        value_fn=lambda d: d.grid_apparent_power,
        exists_fn=lambda d: d.grid_apparent_power is not None,
    ),
    EnvoySensorDescription(
        key="production_reactive_power",
        translation_key="production_reactive_power",
        native_unit_of_measurement=UnitOfReactivePower.VOLT_AMPERE_REACTIVE,
        device_class=SensorDeviceClass.REACTIVE_POWER,
        state_class=SensorStateClass.MEASUREMENT,
        suggested_display_precision=0,
        value_fn=lambda d: d.production_reactive_power,
        exists_fn=lambda d: d.production_reactive_power is not None,
    ),
    EnvoySensorDescription(
        key="production_apparent_power",
        translation_key="production_apparent_power",
        native_unit_of_measurement=UnitOfApparentPower.VOLT_AMPERE,
        device_class=SensorDeviceClass.APPARENT_POWER,
        state_class=SensorStateClass.MEASUREMENT,
        suggested_display_precision=0,
        value_fn=lambda d: d.production_apparent_power,
        exists_fn=lambda d: d.production_apparent_power is not None,
    ),
    EnvoySensorDescription(
        key="production_power_factor",
        translation_key="production_power_factor",
        device_class=SensorDeviceClass.POWER_FACTOR,
        state_class=SensorStateClass.MEASUREMENT,
        suggested_display_precision=2,
        value_fn=lambda d: d.production_power_factor,
        exists_fn=lambda d: d.production_apparent_power is not None,
    ),
    EnvoySensorDescription(
        key="phase_imbalance",
        translation_key="phase_imbalance",
        native_unit_of_measurement=UnitOfElectricCurrent.AMPERE,
        device_class=SensorDeviceClass.CURRENT,
        state_class=SensorStateClass.MEASUREMENT,
        suggested_display_precision=1,
        value_fn=_imbalance,
        exists_fn=lambda d: len(d.grid_phases) >= 2,
    ),
    EnvoySensorDescription(
        key="inverters_dc_power",
        translation_key="inverters_dc_power",
        native_unit_of_measurement=UnitOfPower.WATT,
        device_class=SensorDeviceClass.POWER,
        state_class=SensorStateClass.MEASUREMENT,
        suggested_display_precision=0,
        value_fn=lambda d: _dc_total(d) if _inverters_with_dc(d) else (0.0 if d.inverters else None),
        exists_fn=lambda d: any(i.dc_voltage is not None for i in d.inverters.values()),
    ),
    EnvoySensorDescription(
        key="conversion_losses",
        translation_key="conversion_losses",
        native_unit_of_measurement=UnitOfPower.WATT,
        device_class=SensorDeviceClass.POWER,
        state_class=SensorStateClass.MEASUREMENT,
        suggested_display_precision=0,
        value_fn=_losses,
        exists_fn=lambda d: any(i.dc_voltage is not None for i in d.inverters.values()),
    ),
    EnvoySensorDescription(
        key="fleet_efficiency",
        translation_key="fleet_efficiency",
        native_unit_of_measurement=PERCENTAGE,
        state_class=SensorStateClass.MEASUREMENT,
        suggested_display_precision=1,
        value_fn=_fleet_efficiency,
        exists_fn=lambda d: any(i.dc_voltage is not None for i in d.inverters.values()),
    ),
    EnvoySensorDescription(
        key="inverter_temperature_avg",
        translation_key="inverter_temperature_avg",
        native_unit_of_measurement=UnitOfTemperature.CELSIUS,
        device_class=SensorDeviceClass.TEMPERATURE,
        state_class=SensorStateClass.MEASUREMENT,
        suggested_display_precision=1,
        value_fn=lambda d: round(sum(_temps(d)) / len(_temps(d)), 1) if _temps(d) else None,
        exists_fn=lambda d: bool(_temps(d)),
    ),
    EnvoySensorDescription(
        key="inverter_temperature_max",
        translation_key="inverter_temperature_max",
        native_unit_of_measurement=UnitOfTemperature.CELSIUS,
        device_class=SensorDeviceClass.TEMPERATURE,
        state_class=SensorStateClass.MEASUREMENT,
        suggested_display_precision=0,
        value_fn=lambda d: max(_temps(d)) if _temps(d) else None,
        exists_fn=lambda d: bool(_temps(d)),
    ),
    EnvoySensorDescription(
        key="oldest_inverter_report",
        translation_key="oldest_inverter_report",
        native_unit_of_measurement=UnitOfTime.MINUTES,
        device_class=SensorDeviceClass.DURATION,
        state_class=SensorStateClass.MEASUREMENT,
        suggested_display_precision=0,
        entity_category=EntityCategory.DIAGNOSTIC,
        value_fn=_oldest_report,
        exists_fn=lambda d: bool(d.inverters),
    ),
    EnvoySensorDescription(
        key="response_time",
        translation_key="response_time",
        native_unit_of_measurement=UnitOfTime.MILLISECONDS,
        device_class=SensorDeviceClass.DURATION,
        state_class=SensorStateClass.MEASUREMENT,
        suggested_display_precision=0,
        entity_category=EntityCategory.DIAGNOSTIC,
        value_fn=lambda d: d.response_time,
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
    for desc in (*SENSORS, *NETWORK_SENSORS, *NERD_SENSORS):
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
    if coordinator.forecast is not None:
        entities.extend(EnvoyForecastSensor(coordinator, desc) for desc in FORECAST_SENSORS)
        entities.append(EnvoyForecastPerformanceSensor(coordinator, FORECAST_VS_ACTUAL))
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
                        "dc_voltage": serial and entity(serial, "sensor", "inverter_dc_voltage"),
                        "dc_current": serial and entity(serial, "sensor", "inverter_dc_current"),
                        "ac_voltage": serial and entity(serial, "sensor", "inverter_ac_voltage"),
                        "last_report": serial and entity(serial, "sensor", "inverter_last_report"),
                        "lifetime": serial and entity(serial, "sensor", "inverter_energy_lifetime"),
                        "signal": serial and entity(serial, "sensor", "inverter_signal"),
                        "firmware": inv.firmware if inv else None,
                    }
                )
            arrays.append(
                {
                    "label": arr.get("label"),
                    "tilt": arr.get("tilt"),
                    "azimuth": arr.get("azimuth"),
                    "modules": modules,
                }
            )
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
            "forecast_today": "sensor",
            "forecast_tomorrow": "sensor",
            "forecast_power_now": "sensor",
            "forecast_performance": "sensor",
        }
        gateway_keys.update(
            {
                key: "sensor"
                for key in (
                    "grid_voltage_max_today", "grid_voltage_min_today", "minutes_above_250v_today",
                    "peak_power_today", "peak_power_time", "grid_voltage_max_time", "frequency", "power_factor",
                    "frequency_min_today", "frequency_max_today",
                    "grid_reactive_power", "grid_apparent_power", "phase_imbalance",
                    "inverters_dc_power", "conversion_losses", "fleet_efficiency",
                    "inverter_temperature_avg", "inverter_temperature_max", "oldest_inverter_report",
                    "grid_import_lifetime", "grid_export_lifetime", "consumption_lifetime",
                )
            }
        )
        for key in (
            "grid_phase_voltage", "grid_phase_current", "grid_phase_power_factor",
            "net_phase_power", "production_phase_power", "consumption_phase_power",
            "production_phase_voltage",
        ):
            for phase in PHASE_NAMES:
                gateway_keys[f"{key}_{phase.lower()}"] = "sensor"
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


class EnvoyForecastSensor(EnvoyEntity, SensorEntity):
    """Expected production from the calibrated solar forecast."""

    entity_description: ForecastSensorDescription
    _unrecorded_attributes = frozenset({"hourly", "calibration", "updated", "error"})

    @property
    def available(self) -> bool:
        """Available once a forecast was computed."""
        return super().available and self.coordinator.forecast.data.updated is not None

    @property
    def native_value(self) -> float | None:
        """Value."""
        return self.entity_description.value_fn(self.coordinator.forecast.data)

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        """The hourly forecast on the 'today' sensor (used by the cards)."""
        if self.entity_description.key != "forecast_today":
            return None
        fc = self.coordinator.forecast
        return {
            "hourly": fc.hourly_attribute(),
            "calibration": fc.data.calibration,
            "updated": fc.data.updated.isoformat() if fc.data.updated else None,
            "error": fc.data.error,
        }


class EnvoyForecastPerformanceSensor(EnvoyEntity, SensorEntity):
    """Production so far today compared with what the forecast expected so far."""

    @property
    def native_value(self) -> float | None:
        """Percentage."""
        expected = self.coordinator.forecast.data.so_far
        actual = self.coordinator.data.production_today if self.coordinator.data else None
        if not expected or expected < 0.2 or actual is None:
            return None
        return round(actual / 1000 / expected * 100, 0)


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
