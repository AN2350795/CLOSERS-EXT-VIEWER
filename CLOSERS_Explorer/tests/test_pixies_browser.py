"""Replay installed Aura Pixies mask textures without committing assets."""
import test_christmas_browser


class PixiesBrowserTests(test_christmas_browser.ChristmasBrowserTests):
    checks_script='pixies_checks.js'
    characters=(('ROGUE',''),)
    sequence_keys=('SI_COMMON_EMOTION_AURA_PIXIES',)
    animation_pattern='MOTION_{character}_EMOTION_AURA_PIXIES.XMD'
