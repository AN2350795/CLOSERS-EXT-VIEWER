"""Check additional local costumes with their real gloss and base textures."""
import base64
import json
from pathlib import Path
import test_picker_browser


class DofBunnySourceBrowserTests(test_picker_browser.PickerBrowserTests):
    checks_script = 'dof_source_checks.js'
    costume_set = 'CLOTH_158_C'
    capture_label = 'holy-night-bunny'

    def test_picker(self):
        from closers.catalog import Catalog
        from closers.model_items import AvatarItems
        from closers.model_groups import classify
        from closers.model_library import Models
        from closers.composition import CompositionImages
        workspace = Path(__file__).resolve().parents[2] / 'results'
        if not (workspace / 'catalog.sqlite3').exists():
            self.skipTest('Local game catalog unavailable')
        catalog = Catalog(workspace)
        items, models, composition = AvatarItems(catalog), Models(catalog), CompositionImages(catalog)
        parts = {}
        for item in items.definitions():
            group = classify(item['model_name'])
            if item['character'] == 'REAPER' and item['set_name'] == self.costume_set and group['variant'] == 'BASE' and group['part'] in {'UPBODY', 'LOWBODY', 'FOOT'}:
                parts.setdefault(group['part'], item)
        if len(parts) != 3:
            self.skipTest('Local costume unavailable: ' + self.costume_set)
        ids, keys = [], {}
        for item in parts.values():
            matches = models.matches(item['model_name'])
            self.assertEqual(len(matches), 1)
            entry = matches[0]['id']
            ids.append(entry)
            keys[str(entry)] = item['key']
        data, images = models.scene(ids, items=keys), {}
        for mesh in data['meshes']:
            for material in mesh['materials']:
                cap = material.get('matcap_preview', {})
                for info in [material.get('image'), cap.get('image'), cap.get('normal_image'), material.get('material_preview', {}).get('image')]:
                    if not info or not info.get('selected') or info['selected'] in images:
                        continue
                    path, metadata = composition.prepare(info['selected'])
                    images[info['selected']] = dict(metadata, body=base64.b64encode(path.read_bytes()).decode())
        self.assertTrue(any(m.get('matcap_preview') for mesh in data['meshes'] for m in mesh['materials']))
        fixture = dict(images=images, scenes=[dict(label=self.capture_label, data=data, gloss=True)])
        self.script_prefix = 'const emissionFixture=' + json.dumps(fixture, ensure_ascii=True) + ';\n'
        super().test_picker()


class DofAuroraSourceBrowserTests(DofBunnySourceBrowserTests):
    costume_set = 'CLOTH_216_A'
    capture_label = 'aurora-pixies'
