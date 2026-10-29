import test_picker_browser


class FaceSdfBrowserTests(test_picker_browser.PickerBrowserTests):
    checks_script='face_sdf_checks.js'
    extra_images=('/api/composition-image/71',)
