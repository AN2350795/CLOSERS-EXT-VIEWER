"""Read literal tables from observed Lua 5.1 chunks without running game code."""
import math
import struct


def tables(body):
    if len(body) > 16*1024*1024 or body[:12] != b'\x1bLuaQ\0\x01\x04\x08\x04\x08\0':
        raise ValueError('지원하지 않는 Lua 테이블 형식입니다.')
    pos = 12

    def take(n):
        nonlocal pos
        if n < 0 or pos+n > len(body):
            raise ValueError('Lua 테이블이 잘렸습니다.')
        value = body[pos:pos+n]; pos += n
        return value

    def uint():
        return struct.unpack('<I', take(4))[0]

    def string():
        n = struct.unpack('<Q', take(8))[0]
        raw = take(n)
        if n and raw[-1] != 0:
            raise ValueError('Lua 문자열 끝이 잘못되었습니다.')
        return raw[:-1].decode('cp949', errors='replace') if n else ''

    string(); take(12)
    count = uint()
    if count > 1000000:
        raise ValueError('Lua 명령 개수를 초과했습니다.')
    code = [uint() for _ in range(count)]
    count = uint()
    if count > 100000:
        raise ValueError('Lua 상수 개수를 초과했습니다.')
    constants = []
    for _ in range(count):
        kind = take(1)[0]
        if kind == 0: value = None
        elif kind == 1: value = bool(take(1)[0])
        elif kind == 3:
            value = struct.unpack('<d', take(8))[0]
            if not math.isfinite(value): raise ValueError('Lua 수치가 잘못되었습니다.')
        elif kind == 4: value = string()
        else: raise ValueError('지원하지 않는 Lua 상수입니다.')
        constants.append(value)
    registers, result = {}, {}

    def rk(n):
        return constants[n-256] if n >= 256 else registers[n]

    try:
        for word in code:
            op, a, b, c, bx = word & 63, (word >> 6) & 255, word >> 23, (word >> 14) & 511, word >> 14
            if op == 10: registers[a] = {}
            elif op == 0: registers[a] = registers[b]
            elif op == 1: registers[a] = constants[bx]
            elif op == 5: registers[a] = result.get(constants[bx], constants[bx])
            elif op == 6:
                owner,key=registers[b],rk(c)
                # Literal table lookup, or a symbolic external enum member.
                registers[a]=owner.get(key) if isinstance(owner,dict) else str(owner)+'.'+str(key)
            elif op == 9: registers[a][rk(b)] = rk(c)
            elif op in (12, 13, 14, 15):
                left, right = rk(b), rk(c)
                if not isinstance(left, (int, float)) or not isinstance(right, (int, float)):
                    registers[a] = {'expression': [op, left, right]}
                    continue
                if op == 12: value = left+right
                elif op == 13: value = left-right
                elif op == 14: value = left*right
                else: value = left/right
                if not math.isfinite(value): raise ValueError('Lua 수치가 잘못되었습니다.')
                registers[a] = value
            elif op == 18:
                registers[a] = -registers[b] if isinstance(registers[b], (int, float)) else {'expression': [18, registers[b]]}
            elif op == 34 and b and c:
                for i in range(1, b+1): registers[a][(c-1)*50+i] = registers[a+i]
            elif op == 7: result[constants[bx]] = registers[a]
            elif op == 30: break
            else: raise ValueError('정적 테이블 이외의 Lua 명령은 지원하지 않습니다.')
    except (IndexError, KeyError, TypeError) as exc:
        raise ValueError('Lua 테이블 연결이 잘못되었습니다.') from exc
    return result
