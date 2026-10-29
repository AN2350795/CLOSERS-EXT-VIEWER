import test_specular_source_browser


class SpecularPositionSourceBrowserTests(test_specular_source_browser.SpecularSourceBrowserTests):
    capture_label='regional-specular'
    require_position=True
