"""Read-only game-source audit. Run from the repository root:

python CLOSERS_Explorer/tests/audit_avatar_materials.py --workspace results \
    --output diagnostics/material-audit.json

No game files or extracted assets are written. The output is metadata only.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import sys

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from closers.catalog import Catalog
from closers.cmf import Archive
from closers.loading import LoadingData
from closers.model_items import AvatarItems
from closers.model_library import Models


def audit(workspace):
    catalog=Catalog(workspace);items=AvatarItems(catalog);rules=items.texture_rules();data=LoadingData(catalog)
    result=dict(definitions=len(rules),unresolved=sum(v['unresolved'] for v in rules.values()),
                appearance_conflicts=[k for k,v in rules.items() if v.get('ambiguous')],
                auxiliary_conflicts={k:v['material_conflicts'] for k,v in rules.items() if v.get('material_conflicts')},
                inputs=dict(Counter(k for v in rules.values() for k in v)),sources=[],models=[])
    for name in ('NKXMESH_RI_BASIC.FX','NKXMESH_RI_BASIC_CARTOONLIGHT_PS.HLSL','NKXMESH_RI_BASIC_VS.HLSL',
                 'CW_CARTOONLIGHT.PS.CSO','CW_DEFAULT.VS.CSO'):
        for row in data.rows(name):
            catalog.verify_source(row)
            if name.endswith('.FX'):body=data.body(name)
            else:
                with Archive(row['archive']) as archive:body=b''.join(archive.chunks(catalog.entry(row)))
            catalog.verify_source(row)
            result['sources'].append(dict(name=name,entry=row['id'],archive=row['archive'],ordinal=row['ordinal'],
                                          bytes=len(body),sha256=hashlib.sha256(body).hexdigest()))
    models=Models(catalog)
    # Fixed source references from this workspace, not filename-based selection.
    for entry,key in ((25986,'ROGUE:1307012414:0'),(311505,'ROGUE:340734004:0')):
        try:
            scene=models.scene([entry],items={str(entry):key})
            result['models'].append(dict(entry=entry,item=key,sources=scene['sources'],warnings=scene['warnings'],
                meshes=[dict(name=m['name'],vertices=len(m['vertices'])//3,normals=len(m['normals'])//3,
                             influences=len(m['skin']),materials=m['materials'],groups=m['groups']) for m in scene['meshes']]))
        except ValueError as exc:result['models'].append(dict(entry=entry,item=key,error=str(exc)))
    return result


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workspace',required=True);parser.add_argument('--output',required=True)
    args=parser.parse_args();result=audit(args.workspace)
    Path(args.output).write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({k:result[k] for k in ('definitions','unresolved','inputs')}))
