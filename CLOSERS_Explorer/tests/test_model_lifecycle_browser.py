from test_picker_browser import PickerBrowserTests


class ModelLifecycleBrowserTests(PickerBrowserTests):
    checks_script='model_lifecycle_checks.js'
    extra_images=('/api/composition-image/71','/api/composition-image/72')
