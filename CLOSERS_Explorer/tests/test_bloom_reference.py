import math
import unittest
from bloom_reference import blur_plan, avatar_mrt


class BloomReferenceTests(unittest.TestCase):
    def test_avatar_keeps_surface_and_emission_in_separate_targets(self):
        surface = [.1, .2, .3, .4]
        report = avatar_mrt(surface, [.2, .4, .6, .8], [.5, .5, .5, .5], 2, .5)
        self.assertEqual(report['target0'], surface)
        self.assertEqual(report['target1'], [.1, .2, .3, .4])
        changed = avatar_mrt([.9, .8, .7, .6], [.2, .4, .6, .8], [.5, .5, .5, .5], 2, .5)
        self.assertEqual(changed['target1'], report['target1'])
        self.assertFalse(report['blending_applied'])
        self.assertFalse(report['quantization_applied'])

    def test_zero_emission_rgb_has_two_distinct_alpha_fallbacks(self):
        self.assertEqual(avatar_mrt([1, 1, 1, .25], [0, 0, 0, .5], [1]*4)['target1'], [0, 0, 0, .25])
        self.assertEqual(avatar_mrt([1, 1, 1, .25], [0, 0, 0, 0], [1]*4)['target1'], [0, 0, 0, 1])
        self.assertEqual(avatar_mrt([1, 1, 1, .25], [1]*4, [1]*4, 0)['target1'], [0, 0, 0, 1])

    def test_nonzero_rgb_does_not_use_alpha_to_multiply_or_clamp_shader_output(self):
        report = avatar_mrt([0, 0, 0, .25], [.25, .5, 1, 0], [1]*4, 2, 2)
        self.assertEqual(report['target1'], [1, 2, 4, 0])
        self.assertEqual(report['target0'], [0, 0, 0, .25])

    def test_avatar_diagnostic_rejects_invalid_values(self):
        for rgba in ([1, 1, 1], [1, 1, 1, float('nan')], [1, True, 1, 1]):
            with self.subTest(rgba=rgba), self.assertRaises(ValueError):
                avatar_mrt([1]*4, rgba, [1]*4)
        with self.assertRaises(ValueError):
            avatar_mrt([1]*4, [1]*4, [1]*4, float('inf'))

    def test_five_progressive_targets_use_integer_dimensions_and_target_offsets(self):
        report = blur_plan(1920, 1080)
        levels = report['levels']
        self.assertEqual([l['size'] for l in levels], [[960, 540], [480, 270], [240, 135], [120, 67], [60, 33]])
        self.assertEqual(levels[0]['input'], 'source MRT1 (+0x1a8)')
        self.assertEqual([l['input'] for l in levels[1:]], [f'vertical level {i}' for i in range(4)])
        self.assertAlmostEqual(levels[0]['horizontal_offsets'][-1], 4 / 960)
        self.assertAlmostEqual(levels[-1]['vertical_offsets'][0], -4 / 33)
        self.assertEqual(report['sampler']['filter'], 0x15)
        self.assertEqual(report['sampler']['address_uvw'], [3, 3, 3])
        self.assertEqual(report['target_format'], 28)
        self.assertFalse(report['rendering_enabled'])

    def test_fixed_resource_dimensions_do_not_assume_resource_key_is_mode(self):
        fixed = blur_plan(2560, 1440, resource_key=2, mode=1)
        self.assertEqual(fixed['size_base'], [390, 730])
        self.assertEqual([l['size'] for l in fixed['levels']], [[195, 365], [97, 182], [48, 91], [24, 45], [12, 22]])
        self.assertEqual(fixed['levels'][0]['input'], 'source MRT1 (+0x1a8)')
        other = blur_plan(2560, 1440, resource_key=1, mode=2)
        self.assertEqual(other['levels'][0]['size'], [1280, 720])
        self.assertEqual(other['levels'][0]['input'], 'source color (+0x1a0)')

    def test_default_kernel_is_symmetric_with_a_small_truncation_loss(self):
        report = blur_plan(1920, 1080)
        weights = report['weights']
        self.assertEqual(weights, list(reversed(weights)))
        self.assertAlmostEqual(weights[4], 0.39894228, places=7)
        self.assertAlmostEqual(weights[0], 0.0001338302, places=9)
        self.assertLess(report['weight_sum'], 1)
        self.assertGreater(report['weight_sum'], 0.99999)
        self.assertFalse(report['normalized'])

    def test_nonunit_sigma_keeps_the_extra_inverse_sigma_and_source_energy(self):
        report = blur_plan(1920, 1080, sigma=2)
        weights = report['weights']
        self.assertAlmostEqual(weights[4], 0.19947114, places=7)
        self.assertAlmostEqual(weights[5] / weights[4], math.exp(-1 / 32), places=12)
        self.assertGreater(report['weight_sum'], 1.4)
        self.assertFalse(report['normalized'])

    def test_unknown_modes_invalid_dimensions_and_bad_sigma_are_rejected(self):
        cases = [dict(width=31), dict(height=0), dict(width=True), dict(width=1920.5),
                 dict(mode=0), dict(mode=True), dict(resource_key=3),
                 *[dict(sigma=s) for s in (0, -1, True, float('inf'), float('nan'), 1e-300, 1e300)]]
        for values in cases:
            with self.subTest(values=values), self.assertRaises(ValueError):
                blur_plan(**(dict(width=1920, height=1080) | values))
