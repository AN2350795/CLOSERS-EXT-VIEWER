"""Recheck the investigated CW.EXE output path without executing the game.

This is a fingerprint-bound evidence check, not a general binary analyzer.
Addresses and their interpretation are documented in AVATAR_OUTPUT_COLOR.md.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct


SOURCE_SHA256 = '8ea0ce3ba885f3044103c8e071e627b52a0e93cf56cc44b0e03dffed7c440283'
EVIDENCE = (
    ('graphic_preset_numeric_columns_5_to_14', 0x1406dd4dd,
     '89 85 98 02 00 00 4c 8d a5 9c 02 00 00 41 be 0a 00 00 00 48 8b b5 f0 01 00 00 '
     'e8 94 e0 49 01 46 8b 0c ae 4d 8b c4'),
    ('graphic_preset_color_values_start', 0x1400928f2, 'f3 0f 10 44 38 64 f3 0f 11 44 24 48'),
    ('graphic_preset_range_and_positive_count', 0x14009297c,
     '0f 2f ca 77 13 0f 2f d5 77 0e 0f 2f d6 f3 0f 11 17 76 60 41 ff c7 eb 5b'),
    ('graphic_preset_color_assignment_and_activation', 0x140092a11,
     'f3 0f 10 45 b0 f3 0f 10 4d b4 32 c0 45 85 ff 0f b6 c0 41 0f 4f c4 40 32 ff '
     'f3 0f 11 83 ac 00 00 00 f3 0f 10 45 b8 f3 0f 11 8b b0 00 00 00 88 83 ab 00 00 00 '
     '48 8b 45 98 f3 0f 10 4d bc f3 0f 11 83 b4 00 00 00 f3 0f 10 45 c0 f3 0f 11 8b b8 00 00 00 '
     'f3 0f 10 4d c4 f3 0f 11 83 bc 00 00 00 f3 0f 11 8b c0 00 00 00'),
    ('default_format_28', 0x1417b6475, 'c7 43 28 1c 00 00 00'),
    ('validated_format_28', 0x1417b6733, 'c7 46 28 1c 00 00 00'),
    ('swap_chain_format_28', 0x1417bc979, 'c7 45 d8 1c 00 00 00'),
    ('app_settings_callback_registration', 0x14001906e,
     '48 8d 0d 9b 93 fe ff 33 d2 e8 94 f5 79 01'),
    ('app_settings_callback_body', 0x140002410,
     '48 83 ec 28 80 3d ec 7d f6 02 00 74 19 83 39 00 c6 05 e0 7d f6 02 00 '
     '75 0d 83 79 0c 02 75 07 33 c9 e8 aa 45 7e 01 b0 01 48 83 c4 28 c3'),
    ('rtv_format_from_current_settings', 0x1417bc328,
     '8b 45 98 44 89 74 24 60 89 44 24 58 48 8b 03 0f 29 45 d0 0f 29 4d e0 ff 50 48'),
    ('initial_rtv_call', 0x1417bd1db, 'e8 70 f0 ff ff'),
    ('resize_rtv_call', 0x1417bd8ee, 'e8 5d e9 ff ff'),
    ('gamma_flag_constructor_default', 0x1417af2bd, 'c6 83 97 04 00 00 01'),
    ('separate_srgb_conversion_branch', 0x1417c67c6, 'b8 1d 00 00 00'),
    ('color_grading_activation_bit_5', 0x1406d4ec0,
     '80 bf ab 00 00 00 01 75 09 83 88 90 02 00 00 20 eb 07 83 a0 90 02 00 00 df'),
    ('color_grading_final_pass_dispatch', 0x141576132,
     '8b 83 90 02 00 00 c1 e8 05 a8 01 74 1e 8b 44 24 70 4d 8b cd 4c 8b c6 '
     '41 8b d4 48 8b cb 40 88 6c 24 28 89 44 24 20 e8 c3 bd ff ff'),
    ('color_grading_technique_16', 0x141571fbf, 'ba 10 00 00 00 e8 47 ac 08 00'),
    ('color_grading_shader_registration', 0x141606bfb,
     '41 b9 04 00 00 00 4c 8d 05 b8 f4 fb 00 48 8d 15 d9 eb fb 00 48 8b cb e8 f9 ed ff ff'),
    ('color_grading_shader_name', 0x1425c57e8, ('CW_ColorGrading.PS.cso\0').encode('utf-16-le').hex()),
    ('postprocess_staging_buffer_table_entry', 0x141602670, '27 25 60 01'),
    ('postprocess_staging_buffer_address', 0x141602527,
     '48 8d 05 e2 40 9b 01 4a 89 84 db 70 01 00 00'),
    ('color_grading_constant_update_gate', 0x141674a56,
     'e8 b5 9d ef ff 8b 88 90 02 00 00 c1 e9 05 33 ff f6 c1 01 0f 84 d3 00 00 00'),
    ('color_grading_empty_data_defaults', 0x141674a8b,
     'f3 0f 11 35 3d 1d 94 01 48 3b 4c 24 30 75 42 f3 0f 11 35 32 1d 94 01 '
     'f3 0f 10 05 12 58 d2 00 f3 0f 11 05 26 1d 94 01 f3 0f 11 35 22 1d 94 01 '
     'f3 0f 11 05 1e 1d 94 01 f3 0f 11 05 1a 1d 94 01 f3 0f 11 05 16 1d 94 01 '
     'f3 0f 11 35 12 1d 94 01 eb 4d'),
    ('color_grading_populated_data_mapping', 0x141674adc,
     'f3 0f 10 41 10 f3 0f 11 05 eb 1c 94 01 f3 0f 10 49 14 f3 0f 11 0d e2 1c 94 01 '
     'f3 0f 10 41 0c f3 0f 11 05 d9 1c 94 01 f3 0f 10 09 f3 0f 11 0d d1 1c 94 01 '
     'f3 0f 10 41 04 f3 0f 11 05 c8 1c 94 01 f3 0f 10 49 08 f3 0f 11 0d bf 1c 94 01'),
    ('option_preset_id',0x1406cb949,'4c 8d 87 cc 00 00 00 48 8d 15 d1 45 d8 01 48 8d 4d f0 e8 70 e4 14 01'),
    ('preset_bloom_write',0x140092875,'0f 2e c6 7a 04 75 02 b3 01 88 9f a9 00 00 00'),
    ('preset_dof_write',0x1400928b2,'0f 2e ee 7a 04 75 02 b3 01 0f 57 f6 45 33 ff 49 8b c4 88 9f aa 00 00 00'),
    ('preset_flag_comparison_one',0x14239a2bc,'00 00 80 3f'),
    ('preset_sharpen_value',0x140092a78,'f3 0f 10 40 7c f3 0f 11 44 24 40'),
    ('preset_sharpen_enable',0x140092b8d,'f3 0f 10 44 24 40 0f 2f c6 0f 28 b4 24 f0 00 00 00 76 04 41 0f b6 fc 48 8b 4d 90 40 88 bb c4 00 00 00'),
    ('world_screen_list',0x141678c86,'48 8d 15 ab 98 f5 00 48 8b cf e8 6b f1 19 00'),
    ('world_screen_texture',0x141673c03,'4c 8b c1 48 8d 15 23 59 ec 00 45 33 c9 48 8b cf 0f 29 74 24 30 e8 83 52 1a 00'),
    ('sharpen_activation_and_radius',0x1406d4f39,'80 bf c4 00 00 00 01 75 38 e8 c9 98 e9 00 80 bf c4 00 00 00 01 75 09 83 88 90 02 00 00 40 eb 07 83 a0 90 02 00 00 bf 80 bf c4 00 00 00 01 75 11 e8 a2 98 e9 00 8b 8f c8 00 00 00 89 88 18 03 00 00'),
    ('sharpen_constant_update',0x141674c62,'e8 a9 9b ef ff 8b 88 90 02 00 00 c1 e9 06 f6 c1 01 74 15 e8 96 9b ef ff f3 0f 10 80 18 03 00 00 f3 0f 11 05 66 1b 94 01'),
    ('sharpen_technique_10',0x14157238c,'e8 5f a2 08 00 48 8b c8 ba 0a 00 00 00 e8 72 a8 08 00'),
    ('sharpen_shader_registration',0x141606b36,'b9 04 00 00 00 4c 8d 05 f6 ed fb 00 48 8d 15 cf ed fb 00 48 8b cb'),
    ('sharpen_shader_name',0x1425c5918,'CW_Edge.PS.cso\0'.encode('utf-16-le').hex()),
    ('sharpen_before_later_passes',0x141576094,'40 88 6c 24 28 89 44 24 20 e8 4e c2 ff ff 48 8b f7 49 8b fd'),
    ('postprocess_target_format28',0x1415743b1,'c7 85 90 01 00 00 1c 00 00 00'),
    ('sharpen_target_assignment',0x141575354,'48 8d 95 60 01 00 00 48 8b c8 e8 4d 5e 09 00 90 49 89 84 24 10 03 00 00'),
    ('sharpen_input_dimensions',0x141572528,'8b 46 30 66 0f ef c9 f3 48 0f 2a c8 8b 46 34 66 0f ef c0 f3 48 0f 2a c0 f3 0f 11 0d 58 42 a4 01 f3 0f 11 05 54 42 a4 01 f3 0f 11 35 50 42 a4 01 f3 0f 11 35 4c 42 a4 01'),
    ('sharpen_bit6_dispatch',0x141576051,'8b 8b 90 02 00 00 49 8b fd 8b c1 c1 e8 06 a8 01 74 45'),
)


def audit(executable):
    data = Path(executable).read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if digest != SOURCE_SHA256:
        raise ValueError('Unrecognized CW.EXE SHA256; address-based conclusions require a new investigation.')
    pe = struct.unpack_from('<I', data, 0x3c)[0]
    section_count = struct.unpack_from('<H', data, pe + 6)[0]
    optional_size = struct.unpack_from('<H', data, pe + 20)[0]
    optional = pe + 24
    image_base = struct.unpack_from('<Q', data, optional + 24)[0]
    sections = []
    for index in range(section_count):
        header = optional + optional_size + index * 40
        virtual_size, rva, raw_size, raw_offset = struct.unpack_from('<IIII', data, header + 8)
        sections.append((rva, min(virtual_size, raw_size), raw_offset))
    checks = []
    for name, address, expected_hex in EVIDENCE:
        expected = bytes.fromhex(expected_hex)
        relative = address - image_base
        section = next((s for s in sections if s[0] <= relative and relative + len(expected) <= s[0] + s[1]), None)
        if section is None:
            raise ValueError(f'Address outside file-backed sections: {address:#x}')
        offset = section[2] + relative - section[0]
        actual = data[offset:offset + len(expected)]
        checks.append(dict(name=name, address=hex(address), matches=actual == expected))
    return dict(
        sha256=digest, status='verified' if all(c['matches'] for c in checks) else 'mismatch',
        checks=checks, scope='Normal back-buffer RTV path and the conditional color-grading pass.',
        color_grading=dict(activation_bit=5, technique=16, shader='CW_ColorGrading.PS.cso',
                           preset_source='GRAPHIC_OPTION_DATA_DETAIL.NTF', preset_color_columns=[7,8,9,10,11,12],
                           staging_buffer='0x142fb6610', constant_offset=448,
                           first_vector=['exposure_fixed_0', 'contrast', 'saturation', 'brightness'],
                           second_vector=['red', 'green', 'blue', 'unused'],
                           empty_data_defaults=[[0, 0, 1, 0], [1, 1, 1, 0]]),
        preset_scope=dict(selection='graphics-option',category=5,color_columns=list(range(7,13)),
                          other_columns=dict(bloom=5,depth_of_field=6,sharpen=13),other_effects_applied=False,
                          world_screen_effect='texture/blend/color inputs; not a verified color-preset selector'),
        sharpen=dict(activation_bit=6,technique=10,shader='CW_Edge.PS.cso',coefficient='sampling radius in target pixels',
                     runtime_offset='0x318',constant='CBPerPostProcess[30].x',target_format=28,
                     order='Glow -> Edge -> later optional passes -> ColorGrading',
                     source_formula='2*center - sum(eight neighbors)/8; all RGBA channels',viewer_alpha='preserved'),
        unresolved=['Runtime scene activation, preset overrides and effective color-grading values',
                    'Remaining postprocess shader mapping and final presentation path',
                    'In-game image parity'],
        game_executed=False, viewer_defaults_changed=False,
    )


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--exe', required=True, type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    try:
        result = audit(args.exe)
    except (OSError, ValueError, struct.error) as exc:
        parser.exit(1, f'{exc}\n')
    body = json.dumps(result, ensure_ascii=False, indent=2)
    if args.output:
        args.output.write_text(body + '\n', encoding='utf-8')
    print(body)
    raise SystemExit(0 if result['status'] == 'verified' else 1)
