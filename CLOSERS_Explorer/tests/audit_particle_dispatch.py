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
)


def audit(executable):
    cpu = cpu_evidence(executable, EVIDENCE)
    snapshots = {name: (address, bytes.fromhex(raw)) for name, address, raw in EVIDENCE}
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
                keyed_route=dict(selector='sequence +0x4e0 equals caller RDX', render_call='0x1415ced1e', stage='unresolved'),
                scope='Static dispatch evidence; neither live RTV bindings nor scene membership is established.',
                unresolved=['Outer callers and target bindings for each route',
                            'Keyed selector meaning and world scene queue',
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
