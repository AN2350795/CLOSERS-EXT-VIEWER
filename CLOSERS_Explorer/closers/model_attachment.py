"""Literal ITEM_MODEL attachment transforms, in game bone-local coordinates."""
import math
import re
from .model import IDENTITY,matrix_product


def vector(text,default):
    if text in ('',None,0):return list(default)
    if not isinstance(text,str) or not re.fullmatch(r'\s*\{[^{}]+\}\s*',text):raise ValueError('부착 벡터 형식이 올바르지 않습니다.')
    values=[float(v.strip()) for v in text.strip()[1:-1].split(',')]
    if len(values)!=3 or not all(math.isfinite(v) and abs(v)<=100000 for v in values):raise ValueError('부착 벡터 수치가 올바르지 않습니다.')
    return values


def attachment(row,source):
    bone=row[20]
    if not bone:return None
    try:
        if not isinstance(bone,str) or not bone.strip():raise ValueError('부착 뼈 이름이 올바르지 않습니다.')
        return dict(bone=bone.strip(),scale=vector(row[15],(1,1,1)),rotation=vector(row[16],(0,0,0)),offset=vector(row[17],(0,0,0)),source=source,status='ready')
    except (ValueError,TypeError) as exc:return dict(status='unavailable',error=str(exc),source=source)


def transform(value):
    # Row-vector DirectX matrices, stored as Three's column-major arrays.
    x,y,z=map(math.radians,value['rotation']);cx,sx=math.cos(x),math.sin(x);cy,sy=math.cos(y),math.sin(y);cz,sz=math.cos(z),math.sin(z)
    sxv,syv,szv=value['scale'];result=[sxv,0,0,0,0,syv,0,0,0,0,szv,0,0,0,0,1]
    for rotation in ([cz,sz,0,0,-sz,cz,0,0,0,0,1,0,0,0,0,1],
                     [1,0,0,0,0,cx,sx,0,0,-sx,cx,0,0,0,0,1],
                     [cy,0,-sy,0,0,1,0,0,sy,0,cy,0,0,0,0,1]):result=matrix_product(result,rotation)
    translation=IDENTITY.copy();translation[12:15]=value['offset'];return matrix_product(result,translation)
