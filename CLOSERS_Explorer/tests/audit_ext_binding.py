"""Fingerprint-bound EXT activation audit; never executes the game or Lua."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import sys

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from audit_output_color import SOURCE_SHA256
from closers.ext_binding import world_ext_objects

EVIDENCE=(
    ('world_objects_field',0x1425d2458,b'm_vecWorldObjData\0'.hex()),
    ('activation_field',0x1425d33e0,b'm_bUseExt\0'.hex()),
    ('intensity_field',0x1425d33c8,b'm_fUseExtIntensity\0'.hex()),
    ('world_object_loader',0x141683868,'4c 8d 83 e9 01 00 00 48 8d 15 6a fb f4 00 48 8b cf e8 82 46 19 00 4c 8d 83 ec 01 00 00 48 8d 15 3c fb f4 00 48 8b cf e8 1c 70 19 00'),
    ('default_disabled_intensity_one',0x1416774c5,'66 c7 87 e8 01 00 00 01 00 c7 87 ec 01 00 00 00 00 80 3f'),
    ('runtime_embeds_world_template',0x141683f7d,'48 8d 8d c8 01 00 00 e8 b7 35 ff ff'),
    ('first_upload_guard_and_factor',0x14167c106,'80 bb b1 03 00 00 01 75 10 f3 0f 10 83 b4 03 00 00 f3 0f 11 05 e1 e9 91 01'),
    ('second_upload_guard_and_factor',0x14167e493,'80 bb b1 03 00 00 01 75 10 f3 0f 10 83 b4 03 00 00 f3 0f 11 05 54 c6 91 01'),
    ('renderer_activation_state',0x14167e305,'44 38 b3 b1 03 00 00 74 12 e8 dd e2 f7 ff 0f b6 8b b1 03 00 00 88 88 60 01 00 00'),
)


def audit(executable):
    body=Path(executable).read_bytes();digest=hashlib.sha256(body).hexdigest()
    if digest!=SOURCE_SHA256:raise ValueError('Unrecognized CW.EXE SHA256; EXT evidence requires a new investigation.')
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
                scope='world-object-template',source_path='WORLD_TEMPLET.m_vecWorldObjData',
                flag=dict(field='m_bUseExt',template_offset='0x1e9',runtime_offset='0x3b1',default=False),
                intensity=dict(field='m_fUseExtIntensity',template_offset='0x1ec',runtime_offset='0x3b4',default=1),
                upload='0x142f9ab00; CBPerMaterial[18].x',avatar_binding='unresolved',game_executed=False,rendering_enabled=False)


def worlds(workspace,names):
    from closers.catalog import Catalog
    from closers.loading import LoadingData
    data=LoadingData(Catalog(workspace));result=[]
    for name in names:
        try:
            report=world_ext_objects(data.body(name))
            report.update(name=name,sources=[dict(entry=r['id'],archive=r['archive'],ordinal=r['ordinal']) for r in data.rows(name)])
            result.append(report)
        except ValueError as exc:result.append(dict(name=name,status='unresolved',reason=str(exc)))
    return result


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--exe',required=True,type=Path);parser.add_argument('--workspace',type=Path)
    parser.add_argument('--source',action='append');parser.add_argument('--output',type=Path)
    args=parser.parse_args()
    try:
        report=audit(args.exe)
        if args.workspace and report['status']=='verified':
            from closers.world_lighting import REGIONS
            report['worlds']=worlds(args.workspace,args.source or [name for name,_ in REGIONS])
        text=json.dumps(report,ensure_ascii=False,indent=2)
        if args.output:args.output.write_text(text+'\n',encoding='utf-8')
    except (OSError,ValueError,struct.error) as exc:parser.exit(1,str(exc)+'\n')
    print(json.dumps(dict(status=report['status'],checks=len(report['checks']),worlds=len(report.get('worlds',[])),avatar_binding=report['avatar_binding'],rendering_enabled=False)))
    raise SystemExit(0 if report['status']=='verified' else 1)
