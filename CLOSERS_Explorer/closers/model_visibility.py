"""Observed frame-group priority rules; never execute game Lua or alter meshes.

The client loads ITEM_MODEL columns 33/34 into priority/group IDs, takes the
maximum priority per group, and skips meshes whose owner's priority is lower.
FRAME_UNIQUE_ID.LUA supplies ordered name prefixes (EQ_LEG2 -> 2, etc.).
"""
import math
import re
import struct


def frame_patterns(body):
    """Read only the initial literal table constructor in observed Lua 5.1 chunks."""
    if len(body)>1024*1024 or body[:12]!=b'\x1bLuaQ\0\x01\x04\x08\x04\x08\0':
        raise ValueError('미지원 FRAME_UNIQUE_ID Lua 형식입니다.')
    pos=12
    def take(size):
        nonlocal pos
        if size<0 or pos+size>len(body):raise ValueError('FRAME_UNIQUE_ID 데이터가 잘렸습니다.')
        value=body[pos:pos+size];pos+=size;return value
    def uint():return struct.unpack('<I',take(4))[0]
    def string():
        length=struct.unpack('<Q',take(8))[0]
        if length>65536:raise ValueError('FRAME_UNIQUE_ID 문자열이 너무 큽니다.')
        value=take(length)
        if length and value[-1]!=0:raise ValueError('FRAME_UNIQUE_ID 문자열 끝이 잘못되었습니다.')
        return value[:-1].decode('utf-8') if length else ''
    string();take(12)
    count=uint()
    if count>10000:raise ValueError('FRAME_UNIQUE_ID 명령 개수를 초과했습니다.')
    code=[uint() for _ in range(count)]
    count=uint()
    if count>10000:raise ValueError('FRAME_UNIQUE_ID 상수 개수를 초과했습니다.')
    constants=[]
    for _ in range(count):
        kind=take(1)[0]
        if kind==0:value=None
        elif kind==1:value=bool(take(1)[0])
        elif kind==3:value=struct.unpack('<d',take(8))[0]
        elif kind==4:value=string()
        else:raise ValueError('미지원 FRAME_UNIQUE_ID 상수입니다.')
        constants.append(value)
    registers={}
    try:
        for word in code:
            op=word&63;a=(word>>6)&255;b=word>>23;c=(word>>14)&511;bx=word>>14
            if op==10:registers[a]={}  # NEWTABLE
            elif op==1:registers[a]=constants[bx]  # LOADK
            elif op==34 and b and c:  # SETLIST; no calls, jumps or arbitrary Lua
                for i in range(1,b+1):registers[a][(c-1)*50+i]=registers[a+i]
            elif op==7 and constants[bx]=='FRAME_UNIQUE_ID':
                result=[]
                for _,pair in sorted(registers[a].items()):
                    name,ident=pair[1],pair[2]
                    if not isinstance(name,str) or not re.fullmatch(r'[A-Z_0-9]{1,128}',name):raise ValueError()
                    if type(ident) not in (int,float) or not math.isfinite(ident) or not 0<ident<256 or int(ident)!=ident:raise ValueError()
                    result.append([name,int(ident)])
                if not result:raise ValueError()
                return result
            else:raise ValueError()
    except (KeyError,IndexError,TypeError,ValueError) as exc:
        raise ValueError('FRAME_UNIQUE_ID의 정적 목록을 확인할 수 없습니다.') from exc
    raise ValueError('FRAME_UNIQUE_ID 목록이 없습니다.')


def model_rule(values):
    priority=values[33]
    if type(priority) is not int or not 0<=priority<=2147483647:raise ValueError('모델 표시 우선순위가 잘못되었습니다.')
    raw=values[34]
    if raw in ('',0):return dict(priority=priority,groups=[])
    if not isinstance(raw,str) or not re.fullmatch(r'[\d,\s]+',raw):raise ValueError('모델 표시 그룹이 잘못되었습니다.')
    groups=sorted({int(v.strip()) for v in raw.split(',') if v.strip()})
    if any(not 0<ident<256 for ident in groups):raise ValueError('모델 표시 그룹 범위를 초과했습니다.')
    return dict(priority=priority,groups=groups)


def apply_visibility(parts,rows,rules,patterns,deferred=None):
    """Annotate all meshes, preserving bytes/topology and hidden geometry."""
    maximum={};selected={row['name'].upper() for row in rows}
    for row in rows:
        name=row['name'].upper();rule=rules.get(name)
        if rule:
            # The picker permits partial BASE-only views of dyeable outfits.
            # Such geometry can omit the leg surface supplied by its DYE file;
            # culling another part's leg would turn that omission into a hole.
            companion=name[:-2]+'_DYE.X'
            if rule['groups'] and companion in rules and companion not in selected:
                if deferred is not None:deferred.append(dict(entry_id=row['id'],missing_companion=companion))
                continue
            for ident in rule['groups']:maximum[ident]=max(maximum.get(ident,0),rule['priority'])
    hidden=[]
    for part,row in zip(parts,rows):
        rule=rules.get(row['name'].upper())
        # Unknown owner priority cannot safely participate in priority culling.
        for mesh in part['meshes']:
            mesh['equipment_hidden']=False
            if rule is None:continue
            frame=part['frames'][mesh['frame']]['name'] if mesh['frame']>=0 else mesh['name']
            ident=next((ident for prefix,ident in patterns if frame.startswith(prefix)),0)
            priority=maximum.get(ident,0)
            if priority>rule['priority']:
                mesh['equipment_hidden']=True
                hidden.append(dict(entry_id=row['id'],mesh=mesh['name'],group=ident,priority=rule['priority'],required_priority=priority))
    return hidden
