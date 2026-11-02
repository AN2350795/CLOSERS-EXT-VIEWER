"""Compare real emissive costume effect transitions against CPU image math."""
import test_emission_source_browser


class PostprocessSourceBrowserTests(test_emission_source_browser.EmissionSourceBrowserTests):
    checks_script='postprocess_source_checks.js'
    reference_script='postprocess_reference.js'
