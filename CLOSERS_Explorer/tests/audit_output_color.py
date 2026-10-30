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
        checks=checks, scope='Investigated normal device creation and back-buffer RTV path only.',
        unresolved=['Runtime scene flags and color-grading values',
                    'Complete postprocess shader mapping and final presentation path',
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
