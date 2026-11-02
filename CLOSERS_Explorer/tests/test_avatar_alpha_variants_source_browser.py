import base64
import json
from pathlib import Path

import test_picker_browser


class AvatarAlphaVariantsSourceBrowserTests(test_picker_browser.PickerBrowserTests):
    checks_script = 'avatar_alpha_variants_checks.js'

    def test_picker(self):
        from closers.catalog import Catalog
        from closers.model_items import AvatarItems
        from closers.model_library import Models
        from closers.model_groups import classify
        from closers.composition import CompositionImages
        from PIL import Image
        workspace = Path(__file__).resolve().parents[2]/'results'
        if not (workspace/'catalog.sqlite3').exists():
            self.skipTest('Local game catalog unavailable')
        catalog = Catalog(workspace)
        items, models, composition = AvatarItems(catalog), Models(catalog), CompositionImages(catalog)
        definitions, scenes, images = items.definitions(), [], {}
        for character, costume in [('ROGUE', 'CLOTH_224_A'), ('AEGIS', 'CLOTH_216_A'), ('FIGHTER', 'CLOTH_232_A')]:
            item = next((r for r in definitions if r['character'] == character and r['set_name'] == costume
                         and classify(r['model_name'])['part'] == 'UPBODY'), None)
            if item is None:
                self.skipTest('Local alpha costume unavailable: '+character+'/'+costume)
            matches = models.matches(item['model_name'])
            self.assertEqual(len(matches), 1)
            entry = matches[0]['id']
            data = models.scene([entry], items={str(entry): item['key']})
            alpha_ids = {s['entry_id'] for s in data['sources'] if s['model_group']['variant'] == 'ALPHA'}
            blended = set()
            for mesh in data['meshes']:
                for material in mesh['materials']:
                    cap = material.get('matcap_preview', {})
                    for info in (material.get('image'), cap.get('image'), cap.get('normal_image')):
                        if not info or not info.get('selected'):
                            continue
                        path, _ = composition.prepare(info['selected'])
                        images[info['selected']] = base64.b64encode(path.read_bytes()).decode()
                    info = material.get('image')
                    if mesh['source_id'] in alpha_ids and info and info.get('selected'):
                        path, _ = composition.prepare(info['selected'])
                        with Image.open(path) as image:
                            histogram = image.convert('RGBA').getchannel('A').histogram()
                        if sum(histogram[1:255]):
                            blended.add(info['selected'])
            self.assertTrue(blended)
            scenes.append(dict(label=character+'-'+costume, data=data, blended=list(blended)))
        self.script_prefix = 'const alphaVariants='+json.dumps(dict(scenes=scenes, images=images), ensure_ascii=True)+';\n'
        super().test_picker()
