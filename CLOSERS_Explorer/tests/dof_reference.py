"""Analytical shader reconstruction for investigation, not a viewer effect.

Depth is the encoded color MRT2 channel, not hardware z-buffer depth. Shader
float32 rounding, rasterization, blending and target sampling are not simulated.
"""
import math

# Rounded DXBC disassembly literals; these are diagnostic sample directions.
DISC = ((0, 0), (.527837, -.085868), (-.040088, .536087), (-.670445, -.179949),
        (-.419418, -.616039), (.440453, -.639399), (-.757088, .349334), (.574619, .685879))


def finite(values):
    if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in values):
        raise ValueError('Finite numeric diagnostic inputs required.')


def depth_encoding(view_z, focal):
    if len(focal) != 4:
        raise ValueError('Four focal constants required.')
    finite([view_z, *focal])
    near_reference, focus, far_reference, far_cap = focal
    if far_cap < 0:
        raise ValueError('Negative far cap is outside the investigated domain.')
    near = view_z < focus
    denominator = focus - near_reference if near else far_reference - focus
    if denominator <= 0:
        raise ValueError('Selected depth branch has a zero or reversed denominator.')
    signal = (view_z - focus) / denominator
    if not near:
        signal = min(max(signal, 0), far_cap)
    encoded = signal * .5 + .5
    byte = math.floor(min(max(encoded, 0), 1) * 255 + .5)
    return dict(branch='near' if near else 'far', signal=signal, shader_rgb=encoded,
                approximate_unorm8=byte, scope='preblend-depth-RGB-only')


def sampling_offsets(encoded_depth, render_size, parameters):
    if len(render_size) != 2 or len(parameters) != 4:
        raise ValueError('Two render dimensions and four post constants required.')
    finite([encoded_depth, *render_size, *parameters])
    if not 0 <= encoded_depth <= 1 or any(v <= 0 for v in render_size):
        raise ValueError('Encoded depth or render dimensions outside diagnostic domain.')
    signed = encoded_depth * parameters[1] - parameters[0]
    fine = abs(signed)
    coarse = fine * parameters[2] * 2
    return dict(defocus=signed, fine=[(x*fine/render_size[0], y*fine/render_size[1]) for x, y in DISC],
                coarse=[(x*coarse/render_size[0], y*coarse/render_size[1]) for x, y in DISC],
                debug=parameters[3] > 0, render_size_scope='explicit CBPerPostProcess[25].xy input; not assumed viewport size')


def gather(center_depth, fine_rgb, fine_depth, coarse_rgba):
    """Mix already-sampled texture values using the normal 8-sample DOF path."""
    if len(fine_rgb) != 8 or len(fine_depth) != 8 or len(coarse_rgba) != 8:
        raise ValueError('Eight sample values required per input.')
    if any(len(v) != 3 for v in fine_rgb) or any(len(v) != 4 for v in coarse_rgba):
        raise ValueError('RGB and RGBA sample shapes required.')
    finite([center_depth, *fine_depth, *(n for v in fine_rgb for n in v), *(n for v in coarse_rgba for n in v)])
    if not 0 <= center_depth <= 1 or any(not 0 <= d <= 1 for d in [*fine_depth, *(v[3] for v in coarse_rgba)]):
        raise ValueError('Encoded depth outside UNORM domain.')
    rgb = [0, 0, 0]
    weight_sum = 0
    for fine, depth, coarse in zip(fine_rgb, fine_depth, coarse_rgba):
        blend = abs(2*depth-1)
        mixed = [a+(b-a)*blend for a, b in zip([*fine, depth], coarse)]
        weight = 1 if mixed[3] >= center_depth else abs(2*mixed[3]-1)
        for c in range(3):
            rgb[c] += mixed[c] * weight
        weight_sum += weight
    if weight_sum == 0:
        raise ValueError('Source normalization denominator is zero; no neutral fallback is invented.')
    return dict(rgba=[*(v/weight_sum for v in rgb), 1], weight_sum=weight_sum,
                scope='normal-DOF-shader-output; source alpha is 1', rendering_enabled=False)
