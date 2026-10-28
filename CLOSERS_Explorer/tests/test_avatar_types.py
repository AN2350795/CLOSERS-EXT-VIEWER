from pathlib import Path
import re
import tempfile
import unittest
from unittest.mock import patch

from closers.catalog import Catalog
from closers.model_items import AvatarItems
from closers.model_materials import matcap_preview
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
        self.assertEqual({r['key'].rsplit('_',1)[1]:r['costume_types'] for r in result['items']},{k:[k] for k in ('A','B','C','SP','GOLD2')})
        part=self.models.groups.browse(dict(character='STRIKER',mode='parts',items='1',costume_type='SP'))
        self.assertEqual(part['total'],1);self.assertEqual(part['items'][0]['item_id'],4)
        bundle=self.models.groups.bundle('STRIKER|CLOTH_123_SP','',True)
        self.assertEqual(bundle['slots'][0]['candidates'][0]['appearance_key'],'STRIKER:4:0')

    def add_attachment(self,bone='ROOT'):
        from closers import ntf
        name,body=self.tables[0];types=list(ntf.header(body)[0]);rows=[list(r) for r in ntf.rows(body)]
        for column in (15,16,17,20):
            types[column]=8
            for row in rows:row[column]=''
        rows[0][15]='{1,1,1}';rows[0][16]='{0,0,0}';rows[0][17]='{7,0,0}';rows[0][20]=bone
        self.tables[0]=(name,table(tuple(types),rows))

    def test_attachment_metadata_survives_resolution_and_identical_tables(self):
        self.add_attachment();self.tables.append(('ITEM_MODEL_TEMPLET_2.NTF',self.tables[0][1]))
        value=self.registry.resolve('STRIKER:1:0',self.model)
        self.assertEqual(value['attachment']['status'],'ready')
        self.assertEqual(value['attachment']['offset'],[7,0,0])

    def test_conflicting_attachment_definitions_are_not_silently_chosen(self):
        from closers import ntf
        self.add_attachment();name,body=self.tables[0];rows=[list(r) for r in ntf.rows(body)];rows[0][17]='{9,0,0}'
        self.tables.append(('ITEM_MODEL_TEMPLET_2.NTF',table(ntf.header(body)[0],rows)))
        self.assertEqual(self.registry.resolve('STRIKER:1:0',self.model)['attachment']['status'],'unavailable')

    def test_character_specific_binding_overrides_generic_values(self):
        from closers import ntf
        self.add_attachment();name,body=self.tables[0];rows=[list(r) for r in ntf.rows(body)];override=rows[0].copy()
        override[1]='GUST_USER_STRIKER';override[17]='{9,0,0}'
        self.tables[0]=(name,table(ntf.header(body)[0],rows+[override]))
        self.assertEqual(self.registry.resolve('STRIKER:1:0',self.model)['attachment']['offset'],[9,0,0])

    def test_rigid_binding_does_not_double_source_bone_or_mutate_cached_mesh(self):
        from closers.model import parse_x
        self.add_attachment()
        part=parse_x(binary_model(self.model[:-2]+'.PNG'));part['meshes'][0]['skin']=[];part['meshes'][0]['frame']=1
        part['frames'][0]['matrix'][12]=100
        with patch('closers.model_library.parse_x',return_value=part):
            row=self.models.matches(self.model)[0]
            scene=self.models.scene([row['id']],items={str(row['id']):'STRIKER:1:0'})
            index=scene['meshes'][0]['frame'];total=0
            while index>=0:
                frame=scene['frames'][index];total+=frame['matrix'][12];index=frame['parent']
            self.assertEqual(total,112) # target root 100 + item 7 + local child 5
            original=self.models.scene([row['id']],items={str(row['id']):'STRIKER:2:0'})
            self.assertEqual(len(original['frames']),2)
            self.assertEqual(original['meshes'][0]['frame'],1)

    def test_missing_attachment_bone_is_reported(self):
        from closers.model import parse_x
        self.add_attachment('MISSING_BONE');part=parse_x(binary_model());part['meshes'][0]['skin']=[]
        with patch('closers.model_library.parse_x',return_value=part):
            row=self.models.matches(self.model)[0]
            with self.assertRaisesRegex(ValueError,'MISSING_BONE'):self.models.scene([row['id']],items={str(row['id']):'STRIKER:1:0'})

    def test_grade_aliases_with_different_attachment_remain_separate(self):
        from closers import ntf
        self.add_attachment();self.add_item_alias()
        name,body=self.tables[0];rows=[list(r) for r in ntf.rows(body)];rows[-1][17]='{9,0,0}'
        self.tables[0]=(name,table(ntf.header(body)[0],rows))
        result=self.models.groups.browse(dict(character='STRIKER',mode='parts',items='1',costume_type='A'))
        self.assertEqual(result['total'],2)

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

    def test_browser_merges_grade_aliases_before_pagination_and_facet_counts(self):
        self.add_item_alias()
        filters=dict(character='STRIKER',mode='parts',items='1')
        result=self.models.groups.browse(filters)
        self.assertEqual(result['total'],5)
        item=next(r for r in result['items'] if r['costume_type']=='A')
        self.assertEqual(item['item_ids'],[1,11])
        self.assertEqual(item['appearance_keys'],['STRIKER:11:0','STRIKER:1:0'])
        self.assertEqual(item['item_id'],1)
        self.assertEqual(next(f['count'] for f in result['facets']['costume_type'] if f['value']=='A'),1)
        self.assertEqual(self.models.groups.browse(dict(filters,limit=1,page=6))['items'],[])
        # Alias numbers remain searchable and original item records stay intact.
        found=self.models.groups.browse(dict(filters,q='11'))
        self.assertEqual(found['total'],1);self.assertIn(11,found['items'][0]['item_ids'])
        self.assertEqual(self.models.groups.entries(dict(filters,mode='files'))['total'],6)
        self.assertEqual(len(self.models.groups.filtered(filters)),6)

    def test_browser_preserves_distinct_textures_and_compositions(self):
        self.add_item_alias('DIFFERENT.XET')
        result=self.models.groups.browse(dict(character='STRIKER',mode='parts',items='1',costume_type='A'))
        self.assertEqual(result['total'],2)
        self.add_component()
        result=self.models.groups.browse(dict(character='STRIKER',mode='parts',items='1',costume_type='A'))
        self.assertEqual(result['total'],2)
        self.assertEqual({len(r.get('components',[])) for r in result['items']},{0,2})

    def test_browser_preserves_duplicate_file_sources(self):
        self.add_item_alias()
        self.catalog.scan([fixture(self.root/'duplicate.cmf',[(self.model,binary_model(self.model[:-2]+'.PNG'),0)])])
        result=self.models.groups.browse(dict(character='STRIKER',mode='parts',items='1',costume_type='A'))
        self.assertEqual(result['total'],2)
        self.assertEqual(len({r['id'] for r in result['items']}),2)
        self.assertTrue(all(r['item_ids']==[1,11] for r in result['items']))

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

    def test_shader_texture_inputs_are_not_base_texture_replacements(self):
        for entry in (
            dict(m_OrgTexName='SKIN.TGA',m_MultiTexName='mat_209_skin.PNG'),
            dict(m_OrgTexName='SKIN.TGA',m_MaskTexName='MASK.PNG'),
            dict(m_OrgTexName='SKIN.TGA',m_strDyeingMaskTexName='DYE_MASK.PNG'),
            dict(m_OrgToonTex='CTT_BASIC0',m_ChangeToonTex='CTT_BASIC_BLUE2'),
            dict(m_OrgTexName='SKIN.TGA',m_MultiTexName='MAT.PNG',SpecularPower=150.,SpecularColor={1:1.,2:1.,3:1.,4:1.}),
            dict(m_OrgTexName='SKIN.TGA',m_MultiTexName='MAT.PNG',SpecularPower=150.,SpecularColor={'1':1.,'2':1.,'3':1.,'4':1.}),
        ):
            with self.subTest(entry=entry):
                rule=AvatarItems.parse_texture_rule(dict(m_mapTexChange={1:entry}))
                self.assertEqual(rule['textures'],{})
                self.assertTrue(rule['shader_changes']);self.assertFalse(rule['unresolved'])
                if 'm_OrgTexName' in entry:
                    self.assertEqual(rule['materials']['SKIN.TGA'],{k:v for k,v in entry.items() if k!='m_OrgTexName'})
        rule=AvatarItems.parse_texture_rule(dict(m_mapTexChange={1:dict(m_OrgTexName='BASE.PNG',m_ChangeTexName='BLUE.PNG',m_MultiTexName='MAT.PNG')}))
        self.assertEqual(rule,dict(textures={'BASE.PNG':'BLUE.PNG'},materials={'BASE.PNG':{'m_MultiTexName':'MAT.PNG'}},shader_changes=True,unresolved=False))
        self.assertEqual(AvatarItems.parse_texture_rule(dict(m_mapTexChange={1:dict(m_OrgTexName='BASE.PNG')})),dict(textures={},shader_changes=False,unresolved=False))

    def test_malformed_or_unknown_texture_changes_still_fail(self):
        for entry in (
            dict(m_OrgTexName='BASE.PNG',m_ChangeTexName=123),
            dict(m_OrgTexName='BASE.PNG',m_MultiTexName=123),
            dict(m_OrgTexName='BASE.PNG',unexpected='TEXTURE.PNG'),
            dict(m_OrgTexName='BASE.PNG',SpecularColor='invalid'),
            dict(m_OrgToonTex='CTT_BASIC0',m_ChangeToonTex=123),
            dict(m_ChangeTexName='BLUE.PNG'),
        ):
            with self.subTest(entry=entry):self.assertTrue(AvatarItems.parse_texture_rule(dict(m_mapTexChange={1:entry}))['unresolved'])
        self.assertTrue(AvatarItems.parse_texture_rule(dict(m_mapTexChange=[]))['unresolved'])

    def test_auxiliary_only_item_keeps_original_texture_and_scoped_material_report(self):
        rules=self.registry.texture_rules();reference=next(iter(rules))
        rules[reference]=AvatarItems.parse_texture_rule(dict(m_mapTexChange={1:dict(m_OrgTexName=self.model[:-2]+'.PNG',m_MultiTexName='mat_209_skin.PNG')}))
        self.registry.texture_rules=lambda:rules
        item=self.models.groups.filtered(dict(character='STRIKER',items='1',costume_type='A'))[0]
        scene=self.models.scene([item['id']],items={str(item['id']):item['appearance_key']})
        self.assertEqual(scene['meshes'][0]['materials'][0]['texture'],self.model[:-2]+'.PNG')
        preview=scene['meshes'][0]['materials'][0]['material_preview']
        self.assertEqual(preview['texture'],'MAT_209_SKIN.PNG')
        self.assertIsNone(preview['image']['selected'])
        self.assertFalse(any('보조 재질' in warning for warning in scene['warnings']))
        self.assertIn('m_MultiTexName',scene['meshes'][0]['materials'][0]['material_report']['unsupported'])
        cap=scene['meshes'][0]['materials'][0]['matcap_preview']
        self.assertEqual(cap['texture'],'MAT_209_SKIN.PNG')
        self.assertIsNone(cap['image']['selected'])

    def test_skin_material_follows_original_texture_and_selected_item(self):
        rules=self.registry.texture_rules();reference=next(iter(rules))
        original=self.model[:-2]+'.TGA'
        rules[reference]=AvatarItems.parse_texture_rule(dict(m_mapTexChange={1:dict(m_OrgTexName=original,m_ChangeTexName=reference[:-4]+'.PNG',m_MultiTexName='MAT_209_SKIN.PNG')}))
        self.registry.texture_rules=lambda:rules
        self.catalog.scan([fixture(self.root/'materials.cmf',[('MAT_209_SKIN.PNG',b'image',0)])])
        for kind in ('A','B'):
            item=self.models.groups.filtered(dict(character='STRIKER',items='1',costume_type=kind))[0]
            scene=self.models.scene([item['id']],items={str(item['id']):item['appearance_key']})
            material=scene['meshes'][0]['materials'][0]
            self.assertEqual('material_preview' in material,kind=='A')
            self.assertEqual('matcap_preview' in material,kind=='A')
            if kind=='A':
                self.assertEqual(material['matcap_preview']['image']['selected'],material['material_preview']['image']['selected'])
                self.assertIsNotNone(material['material_preview']['image']['selected'])
                self.assertEqual(material['texture'],reference[:-4]+'.PNG')
        self.assertEqual(AvatarItems.material_inputs({'texture':'UNCHANGED.PNG'},{'materials':{original:{'m_MultiTexName':'MAT_209_SKIN.PNG'}}}),{})

    def test_material_map_duplicates_remain_ambiguous(self):
        files=[('MAT_209_SKIN.PNG',b'image',0)]
        self.catalog.scan([fixture(self.root/'material1.cmf',files),fixture(self.root/'material2.cmf',files)])
        info=self.models.candidates('MAT_209_SKIN.PNG',{'archive_id':-1})
        self.assertIsNone(info['selected']);self.assertEqual(len(info['candidates']),2)

    def test_specular_parameters_follow_only_the_selected_item_and_surface(self):
        rules=self.registry.texture_rules();reference=next(iter(rules));original=self.model[:-2]+'.PNG'
        rules[reference]=AvatarItems.parse_texture_rule(dict(m_mapTexChange={1:dict(m_OrgTexName=original,m_MultiTexName='CAP.PNG',SpecularColor={1:1,2:.5,3:.25,4:0},SpecularPower=300)}))
        self.registry.texture_rules=lambda:rules
        for kind in ('A','B'):
            item=self.models.groups.filtered(dict(character='STRIKER',items='1',costume_type=kind))[0]
            material=self.models.scene([item['id']],items={str(item['id']):item['appearance_key']})['meshes'][0]['materials'][0]
            if kind=='A':
                specular=material['matcap_preview']['specular']
                self.assertEqual(specular['color'],[1,.5,.25,0]);self.assertEqual(specular['power'],300)
            else:self.assertNotIn('matcap_preview',material)
        other=AvatarItems.material_inputs({'texture':'OTHER.PNG'},self.registry.resolve('STRIKER:1:0',self.model))
        self.assertIsNone(matcap_preview(other))

    def test_matcap_normal_is_scoped_to_current_diffuse_and_preserves_ambiguity(self):
        rules=self.registry.texture_rules();reference=next(iter(rules));target=reference[:-4]+'.PNG'
        rules[reference]=AvatarItems.parse_texture_rule(dict(m_mapTexChange={1:dict(m_OrgTexName=self.model[:-2]+'.PNG',m_ChangeTexName=target,m_MultiTexName='CAP.PNG')}))
        self.registry.texture_rules=lambda:rules
        name=target[:-4]+'_BUMP.PNG'
        self.catalog.scan([fixture(self.root/'bump1.cmf',[(name,b'bump',0)])])
        item=self.models.groups.filtered(dict(character='STRIKER',items='1',costume_type='A'))[0]
        def cap():return self.models.scene([item['id']],items={str(item['id']):item['appearance_key']})['meshes'][0]['materials'][0]['matcap_preview']
        self.assertEqual(cap()['normal_texture'],name)
        self.assertIsNotNone(cap()['normal_image']['selected'])
        self.catalog.scan([fixture(self.root/'bump2.cmf',[(name,b'bump2',0)])])
        self.assertIsNone(cap()['normal_image']['selected'])
        self.assertEqual(len(cap()['normal_image']['candidates']),2)

    def test_emissive_material_is_item_specific_and_missing_map_keeps_base(self):
        rules=self.registry.texture_rules();reference=next(iter(rules));original=self.model[:-2]+'.PNG'
        rules[reference]=AvatarItems.parse_texture_rule(dict(m_mapTexChange={1:dict(m_OrgTexName=original,m_ChangeTexName=reference[:-4]+'.PNG')},
            m_mapEmissiveMaterial={1:dict(OrgTexName=original,EmissiveTexName='LIGHT.PNG',EmissiveColor={1:1,2:.5,3:.25,4:1},fEmissiveStrength=.9)}))
        self.registry.texture_rules=lambda:rules
        for kind in ('A','B','C'):
            item=self.models.groups.filtered(dict(character='STRIKER',items='1',costume_type=kind))[0]
            scene=self.models.scene([item['id']],items={str(item['id']):item['appearance_key']})
            material=scene['meshes'][0]['materials'][0]
            self.assertEqual('material_preview' in material,kind=='A')
            self.assertIsNotNone(material['image']['selected'])
            if kind=='A':
                self.assertEqual(material['material_report']['source_texture'],original)
                self.assertEqual(material['material_preview']['kind'],'emissive')
                self.assertIsNone(material['material_preview']['image']['selected'])

    def test_duplicate_auxiliary_definitions_disable_effect_and_keep_diffuse(self):
        self.catalog.scan([fixture(self.root/'xet.cmf',[('XET_TABLE.LUA',b'fixture',0)])])
        base=dict(m_DeviceID='A.XET',m_mapTexChange={1:dict(m_OrgTexName='BASE.PNG',m_ChangeTexName='A.PNG')})
        alternate=dict(base,m_mapEmissiveMaterial={1:dict(OrgTexName='BASE.PNG',EmissiveTexName='LIGHT.PNG')})
        with patch.object(self.registry.data,'table',return_value={'XET_TABLE':{1:base,2:alternate,3:base}}):
            rule=self.registry._texture_rules()['A.XET']
        self.assertNotIn('ambiguous',rule)
        self.assertEqual(rule['textures'],{'BASE.PNG':'A.PNG'})
        self.assertEqual(rule['material_conflicts'],['emissive_materials'])
        self.assertNotIn('emissive_materials',rule)
        conflicting=dict(base,m_mapTexChange={1:dict(m_OrgTexName='BASE.PNG',m_ChangeTexName='B.PNG')})
        with patch.object(self.registry.data,'table',return_value={'XET_TABLE':{1:base,2:conflicting,3:base}}):
            self.assertTrue(self.registry._texture_rules()['A.XET']['ambiguous'])

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
