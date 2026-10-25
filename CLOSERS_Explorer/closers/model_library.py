"""Resolve local model dependencies without merging duplicate source records."""
import hashlib
import re
from collections import defaultdict
from pathlib import Path
import threading
from contextlib import contextmanager

from .cmf import Archive
from .library import saved_file
from .model import MAX_BYTES,parse_x,parse_xmd,bind_mapping,xmd_matrix
from .model_groups import ModelGroups,classify


class Models:
    def __init__(self,catalog):
        self.catalog = catalog
        self.gate = threading.BoundedSemaphore(1)
        self.groups = ModelGroups(catalog)
        from .model_eyes import EyeAvatars
        self.eyes = EyeAvatars(catalog)
        self.local = threading.local()
        from .model_cache import ModelParseCache
        self.parsed = ModelParseCache()

    def parse(self,body,source,fmt,selected=None):
        key=(fmt,source['sha256'],selected)
        return self.parsed.get(key,lambda:parse_x(body) if fmt=='x' else parse_xmd(body,selected=selected))

    @contextmanager
    def operation(self):
        with self.gate, self.catalog.session():
            self.local.matches = {}
            try:
                yield
            finally:
                del self.local.matches

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
        self.catalog.game_names.decorate(source)
        return data,row,source

    def matches(self,name):
        # Exact filename, all source variants. No substring guess for textures.
        cache = getattr(self.local,'matches',None)
        key = name.upper()
        if cache is not None and key in cache:
            return cache[key]
        with self.catalog.connect() as db:
            rows = db.execute('''SELECT e.id,e.name,e.ordinal,a.path archive,e.archive_id FROM entries e
                JOIN archives a ON a.id=e.archive_id WHERE e.name=? COLLATE NOCASE LIMIT 101''',(name,)).fetchall()
        result = [dict(row) for row in rows]
        if cache is not None:cache[key] = result
        return result

    def candidates(self,name,owner):
        values = self.matches(name)
        local = [v for v in values if v['archive_id']==owner['archive_id']]
        preferred = local if local else values
        return dict(name=name,candidates=values[:100],selected=preferred[0]['id'] if len(preferred)==1 else None,
                    truncated=len(values)>100)

    def complete_items(self,entry_ids,items):
        """Load every registered component of an equipped item, exactly once."""
        if not items:return entry_ids,items
        from .model_items import AvatarItems
        if not hasattr(self.groups,'items'):self.groups.items=AvatarItems(self.catalog)
        entry_ids=list(entry_ids);items=dict(items)
        selected=defaultdict(list)
        for entry_id in entry_ids:
            row=self.catalog.get(entry_id)
            selected[row['name'].upper()].append(entry_id)
        for entry_id,key in list(items.items()):
            row=self.catalog.get(int(entry_id))
            for component in self.groups.items.composition(key,row['name']):
                name=component['model_name'];found=selected[name]
                if len(found)>1:raise ValueError('한 아이템의 구성 모델 출처를 하나만 선택하세요: '+name)
                if not found:
                    candidates=[v for v in self.matches(name) if self.catalog.get(v['id'])['flag']!=2]
                    if len(candidates)!=1:
                        raise ValueError(('아이템 구성 모델의 출처를 의상 묶음에서 선택하세요: ' if candidates else '아이템 구성 모델이 없습니다. 원본 폴더를 다시 분석하세요: ')+name)
                    found.append(candidates[0]['id']);entry_ids.append(found[0])
                    if len(entry_ids)>16:raise ValueError('아이템 구성 모델을 포함해 X 모델은 16개까지 선택해 주세요.')
                component_id=str(found[0])
                if component_id in items and items[component_id]!=key:raise ValueError('같은 구성 모델에 서로 다른 아이템을 적용할 수 없습니다.')
                items[component_id]=key
        return entry_ids,items

    def scene(self,entry_ids,skeleton_id=None,eye_key=None,eye_face=None,eye_texture=None,items=None):
        if not 1<=len(entry_ids)<=16 or len(set(entry_ids))!=len(entry_ids):
            raise ValueError('X 모델은 서로 다른 항목 1~16개를 선택해 주세요.')
        with self.operation():
            items=items or {}
            if not isinstance(items,dict) or len(items)>16 or any(str(i) not in {str(v) for v in entry_ids} or not isinstance(k,str) for i,k in items.items()):raise ValueError('아이템 선택 정보가 잘못되었습니다.')
            entry_ids,items=self.complete_items(entry_ids,items)
            eye=None
            if eye_key is not None:
                if eye_face not in entry_ids:raise ValueError('눈동자를 적용할 얼굴을 함께 선택하세요.')
                eye=self.eyes.resolve(eye_key,eye_face,eye_texture)
            parts,sources,rows = [],[],[]
            vertices = 0
            for entry_id in entry_ids:
                body,row,source = self.read(entry_id,'x')
                part = self.parse(body,source,'x')
                if str(entry_id) in items:
                    from .model_items import AvatarItems
                    if not hasattr(self.groups,'items'):self.groups.items=AvatarItems(self.catalog)
                    item=self.groups.items.resolve(items[str(entry_id)],row['name'])
                    composition=self.groups.items.composition(item['key'],row['name'])
                    primary=min(composition,key=lambda v:(classify(v['model_name'])['variant']!='BASE',v['model_name']))
                    source.update(appearance_key=item['key'],item_id=item['item_id'],display_name=item['label'],game_names=[item['label']],game_name_count=1,item_set=item['set_name'],item_part=classify(primary['model_name'])['part'])
                    changed=0
                    for mesh in part['meshes']:
                        for mat in mesh['materials']:
                            from .model_materials import plan
                            report,emission=plan(mat,item)
                            mat['material_report']=report
                            inputs=AvatarItems.material_inputs(mat,item)
                            multi=inputs.get('m_MultiTexName','')
                            # Keep the old preview source for inspection only.
                            if re.fullmatch(r'MAT_\d+_SKIN\.(?:PNG|TGA)',multi,re.I):
                                mat['material_preview']=dict(kind='skin-sphere',texture=multi.upper(),status='unsupported',reason='MatCap 활성 조건과 원본 normal/alpha 연결 확인 필요')
                            if emission:mat['material_preview']=emission
                            target=AvatarItems.texture_target(mat,row['name'],item)
                            if target:
                                if not self.matches(target):raise ValueError('선택한 타입의 텍스처가 없습니다: '+target)
                                mat['texture']=target;changed+=1
                    if item['textures'] and not changed:part['warnings'].append('선택한 타입의 텍스처 변경 대상이 이 메시에는 없습니다.')
                    if item['shader_changes']:
                        part['warnings'].append('보조 재질: XET 발광은 근사 미리보기이며 게임 bloom은 미지원입니다. 피부 MatCap·툰 조명·마스크·염색·반사는 원본 연결/조명 확인이 필요하여 적용하지 않습니다.')
                if eye and entry_id==eye_face:
                    source['display_name']=eye['label']
                    if not eye['basic']:
                        from .model_eyes import eye_material
                        count=0
                        texture_row=self.catalog.get_resource(eye_texture)
                        for mesh in part['meshes']:
                            for mat in mesh['materials']:
                                if eye_material(mat) or eye['geometry'] and Path(mat['texture'].replace('\\','/')).stem.upper() in eye['texture_targets']:
                                    mat['texture']=texture_row['name'];mat['eye_texture_id']=eye_texture;count+=1
                        if not count:raise ValueError('이 얼굴에서 눈동자 텍스처를 찾지 못했습니다.')
                vertices += sum(len(mesh['vertices'])//3 for mesh in part['meshes'])
                if vertices > 250_000:
                    raise ValueError('선택한 모델의 정점 합계가 250,000개를 초과했습니다.')
                parts.append(part); sources.append(source); rows.append(row)
            characters={classify(row['name'])['character'] for row in rows if classify(row['name'])['kind']=='avatar' and classify(row['name'])['character']}
            if len(characters)>1:
                raise ValueError('서로 다른 캐릭터의 아바타·얼굴은 함께 연결할 수 없습니다.')
            if eye and eye['geometry']:
                from .model_eyes import eye_material
                if not any(classify(r['name'])['part']=='FACE' for r in rows):raise ValueError('눈동자와 기본 얼굴을 함께 선택하세요.')
                for part,row in zip(parts,rows):
                    if classify(row['name'])['part']!='FACE':continue
                    for mesh in part['meshes']:
                        if 'EYEBROW' in mesh['name'].upper():continue
                        mesh['groups']=[g for g in mesh['groups'] if not eye_material(mesh['materials'][g[2]])]
            from .model_visibility import apply_visibility
            self.catalog.game_names.refresh()
            deferred=[]
            hidden=apply_visibility(parts,rows,self.catalog.game_names.model_rules,self.catalog.game_names.frame_patterns,deferred,
                                    self.catalog.game_names.part_overrides)
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
                skeleton = self.parse(body,skeleton_source,'x')
                scene = dict(frames=list(skeleton['frames']),meshes=[],warnings=skeleton['warnings'])
            else:
                scene = dict(frames=list(scene['frames']),meshes=[],warnings=scene['warnings'].copy())
            if deferred:scene['warnings'].append('염색 메시가 빠진 부위는 장비 숨김 규칙을 보류했습니다.')
            names = {f['name']:i for i,f in enumerate(scene['frames'])}
            frame_names = set(names)
            for part,row in zip(parts,rows):
                attachments = {}
                def attachment_frame(index):
                    if index < 0:
                        return -1
                    frame = part['frames'][index]
                    if frame['name'] in names:
                        return names[frame['name']]
                    if index not in attachments:
                        parent = attachment_frame(frame['parent'])
                        if len(scene['frames']) >= 1024:
                            raise ValueError('결합한 X 프레임은 1,024개까지 지원합니다.')
                        name = frame['name']
                        while name in frame_names:
                            name += '__ATTACHMENT_' + str(row['id'])
                        frame_names.add(name)
                        attachments[index] = len(scene['frames'])
                        scene['frames'].append(dict(frame, name=name, parent=parent))
                    return attachments[index]
                for warning in part['warnings']:
                    if warning not in scene['warnings']:scene['warnings'].append(warning)
                for mesh in part['meshes']:
                    if any(s['bone'] not in names for s in mesh['skin']):
                        raise ValueError('선택한 공용 뼈 파일과 모델 부위의 뼈 이름이 일치하지 않습니다.')
                    old = mesh['frame']
                    # Rigid attachments need their local hierarchy even when
                    # those frames are absent from the shared skeleton.
                    if mesh['skin']:
                        mesh['frame'] = names.get(part['frames'][old]['name'],-1) if old>=0 else -1
                    else:
                        mesh['frame'] = attachment_frame(old)
                    mesh['source_id'] = row['id']
                    for mat in mesh['materials']:
                        if mat['texture']:
                            name = Path(mat['texture'].replace('\\','/')).name
                            mat['image'] = self.candidates(name,row)
                            if 'eye_texture_id' in mat:mat['image']['selected']=mat['eye_texture_id']
                        if 'material_preview' in mat:
                            preview=mat['material_preview']
                            preview['image']=self.candidates(preview['texture'],row)
                        for auxiliary in mat.get('material_report',{}).get('textures',[]):
                            auxiliary['image']=self.candidates(auxiliary['texture'],row)
                    # Helper/collision geometry remains available as a toggle.
                    mesh['helper'] = any(s in mesh['name'].upper() for s in ('COLLISION','ATTACK_SPHERE','ATTACK_LINE','SHADOW_'))
                    scene['meshes'].append(mesh)
            animation = self.candidates(owner['name'][:-2]+'.XMD',owner)
            character=next(iter(characters),None)
            motion = self.candidates('MOTION_'+character+'.X',rows[0]) if character else None
            for source,row in zip(sources,rows):
                source['model_group']=dict(classify(row['name']))
                if source.get('item_part'):source['model_group']['part']=source['item_part']
                if source.get('item_set'):
                    source['model_group'].update(set_name=source['item_set'],set_key=source['model_group']['character']+'|'+source['item_set'])
            scene.update(sources=sources,skeleton_source=skeleton_source,animation=animation,motion=motion,
                         eye_avatar=dict(key=eye['key'],label=eye['label'],character=eye['character'],face_id=eye_face,texture_id=eye_texture,geometry=eye['geometry']) if eye else None,
                         equipment_visibility=dict(available=bool(self.catalog.game_names.frame_patterns or self.catalog.game_names.part_overrides),hidden=hidden,deferred=deferred))
            return scene

    def animations(self,skeleton_id,animation_id):
        from .motion_names import decorate
        with self.operation():
            body,_,source = self.read(skeleton_id,'x')
            scene = self.parse(body,source,'x')
            body,_,animation_source = self.read(animation_id,'xmd')
            animation = self.parse(body,animation_source,'xmd')
            mapping = bind_mapping(scene,animation)
            clips=decorate(animation['clips'],classify(source['name'])['character'],self.catalog.game_names.motion_names)
            return dict(clips=clips,mapping=mapping,skeleton_source=source,animation_source=animation_source)

    def motion_library(self,skeleton_id,entry_ids):
        """Index every related pack, including failures and duplicate sources."""
        from .model_motions import CATEGORIES,category,related
        from .motion_names import decorate
        if len(entry_ids)>16:raise ValueError('모델은 16개까지 선택해 주세요.')
        with self.operation():
            body,owner,source=self.read(skeleton_id,'x')
            skeleton=self.parse(body,source,'x')
            rows=[owner]+[self.catalog.get(i) for i in entry_ids]
            characters={classify(r['name'])['character'] for r in rows
                        if classify(r['name'])['kind'] in ('avatar','motion') and classify(r['name'])['character']}
            if len(characters)>1:raise ValueError('동작을 탐색할 캐릭터가 서로 다릅니다.')
            character=next(iter(characters),'')
            stems={Path(r['name']).stem.upper() for r in rows}
            with self.catalog.connect() as db:
                candidates=[dict(r) for r in db.execute('''SELECT e.id,e.name,e.ordinal,e.flag,a.path archive
                    FROM entries e JOIN archives a ON a.id=e.archive_id
                    WHERE e.format='xmd' ORDER BY e.name COLLATE NOCASE,a.path,e.ordinal''')
                    if related(r['name'],character,stems)]
            files=[]
            for row in candidates:
                item=dict(row,category=category(row['name']),clips=[],status='unavailable',error='',skeleton_id=skeleton_id)
                try:
                    data,_,animation_source=self.read(row['id'],'xmd')
                    animation=self.parse(data,animation_source,'xmd')
                    item['clips']=decorate(animation['clips'],character,self.catalog.game_names.motion_names)
                    item['sha256']=animation_source['sha256']
                    try:
                        bind_mapping(skeleton,animation)
                    except ValueError as original:
                        # Bikes, transformations and taskforce packs may carry extra bones.
                        # Only an independently verified companion X may replace the rig.
                        verified=[]
                        names=[Path(row['name']).stem+'.X']
                        if character:names.append('MOTION_'+character+'.X')
                        for name in dict.fromkeys(names):
                            for candidate in self.matches(name):
                                try:
                                    rig,_,rig_source=self.read(candidate['id'],'x')
                                    bind_mapping(self.parse(rig,rig_source,'x'),animation)
                                    verified.append(rig_source)
                                except (ValueError,OSError):pass
                            if verified:break
                        if len(verified)!=1:raise original
                        item.update(skeleton_id=verified[0]['entry_id'],skeleton_name=verified[0]['name'])
                    item['status']='ready'
                except (ValueError,OSError) as exc:
                    item['error']=str(exc)
                files.append(item)
            from .motion_sequences import resolve
            sequences=resolve(self.catalog.game_names.motion_sequences.get(character,[]),files)
            return dict(character=character,skeleton_source=source,categories=CATEGORIES,files=files,sequences=sequences,
                        sequence_index_available=self.catalog.game_names.sequence_index_available,
                        evidence='종류는 파일명 기준입니다. 인게임 명칭은 게임 테이블에서 연결된 경우 표시하며, 착용·해금 조건은 확정하지 않습니다.')

    def clip(self,skeleton_id,animation_id,index,expected):
        from .motion_names import decorate
        with self.operation():
            body,_,source = self.read(skeleton_id,'x')
            scene = self.parse(body,source,'x')
            body,_,animation_source = self.read(animation_id,'xmd')
            if expected != animation_source['sha256']:
                raise ValueError('XMD 내용이 변경되었습니다. 동작 목록을 다시 불러오세요.')
            mapping = bind_mapping(scene,self.parse(body,animation_source,'xmd'))
            animation = self.parse(body,animation_source,'xmd',selected=index)
            if not animation['retained']:
                raise ValueError('선택한 동작이 없습니다.')
            keys = animation['retained'][0]['keys']
            for key in keys:
                for ti,tr in enumerate(key['transforms']):
                    if ti>=key['scale_count']:
                        tr[4:7] = mapping['scales'][mapping['frames'][ti]].copy()
                    xmd_matrix(tr)  # Validate every retained quaternion, not just DEFAULT.
            decorate(animation['clips'],classify(source['name'])['character'],self.catalog.game_names.motion_names)
            return dict(keys=keys,mapping=mapping,clip=animation['clips'][index],
                        animation_source=animation_source,skeleton_source=source)
