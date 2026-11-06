"""Join declared skill states and Korean names without filename guesses."""
from collections import defaultdict
import re


def dictionaries(value):
    if isinstance(value,dict):
        yield value
        for child in value.values():yield from dictionaries(child)


def state_names(value):
    if isinstance(value,str) and value.startswith('USN_'):yield value
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


def join(skills,rigs,strings,skill_table='SKILL_TEMPLET.LUA'):
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
            if not isinstance(ident,str) or not ident.startswith('SI_'):continue
            # Character skill tables are evaluated only against that character.
            if ident.startswith('SI_') and not ident.startswith('SI_COMMON_') and not ident.startswith('SI_'+character+'_'):continue
            key='ST_'+ident+'_NAME'
            text,string_table=strings.get(key,('',''))
            label=re.sub(r'#C(?:[0-9a-fA-F]{6}|X)','',text,flags=re.I).strip()
            if not label or label in ('INVAILD_STRING','BLANK'):continue
            declared={state for field,value in skill.items()
                      if field.startswith('m_UnitStateName') or field in ('m_vecUnitStateName_ETC','m_vecSkillStateChangeFollowData')
                      for state in state_names(value)}
            for state in sorted(declared):
                # Conflicting state definitions are not a proven clip connection.
                if len(states.get(state,()))!=1:continue
                clip=next(iter(states[state]))
                source=dict(label=label,skill_id=ident,state=state,string_key=key,
                            skill_table=skill_table,state_table=origins[state],string_table=string_table,kind='skill')
                if source not in result[character,clip]:result[character,clip].append(source)
    return result


def decorate(clips,character,names):
    for clip in clips:
        # The parsed XMD cache is shared by content hash across characters.
        for field in ('display_name','game_names','name_sources','name_kind'):clip.pop(field,None)
        sources=[dict(source,label=re.sub(r'#C(?:[0-9a-fA-F]{6}|X)','',source['label'],flags=re.I).strip())
                 for source in names.get((character,clip['name']),[])]
        if not sources:continue
        skills=[s for s in sources if s.get('kind')!='skin']
        # A skill can reuse JUMP_DOWN or another skill's animation. That proves
        # usage, not that its name is the standalone clip's actual name.
        def identity_match(source):
            ident=source.get('skill_id','')
            code='SI_'+clip['name'][6:] if clip['name'].startswith('SKILL_') else clip['name']
            return bool(ident) and (code==ident or code.startswith(ident+'_'))
        def state_match(source):
            state=source.get('state','').removeprefix('USN_')
            return clip['name'].startswith('SI_') and state.startswith('SI_') and (
                clip['name']==state or clip['name'].startswith(state+'_') or state.startswith(clip['name']+'_'))
        direct=[s for s in skills if s.get('skill_id','').startswith('SI_COMMON_EMOTION_')
                or clip['name'].startswith('SKILL_') or identity_match(s) or state_match(s)]
        direct.sort(key=lambda source:not identity_match(source))
        if not direct and skills and all('kind' not in s for s in skills):direct=skills
        contexts=[s for s in sources if s.get('kind')=='skin']
        primary=direct or contexts
        labels=list(dict.fromkeys(s['label'] for s in [*primary,*sources]))
        if primary:
            display=primary[0]['label']
            if not direct:display+=' · '+clip['name']
            primary_labels=list(dict.fromkeys(s['label'] for s in primary))
            if len(primary_labels)>1:display+=f' 외 {len(primary_labels)-1}개'
        else:display=clip['name']
        clip.update(display_name=display,game_names=labels,name_sources=sources,
                    name_kind='official' if direct else 'context' if contexts else 'reference')
    return clips
