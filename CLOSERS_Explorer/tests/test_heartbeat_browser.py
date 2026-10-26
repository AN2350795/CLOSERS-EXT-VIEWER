"""Inspect the actual Demonic Heartbeat floor effects from both sides."""
import base64
import json
from pathlib import Path
import test_picker_browser


class HeartbeatBrowserTests(test_picker_browser.PickerBrowserTests):
    checks_script='heartbeat_checks.js'

    def test_picker(self):
        from closers.catalog import Catalog
        from closers.model_library import Models
        from closers.composition import CompositionImages
        workspace=Path(__file__).resolve().parents[2]/'results'
        if not (workspace/'catalog.sqlite3').exists():self.skipTest('Local game catalog unavailable')
        models=Models(Catalog(workspace));composition=CompositionImages(models.catalog)
        all_entries=models.extra_sources('ROGUE','EMOTION_DEMONIC_HEARTBEAT_START',set())
        entries=[e for e in all_entries
                 if 'HEARTBEAM' in e['label'] and e['state']=='USN_EMOTION_DEMONIC_HEARTBEAT_BGM_START']
        self.assertEqual(len(entries),4)
        parent_keys={e.get('parent_key') for e in entries}
        parents=[dict(e,status='unavailable',resources=[]) for e in all_entries if e['key'] in parent_keys]
        scenes={};images={}
        def image(record):
            if not record or not record.get('selected'):return
            selected=record['selected']
            if selected not in images:
                path,metadata=composition.prepare(selected)
                images[selected]=dict(metadata,body=base64.b64encode(path.read_bytes()).decode())
        for entry in entries:
            for record in entry.get('images',[]):image(record)
            for resource in entry['resources']:
                selected=resource['selected'];scene=models.scene([selected]);scenes[selected]=scene
                for mesh in scene['meshes']:
                    for material in mesh['materials']:image(material.get('image'))
        self.script_prefix='const heartbeatFixture='+json.dumps(dict(entries=parents+entries,scenes=scenes,images=images),ensure_ascii=True)+';\n'
        super().test_picker()
