import test_picker_browser


class CameraLightBrowserTests(test_picker_browser.PickerBrowserTests):
    checks_script='camera_light_checks.js'


class CameraLightSavedFaceBrowserTests(CameraLightBrowserTests):
    script_prefix='window.restoreCameraMix=true;window.cameraFace=true;\n'


class CameraLightSceneBrowserTests(test_picker_browser.PickerBrowserTests):
    checks_script='camera_light_scene_checks.js'
