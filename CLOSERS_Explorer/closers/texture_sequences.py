"""Exact, unique first-frame links from the game's texture animation table."""
import math
from .motion_extras import values,unique_rows


def texture_sequences(tables):
    wanted={r.get('m_AnimName') for table in tables.values() for r in values(table.get('m_mapTexAnimData'))
            if isinstance(r,dict) and isinstance(r.get('m_AnimName'),str)}
    definitions=unique_rows(tables,'m_mapTexAnimData','m_AnimName',wanted)
    result={}
    for name,row in definitions.items():
        frames=[]
        for f in values(row.get('m_vecFrame')):
            if not isinstance(f,dict) or not isinstance(f.get('m_TexName'),str):break
            duration=f.get('m_fTime')
            if type(duration) not in (int,float) or not math.isfinite(duration) or not 0<duration<=1e9:break
            frames.append(dict(name=f['m_TexName'],duration=duration))
        else:
            if not 2<=len(frames)<=2048:continue
            first=frames[0]['name'].replace('\\','/').split('/')[-1].upper()
            result.setdefault(first,[]).append(dict(name=name,frames=frames,source=row['source'],evidence='exact-unique-first-frame'))
    return {first:rows[0] if len(rows)==1 else dict(ambiguous=True,names=[r['name'] for r in rows]) for first,rows in result.items()}
