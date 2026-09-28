"""Small summary sensors suitable for dashboards and automations."""
from homeassistant.components.sensor import SensorEntity
from homeassistant.core import callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity import DeviceInfo
from .const import DOMAIN, NAME, SIGNAL_CHANGED


async def async_setup_entry(hass, entry, async_add_entities):
    async_add_entities([InventorySensor(entry, key, name, icon) for key, name, icon in [
        ("items", "Przedmioty", "mdi:archive-outline"),
        ("quantity", "Łączna ilość", "mdi:counter"),
        ("categories", "Kategorie", "mdi:shape-outline"),
        ("locations", "Lokalizacje", "mdi:map-marker-outline"),
    ]])


class InventorySensor(SensorEntity):
    _attr_should_poll = False
    _attr_has_entity_name = True

    def __init__(self, entry, key, name, icon):
        self.inventory = entry.runtime_data
        self.key = key
        self._attr_name = name
        self._attr_icon = icon
        self._attr_unique_id = f"{entry.entry_id}_{key}"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.entry_id)}, name=NAME,
            manufacturer=NAME, model="Domowy inwentarz",
        )

    @property
    def native_value(self):
        items = self.inventory.items
        if self.key == "items":
            return len(items)
        if self.key == "quantity":
            return sum(item["quantity"] for item in items)
        field = "category" if self.key == "categories" else "location"
        return len({item[field] for item in items if item[field]})

    async def async_added_to_hass(self):
        await super().async_added_to_hass()
        self.async_on_remove(async_dispatcher_connect(self.hass, SIGNAL_CHANGED, self._changed))

    @callback
    def _changed(self):
        self.async_write_ha_state()
