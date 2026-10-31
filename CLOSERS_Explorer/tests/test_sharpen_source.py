from pathlib import Path
import unittest
from audit_sharpen import audit,SHADER_SHA256


class SharpenSourceTests(unittest.TestCase):
    def test_installed_shader_and_cpu_association(self):
        workspace=Path(__file__).resolve().parents[2]/'results';exe=Path('C:/Program Files (x86)/NaddicGames/Closers/CW.EXE')
        if not (workspace/'catalog.sqlite3').exists() or not exe.exists():self.skipTest('Local game source unavailable')
        report=audit(workspace,exe)
        self.assertEqual(report['shader']['sha256'],SHADER_SHA256);self.assertTrue(report['shader']['sources'])
        self.assertEqual(len(report['cpu']['checks']),42)
        self.assertEqual(report['cpu']['sharpen']['coefficient'],'sampling radius in target pixels')
        self.assertFalse(report['game_executed']);self.assertFalse(report['viewer_defaults_changed'])
