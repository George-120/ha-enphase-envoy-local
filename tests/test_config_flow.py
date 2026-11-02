"""Config flow tests."""

from __future__ import annotations

from unittest.mock import AsyncMock

from homeassistant.config_entries import SOURCE_USER
from homeassistant.const import CONF_HOST, CONF_PASSWORD, CONF_USERNAME
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.enphase_envoy_local.api import (
    EnlightenAuthError,
    EnvoyConnectionError,
)
from custom_components.enphase_envoy_local.const import CONF_SERIAL, CONF_TOKEN, DOMAIN

from .fixtures import SERIAL


async def test_full_flow_with_credentials(hass: HomeAssistant, mock_client: AsyncMock) -> None:
    """Host, then e-mail/password."""
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
    assert result["type"] is FlowResultType.FORM
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_HOST: "192.168.1.50"}
    )
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "auth"
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_USERNAME: "me@example.com", CONF_PASSWORD: "secret"}
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["title"] == f"Envoy {SERIAL}"
    assert result["data"][CONF_SERIAL] == SERIAL
    assert result["data"][CONF_TOKEN] == mock_client.token
    assert result["result"].unique_id == SERIAL


async def test_no_credentials(hass: HomeAssistant, mock_client: AsyncMock) -> None:
    """Nothing filled in."""
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_HOST: "192.168.1.50"}
    )
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
    assert result["errors"] == {"base": "no_credentials"}


async def test_invalid_auth_then_recover(hass: HomeAssistant, mock_client: AsyncMock) -> None:
    """Wrong password shows an error, the next try works."""
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_HOST: "192.168.1.50"}
    )
    mock_client.async_fetch_token.side_effect = EnlightenAuthError("bad")
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_USERNAME: "me@example.com", CONF_PASSWORD: "wrong"}
    )
    assert result["errors"] == {"base": "invalid_auth"}
    mock_client.async_fetch_token.side_effect = None
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_USERNAME: "me@example.com", CONF_PASSWORD: "secret"}
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY


async def test_cannot_connect(hass: HomeAssistant, mock_client: AsyncMock) -> None:
    """Gateway not reachable."""
    mock_client.async_get_info.side_effect = EnvoyConnectionError("down")
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_HOST: "192.168.1.50"}
    )
    assert result["errors"] == {"base": "cannot_connect"}


async def test_already_configured(hass: HomeAssistant, mock_client: AsyncMock) -> None:
    """Same serial twice."""
    MockConfigEntry(domain=DOMAIN, unique_id=SERIAL, data={CONF_HOST: "1.1.1.1"}).add_to_hass(hass)
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_HOST: "192.168.1.50"}
    )
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "already_configured"


@pytest.mark.parametrize("token_ok", [True])
async def test_token_instead_of_password(
    hass: HomeAssistant, mock_client: AsyncMock, token: str, token_ok: bool
) -> None:
    """A pasted token is accepted without Enlighten."""
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_HOST: "192.168.1.50"}
    )
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_TOKEN: token}
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    mock_client.async_fetch_token.assert_not_called()
