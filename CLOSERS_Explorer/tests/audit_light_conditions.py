"""Fingerprint-bound skin light column audit; never executes the game."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
from audit_output_color import SOURCE_SHA256


EVIDENCE = (
    ('skin_light_enum_literal',0x1427effa0,'SCT_LIGHT\0'.encode('utf-16-le').hex()),
    ('skin_light_enum_is_5',0x141880e4f,'4c 8d 05 4a f1 f6 00 48 8b c8 ba 05 00 00 00 e8 3d 62 78 fe'),
    ('column_12_to_record_offset_6c',0x140ec9479,'44 8b 4b 30 4c 8d 45 0c 48 8d 54 24 30 48 8b c8 e8 52 37 cb 00'),
    ('copy_preserves_offset_6c',0x140ea2c5f,'0f b7 47 6c 66 89 46 6c'),
    ('record_offset_6c_registers_type_5',0x140ec77e6,'45 0f b7 46 3c ba 05 00 00 00 49 8b cf e8 58 f8 ff ff'),
    ('light_template_dispatches_type_5',0x140ec8321,'44 0f b7 43 20 ba 05 00 00 00 49 8b ce e8 ed 16 ff ff'),
)


def audit(executable):
    body=Path(executable).read_bytes();digest=hashlib.sha256(body).hexdigest()
    if digest!=SOURCE_SHA256:raise ValueError('Unrecognized CW.EXE SHA256; skin light evidence requires a new investigation.')
    pe=struct.unpack_from('<I',body,0x3c)[0];optional=pe+24
    count=struct.unpack_from('<H',body,pe+6)[0];size=struct.unpack_from('<H',body,pe+20)[0]
    base=struct.unpack_from('<Q',body,optional+24)[0];sections=[]
    for i in range(count):
        virtual,rva,raw,offset=struct.unpack_from('<IIII',body,optional+size+i*40+8)
        sections.append((rva,min(virtual,raw),offset))
    checks=[]
    for name,va,hex_bytes in EVIDENCE:
        expected=bytes.fromhex(hex_bytes);relative=va-base
        section=next((s for s in sections if s[0]<=relative and relative+len(expected)<=s[0]+s[1]),None)
        if section is None:raise ValueError('Evidence outside file-backed sections.')
        offset=section[2]+relative-section[0]
        checks.append(dict(name=name,address=hex(va),matches=body[offset:offset+len(expected)]==expected))
    return dict(sha256=digest,status='verified' if all(c['matches'] for c in checks) else 'mismatch',checks=checks,
                table='NEW_CONVERT_TEMPLET.NTF',column=12,enum='SCT_LIGHT',enum_value=5,
                game_executed=False,unresolved=['runtime selected skin','runtime priority','content activation','in-game appearance'])


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--exe',required=True,type=Path);parser.add_argument('--output',type=Path)
    args=parser.parse_args()
    try:report=audit(args.exe)
    except (OSError,ValueError,struct.error) as exc:parser.exit(1,str(exc)+'\n')
    text=json.dumps(report,indent=2)
    if args.output:args.output.write_text(text+'\n',encoding='utf-8')
    print(text)
    raise SystemExit(0 if report['status']=='verified' else 1)
