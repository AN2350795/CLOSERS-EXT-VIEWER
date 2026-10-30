"""Render per-item skin materials with rigid, regular and extended skinning."""
import test_picker_browser


class MaterialsBrowserTests(test_picker_browser.PickerBrowserTests):
    image_color=(16,32,64,255)
    checks_script = 'materials_checks.js'
    extra_images = ('/api/composition-image/71','/api/composition-image/72')
