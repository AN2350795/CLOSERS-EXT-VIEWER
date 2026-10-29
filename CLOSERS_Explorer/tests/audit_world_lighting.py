"""Export regional unit-light inputs without running Lua or changing game assets."""
import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from closers.catalog import Catalog
from closers.loading import LoadingData
from closers.world_lighting import unit_light

DEFAULTS=('WI_TOWN_SQUARE_OF_PEACE_TWILIGHT.LUA','WI_TOWN_MONTMARTRE_TWILIGHT.LUA','WI_TOWN_ORIGIN_WHEEL_TWILIGHT.LUA')


def audit(workspace,names=DEFAULTS):
    data=LoadingData(Catalog(workspace));result=[]
    for name in names:
        try:
            body=data.body(name);report=unit_light(body)
            report['name']=name
            report['sources']=[dict(entry=r['id'],archive=r['archive'],ordinal=r['ordinal']) for r in data.rows(name)]
            result.append(report)
        except ValueError as exc:
            result.append(dict(name=name,status='unresolved',reason=str(exc)))
    return dict(worlds=result,rendering_enabled=False)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workspace',required=True);parser.add_argument('--output',required=True)
    parser.add_argument('--source',action='append',help='Exact regional Lua filename; repeat for multiple sources')
    args=parser.parse_args();result=audit(args.workspace,args.source or DEFAULTS)
    Path(args.output).write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(dict(worlds=len(result['worlds']),resolved=sum(v['status']=='source-only' for v in result['worlds']),rendering_enabled=False)))
