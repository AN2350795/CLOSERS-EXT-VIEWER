"""Use the real app to exercise model replacement, decode races and shutdown."""
import test_picker_browser


class ModelPostprocessLifecycleBrowserTests(test_picker_browser.PickerBrowserTests):
    checks_script='model_postprocess_lifecycle_checks.js'
