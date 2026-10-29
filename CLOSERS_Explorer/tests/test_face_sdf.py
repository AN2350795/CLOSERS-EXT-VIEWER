import unittest
from closers.model_face import face_sdf_preview


class FaceSdfPlanTests(unittest.TestCase):
    def test_explicit_sdf_face_requires_unique_head_and_uv(self):
        mesh=dict(name='FACE_SDF_MC',uv=[0,0]);mat=dict(texture='folder/BASIC_FACE.TGA');frames=[dict(name='BIP01_HEAD')]
        p=face_sdf_preview(mesh,mat,frames)
        self.assertEqual(p['status'],'approximate');self.assertEqual(p['head_bone'],'BIP01_HEAD')
        for current in ([],frames*2):self.assertEqual(face_sdf_preview(mesh,mat,current)['status'],'unsupported')
        self.assertEqual(face_sdf_preview(dict(mesh,uv=[]),mat,frames)['status'],'unsupported')

    def test_eye_and_non_sdf_surfaces_do_not_acquire_face_shading(self):
        for mesh,texture in [('FACE_MC','BASIC_FACE.TGA'),('NOTSDF_MC','BASIC_FACE.TGA'),('FACE_SDF_MC','BASIC_FACE_EYE.TGA'),('FACE_SDF_MC','EYE.TGA'),('FACE_SDF_MC','CLOTH.PNG')]:
            self.assertIsNone(face_sdf_preview(dict(name=mesh,uv=[0,0]),dict(texture=texture),[dict(name='BIP01_HEAD')]))
