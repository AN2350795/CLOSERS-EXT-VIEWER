"""Source-attributed props and mesh effects referenced by character motions."""
import json
import math
from collections import defaultdict,OrderedDict
from collections.abc import Mapping


class ExtraIndex(Mapping):
    """Keep the immutable index snapshot compact; decode only requested motions."""
    def __init__(self,rows):
        self.raw={(character,clip):details for character,clip,details in rows};self.cache=OrderedDict()
    def __len__(self):return len(self.raw)
    def __iter__(self):return iter(self.raw)
    def __getitem__(self,key):
        if key in self.cache:self.cache.move_to_end(key);return self.cache[key]
        value=json.loads(self.raw[key]);self.cache[key]=value
        while len(self.cache)>32:self.cache.popitem(last=False)
        return value


def values(value):
    return list(value.values()) if isinstance(value,dict) else []


def vector(value,default=0):
    result=[value.get(i,default) for i in (1,2,3)] if isinstance(value,dict) else [default]*3
    if any(type(v) not in (int,float) or not math.isfinite(v) or abs(v)>100000 for v in result):raise ValueError('위치 또는 크기 수치를 확인할 수 없습니다.')
    return result


def references(rigs):
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
                    origins={**previous.get('_event_sources',{}),**{key:filename for key in ('m_EventDamageEffect','m_EventParticle') if key in row}}
                    states[name]={**previous,**row,'source':filename,'_event_sources':origins}
        clips=defaultdict(list)
        for clip,items in props.items():
            for item in items:clips[clip].append(dict(kind='model',row=item,state=''))
        for state,row in states.items():
            clip=row.get('m_AnimName')
            if not isinstance(clip,str):continue
            for event in values(row.get('m_EventDamageEffect')):
                if isinstance(event,dict) and isinstance(event.get('m_DamageEffectName'),str):
                    clips[clip].append(dict(kind='effect',row=dict(event,source=row['_event_sources']['m_EventDamageEffect']),state=state))
            for event in values(row.get('m_EventParticle')):
                if isinstance(event,dict):clips[clip].append(dict(kind='particle',row=dict(event,source=row['_event_sources']['m_EventParticle']),state=state))
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
    rule.update(models=meshes,life=life if life>0 and lifetime=='MPLT_TIME' else 100000,
                play_count=max(1,int(row.get('m_iPlayCount',1))) if lifetime=='MPLT_PLAY_COUNT' else None,
                color=color,fades=fades,gravity=vec(row.get('m_vGravity')),billboard=row.get('m_BillBoardType','BBT_NONE'),
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
    rule.update(type=kind,models=models,frames=frames,uv_offsets=uv_offsets,life=life,max_particles=min(256,max(1,int(maximum))),
                rate=span(row.get('m_EmitRate',0)),instant=span(row.get('m_EmitRateInstant',0)),
                emitter_life=span(row.get('m_DieTime',100000)),deaths=span(row.get('m_DieCount',0)),
                radius=vec(row.get('m_EmitRadius')),radius_min=vec(row.get('m_EmitRadiusMin')),
                gravity=vec(row.get('m_vGravity')),billboard=row.get('m_BillBoardType','BBT_NONE'),
                blend=blend(row),dual=row.get('m_bDualBlending','FALSE') in (True,'TRUE'),
                depth_test=row.get('m_bZEnable','TRUE') in (True,'TRUE'),depth_write=row.get('m_bZWriteEnable','FALSE') in (True,'TRUE'),
                seed=zlib.crc32(str(row.get('m_SeqName','')).encode()),source=row.get('source',''))
    if maximum>256:rule['warnings'].append('입자는 이미터마다 최대 256개를 표시합니다.')
    return rule


def compile_extras(refs,damage,meshes,particles=None):
    from .effect_tracks import vec
    particles=particles or {}
    result={}
    for character,clips in refs.items():
        for clip,items in clips.items():
            out=[]
            def add(row,kind,state,key,parent=None):
                name=(row.get('m_ParticleName') if kind=='model' else None) or row.get('m_XFileName') or row.get('m_DamageEffectName') or row.get('m_ParticleName') or row.get('m_SeqName') or '연출'
                if row.get('m_ParticleName'):kind='particle'
                entry=dict(key=key,kind=kind,label=name,state=state,source=row.get('source',''),status='ready',error='',warnings=[])
                try:
                    entry.update(bone=row.get('m_BoneName',''),offset=vec(row.get('m_Offset')),rotation=vec(row.get('m_OffsetRotate')),
                                 at=float(row.get('m_fEventTime',0)),anim_time=row.get('m_bAnimTime','TRUE') in (True,'TRUE'),
                                 follow=kind=='model' or row.get('m_bHold','FALSE') in (True,'TRUE'),state_end=row.get('m_bStateEndDie','TRUE') in (True,'TRUE'),
                                 conditions={k:row[k] for k in ('m_SetID','m_SetCount','m_ItemID') if k in row})
                    if not math.isfinite(entry['at']) or entry['at']<0:raise ValueError('효과 생성 시간이 올바르지 않습니다.')
                    if parent:entry['parent_key']=parent
                    if kind=='model':
                        if not isinstance(row.get('m_XFileName'),str) or not row['m_XFileName'].upper().endswith('.X'):raise ValueError('보조 모델 파일 연결을 확인할 수 없습니다.')
                        entry.update(models=[row['m_XFileName']],animation=None,speed=1,loop=False,life=100000,color=[1,1,1,1],fades=[],tracks=[],blend=['SRCALPHA','INVSRCALPHA'],dual=False,depth_test=True,depth_write=True)
                    elif kind=='particle':
                        rule=particles.get(name)
                        if rule and rule.get('error'):raise ValueError(rule['error'])
                        if not rule:raise ValueError('파티클 정의가 없거나 출처가 중복됩니다.')
                        entry.update(particle_name=name,models=rule['models'],life=100000,speed=1,animation=None,loop=False,color=[1,1,1,1],fades=[])
                        entry['warnings']=rule.get('warnings',[])
                    else:
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
                    if entry['conditions']:entry['warnings'].append('장비 조건부 연출입니다. 조건부 표시 옵션으로 선택할 수 있습니다.')
                except (ValueError,KeyError,TypeError) as exc:entry.update(status='unavailable',error=str(exc))
                out.append(entry)
                if kind=='effect' and name in damage:
                    for pi,particle in enumerate(values(damage[name].get('m_EventParticle'))):
                        if not isinstance(particle,dict):continue
                        add(dict(particle,source=damage[name]['source']),'particle',state,key+f':particle:{pi}',key)
            for index,item in enumerate(items):add(item['row'],item['kind'],item['state'],f'{character}|{clip}|{index}')
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
