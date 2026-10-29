"""Read regional unit-light inputs; do not infer final runtime shader values."""
import hashlib
import math
from .lua_literals import tables

REGIONS=(('WI_TOWN_SQUARE_OF_PEACE_TWILIGHT.LUA','지역 · 평화의 광장 (황혼)'),
         ('WI_TOWN_MONTMARTRE_TWILIGHT.LUA','지역 · 몽마르트르 (황혼)'))


FIELDS={
    'm_LightPos':('position',3),
    'm_LightColor':('color',4),
    'm_AmbientColor':('ambient',4),
    'm_SpecularColor':('specular_color',4),
    'm_fLightIntensity':('intensity',0),
    'm_fLightIntensityNear':('near_intensity',0),
    'm_fCartoonPow':('cartoon_power',0),
    'm_fSpecularIntensity':('specular_intensity',0),
    'm_fSpecularPow':('specular_power',0),
    'm_fRimLightWide':('rim_width',0),
    'm_fRimLightPower':('rim_power',0),
}


def unit_light(body):
    """Preserve explicit literals, absence and the region activation flag."""
    root=tables(body).get('WORLD_TEMPLET')
    light=root.get('m_LightData') if isinstance(root,dict) else None
    if not isinstance(light,dict):raise ValueError('지역의 m_LightData 정의가 없습니다.')
    source=light.get('m_LightParamUnit')
    if not isinstance(source,dict):raise ValueError('지역의 m_LightParamUnit 정의가 없습니다.')
    values={};missing=[]
    for field,(key,count) in FIELDS.items():
        if field not in source:
            missing.append(field);continue
        value=source[field]
        if count:
            if not isinstance(value,dict) or set(value)!=set(range(1,count+1)):
                raise ValueError('지역 조명 벡터 형식이 올바르지 않습니다: '+field)
            value=[value[i] for i in range(1,count+1)]
        parts=value if count else [value]
        if not all(type(v) in (int,float) and math.isfinite(v) and abs(v)<=3.402823466e38 for v in parts):
            raise ValueError('지역 조명 수치가 올바르지 않습니다: '+field)
        values[key]=value
    flag=light.get('m_bUseLightParamUnit')
    # Lua globals TRUE/FALSE remain symbolic in the non-executing parser.
    if flag is not None and type(flag)is not bool and flag not in ('TRUE','FALSE'):
        raise ValueError('지역 조명 활성 플래그가 올바르지 않습니다.')
    return dict(status='source-only',sha256=hashlib.sha256(body).hexdigest(),
                source_path='WORLD_TEMPLET.m_LightData.m_LightParamUnit',
                activation=flag,light_type=source.get('m_LightType'),values=values,missing=missing,
                runtime_unresolved=['direction_rotation','near_interpolation','light_activation'],
                note='지역 원본 입력이며 최종 셰이더 수치가 아닙니다. 누락값을 기본값으로 대체하거나 렌더링에 자동 적용하지 않습니다.')


def comparison_profile(report,name,label):
    v=report['values'];required=('position','color','intensity')
    if report['light_type']!='LT_BASIC' or any(k not in v for k in required):return None
    if sum(x*x for x in v['position'])<1e-10:return None
    if any(x<0 for x in v['color']) or v['intensity']<0:return None
    profile=dict(key='world:'+name,label=label,color=v['color'],direction=v['position'],intensity=v['intensity'],
                source_cartoon_power=v.get('cartoon_power'),status='approximate',activation='manual',characters=[],
                sources=[name],source_sha256=report['sha256'],limitations=report['runtime_unresolved'])
    if 'near_intensity' in v and v['near_intensity']>=0:
        profile['near_intensity']=v['near_intensity']
    spec_fields=('specular_color','specular_intensity','specular_power')
    if all(k in v for k in spec_fields) and all(x>=0 for x in v['specular_color']) and v['specular_intensity']>=0 and v['specular_power']>=0:
        profile['global_specular']=dict(color=v['specular_color'],intensity=v['specular_intensity'],power=v['specular_power'])
    if all(k in v and v[k]>=0 for k in ('rim_width','rim_power')):
        profile['global_rim']=dict(width=v['rim_width'],power=v['rim_power'])
    return profile if 'global_specular' in profile or 'global_rim' in profile else None
