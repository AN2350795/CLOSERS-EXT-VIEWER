"""Track live WebGL objects through effect toggles, resize and disposal."""
import test_picker_browser


class PostprocessLifecycleBrowserTests(test_picker_browser.PickerBrowserTests):
    checks_script = 'postprocess_lifecycle_checks.js'
