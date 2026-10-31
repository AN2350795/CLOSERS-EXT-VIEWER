"""Read verified color-only portions of the game's graphic detail presets."""
import hashlib
import math
import struct
from . import ntf
from .loading import MissingDefinition

SOURCE = 'GRAPHIC_OPTION_DATA_DETAIL.NTF'
TYPES = (5, 5, 8, 8, 8, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 8)
CHANNELS = ('R', 'G', 'B', 'BRI', 'CON', 'SAT')


def read_presets(data):
    try:
        body = data.body(SOURCE)
    except MissingDefinition:
        return []
    if ntf.header(body)[0] != TYPES:
        raise ValueError('지원하지 않는 그래픽 프리셋 테이블입니다.')
    rows = list(ntf.rows(body))
    def number(bits):
        value = struct.unpack('<f', struct.pack('<I', bits))[0]
        if not math.isfinite(value):
            raise ValueError('색상 보정 프리셋 수치가 유효하지 않습니다.')
        return value
    limits = {}
    prefix = 'ST_OPTION_GRAPHIC_OPTION_COLOR_GRADING_'
    for row in rows:
        if row[0] != 3 or not row[2].startswith(prefix):
            continue
        channel = row[2][len(prefix):]
        if channel not in CHANNELS:
            continue
        if channel in limits:
            raise ValueError('색상 보정 채널 정의가 중복됩니다.')
        low, high = number(row[6]), number(row[7])
        if low > high:
            raise ValueError('색상 보정 채널 범위가 잘못되었습니다.')
        limits[channel] = [low, high]
    candidates = [(i, row) for i, row in enumerate(rows) if row[0] == 5]
    if not candidates:
        return []
    if set(limits) != set(CHANNELS):
        raise ValueError('색상 보정 채널 범위 정의가 누락되었습니다.')
    expected = dict(zip(CHANNELS, ([0, 2], [0, 2], [0, 2], [-1, 1], [-1, 1], [0, 2])))
    if limits != expected:
        raise ValueError('지원하지 않는 원본 색상 보정 채널 범위입니다.')
    strings = data.strings()
    sharp_ranges=[row for row in rows if row[0]==4]
    def other_effects(row):
        result={}
        for key,column in (('bloom',5),('depth_of_field',6)):
            try:
                value=number(row[column])
                # The source compares against exactly 1, not nonzero.
                result[key]=dict(status='source-verified',value=value,enabled=value==1,source_column=column)
            except ValueError as exc:result[key]=dict(status='unavailable',reason=str(exc),source_column=column)
        try:
            value=number(row[13])
            if len(sharp_ranges)!=1:raise ValueError('선명도 범위 정의가 누락되거나 중복됩니다.')
            low,high=number(sharp_ranges[0][6]),number(sharp_ranges[0][7])
            if low>high or not low<=value<=high:raise ValueError('선명도 프리셋 수치·범위를 확인할 수 없습니다.')
            result['sharpen']=dict(status='source-verified',value=value,enabled=value>0,limits=[low,high],source_column=13)
        except ValueError as exc:result['sharpen']=dict(status='unavailable',reason=str(exc),source_column=13)
        return dict(scope='not-applied',**result)
    result, seen = [], set()
    for index, row in candidates:
        preset_id = row[1]
        if preset_id <= 0 or preset_id in seen:
            raise ValueError('그래픽 프리셋 식별자가 잘못되거나 중복됩니다.')
        seen.add(preset_id)
        values = [number(bits) for bits in row[7:13]]
        if any(not limits[c][0] <= v <= limits[c][1] for c, v in zip(CHANNELS, values)):
            raise ValueError('원본 범위를 벗어난 색상 보정 프리셋입니다.')
        result.append(dict(key=str(preset_id), label=strings.get(row[2]) or f'원본 프리셋 {preset_id}',
                           rgb=values[:3], bcs=values[3:], source_enabled=any(v > 0 for v in values),
                           source=SOURCE, source_row=index, source_sha256=hashlib.sha256(body).hexdigest(),
                           limits=limits, activation='manual', scope='color-grading-only',
                           selection_scope='graphics-option',source_category=5,other_postprocess=other_effects(row)))
    return result
