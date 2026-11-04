"""Local, source-attributed item names; resource filenames remain unchanged."""
from collections import defaultdict
from contextlib import closing
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import struct
import threading
import uuid

from . import ntf
from .motion_converts import SOURCES as CONVERSION_SOURCES

INDEX_VERSION=1


class GameNames:
    def __init__(self,workspace):
        self.path=Path(workspace)/'game-names.sqlite3'
        self.lock=threading.RLock()
        self.version=None
        self.file_version=None
        self.sources=[]
        self.labels={}
        self.model_rules={}
        self.frame_patterns=[]
        self.icons={}
        self.part_overrides={}
        self.motion_names={}
        self.motion_sequences={}
        self.motion_extras={};self.motion_particles={}
        self.texture_animations={};self.motion_conversions={}
        self.sequence_index_available=False
        self.local=threading.local()

    @contextmanager
    def session(self):
        """Validate names once per operation, with no cross-request TTL."""
        if getattr(self.local,'active',False):
            yield
            return
        self.refresh()
        self.local.active=True
        try:
            yield
        finally:
            self.local.active=False

    def refresh(self):
        if getattr(self.local,'active',False):return
        with self.lock:
            try:
                stat=self.path.stat();version=(stat.st_mtime_ns,stat.st_size)
            except OSError:version=None
            stale=False
            checked={}
            for source in self.sources:
                try:
                    archive=source['archive']
                    if archive not in checked:checked[archive]=Path(archive).stat()
                    current=checked[archive]
                    stale |= (current.st_size,current.st_mtime_ns)!=(source['size'],source['mtime'])
                except FileNotFoundError:pass  # The saved index is usable offline.
                except OSError:stale=True
            if version==self.file_version:
                if stale:
                    self.texture_animations={};self.motion_conversions={}
                    self.labels={};self.model_rules={};self.frame_patterns=[];self.icons={};self.part_overrides={};self.motion_names={};self.motion_sequences={};self.motion_extras={};self.motion_particles={};self.sequence_index_available=False;self.version=(version,'stale')
                if stale or self.version==(version,'current') or version is None:return
            labels={};model_rules={};frame_patterns=[];icons={};part_rules={};motion_names={};motion_sequences={};motion_extras={};motion_particles={};sequence_index_available=False
            texture_animations={};self.motion_conversions={}
            if version:
                try:
                    with closing(sqlite3.connect(self.path.resolve().as_uri()+'?mode=ro',uri=True)) as db:
                        if db.execute('PRAGMA user_version').fetchone()[0]!=INDEX_VERSION:raise ValueError()
                        meta=db.execute("SELECT value FROM metadata WHERE key='sources'").fetchone()
                        self.sources=json.loads(meta[0]) if meta else []
                        if not isinstance(self.sources,list) or any(not isinstance(s,dict) or
                                not isinstance(s.get('archive'),str) or not isinstance(s.get('size'),int) or
                                not isinstance(s.get('mtime'),int) for s in self.sources):
                            self.sources=[]
                            raise ValueError('이름 인덱스 출처 형식이 잘못되었습니다.')
                        labels=defaultdict(list)
                        for filename,label,priority in db.execute('SELECT filename,label,MAX(priority) p FROM names GROUP BY filename,label ORDER BY filename,p DESC,label'):
                            labels[filename].append(label)
                        if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='model_icons'").fetchone():
                            for filename,name,digest in db.execute('SELECT filename,name,sha256 FROM model_icons'):
                                icons[filename]=dict(name=name,sha256=digest)
                        if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='motion_names'").fetchone():
                            motion_names={(character,clip):json.loads(details) for character,clip,details in
                                          db.execute('SELECT character,clip,details_json FROM motion_names')}
                        if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='motion_sequences'").fetchone():
                            motion_sequences={character:json.loads(details) for character,details in db.execute('SELECT character,details_json FROM motion_sequences')}
                            sequence_index_available=True
                        if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='motion_extras'").fetchone():
                            from .motion_extras import ExtraIndex
                            motion_extras=ExtraIndex(db.execute('SELECT character,clip,details_json FROM motion_extras'))
                        if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='motion_conversions'").fetchone():
                            self.motion_conversions={(c,clip):json.loads(details) for c,clip,details in db.execute('SELECT character,clip,details_json FROM motion_conversions')}
                        if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='motion_particles'").fetchone():
                            from .motion_extras import ExtraIndex
                            motion_particles=ExtraIndex(db.execute("SELECT name,'' AS clip,details_json FROM motion_particles"))
                        if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='texture_animations'").fetchone():
                            from .motion_extras import ExtraIndex
                            texture_animations=ExtraIndex(db.execute("SELECT filename,'' AS clip,details_json FROM texture_animations"))
                        if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='model_part_overrides'").fetchone():
                            for filename,parts in db.execute('SELECT filename,parts_json FROM model_part_overrides'):
                                part_rules[filename]=json.loads(parts)
                        if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='model_visibility'").fetchone():
                            meta=db.execute("SELECT value FROM metadata WHERE key='model_frame_patterns'").fetchone()
                            frame_patterns=json.loads(meta[0]) if meta else []
                            for filename,priority,groups in db.execute('SELECT filename,priority,groups_json FROM model_visibility'):
                                model_rules[filename]=dict(priority=priority,groups=json.loads(groups))
                except (OSError,sqlite3.Error,ValueError):labels={};model_rules={};frame_patterns=[];icons={};part_rules={};motion_names={};motion_sequences={};motion_extras={};motion_particles={};texture_animations={};sequence_index_available=False;self.sources=[]
            self.labels=dict(labels);self.file_version=version;self.version=(version,'current') if version else None
            self.model_rules=model_rules;self.frame_patterns=frame_patterns
            self.icons=icons
            self.part_overrides=part_rules
            self.motion_names=motion_names
            self.motion_sequences=motion_sequences;self.sequence_index_available=sequence_index_available
            self.motion_extras=motion_extras;self.motion_particles=motion_particles
            self.texture_animations=texture_animations
            if not motion_extras:self.motion_conversions={}
            # A newly loaded index must also be checked against current sources.
            if version:self._check_sources()

    def _check_sources(self):
        for source in self.sources:
            try:
                stat=Path(source['archive']).stat()
                if (stat.st_size,stat.st_mtime_ns)==(source['size'],source['mtime']):continue
            except FileNotFoundError:continue
            except OSError:pass
            self.labels={};self.model_rules={};self.frame_patterns=[];self.icons={};self.part_overrides={};self.motion_names={};self.motion_sequences={};self.motion_extras={};self.motion_particles={};self.motion_conversions={};self.texture_animations={};self.sequence_index_available=False;self.version=(self.file_version,'stale');break

    def icon_image(self,digest):
        with self.lock:
            self.refresh()
            if not re.fullmatch(r'[0-9a-f]{64}',digest) or not self.icons:
                raise ValueError('사용 가능한 아이템 아이콘이 없습니다. 후처리를 다시 실행해 주세요.')
            with closing(sqlite3.connect(self.path.resolve().as_uri()+'?mode=ro',uri=True)) as db:
                row=db.execute('SELECT data FROM icon_images WHERE sha256=?',(digest,)).fetchone()
            if not row:raise ValueError('아이템 아이콘을 찾을 수 없습니다.')
            return row[0]

    def text(self,name):
        return '\n'.join(self.labels.get(name.replace('\\','/').rsplit('/',1)[-1].upper(),()))

    def decorate(self,row):
        filename=row['name'].replace('\\','/').rsplit('/',1)[-1].upper()
        labels=self.labels.get(filename,())
        if filename in self.icons:row['item_icon']=dict(self.icons[filename])
        if labels:
            row['game_names']=list(labels[:100])
            row['game_name_count']=len(labels)
            row['display_name']=labels[0]+(f' 외 {len(labels)-1}개' if len(labels)>1 else '')
        from .model_groups import classify,CHARACTERS
        group=classify(filename)
        if filename.endswith('.X') and group['part']=='FACE' and group['set_name']=='BASIC':
            row['display_name']=CHARACTERS.get(group['character'],group['character'])+' 기본 얼굴'
        return row


def build_index(workspace,executable,progress=None,cancel=None):
    """Read catalog/source CMFs, verify every row and publish a separate index."""
    from .catalog import operation_lock
    workspace=Path(workspace).resolve();executable=Path(executable).resolve()
    with operation_lock(workspace):
        return _build(workspace,executable,progress or (lambda **kw:None),cancel)


def _build(workspace,executable,progress,cancel=None):
    from .cmf import Archive,Entry
    from .model_groups import classify
    from .model_visibility import frame_patterns,model_rule,part_overrides
    from .cmf import Cancelled
    def check_cancel():
        if cancel is not None and cancel.is_set():raise Cancelled()
    check_cancel()
    key,iv=ntf.script_keys(executable)
    with closing(sqlite3.connect((workspace/'catalog.sqlite3').as_uri()+'?mode=ro',uri=True)) as db:
        db.row_factory=sqlite3.Row
        candidates=db.execute('''SELECT e.*,a.path archive,a.size archive_size,a.mtime archive_mtime
            FROM entries e JOIN archives a ON a.id=e.archive_id
            WHERE e.name LIKE 'ITEM_MODEL_TEMPLET%.NTF' OR e.name LIKE 'ITEM_TEMPLET%.NTF'
               OR e.name LIKE 'STRING_TABLE_ITEM%KOREA.NTF' OR e.name IN ('FRAME_UNIQUE_ID.LUA','STRING_TABLE_KOREA.NTF','STRING_TABLE_CHAR_KOREA.NTF','SKILL_TEMPLET.LUA','DUNGEON_MOTION_CONVERT_DATA.NTF','TOWN_MOTION_CONVERT_DATA.NTF')
               OR e.name LIKE 'GUST_USER_%.LUA' OR e.name LIKE 'SOUND%TEMPLET%.LUA' OR e.name LIKE 'DAMAGE_EFFECT_DATA%.LUA' OR e.name LIKE 'X_MESH_PLAYER_GAME%.LUA' OR e.name LIKE 'PARTICLE_SYSTEM_MAIN%.LUA' OR e.name LIKE 'TEX_ANIM_DATA%.LUA' ORDER BY e.id''').fetchall()
    selected={};source_hashes={};sources=[];entry_tables={}
    for row in candidates:
        check_cancel()
        if row['name'] not in CONVERSION_SOURCES and row['name'] not in ('FRAME_UNIQUE_ID.LUA','STRING_TABLE_KOREA.NTF','STRING_TABLE_CHAR_KOREA.NTF','SKILL_TEMPLET.LUA','GUST_USER_CHARACTER_BASE.LUA','GUST_USER_CHARACTER_BASE_TOWN.LUA') and not re.fullmatch(r'(?:(?:ITEM_(?:MODEL_)?TEMPLET[\d_]*|STRING_TABLE_ITEM\d*_KOREA)\.NTF|GUST_USER_(?:BASE_)?[A-Z]+\.LUA|SOUND_(?:VOICE_)?TEMPLET[A-Z0-9_]*\.LUA|(?:(?:DAMAGE_EFFECT_DATA|X_MESH_PLAYER_GAME|PARTICLE_SYSTEM_MAIN)(?:[A-Z0-9_])*|TEX_ANIM_DATA[A-Z0-9_]*)\.LUA)',row['name']):continue
        source=Path(row['archive']);before=source.stat()
        if (before.st_size,before.st_mtime_ns)!=(row['archive_size'],row['archive_mtime']):
            raise ValueError('원본 CMF가 목록과 다릅니다. 먼저 재분석하세요: '+str(source))
        if row['stored']>ntf.MAX_BYTES:raise ValueError('NTF 저장 크기를 초과했습니다.')
        with Archive(source) as archive:
            entry=Entry(row['ordinal'],row['name'],row['size'],row['stored'],row['offset'],row['flag'])
            # Confirm the current archive's own entry table, not just cached offsets.
            if source not in entry_tables:entry_tables[source]={e.index:e for e in archive.entries()}
            actual=entry_tables[source].get(entry.index)
            if actual!=entry:raise ValueError('NTF 원본 항목이 목록과 일치하지 않습니다.')
            stored=b''.join(archive.stored_chunks(entry))
        after=source.stat()
        if (before.st_size,before.st_mtime_ns)!=(after.st_size,after.st_mtime_ns):raise ValueError('NTF를 읽는 동안 원본이 변경되었습니다.')
        digest=hashlib.sha256(stored).hexdigest()
        if row['name'] in source_hashes and source_hashes[row['name']]!=digest:
            raise ValueError('동일 이름의 NTF 출처 내용이 다릅니다: '+row['name'])
        source_hashes[row['name']]=digest
        sources.append(dict(name=row['name'],archive=str(source),ordinal=row['ordinal'],sha256=digest,size=before.st_size,mtime=before.st_mtime_ns))
        selected.setdefault(row['name'],(dict(row),stored))
    strings={};items={};models=[];counts={};visibility=defaultdict(set);part_visibility=defaultdict(set);patterns=[]
    emotion_strings={};emotion_skills={};emotion_rigs={};sound_definitions={};conversion_tables={}
    extra_damage={};extra_meshes={};extra_particle_tables={};extra_tex_tables={};wanted_particles=set();wanted_tex=set();extra_refs=None;extra_errors={};wanted_damage=set();wanted_meshes=set();dependencies_ready=False
    # Strings first to keep only the item columns used by the join.
    for name,(row,stored) in sorted(selected.items(),key=lambda kv:(not kv[0].startswith('STRING_TABLE'),4 if kv[0].startswith('TEX_ANIM_DATA') else 3 if kv[0].startswith('PARTICLE_SYSTEM_MAIN') else 2 if kv[0].startswith('X_MESH_PLAYER_GAME') else 1 if kv[0].startswith('DAMAGE_EFFECT_DATA') else 0,kv[0])):
        check_cancel()
        body=ntf.restore(stored,row['size'],key,iv)
        if name in CONVERSION_SOURCES:
            if ntf.header(body)[0] not in ((5,8,8,8),(4,8,8,8)):raise ValueError('지원하지 않는 모션 변환 NTF 구조입니다: '+name)
            conversion_tables[name]=list(ntf.rows(body));counts[name]=len(conversion_tables[name]);continue
        if name.startswith('SOUND_'):
            from .lua_literals import tables
            sound_definitions[name]=tables(body);counts[name]=len(sound_definitions[name]);continue
        if name.startswith(('DAMAGE_EFFECT_DATA','X_MESH_PLAYER_GAME','PARTICLE_SYSTEM_MAIN','TEX_ANIM_DATA')):
            from .motion_names import character_layers
            from .motion_extras import references,unique_rows,values,effect_dependencies,event_inventory
            from .model_groups import CHARACTERS
            if extra_refs is None:
                from .motion_sound import sound_tables
                extra_refs=references({character:character_layers(character,emotion_rigs) for character in CHARACTERS},sound_tables(sound_definitions))
            if not name.startswith('DAMAGE_EFFECT_DATA') and not dependencies_ready:
                wanted_damage,wanted_meshes=effect_dependencies(extra_refs,extra_damage);dependencies_ready=True
            from .lua_literals import tables
            try:table=tables(body)
            except ValueError as exc:extra_errors[name]=str(exc);counts[name]=0;continue
            if name.startswith('DAMAGE_EFFECT_DATA'):
                # Keep presentation fields until the transitive effect closure
                # is known; a child may be defined before its parent table.
                keys=('m_DamageEffectName','m_MainEffectName','m_EventParticle','m_EventDamageEffect','m_EventXMeshPlayer','m_EventSound')
                rows=[]
                for v in values(table.get('m_mapDamageEffectData')):
                    if not isinstance(v,dict) or not isinstance(v.get('m_DamageEffectName'),str):continue
                    extra={k:v[k] for k in keys if k in v}
                    other={k:event_inventory(value,name) for k,value in v.items() if isinstance(k,str) and k.startswith(('m_Event','m_DieEvent','m_HitEvent')) and k not in keys}
                    for event in other.values():event.pop('source',None)
                    if other:extra['_other_events']=other
                    rows.append(extra)
                extra_damage[name]={'m_mapDamageEffectData':dict(enumerate(rows))}
            elif name.startswith('X_MESH_PLAYER_GAME'):
                extra_meshes[name]={'X_MESH_PLAYER':dict(enumerate(v for v in values(table.get('X_MESH_PLAYER')) if isinstance(v,dict) and v.get('m_SeqName') in wanted_meshes))}
            elif name.startswith('PARTICLE_SYSTEM_MAIN'):
                if not wanted_particles:
                    damage=unique_rows(extra_damage,'m_mapDamageEffectData','m_DamageEffectName',wanted_damage)
                    wanted_particles={v.get('m_ParticleName',v.get('m_SeqName')) for clips in extra_refs.values() for items in clips.values() for item in items for v in [item['row']] if isinstance(v.get('m_ParticleName',v.get('m_SeqName')),str)}
                    wanted_particles.update(v.get('m_MainEffectName') for v in damage.values() if isinstance(v.get('m_MainEffectName'),str))
                    wanted_particles.update(p.get('m_SeqName') for v in damage.values() for p in values(v.get('m_EventParticle')) if isinstance(p,dict) and isinstance(p.get('m_SeqName'),str))
                extra_particle_tables[name]={'PARTICLE_SYSTEM':dict(enumerate(v for v in values(table.get('PARTICLE_SYSTEM')) if isinstance(v,dict) and v.get('m_SeqName') in wanted_particles))}
            else:
                if not wanted_tex:
                    particle_defs=unique_rows(extra_particle_tables,'PARTICLE_SYSTEM','m_SeqName',wanted_particles)
                    wanted_tex={e.get('STR') for v in particle_defs.values() for e in values(v.get('m_vecEventList')) if isinstance(e,dict) and e.get(2)=='PCET_TEX_ANIM' and isinstance(e.get('STR'),str)}
                extra_tex_tables[name]={'m_mapTexAnimData':table.get('m_mapTexAnimData',{})}
            counts[name]=len(table);progress(current=name,rows=counts[name]);continue
        if name=='FRAME_UNIQUE_ID.LUA':
            patterns=frame_patterns(body);counts[name]=len(patterns);continue
        if name=='SKILL_TEMPLET.LUA' or name.startswith('GUST_USER_'):
            from .lua_literals import tables
            table=tables(body);counts[name]=len(table)
            if name=='SKILL_TEMPLET.LUA':emotion_skills=table
            else:emotion_rigs[name]=table
            continue
        types,count,start=ntf.header(body)
        if name.startswith('STRING_TABLE'):
            if types!=(5,8,8):raise ValueError('미지원 한국어 문자열 NTF 열 구성입니다.')
            body=body[:start]+ntf.decrypt(body[start:],key,iv)
        elif name.startswith('ITEM_MODEL'):
            if len(types)!=36 or types[:5]!=(5,8,8,8,8):raise ValueError('미지원 모델 NTF 열 구성입니다.')
        elif len(types)!=206 or types[:4]!=(8,5,8,8) or types[11]!=8:raise ValueError('미지원 아이템 NTF 열 구성입니다.')
        counts[name]=0
        for values in ntf.rows(body):
            check_cancel()
            counts[name]+=1
            if name.startswith('STRING_TABLE'):
                text=values[2].strip()
                if name in ('STRING_TABLE_KOREA.NTF','STRING_TABLE_CHAR_KOREA.NTF'):
                    if values[1] in emotion_strings and emotion_strings[values[1]][0]!=text:raise ValueError('이모션 이름 키가 충돌합니다: '+values[1])
                    emotion_strings[values[1]]=(text,name)
                    continue
                if values[1] in strings and strings[values[1]][0]!=text:raise ValueError('한국어 이름 키가 충돌합니다: '+values[1])
                strings[values[1]]=(text,name)
            elif name.startswith('ITEM_MODEL'):
                for filename in values[2:5]:
                    if filename.upper().endswith('.X') and 'EP_AVATAR' in filename.upper():
                        models.append((values[0],values[1],filename,name))
                        visibility[filename.upper()].add(json.dumps(model_rule(values),sort_keys=True))
                        part_visibility[filename.upper()].add(json.dumps(part_overrides(values)))
            else:
                item_id=values[1];value=(values[2],values[3],values[11],name,values[5])
                if item_id in items and items[item_id]!=value:raise ValueError('아이템 번호가 충돌합니다: '+str(item_id))
                items[item_id]=value
        progress(current=name,rows=counts[name])
    if not strings or not items or not models:raise ValueError('이름 연결에 필요한 NTF가 없습니다.')
    temp=workspace/('game-names.'+uuid.uuid4().hex+'.partial')
    try:
        with closing(sqlite3.connect(temp)) as db, db:
            db.executescript('''PRAGMA user_version=1;
                CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
                CREATE TABLE names(filename TEXT,label TEXT,item_id INTEGER,string_key TEXT,item_table TEXT,
                    model_table TEXT,string_table TEXT,priority INTEGER,
                    PRIMARY KEY(filename,label,item_id,item_table,model_table));
                CREATE INDEX by_filename ON names(filename);''')
            db.execute('CREATE TABLE model_visibility(filename TEXT PRIMARY KEY,priority INTEGER NOT NULL,groups_json TEXT NOT NULL)')
            db.execute('CREATE TABLE model_icons(filename TEXT PRIMARY KEY,name TEXT NOT NULL,sha256 TEXT NOT NULL)')
            db.execute('CREATE TABLE icon_images(sha256 TEXT PRIMARY KEY,data BLOB NOT NULL)')
            db.execute('CREATE TABLE model_part_overrides(filename TEXT PRIMARY KEY,parts_json TEXT NOT NULL)')
            from .motion_names import join,character_layers
            from .model_groups import CHARACTERS
            layers={character:character_layers(character,emotion_rigs) for character in CHARACTERS}
            from .motion_converts import build as build_conversions
            conversions=build_conversions(conversion_tables,layers)
            db.execute('CREATE TABLE motion_conversions(character TEXT,clip TEXT,details_json TEXT NOT NULL,PRIMARY KEY(character,clip))')
            db.executemany('INSERT INTO motion_conversions VALUES(?,?,?)',[(character,clip,json.dumps(details,ensure_ascii=False)) for (character,clip),details in conversions.items()])
            motion_names=join(emotion_skills,layers,emotion_strings)
            from .motion_extras import references,unique_rows,compile_extras,effect_dependencies
            from .motion_sound import sound_tables
            sounds=sound_tables(sound_definitions)
            if extra_refs is None:extra_refs=references(layers,sounds)
            if not dependencies_ready:wanted_damage,wanted_meshes=effect_dependencies(extra_refs,extra_damage)
            damage=unique_rows(extra_damage,'m_mapDamageEffectData','m_DamageEffectName',wanted_damage)
            mesh=unique_rows(extra_meshes,'X_MESH_PLAYER','m_SeqName',wanted_meshes)
            from .motion_extras import particle_rule
            particle_defs=unique_rows(extra_particle_tables,'PARTICLE_SYSTEM','m_SeqName',wanted_particles)
            tex_defs=unique_rows(extra_tex_tables,'m_mapTexAnimData','m_AnimName',wanted_tex)
            from .texture_sequences import texture_sequences
            texture_animations=texture_sequences(extra_tex_tables)
            db.execute('CREATE TABLE texture_animations(filename TEXT PRIMARY KEY,details_json TEXT NOT NULL)')
            db.executemany('INSERT INTO texture_animations VALUES(?,?)',[(filename,json.dumps(details,ensure_ascii=False)) for filename,details in texture_animations.items()])
            motion_particles={}
            for name,row in particle_defs.items():
                try:motion_particles[name]=particle_rule(row,tex_defs)
                except (ValueError,TypeError,KeyError) as exc:
                    extra_errors['particle:'+name]=str(exc);motion_particles[name]={'error':str(exc),'source':row.get('source','')}
            motion_extras=compile_extras(extra_refs,damage,mesh,motion_particles,sounds)
            db.execute('CREATE TABLE motion_particles(name TEXT PRIMARY KEY,details_json TEXT NOT NULL)')
            db.executemany('INSERT INTO motion_particles VALUES(?,?)',[(name,json.dumps(details,ensure_ascii=False)) for name,details in motion_particles.items()])
            db.execute('CREATE TABLE motion_extras(character TEXT,clip TEXT,details_json TEXT NOT NULL,PRIMARY KEY(character,clip))')
            db.executemany('INSERT INTO motion_extras VALUES(?,?,?)',[(character,clip,json.dumps(details,ensure_ascii=False)) for (character,clip),details in motion_extras.items()])
            from .motion_sequences import build as build_sequences
            motion_sequences=build_sequences(emotion_skills,layers,emotion_strings)
            db.execute('CREATE TABLE motion_sequences(character TEXT PRIMARY KEY,details_json TEXT NOT NULL)')
            db.executemany('INSERT INTO motion_sequences VALUES(?,?)',[(character,json.dumps(details,ensure_ascii=False)) for character,details in motion_sequences.items()])
            db.execute('CREATE TABLE motion_names(character TEXT,clip TEXT,details_json TEXT NOT NULL,PRIMARY KEY(character,clip))')
            db.executemany('INSERT INTO motion_names VALUES(?,?,?)',[(character,clip,json.dumps(details,ensure_ascii=False)) for (character,clip),details in motion_names.items()])
            for filename,choices in part_visibility.items():
                if len(choices)==1 and next(iter(choices))!='[]':
                    db.execute('INSERT INTO model_part_overrides VALUES(?,?)',(filename,next(iter(choices))))
            icon_names=defaultdict(set)
            for filename,rules in visibility.items():
                # Shared filenames can represent items with incompatible settings.
                # Without an equipped item ID, preserving geometry is safer.
                if len(rules)!=1:continue
                rule=json.loads(next(iter(rules)))
                db.execute('INSERT INTO model_visibility VALUES(?,?,?)',(filename,rule['priority'],json.dumps(rule['groups'])))
            for item_id,owner,filename,model_table in models:
                check_cancel()
                item=items.get(item_id)
                if not item or owner.startswith('GUST_NPC_') or item[2].startswith('GUST_NPC_'):continue
                text=strings.get(item[0])
                if not text or not text[0] or text[0] in ('INVAILD_STRING','BLANK'):continue
                group=classify(filename)
                priority=int(bool(group['set_name']) and group['set_name']==item[1])
                # A shared mesh can serve several costume types. Only exact item
                # context can supply its icon; never infer an HQ filename.
                if (isinstance(item[4],str) and item[4].upper().endswith('.PNG') and
                        (not group['character'] or item[2] in ('GUST_INVALID','GUST_USER_'+group['character'])) and
                        (not group['set_name'] or priority)):
                    icon_names[filename.upper()].add(item[4].upper())
                db.execute('INSERT OR IGNORE INTO names VALUES(?,?,?,?,?,?,?,?)',
                           (filename.upper(),text[0],item_id,item[0],item[3],model_table,text[1],priority))
            total=db.execute('SELECT COUNT(DISTINCT filename) FROM names').fetchone()[0]
            if not total:raise ValueError('실제 이름에 연결된 아바타 모델이 없습니다.')
            icons=_build_icons(workspace,db,icon_names,sources,progress,check_cancel)
            metadata=dict(executable_sha256=hashlib.sha256(executable.read_bytes()).hexdigest(),sources=sources,rows=counts,models=total,model_frame_patterns=patterns,icons=icons,extra_errors=extra_errors)
            db.executemany('INSERT INTO metadata VALUES(?,?)',[(k,json.dumps(v,ensure_ascii=False)) for k,v in metadata.items()])
        check_cancel()
        os.replace(temp,workspace/'game-names.sqlite3')
    finally:temp.unlink(missing_ok=True)
    return dict(tables=len(selected),models=total,icons=icons,motion_names=len(motion_names),motion_sequences=sum(map(len,motion_sequences.values())),motion_extras=sum(map(len,motion_extras.values())),extra_errors=extra_errors,part_overrides=sum(len(v)==1 and next(iter(v))!='[]' for v in part_visibility.values()),rows=counts,index=str(workspace/'game-names.sqlite3'))


def _build_icons(workspace,index,icon_names,sources,progress,check_cancel):
    """Embed verified PNGs atomically, independent of the extraction filter."""
    from .cmf import Archive,Entry
    wanted={next(iter(names)) for names in icon_names.values() if len(names)==1}
    candidates=defaultdict(list)
    with closing(sqlite3.connect((workspace/'catalog.sqlite3').as_uri()+'?mode=ro',uri=True)) as catalog:
        catalog.row_factory=sqlite3.Row
        for row in catalog.execute('''SELECT e.*,a.path archive,a.size archive_size,a.mtime archive_mtime
                FROM entries e JOIN archives a ON a.id=e.archive_id
                WHERE e.format='png' AND e.flag!=2'''):
            if row['name'].upper() in wanted:candidates[row['archive']].append(dict(row))
    hashes=defaultdict(set);invalid=set();completed=0
    for archive_path,rows in sorted(candidates.items()):
        check_cancel()
        path=Path(archive_path);before=path.stat()
        if (before.st_size,before.st_mtime_ns)!=(rows[0]['archive_size'],rows[0]['archive_mtime']):
            raise ValueError('아이콘 원본 CMF가 목록과 다릅니다. 먼저 재분석하세요: '+str(path))
        with Archive(path) as archive:
            entries={e.index:e for e in archive.entries()}
            for row in rows:
                check_cancel();name=row['name'].upper()
                entry=Entry(row['ordinal'],row['name'],row['size'],row['stored'],row['offset'],row['flag'])
                if entries.get(entry.index)!=entry:raise ValueError('아이콘 원본 항목이 목록과 일치하지 않습니다.')
                if row['size']>4*1024*1024:
                    invalid.add(name);continue
                try:
                    data=b''.join(archive.chunks(entry))
                    if len(data)<24 or data[:8]!=b'\x89PNG\r\n\x1a\n':raise ValueError('PNG 형식이 아닙니다.')
                    width,height=struct.unpack('>II',data[16:24])
                    if not (0<width<=4096 and 0<height<=4096):raise ValueError('아이콘 크기를 초과했습니다.')
                except ValueError:
                    invalid.add(name);continue
                digest=hashlib.sha256(data).hexdigest();hashes[name].add(digest)
                index.execute('INSERT OR IGNORE INTO icon_images VALUES(?,?)',(digest,data))
                completed+=1
                if completed%200==0:progress(current='아이템 아이콘',rows=completed)
        after=path.stat()
        if (before.st_size,before.st_mtime_ns)!=(after.st_size,after.st_mtime_ns):raise ValueError('아이콘을 읽는 동안 원본이 변경되었습니다.')
        sources.append(dict(name='아이템 아이콘',archive=str(path),size=before.st_size,mtime=before.st_mtime_ns))
    for filename,names in icon_names.items():
        if len(names)!=1:continue
        name=next(iter(names));digests=hashes[name]
        if name in invalid or len(digests)!=1:continue
        index.execute('INSERT INTO model_icons VALUES(?,?,?)',(filename,name,next(iter(digests))))
    index.execute('DELETE FROM icon_images WHERE sha256 NOT IN (SELECT sha256 FROM model_icons)')
    count=index.execute('SELECT COUNT(*) FROM model_icons').fetchone()[0]
    progress(current='아이템 아이콘 연결 완료',rows=count)
    return count
