"""Read-only actual model sampling for an isolated CMF/server/browser fixture."""
import json
from pathlib import Path
import sqlite3

from closers.catalog import file_hash
from closers.model import parse_x,parse_xmd,bind_mapping,xmd_matrix,IDENTITY
from test_model import binary_model,animation


def model_fixtures(root):
    database=Path(__file__).resolve().parents[2]/'results/catalog.sqlite3'
    manifest=dict(operating_db_hash_before=file_hash(database),sources=[],models=[],references=[])
    entries=[('invalid-model.X',b'xof 0303txt 0032',0),('mismatch.X',binary_model(),1),('mismatch.XMD',animation(True),1)]
    entries += [('999_GUST_USER_STRIKER_CLOTH_999_A_EP_AVATAR_DEFENCE_UPBODY.X',binary_model(),1)]*2
    entries += [('998_GUST_USER_STRIKER_CLOTH_999_A_EP_AVATAR_DEFENCE_HAND_DYE.X',binary_model(),1)]
    copied=set()
    with sqlite3.connect(database.as_uri()+'?mode=ro',uri=True) as db:
        db.row_factory=sqlite3.Row;db.execute('PRAGMA query_only=ON')
        def copy_id(entry_id):
            row=db.execute('''SELECT e.id,e.name,e.output,e.ordinal,a.path archive FROM entries e
                              JOIN archives a ON a.id=e.archive_id WHERE e.id=?''',(entry_id,)).fetchone()
            if row is None:raise ValueError('실제 모델 표본을 찾을 수 없습니다.')
            path=Path(row['output']);before=path.stat();digest=file_hash(path);body=path.read_bytes()
            if file_hash(path)!=digest:raise ValueError('표본 파일 내용이 변경되었습니다.')
            if entry_id not in copied:
                copied.add(entry_id);entries.append((row['name'],body,1));manifest['sources'].append(dict(row)|dict(sha256=digest,size=before.st_size,mtime=before.st_mtime_ns))
            return row,body
        parsed={}
        devil=[db.execute('SELECT id FROM entries WHERE name=?',(n,)).fetchone()[0] for n in ('302000103_GUST_USER_DEVILISH_BASIC_EP_AVATAR_DEFENCE_FACE.X','MOTION_DEVILISH.X')]
        replacement=[r[0] for r in db.execute("SELECT id FROM entries WHERE name LIKE '%GUST_USER_STRIKER_CLOTH_165_A_EP_AVATAR%' AND format='x'")]
        faces=[r[0] for r in db.execute("SELECT id FROM entries WHERE name LIKE '%GUST_USER_%_BASIC_EP_AVATAR_DEFENCE_FACE.X' AND format='x'")]
        for entry_id in dict.fromkeys([28904,26955,197848,316,318,319,321,322,29421]+devil+replacement+faces):
            row,body=copy_id(entry_id);scene=parse_x(body)
            parsed[entry_id]=scene
            record=dict(id=entry_id,name=row['name'],frames=len(scene['frames']),meshes=len(scene['meshes']),vertices=sum(len(m['vertices'])//3 for m in scene['meshes']))
            pair=db.execute('SELECT id FROM entries WHERE name=?',(row['name'][:-2]+'.XMD',)).fetchone()
            if pair:
                _,xmd=copy_id(pair[0]);a=parse_xmd(xmd);mapping=bind_mapping(scene,a)
                record.update(clips=a['clips'],mapping={k:v for k,v in mapping.items() if k not in ('frames','scales')})
                if not row['name'].upper().startswith('MOTION_'):
                    selected=parse_xmd(xmd,0)
                    manifest['references'].append(reference(scene,selected['retained'][0]['keys'],mapping,row['name']))
            for mesh in scene['meshes']:
                for mat in mesh['materials']:
                    if mat['texture']:
                        name=Path(mat['texture'].replace('\\','/')).name
                        candidates=list(db.execute('SELECT id,output FROM entries WHERE name=? COLLATE NOCASE',(name,)))
                        chosen=next((r for r in candidates if r['output'] and Path(r['output']).is_file()),None)
                        if not chosen:
                            record.setdefault('missing_textures',[]).append(name)
                            continue
                        copy_id(chosen[0])
            manifest['models'].append(record)
        # Character costume uses the verified common motion hierarchy.
        skeleton=parsed[197848];model=parsed[318];_,xmd=copy_id(197849)
        a=parse_xmd(xmd);mapping=bind_mapping(skeleton,a);clip=parse_xmd(xmd,0)['retained'][0]['keys']
        manifest['references'].append(reference(dict(frames=skeleton['frames'],meshes=model['meshes']),clip,mapping,'CHARACTER_ASSEMBLED'))
    manifest['operating_db_hash_after_prepare']=file_hash(database)
    assert manifest['operating_db_hash_before']==manifest['operating_db_hash_after_prepare']
    (root/'real-models.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    return entries


def reference(scene,keys,mapping,name):
    def multiply(a,b):
        return [sum(a[k*4+row]*b[col*4+k] for k in range(4)) for col in range(4) for row in range(4)]
    def point(m,p):
        return [sum(m[k*4+row]*p[k] for k in range(4)) for row in range(3)]
    result=dict(name=name,snapshots=[])
    names={f['name']:i for i,f in enumerate(scene['frames'])}
    visible=next(m for m in scene['meshes'] if m['skin'] and not any(v in m['name'] for v in ['COLLISION','ATTACK_SPHERE','ATTACK_LINE','SHADOW_']))
    # Browser seek control has 1 ms resolution; choose exact representable key times.
    candidates=[k for k in keys[1:] if abs(k['time']-round(k['time'],3))<1e-5]
    second=min(candidates,key=lambda k:abs(k['time']-keys[len(keys)//2]['time'])) if candidates else keys[-1]
    for key in (keys[0],second):
        local=[f['matrix'].copy() for f in scene['frames']]
        for ti,(i,tr) in enumerate(zip(mapping['frames'],key['transforms'])):
            tr=tr.copy()
            if ti>=key['scale_count']:tr[4:7]=mapping['scales'][i]
            local[i]=xmd_matrix(tr)
        world=[]
        for i,f in enumerate(scene['frames']):
            world.append(multiply(world[f['parent']],local[i]) if f['parent']>=0 else local[i])
        vertices=[]
        for vi in (0,len(visible['vertices'])//6,len(visible['vertices'])//3-1):
            p=visible['vertices'][vi*3:vi*3+3]+[1];parts=[]
            for skin in visible['skin']:
                if vi in skin['indices']:
                    j=skin['indices'].index(vi);w=skin['weights'][j]
                    parts.append((w,point(multiply(world[names[skin['bone']]],skin['offset']),p)))
            total=sum(w for w,_ in parts)
            v=[sum(w*p[j] for w,p in parts)/total for j in range(3)];v[2]*=-1
            vertices.append(dict(index=vi,position=v))
        reflected=[]
        for m in world:
            m=m.copy()
            for i in (2,6,10,14):m[i]*=-1
            reflected.append(m)
        result['snapshots'].append(dict(time=key['time'],bones=reflected,mesh=visible['name'],vertices=vertices))
    return result


def verify_models(root):
    database=Path(__file__).resolve().parents[2]/'results/catalog.sqlite3'
    manifest=json.loads((root/'real-models.json').read_text(encoding='utf-8'))
    manifest['operating_db_hash_after']=file_hash(database)
    assert manifest['operating_db_hash_before']==manifest['operating_db_hash_after']
    for record in manifest['sources']:
        path=Path(record['output']);after=path.stat()
        assert (after.st_size,after.st_mtime_ns)==(record['size'],record['mtime'])
        assert file_hash(path)==record['sha256']
    manifest['verified_unchanged']=True
    (root/'real-models.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
