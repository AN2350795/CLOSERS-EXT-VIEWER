import base64
import json
from pathlib import Path
import test_picker_browser


class ExtSurfaceSourceBrowserTests(test_picker_browser.PickerBrowserTests):
    checks_script='ext_surface_source_checks.js'

    def test_picker(self):
        from closers.catalog import Catalog
        from closers.model_library import Models
        from closers.composition import CompositionImages
        from audit_ext_materials import DEFAULTS
        workspace=Path(__file__).resolve().parents[2]/'results'
        if not (workspace/'catalog.sqlite3').exists():self.skipTest('Local game catalog unavailable')
        catalog=Catalog(workspace);models=Models(catalog);images=CompositionImages(catalog);scenes=[];textures={}
        for name,maximum in zip(DEFAULTS,(0,0,0,12,21,41)):
            found=models.matches(name);self.assertEqual(len(found),1,name)
            data=models.scene([found[0]['id']]);eligible=[]
            for mesh in data['meshes']:
                for m in mesh['materials']:
                    if m.get('ext_preview') and m.get('toon_preview') and not m.get('face_sdf_preview'):eligible.append(m)
                    for info in (m.get('image'),m.get('ext_preview',{}).get('image'),m.get('toon_preview',{}).get('image')):
                        if not info:continue
                        self.assertIsNotNone(info['selected'],name)
                        if info['selected'] in textures:continue
                        path,metadata=images.prepare(info['selected'])
                        textures[info['selected']]=dict(metadata,body=base64.b64encode(path.read_bytes()).decode())
            self.assertTrue(eligible,name)
            scenes.append(dict(name=name,data=data,maximum=maximum))
        self.script_prefix='const extSurfaceFixture='+json.dumps(dict(scenes=scenes,images=textures),ensure_ascii=True)+';\n'
        super().test_picker()
