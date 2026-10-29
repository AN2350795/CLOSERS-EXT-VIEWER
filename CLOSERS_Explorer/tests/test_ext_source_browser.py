"""Render original default hair EXT maps with regional reflection parameters."""
import base64
import json
from pathlib import Path
import test_picker_browser


class ExtSourceBrowserTests(test_picker_browser.PickerBrowserTests):
    checks_script='ext_source_checks.js'

    def test_picker(self):
        from closers.catalog import Catalog
        from closers.model_library import Models
        from closers.composition import CompositionImages
        from closers.loading import LoadingData
        from closers.avatar_lighting import read_profiles
        workspace=Path(__file__).resolve().parents[2]/'results'
        if not (workspace/'catalog.sqlite3').exists():self.skipTest('Local game catalog unavailable')
        c=Catalog(workspace);models=Models(c);images={};scenes=[];composition=CompositionImages(c)
        for character,code in [('STRIKER','300000102'),('CASTER','300100102'),('RANGER','300200102')]:
            found=models.matches(code+'_GUST_USER_'+character+'_BASIC_EP_AVATAR_DEFENCE_HAIR.X')
            if len(found)!=1:self.skipTest('Local original hair unavailable: '+character)
            data=models.scene([found[0]['id']])
            self.assertTrue(any(v.get('ext_preview') for m in data['meshes'] for v in m['materials']))
            for mesh in data['meshes']:
                for material in mesh['materials']:
                    for info in (material.get('image'),material.get('ext_preview',{}).get('image'),material.get('toon_preview',{}).get('image')):
                        if not info:continue
                        self.assertIsNotNone(info['selected'],str(info))
                        if info['selected'] in images:continue
                        path,metadata=composition.prepare(info['selected']);images[info['selected']]=dict(metadata,body=base64.b64encode(path.read_bytes()).decode())
            scenes.append(dict(character=character,data=data))
        profiles=[p for p in read_profiles(LoadingData(c))['profiles'] if p.get('global_specular')]
        self.assertEqual(len(profiles),2)
        self.script_prefix='const extFixture='+json.dumps(dict(scenes=scenes,images=images,profiles=profiles),ensure_ascii=True)+';\n'
        super().test_picker()
