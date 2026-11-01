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
from bloom_reference import blur_plan, avatar_mrt

SHADERS = {
    'CW_GETBRIGHT.PS.CSO': '77c293b18e73b2dc379f6d9455b855f6a7c71afbed7d3b384c7eea0b0c0eaaa9',
    'CW_BLUR_HORIZON.PS.CSO': 'ff356966befcc41bb8973eadcff577671fe131c38946f1bb8219662f44772b06',
    'CW_BLUR_VERTICAL.PS.CSO': '5b64415466127603a251733aba9ecd4dfa543dfe5e5fea39778f9a0c6180e29f',
    'CW_SCREENQUAD_GLOW.PS.CSO': 'fcb39bf7b94d8f15d64fb5068522b639222f21041a26676baa2c0e788771ac0e',
    'CW_HDR.PS.CSO': 'a3afb80486347d88618cde88438dd3c4ba68bc8e7f24d52dee77991bc4b3639b',
    'CW_CARTOONLIGHT.PS.CSO': 'd41123ea082cf12b5ba605d5d736029098f2e6cdd1c207ec685232f105cbe85e',
    'CW_ADD_CARTOONLIGHT.PS.CSO': '59f1288a494457455a5fb1d0e78635b803e01aa3fdf6010e2ef15a4614696730',
    'CW_DEFAULT.PS.CSO': 'c128360275e910029de5f05742c3e40df03db9b3be138d4871e3866798f43eaa',
    'CW_NOLIGHT.PS.CSO': '19a853af9d1a4279d61f24533859d5f7fba6b78f02ce8ead9ae640461e31c1d3',
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
    ('reset_level_count_sigma_mode', 0x14157743b, 'c786700200000500000048c786740200000000803f'),
    ('target_divisors', 0x141574695, 'c7856002000002000000c7856402000004000000c7856802000008000000c7856c02000010000000c7857002000020000000'),
    ('resource_key2_dimensions', 0x1415747b8, '83ff027511b986010000894c2460c7442458da020000'),
    ('horizontal_target_dimensions', 0x141574c06, '418b0c2433d28b7424608bc6f7f189858801000033d28b442458f7f189858c010000'),
    ('vertical_target_dimensions', 0x141574e5b, '418b0c2433d28bc6f7f189858801000033d28b442458f7f189858c010000'),
    ('sampler_linear_clamp_desc', 0x1415707d6, 'c744243403000000c744243803000000c744243c03000000c744243015000000'),
    ('first_level_mode1_input', 0x14157082e, '4c8bb7a001000083be7802000001750b85db75074c8bb7a8010000'),
    ('gaussian_inverse_and_normalizer', 0x1415708b0, 'f3440f1005039ae200450f28c8f3440f5ece0f28c6f30f59053b420401f30f59c6e87a8dab000f28fef30f593d97c1e300f30f59fe410f28f0f30f5ef0'),
    ('gaussian_kernel_center', 0x1415708fd, 'f3440f1025529be300'),
    ('target_based_sample_offsets', 0x141570910, '66410f6ed70f5bd2f3410f5cd48b4530660fefc0f3480f2ac0410f28c8f30f5ec8f30f59caf3410f114dfc8b4534660fefc0f3480f2ac0410f28c8f30f5ec8f30f59caf3410f114d00'),
    ('gaussian_weights_and_nine_taps', 0x141570959, '410f28c1f30f59c2f3410f5cc2f30f59c0410f57c3f30f5ec7e8f990c101f30f59c6f3410f11858c000000f3410f11859000000041ffc74983c5104183ff090f8c72ffffff'),
    ('sigma_from_runtime_field', 0x141570cff, 'f30f109d740200004c8bc7498bd6488bcde8dbf9ffff'),
    ('progressive_vertical_input', 0x141570d15, '4d8b5e204b8b7c1d00ffc64983c5083bb570020000'),
    ('horizontal_quad_input', 0x141570a06, '498bd6488b8e40020000e8cb11ffff'),
    ('vertical_reads_horizontal_target', 0x141570a43, '488bbda0010000'),
    ('vertical_quad_input', 0x141570a6d, '488bd5488b8e40020000e89412ffff'),
    ('sqrt_positive_path', 0x142029715, 'f30f10442460f30f51c0f30f11442470'),
    ('one_float', 0x14239a2bc, '0000803f'),
    ('two_pi_float', 0x1425b4b08, 'db0fc940'),
    ('two_float', 0x1423aca78, '00000040'),
    ('four_float', 0x1423aa458, '00008040'),
    ('target_texture_array', 0x1416095c0, '8bce4c8d4ccf504533c0488d9570010000488bc841ff5228'),
    ('target_srv_array', 0x141609898, '418bcc4c8d8ccfa00100004c8d4560498b95b0feffff488bc841ff5238'),
    ('target_msaa_rtv_array', 0x141609e5c, '4e8d8ce7200100004c8d442440498b16488bc841ff5248'),
    ('target_single_rtv_array', 0x14160a3df, '4c8d8ccfe00000004c8d442440498b9570ffffff488bc841ff5248'),
    ('bind_msaa_or_single_rtvs', 0x1416090c5, 'e816b91a004c8b8be80100004c8d8320010000eb13e801b91a004c8b8be00100004c8d83e00000004c8b108b931c020000488bc841ff9208010000'),
    ('bind_target_count', 0x1416090ed, '4c8b108b931c020000488bc841ff9208010000'),
    ('clear_msaa_rtvs', 0x141608ec0, '488db120010000e814bb1a00488b164c8d4424304c8b08488bc841ff9190010000ffc34883c6083b9f1c02000072d8'),
    ('clear_single_rtvs', 0x141608f05, '488db1e00000000f1f4000e8cbba1a00488b164c8d4424304c8b08488bc841ff9190010000ffc34883c6083b9f1c02000072d8'),
    ('resolve_all_targets', 0x141608fb3, '488d7950e824ba1a004c8b4f40488b174c8b104533c0488bc8c74424281c000000896c242041ff92c8010000ffc64883c7083bb31c02000072ca'),
    ('resolve_before_postprocess', 0x14159c40a, '488bcbe86ecd06004180fc010f856e01000083be2c050000017608488bcbe863cb0600'),
    ('main_scene_draw_between_bind_and_glow', 0x140d7108f, 'e87cd77f00488b30e8b4aa820041b8000000ff488bd6488bc8e8639b820033d2448d4240498bcfe8f511beff'),
    ('main_postprocess_same_target', 0x140d71110, 'e8fbd67f00488b30e833aa8200488bc841b1014c8bc6410fb6d1e881b28200e8dcd67f00c644242800c7442420000000ff4533c94533c0418d5101488bc8e88d4e8000'),
    ('conditional_independent_blending', 0x14161bf25, '8b4308c74304010000004489432c895330c7434801000000c7434c05000000894328c7435006000000'),
    ('create_blend_state_after_rewrite', 0x14161bf5e, 'e8fd8919004c8d442468488bd34c8b08488bc841ff91a0000000'),
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


def audit(workspace, executable, *, width=1920, height=1080):
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
                    formula='base.rgb + blur.rgb * strength', alpha='base alpha preserved', original_glow_or_hdr=False,
                    comparison=dict(mode='source', levels=5, surface_emission='separated', alpha='preserved', scope='partial mode1 structure; viewer material depth/blending')),
        first_input=dict(status='slot-association-verified', slot=1,
                         texture_array='target+0x50+8*slot', srv_array='target+0x1a0+8*slot',
                         rtv_array='target+0xe0+8*slot (single sample) / target+0x120+8*slot (MSAA)',
                         msaa='resolve target+0x90+8*slot into target+0x50+8*slot before postprocess',
                         normal_avatar_formula='E=sample(t12)*CB5[16]*CB5[17].x*CB5[17].y; target0=surface; target1=E',
                         zero_rgb_alpha='if all E.rgb==0: target1=(0,0,0,E.a>0?surface.a:1)',
                         exception='NOLIGHT refraction branch (CB5[23].x>0) writes sampled t9 to target1',
                         scope='shader output before per-target blend/depth/UNORM; not the complete scene MRT1',
                         viewer_difference='viewer adds emission to surface and keeps a separate RGB-only bloom mask',
                         example=avatar_mrt([.1,.2,.3,.4],[.2,.4,.6,.8],[.5,.5,.5,.5],2,.5)),
        blend_state=dict(status='conditional-independent-target-rewrite-verified',
                         independent_blend_enable=True,
                         target1='copies target0 blend enable/source/destination factors in investigated branch',
                         target2='enables source-alpha / inverse-source-alpha in investigated branch',
                         runtime_per_draw_state='unresolved; do not apply one universal alpha formula'),
        blur_path=dict(size_divisors=[2, 4, 8, 16, 32], integer_division=True,
                       direct_glow_call_mode=1,
                       formula='k=i-4; offset=(k/targetWidth,k/targetHeight); weight=exp(-((k/sigma)^2)/(2*sigma^2))/sqrt(float32(2*pi)*sigma^2)',
                       normalization='none after constructing the nine weights',
                       reset_values=dict(level_count=5, sigma=1, mode=0),
                       mode1_first_input='source SRV +0x1a8, then previous vertical target +0x1a0',
                       mode2_first_input='source SRV +0x1a0, then previous vertical target +0x1a0',
                       resource_key_note='key 2 uses 390x730 dimensions; resource key and Glow mode are separate inputs',
                       examples=[blur_plan(width, height), blur_plan(width, height, resource_key=2, mode=2)]),
        unresolved=['Other Glow mode callers, effective level count and sigma overrides',
                    'Per-target blending, depth and other scene writers to MRT1; optional preceding effects',
                    'HDR/GetBright active dispatch and constant upload', 'In-game frame comparison'],
        game_executed=False, rendering_enabled=False, viewer_defaults_changed=False,
    )


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workspace', required=True, type=Path)
    parser.add_argument('--exe', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--width', type=int, default=1920)
    parser.add_argument('--height', type=int, default=1080)
    args = parser.parse_args()
    try:
        report = audit(args.workspace, args.exe, width=args.width, height=args.height)
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    except (ValueError, OSError, struct.error) as exc:
        parser.exit(1, str(exc) + '\n')
    print(json.dumps(dict(cpu_checks=len(report['cpu']['checks']), shaders=len(report['shaders']), rendering_enabled=False)))
