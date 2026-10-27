import unittest
from closers.model_attachment import attachment,transform,vector


class AttachmentTests(unittest.TestCase):
    def test_source_fields_and_invalid_vectors(self):
        row=[0]*36;row[20]='BIP01_HEAD';row[15]='{.9, 1, 1.1}';row[16]='{0,13,0}';row[17]='{-5,0,3}'
        value=attachment(row,'source.NTF')
        self.assertEqual(value['bone'],'BIP01_HEAD')
        self.assertEqual(value['scale'],[.9,1,1.1])
        self.assertEqual(value['rotation'],[0,13,0])
        self.assertEqual(value['offset'],[-5,0,3])
        for bad in ('{nan,0,0}','{inf,0,0}','{1,2}','1,2,3','{100001,0,0}'):
            row[17]=bad;self.assertEqual(attachment(row,'source')['status'],'unavailable')
        self.assertEqual(vector('',(1,1,1)),[1,1,1])
        row[20]='';self.assertIsNone(attachment(row,'source'))

    def test_local_scale_rotation_then_translation(self):
        value=dict(scale=[2,3,4],rotation=[0,90,0],offset=[5,6,7])
        matrix=transform(value)
        def point(p):return [sum(p[j]*matrix[j*4+i] for j in range(3))+matrix[12+i] for i in range(3)]
        for actual,expected in zip(point([1,0,0]),[5,6,5]):self.assertAlmostEqual(actual,expected)
        for actual,expected in zip(point([0,0,1]),[9,6,7]):self.assertAlmostEqual(actual,expected)
        value['rotation']=[90,90,0]
        matrix=transform(value)
        for actual,expected in zip(point([0,1,0]),[8,6,7]):self.assertAlmostEqual(actual,expected)
