"""Verify particle registration and scene queue calls without running the game."""
import argparse
import json
from pathlib import Path
import struct

from audit_bloom import cpu_evidence


EVIDENCE = (
    ('update_ready_guards', 0x1415c2f40, '80bf0b020000000f287c24700f28b42480000000746780bfd800000000745e488b8798040000482b879004000048a9f8ffffff7448'),
    ('update_special_layer', 0x1415c2f75, '80bf2c050000017513ba02000000488bcfe8b55c0400c6471001eb34'),
    ('update_normal_layer', 0x1415c2f91, '488b87c801000080787d00752780787e00752180787c00751bba01000000488bcfe8895c0400c6471000eb08'),
    ('update_remove_layer', 0x1415c2fbd, '488bcfe8bb570400'),
    ('layer_selector', 0x14159abf0, 'ffca740fffca740333c0c3488b8108040000c3488b8100040000c3'),
    ('layer_change', 0x141608c64, 'e817fbffffe8e22ef9ff8bd7488bc8e8781ff9ff4885c0741f488b53084c8bc3488bc889bb00010000488b5c24304883c4205fe974fcffff'),
    ('layer_store_input', 0x14160892c, '498be8488bda488bf9'),
    ('layer_store_pair', 0x1416089bc, '48895c243848896c2440488d542438488d4f30e8ecf8ffff4c8bc04533c9488d542438488d4f30e868f7ffff'),
    ('prepare_tree_object', 0x1415f9743, '488b73204889756f4885f60f84fb01000080bed8000000000f84e701000080bef9000000010f84da010000'),
    ('prepare_normal_vectors', 0x1415f9910, '80be7001000001751a498d4c2470e81dacfafe488d556f498d4c2450e80facfafeeb1c80bee00000000075eb498d4c2470e8faabfafeeb07c686f800000001'),
    ('draw_vector_70', 0x1415f8540, '488b4670488b3c288b87fc000000413bc67c33413bc57d2e807f1001742880bff900000001741f8b9fdc000000e82efa01008bd3488bc8e8a44202004c8b1f488bcf41ff5310'),
    ('draw_vector_50', 0x1415f8610, '488b4650488b3c288b87fc000000413bc67c33413bc57d2e807f1001742880bff900000001741f8b9fdc000000e85ef901008bd3488bc8e8d44102004c8b1f488bcf41ff5310'),
    ('draw_layer_pair', 0x1409522ee, 'c6839000000000448bc78bd6488bcbe8ee61ca00c6839000000001448bc78bd6488bcbe8aa62ca00'),
    ('scene_layer_one', 0x140d70f50, 'e8fbab82004c8bb800040000'),
    ('scene_bind_and_draw', 0x140d71077, '498bcfe82185880041b8000000ffb201498bcce8a17f8900e87cd77f00488b30e8b4aa820041b8000000ff488bd6488bc8e8639b820033d2448d4240498bcfe8f511beff'),
    ('secondary_bind_explicit', 0x14159ac37, '4885db7410b201488bcbe8eae306004883c4205bc3'),
    ('secondary_bind_default', 0x14159ac4c, 'e89fcd21004889442430e8e5cd2100488bd8e87d9d21004c8d4424304c8b104c8bcbba01000000488bc841ff9208010000'),
    ('bounded_layer_draw', 0x14156e8aa, '488b19458bc1b201488bcbe876a7090033d2488bcf448d4240e8e8393eff488bcbe8b0a80900'),
    ('capture_name_reference', 0x140d70ca5, '488d15d4987901'),
    ('capture_name', 0x14250a580, '530043005200450045004e005f0043004100500054005500520045005f0055004e00490054000000'),
    ('selfie_reference', 0x140d71335, '488d05cc917901'),
    ('selfie_name', 0x14250a508, '430055006e0069007400530065006c00660069006500550049003a003a004f006e00530065006c0066006900650043006100700074007500720065000000'),
    ('town_locator_pointer', 0x1424bc9d0, '70a0a24201000000'),
    ('town_render_slot', 0x1424bca50, 'd024954001000000'),
    ('town_locator', 0x142a2a070, '010000000000000000000000b8fbf60298a0a20270a0a202'),
    ('town_name', 0x142f6fbc8, '2e3f4156434357435374617465546f776e404000'),
    ('pvp_locator_pointer', 0x1424b85f0, 'f89ba24201000000'),
    ('pvp_render_slot', 0x1424b8670, 'd024954001000000'),
    ('pvp_locator', 0x142a29bf8, '01000000000000000000000020faf602209ca202f89ba202'),
    ('pvp_name', 0x142f6fa30, '2e3f415643435743537461746547616d65505650404000'),
    ('gameplay_target_selection', 0x140952702, 'e809c1c100488b18e84194c400448b45c8488bd3488bc8e8f284c400'),
    ('gameplay_priority_gate', 0x1409528d1, '4584e47549bb40000000e830bfc1008b8890020000c1e907f6c101741be85d92c400488b8800040000b83b00000080b9d8000000010f44d8'),
    ('gameplay_layer_draw', 0x140952909, 'e84292c400448bc333d2488b8800040000e891f9ffff'),
    ('screen_target_getter', 0x14156e850, '488b3d392fa201'),
    ('screen_target_getter_return', 0x14156e873, '488bc7'),
    ('screen_init_call', 0x14159e1eb, 'e82006fdff488bc8e8d87ffdff'),
    ('screen_init_thunk', 0x1415761d0, 'e9bbe0ffff'),
    ('screen_init_receiver', 0x1415742d2, '4c8be1'),
    ('screen_target_allocation', 0x14157442c, 'c785b401000003000000b920020000e828b2880048894424484885c07410488d9560010000488bc8e8576d09009049890424'),
    ('target_count_copy', 0x14160b27f, '8b435489871c020000'),
)


def resolve_links(snapshots):
    links = []
    for reference, name in (('capture_name_reference', 'capture_name'), ('selfie_reference', 'selfie_name')):
        address, body = snapshots[reference]
        if body[:2] != b'\x48\x8d' or address+7+struct.unpack_from('<i', body, 3)[0] != snapshots[name][0]:
            raise ValueError('Capture caller string association mismatch.')
    for name, offset, opcode, target in (
        ('update_special_layer', 17, 0xe8, 0x141608c40),
        ('update_normal_layer', 33, 0xe8, 0x141608c40),
        ('update_remove_layer', 3, 0xe8, 0x141608780),
        ('layer_change', 15, 0xe8, 0x14159abf0),
        ('layer_change', 51, 0xe9, 0x141608910),
        ('draw_vector_70', 55, 0xe8, 0x14161c820),
        ('draw_vector_50', 55, 0xe8, 0x14161c820),
        ('draw_layer_pair', 15, 0xe8, 0x1415f84f0),
        ('draw_layer_pair', 35, 0xe8, 0x1415f85c0),
        ('scene_bind_and_draw', 3, 0xe8, 0x1415f95a0),
        ('scene_bind_and_draw', 19, 0xe8, 0x141609030),
        ('scene_bind_and_draw', 49, 0xe8, 0x14159ac10),
        ('scene_bind_and_draw', 63, 0xe8, 0x1409522b0),
        ('secondary_bind_explicit', 10, 0xe8, 0x141609030),
        ('bounded_layer_draw', 11, 0xe8, 0x141609030),
        ('bounded_layer_draw', 25, 0xe8, 0x1409522b0),
        ('gameplay_target_selection', 0, 0xe8, 0x14156e810),
        ('gameplay_target_selection', 23, 0xe8, 0x14159ac10),
        ('gameplay_layer_draw', 17, 0xe8, 0x1409522b0),
        ('screen_init_call', 0, 0xe8, 0x14156e810),
        ('screen_init_call', 8, 0xe8, 0x1415761d0),
        ('screen_init_thunk', 0, 0xe9, 0x141574290),
        ('screen_target_allocation', 40, 0xe8, 0x14160b1b0),
    ):
        address, body = snapshots[name]
        if body[offset] != opcode:
            raise ValueError('Unexpected relative instruction in '+name)
        actual = address+offset+5+struct.unpack_from('<i', body, offset+1)[0]
        if actual != target:
            raise ValueError('Scene queue link mismatch in '+name)
        links.append(dict(source=hex(address+offset), target=hex(actual)))
    return links


def gameplay_evidence(snapshots):
    states = []
    for prefix in ('town', 'pvp'):
        pointer_address, pointer = snapshots[prefix+'_locator_pointer']
        locator_address, locator = snapshots[prefix+'_locator']
        signature, _, _, type_rva, _, self_rva = struct.unpack('<6I', locator)
        if struct.unpack('<Q', pointer)[0] != locator_address or signature != 1:
            raise ValueError('Gameplay state RTTI locator mismatch.')
        if locator_address-self_rva+type_rva+16 != snapshots[prefix+'_name'][0]:
            raise ValueError('Gameplay state RTTI name mismatch.')
        slot_address, slot = snapshots[prefix+'_render_slot']
        if slot_address-pointer_address-8 != 0x78 or struct.unpack('<Q', slot)[0] != 0x1409524d0:
            raise ValueError('Gameplay state common render slot mismatch.')
        states.append(snapshots[prefix+'_name'][1].rstrip(b'\0').decode('ascii'))

    allocation = snapshots['screen_target_allocation'][1]
    descriptor_count_offset = struct.unpack_from('<i', allocation, 2)[0]-struct.unpack_from('<i', allocation, 33)[0]
    count = struct.unpack_from('<I', allocation, 6)[0]
    copy = snapshots['target_count_copy'][1]
    destination = struct.unpack_from('<I', copy, 5)[0]
    if descriptor_count_offset != copy[2] or destination != 0x21c or count != 3:
        raise ValueError('Screen target slot count association mismatch.')
    address, getter = snapshots['screen_target_getter']
    global_pointer = address+7+struct.unpack_from('<i', getter, 3)[0]
    if global_pointer != 0x142f91790:
        raise ValueError('Screen target owner global mismatch.')
    return dict(states=states, render='0x1409524d0', virtual_slot='0x78',
        screen_owner_global=hex(global_pointer),
        target='getter 0x14156e810 returns screen owner; owner[0] is selected for the checked gameplay branch',
        construction=dict(function='0x141574290', target_store='owner[0]', requested_slots=count,
                          descriptor_offset=hex(descriptor_count_offset), target_count_offset=hex(destination)),
        draw='layer 1 (graphics +0x400) -> 0x1409522b0 -> per-object state -> particle virtual render',
        priority='lower 0; upper 64 or 59 according to screen +0x290 bit 7 and layer +0xd8; conditional branch may skip this draw',
        conclusion='Static normal gameplay path connects a requested three-slot target to the scene particle queue.',
        limits='Requires successful target initialization and queue eligibility; not a live GPU/frame observation or all gameplay branches.')


def audit(executable):
    cpu = cpu_evidence(executable, EVIDENCE)
    snapshots = {name: (address, bytes.fromhex(raw)) for name, address, raw in EVIDENCE}
    return dict(cpu=cpu, links=resolve_links(snapshots), gameplay=gameplay_evidence(snapshots),
        registration=dict(update='0x1415c2750',
            guards='sequence +0x20b and +0xd8 nonzero; particle vector +0x490/+0x498 nonempty',
            special='sequence +0x52c == 1: layer 2 and sequence +0x10 = 1',
            normal='otherwise: template DownUI/OverUI/InnerUI all zero -> layer 1 and sequence +0x10 = 0',
            inactive='failed ready guards -> remove from layer via 0x141608780',
            boundary='UI branch skips normal registration; it does not explicitly remove an already registered sequence here.'),
        layers=dict(selector='0x14159abf0: 1 -> graphics +0x400, 2 -> +0x408',
            change='0x141608c40: unregister old, select layer, store ID +0x100, insert object via 0x141608910',
            prepare='0x1415f95a0: map entry +0x20 -> object; normal vectors +0x70/+0x50 selected using object +0x170/+0xe0',
            draw='0x1409522b0 -> 0x1415f84f0/+0x70 then 0x1415f85c0/+0x50',
            filters='object +0xfc in [lower,upper); skip +0x10 == 1 or +0xf9 == 1',
            particle_call='apply object +0xdc state, then virtual +0x10 -> sequence render 0x1415b94a0'),
        targets=dict(caller_scope='Unit selfie capture: SCREEN_CAPTURE_UNIT / CUnitSelfieUI::OnSelfieCapture',
            scene='observed capture caller: prepare graphics +0x400 layer -> initial target bind -> secondary target selection -> draw priorities [0,64)',
            secondary='0x14159ac10: nonnull input binds that target; null input binds one default RTV directly',
            warning='Initial scene bind alone does not prove the target active at particle draw.',
            bounded_wrapper='0x14156e890 binds caller target (R8 or receiver[0]), draws layer [0,64), then ends target scope',
            unresolved='Live identity/count at each draw and nested target changes remain unverified; see gameplay for the separate static normal-path construction.'),
        unresolved=['Special +0x52c flag meaning and alternate vectors +0xb8/+0x98',
                    'Live GPU target identity/count and optional or later gameplay branches',
                    'Final viewer particle eligibility, depth integration and frame comparison'],
        game_executed=False, rendering_enabled=False)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--exe', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    report = audit(args.exe)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf8')
    print(json.dumps(dict(cpu_checks=len(report['cpu']['checks']), links=len(report['links']), game_executed=False)))
