"""Metadata comparison and immutable saved-output history; no source deletion."""
import json
import os
from pathlib import Path
import uuid

from .cmf import check_cancel


def atomic_json(path, value):
    path = Path(path)
    temp = path.with_name(path.name + '.' + uuid.uuid4().hex + '.partial')
    try:
        temp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
        temp.replace(path)
    finally:
        temp.unlink(missing_ok=True)


def compare(catalog, paths, cancel=None, progress=lambda **kw: None):
    roots = []
    for value in paths:
        root = Path(value).expanduser().resolve()
        if not root.exists():
            # A missing root may be an unplugged disk or a typo. Do not label its
            # entire catalog as removed.
            raise FileNotFoundError(f'비교할 원본 위치가 없습니다: {root}')
        roots.append((os.path.normcase(str(root)), root.is_dir()))
    def inside(path):
        path = os.path.normcase(path)
        return any(path == root or (directory and path.startswith(root + os.sep)) for root,directory in roots)
    with catalog.connect() as db:
        known = {os.path.normcase(r['path']): (r['size'],r['mtime']) for r in
                 db.execute('SELECT path,size,mtime FROM archives') if inside(r['path'])}
    counts = dict(added=0,changed=0,missing=0,unchanged=0)
    examples = {key: [] for key in counts}
    done = 0
    for path in catalog.candidates(paths,cancel):
        check_cancel(cancel)
        meta = path.stat()  # Any discovery/stat failure aborts the comparison.
        prior = known.pop(os.path.normcase(str(path)), None)
        kind = 'added' if prior is None else 'unchanged' if prior == (meta.st_size,meta.st_mtime_ns) else 'changed'
        counts[kind] += 1
        if len(examples[kind]) < 100:
            examples[kind].append(str(path))
        done += 1
        if done % 100 == 0:
            progress(phase='compare',done=done,current=str(path),comparison=dict(counts))
    for path in known:
        check_cancel(cancel)
        counts['missing'] += 1
        if len(examples['missing']) < 100:
            examples['missing'].append(path)
    result = dict(paths=[str(Path(p).resolve()) for p in paths],counts=counts,examples=examples,
                  method='size-mtime',complete=True,done=done,
                  note='크기·수정 시각 기준 비교입니다. 저장된 파일과 기존 목록은 삭제하지 않습니다. 각 유형의 예시는 최대 100개입니다.')
    atomic_json(catalog.workspace / 'update-comparison.json',result)
    progress(phase='compare',done=done,current='원본 변경 비교 완료',comparison=counts)
    return result


def history(catalog, archive_id, page=1):
    page = max(1,int(page))
    with catalog.connect() as db:
        total = db.execute('''SELECT count(*) FROM entry_history e JOIN archive_history a ON a.id=e.revision_id
                              WHERE a.archive_id=?''',(int(archive_id),)).fetchone()[0]
        records = db.execute('''SELECT e.id history_id,e.record,a.* FROM entry_history e
                                JOIN archive_history a ON a.id=e.revision_id WHERE a.archive_id=?
                                ORDER BY a.id DESC,e.ordinal LIMIT 100 OFFSET ?''', (int(archive_id),(page-1)*100)).fetchall()
    items = []
    for row in records:
        record = json.loads(row['record'])
        items.append(dict(history_id=row['history_id'],revision_id=row['id'],name=record['name'],
                          ordinal=record['ordinal'],output=record.get('output'),sha256=record.get('sha256'),
                          flag=record['flag'],saved_exists=bool(record.get('output') and Path(record['output']).is_file()),
                          source_size=row['size'],source_mtime=row['mtime'],saved=row['saved']))
    return dict(total=total,page=page,limit=100,items=items)


def history_file(catalog, history_id):
    with catalog.connect() as db:
        row = db.execute('SELECT record FROM entry_history WHERE id=?',(int(history_id),)).fetchone()
    if row is None:
        raise ValueError('이전 버전의 저장 기록이 없습니다.')
    record = json.loads(row[0])
    if record['flag'] == 2:
        raise ValueError('암호화 바이트는 원본 형식으로 복원된 파일이 아닙니다.')
    path = Path(record['output']) if record.get('output') else None
    if path is None or not path.is_file():
        raise FileNotFoundError('이전 버전의 저장 파일이 없습니다.')
    return path,record['name']
