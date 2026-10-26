"""Installed-source replay of the Underworld Gate sequence."""
import test_christmas_browser


class UndergateBrowserTests(test_christmas_browser.ChristmasBrowserTests):
    checks_script='undergate_checks.js'
    characters=(('ROGUE',''),('BEAST',''))
    sequence_keys=('SI_COMMON_EMOTION_RARE_8_COSTUME',)
    animation_pattern='MOTION_{character}_EMOTION_RARE_8.XMD'
