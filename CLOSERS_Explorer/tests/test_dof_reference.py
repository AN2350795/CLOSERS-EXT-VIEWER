import unittest
from dof_reference import depth_encoding, sampling_offsets, gather


class DofReferenceTests(unittest.TestCase):
    def test_near_focus_far_encoding_and_far_cap(self):
        values = [depth_encoding(z, [0, 1000, 6000, .5]) for z in (0, 1000, 3500, 6000)]
        self.assertEqual([v['shader_rgb'] for v in values], [0, .5, .75, .75])
        self.assertEqual([v['approximate_unorm8'] for v in values], [0, 128, 191, 191])
        self.assertEqual([v['branch'] for v in values], ['near', 'far', 'far', 'far'])

    def test_shader_near_value_is_not_clamped_until_target_storage(self):
        result = depth_encoding(-1000, [0, 1000, 6000, .5])
        self.assertEqual(result['shader_rgb'], -.5)
        self.assertEqual(result['approximate_unorm8'], 0)

    def test_unused_degenerate_branch_is_not_silently_replaced(self):
        self.assertGreater(depth_encoding(100, [0, 0, 6000, .5])['shader_rgb'], .5)
        with self.assertRaisesRegex(ValueError, 'denominator'):
            depth_encoding(-1, [0, 0, 6000, .5])
        with self.assertRaisesRegex(ValueError, 'denominator'):
            depth_encoding(10, [0, 10, 10, .5])

    def test_focus_and_two_sampling_radii_use_explicit_render_constant(self):
        focus = sampling_offsets(.5, [1920, 1080], [.5, 1, 1, 0])
        self.assertTrue(all(x == 0 and y == 0 for x, y in focus['fine'] + focus['coarse']))
        off = sampling_offsets(.75, [120, 67], [.5, 1, 2, 1])
        self.assertEqual(len(off['fine']), 8)
        self.assertEqual(off['fine'][0], (0, 0))
        self.assertTrue(off['debug'])
        self.assertAlmostEqual(off['coarse'][1][0] / off['fine'][1][0], 4)
        self.assertIn('not assumed viewport', off['render_size_scope'])

    def test_depth_weighted_gather_is_not_an_unweighted_blur(self):
        result = gather(.5, [[1, 0, 0]]*4 + [[0, 0, 1]]*4,
                        [.25]*4 + [.75]*4, [[0, 0, 0, .25]]*4 + [[0, 0, 0, .75]]*4)
        self.assertEqual(result['weight_sum'], 6)
        self.assertAlmostEqual(result['rgba'][0], 1/6)
        self.assertAlmostEqual(result['rgba'][2], 1/3)
        self.assertEqual(result['rgba'][3], 1)
        self.assertFalse(result['rendering_enabled'])

    def test_constant_input_and_source_alpha(self):
        result = gather(.75, [[.2, .3, .4]]*8, [.75]*8, [[.2, .3, .4, .75]]*8)
        for actual, expected in zip(result['rgba'], [.2, .3, .4, 1]):
            self.assertAlmostEqual(actual, expected)

    def test_invalid_diagnostic_inputs_and_zero_normalization_are_rejected(self):
        with self.assertRaisesRegex(ValueError, 'denominator is zero'):
            gather(.8, [[1, 0, 0]]*8, [.5]*8, [[1, 0, 0, .5]]*8)
        with self.assertRaises(ValueError):
            sampling_offsets(.5, [0, 100], [.5, 1, 1, 0])
        with self.assertRaises(ValueError):
            depth_encoding(float('nan'), [0, 1000, 6000, .5])
        with self.assertRaises(ValueError):
            gather(.5, [[1, 0, 0]]*7, [.5]*8, [[1, 0, 0, .5]]*8)
