"""Recheck investigated DOF shader/CPU paths without executing game or Lua."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import struct
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from audit_bloom import cpu_evidence, shader_sources
from closers.catalog import Catalog
from closers.loading import LoadingData
from closers import ntf
from closers.color_grading import SOURCE, TYPES, read_presets
from dof_reference import depth_encoding, sampling_offsets

SHADERS = {
    'CW_DEPTHOFFIELD.PS.CSO': '99c8e04196979f40644a256729d0130dc643aeedc4c65f7467122f35cfccbe72',
    'CW_BLUR_HORIZON_DOF.PS.CSO': 'a66cab9d22d4f53a842a340f9d98af6158b51361ff57a25901b6634b9e82e47c',
    'CW_BLUR_VERTICAL_DOF.PS.CSO': '5b64415466127603a251733aba9ecd4dfa543dfe5e5fea39778f9a0c6180e29f',
    'CW_DEFAULT.PS.CSO': 'c128360275e910029de5f05742c3e40df03db9b3be138d4871e3866798f43eaa',
    'CW_DEFAULT.VS.CSO': '4f52cde45ab22b6a1a679297491b4187fe4a12e477841cdac15d7656b701d600',
}
EVIDENCE = (
    ('runtime_dof_bit2_enable', 0x14009246b, '4180be8201000001750983889002000004eb0783a090020000fb'),
    ('fallback_disables_dof', 0x1406c2369, 'c6838201000000e89bc4ea0080bb8201000001750983889002000004eb0783a090020000fb'),
    ('bit2_dispatch', 0x1415760a8, '8b8b900200008bc1c1e802a801743c'),
    ('dof_dispatch_call', 0x1415760cf, '8b4424704c8bcf4c8bc6418bd4488bcb40886c242889442420e803b6ffff'),
    ('dof_mode3', 0x1415717c7, 'c7867802000003000000'),
    ('dof_blur_techniques', 0x141571919, 'c74424380e000000c74424300d000000'),
    ('dof_blur_call', 0x14157193e, 'ba03000000488bcee835f2ffff'),
    ('dof_final_technique15', 0x141571981, 'e86aac0800488bc8ba0f000000e87db20800'),
    ('dof_base_srv0', 0x141571993, '498b9ea0010000'),
    ('dof_blur_second_vertical', 0x141571b1d, '498b442420488b4008488bb8a0010000'),
    ('dof_depth_srv2', 0x141571c92, '498bbeb0010000'),
    ('dof_horizontal_registration', 0x141606ba5, '488d15d4ecfb00488bcbe85ceeffff'),
    ('dof_vertical_registration', 0x141606bc6, '488d157becfb00488bcbe83beeffff'),
    ('dof_final_registration', 0x141606be7, '488d152aecfb00488bcbe81aeeffff'),
    ('dof_constant_bit2_gate', 0x141674b42, 'e8c99cefff8b8890020000c1e902f6c1010f8409010000'),
    ('dof_lookup_key_and_fallback', 0x141674b6d, '4c8d4424288bd3488bc8e894d6efff84c07514e88b9cefff488bc84c8d44242833d2e87cd6efff'),
    ('dof_missing_constants_zeroed', 0x141674ba0, 'f30f1135085d9201f30f1135045d9201f30f1135005d9201f30f1135fc5c9201f30f1135f81b9401f30f1135f41b9401f30f1135f01b9401f30f1135ec1b9401eb62'),
    ('dof_depth_global_constants', 0x141674be2, 'f30f1000f30f1105c25c9201f30f104804f30f110db95c9201f30f104008f30f1105b05c9201f30f10480cf30f110da75c9201'),
    ('dof_post_constants', 0x141674c15, 'f30f104010f30f11059e1b9401f30f104810f30f590d497ed300f30f110d8d1b9401f30f104018f30f1105841b9401'),
    ('blur_dof_depth_source_first_pass', 0x14157086c, '83be78020000037538488b86a00200004885c0742c85db75284c8ba8b0010000e85fbd0800488b48284885c97413448d4b044d8bc5488d15c8460401e8b3ab0800'),
)


def audit(workspace, executable):
    cpu = cpu_evidence(executable, EVIDENCE)
    shaders = shader_sources(workspace, SHADERS)
    data = LoadingData(Catalog(workspace))
    body = data.body(SOURCE)
    if ntf.header(body)[0] != TYPES:
        raise ValueError('Unrecognized graphic option schema.')
    rows = []
    for i, row in enumerate(ntf.rows(body)):
        if row[0] != 2:
            continue
        values = [struct.unpack('<f', struct.pack('<I', bits))[0] for bits in row[5:15]]
        if not all(math.isfinite(v) for v in values):
            raise ValueError('Non-finite original DOF table values.')
        rows.append(dict(row=i, key=row[1], numeric_columns=list(range(5, 15)), values=values))
    if not rows or len({r['key'] for r in rows}) != len(rows):
        raise ValueError('Missing or duplicate original DOF parameter rows.')
    return dict(cpu=cpu, shaders=shaders,
                activation=dict(bit=2, runtime_flag_offset='0x182', exact_enabled_value=1, technique=15,
                                order='Glow -> Edge -> DOF -> other optional passes -> ColorGrading',
                                fallback_can_disable=True, runtime_state_read=False),
                inputs=dict(base='current color SRV+0x1a0', blurred='second vertical blur target SRV+0x1a0',
                            depth='current encoded color MRT2 SRV+0x1b0; not hardware z-buffer'),
                constants=dict(depth='CBPerGlobal[8] <- looked-up vector floats 0..3',
                               post='CBPerPostProcess[27].xyz <- vector[4], 2*vector[4], vector[6]',
                               post_w='debug branch; populated upload does not assign it in investigated block',
                               missing='both vectors zeroed; not an invented neutral preset',
                               lookup='current key then key 0 fallback',
                               sample_size='CBPerPostProcess[25].xy; effective final value needs further tracing'),
                source=dict(file=SOURCE, sha256=hashlib.sha256(body).hexdigest(), category=2, rows=rows,
                            row_to_runtime_vector='full construction not established by this audit'),
                presets=[dict(key=p['key'], dof=p['other_postprocess']['depth_of_field']) for p in read_presets(data)],
                shader=dict(sample_count=8, depth_encoding='signed near/far focus-relative value mapped by 0.5*x+0.5',
                            normal_alpha=1, debug='near green / far blue tint; diagnostic only'),
                examples=dict(scope='explicit diagnostic inputs, not game state',
                              depth=[depth_encoding(z, [0, 1000, 6000, .5]) for z in (0, 1000, 3500, 6000)],
                              offsets=sampling_offsets(.75, [1920, 1080], [.5, 1, 1, 0])),
                unresolved=['Live focus/activation and per-character override selection',
                            'Full table-to-vector construction and effective final render-size constant',
                            'Scene-wide MRT2 writers, blending/depth and special effects',
                            'Viewer depth encoding and alpha-preserving GPU comparison', 'In-game frame parity'],
                game_executed=False, rendering_enabled=False, viewer_defaults_changed=False)


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
