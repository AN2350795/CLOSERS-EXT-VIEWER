"""Exercise real costume, character XMD, bike animation and source child effects."""
import base64
import json
from pathlib import Path

import test_picker_browser
from closers.catalog import Catalog
from closers.composition import CompositionImages
from closers.model_groups import classify
from closers.model_items import AvatarItems
from closers.model_library import Models


class ParticleDofMotionSourceBrowserTests(test_picker_browser.PickerBrowserTests):
    checks_script = 'particle_dof_motion_source_checks.js'
    animation_name='MOTION_STRIKER_CASH_ATTACK.XMD'
    clip_name='CASH_RARE_7_ASTART'

    def source_entries(self,raw):
        self.assertTrue(raw, 'Rebuild the local postprocessing index for source motion conversions')
        self.assertTrue(all(e['motion_conversion']['group'] == 210 for e in raw))
        self.assertFalse(any('RARE_8' in e['label'] for e in raw))
        selected = {e['key'] for e in raw if e.get('particle_name') == 'PE_RARE_7_BLAMB_BIKE_SKID_MARK' and e['state'] == 'USN_ASTART1'}
        self.assertEqual(len(selected), 2)
        entries=self.with_parents(raw,selected)
        self.assertEqual(len(entries), 3)
        self.assertTrue(all(e['particle']['dof_plane'] for e in entries if e['kind'] == 'particle'))
        self.assertEqual(sorted(e['at'] for e in entries if e['kind'] == 'particle'), [.6,.7])
        self.assertEqual({e['bone'] for e in entries if e['kind'] == 'particle'}, {'G_PIN_R','G_PIN_B'})
        return entries

    @staticmethod
    def with_parents(raw,selected):
        for _ in range(len(raw)):
            old=len(selected)
            selected.update(e['parent_key'] for e in raw if e['key'] in selected and e.get('parent_key'))
            if len(selected)==old:break
        return [e for e in raw if e['key'] in selected]

    def check_source_conditions(self,entries):
        self.assertTrue(all(not e['conditions'] for e in entries))

    def test_picker(self):
        workspace = Path(__file__).resolve().parents[2]/'results'
        if not (workspace/'catalog.sqlite3').exists():
            self.skipTest('Local game source unavailable')
        catalog = Catalog(workspace)
        models, composition = Models(catalog), CompositionImages(catalog)
        parts = {}
        for item in AvatarItems(catalog).definitions():
            group = classify(item['model_name'])
            if item['character'] == 'STRIKER' and item['set_name'] == 'RARE_7_A' and group['variant'] == 'BASE' and group['part'] in {'HAIR','UPBODY','LOWBODY','HAND','FOOT','WEAPON'} and not item['label'].startswith('NPC '):
                parts.setdefault(group['part'], item)
        self.assertEqual(len(parts), 6)

        def unique(name):
            matches = models.matches(name)
            self.assertEqual(len(matches), 1, name)
            return matches[0]['id']

        skeleton, animation = unique('MOTION_STRIKER.X'), unique(self.animation_name)
        ids = [unique(item['model_name']) for item in parts.values()]
        data = models.scene(ids, skeleton_id=skeleton,
                            items={str(entry): item['key'] for entry, item in zip(ids, parts.values())})
        info = models.animations(skeleton, animation)
        index = next(c['index'] for c in info['clips'] if c['name'] == self.clip_name)
        clip = models.clip(skeleton, animation, index, info['animation_source']['sha256'])
        entries = self.source_entries(clip['extras'])
        self.check_source_conditions(entries)
        clip.update(extras=entries, extras_index_available=True)
        self.assertTrue(all(e['status'] == 'ready' for e in entries))
        scenes, animations, clips, effects, images = {}, {}, {}, {}, {}

        def add_image(image):
            entry = image.get('selected') if image else None
            if not entry or entry in images:
                return
            path, metadata = composition.prepare(entry)
            images[entry] = dict(metadata, body=base64.b64encode(path.read_bytes()).decode('ascii'))

        def add_scene(scene):
            for mesh in scene['meshes']:
                for material in mesh['materials']:
                    add_image(material.get('image'))
                    for role in ('material_preview','matcap_preview','glow_preview'):
                        add_image(material.get(role, {}).get('image'))

        add_scene(data)
        for entry in entries:
            for image in entry.get('images', []):
                add_image(image)
            for resource in entry['resources']:
                source = resource['selected']
                self.assertIsNotNone(source)
                scene = models.scene([source])
                scenes[source] = scene
                add_scene(scene)
                if entry.get('animation'):
                    own = scene['animation']['selected']
                    if own is not None:
                        details = models.animations(source, own, effect=True)
                        animations[f'{source}:{own}'] = details
                        chosen = next(c for c in details['clips'] if c['name'] == entry['animation'])
                        clips[f'{source}:{own}:{chosen["index"]}'] = models.clip(source, own, chosen['index'], details['animation_source']['sha256'], effect=True)
                    else:
                        effects[f'{source}:{entry["animation"]}'] = models.effect_clip(source, entry['animation'], scene['skeleton_source']['sha256'])
        fixture = dict(data=data, clip=clip, scenes=scenes, animations=animations, clips=clips, effects=effects, images=images)
        self.script_prefix = 'const motionDofFixture='+json.dumps(fixture, ensure_ascii=True)+';\n'
        super().test_picker()
