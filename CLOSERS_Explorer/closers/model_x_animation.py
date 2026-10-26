"""Named animation channels embedded in the same verified X model."""
import math
from .model import x_data,x_objects,numeric,Reader


def embedded_clip(body,frames,name):
    objects=x_objects(x_data(body))
    rates=[o['values'] for o in objects if o['kind']=='AnimTicksPerSecond']
    if len(rates)>1 or (rates and len(rates[0])!=1):raise ValueError('X 애니메이션 시간 단위가 불명확합니다.')
    rate=numeric(rates[0])[0] if rates else 4800
    if not 0<rate<=1_000_000:raise ValueError('X 애니메이션 시간 단위가 올바르지 않습니다.')
    clips=[o for o in objects if o['kind']=='AnimationSet' and o['name']==name]
    if len(clips)!=1:raise ValueError('동일한 이름의 내장 X 애니메이션을 찾지 못했습니다.')
    names={f['name']:i for i,f in enumerate(frames)}
    if len(names)!=len(frames):raise ValueError('X 프레임 이름이 중복됩니다.')
    tracks=[];seen=set();total=0;duration=0;missing=set()
    for animation in clips[0]['children']:
        if animation['kind']!='Animation':continue
        refs=[o['name'] for o in animation['children'] if o['kind']=='reference']
        if len(refs)!=1:raise ValueError('X 애니메이션 프레임 연결이 올바르지 않습니다.')
        frame=names.get(refs[0])
        # Exporters can retain tracks for deleted leaf helpers. They have no
        # frame or geometry in this X; keep the channels for existing frames.
        if frame is None:missing.add(refs[0])
        for channel in animation['children']:
            if channel['kind']!='AnimationKey':continue
            values=numeric(channel['values']);it=iter(values)
            try:
                kind=next(it);count=Reader(b'').count(next(it),10000)
                prop,width={0:('quaternion',4),1:('scale',3),2:('position',3),3:('matrix',16),4:('matrix',16)}[kind]
                channel_key=(refs[0],prop)
                if channel_key in seen or not count:raise ValueError('X 애니메이션 채널이 중복되거나 비어 있습니다.')
                seen.add(channel_key);total+=count
                if total>150000:raise ValueError('X 애니메이션 키 예산을 초과했습니다.')
                keys=[];previous=-1
                for _ in range(count):
                    tick=next(it);size=next(it)
                    if tick<previous or tick<0 or tick/rate>3600 or size!=width:raise ValueError('X 애니메이션 키가 올바르지 않습니다.')
                    previous=tick;value=[next(it) for _ in range(width)]
                    if kind==0:
                        length=sum(v*v for v in value)
                        if not .98<=length<=1.02:raise ValueError('X 회전 사원수가 올바르지 않습니다.')
                        w,x,y,z=[v/math.sqrt(length) for v in value]
                        value=[-x,-y,-z,w]
                    keys.append(dict(time=tick/rate,value=value));duration=max(duration,tick/rate)
                if next(it,None) is not None:raise ValueError('X 애니메이션 키에 남는 데이터가 있습니다.')
                if frame is not None:tracks.append(dict(frame=frame,property=prop,keys=keys))
            except (StopIteration,KeyError):raise ValueError('지원하지 않거나 잘린 X 애니메이션 채널입니다.') from None
    if not tracks:raise ValueError('내장 X 애니메이션에 재생할 채널이 없습니다.')
    return dict(clip=dict(name=name,duration=duration),tracks=tracks,mapping=dict(method='named-x-animation',missing_frames=sorted(missing)),
                warnings=['모델에 없는 프레임의 채널을 제외했습니다: '+', '.join(sorted(missing))] if missing else [])
