"""Reuse installed-source preparation for the Rider Call regression."""
import test_christmas_browser


class RiderBrowserTests(test_christmas_browser.ChristmasBrowserTests):
    checks_script='rider_checks.js'
    characters=(('ROGUE',''),('KNIVES',''),('RANGER',''),('FIGHTER',''))
    sequence_keys=('SI_COMMON_EMOTION_RARE_7_COSTUME',)
    animation_pattern='MOTION_{character}_EMOTION_RARE_7.XMD'
