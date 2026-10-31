"""Verify the investigated Edge shader and CPU path without executing the game."""
import argparse
import hashlib
import json
from pathlib import Path
import sys

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from audit_output_color import audit as audit_cpu
from closers.catalog import Catalog
from closers.loading import LoadingData
from closers.cmf import Archive

SHADER_SHA256='acdb46d12080aa44274aeb21d3238a19c35dd109d885b8763d052be7a9cab5cc'


def shader_source(workspace):
    catalog=Catalog(workspace);rows=LoadingData(catalog).rows('CW_EDGE.PS.CSO');sources=[]
    if not rows:raise ValueError('Original CW_EDGE.PS.CSO is unavailable.')
    for row in rows:
        catalog.verify_source(row)
        with Archive(row['archive']) as archive:body=b''.join(archive.chunks(catalog.entry(row)))
        catalog.verify_source(row);digest=hashlib.sha256(body).hexdigest()
        if digest!=SHADER_SHA256:raise ValueError('Unrecognized or ambiguous Edge shader SHA256; re-investigate the formula.')
        sources.append(dict(entry=row['id'],archive=row['archive'],ordinal=row['ordinal'],bytes=len(body),sha256=digest))
    return dict(status='verified',sha256=SHADER_SHA256,sources=sources)


def audit(workspace,executable):
    cpu=audit_cpu(executable)
    if cpu['status']!='verified':raise ValueError('CPU evidence mismatch; Edge shader association is not verified.')
    return dict(cpu=cpu,shader=shader_source(workspace),game_executed=False,viewer_defaults_changed=False)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--workspace',required=True,type=Path)
    parser.add_argument('--exe',required=True,type=Path);parser.add_argument('--output',required=True,type=Path)
    args=parser.parse_args()
    try:
        report=audit(args.workspace,args.exe);args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    except (ValueError,OSError) as exc:parser.exit(1,str(exc)+'\n')
    print(json.dumps(dict(cpu_checks=len(report['cpu']['checks']),shader=report['shader']['status'],game_executed=False)))
