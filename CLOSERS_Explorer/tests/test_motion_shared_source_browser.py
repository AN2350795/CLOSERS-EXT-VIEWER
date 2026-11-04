"""A real shared dungeon/town motion must retain its source foot dust."""
import base64
import json
from pathlib import Path

import test_picker_browser
from closers.catalog import Catalog
from closers.composition import CompositionImages
from closers.model_library import Models


class MotionSharedSourceBrowserTests(test_picker_browser.PickerBrowserTests):
    checks_script='motion_shared_source_checks.js'

    def test_picker(self):
        workspace=Path(__file__).resolve().parents[2]/'results'
        if not (workspace/'catalog.sqlite3').exists():self.skipTest('Local game source unavailable')
        models=Models(Catalog(workspace));composition=CompositionImages(models.catalog)
        def unique(name):
            entries=models.matches(name);self.assertEqual(len(entries),1,name)
            return entries[0]['id']
        skeleton=unique('MOTION_STRIKER.X');animation=unique('MOTION_STRIKER_COMMON_RARE_2.XMD')
        info=models.animations(skeleton,animation)
        index=next(c['index'] for c in info['clips'] if c['name']=='CASH_RARE_2_RUN')
        clip=models.clip(skeleton,animation,index,info['animation_source']['sha256'])
        dust=[e for e in clip['extras'] if e.get('particle_name')=='FOOT_DUST']
        self.assertEqual(len(dust),1)
        self.assertEqual({c['type'] for c in dust[0]['motion_conversion_options']},{'SCT_TOWN_MOTION','SCT_DUNGEON_MOTION'})
        self.assertFalse(dust[0]['conditions']);self.assertEqual(dust[0]['status'],'ready')
        self.assertFalse(dust[0]['particle']['warnings'])
        data=models.scene([unique('340021604_GUST_USER_STRIKER_RARE_2_A_EP_AVATAR_DEFENCE_UPBODY.X')],skeleton_id=skeleton)
        images={}
        for image in dust[0]['images']:
            entry=image['selected'];self.assertIsNotNone(entry)
            path,metadata=composition.prepare(entry)
            images[entry]=dict(metadata,body=base64.b64encode(path.read_bytes()).decode('ascii'))
        fixture=dict(data=data,clip=clip,images=images)
        self.script_prefix='const sharedMotionFixture='+json.dumps(fixture,ensure_ascii=True)+';\n'
        super().test_picker()
