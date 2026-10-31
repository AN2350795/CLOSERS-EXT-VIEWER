"""Resolve local model dependencies without merging duplicate source records."""
import hashlib
import re
from collections import defaultdict
from pathlib import Path
import threading
from contextlib import contextmanager

from .cmf import Archive
from .library import saved_file
from .model import MAX_BYTES,parse_x,parse_xmd,bind_mapping,bind_effect_mapping,xmd_matrix
from .model_groups import ModelGroups,classify,CHARACTERS


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

    def animation_mapping(self,scene,animation,body,source,animation_source,effect=False):
        try:return bind_mapping(scene,animation)
        except ValueError:
            if not effect:raise
        if Path(source['name']).stem.upper()!=Path(animation_source['name']).stem.upper():raise ValueError('연출 모델과 동명인 XMD를 선택해 주세요.')
        references=self.parsed.get(('xmd-first-keys',animation_source['sha256']),lambda:parse_xmd(body,first_keys=True))
        return bind_effect_mapping(scene,references)

    def effect_clip(self,entry_id,name,expected):
        try:return self.effect_embedded_clip(entry_id,name,expected)
        except ValueError as embedded_error:
            with self.operation():
                body,owner,source=self.read(entry_id,'x')
                if source['sha256']!=expected:raise ValueError('연출 모델 원본이 변경되었습니다.')
                scene=self.parse(body,source,'x');stem=Path(source['name']).stem.upper()
                # A model can use another pack in its own XMD family (HYDE's
                # emotes, for example). Verify every bone with DEFAULT; never
                # switch rigs or choose a similarly named character here.
                with self.catalog.connect() as db:
                    rows=[dict(r) for r in db.execute("SELECT id,name FROM entries WHERE format='xmd' AND flag!=2")
                          if Path(r['name']).stem.upper().startswith(stem+'_')]
                if len(rows)>128:raise ValueError('연출 XMD 묶음 검색 예산을 초과했습니다.')
                matches=[]
                for row in rows:
                    try:
                        animation,_,animation_source=self.read(row['id'],'xmd')
                        metadata=self.parse(animation,animation_source,'xmd')
                        clips=[c for c in metadata['clips'] if c['name']==name]
                        if len(clips)!=1:continue
                        mapping=bind_mapping(scene,metadata)
                        selected=self.parse(animation,animation_source,'xmd',selected=clips[0]['index'])
                        for key in selected['retained'][0]['keys']:
                            for ti,tr in enumerate(key['transforms']):
                                if ti>=key['scale_count']:tr[4:7]=mapping['scales'][mapping['frames'][ti]].copy()
                                xmd_matrix(tr)
                        matches.append(dict(clip=clips[0],keys=selected['retained'][0]['keys'],mapping=mapping,
                                            skeleton_source=source,animation_source=animation_source))
                        if len(matches)>1:break
                    except (ValueError,OSError):continue
                if len(matches)==1:return matches[0]
                if matches:raise ValueError('연출 동작을 가진 XMD 출처가 중복됩니다.')
                raise embedded_error

    def effect_embedded_clip(self,entry_id,name,expected):
        from .model_x_animation import embedded_clip
        with self.operation():
            body,row,source=self.read(entry_id,'x')
            if source['sha256']!=expected:raise ValueError('연출 모델 원본이 변경되었습니다.')
            scene=self.parse(body,source,'x')
            packet=self.parsed.get(('x-animation',source['sha256'],name),lambda:embedded_clip(body,scene['frames'],name))
            packet['skeleton_source']=source
            return packet

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
        local = [v for v in values if v['archive_id']==owner.get('archive_id')]
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

    def scene(self,entry_ids,skeleton_id=None,eye_key=None,eye_face=None,eye_texture=None,items=None,condition_items=None):
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
            parts,sources,rows = [],[],[];bindings={}
            vertices = 0
            for entry_id in entry_ids:
                body,row,source = self.read(entry_id,'x')
                part = self.parse(body,source,'x')
                item=None
                if str(entry_id) in items:
                    from .model_items import AvatarItems
                    if not hasattr(self.groups,'items'):self.groups.items=AvatarItems(self.catalog)
                    item=self.groups.items.resolve(items[str(entry_id)],row['name'])
                    composition=self.groups.items.composition(item['key'],row['name'])
                    primary=min(composition,key=lambda v:(classify(v['model_name'])['variant']!='BASE',v['model_name']))
                    source.update(appearance_key=item['key'],item_id=item['item_id'],display_name=item['label'],game_names=[item['label']],game_name_count=1,item_set=item['set_name'],item_part=classify(primary['model_name'])['part'])
                    source['item_character']=item['character']
                    if item.get('attachment'):
                        binding=item['attachment']
                        if binding['status']!='ready':raise ValueError(binding['error'])
                        bindings[row['id']]=binding;source['attachment']=binding
                    changed=0
                    for mesh in part['meshes']:
                        for mat in mesh['materials']:
                            from .model_materials import plan,matcap_preview
                            report,emission=plan(mat,item)
                            mat['material_report']=report
                            inputs=AvatarItems.material_inputs(mat,item)
                            cap=matcap_preview(inputs)
                            if cap:mat['matcap_preview']=cap
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
                group=classify(row['name'])
                if group['kind']=='avatar' and group['part']!='FACE':
                    from .model_toon import toon_preview
                    for mesh in part['meshes']:
                        for mat in mesh['materials']:
                            toon=toon_preview(mat,item)
                            if toon:mat['toon_preview']=toon
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
                if group['kind']=='avatar' and group['part']=='FACE':
                    from .model_face import face_sdf_preview
                    for mesh in part['meshes']:
                        for mat in mesh['materials']:
                            preview=face_sdf_preview(mesh,mat,part['frames'])
                            if preview:mat['face_sdf_preview']=preview
                vertices += sum(len(mesh['vertices'])//3 for mesh in part['meshes'])
                if vertices > 250_000:
                    raise ValueError('선택한 모델의 정점 합계가 250,000개를 초과했습니다.')
                parts.append(part); sources.append(source); rows.append(row)
            characters={source.get('item_character') or classify(row['name'])['character'] for source,row in zip(sources,rows) if classify(row['name'])['kind']=='avatar' and (source.get('item_character') or classify(row['name'])['character'])}
            if len(characters)>1:
                raise ValueError('서로 다른 캐릭터의 아바타·얼굴은 함께 연결할 수 없습니다.')
            if skeleton_id is None and bindings and len(characters)==1:
                character=next(iter(characters));rigs=self.matches('MOTION_'+character+'.X')
                if len(rigs)==1:skeleton_id=rigs[0]['id']
                elif len(rigs)>1:raise ValueError('액세서리를 붙일 캐릭터 공용 뼈 출처가 중복됩니다. 공용 뼈를 직접 선택하세요.')
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
                binding=bindings.get(row['id']);item_frame=None
                if binding and any(not mesh['skin'] for mesh in part['meshes']):
                    from .model_attachment import transform
                    if binding['bone'] not in names:raise ValueError('액세서리를 붙일 뼈가 없습니다: '+binding['bone'])
                    if len(scene['frames'])>=1024:raise ValueError('결합한 X 프레임은 1,024개까지 지원합니다.')
                    item_frame=len(scene['frames']);name='__ITEM_ATTACHMENT_'+str(row['id'])
                    while name in frame_names:name+='_'
                    frame_names.add(name);scene['frames'].append(dict(name=name,parent=names[binding['bone']],matrix=transform(binding)))
                def attachment_frame(index):
                    if index < 0:
                        return item_frame if item_frame is not None else -1
                    frame = part['frames'][index]
                    if item_frame is not None and frame['name']==binding['bone']:return item_frame
                    if item_frame is None and frame['name'] in names:
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
                            sequence=self.catalog.game_names.texture_animations.get((name.upper(),''))
                            if sequence and not sequence.get('ambiguous'):
                                mat['texture_animation']=dict(sequence,frames=[dict(self.candidates(f['name'],row),duration=f['duration']) for f in sequence['frames']])
                            elif sequence:
                                mat['texture_animation_choices']=[dict(s,characters=s.get('characters',[c for c in CHARACTERS if c in s['name'].upper().split('_')]),frames=[dict(self.candidates(f['name'],row),duration=f['duration']) for f in s['frames']]) for s in sequence.get('choices',[])]
                            if 'eye_texture_id' in mat:mat['image']['selected']=mat['eye_texture_id']
                        if 'material_preview' in mat:
                            preview=mat['material_preview']
                            preview['image']=self.candidates(preview['texture'],row)
                        if classify(row['name'])['kind']=='avatar':
                            from .avatar_second_map import read_second_map
                            character=classify(row['name'])['character']
                            second=read_second_map(self.eyes.data,character) if character else None
                            if second:
                                mat['second_preview']=dict(second)
                                if second['status']=='approximate':mat['second_preview']['image']=self.candidates(second['texture'],row)
                            from .model_materials import glow_texture,ext_texture
                            original=mat.get('material_report',{}).get('source_texture') or mat['texture']
                            extra=ext_texture(original)
                            if extra:
                                info=self.candidates(extra,row)
                                if info['candidates']:
                                    mat['ext_preview']=dict(kind='global-specular',status='approximate',texture=extra,source_texture=original,image=info,
                                                            basis='CW.EXE:0x141712bd9/CW_CARTOONLIGHT.PS.CSO:t2',channel='r',bloom=False)
                            name=glow_texture(original)
                            if name:
                                info=self.candidates(name,row)
                                if info['candidates']:
                                    mat['glow_preview']=dict(kind='surface-glow',status='approximate',texture=name,source_texture=original,image=info,
                                                             basis='CW.EXE:0x141712c46/CW_CARTOONLIGHT.PS.CSO:t3',
                                                             light_factor='g_v4LightIntensity.x',bloom=False)
                        if mat.get('toon_preview',{}).get('status')=='approximate':
                            preview=mat['toon_preview']
                            preview['image']=self.candidates(preview['texture'],row)
                        if 'matcap_preview' in mat:
                            preview=mat['matcap_preview']
                            preview['image']=self.candidates(preview['texture'],row)
                            from .model_materials import normal_texture
                            # XET substitutes only the diffuse resource. The
                            # original r14 normal feeds 0x141747e72/0x1415fb540.
                            normal=normal_texture(mat.get('material_report',{}).get('source_texture') or mat['texture'])
                            if normal:
                                info=self.candidates(normal,row)
                                if info['candidates']:
                                    preview.update(normal_texture=normal,normal_image=info,normal_source='bump-texture',
                                                   normal_basis='CW.EXE:0x1417156a0:type4:_BUMP',
                                                   limitations=['derived_tangent_basis','runtime_light_position_not_bound' if preview.get('specular') else 'runtime_specular_not_bound'])
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
                if source.get('item_character'):source['model_group']['character']=source['item_character']
                if source.get('item_part'):source['model_group']['part']=source['item_part']
                if source.get('item_set'):
                    source['model_group'].update(set_name=source['item_set'],set_key=source['model_group']['character']+'|'+source['item_set'])
            from .avatar_light_conditions import diagnose
            scene['lighting_conditions'] = diagnose(self.eyes.data, sources,dict(eye,face_id=eye_face) if eye else None,condition_items,self.catalog)
            scene.update(sources=sources,skeleton_source=skeleton_source,animation=animation,motion=motion,
                         eye_avatar=dict(key=eye['key'],label=eye['label'],character=eye['character'],face_id=eye_face,texture_id=eye_texture,geometry=eye['geometry'],basic=eye['basic'],item_id=eye.get('item_id'),item_ids=eye.get('item_ids',[])) if eye else None,
                         equipment_visibility=dict(available=bool(self.catalog.game_names.frame_patterns or self.catalog.game_names.part_overrides),hidden=hidden,deferred=deferred))
            return scene

    def animations(self,skeleton_id,animation_id,effect=False):
        from .motion_names import decorate
        with self.operation():
            body,_,source = self.read(skeleton_id,'x')
            scene = self.parse(body,source,'x')
            body,_,animation_source = self.read(animation_id,'xmd')
            animation = self.parse(body,animation_source,'xmd')
            mapping = self.animation_mapping(scene,animation,body,source,animation_source,effect)
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

    def clip(self,skeleton_id,animation_id,index,expected,effect=False):
        from .motion_names import decorate
        with self.operation():
            body,_,source = self.read(skeleton_id,'x')
            scene = self.parse(body,source,'x')
            body,_,animation_source = self.read(animation_id,'xmd')
            if expected != animation_source['sha256']:
                raise ValueError('XMD 내용이 변경되었습니다. 동작 목록을 다시 불러오세요.')
            mapping = self.animation_mapping(scene,self.parse(body,animation_source,'xmd'),body,source,animation_source,effect)
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
            extras=self.extra_sources(classify(source['name'])['character'],animation['clips'][index]['name'],{f['name'] for f in scene['frames']})
            return dict(keys=keys,mapping=mapping,clip=animation['clips'][index],extras=extras,
                        extras_index_available=bool(self.catalog.game_names.motion_extras),
                        animation_source=animation_source,skeleton_source=source)

    def extra_sources(self,character,clip,bones):
        import copy
        result=copy.deepcopy(self.catalog.game_names.motion_extras.get((character,clip),[]))
        audio_names={Path(name.replace('\\','/')).name.upper() for item in result if item['kind']=='sound' for name in item.get('sound_names',[])}
        audio_candidates={name:[] for name in audio_names}
        if audio_names:
            with self.catalog.connect() as db:
                for row in db.execute('''SELECT e.id,e.name,e.ordinal,a.path archive,e.archive_id FROM entries e
                    JOIN archives a ON a.id=e.archive_id WHERE e.flag!=2 AND e.category='audio' AND e.name COLLATE NOCASE IN ('''+','.join('?' for _ in audio_names)+')',tuple(audio_names)):
                    audio_candidates[row['name'].upper()].append(dict(row))
        for item in result:
            if item['status']!='ready':continue
            if item['kind']=='sound':
                item['sounds']=[]
                for name in item['sound_names']:
                    filename=Path(name.replace('\\','/')).name
                    candidates=audio_candidates.get(filename.upper(),[])
                    item['sounds'].append(dict(name=name,candidates=candidates[:100],selected=candidates[0]['id'] if len(candidates)==1 else None))
                item['resources']=[]
                if any(not s['selected'] for s in item['sounds']):item.setdefault('warnings',[]).append('음원 누락 또는 출처 중복입니다. 연출 설정에서 확인하세요.')
                continue
            if item.get('dissolve_texture'):
                filename=Path(item['dissolve_texture'].replace('\\','/')).name
                item['dissolve_image']=self.candidates(filename,{})
            if item['kind']=='particle':
                particle=copy.deepcopy(self.catalog.game_names.motion_particles.get((item['particle_name'],'')))
                if not particle:item.update(status='unavailable',error='파티클 인덱스를 갱신해 주세요.');continue
                item['particle']=particle
                if particle.get('mask_texture'):
                    item['mask_texture']=particle['mask_texture']
                    item['mask_image']=self.candidates(Path(particle['mask_texture'].replace('\\','/')).name,{})
                if particle.get('dissolve_texture'):
                    item['dissolve_texture']=particle['dissolve_texture']
                    item['dissolve_image']=self.candidates(Path(particle['dissolve_texture'].replace('\\','/')).name,{})
                if particle.get('spine'):
                    name=particle['spine']['name']
                    item['spine_sources']=[self.candidates(name+'.'+ext,{}) for ext in ('SKEL','ATLAS')]
                    if any(not s['candidates'] for s in item['spine_sources']):
                        item.update(status='unavailable',error='Spine SKEL 또는 ATLAS 원본이 없습니다.');continue
                images=[]
                for frame in particle['frames']:
                    filename=Path(frame['name'].replace('\\','/')).name
                    candidates=[r for r in self.matches(filename) if self.catalog.get(r['id'])['flag']!=2]
                    images.append(dict(frame,candidates=candidates,selected=candidates[0]['id'] if len(candidates)==1 else None))
                item['images']=images
            if item.get('parent_key') and item.get('bone'):item['bone_scope']='effect'
            elif item.get('bone') and item['bone'] not in bones:
                item.update(status='unavailable',error='연출을 붙일 뼈가 현재 모델에 없습니다: '+item['bone']);continue
            resources=[]
            for name in item['models']:
                filename=Path(name.replace('\\','/')).name
                candidates=[r for r in self.matches(filename) if self.catalog.get(r['id'])['flag']!=2]
                resources.append(dict(name=name,candidates=candidates,selected=candidates[0]['id'] if len(candidates)==1 else None))
            item['resources']=resources
            if any(not r['candidates'] for r in resources):item.update(status='unavailable',error='보조 모델 원본이 없습니다.')
            elif any(not r['selected'] for r in resources):item.setdefault('warnings',[]).append('모델 출처를 선택해 주세요.')
        for item in result:
            rule=item.get('particle',{})
            if not (rule.get('trace') and rule.get('land_connect') and rule.get('type')=='PCT_MESH'):continue
            receivers=[r for r in result if r is not item and r.get('status')=='ready' and r.get('parent_key')==item.get('parent_key')
                       and r.get('state')==item.get('state') and r.get('at')==item.get('at') and r.get('offset')==item.get('offset')
                       and r.get('bone')==item.get('bone')
                       and r.get('anim_time')==item.get('anim_time') and r.get('particle',{}).get('type')=='PCT_3D_PLANE'
                       and r['particle'].get('dual') and r['particle'].get('max_particles')==1
                       and not r['particle'].get('models')
                       and len(r['particle'].get('frames',[]))==1]
            if len(receivers)==1:item['trace_receiver_key']=receivers[0]['key']
        return result

    def effect_resource(self,entry_id):
        """Only source-verified binary effect assets, never arbitrary disk paths."""
        import base64
        with self.operation():
            row=self.catalog.get(int(entry_id));fmt=row['format']
            if fmt not in ('fbx','skel'):raise ValueError('FBX 또는 SKEL 연출 원본을 선택해 주세요.')
            body,_,source=self.read(entry_id,fmt)
            if fmt=='fbx' and not body.startswith(b'Kaydara FBX Binary  \x00\x1a\x00'):raise ValueError('지원하지 않는 FBX 원본입니다.')
            return dict(source=source,body=base64.b64encode(body).decode('ascii'))

    def spine_atlas(self,entry_id):
        with self.operation():
            body,row,source=self.read(entry_id,'atlas')
            if len(body)>1024*1024:raise ValueError('Spine ATLAS는 1 MiB까지 지원합니다.')
            text=body.decode('utf-8-sig');pages=[];new_page=True
            for line in text.splitlines():
                name=line.strip()
                if not name:new_page=True;continue
                if new_page:
                    if not name.lower().endswith(('.png','.dds','.tga','.jpg','.jpeg')) or '/' in name or '\\' in name:raise ValueError('ATLAS 이미지 이름이 올바르지 않습니다.')
                    pages.append(self.candidates(name,row));new_page=False
            if not pages or len(pages)>32:raise ValueError('Spine ATLAS 이미지 수가 올바르지 않습니다.')
            return dict(source=source,text=text,images=pages)
