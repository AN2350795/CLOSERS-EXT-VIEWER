"""Read source lighting presets without guessing which equipped set is active."""
import math
import re
import struct
from . import ntf
from .loading import MissingDefinition


def numbers(text,count):
    if not isinstance(text,str):raise ValueError('조명 벡터 형식이 올바르지 않습니다.')
    value=[float(v.strip()) for v in text.split(',')]
    if len(value)!=count or not all(math.isfinite(v) for v in value):raise ValueError('조명 벡터 수치가 올바르지 않습니다.')
    return value


def scalar(bits):
    value=struct.unpack('<f',struct.pack('<I',bits))[0]
    if not math.isfinite(value) or value<0 or value>100:raise ValueError('조명 강도가 지원 범위를 벗어났습니다.')
    return value


def read_profiles(data):
    def rows(name,expected):
        try:body=data.body(name)
        except MissingDefinition:return []
        if ntf.header(body)[0]!=expected:raise ValueError('지원하지 않는 조명 테이블입니다: '+name)
        return list(ntf.rows(body))
    light_rows=rows('LIGHT_CONVERT_DATA.NTF',(2,8,8,9,9,9))
    definitions={}
    for key,color,direction,intensity,near,extra in light_rows:
        record=dict(color=numbers(color,4),direction=numbers(direction,3),intensity=scalar(intensity),near_intensity=scalar(near),extra_value=scalar(extra))
        if sum(v*v for v in record['direction'])<1e-10:raise ValueError('조명 방향이 0입니다.')
        if key in definitions and definitions[key]!=record:raise ValueError('조명 정의가 중복됩니다.')
        definitions[key]=record
    templates=rows('LIGHT_CONVERT_TEMPLET.NTF',(8,4,4,12,8,12,2,4,8,8))
    set_definitions={}
    for key,color,direction,intensity,near in rows('SET_ITEM_UNIT_LIGHT_DATA.NTF',(5,8,8,9,9)):
        record=dict(color=numbers(color,4),direction=numbers(direction,3),intensity=scalar(intensity),near_intensity=scalar(near))
        if key in set_definitions and set_definitions[key]!=record:raise ValueError('세트 조명 정의가 중복됩니다.')
        if sum(v*v for v in record['direction'])<1e-10:raise ValueError('조명 방향이 0입니다.')
        set_definitions[key]=record
    sets=rows('SET_ITEM_EFFECT_TEMPLET.NTF',(5,5,8))
    strings=data.strings() if templates or sets else {}
    result=[];seen=set()
    for row in templates:
        category,group,order,_,characters,_,light_id,_,name,description=row
        key=f'{category}:{group}'
        if key in seen:raise ValueError('의상 조명 연결이 중복됩니다.')
        seen.add(key)
        if light_id not in definitions:continue
        result.append(dict(definitions[light_id],key=key,label=strings.get(name) or f'의상 조명 {group}',name_key=name,
                           description=strings.get(description,''),group_id=group,light_id=light_id,
                           characters=re.findall(r'GUST_USER_([A-Z]+)',characters),status='approximate',activation='manual',
                           sources=['LIGHT_CONVERT_TEMPLET.NTF','LIGHT_CONVERT_DATA.NTF']))
    for group,count,bindings in sets:
        match=re.fullmatch(r'\s*GUST_INVALID\s*,\s*(\d+)\s*,?\s*',bindings)
        if not match or int(match[1]) not in set_definitions:continue
        current=next((p for p in result if p['group_id']==group),None)
        if current is not None:
            current['legacy_set_count']=count;continue
        key=int(match[1]);name=f'ST_SKIN_NAME_{group}'
        result.append(dict(set_definitions[key],key=f'set:{group}',label=strings.get(name) or f'세트 조명 {group}',name_key=name,
                           group_id=group,light_id=key,required_count=count,characters=[],status='approximate',activation='manual',
                           sources=['SET_ITEM_EFFECT_TEMPLET.NTF','SET_ITEM_UNIT_LIGHT_DATA.NTF']))
    from .world_lighting import REGIONS,unit_light,comparison_profile
    unavailable=[]
    for name,label in REGIONS:
        try:
            profile=comparison_profile(unit_light(data.body(name)),name,label)
            if profile:result.append(profile)
        except MissingDefinition:pass
        except ValueError as exc:unavailable.append(dict(name=name,reason=str(exc)))
    from .color_grading import read_presets
    preset_error=None
    try:color_presets=read_presets(data)
    except ValueError as exc:color_presets=[];preset_error=str(exc)
    return dict(profiles=result,world_unavailable=unavailable,color_grading_presets=color_presets,color_grading_unavailable=preset_error,note='원본 조명의 수동 근사 비교입니다. 지역 선택·회전·거리 보간·착용 조건·후처리는 자동 적용하지 않습니다.')


def profiles(data):
    return data.cached(('avatar-lighting-profiles',6),lambda:read_profiles(data),persistent=True)
