"""Validation independent of Home Assistant, also used for legacy imports."""
from datetime import date
from uuid import uuid4

FIELDS = ("name", "category", "location", "sub_location", "description")
MAX_ITEMS = 10000


def validate_item(raw, item_id=None):
    if not isinstance(raw, dict):
        raise ValueError("Przedmiot musi być obiektem JSON.")
    result = {}
    for field in FIELDS:
        value = raw.get(field, "")
        limit = 5000 if field == "description" else 200
        if not isinstance(value, str) or len(value) > limit:
            raise ValueError(f"Nieprawidłowe pole: {field} (maks. {limit} znaków).")
        result[field] = value.strip()
    if not result["name"]:
        raise ValueError("Nazwa przedmiotu jest wymagana.")
    quantity = raw.get("quantity", 1)
    if type(quantity) is not int or not 1 <= quantity <= 1000000:
        raise ValueError("Ilość musi być liczbą całkowitą od 1 do 1000000.")
    added = raw.get("date_added", date.today().isoformat())
    if not isinstance(added, str):
        raise ValueError("Nieprawidłowa data dodania.")
    try:
        added = date.fromisoformat(added).isoformat()
    except ValueError as err:
        raise ValueError("Data dodania musi mieć format RRRR-MM-DD.") from err
    result.update(id=item_id or uuid4().hex, quantity=quantity, date_added=added)
    return result


def validate_import(raw):
    if isinstance(raw, dict):
        raw = raw.get("items")
    if not isinstance(raw, list) or len(raw) > MAX_ITEMS:
        raise ValueError(f"Import wymaga listy maksymalnie {MAX_ITEMS} przedmiotów.")
    # IDs are deliberately regenerated: a merge can never overwrite existing items.
    return [validate_item(item) for item in raw]
