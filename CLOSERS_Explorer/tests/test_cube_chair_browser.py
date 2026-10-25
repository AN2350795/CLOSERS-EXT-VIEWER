"""Replay cube-chair source data; do not commit extracted game assets."""
import base64
import json
from pathlib import Path
import test_picker_browser


class CubeChairBrowserTests(test_picker_browser.PickerBrowserTests):
    checks_script='cube_chair_checks.js'

    def test_picker(self):
        from closers.catalog import Catalog
        from closers.model_library import Models
        from closers.composition import CompositionImages
        workspace=Path(__file__).resolve().parents[2]/'results'
        if not (workspace/'catalog.sqlite3').exists():self.skipTest('Local game catalog unavailable')
        catalog=Catalog(workspace);models=Models(catalog)
        def source(name):
            rows=models.matches(name)
            if len(rows)!=1:self.skipTest('Unique fixture unavailable: '+name)
            return rows[0]['id']
        rig=source('MOTION_STRIKER.X');animation=source('MOTION_STRIKER_EMOTION_CIRCLE_SCHOOL_SIT.XMD')
        actor=models.scene([rig]);info=models.animations(rig,animation)
        definition=next(s for s in catalog.game_names.motion_sequences['STRIKER'] if s['key']=='SI_COMMON_EMOTION_GOMORI_CUBE_SIT')
        clips=[];scenes={};images={};composition=CompositionImages(catalog)
        def image(record):
            if not record or not record.get('selected'):return
            selected=record['selected']
            if selected not in images:
                path,metadata=composition.prepare(selected)
                images[selected]=dict(metadata,body=base64.b64encode(path.read_bytes()).decode())
        for step in definition['steps']:
            index=next(c['index'] for c in info['clips'] if c['name']==step['name'])
            packet=models.clip(rig,animation,index,info['animation_source']['sha256'])
            packet['extras']=[e for e in packet['extras'] if not e.get('state') or e['state']==step['state']]
            for entry in packet['extras']:
                image(entry.get('dissolve_image'))
                for record in entry.get('images',[]):image(record)
                for resource in entry.get('resources',[]):
                    selected=resource['selected']
                    if selected not in scenes:
                        scene=models.scene([selected]);scene['animation']['selected']=None;scenes[selected]=scene
                        for mesh in scene['meshes']:
                            for material in mesh['materials']:image(material.get('image'))
            clips.append(packet)
        fixture=dict(actor=actor,definition=definition,clips=clips,scenes=scenes,images=images)
        self.script_prefix='const cubeFixture='+json.dumps(fixture,ensure_ascii=True).replace('</','<\\/')+';\n'
        super().test_picker()
