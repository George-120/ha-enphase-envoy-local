"""Constants for the Enphase Envoy Local integration."""

from __future__ import annotations

from datetime import timedelta
from typing import Final

DOMAIN: Final = "enphase_envoy_local"
MANUFACTURER: Final = "Enphase"

CONF_SERIAL: Final = "serial"
CONF_TOKEN: Final = "token"
CONF_FIRMWARE: Final = "firmware"

CONF_SCAN_INTERVAL: Final = "scan_interval"
CONF_INVERTER_SENSORS: Final = "inverter_sensors"

DEFAULT_SCAN_INTERVAL: Final = 10  # seconds
MIN_SCAN_INTERVAL: Final = 5
MAX_SCAN_INTERVAL: Final = 300

# Per-microinverter data only changes every ~5 minutes on the gateway.
INVERTER_INTERVAL: Final = timedelta(minutes=1)

# Renew the token when it expires within this window.
TOKEN_RENEW_BEFORE: Final = timedelta(days=30)

# Back-off between Enlighten login attempts after temporary failures (minutes).
LOGIN_BACKOFF_MINUTES: Final = (1, 2, 5, 10, 30, 60)

CONF_UNDERPERFORM_THRESHOLD: Final = "underperform_threshold"
CONF_LIVE_ESTIMATE: Final = "live_estimate"  # live power per panel from the production meter
CONF_FORECAST: Final = "forecast"  # calibrated solar forecast via Open-Meteo
FORECAST_INTERVAL: Final = timedelta(minutes=30)
DEFAULT_UNDERPERFORM_THRESHOLD: Final = 90  # % of the median of the same roof surface
NO_OUTPUT_ALERT: Final = timedelta(minutes=30)
CLOUD_OFFLINE_ALERT: Final = timedelta(hours=6)
