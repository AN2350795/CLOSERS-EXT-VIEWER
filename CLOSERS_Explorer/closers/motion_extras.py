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
                if isinstance(item,dict) and isinstance(item.get('m_AnimName'),str):local[item['m_AnimName']].append(dict(item,source=filename))
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
    """Only literal mesh playback and color tracks; no fabricated particle rendering."""
    meshes=row.get('m_vecMeshName')
    meshes=[meshes] if isinstance(meshes,str) else values(meshes)
    if not meshes or any(not isinstance(n,str) or not n.upper().endswith('.X') for n in meshes):raise ValueError('효과 모델 파일 연결을 확인할 수 없습니다.')
    if row.get('m_BillBoardType','BBT_NONE')!='BBT_NONE':raise ValueError('빌보드 효과는 아직 지원하지 않습니다.')
    if any(vector(row.get('m_vGravity'))):raise ValueError('중력이 있는 효과는 아직 지원하지 않습니다.')
    if row.get('m_bDualBlending','FALSE')=='TRUE':raise ValueError('이중 블렌딩 효과는 아직 지원하지 않습니다.')
    if row.get('m_LifeType','MPLT_TIME')!='MPLT_TIME':raise ValueError('시간 이외의 효과 수명 조건은 아직 지원하지 않습니다.')
    life=row.get('m_fLifeTime',9999)
    if type(life) not in (int,float) or not math.isfinite(life) or not 0<life<=100000:raise ValueError('효과 수명이 올바르지 않습니다.')
    animation=None;speed=1;color=[1,1,1,1];fades=[];loop=False
    for event in values(row.get('m_vecEventList')):
        if not isinstance(event,dict):raise ValueError('효과 이벤트 형식을 확인할 수 없습니다.')
        prop=event.get(3);mode=event.get(2)
        if prop=='MPET_ANIM_NAME' and mode=='MPET_INITIAL':
            animation=event.get('STR');loop=event.get('PLAY_TYPE')=='XAP_LOOP'
        elif prop=='MPET_ANIM_SPEED' and mode=='MPET_INITIAL':speed=event.get('VAL',1)
        elif prop=='MPET_COLOR' and mode in ('MPET_INITIAL','MPET_FADE'):
            rgba=event.get('RGBA',{});target=[rgba.get(i,1) for i in (1,2,3,4)]
            if any(type(v) not in (int,float) or not math.isfinite(v) or not 0<=v<=1 for v in target):raise ValueError('효과 색상 범위를 확인할 수 없습니다.')
            if mode=='MPET_INITIAL':color=target
            else:
                start,end=event.get(4,0),event.get(5,0)
                if any(type(v) not in (int,float) or not math.isfinite(v) for v in (start,end)) or not 0<=start<=end:raise ValueError('효과 색상 시간 범위를 확인할 수 없습니다.')
                fades.append(dict(start=start,end=end,color=target))
        else:raise ValueError('아직 지원하지 않는 효과 이벤트입니다: '+str(prop))
    if type(speed) not in (int,float) or not math.isfinite(speed) or speed<=0:raise ValueError('효과 재생 속도가 올바르지 않습니다.')
    blend=[row.get('m_SrcBlend','CON_D3DBLEND_SRCALPHA'),row.get('m_DestBlend','CON_D3DBLEND_INVSRCALPHA')]
    if blend not in [['CON_D3DBLEND_SRCALPHA','CON_D3DBLEND_INVSRCALPHA'],['CON_D3DBLEND_SRCALPHA','CON_D3DBLEND_ONE']]:raise ValueError('지원하지 않는 효과 블렌딩입니다.')
    fades.sort(key=lambda v:v['start'])
    if any(b['start']<a['end'] for a,b in zip(fades,fades[1:])):raise ValueError('겹치는 색상 전환 이벤트는 아직 지원하지 않습니다.')
    return dict(models=meshes,animation=animation,speed=speed,loop=loop,life=life,color=color,fades=fades,
                additive=blend[1]=='CON_D3DBLEND_ONE',depth_test=row.get('m_bZEnable','TRUE')=='TRUE',depth_write=row.get('m_bZWriteEnable','TRUE')=='TRUE')


def compile_extras(refs,damage,meshes):
    result={}
    for character,clips in refs.items():
        for clip,items in clips.items():
            out=[]
            for index,item in enumerate(items):
                row=item['row'];kind=item['kind'];name=row.get('m_XFileName') or row.get('m_DamageEffectName') or row.get('m_ParticleName') or row.get('m_SeqName') or '파티클'
                entry=dict(key=f'{character}|{clip}|{index}',kind=kind,label=name,state=item['state'],source=row['source'],status='ready',error='')
                try:
                    if kind=='particle' or row.get('m_ParticleName'):raise ValueError('파티클 효과는 아직 지원하지 않습니다.')
                    if any(k in row for k in ('m_SetID','m_SetCount','m_ItemID')):raise ValueError('장비 조건이 있는 연출입니다. 적용 조건 확인이 필요합니다.')
                    offset=vector(row.get('m_Offset'));rotation=vector(row.get('m_OffsetRotate'))
                    if any(rotation):raise ValueError('회전 오프셋이 있는 연출은 아직 지원하지 않습니다.')
                    at=row.get('m_fEventTime',0)
                    if type(at) not in (int,float) or not math.isfinite(at) or at<0:raise ValueError('효과 생성 시간이 올바르지 않습니다.')
                    entry.update(bone=row.get('m_BoneName',''),offset=offset,at=at,anim_time=row.get('m_bAnimTime','TRUE')=='TRUE',
                                 follow=kind=='model' or row.get('m_bHold','FALSE')=='TRUE',state_end=row.get('m_bStateEndDie','TRUE')=='TRUE')
                    if kind=='model':
                        if not isinstance(row.get('m_XFileName'),str) or not row['m_XFileName'].upper().endswith('.X'):raise ValueError('보조 모델 파일 연결을 확인할 수 없습니다.')
                        entry.update(models=[row['m_XFileName']],animation=None,speed=1,loop=False,life=100000,color=[1,1,1,1],fades=[],additive=False,depth_test=True,depth_write=True)
                    else:
                        definition=damage.get(name)
                        if not definition:raise ValueError('효과 정의가 없거나 출처가 중복됩니다.')
                        mesh=meshes.get(definition.get('m_MainEffectName'))
                        if not mesh:raise ValueError('메시 효과 정의가 없거나 파티클 전용 효과입니다.')
                        entry.update(mesh_rule(mesh));entry['effect_source']=definition['source'];entry['mesh_source']=mesh['source']
                        entry['notes']='파티클·게임 셰이더·사운드는 포함하지 않는 메시 효과 미리보기입니다.'
                except (ValueError,KeyError) as exc:entry.update(status='unavailable',error=str(exc))
                out.append(entry)
                if kind=='effect' and name in damage:
                    for pi,particle in enumerate(values(damage[name].get('m_EventParticle'))):
                        if not isinstance(particle,dict):continue
                        out.append(dict(key=entry['key']+f':particle:{pi}',kind='particle',label=particle.get('m_SeqName','파티클'),state=item['state'],source=damage[name]['source'],status='unavailable',error='파티클 효과는 아직 지원하지 않습니다.'))
            if len(out)>128:
                out=out[:128]+[dict(key=character+'|'+clip+'|limit',kind='effect',label='추가 연출',state='',source='',status='unavailable',error='한 동작의 연출 정보는 128개까지 표시합니다.')]
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
