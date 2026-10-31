"""Compare world screen inputs and graphic-option color presets without executing Lua."""
import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from closers.catalog import Catalog
from closers.loading import LoadingData
from closers.scene_postprocess import screen_effects
from closers.color_grading import read_presets
from closers.world_lighting import REGIONS


def audit(workspace,names=None):
    data=LoadingData(Catalog(workspace));worlds=[]
    for name in names if names is not None else [name for name,_ in REGIONS]:
        try:
            report=screen_effects(data.body(name))
            report.update(name=name,sources=[dict(entry=r['id'],archive=r['archive'],ordinal=r['ordinal']) for r in data.rows(name)])
            worlds.append(report)
        except ValueError as exc:worlds.append(dict(name=name,status='unresolved',reason=str(exc)))
    return dict(worlds=worlds,presets=read_presets(data),preset_selection_scope='graphics-option',
                applied_scope='color-grading-only',runtime_scene_override='unresolved',game_executed=False,rendering_enabled=False)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workspace',required=True,type=Path);parser.add_argument('--source',action='append')
    parser.add_argument('--output',required=True,type=Path);args=parser.parse_args()
    try:
        report=audit(args.workspace,args.source)
        args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    except (ValueError,OSError) as exc:parser.exit(1,str(exc)+'\n')
    print(json.dumps(dict(worlds=len(report['worlds']),presets=len(report['presets']),rendering_enabled=False)))
