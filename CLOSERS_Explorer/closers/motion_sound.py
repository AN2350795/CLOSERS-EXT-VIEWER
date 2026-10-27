"""Literal sound tables linked by exact character/state or damage-effect names."""
import math
from collections import defaultdict


def values(value):
    return list(value.values()) if isinstance(value,dict) else []


def sound_tables(tables):
    states=defaultdict(list);effects=defaultdict(list)
    for source,table in sorted(tables.items()):
        for block in values(table.get('m_mapUnitStateEventSound')):
            if not isinstance(block,dict):continue
            unit=block.get('m_GameUnitSubType','')
            if not isinstance(unit,str) or not unit.startswith('GUST_USER_'):continue
            character=unit.removeprefix('GUST_USER_')
            for state in values(block):
                if not isinstance(state,dict) or not isinstance(state.get('m_StateName'),str):continue
                for row in values(state.get('m_EventSound')):
                    if isinstance(row,dict):states[character,state['m_StateName']].append(dict(row,source=source))
        for effect in values(table.get('m_mapDamageEffectEventSound')):
            if not isinstance(effect,dict) or not isinstance(effect.get('m_DamageEffectName'),str):continue
            for row in values(effect.get('m_EventSound')):
                if isinstance(row,dict):effects[effect['m_DamageEffectName']].append(dict(row,source=source))
    # Identical repeated definitions are not extra simultaneous sounds.
    import json
    for mapping in (states,effects):
        for key,rows in mapping.items():
            unique=[];seen=set()
            for row in rows:
                signature=json.dumps({k:v for k,v in row.items() if k!='source'},sort_keys=True)
                if signature not in seen:unique.append(row);seen.add(signature)
            mapping[key]=unique
    return states,effects


def sound_rule(row):
    def number(key,default):
        v=row.get(key,default)
        if type(v) not in (int,float) or not math.isfinite(v):raise ValueError('사운드 수치가 올바르지 않습니다: '+key)
        return v
    names=row.get('m_vecSoundName',{})
    names=[names] if isinstance(names,str) else values(names)
    if any(not isinstance(n,str) or not n.lower().endswith(('.ogg','.wav','.mp3','.flac')) for n in names):raise ValueError('사운드 파일 연결을 확인할 수 없습니다.')
    flag=lambda key,default='FALSE':row.get(key,default) in (True,'TRUE')
    return dict(sound_names=names,voice=flag('m_bUseVoice') or any(n.upper().startswith('VOICE_') for n in names),
                volume=max(0,min(1,number('m_audioVolume',100)/100)),probability=max(0,min(1,number('m_PlayRate',100)/100)),
                loop=flag('m_bLoop'),stop_on_end=flag('m_bStopSound') and not flag('m_bNoStopSound'),keep_on_end=flag('m_bNoStopSound'),
                sound_group=row.get('m_usSoundGroupID'),stop_groups=values(row.get('m_setStopSoundGroupID')),
                fade_out=max(0,number('m_fFadeOutTime',0)),models=[],life=100000,speed=1,
                animation=None,color=[1,1,1,1],fades=[])
