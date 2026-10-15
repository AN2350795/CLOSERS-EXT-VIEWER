"""Virtual groups derived from observable names, never verified quest semantics."""
from pathlib import Path
import re

AXES = ('detail', 'prefix', 'directory', 'archive', 'quest_candidate')


def group_key(name, archive, detail, axis):
    if axis == 'detail':
        return detail
    if axis == 'archive':
        return archive
    if axis == 'directory':
        return str(Path(archive).parent)
    stem = Path(name.replace('\\', '/')).stem.upper()
    if axis == 'quest_candidate':
        match = re.match(r'^(ST_QUEST_[A-Z]+_\d+)(?:_|$)', stem)
        return match[1] if match else None
    if axis == 'prefix':
        return re.sub(r'_\d+$', '', stem)
    raise ValueError('지원하지 않는 그룹 기준입니다.')


def expression(axis):
    if axis not in AXES:
        raise ValueError('지원하지 않는 그룹 기준입니다.')
    return f"resource_group(e.name,a.path,e.detail,'{axis}')"
