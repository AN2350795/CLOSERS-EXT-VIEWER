import base64
import json
from pathlib import Path

import test_picker_browser


class HarpySummerAlphaSourceBrowserTests(test_picker_browser.PickerBrowserTests):
    checks_script = 'avatar_alpha_checks.js'

    def test_picker(self):
        from closers.catalog import Catalog
        from closers.model_items import AvatarItems
        from closers.model_groups import classify
        from closers.model_library import Models
        from closers.composition import CompositionImages
        from PIL import Image
        workspace = Path(__file__).resolve().parents[2]/'results'
        if not (workspace/'catalog.sqlite3').exists():
            self.skipTest('Local game catalog unavailable')
        catalog = Catalog(workspace)
        models, items, composition = Models(catalog), AvatarItems(catalog), CompositionImages(catalog)
        definitions = items.definitions()
        scenes, images = [], {}
        for costume_type in 'ABC':
            item = next((r for r in definitions if r['character'] == 'ROGUE' and r['set_name'] == 'CLOTH_112_'+costume_type
                         and classify(r['model_name'])['part'] == 'UPBODY' and r['item_id'] < 310000000), None)
            if item is None:
                self.skipTest('Local Summer Island upper-body item unavailable')
            matches = models.matches(item['model_name'])
            self.assertEqual(len(matches), 1)
            entry = matches[0]['id']
            data = models.scene([entry], items={str(entry): item['key']})
            self.assertTrue(any(s['model_group']['variant'] == 'ALPHA' for s in data['sources']))
            partial = False
            for mesh in data['meshes']:
                for material in mesh['materials']:
                    info = material.get('image')
                    if not info or not info.get('selected'):
                        continue
                    path, metadata = composition.prepare(info['selected'])
                    if '_ALPHA.' in material['texture'].upper():
                        with Image.open(path) as image:
                            histogram = image.convert('RGBA').getchannel('A').histogram()
                        partial |= sum(histogram[1:255]) > 1000
                        self.assertEqual(material['color'][3], 1)
                    images[info['selected']] = base64.b64encode(path.read_bytes()).decode()
            self.assertTrue(partial, 'Expected real partial cloth alpha: '+costume_type)
            scenes.append(dict(label='harpy-summer-island-'+costume_type, data=data))
        self.script_prefix = 'window.avatarAlphaFixture='+json.dumps(dict(scenes=scenes, images=images), ensure_ascii=True)+';\n'
        super().test_picker()
