"""Diagnose source light conditions against explicitly selected preview items.

This does not infer the player's selected skin, ownership or runtime priority.
NEW_CONVERT column 10 is MCT_LIGHT (4), not the similarly named skin ID.
"""
import re

from . import ntf
from .loading import MissingDefinition


TYPES = (8, 5, 8, 8, 8, 2, 4, 4, 4, 4, 4, 4, 4, 4, 8)
SOURCES = ['NEW_CONVERT_TEMPLET.NTF', 'CONVERT_ITEM_GROUP_LIST1.NTF',
           'CONVERT_ITEM_GROUP_LIST2.NTF', 'CONVERT_ITEM_GROUP_LIST3.NTF']


def read_rules(data):
    try:
        body = data.body(SOURCES[0])
    except MissingDefinition:
        return []
    if ntf.header(body)[0] != TYPES:
        raise ValueError('조명 착용 조건 테이블 형식을 지원하지 않습니다.')
    rules = []
    for index, row in enumerate(ntf.rows(body)):
        if not row[10]:
            continue  # A listed light is not necessarily activated by this skin.
        if not re.fullmatch(r'\s*\d+(?:\s*,\s*\d+)*\s*,?\s*', row[4]):
            raise ValueError('조명 조건의 아이템 그룹을 해석할 수 없습니다.')
        if not 0 < row[5] <= 16:
            raise ValueError('조명 조건의 필요 개수를 지원하지 않습니다.')
        characters = sorted(set(re.findall(r'GUST_USER_([A-Z]+)', row[2])))
        if not characters:
            raise ValueError('조명 조건의 캐릭터를 확인할 수 없습니다.')
        rules.append(dict(condition_id=row[1], row_index=index, target_group=row[10],
                          required_count=row[5], groups=sorted({int(v) for v in re.findall(r'\d+', row[4])}),
                          characters=characters, extra_condition=row[3], content_version=row[0]))
    if not rules:
        return []
    needed = {g for rule in rules for g in rule['groups']}
    members = {g: set() for g in needed}
    # Each numbered list is a shard of the same group-to-item relation.
    for name in SOURCES[1:]:
        try:
            body = data.body(name)
        except MissingDefinition:
            raise ValueError('조명 조건의 아이템 목록이 없습니다: ' + name)
        if ntf.header(body)[0] != (4, 5):
            raise ValueError('조명 조건의 아이템 목록 형식을 지원하지 않습니다.')
        for group, item in ntf.rows(body):
            if group in members:
                members[group].add(item)
    for rule in rules:
        rule['item_ids'] = sorted(set().union(*(members[g] for g in rule['groups'])))
    return rules


def evaluate(rules, sources):
    """Count items once, even when one appearance contains several meshes."""
    characters = {s.get('model_group', {}).get('character') for s in sources}
    characters.discard(''); characters.discard(None)
    if len(characters) != 1 or any(s.get('model_group', {}).get('kind') != 'avatar' for s in sources):
        return dict(status='unavailable', candidates=[], reason='같은 캐릭터의 아바타를 선택하세요.')
    character = next(iter(characters))
    items = {}; slots = {}; unknown = False
    for source in sources:
        item = source.get('item_id')
        if not item or not source.get('appearance_key'):
            # The ordinary face is not an equipped costume item.
            group = source.get('model_group', {})
            if group.get('part') != 'FACE' or group.get('family') != 'BASIC':
                unknown = True
            continue
        items[item] = source
        part = source.get('item_part') or source.get('model_group', {}).get('part')
        if not part or part == 'unknown':
            unknown = True
        else:
            slots.setdefault(part, set()).add(item)
    conflict = any(len(ids) > 1 for ids in slots.values()) or ('ONE_PIECE' in slots and any(p in slots for p in ('UPBODY', 'LOWBODY')))
    candidates = []
    for rule in rules:
        if character not in rule['characters']:
            continue
        matched = sorted(set(items).intersection(rule['item_ids']))
        if not matched:
            continue
        ready = len(matched) >= rule['required_count'] and not (unknown or conflict or rule['extra_condition'])
        candidates.append(dict(condition_id=rule['condition_id'], target_group=rule['target_group'],
                               required_count=rule['required_count'], matched_count=len(matched), item_ids=matched,
                               status='ready' if ready else 'unverified' if unknown or conflict or rule['extra_condition'] else 'incomplete',
                               row_index=rule['row_index'], content_version=rule['content_version'], sources=SOURCES))
    targets = {r['target_group'] for r in candidates if r['status'] == 'ready'}
    return dict(status='ambiguous' if len(targets) > 1 else 'ready' if targets else 'unverified' if unknown or conflict or any(r['status']=='unverified' for r in candidates) else 'incomplete',
                candidates=candidates, target_group=next(iter(targets)) if len(targets) == 1 else None,
                reason='동일 부위의 중복 착용을 해소하세요.' if conflict else '아이템을 지정하지 않은 모델이 있어 조건 확인을 보류합니다.' if unknown else '',
                scope='preview-items-only', limitations=['selected_skin_not_bound', 'runtime_priority_not_bound', 'content_version_not_evaluated'])


def diagnose(data, sources):
    if not sources or any(s.get('model_group', {}).get('kind') != 'avatar' for s in sources):
        return evaluate([], sources)
    try:
        rules = data.cached(('avatar-light-conditions', 1), lambda: read_rules(data), persistent=True)
        return evaluate(rules, sources)
    except ValueError as exc:
        return dict(status='unavailable', candidates=[], reason=str(exc))
