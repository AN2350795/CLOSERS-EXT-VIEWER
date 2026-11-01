"""Recheck investigated Glow/HDR evidence without running game code or shaders.

The hashes bind the documented equations to the inspected DXBC files. This
does not establish runtime activation or complete the game's bloom renderer.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import struct
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from audit_output_color import audit as audit_cpu
from closers.catalog import Catalog
from closers.loading import LoadingData
from closers.cmf import Archive
from closers import ntf
from closers.color_grading import SOURCE, TYPES

SHADERS = {
    'CW_GETBRIGHT.PS.CSO': '77c293b18e73b2dc379f6d9455b855f6a7c71afbed7d3b384c7eea0b0c0eaaa9',
    'CW_BLUR_HORIZON.PS.CSO': 'ff356966befcc41bb8973eadcff577671fe131c38946f1bb8219662f44772b06',
    'CW_BLUR_VERTICAL.PS.CSO': '5b64415466127603a251733aba9ecd4dfa543dfe5e5fea39778f9a0c6180e29f',
    'CW_SCREENQUAD_GLOW.PS.CSO': 'fcb39bf7b94d8f15d64fb5068522b639222f21041a26676baa2c0e788771ac0e',
    'CW_HDR.PS.CSO': 'a3afb80486347d88618cde88438dd3c4ba68bc8e7f24d52dee77991bc4b3639b',
}

# Exact instructions checked against the same executable fingerprint as the
# established output-color audit. No instruction decoder dependency is needed.
EVIDENCE = (
    ('glow_shader_registration', 0x1416067e6, '41b9040000004c8d05cdf8fb00488d154ef5fb00488bcbe80ef2ffff'),
    ('bright_shader_registration', 0x141606a19, '488d1528f1fb00488bcbe8e8efffff'),
    ('hdr_shader_registration', 0x141606a3a, '488d15dff0fb00488bcbe8c7efffff'),
    ('horizontal_shader_registration', 0x141606b63, '488d157eedfb00488bcbe89eeeffff'),
    ('vertical_shader_registration', 0x141606b84, '488d152dedfb00488bcbe87deeffff'),
    ('glow_dispatch_before_edge', 0x14157603d, '4c8bce488bcb40886c242889442420e80fcdffff'),
    ('glow_level_count_cap', 0x141572f57, '418b8570020000b9050000003bc10f4dc141898570020000'),
    ('glow_blur_techniques_11_12', 0x141572fd7, 'c74424380c000000c74424300b000000'),
    ('glow_blur_chain_call', 0x141572ffc, 'ba01000000498bcde877dbffff'),
    ('glow_mode_to_global_constant', 0x1415730a3, '66410f6e85780200000f5bc0f30f1105d977a201'),
    ('glow_five_slot_loop', 0x141573542, '4183fe057d1fe923fdffff'),
    ('glow_quad_shader_group_8', 0x141573071, '41c7432008000000488b4a4049894b28'),
    ('glow_draw_with_bound_inputs', 0x14157376f, '488d542448498b8d40020000e850e6feff'),
    ('glow_global_param_lookup', 0x141674a13, '4c8d4424708bd3488bc8e82ec3efff'),
    ('glow_global_param_default_key', 0x141674a2e, '4c8d44247033d2e816c3efff'),
    ('glow_global_params_write', 0x141674a3a, 'f30f10442470f30f1105585e9201f30f104c2474f30f110d4e5e9201'),
)


def shader_sources(workspace):
    catalog = Catalog(workspace)
    data = LoadingData(catalog)
    result = []
    for name, expected in SHADERS.items():
        rows = data.rows(name)
        if not rows:
            raise ValueError('Original shader unavailable: ' + name)
        sources = []
        for row in rows:
            catalog.verify_source(row)
            with Archive(row['archive']) as archive:
                body = b''.join(archive.chunks(catalog.entry(row)))
            catalog.verify_source(row)
            digest = hashlib.sha256(body).hexdigest()
            if digest != expected:
                raise ValueError('Unrecognized or conflicting shader; re-investigate: ' + name)
            sources.append(dict(entry=row['id'], archive=row['archive'], ordinal=row['ordinal'], bytes=len(body), sha256=digest))
        result.append(dict(name=name, sha256=expected, status='verified', sources=sources))
    return result


def cpu_evidence(executable):
    cpu = audit_cpu(executable)
    if cpu['status'] != 'verified':
        raise ValueError('Established output path evidence mismatch.')
    body = Path(executable).read_bytes()
    if hashlib.sha256(body).hexdigest() != cpu['sha256']:
        raise ValueError('Executable changed during evidence verification.')
    pe = struct.unpack_from('<I', body, 0x3c)[0]
    optional = pe + 24
    image_base = struct.unpack_from('<Q', body, optional + 24)[0]
    section_start = optional + struct.unpack_from('<H', body, pe + 20)[0]
    sections = [struct.unpack_from('<IIII', body, section_start + i * 40 + 8)
                for i in range(struct.unpack_from('<H', body, pe + 6)[0])]
    checks = []
    for name, address, expected_hex in EVIDENCE:
        expected = bytes.fromhex(expected_hex)
        relative = address - image_base
        section = next((s for s in sections if s[1] <= relative and relative + len(expected) <= s[1] + min(s[0], s[2])), None)
        if section is None:
            raise ValueError('Evidence address outside file-backed sections.')
        offset = section[3] + relative - section[1]
        checks.append(dict(name=name, address=hex(address), matches=body[offset:offset + len(expected)] == expected))
    if not all(c['matches'] for c in checks):
        raise ValueError('Glow/HDR CPU evidence mismatch: ' + ', '.join(c['name'] for c in checks if not c['matches']))
    return dict(sha256=cpu['sha256'], status='verified', established_checks=len(cpu['checks']), checks=checks)


def audit(workspace, executable):
    cpu = cpu_evidence(executable)
    shaders = shader_sources(workspace)
    data = LoadingData(Catalog(workspace))
    body = data.body(SOURCE)
    if ntf.header(body)[0] != TYPES:
        raise ValueError('Unrecognized graphic option schema.')
    parameters = [dict(row=i, key=row[1], columns=[5, 6], values=[struct.unpack('<f', struct.pack('<I', v))[0] for v in row[5:7]])
                  for i, row in enumerate(ntf.rows(body)) if row[0] == 1]
    if len({p['key'] for p in parameters}) != len(parameters) or not all(math.isfinite(v) for p in parameters for v in p['values']):
        raise ValueError('Duplicate or non-finite original BloomParam data.')
    return dict(
        cpu=cpu, shaders=shaders,
        graphic_parameters=dict(source=SOURCE, sha256=hashlib.sha256(body).hexdigest(), category=1, rows=parameters,
                                runtime_selection='unresolved; key 0 fallback observed'),
        source_glow=dict(input_slots=['base', 'blur1', 'blur2', 'blur3', 'blur4', 'blur5'], maximum_levels=5,
                         technique_constant='CBPerGlobal[6].x', bloom_constant='CBPerGlobal[7].y',
                         formula='A=saturate(sum(blur1..5)/5); mode==2: saturate(A*p+base*(1-saturate(A*p))); otherwise: saturate(5*A+base)',
                         channels='RGBA', blur='9 horizontal and 9 vertical samples; uploaded offsets/weights; saturate each output'),
        bright_shader=dict(formula='saturate((input-threshold)/(1-threshold))', channels='RGBA', constant='CBPerPostProcess[19].x',
                           active_glow_input_association='unresolved; shader presence alone does not establish use'),
        hdr_shader=dict(formula='shift UV toward (0.5,0.6) by depth.g*sum(source.rgb)*0.02; resample source; factor=1-average(source.rgb); if factor<0 use minimum; output=source+bright*power*factor',
                        constants='CBPerPostProcess[20].xy = power, minimum', alpha='resampled source alpha',
                        active_dispatch='unresolved; separate shader, not equivalent to ScreenQuad Glow'),
        viewer=dict(input='enabled avatar emission only, own depth occlusion', levels=1, blur='two-pass half-resolution Gaussian',
                    formula='base.rgb + blur.rgb * strength', alpha='base alpha preserved', original_glow_or_hdr=False),
        unresolved=['Effective runtime Glow mode and level count', 'Blur target dimensions, offsets, weights and sampler states',
                    'Complete input routing including additional render target and optional effects',
                    'HDR/GetBright active dispatch and constant upload', 'In-game frame comparison'],
        game_executed=False, rendering_enabled=False, viewer_defaults_changed=False,
    )


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workspace', required=True, type=Path)
    parser.add_argument('--exe', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    try:
        report = audit(args.workspace, args.exe)
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    except (ValueError, OSError, struct.error) as exc:
        parser.exit(1, str(exc) + '\n')
    print(json.dumps(dict(cpu_checks=len(report['cpu']['checks']), shaders=len(report['shaders']), rendering_enabled=False)))
