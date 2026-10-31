from pathlib import Path
import tempfile
import unittest

from closers.ext_binding import world_ext_objects
from audit_ext_binding import audit,worlds
from test_world_lighting import chunk


class ExtBindingTests(unittest.TestCase):
    def report(self,*rows):
        return world_ext_objects(chunk(dict(m_vecWorldObjData=dict(enumerate(rows,1)))))

    def test_constructor_defaults_are_distinct_from_explicit_values(self):
        report=self.report(dict(m_MeshName='A.X'),dict(m_bUseExt=False,m_fUseExtIntensity=0))
        missing,explicit=report['objects']
        self.assertEqual(missing['enabled'],dict(literal=None,effective=False,origin='source-constructor',valid=True))
        self.assertEqual(missing['intensity']['effective'],1)
        self.assertEqual(explicit['intensity']['effective'],0)
        self.assertEqual(explicit['intensity']['origin'],'explicit-literal')
        self.assertEqual(report['avatar_binding'],'unresolved');self.assertFalse(report['rendering_enabled'])

    def test_enabled_and_factor_are_independent(self):
        for flag in (True,'TRUE',False,'FALSE'):
            for factor in (0,.25,1,4,-2):
                row=self.report(dict(m_bUseExt=flag,m_fUseExtIntensity=factor))['objects'][0]
                self.assertEqual(row['enabled']['effective'],flag in (True,'TRUE'))
                self.assertEqual(row['intensity']['effective'],factor)
                self.assertEqual(row['status'],'source-only')

    def test_invalid_flag_does_not_become_a_default(self):
        for value in (0,1,'true','FALSE()',{},2):
            row=self.report(dict(m_bUseExt=value))['objects'][0]
            self.assertEqual(row['status'],'unresolved');self.assertIsNone(row['enabled']['effective'])

    def test_invalid_factor_does_not_become_one_or_zero(self):
        for value in (True,'1',1e39,{}):
            row=self.report(dict(m_bUseExt=True,m_fUseExtIntensity=value))['objects'][0]
            self.assertEqual(row['status'],'unresolved');self.assertIsNone(row['intensity']['effective'])
        for value in (float('inf'),float('nan')):
            with self.assertRaises(ValueError):self.report(dict(m_fUseExtIntensity=value))

    def test_duplicate_models_retain_separate_object_scopes(self):
        a,b=self.report(dict(m_MeshName='SAME.X',m_bUseExt=True),dict(m_MeshName='SAME.X',m_bUseExt=False))['objects']
        self.assertNotEqual(a['source_path'],b['source_path'])
        self.assertNotEqual(a['enabled']['effective'],b['enabled']['effective'])

    def test_missing_and_malformed_containers_do_not_activate_any_model(self):
        report=world_ext_objects(chunk({}))
        self.assertFalse(report['container_present']);self.assertEqual(report['objects'],[])
        with self.assertRaises(ValueError):world_ext_objects(chunk(dict(m_vecWorldObjData='expression')))
        with self.assertRaises(ValueError):world_ext_objects(b'os.execute("anything")')
        row=self.report('expression')['objects'][0]
        self.assertEqual(row['status'],'unresolved');self.assertNotIn('intensity',row)

    def test_unrecognized_executable_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'unknown.exe';path.write_bytes(b'not the audited game')
            with self.assertRaisesRegex(ValueError,'Unrecognized'):audit(path)

    def test_installed_executable_matches_all_evidence(self):
        path=Path('C:/Program Files (x86)/NaddicGames/Closers/CW.EXE')
        if not path.exists():self.skipTest('Local game executable unavailable')
        report=audit(path)
        self.assertEqual(report['status'],'verified',str(report['checks']))
        self.assertEqual(len(report['checks']),9);self.assertFalse(report['game_executed'])

    def test_original_regions_do_not_supply_avatar_coefficients(self):
        workspace=Path(__file__).resolve().parents[2]/'results'
        if not (workspace/'catalog.sqlite3').exists():self.skipTest('Local game catalog unavailable')
        from closers.world_lighting import REGIONS
        reports=worlds(workspace,[name for name,_ in REGIONS])
        for report,count,enabled in zip(reports,(25,29),(3,0)):
            self.assertEqual(report['status'],'source-only');self.assertEqual(len(report['objects']),count)
            self.assertEqual(sum(r['enabled']['effective'] is True for r in report['objects']),enabled)
            self.assertTrue(all(r['intensity']['effective']==1 and r['intensity']['origin']=='source-constructor' for r in report['objects']))
            self.assertTrue(report['sources']);self.assertEqual(len(report['sha256']),64)
            self.assertEqual(report['scope'],'world-object-template');self.assertFalse(report['rendering_enabled'])
            self.assertEqual(report['avatar_binding'],'unresolved')
