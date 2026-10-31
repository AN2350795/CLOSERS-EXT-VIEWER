import test_picker_browser


class AvatarLightConditionsBrowserTests(test_picker_browser.PickerBrowserTests):
    checks_script='avatar_light_conditions_checks.js'


class ConditionItemsSceneBrowserTests(test_picker_browser.PickerBrowserTests):
    checks_script='condition_items_scene_checks.js'
