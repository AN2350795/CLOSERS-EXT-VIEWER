import unittest
from unittest.mock import patch
from closers.avatar_condition_items import read_options
from closers.avatar_light_conditions import diagnose, evaluate
from test_avatar_lighting import Data
from test_avatar_light_conditions import source
import test_avatar_light_conditions as conditions
from test_game_names import table


class Catalog:
    def __init__(self,data):self.data=data
    def connect(self):return self
    def __enter__(self):return self
    def __exit__(self,*args):pass
    def execute(self,*args):return [(n,) for n in self.data.rows]


class ConditionItemsTests(unittest.TestCase):
    def fixture(self):
        models=[];items=[]
        for i,filename in [(11,'11_GUST_USER_REAPER_RARE_8_A_EP_AVATAR_DEFENCE_HAIR.X'),(12,''),(13,'301700103_GUST_USER_REAPER_BASIC_EP_AVATAR_DEFENCE_FACE.X'),(14,'301700103_GUST_USER_REAPER_BASIC_EP_AVATAR_DEFENCE_FACE.X')]:
            models.append([i,'GUST_USER_REAPER',filename,'','']+[0]*28+[0,'',''])
            items.append(['CVN',i,'NAME'+str(i),'SET','','ICON.PNG','','','','IT_AVATAR_ACC','','GUST_INVALID','',10,'EP_AVATAR_ACC_RING_RIGHT' if i==13 else 'EP_AVATAR_ACC_BODY_WING'])
        data=Data({'ITEM_MODEL_TEMPLET.NTF':table((5,8,8,8,8)+(12,)*28+(4,8,8),models),
                   'ITEM_TEMPLET.NTF':table((8,5,8,8,8,8,8,8,8,8,8,8,8,5,8),items),
                   'STRING_TABLE_ITEM_KOREA.NTF':table((5,8,8),[(11,'NAME11','일반 모델'),(12,'NAME12','등 장비'),(13,'NAME13','오라 반지'),(14,'NAME14','테스트 눈동자')])})
        data.keys=(b'',b'');return data

    def test_particle_and_face_effect_gear_use_source_slot_and_ordinary_models_are_excluded(self):
        data=self.fixture();rules=[dict(item_ids=[11,12,13,14],characters=['REAPER'])]
        with patch('closers.avatar_condition_items.ntf.decrypt',side_effect=lambda b,*args:b):
            values=read_options(data,Catalog(data),rules)
        self.assertEqual([v['item_id'] for v in values],[12,13])
        self.assertEqual([v['part'] for v in values],['ACC_BODY_WING','ACC_RING_RIGHT'])
        self.assertTrue(all(not v['rendered'] for v in values))
        self.assertTrue(all(v['sources']==['ITEM_TEMPLET.NTF','ITEM_MODEL_TEMPLET.NTF'] for v in values))

    def test_no_conditions_skip_catalog_and_missing_labels_are_not_offered(self):
        self.assertEqual(read_options(None,None,[]),[])
        data=self.fixture();del data.rows['STRING_TABLE_ITEM_KOREA.NTF']
        self.assertEqual(read_options(data,Catalog(data),[dict(item_ids=[12],characters=['REAPER'])]),[])

    def test_unknown_duplicate_and_wrong_character_selections_are_rejected(self):
        for selected in ({},[True],[0],[12,12],['12'],list(range(1,18))):
            with self.subTest(selected=selected),self.assertRaises(ValueError):diagnose(None,[source(11,'HAIR')],selected_items=selected)
        data=Data(conditions.AvatarLightConditionsTests().fixture());data.cached=lambda key,build,persistent=False:build()
        available=[dict(item_id=12,character='CASTER',part='ACC_BODY_WING')]
        with patch('closers.avatar_condition_items.options',return_value=available),self.assertRaises(ValueError):
            diagnose(data,[source(11,'HAIR')],selected_items=[12],catalog=object())

    def test_additional_selection_counts_once_and_conflicting_slot_is_deferred(self):
        data=Data(conditions.AvatarLightConditionsTests().fixture());data.cached=lambda key,build,persistent=False:build()
        available=[dict(item_id=12,character='REAPER',part='ACC_BODY_WING')]
        with patch('closers.avatar_condition_items.options',return_value=available):
            report=diagnose(data,[source(11,'HAIR')],selected_items=[12],catalog=object())
            self.assertEqual(report['status'],'ready');self.assertEqual(report['selected_items'],[12])
            duplicate=diagnose(data,[source(11,'HAIR'),source(12,'ACC_BODY_WING')],selected_items=[12],catalog=object())
            self.assertEqual(duplicate['candidates'][0]['matched_count'],2)
            conflict=diagnose(data,[source(11,'ACC_BODY_WING')],selected_items=[12],catalog=object())
            self.assertEqual(conflict['status'],'unverified')

    def test_eye_alias_membership_and_geometry_are_counted_once(self):
        rule=dict(condition_id=211,target_group=211,required_count=2,item_ids=[11,12,13],characters=['REAPER'],extra_condition='',row_index=0,content_version='CVN')
        eye=dict(character='REAPER',basic=False,geometry=True,item_id=12,item_ids=[12,13],face_id=9)
        raw=dict(entry_id=9,model_group=dict(kind='avatar',character='REAPER',part='ACC_RING_RIGHT'))
        report=evaluate([rule],[source(11,'HAIR'),raw],eye)
        self.assertEqual(report['status'],'ready');self.assertEqual(report['candidates'][0]['matched_count'],2)
        self.assertEqual(report['candidates'][0]['eye_count'],1)
        rule['item_ids']=[11,13]
        report=evaluate([rule],[source(11,'HAIR'),raw],eye)
        self.assertEqual(report['status'],'unverified');self.assertEqual(report['candidates'][0]['matched_count'],1)
        self.assertTrue(report['candidates'][0]['eye_alias_ambiguous'])
        eye['basic']=True;raw['model_group'].update(part='FACE',family='BASIC')
        self.assertEqual(evaluate([rule],[source(11,'HAIR'),raw],eye)['candidates'][0]['eye_count'],0)
