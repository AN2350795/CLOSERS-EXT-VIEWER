import tempfile
from pathlib import Path
import unittest
from unittest.mock import Mock

from PIL import Image
from audit_ext_materials import channels,inspect_ext,audit


class ExtAuditTests(unittest.TestCase):
    def test_original_maps_include_zero_and_nonzero_b_without_enabling_rendering(self):
        workspace=Path(__file__).resolve().parents[2]/'results'
        if not (workspace/'catalog.sqlite3').exists():self.skipTest('Local game catalog unavailable')
        result=audit(workspace)
        self.assertFalse(result['rendering_enabled'])
        self.assertEqual(len(result['models']),6)
        for model,maximum in zip(result['models'],(0,0,0,12,21,41)):
            self.assertEqual(model['status'],'inspected',str(model))
            self.assertEqual(len(model['materials']),1,str(model))
            material=model['materials'][0]
            self.assertEqual(material['status'],'source-only',str(material))
            self.assertEqual(material['channels']['b']['max'],maximum)
            self.assertEqual(material['b_signal'],'nonzero' if maximum else 'zero')
            self.assertEqual(material['b_binding'],'unresolved-runtime-factor')
            self.assertFalse(material['rendering_enabled'])
            self.assertEqual(len(material['source']['source_sha256']),64)

    def test_rgb_and_alpha_are_independent_including_transparent_texels(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'ext.png'
            image=Image.new('RGBA',(2,1));image.putdata([(0,211,255,0),(66,0,0,255)]);image.save(path);image.close()
            result=channels(path)
            self.assertEqual(result['pixels'],2)
            self.assertEqual(result['channels'],dict(r=dict(min=0,max=66,nonzero_pixels=1),
                g=dict(min=0,max=211,nonzero_pixels=1),b=dict(min=0,max=255,nonzero_pixels=1),
                a=dict(min=0,max=255,nonzero_pixels=1)))

    def test_zero_b_is_preserved_and_never_becomes_a_render_factor(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'ext.png';Image.new('RGB',(1,1),(0,255,0)).save(path)
            images=Mock();images.prepare.return_value=(path,dict(source_sha256='original'))
            result=inspect_ext(self.preview(12),images)
            self.assertEqual((result['r_signal'],result['b_signal']),('zero','zero'))
            self.assertEqual(result['b_binding'],'unresolved-runtime-factor')
            self.assertFalse(result['rendering_enabled']);self.assertNotIn('factor',result)
            self.assertEqual(result['source']['source_sha256'],'original')
            images.prepare.assert_called_once_with(12)

    def test_ambiguous_image_never_reads_a_candidate(self):
        images=Mock();result=inspect_ext(self.preview(None),images)
        self.assertEqual(result['status'],'unresolved');images.prepare.assert_not_called()
        self.assertNotIn('channels',result)

    def test_unreadable_source_does_not_report_zero_channels(self):
        images=Mock();images.prepare.side_effect=ValueError('source changed')
        result=inspect_ext(self.preview(12),images)
        self.assertEqual(result['status'],'unresolved');self.assertNotIn('channels',result)

    @staticmethod
    def preview(selected):
        return dict(source_texture='ORIGINAL.PNG',texture='ORIGINAL_EXT.PNG',
                    image=dict(selected=selected,candidates=[dict(id=12),dict(id=13)]))
