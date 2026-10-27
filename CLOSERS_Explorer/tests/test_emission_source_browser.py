"""Verify visible Wheel of Trinity emission against installed game assets."""
import base64
import json
from pathlib import Path
import test_picker_browser


class EmissionSourceBrowserTests(test_picker_browser.PickerBrowserTests):
    checks_script='emission_source_checks.js'

    def test_picker(self):
        from closers.catalog import Catalog
        from closers.model_items import AvatarItems
        from closers.model_groups import classify
        from closers.model_library import Models
        from closers.composition import CompositionImages
        workspace=Path(__file__).resolve().parents[2]/'results'
        if not (workspace/'catalog.sqlite3').exists():self.skipTest('Local game catalog unavailable')
        catalog=Catalog(workspace);models=Models(catalog);items=AvatarItems(catalog);composition=CompositionImages(catalog);definitions=items.definitions()
        scenes=[];images={}
        wing=next(r for r in definitions if r['character']=='ROGUE' and r['item_id']==449991012)
        parts={}
        for r in definitions:
            group=classify(r['model_name']);part=group['part']
            if r['character']=='ROGUE' and r['set_name']=='RARE_7_A' and group['variant']=='BASE' and part in {'HAIR','UPBODY','LOWBODY','HAND','FOOT','WEAPON'} and not r['label'].startswith('NPC '):parts.setdefault(part,r)
        self.assertEqual(len(parts),6)
        for label,records in [('wheel-wing',[wing]),('wheel-costume',list(parts.values()))]:
            ids=[];keys={}
            for r in records:
                matches=models.matches(r['model_name']);self.assertEqual(len(matches),1)
                entry=matches[0]['id'];ids.append(entry);keys[str(entry)]=r['key']
            data=models.scene(ids,items=keys)
            self.assertFalse(any('bloom' in warning for warning in data['warnings']))
            for mesh in data['meshes']:
                for mat in mesh['materials']:
                    for info in [mat.get('image'),mat.get('material_preview',{}).get('image')]:
                        if not info or not info.get('selected') or info['selected'] in images:continue
                        path,metadata=composition.prepare(info['selected']);images[info['selected']]=dict(metadata,body=base64.b64encode(path.read_bytes()).decode())
            scenes.append(dict(label=label,data=data))
        self.script_prefix='const emissionFixture='+json.dumps(dict(scenes=scenes,images=images),ensure_ascii=True)+';\n'
        super().test_picker()
