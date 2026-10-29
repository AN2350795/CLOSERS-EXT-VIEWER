"""Source faces, original alpha data and a verified common-skeleton motion."""
import base64
import json
from pathlib import Path
import test_picker_browser


class FaceSdfSourceBrowserTests(test_picker_browser.PickerBrowserTests):
    checks_script='face_sdf_source_checks.js'

    def test_picker(self):
        from closers.catalog import Catalog
        from closers.model_library import Models
        from closers.composition import CompositionImages
        workspace=Path(__file__).resolve().parents[2]/'results'
        if not (workspace/'catalog.sqlite3').exists():self.skipTest('Local game catalog unavailable')
        catalog=Catalog(workspace);models=Models(catalog);images={};scenes=[];composition=CompositionImages(catalog)
        for character in ('CASTER','STRIKER','DEVILISH','GATEKEEPER'):
            with catalog.connect() as db:
                faces=[dict(v) for v in db.execute("SELECT id,name FROM entries WHERE format='x' AND name LIKE ?",('%GUST_USER_'+character+'_BASIC_EP_AVATAR_DEFENCE_FACE.X',))]
            if len(faces)!=1:self.skipTest('Unambiguous local face unavailable: '+character)
            skeleton=None;clip=None
            if character=='CASTER':
                rigs=models.matches('MOTION_CASTER.X');animations=models.matches('MOTION_CASTER.XMD')
                if len(rigs)!=1 or len(animations)!=1:self.skipTest('Local common skeleton/motion unavailable')
                skeleton=rigs[0]['id'];metadata=models.animations(skeleton,animations[0]['id'])
                selected=next((c for c in metadata['clips'] if c['name']=='ASTAND'),None) or next(c for c in metadata['clips'] if c['duration']>0 and c['name']!='_DEFAULT')
                value=models.clip(skeleton,animations[0]['id'],selected['index'],metadata['animation_source']['sha256'])
                clip={k:value[k] for k in ('keys','mapping','clip')}
            data=models.scene([faces[0]['id']],skeleton_id=skeleton)
            sdf=[m for mesh in data['meshes'] for m in mesh['materials'] if m.get('face_sdf_preview')]
            self.assertTrue(sdf);self.assertTrue(all(m['face_sdf_preview']['status']=='approximate' for m in sdf))
            for mesh in data['meshes']:
                for material in mesh['materials']:
                    info=material.get('image')
                    if not info:continue
                    self.assertIsNotNone(info['selected'],character+': '+str(info))
                    if info['selected'] in images:continue
                    path,metadata=composition.prepare(info['selected']);images[info['selected']]=dict(metadata,body=base64.b64encode(path.read_bytes()).decode())
            scenes.append(dict(character=character,data=data,clip=clip))
        self.script_prefix='const faceFixture='+json.dumps(dict(scenes=scenes,images=images),ensure_ascii=True)+';\n'
        super().test_picker()
