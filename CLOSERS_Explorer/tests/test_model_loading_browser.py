"""Verify opening feedback with delayed success and failure in the real viewer."""
import test_picker_browser


class ModelLoadingBrowserTests(test_picker_browser.PickerBrowserTests):
    checks_script = 'model_loading_checks.js'
