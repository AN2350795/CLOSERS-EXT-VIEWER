"""Recheck a bounded particle draw/state path without executing CW.EXE."""
import argparse
import hashlib
import json
from pathlib import Path
import struct

from audit_bloom import cpu_evidence

EVIDENCE = (
    ('type_3d_plane_enum_zero', 0x14185d09c, '4c8d05b5eafd00488bc833d2e8f39f7afe'),
    ('type_2d_plane_enum_one', 0x14185d0b2, '4c8d057feafd00488bc8ba01000000e8da9f7afe'),
    ('type_mesh_enum_two', 0x14185d0cb, '4c8d054eeafd00488bc8ba02000000e8c19f7afe'),
    ('particle_type_loader', 0x1415c0d9f, '488d15e2ccff00488bcbe8228625008b4c243084c0410f44cf898e94000000'),
    ('depth_flag_loader', 0x1415c17d9, '4c8d8654030000488d1511beff00488bcbe8116725004c8d8655030000488d15ebbdff00488bcbe8fb662500'),
    ('blend_descriptor_constructor_call', 0x1415b9535, '488d4d80ff00e8b01505ff'),
    ('particle_blend_factor_fields', 0x1415b9540, '488b8fc80100008b81f000000089458c8b81f4000000894590e802770500488d5580488bc8e866c50500'),
    ('particle_depth_type_override', 0x1415b9625, '83b994000000017506895c2420eb0b0fb68154030000894424200fb6815503000089442424'),
    ('particle_depth_state_call', 0x1415b964a, 'e811760500488d542420488bc8e814c40500'),
    ('particle_plane_dispatch', 0x1415b96eb, '4533c033d2488bcfe878bfffff'),
    ('plane_unmasked_or_masked_selector', 0x1415b56bc, '84d20f85fd0100004883b93804000000750fe81d6f0400488bc8e815990400eb71e80e6f0400488bc8e896990400'),
    ('unmasked_quad_group_four', 0x1415ff023, 'c7432004000000488b492048894b28'),
    ('masked_quad_group_five', 0x1415ff0b8, 'c7432005000000488b492848894b28'),
    ('quad_shader_registration', 0x1416065b7, '488d1502fafb00488bcbe84af4ffff4c8b1e49895b20'),
    ('quad_shader_filename', 0x1425c5fc0, '430057005f0051007500610064002e00500053002e00630073006f000000'),
    ('blend_wrapper_to_create', 0x141615af1, 'e8aa240000488bd3488bc8e8cf630000'),
    ('blend_rewrite_conditions', 0x14161beee, '4183f80575158b521083fa077429453bc075088b531083fa02741c4183f80175088b531083fa04740e4183f80275418b5310413bd07539'),
    ('blend_rewrite_targets_and_alpha_flags', 0x14161bf25, '8b4308c74304010000004489432c895330c7434801000000c7434c05000000894328c7435006000000f30f11353eed9701f30f1135b6eb9701'),
    ('blend_create_state', 0x14161bf5e, 'e8fd8919004c8d442468488bd34c8b08488bc841ff91a0000000'),
    ('blend_descriptor_target_defaults', 0x14060aaf0, '4533c0418bd04c8901488bc248c1e005c744080c05000000c744081006000000c744080801000000c744081401000000c744081802000000c744081c02000000c744082001000000c64408240f4883fa027508448941044489414848ffc24883fa087ca2'),
    ('particle_scope_end_restore', 0x1415b9791, 'e8ca740500488bc8e862bc0500'),
    ('scope_restore_calls_blend_restore', 0x141615416, '488bcbe842faffff'),
    ('missing_saved_blend_skips_flag_reset', 0x141614ec4, '493b5950743e'),
    ('restore_saved_blend', 0x141614eca, 'e8d1300000488b5328488bc8e8550e0000'),
    ('restore_clears_both_alpha_flags', 0x141614ef5, '0f57edf30f112d945d9801f30f112d0c5c9801'),
)


def blend_description(source, destination):
    """Effective targets after constructor/rewrite; not arbitrary live state.

    With independent blending disabled, target 0 applies to every target;
    the constructor's disabled raw target-2 entry is then ignored.
    """
    if type(source) is not int or type(destination) is not int or not (1 <= source <= 11 and 1 <= destination <= 11):
        raise ValueError('Expected a basic D3D blend factor enum (1..11).')
    independent = (source, destination) in {(5, 7), (5, 2), (1, 4), (2, 2)}
    primary = dict(enabled=True, rgb=[source, destination], alpha=[2, 2], operation=1, write_mask=15)
    depth = dict(enabled=True, rgb=[5, 6], alpha=[2, 2], operation=1, write_mask=15) if independent else dict(primary)
    return dict(independent=independent, target0=primary, target1=dict(primary), target2=depth,
                alpha_mode_write=1 if independent else None,
                alpha_mode_note='No write on bypass; previous shared state is not assumed zero.')


def audit(executable):
    cpu = cpu_evidence(executable, EVIDENCE)
    body = Path(executable).read_bytes()
    if hashlib.sha256(body).hexdigest() != cpu['sha256']:
        raise ValueError('Executable changed during initialization verification.')
    pe = struct.unpack_from('<I', body, 0x3c)[0]
    optional = pe+24
    base = struct.unpack_from('<Q', body, optional+24)[0]
    table = optional+struct.unpack_from('<H', body, pe+20)[0]
    sections = [struct.unpack_from('<4I', body, table+i*40+8)
                for i in range(struct.unpack_from('<H', body, pe+6)[0])]
    initial = {hex(address): any(rva+raw <= address-base and address-base+4 <= rva+virtual
                                for virtual, rva, raw, _ in sections)
               for address in (0x142f9ac94, 0x142f9ab14)}
    if not all(initial.values()):
        raise ValueError('Shared alpha flags are not in PE zero-fill tails.')
    return dict(cpu=cpu,
        scope='Particle render 0x1415b94a0; normal 3D plane without mask -> shader group 4 / CW_Quad.PS.cso',
        depth=dict(template_test='0x354', template_write='0x355', type_2d_override='test disabled; write flag still copied'),
        blend=dict(constructor='0x14060aaf0', wrapper='0x141615ad0', create='0x14161bed0',
                   independent_pairs=[[5, 7], [5, 2], [1, 4], [2, 2]],
                   ordinary=blend_description(5, 6), additive=blend_description(5, 2), destination_alpha=blend_description(5, 7)),
        restore=dict(particle_scope_end='0x1415b9791 -> 0x141615400 -> 0x141614e60',
                     saved_blend_found='Restore saved GPU blend state, then write zero to both shared alpha flags.',
                     saved_blend_missing='Skip both saved-state restore and flag zeroing.',
                     nested_state='Flags are zeroed, not restored to their prior float values.'),
        initial_pe_zero_fill=initial,
        unresolved=['Masked, mesh, Spine/FBX and alternative particle draw paths',
                    'Initial/shared alpha-mode state before a draw and alternate restoration paths',
                    'Live MRT bindings, draw order, depth state overrides and frame comparison',
                    'Particle MRT2/DOF integration in the viewer'],
        game_executed=False, rendering_enabled=False)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--exe', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    report = audit(args.exe)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf8')
    print(json.dumps(dict(cpu_checks=len(report['cpu']['checks']), game_executed=False)))
