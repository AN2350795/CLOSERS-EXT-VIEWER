import codecs
from pathlib import Path
import tempfile
import unittest
import zlib

from test_explorer import fixture
from closers.catalog import Catalog
from closers.groups import group_key
from closers.server import Media
from closers.text import decode_preview


class GroupTextTests(unittest.TestCase):
    def test_partial_multibyte_text_and_bom_encodings(self):
        for encoding in ('utf-8-sig', 'utf-16', 'cp949'):
            payload = ('한글 대사\n가나다' * 4).encode(encoding)
            for cut in (len(payload), len(payload)-1, len(payload)-2):
                result = decode_preview(payload[:cut], final=cut==len(payload), encoding='auto')
                self.assertIsNone(result['error'], (encoding,cut))
                self.assertTrue(result['text'].startswith('한글 대사'))
        payload = '한글'.encode('utf-16-be')
        self.assertEqual(decode_preview(payload, final=True, encoding='utf-16-be')['text'], '한글')
        self.assertTrue(decode_preview(b'\0\1\2binary')['error'])
        self.assertTrue(decode_preview(b'\xf0\x9f', final=True)['error'])

    def test_text_limits_and_storage_error_remain_explicit(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            catalog = Catalog(root/'work')
            source = fixture(root/'text.cmf', [('large.lua', ('한글\n'*300000).encode(), 1),
                                               ('encoded.lua', b'plaintext', 1, b'YWJjZGVm')])
            catalog.scan([source])
            media = Media(catalog)
            rows = catalog.entries({})['items']
            result = media.text(catalog.get(rows[0]['id']), 4096)
            self.assertIsNone(result['error'])
            self.assertTrue(result['truncated'])
            self.assertLessEqual(result['consumed'], 4096)
            result = media.text(catalog.get(rows[0]['id']), 10000000)
            self.assertEqual(result['limit'], 1024*1024)
            self.assertTrue(media.text(catalog.get(rows[1]['id']))['error'])
            self.assertEqual(catalog.stats()['entry_error_count'],1)

    def test_group_paging_whole_group_extraction_and_notes_survive_rescan(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            catalog = Catalog(root/'work')
            source = fixture(root/'audio.cmf', [(f'ST_QUEST_DUNGEON_100_GUST_{i}.ogg', b'OggS', 0) for i in range(205)]
                             + [('ST_QUEST_DUNGEON_200_GUST_1.ogg', b'OggS', 0),('ST_PET_1.ogg', b'OggS', 0)])
            catalog.scan([source])
            filters = {'group_axis':'quest_candidate','limit':1}
            groups = catalog.groups(filters)
            self.assertEqual(groups['total'],2)
            self.assertEqual(groups['items'][0]['count'],205)
            key=groups['items'][0]['value']
            self.assertEqual(catalog.groups(dict(filters,page=2))['items'][0]['count'],1)
            catalog.save_group('quest_candidate',key,'사용자 이름','확인 필요')
            result=catalog.extract(root/'assets',{'group_axis':'quest_candidate','group_value':key})
            self.assertEqual(result['done'],205)
            self.assertEqual(result['failed'],0)
            source.touch()
            catalog.scan([source])
            self.assertEqual(catalog.groups(filters)['items'][0]['label'],'사용자 이름')
            self.assertEqual(catalog.groups(filters)['items'][0]['tags'],'확인 필요')
            self.assertEqual(len(list((root/'assets').rglob('*.ogg'))),205)
            with self.assertRaises(ValueError):
                catalog.groups({'group_axis':"';drop table entries;--"})

    def test_candidate_groups_do_not_invent_quest_relationships(self):
        self.assertEqual(group_key('ST_QUEST_DUNGEON_100_GUST_12.OGG','','','quest_candidate'), 'ST_QUEST_DUNGEON_100')
        self.assertIsNone(group_key('ST_PET_MINI_SKILL_1.OGG','','','quest_candidate'))
        self.assertEqual(group_key('ST_PET_MINI_SKILL_1.OGG','','','prefix'),'ST_PET_MINI_SKILL')
