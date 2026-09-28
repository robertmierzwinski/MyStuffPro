"""Durable, serialized inventory mutations with optimistic concurrency."""
import asyncio
from copy import deepcopy
from homeassistant.helpers.storage import Store
from homeassistant.helpers.dispatcher import async_dispatcher_send
from .const import DOMAIN, SIGNAL_CHANGED
from .model import MAX_ITEMS, validate_item, validate_import


class Inventory:
    def __init__(self, hass):
        self.hass = hass
        self.store = Store(hass, 1, DOMAIN)
        self.lock = asyncio.Lock()
        self.items = []
        self.revision = 0
        self.active = True

    async def async_load(self):
        data = await self.store.async_load()
        if data is not None:
            # Fail visibly on corrupt storage instead of silently replacing it.
            items = data["items"]
            if not isinstance(items, list) or len(items) > MAX_ITEMS:
                raise ValueError("Nieprawidłowy zapis inwentarza.")
            ids = [item["id"] for item in items]
            if any(not isinstance(i, str) or not i for i in ids) or len(set(ids)) != len(ids):
                raise ValueError("Nieprawidłowe identyfikatory w zapisie.")
            self.items = [validate_item(item, item["id"]) for item in items]
            self.revision = data["revision"]
            if type(self.revision) is not int or self.revision < 0:
                raise ValueError("Nieprawidłowa wersja danych.")

    def snapshot(self):
        return {"items": deepcopy(self.items), "revision": self.revision}

    async def async_mutate(self, action, payload, revision):
        async with self.lock:
            if not self.active:
                raise ValueError("Integracja jest wyłączona.")
            if revision != self.revision:
                raise ValueError("Dane zmieniły się na innym urządzeniu. Odśwież listę przed zapisem.")
            items = deepcopy(self.items)
            if action == "save":
                item_id = payload.get("item_id")
                if item_id:
                    index = next((i for i, item in enumerate(items) if item["id"] == item_id), None)
                    if index is None:
                        raise ValueError("Przedmiot już nie istnieje.")
                    raw = dict(payload["item"], date_added=items[index]["date_added"])
                    items[index] = validate_item(raw, item_id)
                else:
                    items.append(validate_item(payload["item"]))
            elif action == "delete":
                item_id = payload["item_id"]
                items = [item for item in items if item["id"] != item_id]
                if len(items) == len(self.items):
                    raise ValueError("Przedmiot już nie istnieje.")
            elif action == "import":
                imported = validate_import(payload["data"])
                items = imported if payload.get("replace", False) else items + imported
            else:
                raise ValueError("Nieznana operacja.")
            if len(items) > MAX_ITEMS:
                raise ValueError(f"Limit wynosi {MAX_ITEMS} przedmiotów.")
            data = {"items": items, "revision": self.revision + 1}
            # Publish only after the atomic disk write has succeeded.
            await self.store.async_save(data)
            self.items, self.revision = items, data["revision"]
            async_dispatcher_send(self.hass, SIGNAL_CHANGED)
            return self.snapshot()
