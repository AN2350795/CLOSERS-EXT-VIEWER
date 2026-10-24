"""Operation boundaries, rather than wall clock thresholds, guard viewer cost."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from closers.catalog import Catalog
from closers.game_names import GameNames
from closers.model_library import Models
from test_explorer import fixture
from test_model import binary_model


class ModelPerformanceTests(unittest.TestCase):
    def test_name_sources_checked_once_per_nested_operation_and_again_next_time(self):
        with tempfile.TemporaryDirectory() as temp:
            source=Path(temp)/'source';source.write_bytes(b'original')
            names=GameNames(temp);stat=source.stat()
            names.sources=[dict(archive=str(source),size=stat.st_size,mtime=stat.st_mtime_ns)]*20
            calls=[];original=Path.stat
            def checked(path,*args,**kwargs):
                if path==source:calls.append(path)
                return original(path,*args,**kwargs)
            with patch.object(Path,'stat',checked):
                with names.session():
                    for _ in range(10):
                        with names.session():names.refresh()
                    self.assertEqual(len(calls),1)
                source.write_bytes(b'changed source')
                with names.session():pass
                self.assertEqual(len(calls),2)
                self.assertEqual(names.version,(None,'stale'))

    def test_scene_reuses_connection_queries_but_not_across_requests(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);catalog=Catalog(root/'work')
            source=fixture(root/'source.cmf',[('one.X',binary_model(),0),('texture.png',b'image',0)])
            catalog.scan([source]);entry=catalog.entries({'format':'x'})['items'][0]['id']
            models=Models(catalog);original=models.candidates
            def repeated(name,owner):
                models.matches(name);models.matches(name)
                return original(name,owner)
            with patch.object(catalog,'open_connection',wraps=catalog.open_connection) as opened,patch.object(models,'candidates',side_effect=repeated):
                models.scene([entry]);self.assertEqual(opened.call_count,1)
                models.scene([entry]);self.assertEqual(opened.call_count,2)
            with catalog.session():
                db=catalog.local.db
                with catalog.session():self.assertIs(catalog.local.db,db)
                self.assertIs(catalog.local.db,db)
            self.assertIsNone(catalog.local.db)
            # A changed catalog must expose newly ambiguous texture sources.
            catalog.scan([fixture(root/'second.cmf',[('texture.png',b'other',0)])])
            info=models.scene([entry])['meshes'][0]['materials'][0]['image']
            self.assertEqual(len(info['candidates']),2)
            self.assertIsNotNone(info['selected'])  # Owner archive retains precedence.
            with ThreadPoolExecutor(max_workers=3) as pool:
                scenes=list(pool.map(lambda _:models.scene([entry]),range(3)))
            self.assertTrue(all(s==scenes[0] for s in scenes))
            source.write_bytes(source.read_bytes()+b'changed')
            with self.assertRaisesRegex(ValueError,'원본이 변경'):models.scene([entry])
