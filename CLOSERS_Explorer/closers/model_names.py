"""Explicit unit/model references and skin package names, with source evidence."""
from collections import defaultdict
from pathlib import Path
import re


def clean(value):
    return re.sub(r'#C(?:[0-9a-fA-F]{6}|X)', '', value,flags=re.I).strip()


def package_names(rows, strings, registrations):
    """Package columns 4/5 register dungeon/town groups; 12 is the name key."""
    groups=defaultdict(list)
    for row in rows:
        if len(row)!=14:raise ValueError('스킨 패키지 명칭 테이블 형식을 지원하지 않습니다.')
        text,table=strings.get(row[12],('',''))
        label=clean(text)
        if not label or label in ('BLANK','INVAILD_STRING'):continue
        characters=set(re.findall(r'GUST_USER_([A-Z]+)',row[3]))
        for column,kind in ((4,'SCT_DUNGEON_MOTION'),(5,'SCT_TOWN_MOTION')):
            if not row[column]:continue
            for character in sorted(characters):
                groups[character,kind,row[column]].append(dict(label=label,kind='skin',string_key=row[12],
                    string_table=table,skill_table='NEW_CONVERT_PACKAGE_TEMPLET.NTF',package_id=row[1]))
    result=defaultdict(list)
    for (character,clip),links in registrations.items():
        for link in links:
            if link['ambiguous']:continue
            for name in groups.get((character,link['type'],link['group']),[]):
                source=dict(name,state=link['state'],state_table=link['source'],group=link['group'],scene=link['type'])
                if source not in result[character,clip]:result[character,clip].append(source)
    return dict(result)


def unit_header(table):
    unit=table.get('GAME_UNIT_TEMPLET',{})
    base=table.get('BASE_TEMPLATE',{})
    return dict(parent=base.get('m_GameUnitSubType',''),
                **{k:unit[k] for k in ('m_Name','m_MotionFileName') if k in unit})


def unit_names(units,strings,filenames):
    """Only declared model references; inheritance cycles and conflicts stay unresolved."""
    from .model_groups import classify
    names=[];groups=defaultdict(set);errors={};cache={}
    def resolve(name,trail=()):
        if name in cache:return cache[name]
        if name in trail:raise ValueError('유닛 정의의 상속이 순환합니다: '+name)
        row=units.get(name)
        if row is None:return {}
        parent=row.get('parent')
        inherited=resolve(parent.upper()+'.LUA',(*trail,name)) if isinstance(parent,str) and parent else {}
        cache[name]={**inherited,**row}
        return cache[name]
    for filename in sorted(units):
        try:row=resolve(filename)
        except ValueError as exc:errors[filename]=str(exc);continue
        reference=row.get('m_MotionFileName');key=row.get('m_Name')
        if not isinstance(reference,str) or not reference:continue
        model=Path(reference.replace('\\','/')).name.upper()
        if Path(model).suffix!='.X':continue
        kind=classify(filename)['kind']
        for target in (model,model[:-2]+'.XMD'):
            if target not in filenames:continue
            if kind in ('npc','monster','pet','motion'):groups[target].add(kind)
            text,table=strings.get(key,('','')) if isinstance(key,str) else ('','')
            label=clean(text)
            if label and label not in ('BLANK','INVAILD_STRING'):
                names.append((target,label,key,filename,table))
    return names,{filename:next(iter(kinds)) for filename,kinds in groups.items() if len(kinds)==1},errors


def collect_units(workspace,key,iv,progress,check_cancel):
    """Stream NPC definitions by archive and retain only their naming headers."""
    from contextlib import closing
    import hashlib
    import sqlite3
    from . import ntf
    from .cmf import Archive,Entry
    from .lua_literals import tables
    with closing(sqlite3.connect(Path(workspace)/'catalog.sqlite3')) as db:
        db.row_factory=sqlite3.Row
        rows=db.execute('''SELECT e.*,a.path archive,a.size archive_size,a.mtime archive_mtime FROM entries e
            JOIN archives a ON a.id=e.archive_id WHERE e.name LIKE 'GUST_NPC_%.LUA' ORDER BY a.path,e.ordinal''').fetchall()
    by_archive=defaultdict(list)
    for row in rows:by_archive[row['archive']].append(row)
    units={};sources=[];errors={};digests={};completed=0
    for path,entries in by_archive.items():
        check_cancel();before=Path(path).stat()
        if (before.st_size,before.st_mtime_ns)!=(entries[0]['archive_size'],entries[0]['archive_mtime']):
            raise ValueError('유닛 정의 원본이 목록과 다릅니다: '+path)
        with Archive(path) as archive:
            actual={e.index:e for e in archive.entries()}
            for row in entries:
                check_cancel();name=row['name'].upper();completed+=1
                entry=Entry(row['ordinal'],row['name'],row['size'],row['stored'],row['offset'],row['flag'])
                if actual.get(entry.index)!=entry:raise ValueError('유닛 정의 원본 항목이 목록과 다릅니다: '+name)
                if entry.size>ntf.MAX_BYTES or entry.stored>ntf.MAX_BYTES:
                    errors[name]='유닛 정의 크기 제한을 초과했습니다.';continue
                stored=b''.join(archive.stored_chunks(entry));digest=hashlib.sha256(stored).hexdigest()
                sources.append(dict(name=name,archive=path,ordinal=entry.index,sha256=digest,size=before.st_size,mtime=before.st_mtime_ns))
                if name in digests and digests[name]!=digest:
                    errors[name]='동일 유닛 정의의 출처 내용이 다릅니다.';units.pop(name,None);continue
                if name not in errors:
                    digests[name]=digest
                    try:units[name]=unit_header(tables(ntf.restore(stored,entry.size,key,iv)))
                    except ValueError as exc:errors[name]=str(exc)
                if completed%100==0:progress(current='유닛 이름·모델 연결 '+name,rows=completed,total=len(rows))
        after=Path(path).stat()
        if (before.st_size,before.st_mtime_ns)!=(after.st_size,after.st_mtime_ns):raise ValueError('유닛 정의를 읽는 동안 원본이 변경되었습니다.')
    return units,sources,errors
