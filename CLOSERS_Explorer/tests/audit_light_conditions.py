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
    ('runtime_reads_selected_type_5',0x140a9eeb9,'45 33 c0 41 8d 50 05 49 8b cc e8 28 2e 02 00 0f b7 d0 48 8b cb e8 8d fa 7f ff'),
    ('selected_values_map',0x140ac1d47,'4c 8b 41 10 49 8b 88 a0 01 00 00 48 8b 41 08'),
    ('selected_value_or_zero',0x140ac1d9f,'49 3b 80 a0 01 00 00 0f 84 72 ff ff ff 0f b7 40 1c 48 83 c4 18 c3'),
    ('selected_template_to_byte_light_id',0x14029e970,'e8 3b d1 bf 00 48 8b c8 0f b7 d3 e8 b0 0e c0 00 48 85 c0 74 5c 48 8b 4f 28 0f b6 50 29'),
    ('light_table_map_swap',0x140eca726,'49 8d 90 a8 00 00 00 4d 8d 88 08 03 00 00 4c 3b ca 74 20'),
    ('missing_skin_does_not_override',0x140a9eed3,'48 85 c0 74 36'),
    ('runtime_keeps_greater_intensity',0x140a80833,'f3 0f 10 40 20 0f 2f 87 58 02 00 00 76 08 f3 0f 11 87 58 02 00 00'),
    ('character_rgb_max_far_direct_near_extra',0x140a80818,'8b 48 04 89 8f 48 02 00 00 8b 48 08 89 8f 4c 02 00 00 8b 48 0c 89 8f 50 02 00 00 f3 0f 10 40 20 0f 2f 87 58 02 00 00 76 08 f3 0f 11 87 58 02 00 00 8b 40 24 89 87 5c 02 00 00 8b 43 28 89 87 60 02 00 00'),
    ('second_character_path_same_merge',0x140a6cda4,'8b 48 04 89 8e 48 02 00 00 8b 48 08 89 8e 4c 02 00 00 8b 48 0c 89 8e 50 02 00 00 f3 0f 10 40 20 0f 2f 86 58 02 00 00 76 08 f3 0f 11 86 58 02 00 00 8b 40 24 89 86 5c 02 00 00 8b 43 28 89 86 60 02 00 00'),
    ('scene_path_direct_rgb_far_near_extra',0x140a9eed8,'8b 48 04 89 8f 60 07 00 00 8b 48 08 89 8f 64 07 00 00 8b 48 0c 89 8f 68 07 00 00 8b 48 20 89 8f 70 07 00 00 8b 48 24 89 8f 74 07 00 00 8b 40 28 89 87 78 07 00 00'),
    ('near_far_inputs',0x1415fb2fb,'f3 0f 10 72 20 0f 29 7c 24 20 f3 0f 10 7a 24'),
    ('near_flag_and_equal_gate',0x1415fb30d,'e8 fe 34 f7 ff 80 b8 bc 00 00 00 01 75 3a 0f 2e fe 7a 02 74 33'),
    ('near_supplied_weight_lerp',0x1415fb322,'f3 0f 10 83 44 01 00 00 f3 0f 10 0d 8a ef d9 00 f3 0f 5c c8 f3 0f 59 c7 f3 0f 59 ce f3 0f 58 c8 0f 28 c1'),
    ('near_gate_far_fallback',0x1415fb355,'0f 28 7c 24 20 0f 28 c6 0f 28 74 24 30 48 83 c4 40 5b c3'),
    ('near_result_upload',0x1415fea90,'e8 5b c8 ff ff f3 0f 11 05 83 c1 99 01'),
    ('toon_rotation_degree_constant',0x142423774,'35 fa 8e 3c'),
    ('toon_rotation_input_pack',0x1415feb74,'f3 0f 10 4b 0c f3 0f 10 73 04 0f 14 f1 f3 0f 10 4b 08 f3 0f 10 5b 64 41 0f 14 c8 0f 14 f1 0f 28 d6 0f 59 d6 0f 28 c2 0f c6 c2 99 f3 0f 58 d0 0f c6 c0 55 f3 0f 58 d0 0f 28 c7 0f c6 d2 00 0f 51 ca 0f c2 15 03 ac d9 00 04 0f 5e f1 0f c2 c1 04 f3 0f 10 0d a8 4b e2 00 0f 54 f0 f3 0f 59 d9 f3 0f 10 43 60 0f 54 f2 0f 55 15 ee ab d9 00 f3 0f 59 c1 0f 28 e0 0f 56 f2 f3 0f 10 53 68 f3 0f 59 d1 0f 14 e2 0f 28 d3 41 0f 14 d0 0f 14 e2 0f 29 64 24 20 e8 c4 42 f6 ff'),
    ('toon_rotation_vector',0x1415fec0c,'0f 28 ce 0f c6 ce 55 0f 28 c6 0f 59 48 10 0f c6 c6 00 0f c6 f6 aa 0f 59 00 0f 59 70 20'),
    ('toon_direction_upload',0x1415fec7d,'0f 11 74 24 20 f3 0f 10 44 24 20 f3 0f 10 4c 24 24 f3 0f 11 05 ea bf 99 01 f3 0f 10 44 24 28 f3 0f 11 0d e0 bf 99 01 f3 0f 11 05 dc bf 99 01'),
    ('toon_rotation_half_angles',0x141562ef0,'0f 28 02 48 8b d9 4c 8d 45 a7 48 8d 55 97 48 8d 4d b7 0f 59 05 17 68 e3 00 0f 29 45 a7 e8 3e f4 ff ff'),
    ('toon_rotation_half_constant',0x142399720,'00 00 00 3f 00 00 00 3f 00 00 00 3f 00 00 00 3f'),
    ('toon_quaternion_signs',0x1425b3c10,'00 00 80 3f 00 00 80 bf 00 00 80 bf 00 00 80 3f'),
    ('toon_quaternion_shuffle',0x1425b3c20,'1b 1a 19 18 1b 1a 19 18 0b 0a 09 08 1b 1a 19 18 17 16 15 14 07 06 05 04 17 16 15 14 17 16 15 14 03 02 01 00 13 12 11 10 13 12 11 10 13 12 11 10'),
    ('toon_quaternion_assembly',0x14156306d,'0f 28 2d 2c c6 f6 00 0f 28 5d b7 0f 28 45 d7 48 8b c3 0f 59 1d 8a 0b 05 01 0f 59 45 c7 0f 59 45 07 0f 59 5d a7 0f 59 5d e7 0f 58 d8'),
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
                selection=dict(type=5,value='template group',lookup='0x140ac1cf0',missing=0,light_lookup='0x14029e960'),
                composition=dict(character_far='max(existing,skin)',scene_far='skin',near='skin',rgb='skin',alpha='unchanged'),
                near_interpolation=dict(function='0x1415fb2f0',weight='externally supplied state+0x144',formula='far*(1-weight)+near*weight',gate='flag+0xbc == 1; unequal far/near',fallback='far',distance_mapping='unresolved'),
                toon_rotation=dict(inputs=['light+0x60','light+0x64','light+0x68'],unit='degrees',quaternion='Y*X*Z',vector_order='Z then X then Y',output='DLightDir at CBPerLight+0xa0',general_direction='unchanged',runtime_values='not imported'),
                game_executed=False,unresolved=['live toon rotation values','camera distance to weight mapping','live selected values are not imported','equipment/ownership selection writes','runtime world merge modes','content activation','in-game appearance'])


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--exe',required=True,type=Path);parser.add_argument('--output',type=Path)
    args=parser.parse_args()
    try:report=audit(args.exe)
    except (OSError,ValueError,struct.error) as exc:parser.exit(1,str(exc)+'\n')
    text=json.dumps(report,indent=2)
    if args.output:args.output.write_text(text+'\n',encoding='utf-8')
    print(text)
    raise SystemExit(0 if report['status']=='verified' else 1)
