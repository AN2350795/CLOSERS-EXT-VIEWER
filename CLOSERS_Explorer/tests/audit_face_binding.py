"""Recheck the fingerprint-bound SDF head-frame chain without running CW.EXE."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
from audit_output_color import SOURCE_SHA256


EVIDENCE = (
    ('head_name_slot_7', 0x141758ec3, '4c 8d 1d fe 16 ce 00 4c 89 5d e8 c7 45 f0 07 00 00 00'),
    ('head_name_literal', 0x14243a5c8, 'BIP01_HEAD\0'.encode('utf-16-le').hex()),
    ('name_enum_to_frame', 0x1417514a3, '8b 47 40 89 83 c8 00 00 00'),
    ('frame_to_slot_array', 0x14174e024, '48 63 87 c8 00 00 00 85 c0 74 15 48 8b d0 48 8b 86 d0 00 00 00 48 8b 88 88 00 00 00 48 89 3c d1'),
    ('sdf_reads_slot_7', 0x141749ab2, '49 8b 85 d0 00 00 00 48 8b 88 88 00 00 00 48 8b 41 38 48 85 c0 74 6c'),
    ('sdf_reads_world_matrix', 0x141749ac9, '0f 10 60 70 0f 10 80 80 00 00 00 0f 10 98 90 00 00 00 0f 10 88 a0 00 00 00'),
    ('slot_array_has_39_entries', 0x141753750, '83 ff 27'),
)


def audit(executable):
    data = Path(executable).read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if digest != SOURCE_SHA256:
        raise ValueError('Unrecognized CW.EXE SHA256; head-frame evidence requires a new investigation.')
    pe = struct.unpack_from('<I', data, 0x3c)[0]
    count = struct.unpack_from('<H', data, pe+6)[0]
    optional = pe+24
    optional_size = struct.unpack_from('<H', data, pe+20)[0]
    base = struct.unpack_from('<Q', data, optional+24)[0]
    sections = []
    for i in range(count):
        virtual_size, rva, raw_size, offset = struct.unpack_from('<IIII', data, optional+optional_size+i*40+8)
        sections.append((rva, min(virtual_size, raw_size), offset))
    checks = []
    for name, va, expected_hex in EVIDENCE:
        expected = bytes.fromhex(expected_hex)
        relative = va-base
        section = next((s for s in sections if s[0] <= relative and relative+len(expected) <= s[0]+s[1]), None)
        if section is None:
            raise ValueError('Evidence address is outside file-backed sections.')
        offset = section[2]+relative-section[0]
        checks.append(dict(name=name, address=hex(va), matches=data[offset:offset+len(expected)] == expected))
    return dict(sha256=digest, status='verified' if all(c['matches'] for c in checks) else 'mismatch',
                checks=checks, frame='BIP01_HEAD', slot=7, matrix='frame-world', game_executed=False,
                note='Static binding chain only; in-game appearance and unrelated shader parameters remain unverified.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--exe', required=True, type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    try:
        report = audit(args.exe)
    except (OSError, ValueError, struct.error) as exc:
        parser.exit(1, str(exc)+'\n')
    body = json.dumps(report, indent=2)
    if args.output:
        args.output.write_text(body+'\n', encoding='utf-8')
    print(body)
    raise SystemExit(0 if report['status'] == 'verified' else 1)
