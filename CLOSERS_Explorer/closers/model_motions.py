"""Filename evidence for character motion packs; never infer costume ownership."""
import re
from pathlib import Path

CATEGORIES = dict(basic='기본 · 이동', combat='전투 · 피격', skill='스킬',
                  avatar='아바타 변형', emotion='이모션', lobby='로비 · 마을',
                  interaction='상호작용', other='기타')


def category(name):
    stem = Path(name).stem.upper()
    if 'EMOTION' in stem:return 'emotion'
    if re.search(r'_(?:SKILL|TASKFORCE)(?:_|$)', stem):return 'skill'
    if re.search(r'_(?:ATTACK|DAMAGE|CASH_ATTACK)(?:_|$)', stem):return 'combat'
    if '_INTERACT_' in stem:return 'interaction'
    if re.search(r'_(?:TOWN|LOBBY)(?:_|$)', stem):return 'lobby'
    if re.search(r'_(?:COMMON|RARE|DEVIL|CASH)(?:_|$)', stem):return 'avatar'
    if re.fullmatch(r'MOTION_[A-Z]+', stem):return 'basic'
    return 'other'


def related(name, character, stems):
    stem = Path(name).stem.upper()
    return stem in stems or bool(character and
        (stem == 'MOTION_'+character or stem.startswith('MOTION_'+character+'_')))
