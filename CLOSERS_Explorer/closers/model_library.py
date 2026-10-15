"""Resolve local model dependencies without merging duplicate source records."""
import hashlib
from pathlib import Path
import threading

from .cmf import Archive
from .library import saved_file
from .model import MAX_BYTES,parse_x,parse_xmd,bind_mapping,xmd_matrix
from .model_groups import ModelGroups,classify


class Models:
    def __init__(self,catalog):
        self.catalog = catalog
        self.gate = threading.BoundedSemaphore(1)
        self.groups = ModelGroups(catalog)

    def read(self,entry_id,fmt):
        row = self.catalog.get(int(entry_id))
        if row['format']!=fmt or row['flag']==2:
            raise ValueError(f'{fmt.upper()} 형식의 복원 가능한 항목을 선택해 주세요.')
        path = saved_file(row)
        before = path.stat() if path else None
        if (before.st_size if before else row['size'])>MAX_BYTES:
            raise ValueError('3D 입력은 파일당 32 MiB까지 지원합니다.')
        if path:
            with path.open('rb') as stream:
                data = stream.read(MAX_BYTES+1)
            after = path.stat()
            if (before.st_size,before.st_mtime_ns)!=(after.st_size,after.st_mtime_ns):
                raise ValueError('3D 파일을 읽는 동안 내용이 변경되었습니다.')
        else:
            self.catalog.verify_source(row)
            with Archive(row['archive']) as archive:
                data = bytearray()
                for block in archive.chunks(self.catalog.entry(row)):
                    data.extend(block)
                    if len(data)>MAX_BYTES:
                        raise ValueError('3D 입력은 파일당 32 MiB까지 지원합니다.')
            self.catalog.verify_source(row)
            data = bytes(data)
        if len(data)>MAX_BYTES:
            raise ValueError('3D 입력은 파일당 32 MiB까지 지원합니다.')
        source = dict(entry_id=row['id'],name=row['name'],archive=row['archive'],ordinal=row['ordinal'],
                      sha256=hashlib.sha256(data).hexdigest(),bytes=len(data),saved_exists=path is not None)
        return data,row,source

    def matches(self,name):
        # Exact filename, all source variants. No substring guess for textures.
        with self.catalog.connect() as db:
            rows = db.execute('''SELECT e.id,e.name,e.ordinal,a.path archive,e.archive_id FROM entries e
                JOIN archives a ON a.id=e.archive_id WHERE e.name=? COLLATE NOCASE LIMIT 101''',(name,)).fetchall()
        return [dict(row) for row in rows]

    def candidates(self,name,owner):
        values = self.matches(name)
        local = [v for v in values if v['archive_id']==owner['archive_id']]
        preferred = local if local else values
        return dict(name=name,candidates=values[:100],selected=preferred[0]['id'] if len(preferred)==1 else None,
                    truncated=len(values)>100)

    def scene(self,entry_ids,skeleton_id=None):
        if not 1<=len(entry_ids)<=16 or len(set(entry_ids))!=len(entry_ids):
            raise ValueError('X 모델은 서로 다른 항목 1~16개를 선택해 주세요.')
        with self.gate:
            parts,sources,rows = [],[],[]
            for entry_id in entry_ids:
                body,row,source = self.read(entry_id,'x')
                parts.append(parse_x(body)); sources.append(source); rows.append(row)
            characters={classify(row['name'])['character'] for row in rows if classify(row['name'])['kind']=='avatar'}
            if len(characters)>1:
                raise ValueError('서로 다른 캐릭터의 아바타·얼굴은 함께 연결할 수 없습니다.')
            if skeleton_id is not None:
                skeleton_row=self.catalog.get(int(skeleton_id))
                skeleton_character=classify(skeleton_row['name'])['character']
                if characters and skeleton_character and skeleton_character not in characters:
                    raise ValueError('공용 뼈 파일의 캐릭터가 아바타·얼굴과 다릅니다.')
            scene = parts[0]
            skeleton_source = sources[0]
            owner = rows[0]
            if skeleton_id is not None and skeleton_id!=entry_ids[0]:
                body,owner,skeleton_source = self.read(skeleton_id,'x')
                skeleton = parse_x(body)
                scene = dict(frames=skeleton['frames'],meshes=[],warnings=skeleton['warnings'])
            else:
                scene = dict(frames=scene['frames'],meshes=[],warnings=scene['warnings'].copy())
            names = {f['name']:i for i,f in enumerate(scene['frames'])}
            for part,row in zip(parts,rows):
                for warning in part['warnings']:
                    if warning not in scene['warnings']:scene['warnings'].append(warning)
                for mesh in part['meshes']:
                    if any(s['bone'] not in names for s in mesh['skin']):
                        raise ValueError('선택한 공용 뼈 파일과 모델 부위의 뼈 이름이 일치하지 않습니다.')
                    old = mesh['frame']
                    mesh['frame'] = names.get(part['frames'][old]['name'],-1) if old>=0 else -1
                    mesh['source_id'] = row['id']
                    for mat in mesh['materials']:
                        if mat['texture']:
                            name = Path(mat['texture'].replace('\\','/')).name
                            mat['image'] = self.candidates(name,row)
                    # Helper/collision geometry remains available as a toggle.
                    mesh['helper'] = any(s in mesh['name'].upper() for s in ('COLLISION','ATTACK_SPHERE','ATTACK_LINE','SHADOW_'))
                    scene['meshes'].append(mesh)
            if sum(len(m['vertices'])//3 for m in scene['meshes'])>250_000:
                raise ValueError('선택한 모델의 정점 합계가 250,000개를 초과했습니다.')
            animation = self.candidates(owner['name'][:-2]+'.XMD',owner)
            character=next(iter(characters),None)
            motion = self.candidates('MOTION_'+character+'.X',rows[0]) if character else None
            for source,row in zip(sources,rows):source['model_group']=dict(classify(row['name']))
            scene.update(sources=sources,skeleton_source=skeleton_source,animation=animation,motion=motion)
            return scene

    def animations(self,skeleton_id,animation_id):
        with self.gate:
            body,_,source = self.read(skeleton_id,'x')
            scene = parse_x(body)
            body,_,animation_source = self.read(animation_id,'xmd')
            animation = parse_xmd(body)
            mapping = bind_mapping(scene,animation)
            return dict(clips=animation['clips'],mapping=mapping,skeleton_source=source,animation_source=animation_source)

    def clip(self,skeleton_id,animation_id,index,expected):
        with self.gate:
            body,_,source = self.read(skeleton_id,'x')
            scene = parse_x(body)
            body,_,animation_source = self.read(animation_id,'xmd')
            if expected != animation_source['sha256']:
                raise ValueError('XMD 내용이 변경되었습니다. 동작 목록을 다시 불러오세요.')
            mapping = bind_mapping(scene,parse_xmd(body))
            animation = parse_xmd(body,selected=index)
            if not animation['retained']:
                raise ValueError('선택한 동작이 없습니다.')
            keys = animation['retained'][0]['keys']
            for key in keys:
                for ti,tr in enumerate(key['transforms']):
                    if ti>=key['scale_count']:
                        tr[4:7] = mapping['scales'][mapping['frames'][ti]].copy()
                    xmd_matrix(tr)  # Validate every retained quaternion, not just DEFAULT.
            return dict(keys=keys,mapping=mapping,clip=animation['clips'][index],
                        animation_source=animation_source,skeleton_source=source)
