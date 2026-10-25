"""Deterministic start/loop/exit chains from declared state transitions."""
import math
import re
from .motion_names import dictionaries


def build(skills,rigs,strings):
    result={}
    for character,layers in rigs.items():
        states={};origins={};ambiguous=set()
        fields={'m_AnimName','m_PlayType','m_fAnimSpeed','m_fStartTime','m_fCancelTime','m_AnimEndChangeState','m_CancelState'}
        for filename,table in layers:
            layer={}
            for row in dictionaries(table):
                name=row.get('m_StateName')
                values={k:v for k,v in row.items() if k in fields}
                if not isinstance(name,str) or not values:continue
                previous=layer.get(name,{})
                if any(k in previous and previous[k]!=v for k,v in values.items()):ambiguous.add(name)
                layer[name]={**previous,**values}
            for name,row in layer.items():states[name]={**states.get(name,{}),**row};origins[name]=filename
        sequences=[]
        for skill in skills.get('SKILL_TEMPLET',{}).values():
            if not isinstance(skill,dict):continue
            ident=skill.get('m_SkillID','');start=skill.get('m_UnitStateName')
            if not isinstance(ident,str) or not ident.startswith('SI_COMMON_EMOTION_'):continue
            steps=[];visited=set();current=start;loop=None;end=None;valid=True
            while current and current!='USN_ASTAND':
                if current in visited or current in ambiguous or len(steps)>=16:valid=False;break
                visited.add(current);row=states.get(current,{})
                clip=row.get('m_AnimName');play=row.get('m_PlayType','')
                speed=row.get('m_fAnimSpeed',1);offset=row.get('m_fStartTime',0);cancel=row.get('m_fCancelTime',0)
                if (not isinstance(clip,str) or not clip or play not in ('XAP_ONE_WAIT','XAP_LOOP','XAP_LOOP_NO_TRANSITION') or
                    any(not isinstance(v,(int,float)) or not math.isfinite(v) for v in (speed,offset,cancel)) or speed<=0 or offset<0 or cancel<0):
                    valid=False;break
                steps.append(dict(state=current,name=clip,speed=speed,start_time=offset,cancel_time=cancel,source=origins[current]))
                if play.startswith('XAP_LOOP'):
                    if loop is not None:valid=False;break
                    loop=len(steps)-1;end=len(steps);current=row.get('m_CancelState')
                    if not isinstance(current,str) or not current.startswith('USN_EMOTION_'):valid=False;break
                else:
                    current=row.get('m_AnimEndChangeState')
                    if current is None:valid=False;break
            if not valid or loop is None or end>=len(steps) or len({s['name'] for s in steps})<2:continue
            key='ST_'+ident+'_NAME';text,table=strings.get(key,(ident,''))
            label=re.sub(r'#C(?:[0-9a-fA-F]{6}|X)','',text).strip() or ident
            sequences.append(dict(key=ident,label=label,steps=steps,loop_index=loop,end_index=end,
                                  string_key=key,string_table=table,skill_table='SKILL_TEMPLET.LUA'))
        result[character]=sequences
    return result


def resolve(definitions,files):
    """Prefer one complete source pack; never guess among split duplicate sources."""
    result=[]
    for definition in definitions:
        names={s['name'] for s in definition['steps']}
        common=[f for f in files if names.issubset({c['name'] for c in f['clips']})]
        choices=[[f]*len(definition['steps']) for f in common]
        if not choices:
            found=[[f for f in files if any(c['name']==s['name'] for c in f['clips'])] for s in definition['steps']]
            choices=[[v[0] for v in found]] if all(len(v)==1 for v in found) else []
        if not choices:
            result.append(dict(definition,key=definition['key']+'|missing',status='unavailable',error='구성 동작이 없거나 출처를 하나로 확정할 수 없습니다.'))
            continue
        for sources in choices:
            steps=[];error='';rigs={f['skeleton_id'] for f in sources}
            if len(rigs)!=1:error='구성 동작의 뼈 파일이 서로 다릅니다.'
            for step,file in zip(definition['steps'],sources):
                clips=[c for c in file['clips'] if c['name']==step['name']]
                if len(clips)!=1:error='같은 이름의 구성 동작이 중복됩니다.';continue
                clip=clips[0]
                if file['status']!='ready':error=file['error'] or '동작 연결 확인이 필요합니다.'
                if clip['duration']<=step['start_time']:error='동작 길이와 시작 시간이 맞지 않습니다.'
                steps.append(dict(step,animation_id=file['id'],clip_index=clip['index'],sha256=file.get('sha256'),duration=clip['duration'],file=file['name']))
            result.append(dict(definition,key=definition['key']+'|'+'-'.join(str(f['id']) for f in sources),steps=steps,
                               skeleton_id=sources[0]['skeleton_id'],status='unavailable' if error else 'ready',error=error))
    return result
