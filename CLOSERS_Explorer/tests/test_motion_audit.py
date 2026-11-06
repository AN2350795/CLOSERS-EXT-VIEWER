import json
from pathlib import Path
import tempfile
import unittest

from closers.catalog import Catalog
from closers.motion_audit import audit
from closers.motion_catalog import build, decorate
from test_explorer import fixture
from test_model import animation, binary_model


class MotionAuditTests(unittest.TestCase):
    def test_registrations_do_not_require_base_states_and_preserve_conflicts(self):
        source = 'TOWN_MOTION_CONVERT_DATA.NTF'
        rows = [[7, 'GUST_INVALID', 'USN_IDLE', 'GENERIC'],
                [7, 'GUST_USER_STRIKER', 'USN_IDLE', 'EXACT'],
                [8, 'GUST_INVALID', 'USN_ABSENT', 'UNRESOLVED'],
                [9, 'GUST_INVALID', 'USN_IDLE', 'ONE'],
                [9, 'GUST_INVALID', 'USN_IDLE', 'TWO']]
        result = build({source: rows}, ['STRIKER', 'CASTER'])
        self.assertNotIn(('STRIKER', 'GENERIC'), result)
        self.assertIn(('CASTER', 'GENERIC'), result)
        self.assertIn(('STRIKER', 'UNRESOLVED'), result)
        self.assertTrue(result['STRIKER', 'ONE'][0]['ambiguous'])
        clips = [dict(name='EXACT')]
        marked = decorate(clips, 'STRIKER', result)
        self.assertEqual(marked[0]['motion_categories'], ['town'])
        self.assertEqual(clips, [dict(name='EXACT')])

    def test_extract_keeps_unparseable_and_duplicate_sources(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            first = fixture(root / 'one.cmf', [
                ('MOTION_STRIKER.X', binary_model(), 0),
                ('MOTION_STRIKER.XMD', animation(), 0),
                ('MOTION_STRIKER_TOWN_BAD.XMD', b'unsupported-version', 0),
                ('NPC.XMD', animation(), 0)])
            second = fixture(root / 'two.cmf', [('MOTION_STRIKER.XMD', animation(), 0)])
            catalog = Catalog(root / 'work')
            catalog.scan([first, second])
            result = audit(catalog, root / 'audit', extract=True)
            self.assertEqual(result['xmd_files'], 4)
            self.assertEqual(result['parse_unavailable'], 1)
            self.assertEqual(result['playback_unavailable'], 1)
            self.assertEqual(result['extraction']['failed'], 0)
            report = json.loads(Path(result['report']).read_text(encoding='utf-8'))
            bad = next(file for file in report['files'] if file['parse_status'] != 'ready')
            self.assertEqual(Path(bad['output']).read_bytes(), b'unsupported-version')
            first.unlink(); second.unlink()
            offline = audit(catalog, root / 'offline', character='STRIKER')
            self.assertEqual(offline['xmd_files'], 3)
            self.assertEqual(offline['parse_unavailable'], 1)
