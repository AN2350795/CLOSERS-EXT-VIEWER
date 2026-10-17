"""Source-verified loading frame definitions and named texture atlas regions."""
import hashlib
import re
import threading
from pathlib import Path

from . import ntf
from .cmf import Archive
from .lua_literals import tables


def region(value):
    lt, rt, lb, rb = (value[k] for k in ('m_LeftTop', 'm_RightTop', 'm_LeftBottom', 'm_RightBottom'))
    if lt[2] != rt[2] or lb[2] != rb[2] or lt[1] != lb[1] or rt[1] != rb[1]:
        raise ValueError('회전된 UV 영역은 지원하지 않습니다.')
    x, y, w, h = lt[1], lt[2], rt[1]-lt[1], lb[2]-lt[2]
    if min(x, y) < 0 or min(w, h) <= 0:
        raise ValueError('UV 영역이 잘못되었습니다.')
    return dict(x=x, y=y, width=w, height=h)


class LoadingData:
    def __init__(self, catalog):
        self.catalog = catalog
        self.lock = threading.RLock()
        self.cache = {}
        self.keys = None

    def rows(self, name):
        with self.catalog.connect() as db:
            return [dict(r) for r in db.execute('''SELECT e.*,a.path archive,a.size archive_size,a.mtime archive_mtime
                FROM entries e JOIN archives a ON a.id=e.archive_id WHERE e.name=? COLLATE NOCASE ORDER BY e.id''', (name,))]

    def body(self, name):
        rows = self.rows(name)
        if not rows:
            raise ValueError('게임 정의를 찾을 수 없습니다: '+name)
        bodies = {}
        for row in rows:
            self.catalog.verify_source(row)
            key = (row['archive'], row['ordinal'], row['archive_size'], row['archive_mtime'])
            if key not in self.cache:
                with Archive(row['archive']) as archive:
                    entry = next((e for e in archive.entries() if e.index == row['ordinal']), None)
                    if entry != self.catalog.entry(row):
                        raise ValueError('게임 정의 목록이 원본과 다릅니다. 다시 분석해 주세요.')
                    stored = b''.join(archive.stored_chunks(entry))
                if self.keys is None:
                    candidates = set()
                    for source in rows:
                        folder = Path(source['archive']).parent
                        for parent in [folder, *list(folder.parents)[:3]]:
                            if (parent/'CW.EXE').is_file(): candidates.add(parent/'CW.EXE')
                    if len(candidates) != 1: raise ValueError('게임 정의 복원에 필요한 CW.EXE를 찾을 수 없습니다.')
                    self.keys = ntf.script_keys(candidates.pop())
                body = ntf.restore(stored, entry.size, *self.keys)
                self.catalog.verify_source(row)
                self.cache[key] = body
            body = self.cache[key]
            bodies[hashlib.sha256(body).hexdigest()] = body
        if len(bodies) != 1:
            raise ValueError('서로 다른 게임 정의가 있습니다. 작업 공간에서 원본을 구분해 주세요: '+name)
        return next(iter(bodies.values()))

    def atlas(self, name):
        tet = str(Path(name).with_suffix('.TET'))
        with self.lock:
            return {v['m_Key']: region(v) for v in tables(self.body(tet))['TEXTURE_UV'].values()}

    def presets(self):
        with self.lock:
            result = {}
            for v in ntf.rows(self.body('FRAME_TEMPLET.NTF')):
                if len(v) != 28: raise ValueError('지원하지 않는 프레임 테이블입니다.')
                result[v[0]] = dict(id=v[0], name=v[3], image=v[5], top=v[6], bottom=v[7],
                    effects=v[8], mark=v[9], mark_key=v[10], mark_effects=v[11], positions=v[22], scales=v[23])
            for v in ntf.rows(self.body('VISUAL_FRAME_TEMPLET.NTF')):
                if len(v) != 23: raise ValueError('지원하지 않는 비주얼 프레임 테이블입니다.')
                result[v[1]] = dict(id=v[1], name=v[6], image=v[8], top=v[9], bottom=v[10],
                    effects=v[11], mark=v[12], mark_key=v[13], mark_effects=v[14], positions=v[17], scales=v[18])
            return list(result.values())

    def image_id(self, name):
        rows = self.rows(name)
        if not rows: raise ValueError('연결된 이미지를 찾을 수 없습니다: '+name)
        # Images with the same name must have identical source content.
        digests = set()
        for row in rows:
            self.catalog.verify_source(row)
            with Archive(row['archive']) as archive:
                digests.add(hashlib.sha256(b''.join(archive.chunks(self.catalog.entry(row)))).digest())
        if len(digests) != 1: raise ValueError('서로 다른 이미지 출처가 있습니다: '+name)
        return rows[0]['id']

    def plan(self, ident):
        preset = next((p for p in self.presets() if p['id'] == ident), None)
        if preset is None: raise ValueError('프레임 등록 번호가 없습니다.')
        with self.lock:
            dialog = tables(self.body('DLG_LOADING_DUNGEON_START_V2.LUA'))['DIALOG']
            slot = next(v for v in dialog['CONTROL'].values() if v.get('m_Name') == 'SLOT_1_INFO')
            pictures = list(slot['m_vecPicData'].values())
            illustration = next(p for p in pictures if p.get('UVKey') == 'LOADING_DUNGEON')
            origin = illustration['m_Pos']
            atlas = self.atlas(preset['image'])
            entry = self.image_id(preset['image'])
            layers = []
            for key, uv in [('TOP', preset['top']), ('BOT', preset['bottom'])]:
                if not uv: continue
                placement = next(p for p in pictures if p.get('UVKey') == key)
                layers.append(dict(entry_id=entry, name=preset['image']+' · '+uv, role='frame', crop=atlas[uv],
                    x=placement['m_Pos'][1]-origin[1], y=placement['m_Pos'][2]-origin[2],
                    width=placement['m_fWidth'], height=placement['m_fHeight']))
            return dict(preset=preset, width=illustration['m_fWidth'], height=illustration['m_fHeight'], layers=layers,
                mark=dict(entry_id=self.image_id(preset['mark']), key=preset['mark_key'],
                          crop=self.atlas(preset['mark'])[preset['mark_key']]) if preset['mark'] and preset['mark_key'] else None,
                warnings=['별도 파티클 효과가 등록된 프레임입니다.'] if preset['effects'].strip() else [])
