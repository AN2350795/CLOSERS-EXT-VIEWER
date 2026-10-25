"""Exercise installed game FBX and Spine data without checking assets into Git."""
import json
from pathlib import Path
import test_picker_browser


class EffectFormatsBrowserTests(test_picker_browser.PickerBrowserTests):
    checks_script='effect_formats_checks.js'
    extra_images=('/api/composition-image/71',)

    def test_picker(self):
        from closers.catalog import Catalog
        from closers.model_library import Models
        workspace=Path(__file__).resolve().parents[2]/'results'
        if not (workspace/'catalog.sqlite3').exists():self.skipTest('Local game catalog unavailable')
        models=Models(Catalog(workspace))
        def source(name):
            matches=models.matches(name)
            if len(matches)!=1:self.skipTest('Unique game fixture unavailable: '+name)
            return matches[0]['id']
        fixture=dict(skel=models.effect_resource(source('SPN_2026_SUMMER_STRIKER.SKEL')),
                     atlas=models.spine_atlas(source('SPN_2026_SUMMER_STRIKER.ATLAS')),
                     fbx=models.effect_resource(source('FBX_APRIL_FOOLS_TRANSFORMATION_LINE_02.FBX')))
        fixture['others']=[];fixture['other_fbx']=[];fbx_names=set()
        for raw in models.catalog.game_names.motion_particles.raw.values():
            if '.FBX' in raw:
                fbx_names.update(n for n in json.loads(raw).get('models',[]) if n.upper().endswith('.FBX'))
            if '"spine": {' not in raw:continue
            rule=json.loads(raw);name=rule['spine']['name']
            if name=='SPN_2026_SUMMER_STRIKER':continue
            fixture['others'].append(dict(rule=rule,skel=models.effect_resource(source(name+'.SKEL')),atlas=models.spine_atlas(source(name+'.ATLAS'))))
        for name in sorted(fbx_names):
            if name!='FBX_APRIL_FOOLS_TRANSFORMATION_LINE_02.FBX':fixture['other_fbx'].append(models.effect_resource(source(name)))
        self.script_prefix='const effectFixture='+json.dumps(fixture,ensure_ascii=True).replace('</','<\\/')+';\n'
        super().test_picker()
