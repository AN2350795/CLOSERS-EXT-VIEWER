"""Verify source reflection inputs on the installed Aurora Pixies costume."""
import test_matcap_source_browser


class SpecularSourceBrowserTests(test_matcap_source_browser.MatcapSourceBrowserTests):
    costume_set='CLOTH_216_A'
    capture_label='aurora-pixies'
    require_specular=True
