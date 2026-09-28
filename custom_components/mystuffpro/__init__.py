"""Standalone local household inventory."""
from pathlib import Path
from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.const import Platform
from homeassistant.exceptions import ConfigEntryNotReady
from .const import DOMAIN, NAME, PANEL_PATH, VERSION
from .storage import Inventory
from .websocket import register_commands


async def async_setup(hass, config):
    hass.data.setdefault(DOMAIN, {})
    register_commands(hass)
    return True


async def async_setup_entry(hass, entry):
    state = hass.data.setdefault(DOMAIN, {})
    inventory = Inventory(hass)
    try:
        await inventory.async_load()
    except (OSError, ValueError, KeyError, TypeError) as err:
        raise ConfigEntryNotReady(f"Nie można odczytać MyStuffPro: {err}") from err
    if not state.get("static_registered"):
        await hass.http.async_register_static_paths([
            StaticPathConfig("/mystuffpro_static", str(Path(__file__).parent / "frontend"), False)
        ])
        state["static_registered"] = True
    state["inventory"] = inventory
    entry.runtime_data = inventory
    try:
        await hass.config_entries.async_forward_entry_setups(entry, [Platform.SENSOR])
        await panel_custom.async_register_panel(
            hass, frontend_url_path=PANEL_PATH, webcomponent_name="mystuffpro-panel",
            sidebar_title=NAME, sidebar_icon="mdi:archive-outline",
            module_url=f"/mystuffpro_static/panel.js?v={VERSION}",
            require_admin=False,
        )
    except Exception:
        await hass.config_entries.async_unload_platforms(entry, [Platform.SENSOR])
        state.pop("inventory", None)
        raise
    return True


async def async_unload_entry(hass, entry):
    inventory = entry.runtime_data
    async with inventory.lock:
        if not await hass.config_entries.async_unload_platforms(entry, [Platform.SENSOR]):
            return False
        inventory.active = False
        frontend.async_remove_panel(hass, PANEL_PATH)
        hass.data[DOMAIN].pop("inventory", None)
    return True
