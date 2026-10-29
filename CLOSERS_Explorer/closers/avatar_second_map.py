"""Read the character's explicit hyper-mode SecondMap, without activating it."""
import hashlib
import math
from .lua_literals import tables
from .loading import MissingDefinition


def second_map(body,name):
    root=tables(body).get('GAME_UNIT_TEMPLET')
    value=root.get('m_HyperModeSecondTexture') if isinstance(root,dict) else None
    if value is None:return None
    if not isinstance(value,dict):raise ValueError('하이퍼 모드 SecondMap 정의가 올바르지 않습니다.')
    texture=value.get('m_SecondTexture')
    if not isinstance(texture,str) or not texture.strip():raise ValueError('SecondMap 텍스처가 없습니다.')
    speed=value.get('m_SecondTexOffSetSpeed')
    if not isinstance(speed,dict) or set(speed)!={1,2} or not all(type(v) in (int,float) and math.isfinite(v) and abs(v)<=3.402823466e38 for v in speed.values()):
        raise ValueError('SecondMap UV 이동 속도가 올바르지 않습니다.')
    return dict(kind='hyper-second-map',status='approximate',texture=texture.upper(),source=name,
                source_sha256=hashlib.sha256(body).hexdigest(),speed=[speed[1],speed[2]],activation='manual',
                basis='CW_CARTOONLIGHT.PS.CSO:t8;CW_DEFAULT.VS.CSO:cb5[1].xy',
                limitations=['runtime_activation','uv_animation','color_space'],bloom=False)


def read_second_map(data,character):
    name='GUST_USER_'+character+'.LUA'
    def read():
        try:return second_map(data.body(name),name)
        except MissingDefinition:return None
        except ValueError as exc:return dict(kind='hyper-second-map',status='unavailable',source=name,reason=str(exc))
    return data.cached(('avatar-second-map',1,character),read,persistent=True)
