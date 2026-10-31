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
    ('renderer_default_ext_on',0x14160554f,'c6 86 60 01 00 00 01'),
    ('renderer_creation_and_global',0x141605932,'48 8b c8 e8 96 fb ff ff 90 48 89 05 96 34 99 01'),
    ('renderer_getter_global',0x1415fc630,'48 8b 3d a1 c7 99 01'),
    ('avatar_bind_call',0x141749a50,'4d 8b cc 45 33 c0 33 d2 48 8b c8 e8 10 91 fc ff'),
    ('binding_gate',0x141712bb6,'e8 35 9a ee ff 80 b8 60 01 00 00 01 75 1e'),
    ('binding_original',0x141712bd2,'4c 8b 87 b0 00 00 00 4d 8b 80 18 01 00 00 eb 30'),
    ('binding_fallback',0x141712be2,'e8 09 9a ee ff 48 8b 88 e8 00 00 00 48 8b 99 b0 00 00 00 48 85 db 74 07 48 8b 9b 08 01 00 00'),
    ('binding_name',0x1425e7db8,b'g_tSpecularMap\0'.hex()),
    ('world_flag_restore',0x14167c1c9,'e8 22 04 f8 ff 40 88 b8 60 01 00 00'),
    ('material_reset_gap',0x1416006de,'f3 0f 11 3d 0e a4 99 01 f3 0f 11 35 82 a4 99 01 f3 0f 11 35 7e a4 99 01 f3 0f 11 35 7a a4 99 01 f3 0f 11 3d 76 a4 99 01 f3 0f 11 3d 72 a4 99 01 f3 0f 11 35 6e a4 99 01 f3 0f 11 35 6a a4 99 01 f3 0f 11 35 66 a4 99 01 f3 0f 11 35 b2 a2 99 01'),
)


def audit(executable):
    body=Path(executable).read_bytes();digest=hashlib.sha256(body).hexdigest()
    if digest!=SOURCE_SHA256:raise ValueError('Unrecognized CW.EXE SHA256; EXT evidence requires a new investigation.')
    pe=struct.unpack_from('<I',body,0x3c)[0];optional=pe+24
    count=struct.unpack_from('<H',body,pe+6)[0];size=struct.unpack_from('<H',body,pe+20)[0]
    base=struct.unpack_from('<Q',body,optional+24)[0];sections=[];zero_fill=[]
    for i in range(count):
        virtual,rva,raw,offset=struct.unpack_from('<IIII',body,optional+size+i*40+8)
        sections.append((rva,min(virtual,raw),offset))
        if virtual>raw:zero_fill.append((rva+raw,rva+virtual))
    checks=[]
    for name,va,hex_bytes in EVIDENCE:
        expected=bytes.fromhex(hex_bytes);relative=va-base
        section=next((s for s in sections if s[0]<=relative and relative+len(expected)<=s[0]+s[1]),None)
        if section is None:raise ValueError('Evidence outside file-backed sections.')
        offset=section[2]+relative-section[0]
        checks.append(dict(name=name,address=hex(va),matches=body[offset:offset+len(expected)]==expected))
    # This address is beyond .data's raw file contents. Never treat a pefile
    # offset for the virtual tail as file-backed bytes from a different section.
    relative=0x142f9ab00-base
    checks.append(dict(name='factor_is_pe_zero_fill',address='0x142f9ab00',matches=any(a<=relative and relative+4<=z for a,z in zero_fill)))
    return dict(sha256=digest,status='verified' if all(c['matches'] for c in checks) else 'mismatch',checks=checks,
                scope='world-object-template',source_path='WORLD_TEMPLET.m_vecWorldObjData',
                flag=dict(field='m_bUseExt',template_offset='0x1e9',runtime_offset='0x3b1',default=False),
                intensity=dict(field='m_fUseExtIntensity',template_offset='0x1ec',runtime_offset='0x3b4',default=1),
                upload='0x142f9ab00; CBPerMaterial[18].x',avatar_binding='unresolved',
                avatar_path=dict(status='source-verified',texture_gate='renderer+0x160',default_gate=True,
                                 original_resource='material+0xb0 -> resource+0x118',fallback_resource='renderer+0xe8 -> resource+0x108',
                                 initial_factor=0,initial_factor_basis='PE zero-fill before runtime initialization',factor_scope='shared-render-state',live_factor='unresolved',
                                 reset='0x1416002b0 does not directly reset factor; inspected world flag restore does not restore factor'),
                game_executed=False,rendering_enabled=False)


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
