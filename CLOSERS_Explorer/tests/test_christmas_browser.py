"""Replay installed Christmas assets without committing game data."""
import base64
import json
from pathlib import Path
import test_picker_browser


class ChristmasBrowserTests(test_picker_browser.PickerBrowserTests):
    checks_script='christmas_checks.js'
    characters=(('STRIKER','MEN'),('ROGUE','GIRL'))
    sequence_keys=('SI_COMMON_EMOTION_SANTA_BUNNY','SI_COMMON_EMOTION_SANTA_BUNNY_BGM')
    animation_pattern='MOTION_{character}_EMOTION_SANTA_BUNNY_{gender}.XMD'

    def test_picker(self):
        from closers.catalog import Catalog
        from closers.model_library import Models
        from closers.composition import CompositionImages
        workspace=Path(__file__).resolve().parents[2]/'results'
        if not (workspace/'catalog.sqlite3').exists():self.skipTest('Local game catalog unavailable')
        catalog=Catalog(workspace);models=Models(catalog);composition=CompositionImages(catalog)
        scenes={};images={};metadata={};own={};embedded={};cases=[]
        def source(name):
            rows=models.matches(name)
            if len(rows)!=1:self.skipTest('Unique fixture unavailable: '+name)
            return rows[0]['id']
        def image(record):
            if not record or not record.get('selected'):return
            selected=record['selected']
            if selected not in images:
                path,info=composition.prepare(selected)
                images[selected]=dict(info,body=base64.b64encode(path.read_bytes()).decode())
        for char,gender in self.characters:
            rig=source('MOTION_'+char+'.X');animation=source(self.animation_pattern.format(character=char,gender=gender))
            actor=models.scene([rig]);info=models.animations(rig,animation)
            definitions=[s for s in catalog.game_names.motion_sequences[char] if s['key'] in self.sequence_keys]
            for definition in definitions:
                clips=[]
                for step in definition['steps']:
                    index=next(c['index'] for c in info['clips'] if c['name']==step['name'])
                    packet=models.clip(rig,animation,index,info['animation_source']['sha256'])
                    packet['extras']=[e for e in packet['extras'] if not e.get('state') or e['state']==step['state']]
                    for entry in packet['extras']:
                        self.assertEqual(entry['status'],'ready',entry['label']+': '+entry.get('error',''))
                        image(entry.get('dissolve_image'))
                        for record in entry.get('images',[]):image(record)
                        for resource in entry.get('resources',[]):
                            selected=resource['selected']
                            if selected not in scenes:
                                scene=models.scene([selected]);scenes[selected]=scene
                                for mesh in scene['meshes']:
                                    for material in mesh['materials']:
                                        image(material.get('image'))
                                        for frame in material.get('texture_animation',{}).get('frames',[]):image(frame)
                            scene=scenes[selected]
                            if not entry.get('animation'):continue
                            try:
                                meta=metadata.get(selected)
                                if meta is None:
                                    meta=models.animations(selected,scene['animation']['selected'],effect=True);metadata[selected]=meta
                                clip=next(c for c in meta['clips'] if c['name']==entry['animation'])
                                key=str(selected)+':'+str(clip['index'])
                                if key not in own:own[key]=models.clip(selected,scene['animation']['selected'],clip['index'],meta['animation_source']['sha256'],effect=True)
                            except (ValueError,TypeError,StopIteration):
                                key=str(selected)+':'+entry['animation']
                                if key not in embedded:
                                    try:embedded[key]=models.effect_clip(selected,entry['animation'],scene['skeleton_source']['sha256'])
                                    except ValueError:
                                        # The source's empty BASE dummy has no animation.
                                        self.assertEqual(entry['animation'],'BASE')
                    clips.append(packet)
                cases.append(dict(character=char,actor=actor,definition=definition,clips=clips))
        data=dict(cases=cases,scenes=scenes,images=images,metadata=metadata,own=own,embedded=embedded)
        self.script_prefix='const christmasFixture='+json.dumps(data,ensure_ascii=True).replace('</','<\\/')+';\n'
        super().test_picker()
