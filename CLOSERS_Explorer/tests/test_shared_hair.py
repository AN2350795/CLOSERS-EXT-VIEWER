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


class SharedHairTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.catalog=Catalog(self.root/'work');self.models=Models(self.catalog)
        self.registry=AvatarItems(self.catalog);self.models.groups.items=self.registry;self.registry.data.keys=(b'',b'')
        self.hair='100_GUST_USER_STRIKER_CLOTH_900_A_EP_AVATAR_DEFENCE_HAIR.X'
        self.body='200_GUST_USER_STRIKER_CLOTH_900_A_EP_AVATAR_DEFENCE_UPBODY.X'
        self.records=[];self.items=[];self.strings=[]
        self.files=[(self.hair,binary_model('hair.png'),0),(self.body,binary_model('body.png'),0)]
        self.files += [(name,b'image',0) for name in ('shared.png','body_b.png','body_c.png')]
        for ident in (101,102):self.add_item(ident,self.hair,'CLOTH_900_A','시험 공용 헤어','COMMON_HAIR.XET')
        for ident,kind in enumerate(('A','B','C'),201):
            self.add_item(ident,self.body,'CLOTH_900_'+kind,'시험 상의 ['+kind+'타입]',('BODY_'+kind+'.XET') if kind!='A' else '')
        self.registry._tables=lambda pattern:((n,b) for n,b in self.tables() if re.fullmatch(pattern,n))
        self.registry.texture_rules=lambda:{
            'COMMON_HAIR.XET':dict(textures={'HAIR.PNG':'SHARED.PNG'},shader_changes=False),
            'BODY_B.XET':dict(textures={'BODY.PNG':'BODY_B.PNG'},shader_changes=False),
            'BODY_C.XET':dict(textures={'BODY.PNG':'BODY_C.PNG'},shader_changes=False)}
        self.enterContext(patch('closers.model_items.ntf.decrypt',side_effect=lambda b,*args:b))
        self.publish()

    def add_item(self,ident,model,code,label,ref=''):
        self.records.append([ident,'GUST_USER_STRIKER',model,ref,ref]+[0]*28+[0,'',''])
        self.items.append(('CVN',ident,'NAME_'+str(ident),code,'','','','','','','','GUST_USER_STRIKER'))
        self.strings.append((ident,'NAME_'+str(ident),label))

    def tables(self):
        return [('ITEM_MODEL_TEMPLET.NTF',table((5,8,8,8,8)+(12,)*28+(4,8,8),self.records)),
                ('ITEM_TEMPLET.NTF',table((8,5)+(8,)*10,self.items)),
                ('STRING_TABLE_ITEM_KOREA.NTF',table((5,8,8),self.strings))]

    def publish(self):
        self.catalog.scan([fixture(self.root/'data.cmf',self.files)])
        # The fixture's NTFs are supplied in memory; reflect that source change too.
        with self.catalog.connect() as db:self.catalog.changed(db)

    def bundle(self,kind):return self.models.groups.bundle('STRIKER|CLOTH_900_'+kind,'',True)

    def test_untyped_base_hair_is_in_sibling_lists_and_bundles_with_original_item(self):
        for kind in ('B','C'):
            slot=next(s for s in self.bundle(kind)['slots'] if s['part']=='HAIR')
            self.assertTrue(slot['checked']);self.assertIsNotNone(slot['selected'])
            self.assertEqual(slot['shared_hair']['source_set_key'],'STRIKER|CLOTH_900_A')
            candidate=slot['candidates'][0]
            self.assertEqual(candidate['appearance_key'],'STRIKER:101:0')
            self.assertEqual(candidate['item_ids'],[101,102])
            listing=self.models.groups.browse(dict(character='STRIKER',items='1',mode='parts',part='HAIR',costume_type=kind))
            self.assertEqual(listing['total'],1)
            self.assertEqual(listing['items'][0]['reference'],'COMMON_HAIR.XET')
            self.assertEqual(listing['items'][0]['set_key'],'STRIKER|CLOTH_900_'+kind)
        self.assertTrue(all(r['set_name']=='CLOTH_900_A' for r in self.registry.definitions() if r['item_id'] in (101,102)))
        self.assertNotIn('STRIKER:101:B',self.registry.compositions())
        searched=self.models.groups.browse(dict(character='STRIKER',items='1',mode='sets',q='B타입'))
        self.assertIn('HAIR',searched['items'][0]['parts'])
        searched_hair=self.models.groups.browse(dict(character='STRIKER',items='1',mode='parts',part='HAIR',q='B타입'))
        self.assertEqual(searched_hair['total'],1)
        files=self.models.groups.entries(dict(character='STRIKER',items='1',mode='files',part='HAIR'))
        self.assertEqual(files['total'],2)  # Grade aliases, without virtual B/C entries.

    def test_shared_hair_keeps_its_xet_and_body_type_after_repeated_scenes(self):
        for kind,expected in [('B','BODY_B.PNG'),('C','BODY_C.PNG'),('B','BODY_B.PNG')]:
            slots=self.bundle(kind)['slots'];selected=[s['candidates'][0] for s in slots]
            scene=self.models.scene([r['id'] for r in selected],items={str(r['id']):r['appearance_key'] for r in selected})
            textures={mat['texture'] for mesh in scene['meshes'] for mat in mesh['materials']}
            self.assertEqual(textures,{'SHARED.PNG',expected})
            hair=next(r for r in scene['sources'] if r['name']==self.hair)
            self.assertEqual(hair['appearance_key'],'STRIKER:101:0')

    def test_registered_sibling_hair_wins_even_when_its_model_is_missing(self):
        own=self.hair.replace('_900_A_','_900_B_')
        self.add_item(301,own,'CLOTH_900_B','시험 헤어 [B타입]');self.publish()
        self.assertFalse(any(s['part']=='HAIR' for s in self.bundle('B')['slots']))
        self.files.append((own,binary_model('hair.png'),0));self.publish()
        slot=next(s for s in self.bundle('B')['slots'] if s['part']=='HAIR')
        self.assertNotIn('shared_hair',slot)
        self.assertEqual(slot['candidates'][0]['appearance_key'],'STRIKER:301:0')

    def test_typed_hair_is_not_assumed_common(self):
        self.strings=[(ident,key,label+' [A타입]' if ident in (101,102) else label) for ident,key,label in self.strings]
        self.publish()
        self.assertFalse(any(s['part']=='HAIR' for s in self.bundle('B')['slots']))

    def test_named_type_filter_uses_target_type_and_source_catalog_updates_invalidate(self):
        self.strings=[(ident,key,'시험 상의 [유광타입]' if ident==203 else label) for ident,key,label in self.strings]
        self.publish()
        result=self.models.groups.browse(dict(character='STRIKER',items='1',mode='parts',part='HAIR',costume_type='유광'))
        self.assertEqual(result['total'],1)
        self.assertEqual(result['items'][0]['shared_hair']['target_set_key'],'STRIKER|CLOTH_900_C')
        # Removing a source from the catalog removes the shared candidate too.
        with self.catalog.connect() as db:
            db.execute('DELETE FROM entries WHERE name=?',(self.hair,));self.catalog.changed(db)
        self.assertFalse(any(s['part']=='HAIR' for s in self.bundle('B')['slots']))

    def test_duplicate_sources_and_another_hair_remain_explicit_choices(self):
        self.add_item(103,self.hair,'CLOTH_900_A','시험 어나더 헤어','COMMON_HAIR.XET');self.publish()
        self.catalog.scan([fixture(self.root/'duplicate.cmf',[(self.hair,binary_model('hair.png'),0)])])
        slot=next(s for s in self.bundle('B')['slots'] if s['part']=='HAIR')
        self.assertIsNone(slot['selected']);self.assertEqual(len(slot['candidates']),4)

    def test_all_shared_components_survive_and_dye_is_not_automatically_equipped(self):
        for suffix in ('_ALPHA','_DYE'):
            name=self.hair[:-2]+suffix+'.X';self.files.append((name,binary_model('hair.png'),0))
            for ident in (101,102):self.records.append([ident,'GUST_USER_STRIKER',name,'COMMON_HAIR.XET','COMMON_HAIR.XET']+[0]*28+[0,'',''])
        self.publish();slots=[s for s in self.bundle('B')['slots'] if s['part']=='HAIR']
        base=next(s for s in slots if s['variant']=='BASE');dye=next(s for s in slots if s['variant']=='DYE')
        self.assertTrue(base['checked']);self.assertFalse(dye['checked'])
        candidate=base['candidates'][0];self.assertEqual(len(candidate['components']),2)
        scene=self.models.scene([candidate['id']],items={str(candidate['id']):candidate['appearance_key']})
        self.assertEqual(len(scene['sources']),2)
        self.assertTrue(any('_ALPHA.X' in s['name'] for s in scene['sources']))
        self.assertFalse(any('_DYE.X' in s['name'] for s in scene['sources']))

    def test_same_code_other_character_and_other_outfit_do_not_share(self):
        values=self.models.groups.filtered(dict(character='STRIKER',items='1',mode='parts'))
        definitions=self.registry.definitions()
        only_other=[dict(r,character='CASTER') if r['part']=='HAIR' else r for r in values if not r.get('shared_hair')]
        result=self.registry.shared_hairs(only_other,definitions,'STRIKER')
        self.assertFalse(any(r.get('shared_hair') for r in result))
        unrelated=[dict(r,set_name='CLOTH_901_B',set_key='STRIKER|CLOTH_901_B') if r['part']!='HAIR' else r for r in values if not r.get('shared_hair')]
        self.assertFalse(any(r.get('shared_hair') for r in self.registry.shared_hairs(unrelated,definitions,'STRIKER')))
