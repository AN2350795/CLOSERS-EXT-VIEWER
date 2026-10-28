"""Verify actual per-surface toon changes and original costume light presets."""
import test_matcap_source_browser


class ToonSourceBrowserTests(test_matcap_source_browser.MatcapSourceBrowserTests):
    costume_set='CLOTH_216_B'
    capture_label='aurora-pixies-b-toon'
    require_toon=True
