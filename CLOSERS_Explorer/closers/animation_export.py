"""Lossless animated WebP with independent full-canvas RGBA frames."""
from io import BytesIO
import math
import struct
import threading

MAX_BYTES = 128 * 1024 * 1024
MAX_FRAME_PIXELS = 16777216
MAX_TOTAL_PIXELS = 134217728


class AnimationExport:
    def __init__(self):
        self.gate = threading.Lock()

    def webp(self, body):
        if not self.gate.acquire(blocking=False):
            raise ValueError('다른 애니메이션을 저장하고 있습니다. 완료 후 다시 시도하세요.')
        try:
            return encode_webp(body)
        finally:
            self.gate.release()


def encode_webp(body):
    try:
        from PIL import Image, features
    except ImportError as exc:
        raise ValueError('무손실 WebP 저장에는 Pillow가 필요합니다.') from exc
    if not features.check('webp'): raise ValueError('현재 Pillow에 WebP 저장 기능이 없습니다.')
    if not 0 < len(body) <= MAX_BYTES or body[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError('애니메이션 입력은 128 MiB 이하의 APNG여야 합니다.')
    output = BytesIO(b'RIFF\0\0\0\0WEBP');output.seek(12)

    def chunk(kind, data):
        if output.tell()+len(data)+9 > MAX_BYTES: raise ValueError('WebP 출력이 128 MiB를 초과했습니다.')
        output.write(kind+struct.pack('<I',len(data)));output.write(data)
        if len(data)%2: output.write(b'\0')

    def uint24(n): return int(n).to_bytes(3,'little')

    try:
        with Image.open(BytesIO(body)) as source:
            width,height=source.size;count=getattr(source,'n_frames',1)
            if source.format!='PNG' or source.info.get('default_image') or not 2 <= count <= 250:
                raise ValueError('변환할 APNG는 기본 이미지 없이 2~250프레임이어야 합니다.')
            if max(width,height)>8192 or width*height>MAX_FRAME_PIXELS or width*height*count>MAX_TOTAL_PIXELS:
                raise ValueError('WebP 변환 이미지의 크기 또는 총 픽셀 수가 너무 큽니다.')
            # VP8X: alpha + animation. ANIM: transparent background, infinite loop.
            chunk(b'VP8X',b'\x12\0\0\0'+uint24(width-1)+uint24(height-1))
            chunk(b'ANIM',bytes(6))
            elapsed=0;timestamp=0
            for index in range(count):
                source.seek(index)
                duration=source.info.get('duration',0)
                if not isinstance(duration,(int,float)) or not math.isfinite(duration) or not 1 <= duration <= 60000:
                    raise ValueError('애니메이션 프레임 시간이 올바르지 않습니다.')
                elapsed+=duration;end=round(elapsed);delay=end-timestamp;timestamp=end
                if not 1 <= delay <= 60000: raise ValueError('애니메이션 프레임 시간이 올바르지 않습니다.')
                encoded=BytesIO()
                with source.convert('RGBA') as frame:
                    frame.save(encoded,'WEBP',lossless=True,exact=True,method=3)
                raw=encoded.getvalue();offset=12;image_chunks=[]
                while offset+8 <= len(raw):
                    size=struct.unpack_from('<I',raw,offset+4)[0];end_offset=offset+8+size+(size%2)
                    if end_offset>len(raw): raise ValueError('WebP 프레임이 잘렸습니다.')
                    if raw[offset:offset+4]==b'VP8L': image_chunks.append(raw[offset:end_offset])
                    offset=end_offset
                if len(image_chunks)!=1: raise ValueError('무손실 WebP 프레임을 생성하지 못했습니다.')
                # Every sampled frame is retained, even identical ones. Replace
                # the entire canvas and dispose to transparent; never alpha-over
                # the previous frame (avoids trails through transparent pixels).
                control=bytes(6)+uint24(width-1)+uint24(height-1)+uint24(delay)+b'\x03'
                chunk(b'ANMF',control+b''.join(image_chunks))
    except (OSError,Image.DecompressionBombError) as exc:
        raise ValueError('애니메이션 이미지를 읽거나 변환하지 못했습니다.') from exc
    output.seek(4);output.write(struct.pack('<I',len(output.getbuffer())-8))
    return output.getvalue()
