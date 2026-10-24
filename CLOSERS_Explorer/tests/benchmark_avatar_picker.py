import cProfile,json,pstats,sys,time
from pathlib import Path
sys.path.insert(0,str(Path('CLOSERS_Explorer').resolve()))
from closers.catalog import Catalog
from closers.model_library import Models
c=Catalog('results');models=Models(c);output=[]
statements=[];original=c.open_connection
def opened():
 db=original();db.set_trace_callback(statements.append);return db
c.open_connection=opened
for label,mode,page in [('sets-first','sets',1),('sets-page2','sets',2),('sets-return','sets',1),('parts-first','parts',1),('accessories-first','accessories',1),('eyes-first','eyes',1)]:
 statements.clear();p=cProfile.Profile();start=time.perf_counter();p.enable()
 params=dict(character='ROGUE',items='1',mode=mode,saved='',format='x',limit='20',page=str(page),variant='BASE' if mode=='parts' else '')
 result=models.eyes.browse(params) if mode=='eyes' else models.groups.browse(params)
 p.disable();elapsed=time.perf_counter()-start;calls={}
 for (file,line,name),(cc,nc,tt,ct,_) in pstats.Stats(p).stats.items():
  if name in ('refresh','open_connection','stat','expand','snapshot','resources','valid','saved'):
   key=Path(file).name+':'+name;value=calls.setdefault(key,dict(count=0,seconds=0));value['count']+=nc;value['seconds']+=ct
 output.append(dict(label=label,seconds=elapsed,total=result['total'],sql=len(statements),calls=calls));print(json.dumps(output[-1]),flush=True)
Path('diagnostics/picker-'+sys.argv[1]+'-profile.json').write_text(json.dumps(output,indent=2))
