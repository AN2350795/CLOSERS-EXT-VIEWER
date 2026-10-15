"""Full-resolution composition inputs, separate from thumbnails and extraction."""
import hashlib
import shutil
import struct
import tempfile
import threading
import uuid

from .cmf import Archive
from .library import saved_file

MAX_BYTES = 64 * 1024 * 1024
MAX_PIXELS = 16 * 1024 * 1024
CACHE_BYTES = 256 * 1024 * 1024
NATIVE = {'png','jpg','jpeg','gif','bmp','webp'}


def dimensions(stream, fmt):
    """Pillow is optional for native PNG/GIF/BMP; no full image allocation."""
    try:
        from PIL import Image
    except ImportError:
        stream.seek(0)
        prefix = stream.read(32)
        if fmt == 'png' and prefix.startswith(b'\x89PNG\r\n\x1a\n') and len(prefix) >= 24:
            return struct.unpack('>II',prefix[16:24])
        if fmt == 'gif' and prefix[:6] in (b'GIF87a',b'GIF89a'):
            return struct.unpack('<HH',prefix[6:10])
        if fmt == 'bmp' and prefix[:2] == b'BM' and len(prefix) >= 26:
            w,h = struct.unpack('<ii',prefix[18:26])
            return abs(w),abs(h)
        raise ValueError('이 이미지 형식의 원본 해상도 확인에는 Pillow가 필요합니다.')
    stream.seek(0)
    with Image.open(stream) as image:
        return image.size


def check_dimensions(size):
    width,height = size
    if not width or not height or width > 16384 or height > 16384 or width*height > MAX_PIXELS:
        raise ValueError('합성 입력은 한 이미지당 16,777,216픽셀·한 변 16,384픽셀까지 지원합니다.')


class CompositionImages:
    def __init__(self,catalog):
        self.catalog = catalog
        self.directory = catalog.workspace / 'composition-cache'
        self.directory.mkdir(exist_ok=True)
        self.gate = threading.BoundedSemaphore(1)

    def prepare(self,entry_id):
        with self.gate:
            row = self.catalog.get(int(entry_id))
            if row['category'] != 'images' or row['flag'] == 2 or row['format'] not in NATIVE | {'dds','tga'}:
                raise ValueError('복원 가능한 이미지 항목을 선택해 주세요.')
            stored = saved_file(row)
            before = stored.stat() if stored else None
            if (before.st_size if before else row['size']) > MAX_BYTES:
                raise ValueError('합성 입력 파일은 64 MiB까지 지원합니다.')
            digest = hashlib.sha256()
            with tempfile.SpooledTemporaryFile(max_size=1024*1024,mode='w+b',dir=self.directory) as source:
                if stored:
                    with stored.open('rb') as stream:
                        def blocks():
                            while block := stream.read(128*1024):
                                yield block
                        self.copy(blocks(),source,digest)
                    after = stored.stat()
                    if (before.st_size,before.st_mtime_ns) != (after.st_size,after.st_mtime_ns):
                        raise ValueError('이미지를 읽는 동안 저장 파일이 변경되었습니다. 다시 선택해 주세요.')
                else:
                    self.catalog.verify_source(row)
                    with Archive(row['archive']) as archive:
                        self.copy(archive.chunks(self.catalog.entry(row)),source,digest)
                    self.catalog.verify_source(row)
                source.seek(0)
                size = dimensions(source,row['format'])
                check_dimensions(size)
                ext = row['format'] if row['format'] in NATIVE else 'png'
                target = self.directory / (digest.hexdigest()+'-full-v1.'+ext)
                if not target.is_file():
                    temp = target.with_name(target.name+'.'+uuid.uuid4().hex+'.partial')
                    try:
                        source.seek(0)
                        if row['format'] in NATIVE:
                            with temp.open('xb') as dest:
                                shutil.copyfileobj(source,dest,128*1024)
                        else:
                            try:
                                from PIL import Image
                            except ImportError:
                                raise ValueError('DDS/TGA 합성 입력 변환에는 Pillow가 필요합니다.')
                            with Image.open(source) as image:
                                image.convert('RGBA').save(temp,'PNG')
                        temp.replace(target)
                    finally:
                        temp.unlink(missing_ok=True)
            image_digest = hashlib.sha256()
            with target.open('rb') as stream:
                while block := stream.read(128*1024):
                    image_digest.update(block)
            if target.stat().st_size > MAX_BYTES:
                target.unlink(missing_ok=True)
                raise ValueError('변환된 합성 입력이 64 MiB를 초과했습니다.')
            target.touch()
            self.trim(target)
            metadata = dict(entry_id=row['id'],archive=row['archive'],ordinal=row['ordinal'],name=row['name'],
                            format=row['format'],source_sha256=digest.hexdigest(),image_sha256=image_digest.hexdigest(),
                            width=size[0],height=size[1],bytes=target.stat().st_size)
            return target,metadata

    @staticmethod
    def copy(blocks,dest,digest):
        size = 0
        for block in blocks:
            size += len(block)
            if size > MAX_BYTES:
                raise ValueError('합성 입력 파일은 64 MiB까지 지원합니다.')
            digest.update(block)
            dest.write(block)

    def trim(self,keep):
        files = sorted((p for p in self.directory.iterdir() if p.is_file() and not p.name.endswith('.partial')),
                       key=lambda p:p.stat().st_mtime)
        size = sum(p.stat().st_size for p in files)
        for path in files:
            if size <= CACHE_BYTES:
                break
            if path != keep:
                try:
                    length = path.stat().st_size
                    path.unlink()
                    size -= length
                except OSError:
                    pass


def resolve_sources(catalog,sources):
    if not isinstance(sources,list) or not 1 <= len(sources) <= 20:
        raise ValueError('조합 출처는 1~20개까지 지정해 주세요.')
    result = []
    with catalog.connect() as db:
        for source in sources:
            if (not isinstance(source,dict) or not isinstance(source.get('archive'),str)
                    or not isinstance(source.get('name'),str) or type(source.get('ordinal')) is not int
                    or source['ordinal'] < 0 or len(source['archive']) > 32768 or len(source['name']) > 4096):
                raise ValueError('조합 출처 정보가 올바르지 않습니다.')
            row = db.execute('''SELECT e.id FROM entries e JOIN archives a ON a.id=e.archive_id
                                WHERE a.path=? AND e.ordinal=? AND e.name=?''',
                             (source['archive'],source['ordinal'],source['name'])).fetchone()
            if row is None:
                raise ValueError(f"조합 원본을 찾을 수 없습니다: {source['name']} · {source['archive']}")
            result.append(row[0])
    return result
