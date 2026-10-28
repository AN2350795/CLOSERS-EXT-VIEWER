"""Render opt-in MatCap with the installed Holy Night Bunny costume."""
import base64
import json
from pathlib import Path
import test_picker_browser


class MatcapSourceBrowserTests(test_picker_browser.PickerBrowserTests):
    checks_script='matcap_source_checks.js'

    def test_picker(self):
        from closers.catalog import Catalog
        from closers.model_items import AvatarItems
        from closers.model_groups import classify
        from closers.model_library import Models
        from closers.composition import CompositionImages
        workspace=Path(__file__).resolve().parents[2]/'results'
        if not (workspace/'catalog.sqlite3').exists():self.skipTest('Local game catalog unavailable')
        catalog=Catalog(workspace);models=Models(catalog);items=AvatarItems(catalog)
        definitions=items.definitions();parts={}
        for item in definitions:
            group=classify(item['model_name']);part=group['part']
            if item['character']=='REAPER' and item['set_name']=='CLOTH_158_C' and group['variant']=='BASE' and part in {'UPBODY','LOWBODY','FOOT'}:
                parts.setdefault(part,item)
        if len(parts)!=3:self.skipTest('Holy Night Bunny glossy costume unavailable')
        ids=[];keys={}
        for item in parts.values():
            matches=models.matches(item['model_name'])
            if len(matches)!=1:self.skipTest('Unambiguous local costume models unavailable')
            entry=matches[0]['id'];ids.append(entry);keys[str(entry)]=item['key']
        data=models.scene(ids,items=keys);images={};composition=CompositionImages(catalog)
        for mesh in data['meshes']:
            for material in mesh['materials']:
                for info in [material.get('image'),material.get('matcap_preview',{}).get('image'),material.get('matcap_preview',{}).get('normal_image')]:
                    if not info:continue
                    self.assertIsNotNone(info['selected'])
                    if info['selected'] in images:continue
                    path,metadata=composition.prepare(info['selected'])
                    images[info['selected']]=dict(metadata,body=base64.b64encode(path.read_bytes()).decode())
        self.assertTrue(any(m.get('matcap_preview') for mesh in data['meshes'] for m in mesh['materials']))
        self.assertTrue(any(m.get('matcap_preview',{}).get('normal_image',{}).get('selected') for mesh in data['meshes'] for m in mesh['materials']))
        self.script_prefix='const matcapFixture='+json.dumps(dict(data=data,images=images),ensure_ascii=True)+';\n'
        super().test_picker()
