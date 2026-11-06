"""Enumerate every XMD source and preserve extractable bytes despite viewer errors."""
from collections import Counter
import json
from pathlib import Path

from .cmf import check_cancel
from .model_groups import CHARACTERS, classify
from .model_library import Models
from .model_motions import related
from .motion_catalog import decorate


def audit(catalog, destination, character='', extract=False, progress=lambda **kw: None, cancel=None):
    destination = Path(destination).resolve()
    if character and character not in CHARACTERS:
        raise ValueError('지원하는 캐릭터 코드를 지정하세요.')
    destination.mkdir(parents=True, exist_ok=True)
    models = Models(catalog)
    with catalog.connect() as db:
        rows = [dict(row) for row in db.execute("""SELECT e.id,e.name,e.format,e.ordinal,a.path AS archive
            FROM entries e JOIN archives a ON a.id=e.archive_id WHERE e.format IN ('x','xmd') ORDER BY e.id""")]
    animations = [row for row in rows if row['format'] == 'xmd' and
                  (not character or related(row['name'], character, set()))]
    rigs = [row for row in rows if row['format'] == 'x' and row['name'].upper().startswith('MOTION_') and
            (not character or related(row['name'], character, set()))]
    extraction = []
    if extract:
        ids = [row['id'] for row in animations + rigs]
        for offset in range(0, len(ids), 200):
            check_cancel(cancel)
            extraction.append(catalog.extract(destination / 'assets', {'ids': ids[offset:offset + 200]},
                                              cancel=cancel, progress=progress))
    files = []
    with models.operation():
        registrations = catalog.game_names.motion_catalog
        for index, row in enumerate(animations):
            check_cancel(cancel)
            record = dict(row, clips=[], parse_status='unavailable')
            try:
                data, owner, source = models.read(row['id'], 'xmd')
                record.update(source=source, output=owner.get('output'))
                metadata = models.parse(data, source, 'xmd')
                record.update(clips=decorate(metadata['clips'], classify(row['name'])['character'], registrations),
                              bones=metadata['bones'], version=metadata['version'], parse_status='ready')
            except (ValueError, OSError) as exc:
                record['parse_error'] = str(exc)
                owner = catalog.get(row['id'])
                record['output'] = owner.get('output')
            files.append(record)
            progress(phase='motion-audit', done=index + 1, total=len(animations), current=row['name'])
        present = {(classify(file['name'])['character'], clip['name']) for file in files for clip in file['clips']}
        missing = [dict(character=who, name=clip, registrations=links)
                   for (who, clip), links in registrations.items()
                   if (not character or who == character) and (who, clip) not in present]
    # Playback validation stays separate: a parseable XMD need not match its rig.
    libraries = []
    for rig in rigs:
        who = classify(rig['name'])['character']
        if rig['name'].upper() != 'MOTION_' + who + '.X' or who not in CHARACTERS:
            continue
        check_cancel(cancel)
        try:
            library = models.motion_library(rig['id'], [])
            libraries.append(dict(character=who, skeleton_id=rig['id'], files=[
                {key: file[key] for key in ('id', 'name', 'status', 'error', 'skeleton_id')} for file in library['files']]))
        except (ValueError, OSError) as exc:
            libraries.append(dict(character=who, skeleton_id=rig['id'], error=str(exc), files=[]))
        progress(phase='motion-rigs', current=who, done=len(libraries))
    summary = dict(xmd_files=len(files), clips=sum(len(file['clips']) for file in files),
                   town_clips=sum('town' in clip['motion_categories'] for file in files for clip in file['clips']),
                   parse_unavailable=sum(file['parse_status'] != 'ready' for file in files),
                   playback_files=sum(len(library['files']) for library in libraries),
                   playback_unavailable=sum(file['status'] != 'ready' for library in libraries for file in library['files']),
                   missing_registration_clips=len(missing), registration_index_available=bool(registrations),
                   extraction=dict(sum((Counter({key: value for key, value in result.items() if type(value) is int and key != 'outside_scope'})
                                        for result in extraction), Counter())))
    if extract:
        summary['extraction'].setdefault('failed', 0)
    report = dict(summary=summary, files=files, rigs=rigs, playback=libraries, missing_registrations=missing,
                  evidence='등록은 착용 가능 여부를 보장하지 않습니다. 클립 부재·해석 실패·뼈 검증 실패를 구분합니다. 원본 XMD 추출은 재생 검증과 별개입니다.')
    target = destination / 'motion-audit.json'
    temporary = destination / 'motion-audit.json.partial'
    temporary.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    temporary.replace(target)
    return dict(summary, report=str(target), failed=summary['extraction'].get('failed', 0))
