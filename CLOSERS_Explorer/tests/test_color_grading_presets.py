import struct
import unittest
from closers.color_grading import read_presets, SOURCE, TYPES, CHANNELS
from closers.avatar_lighting import read_profiles
from test_avatar_lighting import Data
from test_game_names import table


def bits(v):
    return struct.unpack('<I', struct.pack('<f', v))[0]


def channel_rows():
    result = []
    for c in CHANNELS:
        low, high = (-1, 1) if c in ('BRI', 'CON') else (0, 2)
        result.append((3, 0, 'ST_OPTION_GRAPHIC_OPTION_COLOR_GRADING_'+c, '', '',
                       *map(bits, [1, low, high, -.01, .01, 0, 0, 0, 0, 0]), ''))
    return result


def preset(key=5, values=(1, 1, 1.1, 0, .05, 1.3)):
    return (5, key, 'NAME', '', '', *map(bits, [1, 1, *values, 0, 0]), 'ICON.PNG')


def sharp_range():
    return (4,0,'','','',*map(bits,[0,0,5,-.01,.01,0,0,0,0,0]),'')


class ColorGradingPresetTests(unittest.TestCase):
    def test_other_postprocess_metadata_does_not_change_applied_scope(self):
        row=list(preset());row[5]=bits(0);row[6]=bits(.5);row[13]=bits(1.5)
        p=self.read(channel_rows()+[sharp_range(),row])[0]
        self.assertEqual(p['selection_scope'],'graphics-option');self.assertEqual(p['source_category'],5)
        self.assertEqual(p['scope'],'color-grading-only');other=p['other_postprocess']
        self.assertEqual(other['scope'],'not-applied')
        self.assertFalse(other['bloom']['enabled']);self.assertFalse(other['depth_of_field']['enabled'])
        self.assertTrue(other['sharpen']['enabled']);self.assertEqual(other['sharpen']['value'],1.5)
        self.assertEqual(other['sharpen']['source_column'],13)

    def test_bad_other_effects_are_isolated_from_color_values(self):
        for column in (5,6,13):
            row=list(preset());row[column]=bits(float('nan'))
            p=self.read(channel_rows()+[sharp_range(),row])[0]
            self.assertEqual(p['rgb'][:2],[1,1]);self.assertTrue(p['source_enabled'])
            self.assertEqual(p['other_postprocess'][{5:'bloom',6:'depth_of_field',13:'sharpen'}[column]]['status'],'unavailable')
        row=list(preset());row[13]=bits(6)
        self.assertEqual(self.read(channel_rows()+[sharp_range(),row])[0]['other_postprocess']['sharpen']['status'],'unavailable')
        self.assertEqual(self.read(channel_rows()+[row])[0]['other_postprocess']['sharpen']['status'],'unavailable')
    def read(self, rows):
        return read_presets(Data({SOURCE: table(TYPES, rows)}))

    def test_source_columns_provenance_and_manual_scope(self):
        rows = channel_rows()+[preset()]
        p = self.read(rows)[0]
        self.assertEqual(p['key'], '5')
        self.assertEqual(p['label'], '테스트 의상 조명')
        self.assertAlmostEqual(p['rgb'][2], 1.1, places=6)
        self.assertAlmostEqual(p['bcs'][1], .05, places=6)
        self.assertAlmostEqual(p['bcs'][2], 1.3, places=6)
        self.assertEqual(p['source_row'], 6)
        self.assertEqual(len(p['source_sha256']), 64)
        self.assertEqual(p['scope'], 'color-grading-only')
        self.assertEqual(p['activation'], 'manual')

    def test_zero_saturation_is_preserved_and_activation_uses_all_channels(self):
        p = self.read(channel_rows()+[preset(4, (1, 1, 1, 0, 0, 0)), preset(8, (0, 0, 0, 0, 0, 0))])
        self.assertEqual(p[0]['bcs'][2], 0)
        self.assertTrue(p[0]['source_enabled'])
        self.assertFalse(p[1]['source_enabled'])

    def test_missing_source_has_no_invented_presets(self):
        self.assertEqual(read_presets(Data({})), [])

    def test_duplicate_ids_channels_or_missing_range_rejected(self):
        for rows in [channel_rows()+[preset(), preset()], channel_rows()+[channel_rows()[0], preset()], channel_rows()[1:]+[preset()]]:
            with self.subTest(rows=len(rows)), self.assertRaises(ValueError):
                self.read(rows)

    def test_nonfinite_or_outside_source_range_rejected(self):
        for v in [float('nan'), float('inf'), 3]:
            with self.subTest(value=v), self.assertRaises(ValueError):
                self.read(channel_rows()+[preset(values=(v, 1, 1, 0, 0, 1))])

    def test_unknown_layout_rejected_and_failure_does_not_block_lights(self):
        with self.assertRaises(ValueError):
            read_presets(Data({SOURCE: table((5,), [(1,)])}))
        sources = {
            SOURCE: b'invalid',
            'LIGHT_CONVERT_DATA.NTF': table((2,8,8,9,9,9), [(1,'1,1,1,1','1,0,0',bits(1),bits(1),bits(0))]),
            'LIGHT_CONVERT_TEMPLET.NTF': table((8,4,4,12,8,12,2,4,8,8), [('CVN_SKIN_COMMON',1411,5,0,'"GUST_USER_ROGUE",',0,1,1409,'NAME','DESC')]),
        }
        report = read_profiles(Data(sources))
        self.assertEqual(report['color_grading_presets'], [])
        self.assertTrue(report['color_grading_unavailable'])
        self.assertEqual(len(report['profiles']), 1)

    def test_changed_or_reversed_source_ranges_are_not_silently_clamped(self):
        for low, high in [(1, 0), (0, 3)]:
            rows = channel_rows()
            row = list(rows[0]);row[6:8] = [bits(low), bits(high)];rows[0] = row
            with self.subTest(low=low, high=high), self.assertRaises(ValueError):
                self.read(rows+[preset()])

    def test_original_catalog_presets(self):
        from pathlib import Path
        from closers.catalog import Catalog
        from closers.loading import LoadingData
        workspace = Path(__file__).resolve().parents[2]/'results'
        if not (workspace/'catalog.sqlite3').exists():
            self.skipTest('Local game catalog unavailable')
        profiles = read_presets(LoadingData(Catalog(workspace)))
        self.assertEqual(len(profiles), 7)
        self.assertEqual([v['other_postprocess']['bloom']['enabled'] for v in profiles],[True,True,True,False,True,True,True])
        self.assertEqual([v['other_postprocess']['depth_of_field']['enabled'] for v in profiles],[True,True,True,False,True,False,True])
        self.assertEqual([v['other_postprocess']['sharpen']['enabled'] for v in profiles],[True,False,False,True,False,True,False])
        p = next(p for p in profiles if p['key'] == '5')
        self.assertTrue(p['source_enabled'])
        self.assertAlmostEqual(p['rgb'][2], 1.1, places=6)
        self.assertAlmostEqual(p['bcs'][1], .05, places=6)
        self.assertAlmostEqual(p['bcs'][2], 1.3, places=6)
