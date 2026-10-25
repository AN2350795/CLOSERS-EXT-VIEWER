"""Use installed Harpy assets without storing game data in the repository."""
import base64
import json
from pathlib import Path
import test_picker_browser


class SolomonVisibilityBrowserTests(test_picker_browser.PickerBrowserTests):
    checks_script='solomon_visibility_checks.js'

    def test_picker(self):
        from closers.catalog import Catalog
        from closers.model_library import Models
        from closers.composition import CompositionImages
        workspace=Path(__file__).resolve().parents[2]/'results'
        if not (workspace/'catalog.sqlite3').exists():self.skipTest('Local game catalog unavailable')
        catalog=Catalog(workspace);models=Models(catalog);matches=models.matches('MOTION_ROGUE_DEVIL_RARE_6.X')
        if len(matches)!=1:self.skipTest('Harpy summon fixture unavailable')
        rig=matches[0]['id'];scene=models.scene([rig]);animation=scene['animation']['selected']
        metadata=models.animations(rig,animation);own=[models.clip(rig,animation,i,metadata['animation_source']['sha256']) for i in range(3)]
        images=[];composition=CompositionImages(catalog)
        for mesh in scene['meshes']:
            for material in mesh['materials']:
                path,_=composition.prepare(material['image']['selected']);images.append(base64.b64encode(path.read_bytes()).decode())
                material['image']=None
        clips=[]
        for name,index in [('CASH_RARE_6_EMOTION',0),('CASH_RARE_6_EMOTION_LOOP',2),('CASH_RARE_6_EMOTION_END',1)]:
            entries=catalog.game_names.motion_extras['ROGUE',name]
            entry=next(e for e in entries if e.get('models')==['MOTION_ROGUE_DEVIL_RARE_6.X'])
            clips.append(dict(clip=dict(name=name,duration=own[index]['clip']['duration']),extras=[dict(entry,resources=[dict(selected=rig)])]))
        fixture=dict(scene=scene,metadata=metadata,own=own,images=images,clips=clips)
        self.script_prefix='const solomonFixture='+json.dumps(fixture,ensure_ascii=True).replace('</','<\\/')+';\n'
        super().test_picker()
