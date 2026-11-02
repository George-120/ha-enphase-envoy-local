"""Data update coordinator for Enphase Envoy Local."""

from __future__ import annotations

from datetime import datetime, timedelta
import logging

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_HOST, CONF_PASSWORD, CONF_USERNAME
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import ConfigEntryAuthFailed, HomeAssistantError
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers import issue_registry as ir
from homeassistant.helpers.storage import Store
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed
from homeassistant.util import dt as dt_util

from .api import (
    EnlightenAuthError,
    EnlightenError,
    EnvoyAuthError,
    EnvoyClient,
    EnvoyData,
    EnvoyError,
    merge_device_data,
    merge_inventory,
    parse_home,
    parse_production,
)
from .health import AlertTracker, apply_health
from .const import (
    CLOUD_OFFLINE_ALERT,
    CONF_UNDERPERFORM_THRESHOLD,
    DEFAULT_UNDERPERFORM_THRESHOLD,
    NO_OUTPUT_ALERT,
    CONF_FIRMWARE,
    CONF_INVERTER_SENSORS,
    CONF_SCAN_INTERVAL,
    CONF_SERIAL,
    CONF_TOKEN,
    DEFAULT_SCAN_INTERVAL,
    DOMAIN,
    INVERTER_INTERVAL,
    LOGIN_BACKOFF_MINUTES,
    TOKEN_RENEW_BEFORE,
)

_LOGGER = logging.getLogger(__name__)

STORAGE_VERSION = 1
METER_RETRY = timedelta(minutes=15)
INVENTORY_INTERVAL = timedelta(minutes=15)
SLOW_INTERVAL = timedelta(minutes=5)
LAYOUT_MAX_AGE = timedelta(days=7)

# (name, lifetime attribute, today attribute) of the counters that get a
# "today" value computed from the lifetime counter when the gateway has none.
DAILY_COUNTERS = (
    ("production", "production_lifetime", "production_today"),
    ("consumption", "consumption_lifetime", "consumption_today"),
    ("grid_import", "grid_import_lifetime", "grid_import_today"),
    ("grid_export", "grid_export_lifetime", "grid_export_today"),
)

type EnvoyConfigEntry = ConfigEntry[EnvoyCoordinator]


class EnvoyCoordinator(DataUpdateCoordinator[EnvoyData]):
    """Polls the gateway and keeps the token valid."""

    config_entry: EnvoyConfigEntry

    def __init__(self, hass: HomeAssistant, entry: EnvoyConfigEntry) -> None:
        """Initialise."""
        interval = entry.options.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL)
        super().__init__(
            hass,
            _LOGGER,
            config_entry=entry,
            name=f"{DOMAIN} {entry.data.get(CONF_SERIAL)}",
            update_interval=timedelta(seconds=interval),
        )
        self.client = EnvoyClient(
            async_get_clientsession(hass, verify_ssl=False),
            None,
            entry.data[CONF_HOST],
            serial=entry.data.get(CONF_SERIAL),
            firmware=entry.data.get(CONF_FIRMWARE),
            username=entry.data.get(CONF_USERNAME),
            password=entry.data.get(CONF_PASSWORD),
            token=entry.data.get(CONF_TOKEN),
        )
        self.options_snapshot = dict(entry.options)
        self.inverter_sensors: bool = entry.options.get(CONF_INVERTER_SENSORS, True)
        self._next_login: datetime | None = None
        self._login_failures = 0
        self._last_inverters: list | None = None
        self._inverters_read: datetime | None = None
        self.last_token_error: str | None = None
        self._meters_next: datetime | None = None
        self._last_meters: tuple[list, list] | None = None
        self._store: Store[dict] = Store(
            hass, STORAGE_VERSION, f"{DOMAIN}.{entry.entry_id}.daily"
        )
        self._daily: dict = {}
        self.layout: dict | None = None
        self.layout_status: str | None = None
        self.forecast = None  # SolarForecast, set up in __init__ when enabled
        self._alerts = AlertTracker()
        self._issues: set[str] = set()
        self._layout_store: Store[dict] = Store(
            hass, STORAGE_VERSION, f"{DOMAIN}.{entry.entry_id}.layout"
        )
        self.info: dict[str, str | None] = {}
        self.inverter_details: dict[str, dict] = {}
        self._inventory_read: datetime | None = None
        self._last_device_data: dict | None = None
        self._last_home: dict | None = None
        self._last_pel: bool | None = None
        self._last_power_mode: bool | None = None
        self._slow_read: datetime | None = None
        self.gateway_device_id: str | None = None

    async def _async_setup(self) -> None:
        """Load day counters; refresh serial/firmware (an update may need a token)."""
        self._daily = await self._store.async_load() or {}
        self.layout = await self._layout_store.async_load()
        await self._async_read_inventory()
        try:
            info = await self.client.async_get_info()
        except EnvoyError as err:
            _LOGGER.debug("Could not read /info at startup: %s", err)
            return
        self.info = info
        if info.get("firmware") and info["firmware"] != self.config_entry.data.get(
            CONF_FIRMWARE
        ):
            self.hass.config_entries.async_update_entry(
                self.config_entry,
                data={**self.config_entry.data, CONF_FIRMWARE: info["firmware"]},
            )

    # ------------------------------------------------------------------ token
    def _store_token(self) -> None:
        """Persist a new token in the config entry."""
        if self.client.token != self.config_entry.data.get(CONF_TOKEN):
            self.hass.config_entries.async_update_entry(
                self.config_entry,
                data={**self.config_entry.data, CONF_TOKEN: self.client.token},
            )

    async def _async_renew_token(self, *, reason: str) -> bool:
        """Get a new token. Returns True on success.

        Rejected credentials start a re-authentication flow and are never
        retried by themselves, so the Enlighten account cannot get locked.
        Temporary failures back off 1, 2, 5, 10, 30 and 60 minutes.
        """
        now = dt_util.utcnow()
        if self._next_login and now < self._next_login:
            return False
        _LOGGER.debug("Requesting a new token from Enlighten (%s)", reason)
        try:
            await self.client.async_fetch_token()
        except EnlightenAuthError as err:
            self.last_token_error = str(err)
            raise ConfigEntryAuthFailed(str(err)) from err
        except EnlightenError as err:
            self.last_token_error = str(err)
            wait = LOGIN_BACKOFF_MINUTES[
                min(self._login_failures, len(LOGIN_BACKOFF_MINUTES) - 1)
            ]
            self._login_failures += 1
            self._next_login = now + timedelta(minutes=wait)
            _LOGGER.warning(
                "Could not get a token from Enlighten, retrying in %s min: %s",
                wait,
                err,
            )
            return False
        self._login_failures = 0
        self._next_login = None
        self.last_token_error = None
        self._store_token()
        return True

    async def _async_ensure_token(self) -> None:
        """Make sure there is a token that is not about to expire."""
        if not self.client.requires_token:
            return
        expires = self.client.token_expires
        now = dt_util.utcnow()
        if self.client.token and (expires is None or expires - now > TOKEN_RENEW_BEFORE):
            # Unknown expiry: keep using it; a 401 will trigger renewal.
            return
        if not self.client.has_credentials:
            if not self.client.token or (expires and expires <= now):
                raise ConfigEntryAuthFailed(
                    "The token has expired; enter a new token or Enlighten credentials"
                )
            return  # still valid for a while; nothing we can do automatically
        renewed = await self._async_renew_token(reason="token missing or expiring")
        if not renewed and (not self.client.token or (expires and expires <= now)):
            raise UpdateFailed(
                f"No valid token yet: {self.last_token_error or 'waiting to retry'}"
            )

    # ------------------------------------------------------------------- data
    async def _async_update_data(self) -> EnvoyData:
        """Fetch data from the gateway."""
        await self._async_ensure_token()
        try:
            try:
                production = await self.client.async_get_production()
            except EnvoyAuthError:
                # Token revoked or replaced: get a new one once, then retry.
                if not self.client.has_credentials:
                    raise ConfigEntryAuthFailed(
                        "The gateway rejected the token"
                    ) from None
                if not await self._async_renew_token(reason="token rejected"):
                    raise UpdateFailed(
                        f"Token rejected, renewing failed: {self.last_token_error}"
                    ) from None
                production = await self.client.async_get_production()

            api_v1 = await self.client.async_get_api_v1()

            now = dt_util.utcnow()
            if self.inverter_sensors and (
                self._inverters_read is None
                or now - self._inverters_read >= INVERTER_INTERVAL
            ):
                inverters = await self.client.async_get_inverters()
                if inverters is not None:
                    self._last_inverters = inverters
                device_data = await self.client.async_get_optional(
                    "/ivp/pdm/device_data"
                )
                if isinstance(device_data, dict):
                    self._last_device_data = device_data
                self._inverters_read = now
        except EnvoyAuthError as err:
            raise ConfigEntryAuthFailed(str(err)) from err
        except EnvoyError as err:
            raise UpdateFailed(str(err)) from err

        now = dt_util.utcnow()
        if self._inventory_read is None or now - self._inventory_read >= INVENTORY_INTERVAL:
            await self._async_read_inventory()
        if self._meters_next is None or now >= self._meters_next:
            meters = await self.client.async_get_meters()
            if meters is None:
                # Not metered or older firmware: try again much later.
                self._meters_next = now + METER_RETRY
                self._last_meters = None
            else:
                self._meters_next = None
                self._last_meters = meters

        if self._slow_read is None or now - self._slow_read >= SLOW_INTERVAL:
            self._slow_read = now
            self._last_home = await self.client.async_get_optional("/home.json")
            pel = await self.client.async_get_optional("/ivp/ss/pel_settings")
            self._last_pel = pel.get("PEL") if isinstance(pel, dict) else None
            self._last_power_mode = await self.client.async_get_production_mode()

        data = parse_production(
            production,
            api_v1,
            self._last_inverters if self.inverter_sensors else None,
            *(self._last_meters or (None, None)),
        )
        if self.inverter_sensors:
            merge_device_data(data, self._last_device_data)
            merge_inventory(data, self.inverter_details)
            if data.production_today is None:
                today = [
                    i.energy_today
                    for i in data.inverters.values()
                    if i.energy_today is not None
                ]
                if today:
                    # Sum of the microinverters: correct from the first day on.
                    data.production_today = float(sum(today))
        data.network = parse_home(self._last_home)
        data.export_limit_enabled = (
            bool(self._last_pel) if self._last_pel is not None else None
        )
        data.production_forced_off = self._last_power_mode
        self._apply_daily(data)
        if self.inverter_sensors and data.inverters:
            apply_health(
                data,
                self.layout,
                self.config_entry.options.get(
                    CONF_UNDERPERFORM_THRESHOLD, DEFAULT_UNDERPERFORM_THRESHOLD
                ),
            )
        self._remember_efficiency(data)
        self._update_issues(data)
        return data

    def _remember_efficiency(self, data: EnvoyData) -> None:
        """Keep each panel's daylight efficiency for the hours without sun."""
        saved: dict[str, float] = self._daily.setdefault("efficiency", {})
        changed = False
        for serial, inv in data.inverters.items():
            live = inv.efficiency
            if live is not None:
                if saved.get(serial) != live:
                    saved[serial] = live
                    changed = True
                inv.last_efficiency = live
            else:
                inv.last_efficiency = saved.get(serial)
        if changed:
            self._store.async_delay_save(lambda: self._daily, 30)

    def _update_issues(self, data: EnvoyData) -> None:
        """Raise or clear repair issues (Settings > Repairs) for lasting problems."""
        now = dt_util.utcnow()
        wanted: dict[str, tuple[str, dict[str, str]]] = {}
        for serial, inv in data.inverters.items():
            where = inv.array or (inv.phase or "")
            if self._alerts.lasting(f"no_output_{serial}", bool(inv.no_output), now, NO_OUTPUT_ALERT):
                wanted[f"no_output_{serial}"] = (
                    "inverter_no_output",
                    {"serial": serial, "where": where},
                )
            if inv.underperforming:
                wanted[f"underperforming_{serial}"] = (
                    "inverter_underperforming",
                    {
                        "serial": serial,
                        "where": where,
                        "performance": f"{inv.performance_week or inv.performance or 0:.0f}",
                    },
                )
        if data.network and self._alerts.lasting(
            "cloud", data.network.cloud_connected is False, now, CLOUD_OFFLINE_ALERT
        ):
            wanted["cloud_offline"] = ("cloud_offline", {"serial": self.client.serial or ""})

        entry_id = self.config_entry.entry_id
        for key, (translation_key, placeholders) in wanted.items():
            ir.async_create_issue(
                self.hass,
                DOMAIN,
                f"{entry_id}_{key}",
                is_fixable=False,
                is_persistent=False,
                severity=ir.IssueSeverity.WARNING,
                translation_key=translation_key,
                translation_placeholders=placeholders,
            )
        for key in self._issues - set(wanted):
            ir.async_delete_issue(self.hass, DOMAIN, f"{entry_id}_{key}")
        self._issues = set(wanted)

    @callback
    def async_clear_issues(self) -> None:
        """Remove this gateway's repair issues (on unload)."""
        for key in self._issues:
            ir.async_delete_issue(
                self.hass, DOMAIN, f"{self.config_entry.entry_id}_{key}"
            )
        self._issues = set()

    @callback
    def async_schedule_layout_refresh(self) -> None:
        """Fetch the panel layout in the background when it is missing or old."""
        if (self.layout or {}).get("source") == "manual":
            self.layout_status = "manual"
            return
        if not self.client.has_credentials:
            if not self.layout:
                self.layout_status = "no Enlighten e-mail/password (token only)"
            return
        fetched = (self.layout or {}).get("fetched")
        if fetched and dt_util.utcnow() - dt_util.parse_datetime(fetched) < LAYOUT_MAX_AGE:
            return
        self.config_entry.async_create_background_task(
            self.hass, self._async_fetch_layout(), f"{DOMAIN} panel layout"
        )

    async def _async_fetch_layout(self) -> bool:
        serials = set(self.data.inverters) if self.data else set()
        try:
            layout = await self.client.async_fetch_layout(serials)
        except EnvoyError as err:
            _LOGGER.info("Panel layout not available from Enlighten: %s", err)
            self.layout_status = "; ".join(getattr(self.client, "layout_trace", None) or []) or str(err)
            self.async_update_listeners()
            return False
        if layout is None:
            self.layout_status = "; ".join(getattr(self.client, "layout_trace", None) or [])
            _LOGGER.info("Enlighten has no panel layout for this system: %s", self.layout_status)
            self.async_update_listeners()
            return False
        self.layout_status = "ok"
        layout["fetched"] = dt_util.utcnow().isoformat()
        self.layout = layout
        await self._layout_store.async_save(layout)
        self.async_update_listeners()
        return True

    async def async_set_manual_layout(self, arrays: list[dict]) -> None:
        """Store a layout the user drew in the card; it wins over Enlighten."""
        known = set(self.data.inverters) if self.data else set()
        clean, seen = [], set()
        for arr in arrays:
            modules = []
            for mod in arr.get("modules") or []:
                serial = str(mod.get("serial") or "")
                if serial not in known or serial in seen:
                    continue
                seen.add(serial)
                w, h = (200, 100) if float(mod.get("w", 100)) > float(mod.get("h", 200)) else (100, 200)
                modules.append(
                    {
                        "serial": serial,
                        "x": round(float(mod.get("x", 0)), 1),
                        "y": round(float(mod.get("y", 0)), 1),
                        "w": w,
                        "h": h,
                    }
                )
            if modules:
                clean.append({"label": str(arr.get("label") or "")[:40], "modules": modules})
        if not clean:
            raise HomeAssistantError(
                translation_domain=DOMAIN, translation_key="empty_layout"
            )
        self.layout = {
            "source": "manual",
            "system_id": (self.layout or {}).get("system_id"),
            "arrays": clean,
            "fetched": dt_util.utcnow().isoformat(),
        }
        self.layout_status = "manual"
        await self._layout_store.async_save(self.layout)
        self.async_update_listeners()

    async def async_reset_layout(self) -> None:
        """Forget the drawn layout and use Enlighten (or the phase grouping) again."""
        self.layout = None
        self.layout_status = None
        await self._layout_store.async_remove()
        self.async_update_listeners()
        self.async_schedule_layout_refresh()

    async def async_refresh_layout(self) -> None:
        """Fetch the panel layout now (button)."""
        if not self.client.has_credentials:
            raise HomeAssistantError(
                translation_domain=DOMAIN, translation_key="no_credentials"
            )
        if not await self._async_fetch_layout():
            raise HomeAssistantError(
                translation_domain=DOMAIN, translation_key="no_layout"
            )

    def force_full_refresh(self) -> None:
        """Next update reads everything again (refresh button)."""
        self._inverters_read = None
        self._inventory_read = None
        self._slow_read = None
        self._meters_next = None

    async def async_set_production(self, enabled: bool) -> None:
        """Switch production of all microinverters on or off."""
        try:
            await self.client.async_set_production(enabled)
        except EnvoyAuthError as err:
            raise HomeAssistantError(
                translation_domain=DOMAIN, translation_key="needs_installer"
            ) from err
        except EnvoyError as err:
            raise HomeAssistantError(
                translation_domain=DOMAIN,
                translation_key="command_failed",
                translation_placeholders={"error": str(err)},
            ) from err
        self._last_power_mode = not enabled
        self._slow_read = dt_util.utcnow()
        await self.async_request_refresh()

    async def async_renew_token(self) -> None:
        """Get a new token right now (button)."""
        if not self.client.has_credentials:
            raise HomeAssistantError(
                translation_domain=DOMAIN, translation_key="no_credentials"
            )
        self._next_login = None
        if not await self._async_renew_token(reason="requested by user"):
            raise HomeAssistantError(
                translation_domain=DOMAIN,
                translation_key="command_failed",
                translation_placeholders={"error": self.last_token_error or "?"},
            )
        await self.client.async_check_jwt()
        self.async_update_listeners()

    async def _async_read_inventory(self) -> None:
        """Part numbers, firmware and producing/communicating flags (hourly)."""
        inventory = await self.client.async_get_inventory()
        self._inventory_read = dt_util.utcnow()
        if inventory is not None:
            self.inverter_details = inventory

    def _apply_daily(self, data: EnvoyData) -> None:
        """Fill in 'today' from the lifetime counters, reset at local midnight.

        Firmware 8 reports the lifetime counter as 'today', and the meters have
        no daily counter at all, so the start-of-day value is kept on disk.
        """
        today = dt_util.now().date().isoformat()
        if self._daily.get("date") != today:
            self._daily = {
                "date": today,
                "base": {},
                "efficiency": self._daily.get("efficiency", {}),
            }
        base: dict[str, float] = self._daily.setdefault("base", {})
        changed = False
        for name, lifetime_attr, today_attr in DAILY_COUNTERS:
            lifetime = getattr(data, lifetime_attr)
            if lifetime is None:
                continue
            reported = getattr(data, today_attr)
            start = base.get(name)
            if reported is not None:
                start_from_device = lifetime - reported
                if start is None or abs(start - start_from_device) > 1:
                    base[name] = start_from_device
                    changed = True
                continue
            if start is None or lifetime < start:
                # First reading of the day (or the counter was reset).
                base[name] = start = lifetime
                changed = True
            setattr(data, today_attr, round(lifetime - start, 3))
        if changed:
            self._store.async_delay_save(lambda: self._daily, 30)
