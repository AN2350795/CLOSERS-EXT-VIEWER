"""Strict reader for the NTF layouts observed in the local Korean client.

Keys are read from the user's executable, never shipped with the application.
No game code is loaded or executed. AES is only needed when building the index.
"""
import base64
import re
import struct
import zlib

MAX_BYTES = 128 * 1024 * 1024
SIZES = {2: 1, 4: 2, 5: 4, 9: 4, 11: 8, 12: 1}


def script_keys(executable):
    """Locate the observed AES-256/CBC call site's two RIP-relative constants."""
    if executable.stat().st_size>MAX_BYTES:raise ValueError('실행 파일 크기를 초과했습니다.')
    data = executable.read_bytes()
    if len(data)>MAX_BYTES or data[:2]!=b'MZ':
        raise ValueError('지원하는 PE 실행 파일이 아닙니다.')
    try:
        pe = struct.unpack_from('<I', data, 60)[0]
        if data[pe:pe+4]!=b'PE\0\0':raise ValueError()
        count = struct.unpack_from('<H', data, pe+6)[0]
        opt = struct.unpack_from('<H', data, pe+20)[0]
        if struct.unpack_from('<H', data, pe+24)[0]!=0x20b:raise ValueError()
        sections = [struct.unpack_from('<8sIIII',data,pe+24+opt+i*40) for i in range(count)]
        def rva_offset(rva):
            for _,vs,va,rs,off in sections:
                if va<=rva<va+rs:return off+rva-va
            raise ValueError('실행 파일 상수 범위가 잘못되었습니다.')
        candidates=[]
        # set_key(context, key32); decrypt(context, input, output, blocks, iv16, CBC)
        pattern=(rb'\x48\x8d\x15(.{4})\x48\x8d\x4c\x24.\xe8.{4}'
                 rb'\x44\x8b\x4c\x24.\x41\xc1\xe9\x04\xc7\x44\x24\x28\x01\x00\x00\x00'
                 rb'\x48\x8d\x05(.{4})\x48\x89\x44\x24\x20')
        for _,vs,va,rs,off in sections:
            for m in re.finditer(pattern,data[off:off+rs],re.DOTALL):
                key_rva=va+m.start()+7+struct.unpack('<i',m[1])[0]
                iv_rva=va+m.start(2)+4+struct.unpack('<i',m[2])[0]
                ko,io=rva_offset(key_rva),rva_offset(iv_rva)
                candidates.append((data[ko:ko+32],data[io:io+16]))
        candidates=list(dict.fromkeys(candidates))
        if len(candidates)!=1:raise ValueError('실행 파일에서 지원하는 NTF 복원 경로를 찾지 못했습니다.')
        return candidates[0]
    except (struct.error,IndexError) as exc:
        raise ValueError('PE 구조를 읽을 수 없습니다.') from exc


def decrypt(stored, key, iv):
    try:
        from Crypto.Cipher import AES
    except ImportError as exc:
        raise ValueError('이름 인덱스 생성에는 pycryptodome이 필요합니다: python -m pip install pycryptodome') from exc
    if len(stored)>MAX_BYTES:raise ValueError('NTF 입력 크기를 초과했습니다.')
    try:
        encrypted=base64.b64decode(stored,validate=True)
    except ValueError as exc:
        raise ValueError('NTF Base64 형식이 잘못되었습니다.') from exc
    if not encrypted or len(encrypted)%16:raise ValueError('NTF AES 블록 크기가 잘못되었습니다.')
    body=AES.new(key,AES.MODE_CBC,iv).decrypt(encrypted)
    pad=body[-1]
    if not 1<=pad<=16 or body[-pad:]!=bytes([pad])*pad:
        raise ValueError('NTF 복원 키 또는 패딩이 일치하지 않습니다.')
    return body[:-pad]


def restore(stored, expected, key, iv):
    if not 0<expected<=MAX_BYTES:raise ValueError('NTF 복원 크기를 초과했습니다.')
    compressed=decrypt(stored,key,iv)
    decoder=zlib.decompressobj()
    body=decoder.decompress(compressed,expected+1)
    if len(body)!=expected or not decoder.eof or decoder.unused_data or decoder.unconsumed_tail:
        raise ValueError('NTF 압축 스트림 또는 복원 크기가 일치하지 않습니다.')
    return body


def header(body):
    if len(body)<12 or len(body)>MAX_BYTES:raise ValueError('NTF 헤더 크기가 잘못되었습니다.')
    columns=struct.unpack_from('<I',body)[0]
    if not 1<=columns<=512 or len(body)<8+columns*4:raise ValueError('NTF 열 개수가 잘못되었습니다.')
    types=struct.unpack_from('<'+'I'*columns,body,4)
    count=struct.unpack_from('<I',body,4+columns*4)[0]
    if count>1_000_000:raise ValueError('NTF 행 개수를 초과했습니다.')
    return types,count,8+columns*4


def rows(body):
    types,count,start=header(body)
    if any(t not in (*SIZES,8) for t in types):raise ValueError('미지원 NTF 필드 형식입니다.')
    index=len(body)-count*4
    if index<start:raise ValueError('NTF 행 인덱스가 잘렸습니다.')
    offset=start
    for row in range(count):
        end=struct.unpack_from('<I',body,index+row*4)[0]
        if not offset<end<=index:raise ValueError('NTF 행 범위가 잘못되었습니다.')
        values=[]
        for kind in types:
            size=4 if kind==8 else SIZES[kind]
            if offset+size>end:raise ValueError('NTF 필드가 잘렸습니다.')
            value=int.from_bytes(body[offset:offset+size],'little');offset+=size
            if kind==8:
                size=value*2
                if size>MAX_BYTES or offset+size>end:raise ValueError('NTF 문자열 범위가 잘못되었습니다.')
                value=body[offset:offset+size].decode('utf-16-le',errors='strict');offset+=size
            values.append(value)
        if offset!=end:raise ValueError('NTF 행의 필드 길이가 일치하지 않습니다.')
        yield values
    if offset!=index:raise ValueError('NTF 인덱스 앞에 미해석 데이터가 있습니다.')
