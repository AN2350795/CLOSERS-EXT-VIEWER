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


def evaluate(rules, sources, eye=None, additional=()):
    """Count items once, even when one appearance contains several meshes."""
    characters = {s.get('model_group', {}).get('character') for s in sources}
    characters.discard(''); characters.discard(None)
    if len(characters) != 1 or any(s.get('model_group', {}).get('kind') != 'avatar' for s in sources):
        return dict(status='unavailable', candidates=[], reason='같은 캐릭터의 아바타를 선택하세요.')
    character = next(iter(characters))
    if eye and eye.get('character')!=character:
        return dict(status='unavailable',candidates=[],reason='눈동자와 아바타의 캐릭터가 다릅니다.')
    items = {}; slots = {}; unknown = False
    for source in [*sources,*additional]:
        if eye and not eye.get('basic') and source.get('entry_id')==eye.get('face_id') and 'entry_id' in source:
            continue  # The resolved eye below owns this face/geometry selection.
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
    eye_ids=set(eye.get('item_ids') or [eye.get('item_id')])-{None} if eye and not eye.get('basic') else set()
    eye_conflict=False
    if eye_ids:
        eye_part='ACC_RING_RIGHT' if eye.get('geometry') else 'EYES'
        eye_conflict=bool(slots.get(eye_part,set())-eye_ids)
        if eye_conflict:unknown=True
    conflict = any(len(ids) > 1 for ids in slots.values()) or ('ONE_PIECE' in slots and any(p in slots for p in ('UPBODY', 'LOWBODY')))
    candidates = []
    for rule in rules:
        if character not in rule['characters']:
            continue
        matched = sorted(set(items).intersection(rule['item_ids']))
        eye_matches=eye_ids.intersection(rule['item_ids'])
        ambiguous_eye=bool(eye_matches and eye_matches!=eye_ids)
        eye_count=int(bool(eye_matches) and not ambiguous_eye and not eye_matches.intersection(matched))
        if not matched and not eye_matches:
            continue
        count=len(matched)+eye_count
        ready = count >= rule['required_count'] and not (unknown or conflict or rule['extra_condition'] or ambiguous_eye)
        candidates.append(dict(condition_id=rule['condition_id'], target_group=rule['target_group'],
                               required_count=rule['required_count'], matched_count=count, item_ids=matched,
                               eye_count=eye_count,eye_alias_ambiguous=ambiguous_eye,
                               status='ready' if ready else 'unverified' if unknown or conflict or rule['extra_condition'] or ambiguous_eye else 'incomplete',
                               row_index=rule['row_index'], content_version=rule['content_version'], sources=SOURCES))
    targets = {r['target_group'] for r in candidates if r['status'] == 'ready'}
    return dict(status='ambiguous' if len(targets) > 1 else 'ready' if targets else 'unverified' if unknown or conflict or any(r['status']=='unverified' for r in candidates) else 'incomplete',
                candidates=candidates, target_group=next(iter(targets)) if len(targets) == 1 else None,
                reason='선택한 눈동자 장비와 추가 장비의 착용 부위가 겹칩니다.' if eye_conflict else '동일 부위의 중복 착용을 해소하세요.' if conflict else '아이템을 지정하지 않은 모델이 있어 조건 확인을 보류합니다.' if unknown else '',
                scope='preview-items-only', limitations=['selected_skin_not_bound', 'runtime_priority_not_bound', 'content_version_not_evaluated'])


def diagnose(data, sources, eye=None, selected_items=None, catalog=None):
    if selected_items is None:selected_items=[]
    if not isinstance(selected_items,list) or len(selected_items)>16 or any(type(i) is not int or i<=0 for i in selected_items) or len(set(selected_items))!=len(selected_items):
        raise ValueError('추가 장비 선택 정보가 잘못되었습니다.')
    if not sources or any(s.get('model_group', {}).get('kind') != 'avatar' for s in sources):
        if selected_items:raise ValueError('추가 장비는 같은 캐릭터의 아바타와 함께 선택하세요.')
        return evaluate([], sources,eye)
    try:
        rules = data.cached(('avatar-light-conditions', 1), lambda: read_rules(data), persistent=True)
        initial=evaluate(rules,sources,eye)
        if not initial['candidates'] and not selected_items:
            initial.update(selected_items=[],additional_items=[])
            return initial
        available=[]
        if catalog and rules:
            from .avatar_condition_items import options
            available=options(data,catalog,rules)
    except ValueError as exc:
        if selected_items:raise ValueError('추가 장비의 원본 정의를 확인할 수 없습니다: '+str(exc)) from exc
        return dict(status='unavailable', candidates=[], reason=str(exc))
    characters={s.get('model_group',{}).get('character') for s in sources}-{None,''}
    available=[v for v in available if len(characters)==1 and v['character'] in characters]
    by_id={v['item_id']:v for v in available}
    if any(i not in by_id for i in selected_items):raise ValueError('현재 캐릭터의 추가 장비 정의와 선택 정보가 다릅니다.')
    additional=[dict(item_id=i,appearance_key='condition:'+str(i),item_part=by_id[i]['part']) for i in selected_items]
    report=evaluate(rules,sources,eye,additional)
    relevant={i for r in rules if any(c['condition_id']==r['condition_id'] for c in report['candidates']) for i in r['item_ids']}
    report.update(selected_items=selected_items,additional_items=[v for v in available if v['item_id'] in relevant or v['item_id'] in selected_items])
    return report
