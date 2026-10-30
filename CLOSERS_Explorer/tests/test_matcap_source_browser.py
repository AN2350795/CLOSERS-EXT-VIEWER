"""Render opt-in MatCap with the installed Holy Night Bunny costume."""
import base64
import json
from pathlib import Path
import test_picker_browser


class MatcapSourceBrowserTests(test_picker_browser.PickerBrowserTests):
    checks_script='matcap_source_checks.js'
    costume_set='CLOTH_158_C'
    capture_label='bunny'
    require_specular=False
    require_toon=False
    require_position=False

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
            if item['character']=='REAPER' and item['set_name']==self.costume_set and group['variant']=='BASE' and part in {'UPBODY','LOWBODY','FOOT'}:
                parts.setdefault(part,item)
        if len(parts)!=3:self.skipTest('Local costume unavailable: '+self.costume_set)
        ids=[];keys={}
        for item in parts.values():
            matches=models.matches(item['model_name'])
            if len(matches)!=1:self.skipTest('Unambiguous local costume models unavailable')
            entry=matches[0]['id'];ids.append(entry);keys[str(entry)]=item['key']
        data=models.scene(ids,items=keys);images={};composition=CompositionImages(catalog)
        for mesh in data['meshes']:
            for material in mesh['materials']:
                infos=[material.get('image'),material.get('matcap_preview',{}).get('image'),material.get('matcap_preview',{}).get('normal_image')]
                if self.require_toon:infos.append(material.get('toon_preview',{}).get('image'))
                for info in infos:
                    if not info:continue
                    self.assertIsNotNone(info['selected'])
                    if info['selected'] in images:continue
                    path,metadata=composition.prepare(info['selected'])
                    images[info['selected']]=dict(metadata,body=base64.b64encode(path.read_bytes()).decode())
        self.assertTrue(any(m.get('matcap_preview') for mesh in data['meshes'] for m in mesh['materials']))
        self.assertTrue(any(m.get('matcap_preview',{}).get('normal_image',{}).get('selected') for mesh in data['meshes'] for m in mesh['materials']))
        if self.require_specular:
            values=[m['matcap_preview']['specular'] for mesh in data['meshes'] for m in mesh['materials'] if m.get('matcap_preview',{}).get('specular')]
            self.assertEqual({v['power'] for v in values},{300.,500.,800.})
            self.assertTrue(all(v['color']==[1.,1.,1.,1.] for v in values))
        toon_profiles=[]
        if self.require_toon:
            from closers.avatar_lighting import read_profiles
            profiles=read_profiles(items.data)['profiles']
            toon_profiles=[next(p for p in profiles if p['key']==key) for key in ('CVN_SKIN_COMMON:1411','CVN_COSTUME_UNIQUE_NETHERWORLD:211')]
            self.assertTrue(any(m.get('toon_preview',{}).get('source_index')!=m.get('toon_preview',{}).get('index') for mesh in data['meshes'] for m in mesh['materials']))
        regional=[]
        if self.require_position:
            from closers.avatar_lighting import read_profiles
            regional=[p for p in read_profiles(items.data)['profiles'] if 'position' in p]
            self.assertEqual(len(regional),2)
        self.script_prefix='const matcapFixture='+json.dumps(dict(data=data,images=images,label=self.capture_label,specular=self.require_specular,toonProfiles=toon_profiles,regionalProfiles=regional,colorDomain=getattr(self,'color_domain',False)),ensure_ascii=True)+';\n'
        super().test_picker()
