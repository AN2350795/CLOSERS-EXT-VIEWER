"""Read-only naming audit of extracted models; output only in a new folder."""
import argparse
from collections import Counter,defaultdict
from contextlib import contextmanager
import json
from pathlib import Path
import sqlite3
import sys
import time

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from closers.catalog import file_hash
from closers.model import parse_x
from closers.model_groups import ModelGroups,CHARACTERS,classify


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--destination',required=True);args=parser.parse_args()
    root=Path(args.destination).resolve();root.mkdir(parents=True,exist_ok=False)
    database=Path(__file__).resolve().parents[2]/'results/catalog.sqlite3';before=file_hash(database)
    class ReadOnly:
        @contextmanager
        def connect(self):
            db=sqlite3.connect(database.as_uri()+'?mode=ro',uri=True);db.row_factory=sqlite3.Row;db.execute('PRAGMA query_only=ON')
            try:yield db
            finally:db.close()
    groups=ModelGroups(ReadOnly());start=time.perf_counter();rows=groups.snapshot();elapsed=time.perf_counter()-start
    by_set=defaultdict(list)
    for r in rows:
        if r['set_key']:by_set[r['set_key']].append(r)
    complete=ambiguous=0
    for values in by_set.values():
        base={r['part'] for r in values if r['variant']=='BASE'}
        required={'HAIR','FOOT','HAND'}|({'ONE_PIECE'} if 'ONE_PIECE' in base else {'UPBODY','LOWBODY'})
        complete+=required<=base
        ambiguous+=any(n>1 for n in Counter((r['part'],r['variant']) for r in values).values())
    face_checks=[];unchanged=[]
    for code,label in CHARACTERS.items():
        faces=[r for r in rows if r['character']==code and r['part']=='FACE' and r['set_name']=='BASIC' and r['variant']=='BASE']
        motions=[r for r in rows if r['name'].upper()=='MOTION_'+code+'.X']
        check=dict(character=code,label=label,face_candidates=len(faces),motion_candidates=len(motions))
        if len(faces)==len(motions)==1 and all(groups.saved(r) for r in faces+motions):
            scenes=[]
            for r in faces+motions:
                path=Path(r['output']);stat=path.stat();digest=file_hash(path)
                unchanged.append((path,stat.st_size,stat.st_mtime_ns,digest))
                try:scenes.append(parse_x(path.read_bytes()))
                except ValueError as exc:check['parse_error']=r['name']+': '+str(exc);break
            if len(scenes)==2:
                bones={f['name'] for f in scenes[1]['frames']}
                missing=sorted({s['bone'] for m in scenes[0]['meshes'] for s in m['skin']} - bones)
                check.update(face_frames=len(scenes[0]['frames']),motion_frames=len(bones),missing_skin_bones=missing,compatible_names=not missing)
        face_checks.append(check)
    for path,size,mtime,digest in unchanged:
        stat=path.stat();assert (stat.st_size,stat.st_mtime_ns,file_hash(path))==(size,mtime,digest)
    after=file_hash(database);assert before==after
    timings={}
    for label,callback in [('initial_saved_list',lambda:groups.entries({'saved':'existing','format':'x'})),
                           ('initial_saved_facets',lambda:groups.facets({'saved':'existing','format':'x'})),
                           ('saved_browser_combined',lambda:groups.browse({'saved':'existing','format':'x'})),
                           ('character_bundle',lambda:groups.bundle('STRIKER|CLOTH_212_A')),
                           ('character_sets',lambda:groups.sets({'saved':'existing','format':'x','character':'STRIKER'}))]:
        start=time.perf_counter();callback();timings[label]=time.perf_counter()-start
    report=dict(models=len(rows),saved_models=sum(groups.saved(r) for r in rows),formats=dict(Counter(r['format'] for r in rows)),
                kinds=dict(Counter(r['kind'] for r in rows)),avatar_characters=dict(Counter(r['character'] for r in rows if r['kind']=='avatar')),
                families=dict(Counter(r['family'] for r in rows if r['kind']=='avatar')),variants=dict(Counter(r['variant'] for r in rows if r['kind']=='avatar')),
                outfit_groups=len(by_set),groups_with_base_parts=complete,groups_with_ambiguous_slots=ambiguous,
                unbundled_avatars=sum(r['kind']=='avatar' and not r['set_key'] for r in rows),faces=face_checks,
                unknown_examples=[r['name'] for r in rows if r['kind']=='unknown'][:30],snapshot_seconds=elapsed,query_seconds=timings,
                operating_db_hash_before=before,operating_db_hash_after=after,verified_unchanged_files=len(unchanged))
    (root/'analysis.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({k:v for k,v in report.items() if k not in ('faces','unknown_examples')},ensure_ascii=True))


if __name__=='__main__':main()
