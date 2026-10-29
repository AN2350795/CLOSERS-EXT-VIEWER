"""Check source explicit mip-zero sampling under texture minification."""
import test_picker_browser


class MatcapLodBrowserTests(test_picker_browser.PickerBrowserTests):
    checks_script='matcap_lod_checks.js'
