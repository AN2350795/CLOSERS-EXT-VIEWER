"""Source-attributed props and mesh effects referenced by character motions."""
import json
import math
import re
import zlib
from collections import defaultdict,OrderedDict
from collections.abc import Mapping
from .motion_converts import CONDITION_WARNING

CUSTOM_EFFECT_FIELDS=('m_vecShowEffectCustomID','m_vecHideEffectCustomID')


def event_conditions(row):
    return {k:row[k] for k in ('m_SetID','m_SetCount','m_ItemID','m_mapEventConvertCheckData',*CUSTOM_EFFECT_FIELDS) if k in row}


def dance_playback(clip,entries):
    state={'EMOTION_DANCE':'USN_EMOTION_DANCE','EMOTION_DANCE_2':'USN_EMOTION_DANCE2'}.get(clip)
    rows=[e for e in entries if e.get('state')==state] if state else []
    speeds={e.get('state_speed') for e in rows}
    if len(speeds)!=1:return None
    speed=next(iter(speeds))
    if type(speed) not in (int,float) or not math.isfinite(speed) or speed<=0:return None
    return dict(state=state,speed=speed,sources=sorted({e.get('state_speed_source','') for e in rows}-{''}))


class ExtraIndex(Mapping):
    """Keep the immutable index snapshot compact; decode only requested motions."""
    def __init__(self,rows):
        self.raw={};self.cache=OrderedDict()
        for character,clip,details in rows:
            encoded=details.encode('utf-8')
            self.raw[character,clip]=zlib.compress(encoded,1) if len(encoded)>=2048 else details
    def __len__(self):return len(self.raw)
    def __iter__(self):return iter(self.raw)
    def __getitem__(self,key):
        if key in self.cache:self.cache.move_to_end(key);return self.cache[key]
        raw=self.raw[key];value=json.loads(zlib.decompress(raw) if isinstance(raw,bytes) else raw);self.cache[key]=value
        while len(self.cache)>32:self.cache.popitem(last=False)
        return value


def values(value):
    return list(value.values()) if isinstance(value,dict) else []


def event_inventory(value,source):
    """Inventory unhandled events without duplicating all combat logic per clip."""
    resources=set();pending=[value]
    while pending:
        current=pending.pop()
        if isinstance(current,dict):pending.extend(current.values())
        elif isinstance(current,str) and current.lower().endswith(('.x','.fbx','.skel','.atlas','.ogg','.wav','.mp3','.flac','.dds','.png','.tga')):resources.add(current)
    return dict(source=source,count=len(value) if isinstance(value,dict) else 1,resources=sorted(resources))


def vector(value,default=0):
    result=[value.get(i,default) for i in (1,2,3)] if isinstance(value,dict) else [default]*3
    if any(type(v) not in (int,float) or not math.isfinite(v) or abs(v)>100000 for v in result):raise ValueError('위치 또는 크기 수치를 확인할 수 없습니다.')
    return result


def references(rigs,sounds=None):
    sound_states,_=sounds or ({},{})
    result={}
    for character,layers in rigs.items():
        states={};props=defaultdict(list)
        for filename,table in layers:
            game=table.get('GAME_UNIT_TEMPLET',{})
            local=defaultdict(list)
            for item in values(game.get('m_vecAnimAddModelData')):
                if isinstance(item,dict) and isinstance(item.get('m_AnimName'),str):
                    target=local[item['m_AnimName']]
                    # An empty override explicitly removes an inherited prop.
                    if item.get('m_XFileName') or item.get('m_ParticleName'):target.append(dict(item,source=filename))
            props.update(local)
            for row in values(game.get('m_mapUnitStateData')):
                if isinstance(row,dict) and isinstance(row.get('m_StateName'),str):
                    name=row['m_StateName'];previous=states.get(name,{})
                    origins={**previous.get('_event_sources',{}),**{key:filename for key in row if isinstance(key,str) and key.startswith('m_Event')}}
                    speed_source=filename if 'm_fAnimSpeed' in row else previous.get('_speed_source',filename)
                    states[name]={**previous,**row,'source':filename,'_event_sources':origins,'_speed_source':speed_source}
        clips=defaultdict(list)
        for clip,items in props.items():
            for item in items:clips[clip].append(dict(kind='model',row=item,state=''))
        for state,row in states.items():
            clip=row.get('m_AnimName')
            if not isinstance(clip,str):continue
            known_events={'m_EventDamageEffect','m_EventParticle','m_EventEquipHide','m_EventSound','m_EventXMeshPlayer','m_EventColor'}
            other={key:event_inventory(value,row['_event_sources'].get(key,row['source'])) for key,value in row.items() if isinstance(key,str) and key.startswith('m_Event') and key not in known_events}
            if other:clips[clip].append(dict(kind='event_info',row=dict(source=row['source'],events=other),state=state))
            for event in [*values(row.get('m_EventSound')),*sound_states.get((character,state),[])]:
                if isinstance(event,dict):clips[clip].append(dict(kind='sound',row=dict(event,source=event.get('source',row['_event_sources'].get('m_EventSound',row['source']))),state=state))
            for event in values(row.get('m_EventXMeshPlayer')):
                if isinstance(event,dict):clips[clip].append(dict(kind='mesh',row=dict(event,source=row['_event_sources']['m_EventXMeshPlayer']),state=state))
            for event in values(row.get('m_EventColor')):
                if isinstance(event,dict):clips[clip].append(dict(kind='color',row=dict(event,source=row['_event_sources']['m_EventColor']),state=state))
            for event in values(row.get('m_EventEquipHide')):
                if isinstance(event,dict) and event.get('m_HideEquipPosition')=='EP_AVATAR_WEAPON':clips[clip].append(dict(kind='equipment',row=dict(event,source=row['_event_sources']['m_EventEquipHide']),state=state))
            for event in values(row.get('m_EventDamageEffect')):
                if isinstance(event,dict) and isinstance(event.get('m_DamageEffectName'),str):
                    clips[clip].append(dict(kind='effect',row=dict(event,source=row['_event_sources']['m_EventDamageEffect']),state=state))
            for event in values(row.get('m_EventParticle')):
                if isinstance(event,dict):clips[clip].append(dict(kind='particle',row=dict(event,source=row['_event_sources']['m_EventParticle']),state=state))
        for items in clips.values():
            for item in items:
                row=states.get(item['state'],{});speed=row.get('m_fAnimSpeed',1)
                if type(speed) in (int,float) and math.isfinite(speed) and speed>0:
                    item.update(state_speed=speed,state_speed_source=row.get('_speed_source',''))
        result[character]=dict(clips)
    return result


def mesh_rule(row):
    from .effect_tracks import tracks,blend,vec,span
    meshes=row.get('m_vecMeshName')
    meshes=[meshes] if isinstance(meshes,str) else values(meshes)
    if not meshes or any(not isinstance(n,str) or not n.upper().endswith('.X') for n in meshes):raise ValueError('효과 모델 파일 연결을 확인할 수 없습니다.')
    rule=tracks(values(row.get('m_vecEventList')),mesh=True)
    try:
        life=span(row.get('m_fLifeTime',0))
        if isinstance(life,list):life=sum(life)/2;rule['warnings'].append('효과 수명 범위는 중간값으로 미리보기합니다.')
    except ValueError:
        life=0;rule['warnings'].append('게임에서 계산하는 효과 수명은 상태 종료까지 표시합니다.')
    lifetime=row.get('m_LifeType','MPLT_TIME')
    color=next((t['value'] for t in rule['tracks'] if t['property']=='color' and t['mode']=='initial'),[1,1,1,1])
    fades=[dict(start=t['start'],end=t['end'],color=t['value']) for t in rule['tracks'] if t['property']=='color' and t['mode']=='fade']
    rule.update(models=meshes,layer=row.get('m_Layer'),life=life if life>0 and lifetime=='MPLT_TIME' else 100000,
                play_count=max(1,int(row.get('m_iPlayCount',1))) if lifetime=='MPLT_PLAY_COUNT' else None,
                color=color,fades=fades,dissolve_texture=row.get('m_DissolveTexName'),gravity=vec(row.get('m_vGravity')),billboard=row.get('m_BillBoardType','BBT_NONE'),
                blend=blend(row),dual=row.get('m_bDualBlending','FALSE') in (True,'TRUE'),additive=blend(row)[1]=='ONE',
                depth_test=row.get('m_bZEnable','TRUE') in (True,'TRUE'),depth_write=row.get('m_bZWriteEnable','TRUE') in (True,'TRUE'))
    return rule


def particle_rule(row,texanims=None):
    from .effect_tracks import tracks,blend,vec,span
    import zlib
    rule=tracks(values(row.get('m_vecEventList')))
    kind=row.get('m_ParticleType','PCT_3D_PLANE')
    model=row.get('m_MeshName')
    models=[model] if isinstance(model,str) and model.upper().endswith(('.X','.FBX')) else []
    texture=rule.get('texture') or row.get('m_TexName')
    frames=[]
    if rule.get('texanim'):
        definition=(texanims or {}).get(rule['texanim'])
        if definition:
            for frame in values(definition.get('m_vecFrame')):
                if isinstance(frame,dict) and isinstance(frame.get('m_TexName'),str):
                    duration=frame.get('m_fTime',.033333)
                    frames.append(dict(name=frame['m_TexName'],duration=duration if type(duration) in (int,float) and duration>0 else .033333))
        if not frames:rule['warnings'].append('텍스처 애니메이션 정의가 없어 기본 텍스처로 표시합니다.')
    if not frames and isinstance(texture,str):frames=[dict(name=texture,duration=1)]
    if kind=='PCT_MESH' and not models:raise ValueError('메시 파티클의 원본 연결을 확인할 수 없습니다: '+str(model or '원본 미지정'))
    if kind!='PCT_MESH' and not frames and not rule.get('spine'):raise ValueError('평면 파티클의 텍스처 연결이 없습니다.')
    uv_offsets=[]
    for entry in values(row.get('m_mapUVOffset')):
        if isinstance(entry,dict) and isinstance(entry.get('m_TexName'),str):
            uv_offsets.append(dict(name=entry['m_TexName'],offset=vec(entry.get('m_Offset'),2)))
    if not frames and uv_offsets:frames=[dict(name=uv_offsets[0]['name'],duration=1)]
    maximum=span(row.get('m_iMaxParticleNum',1));maximum=sum(maximum)/2 if isinstance(maximum,list) else maximum
    life=span(row.get('m_LifeTime',1))
    if min(life if isinstance(life,list) else [life])<=0:life=1;rule['warnings'].append('0 이하의 입자 수명을 1초로 미리보기합니다.')
    rule.update(type=kind,models=models,frames=frames,uv_offsets=uv_offsets,dissolve_texture=row.get('m_DissolveTexName'),life=life,max_particles=min(256,max(1,int(maximum))),
                trace=row.get('m_bTrace','FALSE') in (True,'TRUE'),land_connect=row.get('m_bLandConnect','FALSE') in (True,'TRUE'),cull=row.get('m_CullMode'),
                mask_texture=row.get('m_MaskTexName'),layer=row.get('m_Layer'),
                rate=span(row.get('m_EmitRate',0)),instant=span(row.get('m_EmitRateInstant',0)),
                emitter_life=span(row.get('m_DieTime',100000)),deaths=span(row.get('m_DieCount',0)),
                radius=vec(row.get('m_EmitRadius')),radius_min=vec(row.get('m_EmitRadiusMin')),
                gravity=vec(row.get('m_vGravity')),billboard=row.get('m_BillBoardType','BBT_NONE'),
                blend=blend(row),dual=row.get('m_bDualBlending','FALSE') in (True,'TRUE'),
                depth_test=row.get('m_bZEnable','TRUE') in (True,'TRUE'),depth_write=row.get('m_bZWriteEnable','FALSE') in (True,'TRUE'),
                seed=zlib.crc32(str(row.get('m_SeqName','')).encode()),source=row.get('source',''))
    # A deliberately narrow viewer comparison path. Missing UI flags use the
    # viewer's ordinary-scene default; this does not establish engine defaults.
    layer=re.fullmatch(r'ROL_EFFECT_(\d{1,2})',rule['layer'] or '')
    dof_plane=(kind=='PCT_3D_PLANE' and bool(layer) and int(layer[1])<59
        and all(row.get(field,'FALSE') in (False,'FALSE') for field in ('m_bDownUI','m_bOverUI','m_bInnerUI','m_bUISeq'))
        and rule['depth_test'] and not rule['dual']
        and not any(rule.get(key) for key in ('models','spine','trace','land_connect','mask_texture','dissolve_texture')))
    rule['dof_plane']=dof_plane and rule['blend']==['SRCALPHA','INVSRCALPHA']
    rule['dof_additive_plane']=dof_plane and rule['blend']==['SRCALPHA','ONE']
    if maximum>256:rule['warnings'].append('입자는 이미터마다 최대 256개를 표시합니다.')
    return rule


def compile_extras(refs,damage,meshes,particles=None,sounds=None):
    _,effect_sounds=sounds or ({},{})
    from .effect_tracks import vec,span
    particles=particles or {}
    result={}
    for character,clips in refs.items():
        for clip,items in clips.items():
            out=[]
            def add(row,kind,state,key,parent=None,trail=()):
                if len(out)>=4096:
                    warning='연출 연결이 4,096개를 초과해 추가 항목의 재생을 보류했습니다.'
                    if warning not in out[-1].setdefault('warnings',[]):out[-1]['warnings'].append(warning)
                    return
                if kind=='event_info':
                    out.append(dict(key=key,kind=kind,label=f"게임 전용 이벤트 {len(row['events'])}종",state=state,source=row.get('source',''),status='unavailable',error='뷰어 재생 대상 이외의 게임 이벤트입니다. 출처에서 종류와 연결 파일을 확인할 수 있습니다.',models=[],warnings=[],events=row['events']))
                    return
                if kind=='equipment':
                    try:start=float(row.get('m_fEventTimeMin',0));end=float(row.get('m_fEventTimeMax',100000))
                    except (TypeError,ValueError):return
                    if not math.isfinite(start) or not math.isfinite(end) or start<0 or end<start:return
                    out.append(dict(key=key,kind='equipment',label='무기 숨김',state=state,source=row.get('source',''),status='ready',error='',models=[],at=start,until=end,anim_time=row.get('m_bAnimTime','TRUE') in (True,'TRUE'),part='WEAPON',conditions=event_conditions(row)))
                    return
                name=(row.get('m_ParticleName') if kind=='model' else None) or row.get('m_XFileName') or row.get('m_DamageEffectName') or row.get('m_ParticleName') or row.get('m_SeqName') or '연출'
                if row.get('m_ParticleName'):kind='particle'
                entry=dict(key=key,kind=kind,label=name,state=state,source=row.get('source',''),status='ready',error='',warnings=[])
                try:
                    entry.update(bone=row.get('m_BoneName',''),offset=vec(row.get('m_Offset')),rotation=vec(row.get('m_OffsetRotate')),
                                 scale=span(row.get('m_fScale',1)),
                                 at=float(row.get('m_fEventTime',0)),anim_time=row.get('m_bAnimTime','TRUE') in (True,'TRUE'),
                                 follow=kind=='model' or row.get('m_bHold','FALSE') in (True,'TRUE'),state_end=row.get('m_bStateEndDie','TRUE') in (True,'TRUE'),
                                 conditions=event_conditions(row))
                    if not math.isfinite(entry['at']) or entry['at']<0:raise ValueError('효과 생성 시간이 올바르지 않습니다.')
                    if parent:entry['parent_key']=parent
                    if kind=='sound':
                        from .motion_sound import sound_rule
                        entry.update(sound_rule(row));names=entry['sound_names'];entry['label']=('보이스' if entry['voice'] else '효과음')+' · '+((names[0]+(f' 외 {len(names)-1}개' if len(names)>1 else '')) if names else '그룹 중지')
                        entry['state_end']=entry['stop_on_end']
                    elif kind=='color':
                        rgba=row.get('m_Color',{})
                        color=[rgba.get(i,1) for i in (1,2,3,4)]
                        if any(type(v) not in (int,float) or not math.isfinite(v) for v in color):raise ValueError('캐릭터 색상이 올바르지 않습니다.')
                        entry.update(models=[],color=color,life=max(0,float(row.get('m_fColorTime',0))),transition=max(0,float(row.get('m_fTrackTime',0))),emissive=max(0,float(row.get('m_fEmissiveIntensity',0))))
                        if any(not math.isfinite(entry[k]) for k in ('life','transition','emissive')):raise ValueError('색상 연출 시간이 올바르지 않습니다.')
                        if entry['emissive']:entry['warnings'].append('캐릭터 발광은 원본 강도에 따른 색상 근사입니다.')
                        entry['label']='캐릭터 색상·발광'
                    elif kind=='mesh':
                        if name not in meshes:raise ValueError('직접 연결한 메시 연출 정의가 없습니다.')
                        entry.update(mesh_rule(meshes[name]));entry.update(kind='effect',mesh_source=meshes[name]['source'])
                    elif kind=='model':
                        if not isinstance(row.get('m_XFileName'),str) or not row['m_XFileName'].upper().endswith('.X'):raise ValueError('보조 모델 파일 연결을 확인할 수 없습니다.')
                        entry.update(models=[row['m_XFileName']],animation=None,speed=1,loop=False,life=100000,color=[1,1,1,1],fades=[],tracks=[],blend=['SRCALPHA','INVSRCALPHA'],dual=False,depth_test=True,depth_write=True)
                    elif kind=='particle':
                        rule=particles.get(name)
                        if rule and rule.get('error'):raise ValueError(rule['error'])
                        if not rule:raise ValueError('파티클 정의가 없거나 출처가 중복됩니다.')
                        entry.update(particle_name=name,models=rule['models'],life=100000,speed=1,animation=None,loop=False,color=[1,1,1,1],fades=[])
                        entry['warnings']=list(rule.get('warnings',[]))
                    else:
                        if name in trail or len(trail)>=16:raise ValueError('효과의 중첩 연결이 순환하거나 16단계를 초과했습니다.')
                        definition=damage.get(name)
                        if not definition:raise ValueError('효과 정의가 없거나 출처가 중복됩니다.')
                        seq=definition.get('m_MainEffectName')
                        if seq in meshes:
                            entry.update(mesh_rule(meshes[seq]));entry['mesh_source']=meshes[seq]['source']
                        elif seq in particles:
                            if particles[seq].get('error'):raise ValueError(particles[seq]['error'])
                            entry.update(kind='particle',particle_name=seq,warnings=list(particles[seq].get('warnings',[])),models=particles[seq]['models'],life=100000,speed=1,animation=None,loop=False,color=[1,1,1,1],fades=[])
                        else:raise ValueError('효과의 메시 또는 파티클 정의를 찾을 수 없습니다.')
                        entry['effect_source']=definition['source']
                    if any(k not in CUSTOM_EFFECT_FIELDS for k in entry['conditions']):entry['warnings'].append(CONDITION_WARNING)
                except (ValueError,KeyError,TypeError) as exc:entry.update(status='unavailable',error=str(exc))
                out.append(entry)
                if kind=='effect' and name in damage and name not in trail and len(trail)<16:
                    if damage[name].get('_other_events'):add(dict(source=damage[name]['source'],events={k:dict(v,source=damage[name]['source']) for k,v in damage[name]['_other_events'].items()}),'event_info',state,key+':events',key)
                    for di,child in enumerate(values(damage[name].get('m_EventDamageEffect'))):
                        if isinstance(child,dict):add(dict(child,source=damage[name]['source']),'effect',state,key+f':effect:{di}',key,(*trail,name))
                    for mi,mesh in enumerate(values(damage[name].get('m_EventXMeshPlayer'))):
                        if isinstance(mesh,dict):add(dict(mesh,source=damage[name]['source']),'mesh',state,key+f':mesh:{mi}',key)
                    for si,sound in enumerate([*values(damage[name].get('m_EventSound')),*effect_sounds.get(name,[])]):
                        if isinstance(sound,dict):add(dict(sound,source=sound.get('source',damage[name]['source'])),'sound',state,key+f':sound:{si}',key)
                    for pi,particle in enumerate(values(damage[name].get('m_EventParticle'))):
                        if not isinstance(particle,dict):continue
                        add(dict(particle,source=damage[name]['source']),'particle',state,key+f':particle:{pi}',key)
            for index,item in enumerate(items):
                start=len(out);add(item['row'],item['kind'],item['state'],f'{character}|{clip}|{index}')
                for entry in out[start:]:
                    if 'state_speed' in item:entry.update(state_speed=item['state_speed'],state_speed_source=item.get('state_speed_source',''))
            for entry in out:entry['condition_schema']=2
            result[character,clip]=out
    return result


def unique_rows(tables,root,key,wanted):
    rows={};serialized={}
    for filename,table in tables.items():
        for row in values(table.get(root)):
            name=row.get(key) if isinstance(row,dict) else None
            if name not in wanted:continue
            encoded=json.dumps(row)
            if name in serialized and serialized[name]!=encoded:rows[name]=None
            elif name not in serialized:rows[name]=dict(row,source=filename);serialized[name]=encoded
    return {k:v for k,v in rows.items() if v is not None}


def effect_dependencies(refs,tables):
    """Find descendants even when a child table precedes its parent table."""
    wanted={item['row']['m_DamageEffectName'] for clips in refs.values() for items in clips.values() for item in items if item['kind']=='effect'}
    names={v['m_DamageEffectName'] for t in tables.values() for v in values(t['m_mapDamageEffectData'])}
    definitions=unique_rows(tables,'m_mapDamageEffectData','m_DamageEffectName',names)
    pending=list(wanted)
    while pending:
        for event in values(definitions.get(pending.pop(),{}).get('m_EventDamageEffect')):
            child=event.get('m_DamageEffectName') if isinstance(event,dict) else None
            if isinstance(child,str) and child not in wanted:wanted.add(child);pending.append(child)
    reached=[row for name,row in definitions.items() if name in wanted]
    meshes={row['m_MainEffectName'] for row in reached if isinstance(row.get('m_MainEffectName'),str)}
    meshes.update(item['row']['m_SeqName'] for clips in refs.values() for items in clips.values() for item in items if item['kind']=='mesh' and isinstance(item['row'].get('m_SeqName'),str))
    meshes.update(e['m_SeqName'] for row in reached for e in values(row.get('m_EventXMeshPlayer')) if isinstance(e,dict) and isinstance(e.get('m_SeqName'),str))
    return wanted,meshes
