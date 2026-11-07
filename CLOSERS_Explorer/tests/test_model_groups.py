import tempfile
from pathlib import Path
import unittest

from closers.catalog import Catalog
from closers.model_groups import classify,ModelGroups,CHARACTERS
from closers.model_library import Models
from test_explorer import fixture
from test_model import binary_model,animation


def avatar(character='STRIKER',costume='CLOTH_212_A',part='UPBODY',number=1):
    return f'{number}_GUST_USER_{character}_{costume}_EP_AVATAR_DEFENCE_{part}.X'


class ModelGroupTests(unittest.TestCase):
    def test_recovered_categories_use_specific_conventions_without_claiming_names(self):
        cases={'DLG_LOGIN_2024_IDOL_1ST.XMD':'cinematic','DLG_AEGIS_CREATE.X':'cinematic',
               'IMPASSABLE_AREA1_STAGE1_BUILDING01.X':'collision','MESH_CAMERA1.X':'camera',
               'UNIT_SELECT_OFFICE_CAMERA1.X':'camera','UNIT_SELECT_OFFICE.X':'background',
               'HAN_RIVER2_BACK.X':'background','ABANDONED_STATION2_STAGE1_BARRICADE01.X':'background',
               'PE_AEGIS_ENCHANT_08.X':'effect','TRAIL_ASTAROTH_SKILL_3.X':'effect'}
        for name,kind in cases.items():
            with self.subTest(name=name):
                group=classify(name)
                self.assertEqual(group['kind'],kind)
                self.assertFalse(group['set_name'])
        for name in ('MON_BOSS_PUPPET_BLUE_PUPPET.X','UNIT_UNKNOWN.X','MESH_UNKNOWN.X'):
            self.assertEqual(classify(name)['kind'],'unknown')

    def test_character_scope_excludes_unrelated_files_before_saved_checks(self):
        from unittest.mock import patch
        self.add([avatar(),avatar(character='CASTER'),avatar(costume='A',part='ACC_BODY_WING'),
                  '1499002201_GUST_INVALID_NA_EP_AVATAR_ACC_HEAD_EYE.X'])
        checked=[]
        def saved(row):checked.append(row['name']);return True
        with patch.object(self.groups,'saved',side_effect=saved):
            result=self.groups.browse(dict(character='STRIKER',mode='sets',saved='existing'))
        self.assertEqual(result['total'],1)
        self.assertTrue(all('STRIKER' in name and 'ACC_' not in name for name in checked))
        accessories=self.groups.browse(dict(character='STRIKER',mode='accessories'))
        self.assertEqual(accessories['total'],2)
        self.assertEqual(sum(r['shared'] for r in accessories['items']),1)

    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.catalog=Catalog(self.root/'work')
        self.groups=ModelGroups(self.catalog)

    def add(self,names,path='one.cmf'):
        source=fixture(self.root/path,[(n,animation() if n.endswith('.XMD') else binary_model(),1) for n in names])
        self.catalog.process([source],self.root/'assets')
        return source

    def test_name_evidence_keeps_character_type_and_supplements_separate(self):
        a=classify(avatar(part='UPBODY_ALPHA'))
        self.assertEqual((a['character'],a['part'],a['variant'],a['set_key']),('STRIKER','UPBODY','ALPHA','STRIKER|CLOTH_212_A'))
        self.assertNotEqual(a['set_key'],classify(avatar(costume='CLOTH_212_B'))['set_key'])
        self.assertEqual(classify(avatar(part='HAND_DYE'))['variant'],'DYE')
        for code in ('A','NA','NB','NPC_BOSS_1'):
            self.assertFalse(classify(avatar(costume=code))['set_key'])
        npc=classify('GUST_NPC_TOWN_WILD_HUNTER_GATEKEEPER_LIBRARIAN.X')
        self.assertEqual((npc['kind'],npc['character']),('npc',''))
        self.assertEqual(classify('unfamiliar.X')['kind'],'unknown')
        self.assertEqual(len(CHARACTERS),23)

    def test_bundle_defaults_face_motion_and_keeps_source_ambiguity(self):
        names=[avatar(part=p,number=i) for i,p in enumerate(['HAIR','UPBODY','UPBODY_ALPHA','LOWBODY','FOOT','HAND','HAND_DYE','WEAPON'])]
        self.add(names+[avatar(costume='BASIC',part='FACE'),'MOTION_STRIKER.X','MOTION_STRIKER.XMD'])
        self.add([names[1]],'duplicate.cmf')
        bundle=self.groups.bundle('STRIKER|CLOTH_212_A')
        self.assertEqual(len(bundle['face']['candidates']),1)
        self.assertIsNotNone(bundle['motion']['selected'])
        shirt=next(s for s in bundle['slots'] if (s['part'],s['variant'])==('UPBODY','BASE'))
        self.assertEqual(len(shirt['candidates']),2);self.assertIsNone(shirt['selected']);self.assertTrue(shirt['checked'])
        self.assertTrue(next(s for s in bundle['slots'] if s['variant']=='ALPHA')['checked'])
        self.assertFalse(next(s for s in bundle['slots'] if s['variant']=='DYE')['checked'])
        self.assertFalse(next(s for s in bundle['slots'] if s['part']=='WEAPON')['checked'])

    def test_missing_saved_face_and_revision_refresh(self):
        self.add([avatar(),avatar(costume='BASIC',part='FACE')])
        self.assertEqual(self.groups.entries({'saved':'existing'})['total'],2)
        face=self.groups.bundle('STRIKER|CLOTH_212_A')['face']['selected']
        Path(self.catalog.get(face)['output']).unlink()
        self.assertEqual(self.groups.entries({'saved':'existing'})['total'],1)
        self.assertEqual(self.groups.entries({'saved':'missing'})['total'],1)
        self.assertFalse(self.groups.bundle('STRIKER|CLOTH_212_A')['face']['candidates'])
        self.add([avatar(character='CASTER')],'new.cmf')
        self.assertEqual(self.groups.entries({})['total'],3)
        f=self.groups.facets({'character':'STRIKER'})['facets']
        self.assertEqual({r['value'] for r in f['character']},{'STRIKER','CASTER'})
        self.assertEqual(sum(r['count'] for r in f['kind']),2)
        combined=self.groups.browse({'character':'STRIKER','saved':'existing'})
        self.assertEqual(combined['total'],1)
        self.assertEqual({'STRIKER'},{r['value'] for r in combined['facets']['character']})
        self.assertEqual(self.groups.browse({'character':'STRIKER','mode':'sets'})['total'],2)

    def test_filters_apply_to_catalog_and_extraction_scope(self):
        self.add([avatar(),avatar(character='CASTER'),avatar(part='FACE'),avatar(costume='A',part='HAND')])
        f={'category':'models','model_character':'STRIKER','model_family':'CLOTH','model_part':'UPBODY'}
        result=self.catalog.entries(f)
        self.assertEqual(result['total'],1)
        self.assertEqual(result['items'][0]['model_group']['part'],'UPBODY')
        out=self.root/'filtered';r=self.catalog.extract(out,f)
        self.assertEqual(r['done'],1)
        self.assertEqual(self.catalog.entries({'model_kind':'avatar'})['total'],4)

    def test_browser_modes_have_matching_results_and_facets(self):
        self.add([avatar(),avatar(costume='A',part='ACC_BODY_WING'),
                  'GUST_NPC_TOWN_WILD_HUNTER_GATEKEEPER_LIBRARIAN.X'])
        sets=self.groups.browse({'mode':'sets'})
        self.assertEqual(sets['total'],1)
        self.assertEqual({r['value'] for r in sets['facets']['family']},{'CLOTH'})
        accessories=self.groups.browse({'mode':'accessories'})
        self.assertEqual(accessories['total'],1)
        self.assertEqual(accessories['items'][0]['family'],'ACCESSORY')
        self.assertEqual({r['value'] for r in accessories['facets']['part']},{'ACC_BODY_WING'})
        self.assertEqual(self.groups.browse({'mode':'files'})['total'],3)

    def test_default_parts_respect_character_saved_status_and_variants(self):
        self.add([avatar(part='UPBODY'),avatar(costume='BASIC',part='HAIR'),
                  avatar(costume='BASIC',part='HAIR_ALPHA'),avatar(costume='BASIC',part='HAND_DYE'),
                  avatar(costume='BASIC',part='FOOT'),avatar(costume='BASIC_1',part='HAIR'),
                  avatar(costume='BASIC_1',part='LOWBODY'),avatar(costume='BASIC',part='WEAPON'),
                  avatar(character='CASTER',costume='BASIC',part='HAND')])
        foot=next(r for r in self.groups.entries({})['items'] if r['part']=='FOOT')
        Path(foot['output']).unlink()
        defaults=self.groups.bundle('STRIKER|CLOTH_212_A')['defaults']
        self.assertEqual({(s['part'],s['variant']) for s in defaults},
                         {('HAIR','BASE'),('HAIR','ALPHA'),('LOWBODY','BASE')})
        hair=next(s for s in defaults if s['variant']=='BASE' and s['part']=='HAIR')
        self.assertEqual(len(hair['candidates']),1)
        self.assertIn('_BASIC_',hair['candidates'][0]['name'])
        self.assertIsNotNone(hair['selected'])
        all_defaults=self.groups.bundle('STRIKER|CLOTH_212_A',saved='')['defaults']
        self.assertIn('FOOT',{s['part'] for s in all_defaults})

    def test_default_parts_preserve_ambiguous_sources_and_basic_types(self):
        hair=avatar(costume='BASIC',part='HAIR')
        self.add([avatar(),hair,avatar(costume='BASIC_1',part='HAND'),
                  avatar(costume='BASIC_2',part='HAND'),avatar(costume='BASIC_1',part='HAND_ALPHA'),
                  avatar(costume='BASIC',part='ONE_PIECE')])
        self.add([hair],'duplicate.cmf')
        defaults=self.groups.bundle('STRIKER|CLOTH_212_A')['defaults']
        for part in ('HAIR','HAND'):
            slot=next(s for s in defaults if s['part']==part)
            self.assertEqual(len(slot['candidates']),2)
            self.assertIsNone(slot['selected'])
        self.assertFalse(any(s['part']=='HAND' and s['variant']=='ALPHA' for s in defaults))
        self.assertIn('ONE_PIECE',{s['part'] for s in defaults})

    def test_character_mismatch_cannot_merge_face_or_motion(self):
        self.add([avatar(),avatar(character='CASTER',part='FACE'),'MOTION_CASTER.X'])
        ids={r['name']:r['id'] for r in self.catalog.entries({})['items']};models=Models(self.catalog)
        with self.assertRaisesRegex(ValueError,'서로 다른'):models.scene([ids[avatar()],ids[avatar(character='CASTER',part='FACE')]])
        with self.assertRaisesRegex(ValueError,'공용 뼈'):models.scene([ids[avatar()]],ids['MOTION_CASTER.X'])

    def test_one_piece_and_own_face_precedence(self):
        self.add([avatar(part=p) for p in ['ONE_PIECE','UPBODY','LOWBODY','FACE']]+[avatar(costume='BASIC',part='FACE')])
        bundle=self.groups.bundle('STRIKER|CLOTH_212_A')
        self.assertFalse(any(s['checked'] for s in bundle['slots'] if s['part'] in ('UPBODY','LOWBODY')))
        self.assertTrue(next(s for s in bundle['slots'] if s['part']=='ONE_PIECE')['checked'])
        self.assertEqual(len(bundle['face']['candidates']),1)
        self.assertIn('CLOTH_212_A',bundle['face']['candidates'][0]['name'])
        with self.assertRaises(ValueError):self.groups.bundle('STRIKER|A')
        self.add([avatar(costume='CLOTH_213_A',part=p) for p in ['ONE_PIECE_DYE','UPBODY','LOWBODY']],'dye-only.cmf')
        dye=self.groups.bundle('STRIKER|CLOTH_213_A')
        self.assertTrue(all(s['checked'] for s in dye['slots'] if s['part'] in ('UPBODY','LOWBODY')))


if __name__=='__main__':unittest.main()
