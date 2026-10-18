"""Source-verified loading frame definitions and named texture atlas regions."""
import hashlib
from collections import OrderedDict
from io import BytesIO
import json
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
        self.parsed = {}
        self.thumbnails = OrderedDict()

    def table(self, name):
        body = self.body(name)
        digest = hashlib.sha256(body).digest()
        if digest not in self.parsed: self.parsed[digest] = tables(body)
        return self.parsed[digest]

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
            return {v['m_Key']: region(v) for v in self.table(tet)['TEXTURE_UV'].values()}

    def effects(self, preset, preview=False):
        """Compile single-plane texture sequences; report every unhandled effect."""
        names = re.findall(r'"([A-Z0-9_]+)"', preset['effects'])
        if not names: return [], []
        sequences = {}
        for name in ('PARTICLE_SYSTEM_UI.LUA', 'PARTICLE_SYSTEM_UI_2.LUA', 'PARTICLE_SYSTEM_UI_3.LUA'):
            sequences.update({v['m_SeqName']: v for v in self.table(name)['PARTICLE_SYSTEM'].values()})
        animations = {v['m_AnimName']: v for v in self.table('TEX_ANIM_DATA.LUA')['m_mapTexAnimData'].values()}
        def pairs(raw):
            return [tuple(map(float, p)) for p in re.findall(r'\{\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\}', raw)]
        positions, scales = pairs(preset['positions']), pairs(preset['scales'])
        result, warnings = [], []
        for i, name in enumerate(names):
            try:
                seq = sequences[name]
                events = list(seq['m_vecEventList'].values())
                allowed = {'PCET_TEXTURE', 'PCET_TEX_ANIM', 'PCET_COLOR', 'PCET_SIZE', 'PCET_SCALE'}
                if (seq.get('m_ParticleType') != 'PCT_2D_PLANE' or seq.get('m_iMaxParticleNum', 1) != 1
                        or seq.get('m_LifeTime', 0) < 60 or seq.get('m_DrawCount', 1) != 1
                        or any(v != 0 for v in seq.get('m_EmitRadius', {}).values())
                        or any(e.get(1) != 'PCET_INITIAL' or e.get(2) not in allowed for e in events)
                        or seq.get('m_bDualBlending') == 'TRUE' or seq.get('m_MaskTexName')
                        or seq.get('m_SrcBlend') != 'CON_D3DBLEND_SRCALPHA'
                        or seq.get('m_DestBlend') not in ('CON_D3DBLEND_INVSRCALPHA', 'CON_D3DBLEND_ONE')):
                    raise ValueError('추가 파티클·셰이더 규칙 필요')
                ev = {e[2]: e for e in events}
                size = ev['PCET_SIZE']['XYZ']
                scale = ev.get('PCET_SCALE', {}).get('VAL', 1)
                rgba = ev.get('PCET_COLOR', {}).get('RGBA', {1:1,2:1,3:1,4:1})
                color = [rgba[n] for n in range(1,5)]
                if not all(type(v) in (int,float) and 0 <= v <= 1 for v in color):
                    raise ValueError('확률 색상 필요')
                pos, factor = positions[i], scales[i]
                width, height = size[1]*scale*factor[0], size[2]*scale*factor[1]
                frames = animations[ev['PCET_TEX_ANIM']['STR']]['m_vecFrame'].values() if 'PCET_TEX_ANIM' in ev else [dict(m_TexName=ev['PCET_TEXTURE']['STR'], m_fTime=1)]
                if preview: frames = list(frames)[:1]
                frames = [dict(entry_id=self.image_id(f['m_TexName']), duration=f['m_fTime']) for f in frames]
                if not 1 <= len(frames) <= 120 or any(not 0 < f['duration'] <= 60 for f in frames):
                    raise ValueError('텍스처 재생 시간 범위 초과')
                result.append(dict(name=name, role='fragment', x=pos[0]-width/2, y=pos[1]-height/2,
                    width=width, height=height, frames=frames, color=color,
                    delay=seq.get('m_fLatencyTime', 0), blend='lighter' if seq['m_DestBlend']=='CON_D3DBLEND_ONE' else 'source-over',
                    order=seq.get('m_Layer','ROL_EFFECT_1')))
            except (ValueError, KeyError, IndexError, TypeError) as exc:
                warnings.append(name+' · '+str(exc))
        return sorted(result, key=lambda e:e['order']), warnings

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

    def plan(self, ident, mark_only=False):
        with self.lock, self.catalog.session():
            return self._plan(ident, mark_only=mark_only)

    def _plan(self, ident, preview=False, mark_only=False):
        preset = next((p for p in self.presets() if p['id'] == ident), None)
        if preset is None: raise ValueError('프레임 등록 번호가 없습니다.')
        with self.lock:
            dialog = tables(self.body('DLG_LOADING_DUNGEON_START_V2.LUA'))['DIALOG']
            slot = next(v for v in dialog['CONTROL'].values() if v.get('m_Name') == 'SLOT_1_INFO')
            pictures = list(slot['m_vecPicData'].values())
            illustration = next(p for p in pictures if p.get('UVKey') == 'LOADING_DUNGEON')
            if mark_only:
                if not preset['mark'] or not preset['mark_key']: raise ValueError('등록된 마크가 없습니다.')
                return dict(preset=preset, width=illustration['m_fWidth'], height=illustration['m_fHeight'], layers=[], effects=[], warnings=[],
                    mark=dict(entry_id=self.image_id(preset['mark']), key=preset['mark_key'], crop=self.atlas(preset['mark'])[preset['mark_key']]))
            origin = illustration['m_Pos']
            atlas = self.atlas(preset['image']) if preset['image'] else {}
            entry = self.image_id(preset['image']) if preset['image'] else None
            layers = []
            for key, uv in [('TOP', preset['top']), ('BOT', preset['bottom'])]:
                if not uv or not preset['image']: continue
                placement = next(p for p in pictures if p.get('UVKey') == key)
                layers.append(dict(entry_id=entry, name=preset['image']+' · '+uv, role='frame', crop=atlas[uv],
                    x=placement['m_Pos'][1]-origin[1], y=placement['m_Pos'][2]-origin[2],
                    width=placement['m_fWidth'], height=placement['m_fHeight']))
            effects, warnings = self.effects(preset, preview=preview)
            return dict(preset=preset, width=illustration['m_fWidth'], height=illustration['m_fHeight'], layers=layers, effects=effects,
                mark=dict(entry_id=self.image_id(preset['mark']), key=preset['mark_key'],
                          crop=self.atlas(preset['mark'])[preset['mark_key']]) if not preview and preset['mark'] and preset['mark_key'] else None,
                warnings=warnings)

    def thumbnail(self, ident, kind, composition):
        if kind not in ('frame', 'mark'): raise ValueError('썸네일 종류가 올바르지 않습니다.')
        try:
            from PIL import Image, ImageChops
        except ImportError as exc:
            raise ValueError('프레임·마크 썸네일에는 Pillow가 필요합니다.') from exc
        with self.lock, self.catalog.session():
            plan = self._plan(ident, preview=True, mark_only=kind=='mark')
            if kind == 'mark':
                mark = plan['mark']; crop = mark['crop']
                width, height = crop['width'], crop['height']
                layers = [dict(entry_id=mark['entry_id'], crop=crop, x=0, y=0, width=width, height=height)]
            else:
                width, height = plan['width'], plan['height']
                layers = plan['layers']+plan['effects']
            if not layers: raise ValueError('미리볼 수 있는 이미지가 없습니다.')
            prepared = {}
            for layer in layers:
                entry = layer.get('entry_id') or layer['frames'][0]['entry_id']
                if entry not in prepared: prepared[entry] = composition.prepare(entry)
            fingerprint = hashlib.sha256(json.dumps([kind, layers, [m['image_sha256'] for _,m in prepared.values()]],sort_keys=True).encode()).digest()
            if fingerprint in self.thumbnails:
                self.thumbnails.move_to_end(fingerprint)
                return self.thumbnails[fingerprint]
            scale = min(144/width, 205/height) if kind == 'frame' else min(128/width, 128/height)
            canvas = Image.new('RGBA', (max(1,round(width*scale)), max(1,round(height*scale))))
            for layer in layers:
                entry = layer.get('entry_id') or layer['frames'][0]['entry_id']
                path, metadata = prepared[entry]
                crop = layer.get('crop') or dict(x=0,y=0,width=metadata['width'],height=metadata['height'])
                with Image.open(path) as source:
                    image = source.convert('RGBA').crop((crop['x'],crop['y'],crop['x']+crop['width'],crop['y']+crop['height']))
                image = image.resize((max(1,round(layer['width']*scale)),max(1,round(layer['height']*scale))),Image.Resampling.LANCZOS)
                if 'color' in layer:
                    image = Image.merge('RGBA', [channel.point([round(n*factor) for n in range(256)]) for channel,factor in zip(image.split(),layer['color'])])
                overlay = Image.new('RGBA',canvas.size)
                overlay.paste(image,(round(layer['x']*scale),round(layer['y']*scale)))
                canvas = ImageChops.add(canvas,overlay) if layer.get('blend')=='lighter' else Image.alpha_composite(canvas,overlay)
            output = BytesIO();canvas.save(output,'PNG');body = output.getvalue()
            self.thumbnails[fingerprint] = body
            while len(self.thumbnails)>128: self.thumbnails.popitem(last=False)
            return body

    def illustrations(self, query='', page=1):
        page = max(1,int(page)); limit = 12
        query = query.replace('\\','\\\\').replace('%','\\%').replace('_','\\_')[:200]
        with self.catalog.connect() as db:
            base = '''FROM entries e WHERE e.category='images' AND e.name LIKE 'DLG_PVP_LOADING%'
                AND e.name LIKE ? ESCAPE '\\' '''
            grouped = ' GROUP BY e.name,e.sha256,CASE WHEN e.sha256 IS NULL THEN e.id ELSE 0 END'
            total = db.execute('SELECT count(*) FROM (SELECT min(e.id) '+base+grouped+')',('%'+query+'%',)).fetchone()[0]
            items = db.execute('SELECT min(e.id) id,e.name '+base+grouped+' ORDER BY e.name,e.id LIMIT ? OFFSET ?',('%'+query+'%',limit,(page-1)*limit)).fetchall()
            return dict(items=[dict(r) for r in items], total=total, page=page)
