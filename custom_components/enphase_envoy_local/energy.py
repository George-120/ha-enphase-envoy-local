"""Energy dashboard: the calibrated solar forecast of Enphase Envoy Local."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from homeassistant.core import HomeAssistant

from .const import DOMAIN


async def async_get_solar_forecast(
    hass: HomeAssistant, config_entry_id: str
) -> dict[str, dict[str, float]] | None:
    """Expected Wh per hour, keyed by the start of the hour."""
    entry = hass.config_entries.async_get_entry(config_entry_id)
    if entry is None or entry.domain != DOMAIN:
        return None
    coordinator: Any = getattr(entry, "runtime_data", None)
    forecast = getattr(coordinator, "forecast", None)
    if forecast is None or not forecast.data.hourly:
        return None
    return {
        "wh_hours": {
            (end - timedelta(hours=1)).isoformat(): wh
            for end, wh in forecast.data.hourly.items()
        }
    }
