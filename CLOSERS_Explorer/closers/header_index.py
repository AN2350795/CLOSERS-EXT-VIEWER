"""HEADER.CMF directory: count, then CMF tables + opaque tag + archive number.

There are no resource payloads in this layout. Entry offsets refer to external
CMFs, not to this file. The trailer tag's meaning is deliberately left unknown.
"""
from dataclasses import dataclass
import json
import os
from pathlib import Path
import re
import sqlite3
import struct
import time

from .cmf import Entry, FormatError, LEGACY_KEYS, check_cancel, decode


@dataclass(frozen=True)
class IndexRecord:
    number: int
    archive_number: int
    version: int
    count: int
    table_offset: int
    tag: int

    @property
    def relative_archive(self):
        return f'DAT{self.archive_number // 500}/DAT{self.archive_number}.CMF'


class HeaderIndex:
    def __init__(self, path):
        self.path = Path(path)
        self.file = self.path.open('rb')
        try:
            self.stat = os.fstat(self.file.fileno())
            raw = self.file.read(4)
            if len(raw) != 4:
                raise FormatError('인덱스 개수 필드가 잘렸습니다.')
            self.count = struct.unpack('<I', raw)[0]
            if not self.count or self.count > (self.stat.st_size - 4) // 112:
                raise FormatError('인덱스 개수 또는 최소 기록 범위가 잘못되었습니다.')
        except BaseException:
            self.file.close()
            raise

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.file.close()

    def verify(self):
        current = self.path.stat()
        opened = os.fstat(self.file.fileno())
        expected = (self.stat.st_size, self.stat.st_mtime_ns)
        if any((s.st_size, s.st_mtime_ns) != expected for s in (current, opened)):
            raise FormatError('인덱스를 읽는 동안 원본이 변경되었습니다.')

    def records(self, cancel=None):
        offset = 4
        for number in range(self.count):
            check_cancel(cancel)
            self.file.seek(offset)
            header = self.file.read(104)
            if len(header) != 104:
                raise FormatError('내장 CMF 헤더가 잘렸습니다.')
            signature = header[:100].decode('utf-16-le').split('\0')[0]
            match = re.fullmatch(r'COMBINE FILE ver\.(\d+)', signature)
            version = 1 if signature == 'COMBINE FILE ver. 1.0' else int(match[1]) if match else 0
            if version not in range(1, 11):
                raise FormatError(f'미지원 인덱스 내장 서명: {signature!r}')
            count = struct.unpack('<I', decode(header[100:]))[0]
            table_offset = offset + 104
            trailer = table_offset + count * 528
            if trailer + 8 > self.stat.st_size:
                raise FormatError('인덱스 목록 범위가 원본을 벗어납니다.')
            self.file.seek(trailer)
            tag, archive_number = struct.unpack('<II', self.file.read(8))
            offset = trailer + 8
            yield IndexRecord(number, archive_number, version, count, table_offset, tag)
        if offset != self.stat.st_size:
            raise FormatError('선언된 기록 뒤에 미해석 인덱스 데이터가 남았습니다.')
        self.verify()

    def entries(self, record, cancel=None):
        # HEADER tables use the legacy keys even when the referenced CMF uses
        # a modern version/key set (verified against installed DAT0/DAT1.CMF).
        keys = LEGACY_KEYS
        for number in range(record.count):
            check_cancel(cancel)
            self.file.seek(record.table_offset + number * 528)
            raw = self.file.read(528)
            if len(raw) != 528:
                raise FormatError('내장 목록이 잘렸습니다.')
            data = decode(raw, keys)
            # Padding after the aligned UTF-16 NUL is not part of the name.
            end = next((i for i in range(0, 512, 2) if data[i:i+2] == b'\0\0'), 512)
            name = data[:end].decode('utf-16-le')
            if not name or any(ord(c) < 32 for c in name):
                raise FormatError('인덱스 파일명을 해석하지 못했습니다.')
            size, compressed, offset, flag = struct.unpack('<4I', data[512:])
            if flag not in (0, 1, 2):
                raise FormatError(f'미지원 인덱스 저장 플래그 {flag}')
            stored = compressed if flag == 1 or (flag == 2 and compressed) else size
            yield Entry(number, name, size, stored, offset, flag)


def index_summary(path, cancel=None):
    with HeaderIndex(path) as index:
        entries = 0
        for record in index.records(cancel):
            entries += record.count
        return dict(archives=index.count, entries=entries)


def export_index(path, destination, cancel=None, progress=lambda **kw: None):
    """New, independent database. A failed export remains visibly incomplete."""
    started = time.monotonic()
    destination = Path(destination).resolve()
    destination.mkdir(parents=True, exist_ok=False)
    partial = destination / 'index.sqlite3.partial'
    db = sqlite3.connect(partial)
    archives = entries = 0
    try:
        db.executescript('''
            CREATE TABLE archives(number INTEGER PRIMARY KEY,archive_number INTEGER UNIQUE,version INTEGER,
                                  count INTEGER,table_offset INTEGER,opaque_tag INTEGER,relative_archive TEXT);
            CREATE TABLE entries(archive_record INTEGER,ordinal INTEGER,name TEXT,unpacked_size INTEGER,
                                 stored_size INTEGER,relative_offset INTEGER,flag INTEGER,PRIMARY KEY(archive_record,ordinal));
        ''')
        with HeaderIndex(path) as index:
            source_size, source_mtime = index.stat.st_size, index.stat.st_mtime_ns
            for record in index.records(cancel):
                db.execute('INSERT INTO archives VALUES(?,?,?,?,?,?,?)',
                           (record.number,record.archive_number,record.version,record.count,record.table_offset,
                            record.tag,record.relative_archive))
                db.executemany('INSERT INTO entries VALUES(?,?,?,?,?,?,?)',
                               ((record.number,e.index,e.name,e.size,e.stored,e.offset,e.flag)
                                for e in index.entries(record, cancel)))
                archives += 1
                entries += record.count
                if archives % 500 == 0:
                    db.commit()
                    progress(phase='index',done=archives,total=index.count,current=str(path),entries=entries)
            index.verify()
        db.commit()
    finally:
        db.close()
    partial.rename(destination / 'index.sqlite3')
    result = dict(source=str(Path(path).resolve()), source_size=source_size,source_mtime_ns=source_mtime,
                  archive_records=archives,entry_descriptors=entries,status='index_exported',
                  payload_files=0,tag_meaning='unknown',
                  elapsed_seconds=round(time.monotonic()-started,3),
                  archive_path_rule='Candidate: DAT{archive_number // 500}/DAT{archive_number}.CMF. Validate the external CMF before reading payload.',
                  note='Metadata only. Resource bodies are in external CMFs. No script decryption performed.')
    (destination / 'index-summary.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    progress(phase='index',done=archives,total=archives,current=str(path),entries=entries)
    return result
