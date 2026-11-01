"""Exercise DOF with local costume textures and the real bloom renderer."""
import test_emission_source_browser


class DofSourceBrowserTests(test_emission_source_browser.EmissionSourceBrowserTests):
    checks_script = 'dof_source_checks.js'
