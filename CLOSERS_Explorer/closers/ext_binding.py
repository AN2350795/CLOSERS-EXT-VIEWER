"""Preserve world-object EXT inputs without assigning them to avatars."""
import hashlib
import math
from .lua_literals import tables


def _field(row,name,default,boolean=False):
    if name not in row:
        return dict(literal=None,effective=default,origin='source-constructor',valid=True)
    value=row[name]
    valid=(type(value)is bool or type(value)is str and value in ('TRUE','FALSE')) if boolean else (
        type(value) in (int,float) and math.isfinite(value) and abs(value)<=3.402823466e38)
    effective=(value is True or value=='TRUE') if boolean else value
    return dict(literal=value,effective=effective if valid else None,origin='explicit-literal',valid=valid)


def world_ext_objects(body):
    root=tables(body).get('WORLD_TEMPLET')
    if not isinstance(root,dict):raise ValueError('WORLD_TEMPLET 정의가 없습니다.')
    rows=root.get('m_vecWorldObjData',{})
    if not isinstance(rows,dict):raise ValueError('지역 오브젝트 목록 형식이 올바르지 않습니다.')
    result=[]
    for index,row in rows.items():
        path=f'WORLD_TEMPLET.m_vecWorldObjData[{index}]'
        if not isinstance(row,dict):
            result.append(dict(index=index,source_path=path,status='unresolved',reason='Object definition is not a literal table'));continue
        # 0x1416774c5 clears flag +0x1e9; 0x1416774ce sets factor +0x1ec to 1.
        enabled=_field(row,'m_bUseExt',False,boolean=True)
        intensity=_field(row,'m_fUseExtIntensity',1)
        result.append(dict(index=index,source_path=path,model_name=row.get('m_MeshName'),object_id=row.get('m_WorldObjID'),
                           status='source-only' if enabled['valid'] and intensity['valid'] else 'unresolved',
                           enabled=enabled,intensity=intensity))
    return dict(status='source-only',sha256=hashlib.sha256(body).hexdigest(),scope='world-object-template',
                container_present='m_vecWorldObjData' in root,objects=result,avatar_binding='unresolved',rendering_enabled=False)
