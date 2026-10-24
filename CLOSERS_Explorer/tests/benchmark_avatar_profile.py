import cProfile
import json
import pstats
import sys
import time
import urllib.request
import re
from pathlib import Path
sys.path.insert(0, str(Path('CLOSERS_Explorer').resolve()))
from closers.catalog import Catalog
from closers.model_library import Models

choice=json.loads(Path('diagnostics/material-cloth-choice.json').read_text())
catalog=Catalog('results'); models=Models(catalog)
results=[]
statements=[]
original_open=catalog.open_connection
def traced_open():
    db=original_open();db.set_trace_callback(statements.append);return db
catalog.open_connection=traced_open
for label,ids,items in [('single',[25986],{'25986':'ROGUE:1307012414:0'}),('single-repeat',[25986],{'25986':'ROGUE:1307012414:0'}),('full',choice['ids'],choice['items']),('full-repeat',choice['ids'],choice['items']),('replace',choice['ids'],dict(choice['items'],**{'25986':'ROGUE:1307012514:0'}))]:
    statements.clear()
    profile=cProfile.Profile();start=time.perf_counter();profile.enable()
    scene=models.scene(ids,171835,items=items)
    profile.disable();prepared=time.perf_counter();body=json.dumps(scene,ensure_ascii=False).encode();end=time.perf_counter()
    stats=pstats.Stats(profile)
    calls={}
    for (file,line,name),(cc,nc,tt,ct,_) in stats.stats.items():
        if name in ('refresh','open_connection','stat','valid','revision','matches','parse_x'):
            key=Path(file).name+':'+name
            previous=calls.get(key,{'calls':0,'seconds':0});previous['calls']+=nc;previous['seconds']+=ct;calls[key]=previous
    results.append(dict(label=label,prepare=prepared-start,json=end-prepared,bytes=len(body),sql=len(statements),candidate_queries=sum("SELECT e.id,e.name,e.ordinal" in s for s in statements),calls=calls))
    print(json.dumps(results[-1]),flush=True)
Path('diagnostics/viewer-'+sys.argv[1]+'-profile.json').write_text(json.dumps(results,indent=2))
