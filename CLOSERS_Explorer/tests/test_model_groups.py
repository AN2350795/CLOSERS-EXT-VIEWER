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
        self.assertIn('CASTER',{r['value'] for r in combined['facets']['character']})
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
