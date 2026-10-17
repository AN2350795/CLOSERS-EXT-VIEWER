"""Verify full-influence GPU skinning against independently deformed geometry."""
import test_picker_browser


class SkinningBrowserTests(test_picker_browser.PickerBrowserTests):
    checks_script = 'skinning_checks.js'
