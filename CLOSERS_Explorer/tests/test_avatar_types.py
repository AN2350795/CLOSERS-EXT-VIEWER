from pathlib import Path
import re
import tempfile
import unittest
from unittest.mock import patch

from closers.catalog import Catalog
from closers.model_items import AvatarItems
from closers.model_library import Models
from test_explorer import fixture
from test_game_names import table
from test_model import binary_model


class AvatarTypeTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.catalog=Catalog(self.root/'work');self.models=Models(self.catalog)
        self.registry=AvatarItems(self.catalog);self.models.groups.items=self.registry;self.registry.data.keys=(b'',b'')
        self.model='100_GUST_USER_STRIKER_CLOTH_123_A_EP_AVATAR_DEFENCE_UPBODY.X'
        types=(5,8,8,8,8)+(12,)*28+(4,8,8)
        records=[];items=[];strings=[];files=[(self.model,binary_model(self.model[:-2]+'.PNG'),0)]
        for i,kind in enumerate(('A','B','C','SP','GOLD2'),1):
            ref=f'{i}00_GUST_USER_STRIKER_CLOTH_123_{kind}_EP_AVATAR_DEFENCE_UPBODY'
            records.append([i,'GUST_INVALID',self.model,ref+'.XET',ref+'.XET']+[0]*28+[0,'',''])
            items.append(('CVN',i,'NAME_'+kind,'CLOTH_123_'+kind,'',ref+'.PNG','','','','','','GUST_USER_STRIKER'))
            strings.append((i,'NAME_'+kind,'시험 상의 ['+kind+'타입]'));files.append((ref+'.PNG',b'image'+bytes([i]),0))
        self.tables=[('ITEM_MODEL_TEMPLET.NTF',table(types,records)),('ITEM_TEMPLET.NTF',table((8,5)+(8,)*10,items)),('STRING_TABLE_ITEM_KOREA.NTF',table((5,8,8),strings))]
        self.registry._tables=lambda pattern:((n,b) for n,b in self.tables if re.fullmatch(pattern,n))
        self.registry.texture_rules=lambda:{r[3]:dict(textures={self.model[:-2]+'.PNG':r[3][:-4]+'.PNG'},shader_changes=False) for r in records}
        self.enterContext(patch('closers.model_items.ntf.decrypt',side_effect=lambda b,*args:b))
        self.catalog.scan([fixture(self.root/'data.cmf',files)])

    def test_every_registered_type_has_its_own_set_item_and_icon(self):
        result=self.models.groups.browse(dict(character='STRIKER',mode='sets',items='1'))
        self.assertEqual({r['key'] for r in result['items']},{'STRIKER|CLOTH_123_'+k for k in ('A','B','C','SP','GOLD2')})
        self.assertEqual(len({r['preview_entry'] for r in result['items']}),5)
        part=self.models.groups.browse(dict(character='STRIKER',mode='parts',items='1',costume_type='SP'))
        self.assertEqual(part['total'],1);self.assertEqual(part['items'][0]['item_id'],4)
        bundle=self.models.groups.bundle('STRIKER|CLOTH_123_SP','',True)
        self.assertEqual(bundle['slots'][0]['candidates'][0]['appearance_key'],'STRIKER:4:0')

    def test_shared_mesh_renders_distinct_registered_textures_and_retains_item(self):
        rows=self.models.groups.filtered(dict(character='STRIKER',items='1',format='x'))
        self.assertEqual(len({r['id'] for r in rows}),1)
        textures=[]
        for row in rows:
            scene=self.models.scene([row['id']],items={str(row['id']):row['appearance_key']})
            textures.append(scene['meshes'][0]['materials'][0]['texture'])
            self.assertEqual(scene['sources'][0]['item_id'],row['item_id'])
            self.assertEqual(scene['sources'][0]['model_group']['set_name'],row['set_name'])
        self.assertEqual(len(set(textures)),5)
        with self.assertRaises(ValueError):self.models.scene([rows[0]['id']],items={str(rows[0]['id']):'STRIKER:999:0'})

    def add_item_alias(self,reference=None):
        from closers import ntf
        for index in (0,1):
            name,body=self.tables[index]
            types=ntf.header(body)[0];rows=list(ntf.rows(body))
            alias=list(rows[0]);alias[0 if index==0 else 1]=11
            if index==0 and reference:alias[3]=alias[4]=reference
            self.tables[index]=(name,table(types,rows+[alias]))

    def test_bundle_selects_identical_grade_aliases_without_merging_items(self):
        self.add_item_alias()
        rows=self.models.groups.filtered(dict(character='STRIKER',items='1',costume_type='A'))
        self.assertEqual({r['item_id'] for r in rows},{1,11})
        slot=self.models.groups.bundle('STRIKER|CLOTH_123_A','',True)['slots'][0]
        self.assertEqual(len(slot['candidates']),1)
        candidate=slot['candidates'][0]
        self.assertEqual(slot['selected'],candidate['id'])
        self.assertEqual(candidate['item_ids'],[1,11])
        self.assertEqual(candidate['appearance_key'],'STRIKER:1:0')

    def test_bundle_keeps_different_appearance_references_separate(self):
        self.add_item_alias('DIFFERENT.XET')
        slot=self.models.groups.bundle('STRIKER|CLOTH_123_A','',True)['slots'][0]
        self.assertEqual(len(slot['candidates']),2)
        self.assertIsNone(slot['selected'])

    def test_basic_defaults_also_select_identical_grade_aliases(self):
        from closers import ntf
        self.add_item_alias()
        name,body=self.tables[1];rows=list(ntf.rows(body))
        for index in (0,len(rows)-1):
            rows[index]=list(rows[index]);rows[index][3]='BASIC'
        self.tables[1]=(name,table(ntf.header(body)[0],rows))
        bundle=self.models.groups.bundle('STRIKER|CLOTH_123_B','',True)
        default=bundle['defaults'][0]
        self.assertEqual(default['candidates'][0]['item_ids'],[1,11])
        self.assertEqual(default['selected'],default['candidates'][0]['id'])

    def test_texture_changes_follow_registered_shared_materials(self):
        from closers.model_items import AvatarItems
        rule=dict(textures={'OTHER_CHARACTER_HAIR_02.PNG':'OTHER_CHARACTER_HAIR_BLUE_02.PNG'})
        self.assertEqual(AvatarItems.texture_target({'texture':'OTHER_CHARACTER_HAIR_02.PNG'},self.model,rule),'OTHER_CHARACTER_HAIR_BLUE_02.PNG')
        self.assertEqual(AvatarItems.texture_target({'texture':'OTHER_CHARACTER_HAIR_02.TGA'},self.model,rule),'OTHER_CHARACTER_HAIR_BLUE_02.PNG')
        self.assertIsNone(AvatarItems.texture_target({'texture':None},self.model,rule))
        self.assertIsNone(AvatarItems.texture_target({'texture':'UNCHANGED.PNG'},self.model,rule))

    def add_component(self,variant='',filename=None):
        from closers import ntf
        name,body=self.tables[0];rows=list(ntf.rows(body))
        component=filename or self.model.replace('100_GUST','200_GUST').replace('.X',variant+'.X')
        record=list(rows[0]);record[2]=component
        self.tables[0]=(name,table(ntf.header(body)[0],rows+[record]))
        self.catalog.scan([fixture(self.root/('component'+str(len(rows))+'.cmf'),[(component,binary_model(self.model[:-2]+'.PNG'),0)])])
        return component

    def test_registered_component_models_form_one_item_and_load_together(self):
        component=self.add_component()
        result=self.models.groups.browse(dict(character='STRIKER',mode='parts',items='1',costume_type='A'))
        self.assertEqual(result['total'],1)
        item=result['items'][0]
        self.assertEqual({c['name'] for c in item['components']},{self.model,component})
        slot=self.models.groups.bundle('STRIKER|CLOTH_123_A','',True)['slots'][0]
        self.assertEqual(len(slot['candidates']),1);self.assertIsNotNone(slot['selected'])
        scene=self.models.scene([item['id']],items={str(item['id']):item['appearance_key']})
        self.assertEqual({s['name'] for s in scene['sources']},{self.model,component})
        self.assertEqual({s['item_id'] for s in scene['sources']},{1})
        self.assertEqual(len(scene['meshes']),2)
        self.assertEqual({s['entry_id'] for s in scene['sources']},{m['source_id'] for m in scene['meshes']})
        # A different item sharing the main file does not inherit its components.
        other=self.models.groups.filtered(dict(character='STRIKER',items='1',costume_type='B'))[0]
        other_scene=self.models.scene([other['id']],items={str(other['id']):other['appearance_key']})
        self.assertEqual(len(other_scene['sources']),1)

    def test_same_main_model_with_different_components_remains_a_choice(self):
        self.add_item_alias();self.add_component()
        slot=self.models.groups.bundle('STRIKER|CLOTH_123_A','',True)['slots'][0]
        self.assertEqual(len(slot['candidates']),2);self.assertIsNone(slot['selected'])
        self.assertEqual({len(c['components']) for c in slot['candidates']},{0,2})

    def test_component_source_ambiguity_requires_explicit_selection(self):
        component=self.add_component()
        self.catalog.scan([fixture(self.root/'duplicate.cmf',[(component,binary_model(self.model[:-2]+'.PNG'),0)])])
        slot=self.models.groups.bundle('STRIKER|CLOTH_123_A','',True)['slots'][0]
        item=slot['candidates'][0];child=next(c for c in item['components'] if c['name']==component)
        self.assertIsNone(child['selected']);self.assertEqual(len(child['candidates']),2)
        with self.assertRaisesRegex(ValueError,'출처'):
            self.models.scene([item['id']],items={str(item['id']):item['appearance_key']})
        chosen=child['candidates'][1]['id']
        scene=self.models.scene([item['id'],chosen],items={str(item['id']):item['appearance_key']})
        self.assertEqual({s['entry_id'] for s in scene['sources']},{item['id'],chosen})
        self.assertTrue(all(s['appearance_key']==item['appearance_key'] for s in scene['sources']))

    def test_alpha_is_included_and_dye_stays_optional(self):
        alpha=self.add_component('_ALPHA');dye=self.add_component('_DYE')
        item=self.models.groups.filtered(dict(character='STRIKER',items='1',costume_type='A',variant='BASE'))[0]
        scene=self.models.scene([item['id']],items={str(item['id']):item['appearance_key']})
        self.assertEqual({s['name'] for s in scene['sources']},{self.model,alpha})
        self.assertNotIn(dye,{s['name'] for s in scene['sources']})

    def test_missing_component_is_reported_instead_of_partial_item(self):
        from closers import ntf
        name,body=self.tables[0];rows=list(ntf.rows(body));record=list(rows[0]);record[2]=self.model.replace('100_GUST','999_GUST')
        self.tables[0]=(name,table(ntf.header(body)[0],rows+[record]))
        item=self.models.groups.filtered(dict(character='STRIKER',items='1',costume_type='A'))[0]
        self.assertEqual(item['components'][1]['candidates'],[])
        with self.assertRaisesRegex(ValueError,'구성 모델이 없습니다'):
            self.models.scene([item['id']],items={str(item['id']):item['appearance_key']})

    def test_character_override_replaces_generic_models_instead_of_combining(self):
        from closers import ntf
        component=self.add_component()
        name,body=self.tables[0];rows=list(ntf.rows(body));rows[-1]=list(rows[-1]);rows[-1][1]='GUST_USER_STRIKER'
        self.tables[0]=(name,table(ntf.header(body)[0],rows))
        item=self.models.groups.filtered(dict(character='STRIKER',items='1',costume_type='A'))[0]
        self.assertEqual(item['name'],component)
        self.assertFalse(item.get('components'))
        scene=self.models.scene([item['id']],items={str(item['id']):item['appearance_key']})
        self.assertEqual([s['name'] for s in scene['sources']],[component])

    def test_component_expansion_respects_the_scene_file_limit(self):
        from closers import ntf
        name,body=self.tables[0];rows=list(ntf.rows(body));files=[]
        for index in range(16):
            filename=self.model.replace('100_GUST',str(200+index)+'_GUST')
            record=list(rows[0]);record[2]=filename;rows.append(record)
            files.append((filename,binary_model(self.model[:-2]+'.PNG'),0))
        self.tables[0]=(name,table(ntf.header(body)[0],rows))
        self.catalog.scan([fixture(self.root/'many.cmf',files)])
        item=self.models.groups.filtered(dict(character='STRIKER',items='1',costume_type='A'))[0]
        with self.assertRaisesRegex(ValueError,'16개'):
            self.models.scene([item['id']],items={str(item['id']):item['appearance_key']})


if __name__=='__main__':unittest.main()
