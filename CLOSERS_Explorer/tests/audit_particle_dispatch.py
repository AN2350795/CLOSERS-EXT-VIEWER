"""Verify bounded particle dispatch evidence without executing game code."""
import argparse
import json
from pathlib import Path
import struct

from audit_bloom import cpu_evidence


EVIDENCE = (
    ('sequence_vtable', 0x1425bcc70, 'b0395c410100000050275c4101000000a0945b4101000000'),
    ('sequence_rtti_pointer', 0x1425bcc68, 'c0f0a24201000000'),
    ('sequence_rtti_locator', 0x142a2f0c0, '010000000000000000000000c02af702e8f0a202c0f0a202'),
    ('sequence_rtti_name', 0x142f72ad0, '2e3f4156434e4b44475061727469636c65536571404000'),
    ('down_ui_loader', 0x1415c0c83, '4c8d467c488d15aaceff00488bcbe86a722500'),
    ('over_ui_loader', 0x1415c0c96, '4c8d467d488d1587ceff00488bcbe857722500'),
    ('inner_ui_loader', 0x1415c0ca9, '4c8d467e488d1564ceff00488bcbe844722500'),
    ('down_ui_name', 0x1425bdb38, '6d5f62446f776e554900'),
    ('over_ui_name', 0x1425bdb28, '6d5f624f766572554900'),
    ('inner_ui_name', 0x1425bdb18, '6d5f62496e6e6572554900'),
    ('down_ui_filter', 0x1415ce52b, '488b87c801000080787c010f8515010000'),
    ('over_ui_filter', 0x1415ce82b, '488b87c801000080787d010f8515010000'),
    ('inner_ui_filter', 0x1415cce45, '488b88c801000080797e01754a'),
    ('inner_ui_state_and_render', 0x1415cce5c, 'e83fb104008b78208b9edc000000e831b10400488bc88bd3e8a7f904004c8b1e488bce41ff5310e818b104008bd7488bc8e88ef90400'),
    ('down_ui_state_and_render', 0x1415ce6f0, '488b3e8b9fdc000000e8a2980400488bc88bd3e818e104004c8b1f488bcf41ff5310'),
    ('over_ui_state_and_render', 0x1415ce9f0, '488b3e8b9fdc000000e8a2950400488bc88bd3e818de04004c8b1f488bcf41ff5310'),
    ('keyed_filter', 0x1415ceb2b, '4c39a7e00400000f8529010000'),
    ('keyed_state_and_render', 0x1415ced00, '488b3e8b9fdc000000e892920400488bc88bd3e808db04004c8b1f488bcf41ff5310'),
    ('state_raster_depth_blend_calls', 0x14161c8d1, '488bd3488bcfe8a4f3ffff488d53284183c8ff488bcfe8b4f4ffff488d535c488bcfe8d8f5ffff'),
    ('unit_viewer_vtable', 0x1424d02c0, '80ada242010000005043aa40010000008043aa400100000060e7a94001000000'),
    ('unit_viewer_locator', 0x142a2ad80, '01000000000000000000000060fff602a8ada20280ada202'),
    ('unit_viewer_name', 0x142f6ff70, '2e3f415643435743556e6974566965776572404000'),
    ('unit_viewer_receiver', 0x140a9e7d0, '488bf9'),
    ('unit_viewer_zero_register', 0x140a9ec0e, '4533ed'),
    ('unit_viewer_collection_branch', 0x140a9f090, '4c39af780100000f8451010000'),
    ('unit_viewer_collect', 0x140a9f0d0, '448b8700010000488b5708488b88e0000000e889cbb200'),
    ('unit_viewer_direct', 0x140a9f1ee, 'e8dd1cd6ff488b5708488b88e0000000e86df8b200'),
    ('collector_receiver_key', 0x1415cbc95, '450fb6e1458be84c8bf2488bf1'),
    ('collector_filters', 0x1415cbd01, '4439af0001000075634438a7e0000000755a4c39b7e00400007551'),
    ('unit_viewer_collected_render', 0x140a9f190, '488b04318b98dc000000e8018eb700488bc88bd3e877d6b7004c8b5d00498b0c33488b01ff5010'),
    ('particle_create_key_a', 0x140a9b3c0, '498b542408488993e0040000'),
    ('particle_create_key_b', 0x140a9d501, '498b542408488993e0040000'),
    ('particle_child_key_a', 0x1415b79cb, '498b8c24e0040000458bc6488988e0040000'),
    ('particle_child_key_b', 0x1415c08ea, '498b8c24e0040000488988e0040000'),
    ('down_ui_outer_call', 0x140952dbc, 'e80fe1eaff488b88d8000000e8a3b6c700'),
    ('over_ui_outer_call', 0x140953402, 'e8c9daeaff488b88d8000000e85db3c700'),
)


def caller_evidence(snapshots):
    """Resolve caller links; a matching selector alone does not prove scene MRTs."""
    def call_target(name, offset):
        address, body = snapshots[name]
        if body[offset] != 0xe8:
            raise ValueError('Expected a direct relative call.')
        return address+offset+5+struct.unpack_from('<i', body, offset+1)[0]

    pointer = struct.unpack_from('<Q', snapshots['unit_viewer_vtable'][1])[0]
    locator_address, locator = snapshots['unit_viewer_locator']
    if pointer != locator_address:
        raise ValueError('Unit viewer RTTI pointer mismatch.')
    signature, _, _, type_rva, _, self_rva = struct.unpack('<6I', locator)
    image_base = locator_address-self_rva
    if signature != 1 or image_base+type_rva+16 != snapshots['unit_viewer_name'][0]:
        raise ValueError('Unit viewer RTTI type association mismatch.')
    render = struct.unpack_from('<Q', snapshots['unit_viewer_vtable'][1], 24)[0]
    if render != 0x140a9e760:
        raise ValueError('Unit viewer render slot mismatch.')
    branch_address, branch = snapshots['unit_viewer_collection_branch']
    if branch[7:9] != b'\x0f\x84' or branch_address+13+struct.unpack_from('<i', branch, 9)[0] != snapshots['unit_viewer_direct'][0]:
        raise ValueError('Unit viewer collection/direct branch mismatch.')
    expected_calls = (
        ('unit_viewer_collect', 18, 0x1415cbc70),
        ('unit_viewer_direct', 16, 0x1415cea70),
        ('down_ui_outer_call', 12, 0x1415ce470),
        ('over_ui_outer_call', 12, 0x1415ce770),
        ('unit_viewer_collected_render', 20, 0x14161c820),
    )
    for name, offset, target in expected_calls:
        if call_target(name, offset) != target:
            raise ValueError('Particle outer call target mismatch: '+name)
    return dict(
        caller_class=snapshots['unit_viewer_name'][1].rstrip(b'\0').decode('ascii'),
        render=hex(render), selector_source='receiver +8 -> RDX -> sequence +0x4e0 comparison',
        key_writes=['0x140a9b3c0', '0x140a9d501'],
        key_write_source='creation receiver +8 -> sequence +0x4e0',
        child_inheritance=['0x1415b79cb', '0x1415c08ea'],
        child_copy='parent sequence +0x4e0 -> child sequence +0x4e0',
        collection='receiver +0x178 nonzero: collect with +0x100, +0xe0 and +0x4e0 filters; apply state and draw list',
        direct='receiver +0x178 zero: call keyed particle draw 0x1415cea70',
        manager_members=dict(unit_viewer='registry +0xe0', down_over_ui='registry +0xd8'),
        target_status='Unresolved: a UnitViewer caller and owner-like selector do not establish world scene MRT2 participation.')


def audit(executable):
    cpu = cpu_evidence(executable, EVIDENCE)
    snapshots = {name: (address, bytes.fromhex(raw)) for name, address, raw in EVIDENCE}
    callers = caller_evidence(snapshots)
    routes = []
    for name, call in (('down', 0x1415ce70e), ('over', 0x1415cea0e), ('inner', 0x1415cce7f)):
        address, loader = snapshots[name+'_ui_loader']
        # LEA r8,[rsi+field], then LEA rdx,[RIP+name].
        offset = loader[3]
        string_address = address+11+struct.unpack_from('<i', loader, 7)[0]
        if string_address != snapshots[name+'_ui_name'][0]:
            raise ValueError('UI loader string association mismatch.')
        field = snapshots[name+'_ui_name'][1].rstrip(b'\0').decode('ascii')
        filter_body = snapshots[name+'_ui_filter'][1]
        if filter_body[9] != offset:
            raise ValueError('UI loader/filter field association mismatch.')
        routes.append(dict(flag=field, template_offset=hex(offset), render_call=hex(call)))
    return dict(cpu=cpu, ui_routes=routes,
                sequence_render=hex(struct.unpack_from('<Q', snapshots['sequence_vtable'][1], 16)[0]),
                virtual_slot='0x10', state_id='sequence +0xdc; not a render-target identifier',
                inner_ui_restore='Saves current state ID +0x20; applies sequence state; draws; restores saved ID.',
                state_apply='0x14161c820 calls rasterizer, depth and blend state helpers.',
                keyed_route=dict(selector='sequence +0x4e0 equals caller RDX', render_call='0x1415ced1e',
                                 caller='CCWCUnitViewer', stage='live render target unresolved'),
                callers=callers,
                scope='Static dispatch evidence; neither live RTV bindings nor scene membership is established.',
                unresolved=['Outer callers and target bindings for each route',
                            'World scene queue and live targets beyond the verified UnitViewer caller',
                            'UI flag defaults when omitted from Lua'],
                game_executed=False, rendering_enabled=False)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--exe', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    report = audit(args.exe)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf8')
    print(json.dumps(dict(cpu_checks=len(report['cpu']['checks']), ui_routes=len(report['ui_routes']), game_executed=False)))
