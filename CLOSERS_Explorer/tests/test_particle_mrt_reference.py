import unittest

from particle_mrt_reference import reference, cases


class ParticleMrtReferenceTests(unittest.TestCase):
    def test_zero_red_distinguishes_the_two_depth_alpha_modes(self):
        layers = [dict(blend=[5, 6], rgba=[0, .6, .8, .5], z=1, depth_test=True, depth_write=False)]
        self.assertEqual(reference(layers, 0, 2, 'right'), [80, 80, 80, 166])
        self.assertEqual(reference(layers, 1, 2, 'right'), [128, 128, 128, 38])
        self.assertEqual(reference(layers, 0, 2, 'outside'), [128, 128, 128, 38])

    def test_shared_mode_restore_and_zero_alpha_depth_write_affect_later_draws(self):
        fixtures = {case['name']: case for case in cases()}
        carried = fixtures['shared-mode-carried-to-normal-blend']['expected']
        reset = fixtures['saved-state-restore-clears-mode-before-normal']['expected']
        self.assertEqual(carried[0], reset[0])
        self.assertNotEqual(carried[1], reset[1])
        writing = fixtures['overlap/True/True/0']['expected']
        not_writing = fixtures['overlap/True/False/0']['expected']
        self.assertNotEqual(writing[0], not_writing[0])
        self.assertEqual(writing[0][0], [20, 31, 41, 51])
