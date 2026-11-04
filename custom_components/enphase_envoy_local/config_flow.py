"""Config flow for Enphase Envoy Local."""

from __future__ import annotations

from collections.abc import Mapping
import logging
from typing import Any

import voluptuous as vol

from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
    OptionsFlow,
)
from homeassistant.const import CONF_HOST, CONF_PASSWORD, CONF_USERNAME
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.selector import (
    BooleanSelector,
    EntitySelector,
    EntitySelectorConfig,
    NumberSelector,
    NumberSelectorConfig,
    NumberSelectorMode,
    TextSelector,
    TextSelectorConfig,
    TextSelectorType,
)

try:  # Home Assistant 2025.1+
    from homeassistant.helpers.service_info.zeroconf import ZeroconfServiceInfo
except ImportError:  # pragma: no cover - older cores
    from homeassistant.components.zeroconf import ZeroconfServiceInfo

from .api import (
    EnlightenAuthError,
    EnlightenError,
    EnvoyAuthError,
    EnvoyClient,
    EnvoyConnectionError,
    EnvoyError,
    token_expiry,
)
from .const import (
    CONF_FIRMWARE,
    CONF_FORECAST,
    CONF_EXT_GRID_EXPORT,
    CONF_EXT_GRID_IMPORT,
    CONF_EXT_GRID_INVERT,
    CONF_EXT_GRID_PHASES,
    CONF_EXT_GRID_POWER,
    CONF_EXT_PRODUCTION_POWER,
    CONF_LIVE_ESTIMATE,
    CONF_INVERTER_SENSORS,
    CONF_SCAN_INTERVAL,
    CONF_SERIAL,
    CONF_TOKEN,
    CONF_UNDERPERFORM_THRESHOLD,
    DEFAULT_SCAN_INTERVAL,
    DEFAULT_UNDERPERFORM_THRESHOLD,
    DOMAIN,
    MAX_SCAN_INTERVAL,
    MIN_SCAN_INTERVAL,
)

_LOGGER = logging.getLogger(__name__)

PASSWORD = TextSelector(TextSelectorConfig(type=TextSelectorType.PASSWORD))
EMAIL = TextSelector(
    TextSelectorConfig(type=TextSelectorType.EMAIL, autocomplete="username")
)


def _client(hass: HomeAssistant, host: str, **kwargs: Any) -> EnvoyClient:
    return EnvoyClient(
        async_get_clientsession(hass, verify_ssl=False),
        None,
        host,
        **kwargs,
    )


def _auth_schema(defaults: Mapping[str, Any]) -> vol.Schema:
    return vol.Schema(
        {
            vol.Optional(
                CONF_USERNAME,
                description={"suggested_value": defaults.get(CONF_USERNAME)},
            ): EMAIL,
            vol.Optional(CONF_PASSWORD): PASSWORD,
            vol.Optional(CONF_TOKEN): PASSWORD,
        }
    )


async def _validate_auth(
    hass: HomeAssistant,
    host: str,
    serial: str | None,
    firmware: str | None,
    user_input: Mapping[str, Any],
) -> tuple[dict[str, Any], dict[str, str]]:
    """Check the credentials or token. Returns (data, errors)."""
    username = (user_input.get(CONF_USERNAME) or "").strip()
    password = user_input.get(CONF_PASSWORD) or ""
    token = (user_input.get(CONF_TOKEN) or "").strip()

    if not token and not (username and password):
        return {}, {"base": "no_credentials"}

    client = _client(
        hass,
        host,
        serial=serial,
        firmware=firmware,
        username=username or None,
        password=password or None,
        token=token or None,
    )
    try:
        await client.async_get_info()
        if token:
            if token_expiry(token) is None:
                return {}, {CONF_TOKEN: "invalid_token"}
        else:
            await client.async_fetch_token()
        await client.async_get_production()
    except EnlightenAuthError as err:
        _LOGGER.warning("Enlighten refused: %s", err)
        if "two-factor" in str(err):
            return {}, {"base": "mfa_enabled"}
        if "serial" in str(err):
            return {}, {"base": "not_owner"}
        return {}, {"base": "invalid_auth"}
    except EnlightenError as err:
        _LOGGER.warning("Enlighten unavailable: %s", err)
        return {}, {"base": "enlighten_unavailable"}
    except EnvoyAuthError:
        return {}, {"base": "token_rejected"}
    except EnvoyConnectionError:
        return {}, {"base": "cannot_connect"}
    except EnvoyError as err:
        _LOGGER.exception("Unexpected answer from the gateway: %s", err)
        return {}, {"base": "unknown"}

    return {
        CONF_USERNAME: username or None,
        CONF_PASSWORD: password or None,
        CONF_TOKEN: client.token,
        CONF_SERIAL: client.serial,
        CONF_FIRMWARE: client.firmware,
    }, {}


class EnvoyLocalConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle a config flow."""

    VERSION = 1

    def __init__(self) -> None:
        """Initialise."""
        self._host: str | None = None
        self._serial: str | None = None
        self._firmware: str | None = None

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        """Options flow."""
        return EnvoyLocalOptionsFlow()

    # ------------------------------------------------------------- discovery
    async def async_step_zeroconf(
        self, discovery_info: ZeroconfServiceInfo
    ) -> ConfigFlowResult:
        """Gateway found on the network."""
        if discovery_info.ip_address.version != 4:
            return self.async_abort(reason="not_ipv4_address")
        serial = discovery_info.properties.get("serialnum")
        if not serial:
            return self.async_abort(reason="cannot_connect")
        await self.async_set_unique_id(serial)
        self._abort_if_unique_id_configured(updates={CONF_HOST: discovery_info.host})
        self._host = discovery_info.host
        self._serial = serial
        self._firmware = discovery_info.properties.get("protovers")
        self.context["title_placeholders"] = {"serial": serial}
        # Let the user confirm the (pre-filled) address before anything is created.
        return await self.async_step_user()

    # ------------------------------------------------------------------ user
    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Ask for the address of the gateway."""
        errors: dict[str, str] = {}
        if user_input is not None:
            host = user_input[CONF_HOST].strip()
            client = _client(self.hass, host)
            try:
                info = await client.async_get_info()
            except EnvoyConnectionError:
                errors["base"] = "cannot_connect"
            except EnvoyError:
                errors["base"] = "not_an_envoy"
            else:
                if not info["serial"]:
                    errors["base"] = "not_an_envoy"
                else:
                    await self.async_set_unique_id(info["serial"])
                    self._abort_if_unique_id_configured(updates={CONF_HOST: host})
                    self._host = host
                    self._serial = info["serial"]
                    self._firmware = info["firmware"]
                    if client.requires_token:
                        return await self.async_step_auth()
                    return self._create()

        return self.async_show_form(
            step_id="user",
            data_schema=self.add_suggested_values_to_schema(
                vol.Schema({vol.Required(CONF_HOST): str}),
                user_input or {CONF_HOST: self._host or ""},
            ),
            errors=errors,
        )

    async def async_step_auth(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Ask for Enlighten credentials or a token (firmware 7+)."""
        errors: dict[str, str] = {}
        if user_input is not None:
            assert self._host
            data, errors = await _validate_auth(
                self.hass, self._host, self._serial, self._firmware, user_input
            )
            if not errors:
                return self._create(data)
        return self.async_show_form(
            step_id="auth",
            data_schema=_auth_schema(user_input or {}),
            errors=errors,
            description_placeholders={
                "serial": self._serial or "?",
                "firmware": self._firmware or "?",
            },
        )

    @callback
    def _create(self, auth: Mapping[str, Any] | None = None) -> ConfigFlowResult:
        data = {
            CONF_HOST: self._host,
            CONF_SERIAL: self._serial,
            CONF_FIRMWARE: self._firmware,
            CONF_USERNAME: None,
            CONF_PASSWORD: None,
            CONF_TOKEN: None,
        }
        if auth:
            data.update({k: v for k, v in auth.items() if k in data})
        return self.async_create_entry(title=f"Envoy {self._serial}", data=data)

    # ---------------------------------------------------------------- reauth
    async def async_step_reauth(
        self, entry_data: Mapping[str, Any]
    ) -> ConfigFlowResult:
        """Credentials or token no longer work."""
        return await self.async_step_reauth_confirm()

    async def async_step_reauth_confirm(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Ask for new credentials."""
        entry = self._get_reauth_entry()
        errors: dict[str, str] = {}
        if user_input is not None:
            data, errors = await _validate_auth(
                self.hass,
                entry.data[CONF_HOST],
                entry.data.get(CONF_SERIAL),
                entry.data.get(CONF_FIRMWARE),
                user_input,
            )
            if not errors:
                return self.async_update_reload_and_abort(
                    entry, data_updates=data
                )
        return self.async_show_form(
            step_id="reauth_confirm",
            data_schema=_auth_schema(user_input or entry.data),
            errors=errors,
            description_placeholders={"serial": entry.data.get(CONF_SERIAL) or "?"},
        )

    # ----------------------------------------------------------- reconfigure
    async def async_step_reconfigure(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Change the address of the gateway, or add/replace the Enlighten login."""
        entry = self._get_reconfigure_entry()
        errors: dict[str, str] = {}
        if user_input is not None:
            host = user_input[CONF_HOST].strip()
            client = _client(self.hass, host)
            try:
                info = await client.async_get_info()
            except EnvoyConnectionError:
                errors["base"] = "cannot_connect"
            except EnvoyError:
                errors["base"] = "not_an_envoy"
            else:
                await self.async_set_unique_id(info["serial"])
                self._abort_if_unique_id_mismatch(reason="wrong_device")
                updates: dict[str, Any] = {
                    CONF_HOST: host,
                    CONF_FIRMWARE: info["firmware"],
                }
                if user_input.get(CONF_USERNAME) or user_input.get(CONF_PASSWORD):
                    auth, errors = await _validate_auth(
                        self.hass,
                        host,
                        info["serial"],
                        info["firmware"],
                        {
                            CONF_USERNAME: user_input.get(CONF_USERNAME),
                            CONF_PASSWORD: user_input.get(CONF_PASSWORD),
                        },
                    )
                    updates.update(auth)
                if not errors:
                    return self.async_update_reload_and_abort(
                        entry, data_updates=updates
                    )
        return self.async_show_form(
            step_id="reconfigure",
            data_schema=self.add_suggested_values_to_schema(
                vol.Schema(
                    {
                        vol.Required(CONF_HOST): str,
                        vol.Optional(CONF_USERNAME): EMAIL,
                        vol.Optional(CONF_PASSWORD): PASSWORD,
                    }
                ),
                {
                    CONF_HOST: (user_input or {}).get(CONF_HOST) or entry.data[CONF_HOST],
                    CONF_USERNAME: (user_input or {}).get(CONF_USERNAME)
                    or entry.data.get(CONF_USERNAME),
                },
            ),
            errors=errors,
        )


class EnvoyLocalOptionsFlow(OptionsFlow):
    """Options: polling interval and microinverter sensors."""

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Menu: general settings or own meters."""
        return self.async_show_menu(step_id="init", menu_options=["general", "meters"])

    async def async_step_general(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Show the general options."""
        if user_input is not None:
            user_input[CONF_SCAN_INTERVAL] = int(user_input[CONF_SCAN_INTERVAL])
            user_input[CONF_UNDERPERFORM_THRESHOLD] = int(
                user_input[CONF_UNDERPERFORM_THRESHOLD]
            )
            options = dict(self.config_entry.options)
            options.update(user_input)
            return self.async_create_entry(data=options)
        options = self.config_entry.options
        return self.async_show_form(
            step_id="general",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        CONF_SCAN_INTERVAL,
                        default=options.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL),
                    ): NumberSelector(
                        NumberSelectorConfig(
                            min=MIN_SCAN_INTERVAL,
                            max=MAX_SCAN_INTERVAL,
                            step=1,
                            unit_of_measurement="s",
                            mode=NumberSelectorMode.BOX,
                        )
                    ),
                    vol.Required(
                        CONF_INVERTER_SENSORS,
                        default=options.get(CONF_INVERTER_SENSORS, True),
                    ): BooleanSelector(),
                    vol.Required(
                        CONF_LIVE_ESTIMATE,
                        default=options.get(CONF_LIVE_ESTIMATE, True),
                    ): BooleanSelector(),
                    vol.Required(
                        CONF_FORECAST,
                        default=options.get(CONF_FORECAST, True),
                    ): BooleanSelector(),
                    vol.Required(
                        CONF_UNDERPERFORM_THRESHOLD,
                        default=options.get(
                            CONF_UNDERPERFORM_THRESHOLD, DEFAULT_UNDERPERFORM_THRESHOLD
                        ),
                    ): NumberSelector(
                        NumberSelectorConfig(
                            min=50, max=99, step=1, unit_of_measurement="%",
                            mode=NumberSelectorMode.SLIDER,
                        )
                    ),
                }
            ),
        )

    async def async_step_meters(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Own meters (a Shelly, a P1 meter...) when the gateway has no CTs."""
        if user_input is not None:
            options = {
                k: v for k, v in self.config_entry.options.items()
                if not k.startswith("ext_")
            }
            options.update({k: v for k, v in user_input.items() if v not in (None, "")})
            return self.async_create_entry(data=options)
        options = self.config_entry.options
        power = EntitySelector(EntitySelectorConfig(domain="sensor", device_class="power"))
        energy = EntitySelector(EntitySelectorConfig(domain="sensor", device_class="energy"))

        def opt(key: str):
            return vol.Optional(key, description={"suggested_value": options.get(key)})

        schema = {
            opt(CONF_EXT_PRODUCTION_POWER): power,
            opt(CONF_EXT_GRID_POWER): power,
            vol.Required(
                CONF_EXT_GRID_INVERT, default=options.get(CONF_EXT_GRID_INVERT, False)
            ): BooleanSelector(),
            opt(CONF_EXT_GRID_IMPORT): energy,
            opt(CONF_EXT_GRID_EXPORT): energy,
        }
        for key in CONF_EXT_GRID_PHASES:
            schema[opt(key)] = power
        return self.async_show_form(step_id="meters", data_schema=vol.Schema(schema))
