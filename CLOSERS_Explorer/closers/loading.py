"""Source-verified loading frame definitions and named texture atlas regions."""
from contextlib import nullcontext
import hashlib
import math
from io import BytesIO
import re
import threading
from pathlib import Path

from . import ntf
from .cmf import Archive
from .lua_literals import tables
from .loading_particles import compile_particle, preview_passes, composite_preview
from .loading_cache import LoadingCache, stamp


class MissingDefinition(ValueError):
    pass


def region(value):
    lt, rt, lb, rb = (value[k] for k in ('m_LeftTop', 'm_RightTop', 'm_LeftBottom', 'm_RightBottom'))
    if lt[2] != rt[2] or lb[2] != rb[2] or lt[1] != lb[1] or rt[1] != rb[1]:
        raise ValueError('회전된 UV 영역은 지원하지 않습니다.')
    x, y, w, h = lt[1], lt[2], rt[1]-lt[1], lb[2]-lt[2]
    if not all(math.isfinite(v) for v in (x, y, w, h)) or min(w, h) <= 0:
        raise ValueError('UV 영역이 잘못되었습니다.')
    return dict(x=x, y=y, width=w, height=h)


def image_crop(crop, width, height):
    """Intersect game atlas bounds with the image, retaining the display rectangle."""
    x, y, w, h = (crop[k] for k in ('x', 'y', 'width', 'height'))
    if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in (x, y, w, h)) or min(w, h) <= 0:
        raise ValueError('게임 자르기 영역이 잘못되었습니다.')
    right, bottom = min(width, x+w), min(height, y+h)
    x, y = max(0, x), max(0, y)
    if right <= x or bottom <= y:
        raise ValueError('게임 자르기 영역이 원본 이미지와 겹치지 않습니다.')
    return dict(x=x, y=y, width=right-x, height=bottom-y)


class LoadingData:
    def __init__(self, catalog):
        self.catalog = catalog
        self.lock = threading.RLock()
        self.cache = {}
        self.keys = None
        self.parsed = {}
        self._derived = None
        self.thumbnail_locks = [threading.Lock() for _ in range(32)]
        self.thumbnail_gate = threading.BoundedSemaphore(2)
        self.key_source = None
        self.key_stamp = None
        self.name_cache = {}
        self.registry_cache = None

    @property
    def derived(self):
        # Lazy construction also keeps simple definition parsers independent of disk caches.
        if self._derived is not None:
            return self._derived
        with self.lock:
            if self._derived is None:
                self._derived = LoadingCache(self.catalog)
            return self._derived

    def cached(self, key, build, persistent=False):
        cache = self.derived
        found, value = cache.get(key, persistent)
        if found:
            return value
        # All definition builders take this lock before nested cache misses.
        with self.lock, self.session():
            found, value = cache.get(key, persistent)
            if found:
                return value
            with cache.capture() as record:
                value = build()
            return cache.put(key, value, record, persistent)

    def session(self):
        return nullcontext() if getattr(self.catalog.local,'db',None) is not None else self.catalog.session()

    def strings(self):
        return self.cached(('strings',), self._strings)

    def _strings(self):
        result = {}
        for name in ('STRING_TABLE_KOREA.NTF','STRING_TABLE_UI_KOREA.NTF',
                     'STRING_TABLE_ITEM_KOREA.NTF','STRING_TABLE_ITEM2_KOREA.NTF','STRING_TABLE_ITEM3_KOREA.NTF'):
            try: body = self.body(name)
            except MissingDefinition: continue
            digest = hashlib.sha256(body).digest()
            if digest not in self.name_cache:
                types, _, start = ntf.header(body)
                if types != (5,8,8): raise ValueError('지원하지 않는 게임 문자열 테이블입니다.')
                decoded = body[:start]+ntf.decrypt(body[start:],*self.keys)
                values = {}
                for _,key,value in ntf.rows(decoded):
                    if key.startswith(('ST_SKIN_NAME_','ST_FRAME_NAME_')):
                        values[key] = re.sub(r'#C(?:[0-9A-Fa-f]{6}|X)', '', value).strip()
                self.name_cache[digest] = values
            for key,value in self.name_cache[digest].items():
                if key in result and result[key] != value: raise ValueError('게임 이름 문자열이 충돌합니다: '+key)
                result[key] = value
        return result

    def layout(self):
        with self.lock,self.session():
            dialog = self.table('DLG_LOADING_DUNGEON_START_V2.LUA')['DIALOG']
            slot = next(v for v in dialog['CONTROL'].values() if v.get('m_Name')=='SLOT_1_INFO')
            pictures = list(slot['m_vecPicData'].values())
            illustration = next(p for p in pictures if p.get('UVKey')=='LOADING_DUNGEON')
            card = next(v for v in dialog['CONTROL'].values() if v.get('m_Name')=='SLOT_1_BG')
            def rect(value):
                pos = value.get('m_Pos', {})
                return dict(x=pos.get(1, 0), y=pos.get(2, 0), width=value['m_fWidth'], height=value['m_fHeight'])
            card_rect = rect(card)
            area = rect(illustration)
            area['x'] += slot.get('m_Pos', {}).get(1, 0)
            area['y'] += slot.get('m_Pos', {}).get(2, 0)
            return dict(width=illustration['m_fWidth'],height=illustration['m_fHeight'],
                uv=illustration['UVKey'],origin=illustration['m_Pos'],pictures=pictures,
                screen=dict(width=dialog['m_fWidth'],height=dialog['m_fHeight']),
                card=card_rect,area=area,cards=[rect(v) for v in dialog['CONTROL'].values()
                    if re.fullmatch(r'SLOT_\d+_BG', v.get('m_Name', ''))],
                source='DLG_LOADING_DUNGEON_START_V2.LUA',control=slot['m_Name'])

    def illustration_registry(self):
        return self.cached(('illustration-registry',), self._illustration_registry)

    def background(self, team=1):
        """Map the team's UV (or full texture) to the loading card rectangle."""
        names = {1: '검은양', 2: '늑대개', 3: '사냥터지기', 4: '시궁쥐'}
        if team not in names:
            raise ValueError('배경 팀은 1~4 중에서 선택해 주세요.')
        with self.lock, self.session():
            dialog = self.table('DLG_LOADING_DUNGEON_START_V2.LUA')['DIALOG']
            slot = next(v for v in dialog['CONTROL'].values() if v.get('m_Name') == 'SLOT_1_BG')
            picture = slot['m_vecPicData'][1]
            layout = self.layout()
            filename = f'UI_UNIT_CREATE_BG2_TEAM{team}.DDS'
            tet = str(Path(filename).with_suffix('.TET'))
            crop = self.atlas(filename).get(picture['UVKey']) if self.rows(tet) else None
            card_pos, picture_pos = slot.get('m_Pos', {}), picture.get('m_Pos', {})
            return dict(entry_id=self.image_id(filename), name='게임 기본 · '+names[team], team=team,
                crop=crop, fit='stretch',
                # RGB modulation follows the control color; final game shader behavior is unverified.
                color=[slot.get('m_BGColor', {}).get(i, 1) for i in range(1, 5)],
                x=card_pos.get(1, 0)+picture_pos.get(1, 0)-layout['area']['x'],
                y=card_pos.get(2, 0)+picture_pos.get(2, 0)-layout['area']['y'],
                width=picture['m_fWidth'], height=picture['m_fHeight'])

    def _illustration_registry(self):
        skin_body, convert_body = self.body('ILLUST_TEMPLET.NTF'), self.body('ILLUST_CONVERT_DATA.NTF')
        digest = hashlib.sha256(skin_body+convert_body).digest()
        if self.registry_cache and self.registry_cache[0]==digest: return self.registry_cache[1]
        skins = {}
        for row in ntf.rows(skin_body):
            if len(row)!=8: raise ValueError('지원하지 않는 일러스트 등록 테이블입니다.')
            skins[row[1]] = row
        result = {}
        for row in ntf.rows(convert_body):
            if len(row)!=4: raise ValueError('지원하지 않는 일러스트 변환 테이블입니다.')
            ident, character, kind, filename = row
            if kind!=3 or ident not in skins or not filename: continue
            if character!='GUST_INVALID' and character not in re.findall(r'GUST_USER_[A-Z]+',skins[ident][4]): continue
            key = filename.upper()
            value = dict(illust_id=ident,character=character,string_key=skins[ident][6])
            if value not in result.setdefault(key,[]): result[key].append(value)
        self.registry_cache = digest,result
        return result

    def illustration_plan(self, entry_id):
        with self.lock,self.session():
            row = self.catalog.get_resource(entry_id)
            self.derived.watch(row['archive'])
            registered = self.illustration_registry().get(row['name'].upper())
            if not registered: raise ValueError('게임에 등록된 로딩 일러스트가 아닙니다.')
            self.catalog.verify_source(row)
            layout = self.layout(); names = self.strings()
            labels = list(dict.fromkeys(names[v['string_key']] for v in registered if names.get(v['string_key'])))
            crop = self.atlas(row['name'])[layout['uv']]
            layer = dict(entry_id=entry_id,name=' / '.join(labels) or row['name'],role='illustration',
                crop=crop,x=0,y=0,width=layout['width'],height=layout['height'],gameIllustration=True)
            return dict(width=layout['width'],height=layout['height'],layers=[layer],effects=[],warnings=[])

    def table(self, name):
        body = self.body(name)
        digest = hashlib.sha256(body).digest()
        if digest not in self.parsed: self.parsed[digest] = tables(body)
        return self.parsed[digest]

    def rows(self, name):
        with self.catalog.connect() as db:
            rows = [dict(r) for r in db.execute('''SELECT e.*,a.path archive,a.size archive_size,a.mtime archive_mtime
                FROM entries e JOIN archives a ON a.id=e.archive_id WHERE e.name=? COLLATE NOCASE ORDER BY e.id''', (name,))]
        for row in rows:
            self.derived.watch(row['archive'])
        return rows

    def body(self, name):
        if self.key_source:
            self.derived.watch(self.key_source)
            if stamp(self.key_source) != self.key_stamp:
                self.keys = None
                self.cache.clear()
                self.parsed.clear()
                self.name_cache.clear()
                self.registry_cache = None
        rows = self.rows(name)
        if not rows:
            raise MissingDefinition('게임 정의를 찾을 수 없습니다: '+name)
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
                    self.key_source = candidates.pop()
                    self.derived.watch(self.key_source)
                    self.keys = ntf.script_keys(self.key_source)
                    self.key_stamp = stamp(self.key_source)
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
        with self.lock,self.session():
            return {v['m_Key']: region(v) for v in self.table(tet)['TEXTURE_UV'].values()}

    def effects(self, preset, preview=False):
        """Preserve particle emitters, ranges and event tracks for timed rendering."""
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
        image_ids = {}
        def resolve(name):
            if name.upper() not in image_ids: image_ids[name.upper()] = self.image_id(name)
            return image_ids[name.upper()]
        for i, name in enumerate(names):
            try:
                seq = sequences[name]
                events = list(seq['m_vecEventList'].values())
                ev = {e[2]: e for e in events if e[1]=='PCET_INITIAL'}
                pos, factor = positions[i], scales[i]
                frames = animations[ev['PCET_TEX_ANIM']['STR']]['m_vecFrame'].values() if 'PCET_TEX_ANIM' in ev else [dict(m_TexName=ev['PCET_TEXTURE']['STR'], m_fTime=1)]
                if preview: frames = list(frames)[:1]
                frames = [dict(entry_id=resolve(f['m_TexName']), duration=f['m_fTime']) for f in frames]
                if not 1 <= len(frames) <= 120 or any(not 0 < f['duration'] <= 60 for f in frames):
                    raise ValueError('텍스처 재생 시간 범위 초과')
                particle, width, height, color = compile_particle(seq, factor,
                    int.from_bytes(hashlib.sha256(name.encode()).digest()[:4], 'little'), resolve)
                result.append(dict(name=name, role='fragment', x=pos[0]-width/2, y=pos[1]-height/2,
                    width=width, height=height, frames=frames, color=color, particle=particle,
                    delay=seq.get('m_fLatencyTime', 0), blend='lighter' if seq.get('m_DestBlend') in ('CON_D3DBLEND_ONE','CON_D3DBLEND_DESTALPHA') else 'source-over',
                    order=seq.get('m_Layer','ROL_EFFECT_1')))
            except (ValueError, KeyError, IndexError, TypeError) as exc:
                warnings.append(name+' · '+str(exc))
        return sorted(result, key=lambda e:e['order']), warnings

    def presets(self):
        return self.cached(('presets',), self._presets, persistent=True)

    def _presets(self):
        with self.lock,self.session():
            names = self.strings()
            result = {}
            for v in ntf.rows(self.body('FRAME_TEMPLET.NTF')):
                if len(v) != 28: raise ValueError('지원하지 않는 프레임 테이블입니다.')
                result[v[0]] = dict(id=v[0], name=v[3], image=v[5], top=v[6], bottom=v[7],
                    effects=v[8], mark=v[9], mark_key=v[10], mark_effects=v[11], positions=v[22], scales=v[23])
            for v in ntf.rows(self.body('VISUAL_FRAME_TEMPLET.NTF')):
                if len(v) != 23: raise ValueError('지원하지 않는 비주얼 프레임 테이블입니다.')
                result[v[1]] = dict(id=v[1], name=v[6], image=v[8], top=v[9], bottom=v[10],
                    effects=v[11], mark=v[12], mark_key=v[13], mark_effects=v[14], positions=v[17], scales=v[18])
            for value in result.values(): value['display_name'] = names.get(value['name'],'')
            return list(result.values())

    def image_id(self, name):
        return self.cached(('image-id', name.upper()), lambda: self._image_id(name))

    def _image_id(self, name):
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
        with self.lock, self.session():
            return self._plan(ident, mark_only=mark_only)

    def _plan(self, ident, preview=False, mark_only=False):
        preset = next((p for p in self.presets() if p['id'] == ident), None)
        if preset is None: raise ValueError('프레임 등록 번호가 없습니다.')
        with self.lock,self.session():
            layout = self.layout(); pictures = layout['pictures']
            illustration = next(p for p in pictures if p.get('UVKey') == 'LOADING_DUNGEON')
            if mark_only:
                if not preset['mark'] or not preset['mark_key']: raise ValueError('등록된 마크가 없습니다.')
                placement = next((p for p in pictures if p.get('TexName','').upper()==preset['mark'].upper() and p.get('UVKey')==preset['mark_key']),None)
                rect = dict(x=placement.get('m_Pos',{}).get(1,0)-layout['origin'][1],y=placement.get('m_Pos',{}).get(2,0)-layout['origin'][2],
                    width=placement['m_fWidth'],height=placement['m_fHeight']) if placement else None
                count = len(re.findall(r'"([A-Z0-9_]+)"',preset.get('mark_effects','')))
                effects, warnings = self.effects(dict(effects=preset.get('mark_effects',''),
                    positions='{0,0},'*count,scales='{1,1},'*count),preview=preview) if count and not preview else ([],[])
                return dict(preset=preset, width=illustration['m_fWidth'], height=illustration['m_fHeight'], layers=[], effects=effects, warnings=warnings,
                    mark=dict(entry_id=self.image_id(preset['mark']), key=preset['mark_key'], crop=self.atlas(preset['mark'])[preset['mark_key']],placement=rect))
            origin = illustration['m_Pos']
            atlas = self.atlas(preset['image']) if preset['image'] else {}
            entry = self.image_id(preset['image']) if preset['image'] else None
            layers = []
            for key, uv in [('TOP', preset['top']), ('BOT', preset['bottom'])]:
                if not uv or not preset['image']: continue
                placement = next(p for p in pictures if p.get('UVKey') == key)
                layers.append(dict(entry_id=entry, name=(preset.get('display_name') or preset['image'])+' · '+uv, role='frame', crop=atlas[uv],
                    x=placement['m_Pos'][1]-origin[1], y=placement['m_Pos'][2]-origin[2],
                    width=placement['m_fWidth'], height=placement['m_fHeight']))
            effects, warnings = self.effects(preset, preview=preview)
            return dict(preset=preset, width=illustration['m_fWidth'], height=illustration['m_fHeight'], layers=layers, effects=effects,
                mark=dict(entry_id=self.image_id(preset['mark']), key=preset['mark_key'],
                          crop=self.atlas(preset['mark'])[preset['mark_key']]) if not preview and preset['mark'] and preset['mark_key'] else None,
                warnings=warnings)

    def thumbnail(self, ident, kind, composition):
        if kind not in ('frame', 'mark','illustration'): raise ValueError('썸네일 종류가 올바르지 않습니다.')
        key = ('thumbnail', kind, ident)
        cache = self.derived
        found, value = cache.get(key, persistent=True)
        if found:
            return value
        # Cache hits bypass both the generation queue and the shared definition lock.
        gate = self.thumbnail_locks[int(hashlib.sha256(repr(key).encode()).hexdigest(),16) % len(self.thumbnail_locks)]
        with gate, self.thumbnail_gate:
            found, value = cache.get(key, persistent=True)
            if found:
                return value
            with cache.capture() as record:
                value = self._thumbnail(ident, kind, composition)
            return cache.put(key, value, record, persistent=True)

    def _thumbnail(self, ident, kind, composition):
        try:
            from PIL import Image, ImageChops
        except ImportError as exc:
            raise ValueError('프레임·마크 썸네일에는 Pillow가 필요합니다.') from exc
        with self.lock, self.session():
            plan = self.illustration_plan(ident) if kind=='illustration' else self._plan(ident, preview=True, mark_only=kind=='mark')
        # Pixel preparation/rendering does not hold the definition lock: lists remain responsive.
        return self.render_thumbnail(plan, kind, composition)

    def render_thumbnail(self, plan, kind, composition):
        from PIL import Image, ImageChops
        with self.session():
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
                entries = [layer.get('entry_id') or layer['frames'][0]['entry_id']]
                if layer.get('particle',{}).get('mask_entry_id'): entries.append(layer['particle']['mask_entry_id'])
                for entry in entries:
                    if entry not in prepared:
                        row = self.catalog.get_resource(entry)
                        self.derived.watch(row['archive'])
                        if row.get('output'):
                            self.derived.watch(row['output'])
                        prepared[entry] = composition.prepare(entry)
            scale = min(128/width,128/height) if kind=='mark' else min(144/width,205/height)
            canvas = Image.new('RGBA', (max(1,round(width*scale)), max(1,round(height*scale))))
            for layer in layers:
                entry = layer.get('entry_id') or layer['frames'][0]['entry_id']
                path, metadata = prepared[entry]
                crop = layer.get('crop') or dict(x=0,y=0,width=metadata['width'],height=metadata['height'])
                crop = image_crop(crop, metadata['width'], metadata['height'])
                with Image.open(path) as source:
                    image = source.convert('RGBA').crop((crop['x'],crop['y'],crop['x']+crop['width'],crop['y']+crop['height']))
                mask_entry = layer.get('particle',{}).get('mask_entry_id')
                if mask_entry:
                    with Image.open(prepared[mask_entry][0]) as mask:
                        image = ImageChops.multiply(image,mask.convert('RGBA').resize(image.size,Image.Resampling.BILINEAR))
                image = image.resize((max(1,round(layer['width']*scale)),max(1,round(layer['height']*scale))),Image.Resampling.LANCZOS)
                for color,blend,count in preview_passes(layer):
                    tinted = Image.merge('RGBA', [channel.point([round(n*factor) for n in range(256)]) for channel,factor in zip(image.split(),color)])
                    overlay = Image.new('RGBA',canvas.size)
                    overlay.paste(tinted,(round(layer['x']*scale),round(layer['y']*scale)))
                    for _ in range(count): canvas = composite_preview(canvas,overlay,blend)
            output = BytesIO();canvas.save(output,'PNG');body = output.getvalue()
            return body

    def illustrations(self, query='', page=1):
        resources = self.cached(('illustrations',), self._illustration_items, persistent=True)
        text = query.casefold()
        items = [item for item in resources if text in ' '.join([item['name'],item['display_name'],item['character']]).casefold()]
        page=max(1,min(int(page),max(1,(len(items)+11)//12)))
        return dict(items=items[(page-1)*12:page*12],total=len(items),page=page)

    def _illustration_items(self):
        from .model_groups import CHARACTERS
        with self.lock,self.session():
            registry, names = self.illustration_registry(), self.strings()
            filenames = list(registry); resources = []
            with self.catalog.connect() as db:
                for offset in range(0,len(filenames),400):
                    batch = filenames[offset:offset+400]
                    resources.extend(dict(r) for r in db.execute(
                        "SELECT min(id) id,name FROM entries WHERE category='images' AND name COLLATE NOCASE IN ("+
                        ','.join('?' for _ in batch)+") GROUP BY name COLLATE NOCASE",batch))
            items = []
            for resource in resources:
                registered = registry[resource['name'].upper()]
                labels = list(dict.fromkeys(names[v['string_key']] for v in registered if names.get(v['string_key'])))
                characters = list(dict.fromkeys(CHARACTERS.get(v['character'].removeprefix('GUST_USER_'),v['character']) for v in registered))
                resource.update(display_name=' / '.join(labels),character=' / '.join(characters),illust_ids=[v['illust_id'] for v in registered])
                items.append(resource)
            items.sort(key=lambda v:(v['display_name'] or v['name'],v['character'],v['id']))
            return items
