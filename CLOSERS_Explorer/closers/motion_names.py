"""Join literal emotion skills, character states and Korean string keys exactly."""
from collections import defaultdict
import re


def dictionaries(value):
    if isinstance(value,dict):
        yield value
        for child in value.values():yield from dictionaries(child)


def state_names(value):
    if isinstance(value,str) and value.startswith('USN_EMOTION_'):yield value
    elif isinstance(value,dict):
        for child in value.values():yield from state_names(child)


def character_layers(character,tables):
    """Follow the declared base template, then apply the character overrides."""
    result=[];seen=set()
    def visit(name):
        if name in seen:raise ValueError('캐릭터 상태 테이블의 상속이 순환합니다: '+name)
        if name not in tables:return
        seen.add(name);table=tables[name]
        parent=table.get('BASE_TEMPLATE',{}).get('m_GameUnitSubType','')
        if isinstance(parent,str) and parent.startswith('GUST_USER_'):visit(parent+'.LUA')
        result.append((name,table))
    name='GUST_USER_'+character+'.LUA'
    visit(name if name in tables else 'GUST_USER_BASE_'+character+'.LUA')
    return result


def join(skills,rigs,strings):
    result=defaultdict(list)
    for character,layers in rigs.items():
        states={};origins={}
        for filename,table in layers:
            layer=defaultdict(set)
            for row in dictionaries(table):
                state,clip=row.get('m_StateName'),row.get('m_AnimName')
                if isinstance(state,str) and isinstance(clip,str) and clip:layer[state].add(clip)
            states.update(layer)
            origins.update({state:filename for state in layer})
        for skill in skills.get('SKILL_TEMPLET',{}).values():
            ident=skill.get('m_SkillID','') if isinstance(skill,dict) else ''
            if not ident.startswith('SI_COMMON_EMOTION_'):continue
            key='ST_'+ident+'_NAME'
            text,string_table=strings.get(key,('',''))
            label=re.sub(r'#C(?:[0-9a-fA-F]{6}|X)','',text).strip()
            if not label or label in ('INVAILD_STRING','BLANK'):continue
            for state in set(state_names(skill)):
                # Conflicting state definitions are not a proven clip connection.
                if len(states.get(state,()))!=1:continue
                clip=next(iter(states[state]))
                source=dict(label=label,skill_id=ident,state=state,string_key=key,
                            skill_table='SKILL_TEMPLET.LUA',state_table=origins[state],string_table=string_table)
                if source not in result[character,clip]:result[character,clip].append(source)
    return result


def decorate(clips,character,names):
    for clip in clips:
        sources=names.get((character,clip['name']),[])
        if not sources:continue
        labels=list(dict.fromkeys(s['label'] for s in sources))
        clip.update(display_name=labels[0]+(f' 외 {len(labels)-1}개' if len(labels)>1 else ''),game_names=labels,name_sources=sources)
    return clips
