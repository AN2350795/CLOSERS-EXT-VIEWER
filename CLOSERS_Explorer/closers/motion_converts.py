"""Exact source motion conversions and conservative event condition resolution."""
import copy
from collections import defaultdict


SOURCES={'DUNGEON_MOTION_CONVERT_DATA.NTF':'SCT_DUNGEON_MOTION',
         'TOWN_MOTION_CONVERT_DATA.NTF':'SCT_TOWN_MOTION'}
CHECK='m_mapEventConvertCheckData'
CONDITION_WARNING='원본 장비·변형 조건을 확인할 수 없어 조건부 표시 옵션으로 미리보기합니다.'


def build(tables,layers):
    result=defaultdict(list)
    for character,chain in layers.items():
        states={}
        for _,table in chain:
            for row in table.get('GAME_UNIT_TEMPLET',{}).get('m_mapUnitStateData',{}).values():
                if isinstance(row,dict) and isinstance(row.get('m_StateName'),str):
                    state=row['m_StateName'];states[state]={**states.get(state,{}),**row}
        for source,rows in tables.items():
            if source not in SOURCES:continue
            selected={}
            for row in rows:
                group,who,state,clip=row
                if type(group) is not int or group<=0 or who not in ('GUST_INVALID','GUST_USER_'+character):continue
                if not isinstance(state,str) or not isinstance(clip,str) or not clip:continue
                selected.setdefault((group,state,who),set()).add(clip)
            for group,state in sorted({(g,s) for g,s,_ in selected}):
                who='GUST_USER_'+character if (group,state,'GUST_USER_'+character) in selected else 'GUST_INVALID'
                clips=selected[group,state,who]
                if len(clips)!=1:continue
                clip=next(iter(clips))
                base=states.get(state,{}).get('m_AnimName')
                if not isinstance(base,str) or not base or base==clip:continue
                result[character,clip].append(dict(source=source,type=SOURCES[source],group=group,
                    state=state,base_clip=base,character=who))
    return dict(result)


def matches(check,conversion):
    """Return None for conditions whose meaning is not established here."""
    if not conversion or not isinstance(check,dict) or len(check)!=1:return None
    row=next(iter(check.values()))
    if not isinstance(row,dict) or set(row)-{'m_eSkinConvertType','m_usGroupID','m_setStopGroupID'}:return None
    if row.get('m_eSkinConvertType')!=conversion['type']:return None
    group=row.get('m_usGroupID');stops=row.get('m_setStopGroupID',{})
    if group is not None and (type(group) not in (int,float) or group<=0):return None
    if not isinstance(stops,dict) or any(type(v) not in (int,float) or v<=0 for v in stops.values()):return None
    if group is None and not stops:return None
    return (group is None or group==conversion['group']) and conversion['group'] not in stops.values()


def resolve(index,conversions,character,clip):
    direct=index.get((character,clip),[])
    links=conversions.get((character,clip),[]) if not direct else []
    # A clip shared by incompatible conversion contexts cannot select a group.
    if len({(c['type'],c['group']) for c in links})>1:return []
    batches=[(direct,None)] if direct else [
        ([e for e in index.get((character,c['base_clip']),[]) if e.get('state')==c['state']],c) for c in links]
    output=[];seen=set()
    for entries,conversion in batches:
        by_key={e['key']:e for e in entries};cache={}
        def conditions(key,trail=()):
            if key in cache:return cache[key]
            if key in trail:return None
            entry=by_key[key];own=copy.deepcopy(entry.get('conditions',{}))
            if CHECK in own:
                match=matches(own[CHECK],conversion)
                if match is False:cache[key]=None;return None
                if match is True:del own[CHECK]
            parent=entry.get('parent_key')
            if parent in by_key:
                inherited=conditions(parent,(*trail,key))
                if inherited is None:cache[key]=None;return None
                if inherited:own['parent']=inherited
            cache[key]=own;return own
        for entry in entries:
            remaining=conditions(entry['key'])
            if remaining is None or entry['key'] in seen:continue
            item=copy.deepcopy(entry);item['conditions']=remaining
            if not remaining and 'warnings' in item:
                item['warnings']=[w for w in item['warnings'] if w!=CONDITION_WARNING]
            if conversion:item['motion_conversion']=dict(conversion)
            output.append(item);seen.add(entry['key'])
    return output
