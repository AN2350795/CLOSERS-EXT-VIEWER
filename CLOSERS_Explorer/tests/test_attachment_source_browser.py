"""Installed accessories must follow their declared character bones."""
import base64
import json
from pathlib import Path
import test_picker_browser


class AttachmentSourceBrowserTests(test_picker_browser.PickerBrowserTests):
    checks_script='attachment_source_checks.js'

    def test_picker(self):
        from closers.catalog import Catalog
        from closers.model_items import AvatarItems
        from closers.model_groups import classify
        from closers.model_library import Models
        from closers.composition import CompositionImages
        workspace=Path(__file__).resolve().parents[2]/'results'
        if not (workspace/'catalog.sqlite3').exists():self.skipTest('Local game catalog unavailable')
        catalog=Catalog(workspace);models=Models(catalog);items=AvatarItems(catalog);composition=CompositionImages(catalog)
        definitions=items.definitions();scenes=[];images={}
        for character in ('ROGUE','STRIKER','CASTER','AEGIS'):
            parts={};accessories=[]
            for record in definitions:
                if record['character']!=character or record['set_name']!='RARE_7_A':continue
                group=classify(record['model_name'])
                if record.get('attachment'):accessories.append(record)
                elif group['variant']=='BASE' and group['part'] in {'HAIR','UPBODY','LOWBODY','HAND','FOOT'} and not record['label'].startswith('NPC '):parts.setdefault(group['part'],record)
            self.assertEqual(len(parts),5);self.assertEqual(len(accessories),3)
            if character=='ROGUE':
                accessories.append(next(r for r in definitions if r['character']==character and r['item_id']==799903816))
            ids=[];keys={}
            for record in [*parts.values(),*accessories]:
                matches=models.matches(record['model_name']);self.assertEqual(len(matches),1)
                entry=matches[0]['id'];ids.append(entry);keys[str(entry)]=record['key']
            data=models.scene(ids,items=keys)
            self.assertEqual(data['skeleton_source']['name'],'MOTION_'+character+'.X')
            self.assertEqual(sum(bool(s.get('attachment')) for s in data['sources']),len(accessories))
            for mesh in data['meshes']:
                for mat in mesh['materials']:
                    info=mat.get('image')
                    if not info or not info.get('selected') or info['selected'] in images:continue
                    path,metadata=composition.prepare(info['selected']);images[info['selected']]=dict(metadata,body=base64.b64encode(path.read_bytes()).decode())
            scenes.append(dict(label=character,data=data))
        self.script_prefix='const attachmentFixture='+json.dumps(dict(scenes=scenes,images=images),ensure_ascii=True)+';\n'
        super().test_picker()
