"""Fixtures for Enphase Envoy Local tests."""

from __future__ import annotations

from collections.abc import Generator
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest

from .fixtures import API_V1, INVERTERS, PRODUCTION_METERED, SERIAL, make_token

pytest_plugins = "pytest_homeassistant_custom_component"


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations: None) -> None:
    """Load custom_components/."""


@pytest.fixture
def token() -> str:
    """A valid owner token."""
    return make_token()


@pytest.fixture
def mock_client(token: str) -> Generator[AsyncMock]:
    """Patch the gateway client everywhere."""
    with (
        patch(
            "custom_components.enphase_envoy_local.coordinator.EnvoyClient",
            autospec=True,
        ) as coord_cls,
        patch(
            "custom_components.enphase_envoy_local.config_flow.EnvoyClient",
            new=coord_cls,
        ),
    ):
        client = coord_cls.return_value
        client.serial = SERIAL
        client.firmware = "D8.2.4382"
        client.token = token
        client.token_expires = datetime.now(UTC) + timedelta(days=300)
        client.requires_token = True
        client.has_credentials = True

        async def _info():
            return {"serial": SERIAL, "firmware": "D8.2.4382", "part_number": None, "imeter": "true"}

        client.async_get_info.side_effect = _info
        client.async_fetch_token.return_value = token
        client.async_get_production.return_value = PRODUCTION_METERED
        client.async_get_api_v1.return_value = API_V1
        client.async_get_inverters.return_value = INVERTERS
        client.async_get_meters.return_value = None
        client.async_get_inventory.return_value = None
        client.async_get_optional.return_value = None
        client.async_get_production_mode.return_value = None
        client.async_check_jwt.return_value = True
        yield client
