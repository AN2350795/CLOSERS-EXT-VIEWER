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
                           staging_buffer='0x142fb6610', constant_offset=448,
                           first_vector=['exposure_fixed_0', 'contrast', 'saturation', 'brightness'],
                           second_vector=['red', 'green', 'blue', 'unused'],
                           empty_data_defaults=[[0, 0, 1, 0], [1, 1, 1, 0]]),
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
