"""Domain tests with a fake HA storage boundary; no running HA required."""
import asyncio
import importlib.util
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import AsyncMock, Mock

ROOT = Path(__file__).resolve().parents[1] / 'custom_components' / 'mystuffpro'
pkg = types.ModuleType('inventory_under_test')
pkg.__path__ = [str(ROOT)]
sys.modules[pkg.__name__] = pkg
for name in ['homeassistant', 'homeassistant.helpers', 'homeassistant.helpers.storage', 'homeassistant.helpers.dispatcher']:
    sys.modules[name] = types.ModuleType(name)
sys.modules['homeassistant.helpers.storage'].Store = Mock()
sys.modules['homeassistant.helpers.dispatcher'].async_dispatcher_send = Mock()
from inventory_under_test.model import validate_item, validate_import
from inventory_under_test.storage import Inventory


class ValidationTests(unittest.TestCase):
    def test_legacy_php_import_and_new_ids(self):
        raw = [{'id': 1, 'name': ' Wiertarka ', 'quantity': 2, 'date_added': '2026-09-09', 'sub_location': 'Szafka A'}]
        first, second = validate_import(raw)[0], validate_import(raw)[0]
        self.assertEqual(first['name'], 'Wiertarka')
        self.assertEqual(first['sub_location'], 'Szafka A')
        self.assertEqual(first['date_added'], '2026-09-09')
        self.assertNotEqual(first['id'], second['id'])

    def test_invalid_data(self):
        for data in [{'name':''}, {'name':'a','quantity':True}, {'name':'a','quantity':1.5}, {'name':'a','quantity':0}, {'name':'a','date_added':'bad'}, {'name':42}, {'name':'a','description':'x'*5001}]:
            with self.subTest(data=str(data)[:80]), self.assertRaises(ValueError):
                validate_item(data)
        for data in [None, {}, ['bad'], [{'name':'valid'}, {'name':''}]]:
            with self.assertRaises(ValueError): validate_import(data)

    def test_export_round_trip(self):
        item = validate_item({'name':'Żarówka', 'quantity':3})
        restored = validate_import({'format':'mystuffpro','items':[item]})[0]
        for key in item:
            if key != 'id': self.assertEqual(item[key], restored[key])


class StorageTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.inv = Inventory(Mock())
        self.inv.store = Mock(async_save=AsyncMock(), async_load=AsyncMock(return_value=None))

    async def test_crud_and_date_preservation(self):
        snap = await self.inv.async_mutate('save', {'item':{'name':'Młotek','date_added':'2026-01-01'}}, 0)
        item = snap['items'][0]
        await self.inv.async_mutate('save', {'item_id':item['id'], 'item':{'name':'Młotek duży','quantity':2}}, 1)
        self.assertEqual(self.inv.items[0]['date_added'], '2026-01-01')
        await self.inv.async_mutate('delete', {'item_id':item['id']}, 2)
        self.assertEqual(self.inv.snapshot(), {'items':[], 'revision':3})

    async def test_failed_disk_write_does_not_publish(self):
        self.inv.store.async_save.side_effect = OSError('disk full')
        with self.assertRaises(OSError):
            await self.inv.async_mutate('save', {'item':{'name':'Test'}}, 0)
        self.assertEqual(self.inv.snapshot(), {'items':[], 'revision':0})

    async def test_concurrent_edit_is_rejected(self):
        results = await asyncio.gather(*[self.inv.async_mutate('save', {'item':{'name':name}}, 0) for name in ['A','B']], return_exceptions=True)
        self.assertEqual(sum(isinstance(r, ValueError) for r in results), 1)
        self.assertEqual(len(self.inv.items), 1)

    async def test_import_all_or_nothing_merge_and_replace(self):
        await self.inv.async_mutate('save', {'item':{'name':'Existing'}}, 0)
        with self.assertRaises(ValueError):
            await self.inv.async_mutate('import', {'data':[{'name':'Good'},{'name':''}]}, 1)
        self.assertEqual(len(self.inv.items), 1)
        await self.inv.async_mutate('import', {'data':[{'name':'Merged'}]}, 1)
        self.assertEqual(len(self.inv.items), 2)
        await self.inv.async_mutate('import', {'data':[], 'replace':True}, 2)
        self.assertEqual(self.inv.items, [])

    async def test_reload_and_snapshot_isolation(self):
        await self.inv.async_mutate('save', {'item':{'name':'Saved'}}, 0)
        data = self.inv.store.async_save.call_args.args[0]
        self.inv.store.async_load.return_value = data
        await self.inv.async_load()
        snapshot = self.inv.snapshot()
        snapshot['items'][0]['name'] = 'Not saved'
        self.assertEqual(self.inv.items[0]['name'], 'Saved')

    async def test_unloaded_inventory_rejects_writes(self):
        self.inv.active = False
        with self.assertRaises(ValueError):
            await self.inv.async_mutate('save', {'item':{'name':'Test'}}, 0)

    async def test_corrupt_storage_does_not_get_replaced(self):
        self.inv.store.async_load.return_value = {'items':[{'id':'same','name':'A'},{'id':'same','name':'B'}],'revision':1}
        with self.assertRaises(ValueError): await self.inv.async_load()
        self.inv.store.async_save.assert_not_called()

if __name__ == '__main__': unittest.main()
