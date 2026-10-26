"""Bounded text X tokens compatible with the binary scene reader."""
import math
import re


TOKEN=re.compile(r'(?P<skip>\s+|//[^\r\n]*|\#[^\r\n]*|/\*[\s\S]*?\*/)|(?P<guid><[0-9a-fA-F-]{36}>)|(?P<string>"(?:[^"\\]|\\.)*")|(?P<number>[-+]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][-+]?\d+)?)|(?P<name>[A-Za-z_][A-Za-z0-9_.-]*)|(?P<symbol>[{}()\[\]<>.,;])')


def text_tokens(data):
    try:body=data[16:].decode('utf-8')
    except UnicodeDecodeError:body=data[16:].decode('cp949')
    pos=0;count=0
    while pos<len(body):
        match=TOKEN.match(body,pos)
        if not match:raise ValueError(f'텍스트 X에 지원하지 않는 토큰이 있습니다: 문자 {pos}')
        pos=match.end();kind=match.lastgroup;value=match.group()
        if kind=='skip':continue
        count+=1
        if count>4_000_000:raise ValueError('텍스트 X 토큰 예산을 초과했습니다.')
        if kind=='number':
            value=float(value) if any(c in value for c in '.eE') else int(value)
            if abs(value)>1e10 or not math.isfinite(value):raise ValueError('X 숫자가 유효하지 않습니다.')
        elif kind=='name':
            if value=='template':kind='keyword';value=31
        elif kind=='string':value=re.sub(r'\\(["\\])',r'\1',value[1:-1])
        elif kind=='guid':value=None
        if isinstance(value,str) and len(value)>32768:raise ValueError('텍스트 X 이름·문자열이 너무 깁니다.')
        yield kind,value
