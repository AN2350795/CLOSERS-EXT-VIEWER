from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
import os
from pathlib import Path
import re
import tempfile
import threading
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from PIL import Image

from closers.catalog import Catalog
from closers.composition import CompositionImages
from closers.loading import LoadingData
from closers.server import create_server
from test_composition import png
from test_explorer import fixture


class LoadingCacheTests(unittest.TestCase):
    def test_definition_cache_survives_unrelated_extraction_but_tracks_definition_sources(self):
        source=fixture(self.root/'items.cmf',[('ITEM_TEMPLET.NTF',b'definition',0)])
        self.catalog.scan([source])
        patterns=(r'ITEM_TEMPLET[\d_]*\.NTF',)
        key=('source-definitions',1)
        builds=[]
        def load(data):
            def build():
                builds.append(True)
                rows=data.rows('ITEM_TEMPLET.NTF')
                return {'rows':len(rows)}
            return data.cached(key,build,persistent=True,source_patterns=patterns)
        self.assertEqual(load(LoadingData(self.catalog)),{'rows':1})
        self.catalog.extract(self.root/'another-output',{'format':'png'})
        self.assertEqual(load(LoadingData(self.catalog)),{'rows':1})
        self.assertEqual(len(builds),1)
        added=fixture(self.root/'more-items.cmf',[('ITEM_TEMPLET_2.NTF',b'new definition',0)])
        self.catalog.scan([added])
        self.assertEqual(load(LoadingData(self.catalog)),{'rows':1})
        self.assertEqual(len(builds),2)
        # Even before a rescan, physical changes to an observed source invalidate it.
        previous=source.stat()
        os.utime(source,ns=(previous.st_atime_ns,previous.st_mtime_ns+1000000))
        self.assertEqual(load(LoadingData(self.catalog)),{'rows':1})
        self.assertEqual(len(builds),3)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.catalog = Catalog(self.root/'work')
        self.images_source = fixture(self.root/'images.cmf', [('sheet.png', png(8, 8), 0)])
        self.definitions = fixture(self.root/'definitions.cmf', [('sheet.TET', b'definition', 0)])
        self.catalog.process([self.images_source, self.definitions], self.root/'assets')
        self.images = CompositionImages(self.catalog)
        self.data = self.loader()

    def loader(self):
        data = LoadingData(self.catalog)

        def plan(*args, **kwargs):
            for row in data.rows('sheet.TET'):
                self.catalog.verify_source(row)
            entry = data.image_id('sheet.png')
            crop = dict(x=0, y=0, width=8, height=8)
            return dict(width=450, height=640, effects=[],
                        layers=[dict(entry_id=entry, crop=crop, x=0, y=0, width=450, height=640)],
                        mark=dict(entry_id=entry, crop=crop))

        data._plan = Mock(side_effect=plan)
        data.illustration_plan = Mock(side_effect=plan)
        return data

    def test_all_kinds_reuse_png_without_plan_or_full_image_reads_even_after_restart(self):
        for kind in ('illustration', 'frame', 'mark'):
            with self.subTest(kind=kind):
                body = self.data.thumbnail(1, kind, self.images)
                restarted = self.loader()
                restarted._plan.side_effect = AssertionError('cached thumbnail rebuilt its plan')
                restarted.illustration_plan.side_effect = AssertionError('cached thumbnail rebuilt its plan')
                with patch.object(self.images, 'prepare', side_effect=AssertionError('full image read')):
                    self.assertEqual(self.data.thumbnail(1, kind, self.images), body)
                    self.assertEqual(restarted.thumbnail(1, kind, self.images), body)
        self.assertEqual(len(list((self.catalog.workspace/'thumbnail-cache').glob('*.png'))), 3)

    def test_thumbnail_clips_overflow_instead_of_adding_transparent_edges(self):
        plan = self.data.illustration_plan.side_effect
        for ident, crop in enumerate([dict(x=1,y=2,width=8,height=8),dict(x=-1,y=-2,width=8,height=8)],1):
            with self.subTest(crop=crop):
                def overflowing(*args, **kwargs):
                    value = plan(*args, **kwargs)
                    value['layers'][0]['crop'] = crop
                    return value
                self.data.illustration_plan.side_effect = overflowing
                body = self.data.thumbnail(ident, 'illustration', self.images)
                with Image.open(BytesIO(body)) as image:
                    self.assertEqual(image.getchannel('A').getextrema(), (255,255))

    def test_saved_image_edit_regenerates_pixels(self):
        before = self.data.thumbnail(1, 'frame', self.images)
        saved = Path(self.catalog.get_resource(1)['output'])
        old = saved.stat()
        saved.write_bytes(png(8, 8, lambda x, y: (0, 0, 255, 255)))
        os.utime(saved, ns=(old.st_atime_ns, old.st_mtime_ns+1000000))
        after = self.data.thumbnail(1, 'frame', self.images)
        self.assertNotEqual(before, after)
        with Image.open(BytesIO(after)) as image:
            self.assertEqual(image.getpixel((70, 100)), (0, 0, 255, 255))

    def test_changed_definition_or_image_archive_does_not_return_stale_thumbnail(self):
        self.data.thumbnail(1, 'frame', self.images)
        for source in (self.definitions, self.images_source):
            with self.subTest(source=source.name):
                old = source.stat()
                os.utime(source, ns=(old.st_atime_ns, old.st_mtime_ns+1000000))
                with self.assertRaisesRegex(ValueError, '원본이 변경'):
                    self.data.thumbnail(1, 'frame', self.images)
                os.utime(source, ns=(old.st_atime_ns, old.st_mtime_ns))

    def test_catalog_change_and_missing_or_corrupt_png_rebuild(self):
        body = self.data.thumbnail(1, 'frame', self.images)
        key = ('thumbnail', 'frame', 1)
        path = self.data.derived.path(key).with_suffix('.png')
        for damage in ('missing', 'corrupt', 'catalog'):
            with self.subTest(damage=damage):
                if damage == 'missing':
                    path.unlink()
                elif damage == 'corrupt':
                    path.write_bytes(b'incomplete')
                else:
                    with self.catalog.connect() as db:
                        self.catalog.changed(db)
                restarted = self.loader()
                self.assertEqual(restarted.thumbnail(1, 'frame', self.images), body)
                restarted._plan.assert_called_once()

    def test_concurrent_same_thumbnail_is_generated_once(self):
        barrier = threading.Barrier(4)

        def request():
            barrier.wait(timeout=5)
            return self.data.thumbnail(1, 'frame', self.images)

        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda _: request(), range(4)))
        self.assertTrue(all(body == results[0] for body in results))
        self.data._plan.assert_called_once()

    def test_cached_thumbnail_and_menu_do_not_wait_for_definition_lock(self):
        body = self.data.thumbnail(1, 'frame', self.images)

        def menu():
            self.data.derived.watch(self.definitions)
            return [dict(id=1, display_name='frame')]

        self.data._presets = Mock(side_effect=menu)
        self.data.presets()
        with ThreadPoolExecutor(max_workers=2) as pool, self.data.lock:
            thumbnail = pool.submit(self.data.thumbnail, 1, 'frame', self.images)
            presets = pool.submit(self.data.presets)
            self.assertEqual(thumbnail.result(timeout=3), body)
            self.assertEqual(presets.result(timeout=3)[0]['id'], 1)

    def test_menu_persists_and_rebuilds_on_definition_or_catalog_change(self):
        def menu():
            self.data.derived.watch(self.definitions)
            return [dict(id=1, display_name='frame')]

        self.data._presets = Mock(side_effect=menu)
        self.assertEqual(self.data.presets()[0]['id'], 1)
        restarted = self.loader()
        restarted._presets = Mock(side_effect=AssertionError('menu rebuilt'))
        self.assertEqual(restarted.presets()[0]['id'], 1)
        for change in ('definition', 'catalog'):
            if change == 'definition':
                old = self.definitions.stat()
                os.utime(self.definitions, ns=(old.st_atime_ns, old.st_mtime_ns+1000000))
            else:
                with self.catalog.connect() as db:
                    self.catalog.changed(db)
            self.data.presets()
        self.assertEqual(self.data._presets.call_count, 3)

    def test_image_identity_cache_preserves_duplicate_conflict_check(self):
        self.assertEqual(self.data.image_id('sheet.png'), 1)
        with patch('closers.loading.Archive', side_effect=AssertionError('repeated CMF read')):
            self.assertEqual(self.data.image_id('SHEET.PNG'), 1)
        self.catalog.scan([fixture(self.root/'other.cmf', [('sheet.png', png(8, 8, lambda x,y: (0,0,0,0)), 0)])])
        with self.assertRaisesRegex(ValueError, '서로 다른 이미지'):
            self.data.image_id('sheet.png')

    def test_http_thumbnail_revalidation_keeps_authentication_and_reuses_png(self):
        body = self.data.thumbnail(1, 'frame', self.images)
        server = create_server(self.catalog)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f'http://127.0.0.1:{server.server_port}'
        try:
            with urlopen(base+'/compose') as response:
                html = response.read().decode()
            token = re.search(r'name="explorer-token" content="([^"]+)"', html)[1]
            url = base+'/api/loading-thumbnail/frame/1'
            with urlopen(Request(url, headers={'X-Explorer-Token': token})) as response:
                self.assertEqual(response.read(), body)
                self.assertEqual(response.headers['Cache-Control'], 'private, no-cache')
                etag = response.headers['ETag']
            with self.assertRaises(HTTPError) as unchanged:
                urlopen(Request(url, headers={'X-Explorer-Token': token, 'If-None-Match': etag}))
            self.assertEqual(unchanged.exception.code, 304)
            unchanged.exception.close()
            with self.assertRaises(HTTPError) as unauthorized:
                urlopen(Request(url, headers={'If-None-Match': etag}))
            self.assertEqual(unauthorized.exception.code, 403)
            unauthorized.exception.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)


if __name__ == '__main__':
    unittest.main()
