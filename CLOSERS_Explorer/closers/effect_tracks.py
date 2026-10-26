"""Preserve literal animation/particle ranges and timed property tracks."""
import math


def span(value,default=0):
    if type(value) in (int,float) and math.isfinite(value) and abs(value)<=1e9:return value
    if isinstance(value,dict) and 1 in value and set(value)<= {1,2,3}:
        a=span(value[1],default);b=span(value.get(2,value[1]),default)
        if type(a) in (int,float) and type(b) in (int,float):return [min(a,b),max(a,b)]
    raise ValueError('수치 범위 또는 표현식을 해석할 수 없습니다.')


def vec(value,n=3,default=0):
    if isinstance(value,dict):return [span(value.get(i,default),default) for i in range(1,n+1)]
    return [span(value if value is not None else default,default)]*n


PROPS={'COLOR':('color','RGBA',4,1),'COLOR_DUAL_BLENDING':('dualColor','RGBA',4,1),
       'SIZE':('size','XYZ',3,1),'SCALE':('scale','VAL',1,1),'ROTATE':('rotation','XYZ',3,0),
       'ROTATE_SPEED':('rotationSpeed','XYZ',3,0),'VELOCITY':('velocity','XYZ',3,0),
       'POSITION':('position','XYZ',3,0),'TEX0UV':('uv','XY',2,0),
       'DIR_SPEED':('directionSpeed','VAL',1,0),'VELOCITY_DRAG':('drag','XYZ',3,0),
       'BLINK_COLOR':('blinkColor','RGBA',4,0),'RESET_BLINK_COLOR':('blinkPeriod','VAL',1,0),
       'CRASH':('crash','XYZ',3,0),'RESET_CRASH':('crashPeriod','VAL',1,0)}


def tracks(events,mesh=False):
    result=[];warnings=[];animation=None;texture=None;texanim=None;speed=1;loop=False;spine=None
    for ev in events:
        if not isinstance(ev,dict):continue
        prop=ev.get(3 if mesh else 2,'');mode=ev.get(2 if mesh else 1,'')
        short=str(prop).removeprefix('MPET_' if mesh else 'PCET_')
        mode=str(mode).removeprefix('MPET_' if mesh else 'PCET_')
        if short=='ANIM_NAME':animation=ev.get('STR');loop=ev.get('PLAY_TYPE')=='XAP_LOOP';continue
        if short=='ANIM_SPEED':
            speed=span(ev.get('VAL',1));speed=sum(speed)/2 if isinstance(speed,list) else speed
            if speed<=0:speed=1;warnings.append('0 이하의 애니메이션 속도는 1×로 미리보기합니다.')
            continue
        if short=='SPINE':
            spine=dict(name=ev.get('STR'),clipping=ev.get('CLIPPING'),position=vec(ev.get('POS')),scale=vec(ev.get('SCALE'),default=1),rotation=vec(ev.get('ROTATE')),events=[])
            continue
        if short=='SPINE_ANIM':
            if spine:spine['events'].append(dict(name=ev.get('STR'),at=span(ev.get(3,0)),speed=span(ev.get('TIME_SCALE',1))))
            continue
        if short=='TEXTURE':texture=ev.get('STR');continue
        if short=='TEX_ANIM':texanim=ev.get('STR');continue
        if short=='DISSOLVE':
            prefix='MPET_' if mesh else 'PCET_';property_key=3 if mesh else 2
            for target,proxy,field in [('dissolveColor','COLOR','RGBA'),('dissolveWidth','SCALE','WIDTH'),('dissolveThreshold','TEX0UV','THRESHOLD')]:
                source=dict(ev);source[property_key]=prefix+proxy
                if field!='RGBA':source['XY' if field=='THRESHOLD' else 'VAL']=ev.get(field,.05 if field=='WIDTH' else 1)
                normalized=tracks([source],mesh)
                for track in normalized['tracks']:track['property']=target
                result.extend(normalized['tracks']);warnings.extend(normalized['warnings'])
            continue
        if short not in PROPS:
            warnings.append(str(prop)+' 게임 로직은 적용하지 않고 나머지 시각 요소를 표시합니다.');continue
        name,field,count,default=PROPS[short]
        try:
            raw=ev.get(field,ev.get('XYZ') if short=='SCALE' else None)
            byte_color=field=='RGBA' and 'RGBA_255' in ev
            if byte_color:raw=ev['RGBA_255']
            value=vec(raw,count,default)
            if byte_color:value=[[v/255 for v in x] if isinstance(x,list) else x/255 for x in value]
            if mode not in ('INITIAL','FADE','FADE_FINAL','AT'):warnings.append(str(prop)+'의 알 수 없는 이벤트 시점은 초기값으로 표시합니다.');mode='INITIAL'
            at=span(ev.get(4 if mesh else 3,0));end=span(ev.get(5 if mesh else 4,at))
            result.append(dict(property=name,value=value,mode={'INITIAL':'initial','FADE':'fade','FADE_FINAL':'final','AT':'at'}[mode],start=at,end=end,
                               clock='anim' if mesh and ev.get(1)=='MPETT_ANIM' else 'global'))
        except ValueError as exc:warnings.append(str(prop)+' · '+str(exc))
    return dict(tracks=result,warnings=list(dict.fromkeys(warnings)),animation=animation,texture=texture,texanim=texanim,speed=speed,loop=loop,spine=spine)


def blend(row):
    return [str(row.get(k,d)).removeprefix('CON_D3DBLEND_') for k,d in [('m_SrcBlend','SRCALPHA'),('m_DestBlend','INVSRCALPHA')]]
