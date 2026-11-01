"""Analytical reconstruction of the inspected CPU blur setup, for diagnostics.

Python exp/sqrt do not promise bit identity with the game's float32 CRT. This
module prepares a report; it neither renders nor chooses a live game mode.
"""
import math
import struct

DIVISORS = (2, 4, 8, 16, 32)
TWO_PI = struct.unpack('<f', bytes.fromhex('db0fc940'))[0]


def avatar_mrt(surface, emission_texture, emission_color, strength_x=1, strength_y=1):
    """Normal DEFAULT/CARTOONLIGHT output before target blending/quantization.

    `surface` is the already shaded/alpha-adjusted pixel. Refraction and other
    special shader paths are outside this diagnostic reconstruction.
    """
    vectors = [list(v) for v in (surface, emission_texture, emission_color)]
    values = [n for v in vectors for n in v] + [strength_x, strength_y]
    if any(len(v) != 4 for v in vectors) or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in values):
        raise ValueError('Finite RGBA inputs and strengths required.')
    emission = [t * c * strength_x * strength_y for t, c in zip(vectors[1], vectors[2])]
    if not all(math.isfinite(v) for v in emission):
        raise ValueError('Emission result is outside the diagnostic numeric range.')
    if all(v == 0 for v in emission[:3]):
        emission = [0, 0, 0, vectors[0][3] if emission[3] > 0 else 1]
    return dict(scope='normal-avatar-shader-preblend', target0=vectors[0], target1=emission,
                blending_applied=False, quantization_applied=False, rendering_enabled=False)


def blur_plan(width, height, *, resource_key=1, mode=1, sigma=1):
    if any(type(v) is not int or v <= 0 for v in (width, height)):
        raise ValueError('Positive integer input dimensions required.')
    if type(resource_key) is not int or resource_key not in (1, 2):
        raise ValueError('Only investigated resource keys 1 and 2 are supported.')
    if type(mode) is not int or mode not in (1, 2):
        raise ValueError('Only investigated Glow modes 1 and 2 are supported.')
    if isinstance(sigma, bool) or not isinstance(sigma, (int, float)) or not math.isfinite(sigma) or sigma <= 0:
        raise ValueError('Finite positive sigma required.')
    base = (width, height) if resource_key == 1 else (390, 730)
    sizes = [(base[0] // d, base[1] // d) for d in DIVISORS]
    if any(w == 0 or h == 0 for w, h in sizes):
        raise ValueError('Source integer division produces a zero-sized target; no artificial minimum is applied.')
    try:
        normalizer = 1 / math.sqrt(TWO_PI * sigma * sigma)
        denominator = 2 * sigma * sigma
        if not math.isfinite(denominator) or denominator == 0 or normalizer == 0:
            raise ValueError('Sigma is outside the diagnostic numeric range.')
        weights = [normalizer * math.exp(-((k / sigma) ** 2) / denominator) for k in range(-4, 5)]
    except (OverflowError, ZeroDivisionError):
        raise ValueError('Sigma is outside the diagnostic numeric range.') from None
    if not all(math.isfinite(w) for w in weights):
        raise ValueError('Sigma produces non-finite diagnostic weights.')
    levels = []
    for i, ((w, h), divisor) in enumerate(zip(sizes, DIVISORS)):
        levels.append(dict(level=i, divisor=divisor, size=[w, h],
                           horizontal_offsets=[k / w for k in range(-4, 5)],
                           vertical_offsets=[k / h for k in range(-4, 5)],
                           input='source MRT1 (+0x1a8)' if i == 0 and mode == 1 else
                                 'source color (+0x1a0)' if i == 0 else f'vertical level {i - 1}',
                           passes=['horizontal', 'vertical']))
    return dict(scope='diagnostic-inputs-only', input_size=[width, height], resource_key=resource_key, mode=mode,
                size_base=list(base), sigma=sigma, weights=weights, weight_sum=sum(weights), normalized=False,
                precision='analytical; not bit-exact float32 CRT', levels=levels,
                sampler=dict(filter=0x15, address_uvw=[3, 3, 3], interpretation='MIN_MAG_MIP_LINEAR / CLAMP'),
                target_format=28, rendering_enabled=False)
