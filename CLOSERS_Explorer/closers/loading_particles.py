"""Compile the plane-particle rules used by registered loading frames.

Keep ranges and timed events: sampling them here would turn animated particles
into a single still image. The browser samples with a saved deterministic seed.
"""
import math


PROPERTIES = {
    'PCET_COLOR': ('color', 'RGBA', 4),
    'PCET_COLOR_DUAL_BLENDING': ('dualColor', 'RGBA', 4),
    'PCET_BLINK_COLOR': ('blinkColor', 'RGBA', 4),
    'PCET_RESET_BLINK_COLOR': ('blinkPeriod', 'VAL', 1),
    'PCET_SIZE': ('size', 'XYZ', 3),
    'PCET_SCALE': ('scale', 'VAL', 1),
    'PCET_POSITION': ('position', 'XYZ', 3),
    'PCET_VELOCITY': ('velocity', 'XYZ', 3),
    'PCET_ROTATE': ('rotation', 'XYZ', 3),
    'PCET_ROTATE_SPEED': ('rotationSpeed', 'XYZ', 3),
    'PCET_TEX0UV': ('uv', 'XY', 2),
}
BLENDS = {'ZERO', 'ONE', 'SRCALPHA', 'INVSRCALPHA', 'DESTALPHA', 'INVSRCCOLOR'}


def number(value):
    if type(value) not in (int, float) or not math.isfinite(value) or abs(value) > 1e7:
        raise ValueError('파티클 수치가 범위를 벗어났습니다.')
    return value


def span(value):
    if isinstance(value, dict):
        lo = number(value[1]); hi = number(value.get(2, lo))
        if set(value) - {1, 2}: raise ValueError('지원하지 않는 확률 범위입니다.')
        return [min(lo, hi), max(lo, hi)]
    return number(value)


def vector(value, count):
    if not isinstance(value, dict): return [span(value)] * count
    return [span(value.get(i, 0)) for i in range(1, count+1)]


def middle(value):
    return sum(value)/2 if isinstance(value, list) else value


def preview_passes(layer):
    particle = layer.get('particle', {})
    result = [(layer.get('color',[1,1,1,1]), particle.get('blend',
        ['SRCALPHA','ONE' if layer.get('blend')=='lighter' else 'INVSRCALPHA']), particle.get('drawCount',1))]
    if particle.get('dual'):
        color = [1,1,1,1]
        for track in particle['tracks']:
            if track['property']=='dualColor' and track['mode']=='initial': color = list(map(middle,track['value']))
        result.append((color,['SRCALPHA','DESTALPHA'],particle['dualDrawCount']))
    return result


def composite_preview(canvas, overlay, blend):
    from PIL import Image
    if blend == ['SRCALPHA','INVSRCALPHA']: return Image.alpha_composite(canvas,overlay)
    pixels = []
    for dst,src in zip(getattr(canvas,'get_flattened_data',canvas.getdata)(),getattr(overlay,'get_flattened_data',overlay.getdata)()):
        sa,da=src[3]/255,dst[3]/255
        additive=blend[0]=='SRCALPHA' and blend[1] in ('ONE','DESTALPHA')
        coverage=sa*max(src[:3])/255 if additive else sa
        alpha=da if blend[0]=='ZERO' else coverage+da*(1-coverage)
        def factor(name,i):
            return {'ZERO':0,'ONE':1,'SRCALPHA':sa,'INVSRCALPHA':1-sa,'DESTALPHA':da,
                'INVSRCCOLOR':1-src[i]/255}[name]
        rgb=[min(255,max(0,round((src[i]*factor(blend[0],i)+dst[i]*da*factor(blend[1],i))/alpha))) if alpha else 0 for i in range(3)]
        pixels.append((*rgb,round(alpha*255)))
    canvas.putdata(pixels)
    return canvas


def compile_particle(seq, scale, seed, image_id):
    if seq.get('m_ParticleType') != 'PCT_2D_PLANE':
        raise ValueError('평면 이외의 파티클입니다.')
    blend = [seq.get(k, default).removeprefix('CON_D3DBLEND_') for k, default in
             [('m_SrcBlend', 'SRCALPHA'), ('m_DestBlend', 'INVSRCALPHA')]]
    if any(v not in BLENDS for v in blend): raise ValueError('지원하지 않는 블렌딩 인자입니다.')
    tracks = []
    for event in seq['m_vecEventList'].values():
        kind, prop = event[1], event[2]
        if prop in ('PCET_TEXTURE', 'PCET_TEX_ANIM'):
            if kind != 'PCET_INITIAL': raise ValueError('시간별 텍스처 교체 규칙을 확인해야 합니다.')
            continue
        if prop not in PROPERTIES or kind not in ('PCET_INITIAL', 'PCET_FADE', 'PCET_FADE_FINAL'):
            raise ValueError('알 수 없는 파티클 이벤트: '+str(prop))
        name, field, count = PROPERTIES[prop]
        # One shipped SCALE event spells its scalar as XYZ rather than VAL.
        value = event.get(field, event.get('XYZ') if prop == 'PCET_SCALE' else None)
        tracks.append(dict(property=name, mode={'PCET_INITIAL':'initial','PCET_FADE':'fade',
            'PCET_FADE_FINAL':'final'}[kind], value=vector(value, count),
            start=span(event.get(3, 0)), end=span(event[4]) if 4 in event else None))
    life = span(seq.get('m_LifeTime', 1))
    if min(life if isinstance(life, list) else [life]) <= 0:
        raise ValueError('입자의 수명은 양수여야 합니다.')
    maximum = number(seq.get('m_iMaxParticleNum', 1))
    if maximum != int(maximum) or not 1 <= maximum <= 256:
        raise ValueError('동시 입자 수는 1~256개입니다.')
    # The client reads this field as a float range, not an XYZ vector. Some
    # shipped tables include an unused third value. Add its sampled length in
    # the direction of the initial emission offset (CW.EXE 0x1415c0dee).
    minimum = seq.get('m_EmitRadiusMin', 0)
    if isinstance(minimum, dict): minimum = {k:v for k,v in minimum.items() if k in (1,2)}
    particle = dict(seed=seed, life=life, maxParticles=int(maximum),
        rate=span(seq.get('m_EmitRate', 0)), instant=span(seq.get('m_EmitRateInstant', 0)),
        emitterLife=span(seq.get('m_DieTime', 999999)), deaths=span(seq.get('m_DieCount', 0)),
        radius=vector(seq.get('m_EmitRadius', 0), 3), radiusMin=span(minimum),
        gravity=vector(seq.get('m_vGravity', 0), 3), scale=list(scale),
        drawCount=int(number(seq.get('m_DrawCount', 1))), dual=seq.get('m_bDualBlending') == 'TRUE',
        dualDrawCount=int(number(seq.get('m_DrawCountDualBlending', 1))),
        clamp=seq.get('m_bTexClamp') == 'TRUE', blend=blend, tracks=tracks)
    if seq.get('m_MaskTexName'): particle['mask_entry_id'] = image_id(seq['m_MaskTexName'])
    initial = {t['property']: [middle(v) for v in t['value']] for t in tracks if t['mode']=='initial'}
    size, factor = initial.get('size', [1,1,1]), initial.get('scale', [1])[0]
    width, height = max(.01, abs(size[0]*factor*scale[0])), max(.01, abs(size[1]*factor*scale[1]))
    particle['basis'] = [width, height]
    return particle, width, height, initial.get('color', [1,1,1,1])
