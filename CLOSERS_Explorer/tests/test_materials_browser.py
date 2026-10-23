"""Render per-item skin materials with rigid, regular and extended skinning."""
import test_picker_browser


class MaterialsBrowserTests(test_picker_browser.PickerBrowserTests):
    checks_script = 'materials_checks.js'
    extra_images = ('/api/composition-image/71','/api/composition-image/72')
