"""Exercise real costume, character XMD, bike animation and source child effects."""
import base64
import copy
import json
from pathlib import Path
from unittest.mock import patch

import test_picker_browser
from closers.catalog import Catalog
from closers.composition import CompositionImages
from closers.model_groups import classify
from closers.model_items import AvatarItems
from closers.model_library import Models


class ParticleDofMotionSourceBrowserTests(test_picker_browser.PickerBrowserTests):
    checks_script = 'particle_dof_motion_source_checks.js'

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

        skeleton, animation = unique('MOTION_STRIKER.X'), unique('MOTION_STRIKER_ATTACK.XMD')
        ids = [unique(item['model_name']) for item in parts.values()]
        data = models.scene(ids, skeleton_id=skeleton,
                            items={str(entry): item['key'] for entry, item in zip(ids, parts.values())})
        info = models.animations(skeleton, animation)
        index = next(c['index'] for c in info['clips'] if c['name'] == 'ASTART')
        # Select the source bike family exactly, as individual extra selection
        # does. Avoid loading unrelated costume variants referenced by ASTART.
        with models.operation():
            raw = copy.deepcopy(catalog.game_names.motion_extras['STRIKER','ASTART'])
            selected = {e['key'] for e in raw if e.get('particle_name') == 'PE_RARE_7_BLAMB_BIKE_SKID_MARK'}
            self.assertEqual(len(selected), 2)
            for _ in range(len(raw)):
                old = len(selected)
                selected.update(e['parent_key'] for e in raw if e['key'] in selected and e.get('parent_key'))
                if len(selected) == old:
                    break
            with patch.object(catalog.game_names, 'motion_extras', {('STRIKER','ASTART'): [e for e in raw if e['key'] in selected]}):
                entries = models.extra_sources('STRIKER', 'ASTART', {f['name'] for f in data['frames']})
        with patch.object(models, 'extra_sources', return_value=[]):
            clip = models.clip(skeleton, animation, index, info['animation_source']['sha256'])
        clip.update(extras=entries, extras_index_available=True)
        self.assertEqual(len(entries), 3)
        self.assertTrue(all(e['status'] == 'ready' for e in entries))
        self.assertTrue(all(e['particle']['dof_plane'] for e in entries if e['kind'] == 'particle'))
        self.assertEqual(sorted(e['at'] for e in entries if e['kind'] == 'particle'), [.6,.7])
        self.assertEqual({e['bone'] for e in entries if e['kind'] == 'particle'}, {'G_PIN_R','G_PIN_B'})
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
