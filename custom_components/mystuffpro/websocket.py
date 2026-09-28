"""Authenticated commands; household members edit, admins import backups."""
import voluptuous as vol
from homeassistant.components import websocket_api
from .const import DOMAIN


@websocket_api.websocket_command({
    vol.Required("type"): "mystuffpro/request",
    vol.Required("action"): vol.In(["list", "save", "delete", "import"]),
    vol.Optional("revision"): vol.All(int, vol.Range(min=0)),
    vol.Optional("item"): dict,
    vol.Optional("item_id"): str,
    vol.Optional("data"): vol.Any(list, dict),
    vol.Optional("replace", default=False): bool,
})
@websocket_api.async_response
async def handle_request(hass, connection, msg):
    inventory = hass.data.get(DOMAIN, {}).get("inventory")
    if inventory is None or not inventory.active:
        connection.send_error(msg["id"], "not_loaded", "MyStuffPro nie jest uruchomione.")
        return
    if msg["action"] == "import" and not connection.user.is_admin:
        connection.send_error(msg["id"], "unauthorized", "Import wymaga konta administratora.")
        return
    try:
        if msg["action"] == "list":
            result = inventory.snapshot()
        else:
            result = await inventory.async_mutate(msg["action"], msg, msg["revision"])
    except (ValueError, KeyError) as err:
        connection.send_error(msg["id"], "invalid_request", str(err))
        return
    connection.send_result(msg["id"], result)


def register_commands(hass):
    websocket_api.async_register_command(hass, handle_request)
