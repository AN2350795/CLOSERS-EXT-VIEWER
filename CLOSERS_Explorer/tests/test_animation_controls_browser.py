"""Exercise motion selection and bind pose through the actual viewer."""
import test_picker_browser


class AnimationControlsBrowserTests(test_picker_browser.PickerBrowserTests):
    checks_script = 'animation_controls_checks.js'
