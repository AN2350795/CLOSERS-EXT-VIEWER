"""Motion packs are discovered across archives without losing source/errors."""
import tempfile
import json
import re
import threading
import sqlite3
from contextlib import closing
import urllib.request
from pathlib import Path
import unittest

from closers.catalog import Catalog
from closers.model_library import Models
from closers.model_motions import category
from test_explorer import fixture
from test_model import animation,binary_model,numbers,IDENTITY


class MotionLibraryTests(unittest.TestCase):
    def test_discovery_uses_registration_without_event_inheritance(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            source=fixture(root/'one.cmf',[('MOTION_STRIKER.X',binary_model(),0),
                ('MOTION_STRIKER_COMMON_RARE_7.XMD',animation(),0)])
            catalog=Catalog(root/'work');catalog.scan([source])
            link=dict(source='TOWN_MOTION_CONVERT_DATA.NTF',type='SCT_TOWN_MOTION',group=210,
                      state='USN_IDLE',character='GUST_INVALID',ambiguous=False)
            with closing(sqlite3.connect(catalog.workspace/'game-names.sqlite3')) as db, db:
                db.executescript('''PRAGMA user_version=1;
                    CREATE TABLE metadata(key TEXT,value TEXT);
                    CREATE TABLE names(filename TEXT,label TEXT,priority INTEGER);
                    CREATE TABLE motion_catalog(character TEXT,clip TEXT,details_json TEXT);''')
                db.executemany('INSERT INTO motion_catalog VALUES(?,?,?)',[
                    ('STRIKER','MOVE',json.dumps([link])),('STRIKER','MISSING',json.dumps([link]))])
            ids={r['name']:r['id'] for r in catalog.entries({})['items']}
            library=Models(catalog).motion_library(ids['MOTION_STRIKER.X'],[])
            self.assertTrue(library['registration_index_available'])
            file=library['files'][0]
            self.assertEqual(file['category'],'avatar')
            self.assertEqual(file['clips'][0]['motion_categories'],['town'])
            self.assertEqual(file['clips'][0]['motion_registrations'],[link])
            self.assertEqual([c['name'] for c in library['missing_registrations']],['MISSING'])

    def test_http_library_uses_existing_token_and_source_ids(self):
        from closers.server import create_server
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            source=fixture(root/'one.cmf',[('MOTION_STRIKER.X',binary_model(),0),('MOTION_STRIKER_SKILL.XMD',animation(),0)])
            catalog=Catalog(root/'work');catalog.scan([source])
            ids={r['name']:r['id'] for r in catalog.entries({})['items']}
            server=create_server(catalog,0)
            thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            try:
                base=f'http://127.0.0.1:{server.server_port}'
                with urllib.request.urlopen(base+'/model') as response:
                    token=re.search(r'name="explorer-token" content="([^"]+)"',response.read().decode()).group(1)
                request=urllib.request.Request(base+'/api/model-motion-library?skeleton='+str(ids['MOTION_STRIKER.X']),headers={'X-Explorer-Token':token})
                with urllib.request.urlopen(request) as response:data=json.load(response)
                self.assertEqual(data['files'][0]['id'],ids['MOTION_STRIKER_SKILL.XMD'])
                self.assertEqual(data['files'][0]['status'],'ready')
            finally:
                server.shutdown();server.server_close();thread.join()

    def test_all_packs_duplicates_failures_and_equipped_accessory(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            source=fixture(root/'one.cmf',[
                ('MOTION_STRIKER.X',binary_model(),0),
                ('MOTION_STRIKER.XMD',animation(),0),
                ('MOTION_STRIKER_ATTACK.XMD',animation(),0),
                ('MOTION_STRIKER_SKILL_3.XMD',animation(),0),
                ('MOTION_STRIKER_EMOTION_RARE_3.XMD',animation(),0),
                ('MOTION_STRIKER_DAMAGE.XMD',animation(True),0),
                ('MOTION_STRIKER_BROKEN.XMD',b'broken',0),
                ('MOTION_CASTER.XMD',animation(),0),
                ('MOTION_STRIKEROTHER.XMD',animation(),0),
                ('123_GUST_INVALID_NA_EP_AVATAR_ACC_BODY_WING.X',binary_model(),0),
                ('123_GUST_INVALID_NA_EP_AVATAR_ACC_BODY_WING.XMD',animation(),0)])
            duplicate=fixture(root/'two.cmf',[('MOTION_STRIKER_ATTACK.XMD',animation(),0)])
            catalog=Catalog(root/'work');catalog.process([source,duplicate],root/'assets')
            ids={r['name']:r['id'] for r in catalog.entries({})['items']}
            # Saved data remains browsable with both archives offline.
            source.unlink();duplicate.unlink()
            models=Models(catalog)
            library=models.motion_library(ids['MOTION_STRIKER.X'],[ids['123_GUST_INVALID_NA_EP_AVATAR_ACC_BODY_WING.X']])
            files=library['files']
            self.assertEqual(len(files),8)
            self.assertEqual(library['character'],'STRIKER')
            attacks=[f for f in files if f['name']=='MOTION_STRIKER_ATTACK.XMD']
            self.assertEqual(len(attacks),2)
            self.assertNotEqual(attacks[0]['id'],attacks[1]['id'])
            failed=[f for f in files if f['status']=='unavailable']
            self.assertEqual(len(failed),2)
            self.assertTrue(all(f['error'] for f in failed))
            self.assertTrue(all(f['saved_exists'] for f in failed))
            self.assertTrue(next(f for f in failed if 'DAMAGE' in f['name'])['clips'])
            for f in files:
                if f['status']=='ready':
                    clip=models.clip(ids['MOTION_STRIKER.X'],f['id'],0,f['sha256'])
                    self.assertEqual(clip['clip']['name'],'MOVE')
            # A rescan/changed saved file must be reindexed, not hidden by cached metadata.
            Path(catalog.get(attacks[0]['id'])['output']).write_bytes(b'changed')
            updated=models.motion_library(ids['MOTION_STRIKER.X'],[])
            self.assertEqual(next(f for f in updated['files'] if f['id']==attacks[0]['id'])['status'],'unavailable')

    def test_filename_categories(self):
        for name,expected in [('MOTION_STRIKER','basic'),('MOTION_STRIKER_ATTACK','combat'),
                ('MOTION_STRIKER_CASH_ATTACK','combat'),('MOTION_STRIKER_SKILL_3','skill'),
                ('MOTION_STRIKER_TASKFORCE','skill'),('MOTION_STRIKER_EMOTION_RARE_3','emotion'),
                ('MOTION_STRIKER_RARE_7_EMOTION_BIKE','emotion'),('MOTION_STRIKER_COMMON_RARE_3','avatar'),
                ('MOTION_STRIKER_TOWN_RARE_3','lobby'),('MOTION_STRIKER_INTERACT_SIT_01','interaction')]:
            with self.subTest(name=name):self.assertEqual(category(name+'.XMD'),expected)

    def test_companion_rig_is_verified_and_ambiguous_rigs_are_not_guessed(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            before=IDENTITY.copy();before[12]=5
            after=IDENTITY.copy();after[12]=8
            special=binary_model().replace(numbers(before,True),numbers(after,True))
            source=fixture(root/'one.cmf',[
                ('MOTION_STRIKER.X',binary_model(),0),
                ('MOTION_STRIKER_ATTACK.XMD',animation(),0),
                ('MOTION_STRIKER_TASKFORCE.X',special,0),
                ('MOTION_STRIKER_TASKFORCE.XMD',animation(True),0)])
            catalog=Catalog(root/'work');catalog.scan([source])
            ids={r['name']:r['id'] for r in catalog.entries({})['items']}
            models=Models(catalog)
            file=next(f for f in models.motion_library(ids['MOTION_STRIKER.X'],[])['files'] if 'TASKFORCE' in f['name'])
            self.assertEqual(file['status'],'ready')
            self.assertEqual(file['skeleton_id'],ids['MOTION_STRIKER_TASKFORCE.X'])
            models.animations(file['skeleton_id'],file['id'])
            # Returning from a special rig must still offer normal attack packs.
            normal=next(f for f in models.motion_library(file['skeleton_id'],[])['files'] if 'ATTACK' in f['name'])
            self.assertEqual(normal['status'],'ready')
            self.assertEqual(normal['skeleton_id'],ids['MOTION_STRIKER.X'])
            duplicate=fixture(root/'two.cmf',[('MOTION_STRIKER_TASKFORCE.X',special,0)])
            catalog.scan([duplicate])
            file=next(f for f in models.motion_library(ids['MOTION_STRIKER.X'],[])['files'] if 'TASKFORCE' in f['name'])
            self.assertEqual(file['status'],'unavailable')
