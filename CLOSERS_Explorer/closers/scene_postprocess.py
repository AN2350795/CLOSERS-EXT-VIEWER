"""Inspect world screen-effect literals; never derive a color preset from them."""
import hashlib
from .lua_literals import tables

SCREEN_FIELDS=('m_TexName','m_UVSpeed','m_SrcBlend','m_DestBlend','m_DrawCount',
               'm_Color','m_Color_255','m_TargetColor','m_TargetColor_255')


def screen_effects(body):
    root=tables(body).get('WORLD_TEMPLET')
    if not isinstance(root,dict):raise ValueError('WORLD_TEMPLET 정의가 없습니다.')
    rows=root.get('m_vecWorldScreenEffect',{})
    if not isinstance(rows,dict):raise ValueError('지역 화면 효과 목록 형식이 올바르지 않습니다.')
    result=[]
    for index,row in rows.items():
        path=f'WORLD_TEMPLET.m_vecWorldScreenEffect[{index}]'
        if not isinstance(row,dict):
            result.append(dict(source_path=path,status='unresolved',reason='Screen effect is not a literal table'));continue
        result.append(dict(source_path=path,status='source-only',values={k:row[k] for k in SCREEN_FIELDS if k in row},
                           missing=[k for k in SCREEN_FIELDS if k not in row],unknown_fields=[k for k in row if k not in SCREEN_FIELDS]))
    return dict(status='source-only',sha256=hashlib.sha256(body).hexdigest(),scope='world-screen-effect-input',
                container_present='m_vecWorldScreenEffect' in root,effects=result,
                color_preset_binding='not-established',rendering_enabled=False)
