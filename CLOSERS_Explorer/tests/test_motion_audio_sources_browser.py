"""Decode source-verified installed music, effects and character voice files."""
import base64
import json
from pathlib import Path
import sqlite3
import test_picker_browser


class MotionAudioSourcesBrowserTests(test_picker_browser.PickerBrowserTests):
    checks_script='motion_audio_sources_checks.js'

    def test_picker(self):
        from closers.catalog import Catalog
        from closers.server import Media
        workspace=Path(__file__).resolve().parents[2]/'results'
        if not (workspace/'game-names.sqlite3').exists():self.skipTest('Local game index unavailable')
        catalog=Catalog(workspace);names=[]
        with sqlite3.connect((workspace/'game-names.sqlite3').as_uri()+'?mode=ro',uri=True) as db:
            for clip in ('EMOTION_AURA_PIXIES_LOOP','CASH_RARE_7_EMOTION_LOOP'):
                row=db.execute('SELECT details_json FROM motion_extras WHERE character=? AND clip=?',('ROGUE',clip)).fetchone()
                if row:
                    for event in json.loads(row[0]):
                        if event['kind']=='sound':names.extend(event['sound_names'])
            for row in db.execute("SELECT details_json FROM motion_extras WHERE character='ROGUE'"):
                voices=[n for e in json.loads(row[0]) if e['kind']=='sound' for n in e['sound_names'] if n.upper().startswith('VOICE_')]
                if voices:names.append(voices[0]);break
        names=list(dict.fromkeys(names))[:8]
        if not names:self.skipTest('Sound index must be rebuilt')
        media=Media(catalog);files=[]
        for name in names:
            with catalog.connect() as db:
                rows=db.execute("SELECT id FROM entries WHERE category='audio' AND flag!=2 AND name=? COLLATE NOCASE",(name,)).fetchall()
            self.assertEqual(len(rows),1,name)
            entry_id=rows[0]['id'];stream,length,mime=media.file(catalog.get_resource(entry_id))
            with stream:body=stream.read()
            files.append(dict(id=entry_id,name=name,body=base64.b64encode(body).decode('ascii')))
        self.assertTrue(any(f['name'].upper().startswith('VOICE_') for f in files))
        self.script_prefix='const sourceAudioFiles='+json.dumps(files)+';\n'
        super().test_picker()
