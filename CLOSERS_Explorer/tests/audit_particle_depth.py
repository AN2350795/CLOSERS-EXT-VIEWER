"""Fingerprint-bound particle depth evidence; never executes game/Lua/shaders."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from closers.catalog import Catalog
from closers.loading import LoadingData
from closers.cmf import Archive
from closers.lua_literals import tables
from closers.motion_extras import particle_rule

SHADERS = {
    'CW_QUAD.PS.CSO': ('1b681d899995bfcc5495a035056c7083a323644f169c234b831f562ccec62188', [0, 1, 2]),
    'CW_NOLIGHT.PS.CSO': ('19a853af9d1a4279d61f24533859d5f7fba6b78f02ce8ead9ae640461e31c1d3', [0, 1, 2]),
    'CW_SIMPLE.PS.CSO': ('03fd97a7c9014da13fe0b3e1c9bce9c1409c18e91a026335e138cc02c83d97b7', [0]),
}
DEFINITIONS = {
    'PARTICLE_SYSTEM_MAIN.LUA': ('e4ba6024974868fc4c710635e8d25d33259c7042dcd4b44aaba155527981891a',
        ['FOOT_DUST', 'PE_TRANSFORM_SYSTEM_CORE_GLOW_01']),
    'PARTICLE_SYSTEM_MAIN_EF1.LUA': ('d163ac3d719a18c7fe236666cee46d373b17a1edbff14a42342f28bc46b096de',
        ['PE_CUSTOM_EF_FLOOR_WATER_WAVE', 'PE_2026_SUMMER_DANCE_EMOTION_BG_NEON_SIGN']),
}


def output_targets(body):
    """Read legacy DXBC OSGN metadata, not executable shader instructions."""
    if len(body) < 32 or body[:4] != b'DXBC' or struct.unpack_from('<I', body, 24)[0] != len(body):
        raise ValueError('Invalid DXBC container.')
    count = struct.unpack_from('<I', body, 28)[0]
    if count > (len(body)-32)//4:
        raise ValueError('Invalid DXBC chunk table.')
    signatures = []
    for offset in struct.unpack_from('<'+'I'*count, body, 32):
        if offset < 32+4*count or offset+8 > len(body):
            raise ValueError('Invalid DXBC chunk offset.')
        length = struct.unpack_from('<I', body, offset+4)[0]
        if offset+8+length > len(body):
            raise ValueError('Invalid DXBC chunk size.')
        if body[offset:offset+4] != b'OSGN':
            continue
        payload = body[offset+8:offset+8+length]
        if len(payload) < 8:
            raise ValueError('Invalid DXBC output signature.')
        rows, start = struct.unpack_from('<2I', payload)
        if start != 8 or rows > (len(payload)-start)//24:
            raise ValueError('Invalid DXBC output records.')
        targets = []
        for index in range(rows):
            name, semantic, _, _, register, mask, _, _ = struct.unpack_from('<5I2BH', payload, start+index*24)
            end = payload.find(b'\0', name)
            if name < start+rows*24 or end < name:
                raise ValueError('Invalid DXBC semantic name.')
            if payload[name:end].upper() == b'SV_TARGET':
                if register != semantic or mask != 15:
                    raise ValueError('Unexpected target register/mask.')
                targets.append(semantic)
        signatures.append(targets)
    if len(signatures) != 1:
        raise ValueError('Expected one legacy output signature.')
    return signatures[0]


def constant_variable(body, buffer_name, variable_name):
    """Read bounded SM5 RDEF metadata; no shader execution or disassembly."""
    output_targets(body)  # Validate the whole chunk table and all chunk extents.
    chunks = []
    count = struct.unpack_from('<I', body, 28)[0]
    for offset in struct.unpack_from('<'+'I'*count, body, 32):
        if body[offset:offset+4] == b'RDEF':
            length = struct.unpack_from('<I', body, offset+4)[0]
            chunks.append(body[offset+8:offset+8+length])
    if len(chunks) != 1 or len(chunks[0]) < 28:
        raise ValueError('Expected one SM5 reflection chunk.')
    data = chunks[0]
    buffers, buffer_start, resources, resource_start, version = struct.unpack_from('<5I', data)
    if version != 0xffff0500:
        raise ValueError('Only the investigated ps_5_0 reflection layout is supported.')

    def records(start, count, stride):
        if start < 28 or start > len(data) or count > (len(data)-start)//stride:
            raise ValueError('Invalid reflection record range.')
        return [struct.unpack_from('<'+'I'*(stride//4), data, start+i*stride) for i in range(count)]

    def string(offset):
        end = data.find(b'\0', offset)
        if offset < 28 or end < offset:
            raise ValueError('Invalid reflection string.')
        return data[offset:end].decode('ascii')

    matches = [r for r in records(buffer_start, buffers, 24) if string(r[0]) == buffer_name]
    bindings = [r for r in records(resource_start, resources, 32) if string(r[0]) == buffer_name and r[1] == 0]
    if len(matches) != 1 or len(bindings) != 1 or bindings[0][6] != 1:
        raise ValueError('Missing/ambiguous constant buffer binding.')
    buffer = matches[0]
    variables = [r for r in records(buffer[2], buffer[1], 40) if string(r[0]) == variable_name]
    if len(variables) != 1 or variables[0][1]+variables[0][2] > buffer[3]:
        raise ValueError('Missing/invalid constant variable.')
    variable = variables[0]
    return dict(buffer=buffer_name, variable=variable_name, slot=bindings[0][5],
                offset=variable[1], size=variable[2], buffer_size=buffer[3])


def audit(workspace):
    catalog = Catalog(workspace)
    data = LoadingData(catalog)
    shaders = []
    for name, (expected, targets) in SHADERS.items():
        rows = data.rows(name)
        if not rows:
            raise ValueError('Original shader unavailable: '+name)
        sources = []
        layout = None
        for row in rows:
            catalog.verify_source(row)
            with Archive(row['archive']) as archive:
                body = b''.join(archive.chunks(catalog.entry(row)))
            catalog.verify_source(row)
            if hashlib.sha256(body).hexdigest() != expected or output_targets(body) != targets:
                raise ValueError('Shader changed; re-investigate: '+name)
            if name == 'CW_QUAD.PS.CSO':
                layout = constant_variable(body, 'CBPerQuad', 'g_v4UseTextureMaskMap')
            elif name == 'CW_NOLIGHT.PS.CSO':
                layout = constant_variable(body, 'CBPerMaterial', 'g_v4MatUseTextureMaskMap')
            sources.append(dict(entry=row['id'], archive=row['archive'], ordinal=row['ordinal']))
        shaders.append(dict(name=name, sha256=expected, targets=targets, sources=sources, alpha_mode_layout=layout))
    definitions = []
    for filename, (expected, names) in DEFINITIONS.items():
        body = data.body(filename)
        if hashlib.sha256(body).hexdigest() != expected:
            raise ValueError('Particle definitions changed; re-investigate: '+filename)
        entries = tables(body).get('PARTICLE_SYSTEM', {})
        for name in names:
            matches = [r for r in entries.values() if isinstance(r, dict) and r.get('m_SeqName') == name]
            if len(matches) != 1:
                raise ValueError('Missing/ambiguous particle definition: '+name)
            row = matches[0]
            normalized = particle_rule(dict(row, source=filename))
            definitions.append(dict(name=name, source=filename, sha256=expected,
                raw={key: row.get(key) for key in ('m_bZEnable', 'm_bZWriteEnable', 'm_SrcBlend', 'm_DestBlend')},
                viewer={key: normalized[key] for key in ('depth_test', 'depth_write', 'blend')},
                defaults=[key for key in ('m_bZEnable', 'm_bZWriteEnable') if key not in row]))
    return dict(shaders=shaders, definitions=definitions,
        distinction='Hardware depth test/write does not determine encoded color MRT2 output/blending.',
        unresolved=['Per-particle runtime shader selection and MRT2 write masks/blend states',
                    'Runtime constants controlling QUAD/NOLIGHT MRT2 alpha',
                    'Whether omitted Lua flags match engine defaults',
                    'Particle DOF integration and in-game frame parity'],
        game_executed=False, lua_executed=False, viewer_defaults_changed=False)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workspace', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    report = audit(args.workspace)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf8')
    print(json.dumps(dict(shaders=len(report['shaders']), definitions=len(report['definitions']), game_executed=False)))
