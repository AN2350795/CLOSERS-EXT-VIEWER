"""Source dates sort complete results before pagination in every picker."""
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from closers.catalog import Catalog
from closers.loading import LoadingData
from closers.model_groups import ModelGroups
from test_explorer import fixture
from test_model_groups import avatar


class ResourceDateTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.catalog=Catalog(self.root/'work')
        for name,seconds,entries in (
            ('old',1700000000,[(avatar(costume='CLOTH_1_A'),b'x',0),('OLD.PNG',b'image',0)]),
            ('new',1800000000,[(avatar(costume='CLOTH_2_A'),b'x',0),('NEW.PNG',b'image',0)])):
            source=fixture(self.root/(name+'.cmf'),entries)
            os.utime(source,ns=(seconds*10**9,seconds*10**9))
            self.catalog.scan([source])

    def test_library_and_groups_sort_before_pagination(self):
        for sort,expected in [('newest',1800000000000),('oldest',1700000000000)]:
            page=self.catalog.entries(dict(sort=sort,limit=1))
            self.assertEqual(page['items'][0]['updated_at'],expected)
            groups=self.catalog.groups(dict(group_axis='archive',sort=sort,limit=1))
            self.assertEqual(groups['items'][0]['updated_at'],expected)
        self.assertEqual(self.catalog.entries({'sort':'a.mtime; DROP TABLE entries'})['total'],4)

    def test_models_files_and_sets_sort_before_pagination(self):
        groups=ModelGroups(self.catalog)
        for mode in ('files','sets'):
            for sort,expected in [('newest',1800000000000),('oldest',1700000000000)]:
                result=groups.browse(dict(mode=mode,sort=sort,limit=1))
                self.assertEqual(result['items'][0]['updated_at'],expected)
        rows=[dict(updated_at=None),dict(updated_at=0),dict(updated_at=5)]
        for sort,expected in [('newest',[5,0,None]),('oldest',[0,5,None])]:
            self.assertEqual([r['updated_at'] for r in groups.paginate(rows,dict(sort=sort))['items']],expected)

    def test_illustrations_and_frame_mark_dates_use_image_sources(self):
        data=LoadingData(self.catalog)
        data.illustration_registry=lambda: {name:[dict(illust_id=i,character='STRIKER',string_key='')]
                                             for i,name in enumerate(('OLD.PNG','NEW.PNG'))}
        data.strings=lambda: {}
        self.assertEqual(data.illustrations(sort='newest')['items'][0]['name'],'NEW.PNG')
        self.assertEqual(data.illustrations(sort='oldest')['items'][0]['name'],'OLD.PNG')
        frame=['']*28
        frame[0]=1;frame[5]='OLD.PNG';frame[9]='NEW.PNG'
        data.body=lambda name:b''
        with patch('closers.loading.ntf.rows',side_effect=[[frame],[]]):
            preset=data.presets()[0]
        self.assertEqual(preset['updated_at'],1700000000000)
        self.assertEqual(preset['mark_updated_at'],1800000000000)


if __name__=='__main__':
    unittest.main()
