"""Render original companion GLOW maps on installed avatar costumes."""
import base64
import json
from pathlib import Path
import test_picker_browser


class GlowSourceBrowserTests(test_picker_browser.PickerBrowserTests):
    checks_script='glow_source_checks.js'

    def test_picker(self):
        from closers.catalog import Catalog
        from closers.model_library import Models
        from closers.model_items import AvatarItems
        from closers.composition import CompositionImages
        workspace=Path(__file__).resolve().parents[2]/'results'
        if not (workspace/'catalog.sqlite3').exists():self.skipTest('Local game catalog unavailable')
        catalog=Catalog(workspace);models=Models(catalog);composition=CompositionImages(catalog)
        scenes=[];images={};definitions=AvatarItems(catalog).definitions()
        for character,key in [('STRIKER','STRIKER:340021601:0'),('CASTER','CASTER:340121601:0'),('ROGUE','ROGUE:340721604:0')]:
            item=next((v for v in definitions if v['key']==key),None)
            if item is None:self.skipTest('Local costume unavailable: '+key)
            matches=models.matches(item['model_name'])
            if len(matches)!=1:self.skipTest('Unambiguous local costume model unavailable: '+key)
            entry=matches[0]['id']
            data=models.scene([entry],items={str(entry):key})
            self.assertTrue(any(m.get('glow_preview') for mesh in data['meshes'] for m in mesh['materials']),character)
            for mesh in data['meshes']:
                for material in mesh['materials']:
                    for info in (material.get('image'),material.get('glow_preview',{}).get('image'),material.get('toon_preview',{}).get('image')):
                        if not info:continue
                        self.assertIsNotNone(info['selected'],character+': '+str(info))
                        if info['selected'] in images:continue
                        path,metadata=composition.prepare(info['selected'])
                        images[info['selected']]=dict(metadata,body=base64.b64encode(path.read_bytes()).decode())
            scenes.append(dict(character=character,data=data))
        self.script_prefix='const glowFixture='+json.dumps(dict(scenes=scenes,images=images),ensure_ascii=True)+';\n'
        super().test_picker()
