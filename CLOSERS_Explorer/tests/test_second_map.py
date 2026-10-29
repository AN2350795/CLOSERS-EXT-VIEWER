from pathlib import Path
import unittest
from closers.avatar_second_map import second_map,read_second_map
from test_world_lighting import chunk


class SecondMapTests(unittest.TestCase):
    def body(self,**values):
        return chunk(dict(m_HyperModeSecondTexture=values),root='GAME_UNIT_TEMPLET')

    def test_explicit_inputs_zero_signed_speed_and_hash(self):
        result=second_map(self.body(m_SecondTexture='ORIGINAL.DDS',m_SecondTexOffSetSpeed={1:0,2:-3}),'character.LUA')
        self.assertEqual(result['texture'],'ORIGINAL.DDS');self.assertEqual(result['speed'],[0,-3])
        self.assertEqual(result['activation'],'manual');self.assertFalse(result['bloom'])
        self.assertEqual(len(result['source_sha256']),64);self.assertIn('uv_animation',result['limitations'])

    def test_missing_block_and_invalid_inputs_are_not_defaulted(self):
        self.assertIsNone(second_map(chunk({},root='GAME_UNIT_TEMPLET'),'source'))
        for values in ({},{'m_SecondTexture':''},{'m_SecondTexture':'A.DDS','m_SecondTexOffSetSpeed':{1:3}},
                       {'m_SecondTexture':'A.DDS','m_SecondTexOffSetSpeed':{1:True,2:3}}):
            with self.assertRaises(ValueError):second_map(self.body(**values),'source')
        with self.assertRaises(ValueError):second_map(b'return os.execute("anything")','source')

    def test_optional_bad_or_missing_character_is_isolated(self):
        from closers.loading import MissingDefinition
        class Data:
            def __init__(self,error):self.error=error
            def body(self,name):raise self.error
            def cached(self,key,read,**kwargs):return read()
        self.assertIsNone(read_second_map(Data(MissingDefinition('missing')),'STRIKER'))
        result=read_second_map(Data(ValueError('source conflict')),'STRIKER')
        self.assertEqual(result['status'],'unavailable');self.assertNotIn('texture',result)
        self.assertEqual(result['reason'],'source conflict')

    def test_installed_character_and_model_bindings(self):
        from closers.catalog import Catalog
        from closers.loading import LoadingData
        from closers.model_library import Models
        workspace=Path(__file__).resolve().parents[2]/'results'
        if not (workspace/'catalog.sqlite3').exists():self.skipTest('Local game catalog unavailable')
        c=Catalog(workspace);data=LoadingData(c);models=Models(c)
        for character,entry in [('STRIKER',29537),('CASTER',30019),('RANGER',40142)]:
            source=read_second_map(data,character);self.assertEqual(source['texture'],'BD_TILES_HYPER_MODE.DDS');self.assertEqual(source['speed'],[3,3])
            scene=models.scene([entry]);previews=[m['second_preview'] for mesh in scene['meshes'] for m in mesh['materials']]
            self.assertTrue(previews)
            for preview in previews:
                self.assertEqual(preview['source'],f'GUST_USER_{character}.LUA')
                self.assertEqual(preview['status'],'approximate');self.assertIsNotNone(preview['image']['selected'],str(preview))
