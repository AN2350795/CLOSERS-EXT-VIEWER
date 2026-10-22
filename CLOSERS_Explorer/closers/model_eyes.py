"""Item-level eye appearances sharing a face mesh, read from game definitions."""
from collections import defaultdict
from pathlib import Path
import re

from . import ntf
from .loading import LoadingData
from .model_groups import CHARACTERS, ModelGroups, classify


class EyeAvatars:
    def __init__(self, catalog):
        self.catalog=catalog
        self.data=LoadingData(catalog)

    def definitions(self):
        return self.data.cached(('eye-avatars',4),self._definitions,persistent=True)

    def _tables(self, pattern):
        with self.catalog.connect() as db:
            names=[r[0] for r in db.execute('SELECT DISTINCT name FROM entries WHERE format=\'ntf\' ORDER BY name')
                   if re.fullmatch(pattern,r[0],re.I)]
        for name in names:
            yield name,self.data.body(name)

    def _definitions(self):
        models={};priorities={}
        for _,body in self._tables(r'ITEM_MODEL_TEMPLET[\d_]*\.NTF'):
            for v in ntf.rows(body):
                if len(v)!=36:raise ValueError('미지원 눈동자 모델 테이블입니다.')
                face=classify(v[2])
                if face['kind']!='avatar' or face['part'] not in ('FACE','ACC_RING_RIGHT') or not v[2].upper().endswith('.X'):continue
                if v[1].startswith('GUST_NPC_'):continue
                # Eye items reuse the face and identify their appearance with an
                # XET reference. The observed assets store its exact stem as PNG.
                refs=list(dict.fromkeys(s.upper() for s in v[3:5] if isinstance(s,str) and s.upper().endswith('.XET')))
                if not refs:continue
                key=face['character']+':'+str(v[0])
                priority=int(v[1]=='GUST_USER_'+face['character'])
                if key in priorities and priorities[key]>priority:continue
                variants=[dict(key=key+(':'+str(i+1) if len(refs)>1 else ''),item_id=v[0],character=face['character'],face_name=v[2].upper(),
                               texture_name=ref[:-4]+'.PNG',reference=ref,geometry=face['part']!='FACE',view=i+1 if len(refs)>1 else 0)
                          for i,ref in enumerate(refs)]
                if key in models and priorities[key]==priority and models[key]!=variants:raise ValueError('눈동자 아이템의 모델 연결이 충돌합니다.')
                models[key]=variants;priorities[key]=priority
        variants=[row for rows in models.values() for row in rows]
        wanted={v['item_id'] for v in variants};items={}
        for _,body in self._tables(r'ITEM_TEMPLET[\d_]*\.NTF'):
            for v in ntf.rows(body):
                if v[1] not in wanted:continue
                item=dict(string_key=v[2],icon_name=v[5].upper())
                if v[1] in items and items[v[1]]!=item:raise ValueError('눈동자 아이템 이름 연결이 충돌합니다.')
                items[v[1]]=item
        keys={v['string_key'] for v in items.values()};strings={}
        for _,body in self._tables(r'STRING_TABLE_ITEM\d*_KOREA\.NTF'):
            types,_,start=ntf.header(body)
            if types!=(5,8,8):raise ValueError('미지원 눈동자 이름 테이블입니다.')
            body=body[:start]+ntf.decrypt(body[start:],*self.data.keys)
            for v in ntf.rows(body):
                if v[1] in keys:
                    if v[1] in strings and strings[v[1]]!=v[2]:raise ValueError('눈동자 이름이 충돌합니다.')
                    strings[v[1]]=v[2]
        result=[]
        for row in variants:
            item=items.get(row['item_id'],{})
            label=strings.get(item.get('string_key'),'')
            # Other face appearances must not be mislabeled as pupils.
            if '눈동자' not in label:continue
            if row['view']:label+=' · 표시 '+str(row['view'])
            result.append(dict(row,label=label,icon_name=item.get('icon_name',''),basic=False))
        # Event/stat variants can have the same name and exact appearance.
        # Group those aliases, retaining all IDs; distinct textures stay separate.
        appearances={}
        for row in sorted(result,key=lambda r:r['item_id']):
            key=tuple(row[k] for k in ('character','face_name','texture_name','label','icon_name','geometry'))
            if key not in appearances:appearances[key]=dict(row,item_ids=[])
            appearances[key]['item_ids'].append(row['item_id'])
        return list(appearances.values())

    def resources(self):
        definitions=self.definitions()
        by_name=defaultdict(list)
        wanted={v[k] for v in definitions for k in ('face_name','texture_name','icon_name') if v[k]}
        with self.catalog.connect() as db:
            faces=[dict(r) for r in db.execute('''SELECT e.id,e.name,e.output,e.flag,a.path archive,e.ordinal,a.mtime/1000000 updated_at
                FROM entries e JOIN archives a ON a.id=e.archive_id
                WHERE e.format='x' AND e.name LIKE '%EP_AVATAR%FACE.X' AND e.flag!=2 ORDER BY e.id''')
                   if classify(r['name'])['part']=='FACE']
            for row in faces:by_name[row['name'].upper()].append(row)
            image_names=sorted(wanted-{r['name'].upper() for r in faces})
            for offset in range(0,len(image_names),400):
                batch=image_names[offset:offset+400]
                for r in db.execute('''SELECT e.id,e.name,e.output,e.flag,a.path archive,e.ordinal,a.mtime/1000000 updated_at
                    FROM entries e JOIN archives a ON a.id=e.archive_id WHERE e.flag!=2 AND e.format IN ('x','png','tga','dds')
                    AND e.name COLLATE NOCASE IN ('''+','.join('?' for _ in batch)+') ORDER BY e.id',batch):
                    by_name[r['name'].upper()].append(dict(r))
        basics={r['name'].upper() for r in faces if classify(r['name'])['set_name']=='BASIC'}
        options=[dict(key=classify(name)['character']+':basic',character=classify(name)['character'],face_name=name,
                      texture_name='',icon_name='',label=CHARACTERS.get(classify(name)['character'],classify(name)['character'])+' 기본 눈동자',basic=True,item_id=None,geometry=False)
                 for name in sorted(basics)]+definitions
        result=[]
        def choices(rows):
            return [dict(r,saved_exists=bool(r['output'] and Path(r['output']).is_file())) for r in rows]
        for v in options:
            face=choices(by_name[v['face_name']]);texture=choices(by_name[v['texture_name']])
            base=choices([r for r in faces if classify(r['name'])['character']==v['character'] and classify(r['name'])['set_name']=='BASIC']) if v['geometry'] else []
            icon=by_name[v['icon_name']]
            dates=[r['updated_at'] for r in (face if v['basic'] else texture) if r['updated_at'] is not None]
            result.append(dict(v,face_candidates=face,texture_candidates=texture,
                               base_face_candidates=base,base_face_id=base[0]['id'] if len(base)==1 else None,
                               face_id=face[0]['id'] if len(face)==1 else None,
                               texture_id=texture[0]['id'] if len(texture)==1 else None,
                               preview_entry=icon[0]['id'] if len(icon)==1 else (texture[0]['id'] if len(texture)==1 else None),
                               preview_kind='icon' if len(icon)==1 else 'texture',
                               saved_exists=bool(any(r['saved_exists'] for r in face) and (v['basic'] or any(r['saved_exists'] for r in texture)) and
                                                 (not v['geometry'] or any(r['saved_exists'] for r in base))),
                               available=bool(face and (v['basic'] or texture) and (not v['geometry'] or base)),updated_at=max(dates,default=None),
                               kind='avatar',part='EYES',family='BASIC' if v['basic'] else 'OTHER',variant='BASE'))
        return result

    def browse(self,filters):
        rows=self.resources()
        if filters.get('saved')=='existing':rows=[r for r in rows if r['saved_exists']]
        elif filters.get('saved')=='missing':rows=[r for r in rows if not r['saved_exists']]
        if filters.get('q'):
            q=filters['q'].casefold()
            rows=[r for r in rows if q in (r['label']+' '+r['character']+' '+r['face_name']+' '+r['texture_name']+' '+str(r.get('item_ids',[]))).casefold()]
        facets=ModelGroups.facet_rows(rows,filters)
        rows=[r for r in rows if all(not filters.get(k) or r[k]==filters[k] for k in ('character','kind','part','family','variant'))]
        rows.sort(key=lambda r:(r['character'],not r['basic'],r['label'],r['key']))
        result=ModelGroups.paginate(rows,filters);result.update(facets)
        return result

    def resolve(self,key,face_id,texture_id=None):
        resources=self.resources()
        option=next((r for r in resources if r['key']==key),None)
        if not option:raise ValueError('눈동자 아이템을 찾을 수 없습니다.')
        if face_id not in [r['id'] for r in option['face_candidates']]:raise ValueError('눈동자의 얼굴 출처가 다릅니다.')
        if not option['basic'] and texture_id not in [r['id'] for r in option['texture_candidates']]:
            raise ValueError('눈동자 텍스처 출처를 선택하세요.')
        if option['geometry']:
            aliases=set(option['item_ids'])
            option['texture_targets']={Path(r['texture_name']).stem for r in resources
                                       if r['character']==option['character'] and r['face_name']==option['face_name'] and aliases.intersection(r.get('item_ids',[]))}
        return option


def eye_material(material):
    name=Path(material.get('texture','').replace('\\','/')).stem.upper()
    return bool(re.search(r'(?:_FACE)?_EYE\d*$',name))
