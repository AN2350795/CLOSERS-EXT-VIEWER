"""Build read-only real face fixtures for face_nose_smoke.mjs."""
import hashlib
import argparse
import json
from pathlib import Path
import sqlite3
import sys
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'CLOSERS_Explorer'))
from closers.model import parse_x,parse_xmd,bind_mapping

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', default='diagnostics/caster-225-fix')
OUT = (ROOT / parser.parse_args().output).resolve()
OUT.relative_to(ROOT / 'diagnostics')
OUT.mkdir(parents=True, exist_ok=True)
sources = {}
with sqlite3.connect((ROOT / 'results/catalog.sqlite3').as_uri() + '?mode=ro', uri=True) as db:
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA query_only=ON')

    def read(entry_id):
        row = db.execute('SELECT * FROM entries WHERE id=?', (entry_id,)).fetchone()
        path = Path(row['output'])
        sources[str(path)] = hashlib.sha256(path.read_bytes()).hexdigest()
        return row, path

    def scene(entry_id):
        row, path = read(entry_id)
        data = parse_x(path.read_bytes())
        for mesh in data['meshes']:
            mesh['helper'] = any(s in mesh['name'].upper() for s in ('COLLISION','ATTACK_SPHERE','ATTACK_LINE','SHADOW_'))
            mesh['source_id'] = entry_id
            for mat in mesh['materials']:
                if not mat['texture']:
                    continue
                name = Path(mat['texture'].replace('\\', '/')).name
                rows = db.execute('SELECT * FROM entries WHERE name=? COLLATE NOCASE', (name,)).fetchall()
                if not rows:
                    mat['test_missing_image'] = name
                    continue
                selected = next((r for r in rows if r['archive_id'] == row['archive_id']), rows[0])
                _, texture_path = read(selected['id'])
                image_path = OUT / f"{selected['id']}.png"
                if not image_path.exists():
                    Image.open(texture_path).save(image_path)
                mat['test_image'] = f'/diagnostics/{OUT.name}/{image_path.name}'
        return dict(id=entry_id, name=row['name'], data=data)

    faces = [scene(r[0]) for r in db.execute("SELECT id FROM entries WHERE format='x' AND name LIKE '%GUST_USER_%_BASIC_EP_AVATAR_DEFENCE_FACE.X'")]
    fighter = next(r for r in faces if r['id'] == 40604)
    def assemble(motion_id, parts):
        motion = scene(motion_id)
        result = dict(frames=motion['data']['frames'], meshes=[], warnings=[])
        names = {f['name']: i for i, f in enumerate(result['frames'])}
        for part in parts:
            for original in part['data']['meshes']:
                mesh = dict(original)
                old = mesh['frame']
                mesh['frame'] = names.get(part['data']['frames'][old]['name'], -1) if old >= 0 else -1
                result['meshes'].append(mesh)
        return result

    assembled = assemble(171767, [scene(i) for i in [27265,27266,27267,27269,27270]] + [fighter])
    caster = next(r for r in faces if r['id'] == 30022)
    caster_bundles = [dict(name=f'CASTER CLOTH_225_A hair {hair}',data=assemble(171757,
        [scene(i) for i in [hair,25649,25651,25652,25653,25655,25657]]+[caster])) for hair in [25646,25658]]
    motion = scene(171757)['data']
    animation_id = db.execute("SELECT id FROM entries WHERE name='MOTION_CASTER.XMD'").fetchone()[0]
    _, animation_path = read(animation_id)
    animation = parse_xmd(animation_path.read_bytes())
    mapping = bind_mapping(motion,animation)
    clip_index = next(c['index'] for c in animation['clips'] if c['name']!='_DEFAULT' and c['duration']>0)
    selected = parse_xmd(animation_path.read_bytes(),selected=clip_index)
    keys = selected['retained'][0]['keys']
    for key in keys:
        for i, transform in enumerate(key['transforms']):
            if i >= key['scale_count']:
                transform[4:7] = mapping['scales'][mapping['frames'][i]].copy()
    caster_clip = dict(keys=keys,mapping=mapping,clip=animation['clips'][clip_index])
    representatives = [scene(db.execute('SELECT id FROM entries WHERE name=?',(name,)).fetchone()[0]) for name in
        ['GUST_NPC_TOWN_WILD_HUNTER_GATEKEEPER_LIBRARIAN.X','GUST_NPC_DUNGEON_MONSTER_ARK_RAID_BOSS_BAAL.X']]
    (OUT / 'fixtures.json').write_text(json.dumps(dict(faces=faces, assembled=assembled, caster_bundles=caster_bundles,
        caster_clip=caster_clip,representatives=representatives)), encoding='utf-8')
    (OUT / 'source-hashes.json').write_text(json.dumps(sources, indent=2), encoding='utf-8')
print(f'{len(faces)} faces and FIGHTER CLOTH_228_A, read-only fixtures in {OUT}')
