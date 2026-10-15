"""CMF format adapted from Leayal's MIT-licensed CMF-Sharp.

Version 3 padding and versions 4–10 keys/padding were inferred from the supplied
samples. Unknown versions deliberately fail closed rather than guessing keys.
"""
from dataclasses import dataclass
from pathlib import Path
import re
import struct
import zlib

LEGACY_KEYS = (0xAC9372DE, 0x8469AF01, 0xDC39628F)
MODERN_KEYS = (0x5FBC3A19, 0x2D8E94B6, 0xE1726C43)
CHUNK = 128 * 1024
PARSER_VERSION = 3


class FormatError(ValueError):
    pass


class UnsupportedFormat(FormatError):
    """Recognized evidence for a layout that is not an independent archive."""
    pass


class Cancelled(Exception):
    pass


def check_cancel(cancel):
    if cancel is not None and cancel.is_set():
        raise Cancelled()


def decode(data, keys=LEGACY_KEYS):
    out = bytearray(len(data))
    for i in range(0, len(data), 4):
        value = (data[i] << 24 | data[i + 1] << 8 | data[i + 2] << 16 | data[i + 3])
        struct.pack_into('<I', out, i, value ^ keys[(i // 4) % 3])
    return out


@dataclass(frozen=True)
class Entry:
    index: int
    name: str
    size: int
    stored: int
    offset: int
    flag: int


class Archive:
    def __init__(self, path):
        self.path = Path(path)
        self.file = self.path.open('rb')
        try:
            self.length = self.path.stat().st_size
            header = self.file.read(104)
            if len(header) != 104:
                raise FormatError('CMF 헤더가 잘렸습니다.')
            if header[4:].startswith('COMBINE FILE ver.'.encode('utf-16-le')):
                raise UnsupportedFormat('리소스 인덱스입니다. index 명령으로 목록을 내보내고 실제 DAT*.CMF에서 본문을 추출해 주세요.')
            signature = header[:100].decode('utf-16-le', errors='strict').split('\0')[0]
            match = re.fullmatch(r'COMBINE FILE ver\.(\d+)', signature)
            if signature == 'COMBINE FILE ver. 1.0':
                self.version = 1
            elif match:
                self.version = int(match[1])
                if self.version not in range(2, 11):
                    raise UnsupportedFormat(f'미지원 CMF 버전 {self.version}. 추가 형식 분석이 필요합니다.')
            else:
                raise FormatError('CMF 서명을 인식하지 못했습니다.')
            self.count = struct.unpack('<I', decode(header[100:]))[0]
            self.base = 104 + self.count * 528 + (0 if self.version <= 2 else self.version)
            if self.base > self.length:
                raise FormatError('파일 개수 또는 헤더 범위가 잘못되었습니다.')
            self.keys = LEGACY_KEYS if self.version <= 3 else MODERN_KEYS
        except BaseException:
            self.file.close()
            raise

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.file.close()

    def entries(self, cancel=None):
        for index in range(self.count):
            check_cancel(cancel)
            self.file.seek(104 + index * 528)
            raw = self.file.read(528)
            if len(raw) != 528:
                raise FormatError('파일 목록이 잘렸습니다.')
            data = decode(raw, self.keys)
            name = data[:512].decode('utf-16-le', errors='strict').split('\0')[0]
            if not name or any(ord(c) < 32 for c in name):
                raise FormatError(f'항목 {index}: 파일명을 해독하지 못했습니다.')
            size, compressed, offset, flag = struct.unpack('<4I', data[512:])
            if flag not in (0, 1, 2):
                raise FormatError(f'항목 {index}: 미지원 저장 플래그 {flag}')
            stored = compressed if flag == 1 or (flag == 2 and compressed) else size
            if self.base + offset + stored > self.length:
                raise FormatError(f'항목 {index}: 데이터 범위가 원본 파일을 벗어납니다.')
            yield Entry(index, name, size, stored, self.base + offset, flag)

    def chunks(self, entry, cancel=None):
        """Yield at most CHUNK bytes, including for extreme compression ratios."""
        self.file.seek(entry.offset)
        left = entry.stored
        total = 0
        decoder = zlib.decompressobj() if entry.flag == 1 else None
        while left:
            check_cancel(cancel)
            block = self.file.read(min(CHUNK, left))
            if not block:
                raise FormatError('데이터가 예상보다 일찍 끝났습니다.')
            left -= len(block)
            if decoder is None:
                total += len(block)
                yield block
            else:
                while block:
                    check_cancel(cancel)
                    out = decoder.decompress(block, CHUNK)
                    block = decoder.unconsumed_tail
                    total += len(out)
                    if total > entry.size:
                        raise FormatError('압축 해제 결과가 헤더 크기를 초과했습니다.')
                    if out:
                        yield out
                    if decoder.eof:
                        if decoder.unused_data or block or left:
                            raise FormatError('압축 스트림 뒤에 예상하지 못한 데이터가 있습니다.')
                        break
        if decoder is not None and not decoder.eof:
            raise FormatError('불완전한 zlib 스트림입니다.')
        if entry.flag != 2 and total != entry.size:
            raise FormatError(f'크기 불일치: 예상 {entry.size}, 실제 {total}')

    def stored_chunks(self, entry, cancel=None):
        """Copy exactly the stored span; no decompression or interpretation."""
        if entry.offset < self.base or entry.stored < 0 or entry.offset + entry.stored > self.length:
            raise FormatError('저장 바이트 범위가 원본을 벗어납니다.')
        self.file.seek(entry.offset)
        remaining = entry.stored
        while remaining:
            check_cancel(cancel)
            block = self.file.read(min(CHUNK, remaining))
            if not block:
                raise FormatError('저장 바이트를 읽는 동안 원본이 잘렸습니다.')
            remaining -= len(block)
            yield block

    def prefix(self, entry, limit=4096):
        if entry.flag == 2 or limit <= 0:
            return b''
        self.file.seek(entry.offset)
        if entry.flag != 1:
            return self.file.read(min(limit, entry.stored))
        decoder = zlib.decompressobj()
        result = bytearray()
        left = entry.stored
        # A prefix is classification evidence, not full stream validation.
        while left and len(result) < limit and not decoder.eof:
            data = self.file.read(min(4096, left))
            if not data:
                raise FormatError('판별 데이터를 읽는 동안 원본이 잘렸습니다.')
            left -= len(data)
            result.extend(decoder.decompress(data, limit - len(result)))
        return bytes(result)


def classify(name, prefix, flag):
    ext = Path(name).suffix.lower().lstrip('.') or 'bin'
    actual = ext
    if prefix.startswith(b'\x89PNG\r\n\x1a\n'):
        actual = 'png'
    elif prefix.startswith(b'DDS '):
        actual = 'dds'
    elif prefix.startswith(b'OggS'):
        actual = 'ogg'
    elif prefix[:4] == b'RIFF' and prefix[8:12] == b'WAVE':
        actual = 'wav'
    elif prefix.startswith(b'xof '):
        actual = 'x'
    elif prefix.startswith(b'\xff\xd8\xff'):
        actual = 'jpg'
    elif prefix.startswith((b'GIF87a', b'GIF89a')):
        actual = 'gif'
    elif prefix.startswith(b'BM'):
        actual = 'bmp'
    elif prefix.startswith(b'fLaC'):
        actual = 'flac'
    if flag == 2:
        return 'encrypted', '암호화 데이터', ext
    upper = Path(name).name.upper()
    if actual in ('png', 'dds', 'jpg', 'jpeg', 'gif', 'bmp', 'tga', 'webp'):
        detail = '초상화' if 'PORTRAIT' in upper else '아이콘' if upper.startswith(('TT_', 'ICON')) else 'UI' if upper.startswith(('DLG_', 'UI_')) else '텍스처'
        return 'images', detail, actual
    if actual in ('ogg', 'wav', 'mp3', 'flac', 'wem'):
        detail = '대사·음성' if upper.startswith(('ST_', 'VOICE')) else '효과음' if upper.startswith(('SE_', 'SFX')) else '배경음악' if upper.startswith(('BGM', 'MUSIC')) else '기타 오디오'
        return 'audio', detail, actual
    if actual in ('x', 'obj', 'fbx', 'mesh', 'skel', 'anim'):
        return 'models', '캐릭터·장비' if 'AVATAR' in upper else '배경·오브젝트', actual
    if actual in ('lua', 'tet', 'xet', 'fx', 'xml', 'json', 'csv', 'txt', 'ini'):
        return 'scripts', '셰이더' if actual == 'fx' else '스크립트·설정', actual
    return 'other', '기타 파일', actual


def describe(prefix):
    """Small, bounded metadata reads; never decode an image just for dimensions."""
    info = {}
    if prefix.startswith(b'\x89PNG\r\n\x1a\n') and len(prefix) >= 24:
        width, height = struct.unpack('>II', prefix[16:24])
        info['이미지 해상도'] = f'{width} × {height}'
    elif prefix.startswith(b'DDS ') and len(prefix) >= 88:
        height, width = struct.unpack('<II', prefix[12:20])
        info['이미지 해상도'] = f'{width} × {height}'
        info['DDS 인코딩'] = prefix[84:88].decode('ascii', errors='replace').strip('\0') or '비압축 픽셀'
    elif prefix.startswith(b'OggS'):
        offset = prefix.find(b'\x01vorbis')
        if offset >= 0 and len(prefix) >= offset + 16:
            info['오디오 채널'] = str(prefix[offset + 11])
            info['샘플링 주파수'] = f'{struct.unpack_from("<I", prefix, offset + 12)[0]:,} Hz'
    elif prefix[:4] == b'RIFF' and prefix[8:12] == b'WAVE':
        offset = 12
        while offset + 8 <= len(prefix):
            length = struct.unpack_from('<I', prefix, offset + 4)[0]
            if prefix[offset:offset + 4] == b'fmt ' and length >= 16 and offset + 24 <= len(prefix):
                codec, channels, rate = struct.unpack_from('<HHI', prefix, offset + 8)
                info['WAV 코덱'] = 'PCM' if codec == 1 else f'태그 {codec}'
                info['오디오 채널'] = str(channels)
                info['샘플링 주파수'] = f'{rate:,} Hz'
                break
            offset += 8 + length + length % 2
    elif prefix.startswith(b'xof ') and len(prefix) >= 16:
        info['DirectX 버전'] = prefix[4:8].decode('ascii', errors='replace')
        info['모델 인코딩'] = prefix[8:12].decode('ascii', errors='replace').strip()
    return info
