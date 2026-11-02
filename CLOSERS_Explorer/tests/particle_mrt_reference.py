"""Explicit diagnostic QUAD/MRT inputs; no live game state is inferred."""
import math


def unorm(value):
    return math.floor(max(0, min(1, value))*255+.5)/255


def reference(layers, initial_mode, target, sample):
    color = [unorm(v) for v in ([.08, .12, .16, .2] if target == 0 else [.5, .5, .5, .15])]
    nearest = math.inf
    mode = initial_mode
    for layer in layers:
        if layer.get('restore_before'):
            mode = 0
        src, dst = layer['blend']
        independent = (src, dst) in ((5, 7), (5, 2), (1, 4), (2, 2))
        if independent:
            mode = 1
        if sample == 'outside' or (layer['depth_test'] and layer['z'] > nearest):
            continue
        rgba = layer['rgba'].copy()
        if sample == 'left' and layer.get('cutout'):
            rgba[3] = 0
        # QUAD zeros the surface color here; this is not a discard.
        if rgba[3] <= 1/255:
            rgba = [0, 0, 0, 0]
        if target == 2:
            z = layer['z']
            signed = (z-4)/4 if z < 4 else min(max((z-4)/4, 0), .5)
            rgba = [signed*.5+.5]*3+[rgba[3]*(rgba[0] if mode == 1 else 1)]
            if independent:
                src, dst = 5, 6
        factors = {1: [0]*3, 2: [1]*3, 4: [1-v for v in rgba[:3]],
                   5: [rgba[3]]*3, 6: [1-rgba[3]]*3, 7: [color[3]]*3}
        color = [unorm(rgba[c]*factors[src][c]+color[c]*factors[dst][c]) for c in range(3)]+[unorm(rgba[3]+color[3])]
        if layer['depth_test'] and layer['depth_write']:
            nearest = layer['z']
    return [round(v*255) for v in color]


def cases():
    result = []

    def append(name, layers, mode=0):
        result.append(dict(name=name, layers=layers, mode=mode,
                           expected=[[reference(layers, mode, target, sample) for sample in ('left', 'right', 'outside')] for target in (0, 2)]))

    def layer(blend, alpha, z, red=.4, **overrides):
        return dict(blend=list(blend), rgba=[red, .6, .8, alpha], z=z, depth_test=overrides.get('depth_test', True), depth_write=overrides.get('depth_write', False), cutout=overrides.get('cutout', False))

    for blend in ((5, 6), (5, 2), (5, 7), (1, 4), (2, 2)):
        for mode in (0, 1):
            for z in (1, 4, 10):
                for alpha in (0, 1/255, .5, 1):
                    append(f'{blend}/{mode}/{z}/{alpha}', [layer(blend, alpha, z, red=(0, .4, 1)[len(result)%3])], mode)
    for depth_test in (False, True):
        for depth_write in (False, True):
            for alpha in (0, .5):
                append(f'overlap/{depth_test}/{depth_write}/{alpha}', [layer((5, 2), alpha, 1, depth_test=depth_test, depth_write=depth_write), layer((5, 6), .6, 4)])
    append('cutout-still-writes-hardware-depth', [layer((5, 2), .5, 1, depth_write=True, cutout=True), layer((5, 6), 1, 4)])
    append('shared-mode-carried-to-normal-blend', [layer((5, 2), .5, 4), layer((5, 6), .7, 1, red=.2)])
    reset = layer((5, 6), .7, 1, red=.2)
    reset['restore_before'] = True
    append('saved-state-restore-clears-mode-before-normal', [layer((5, 2), .5, 4), reset])
    return result
