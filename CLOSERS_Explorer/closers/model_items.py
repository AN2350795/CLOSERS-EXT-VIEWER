"""Item appearances are independent of the mesh filenames they share."""
from collections import defaultdict
import math
from pathlib import Path
import re

from . import ntf
from .model_eyes import EyeAvatars
from .model_groups import classify, LABELS


class AvatarItems(EyeAvatars):
    def texture_rules(self):
        return self.data.cached(('avatar-texture-rules',2),self._texture_rules,persistent=True)

    @staticmethod
    def parse_texture_rule(row):
        changes={};unresolved=False
        shader_changes=any(v for k,v in row.items() if k not in ('m_DeviceID','m_mapTexChange'))
        auxiliary={'m_MultiTexName','m_MaskTexName','m_strDyeingMaskTexName'}
        allowed={'m_OrgTexName','m_ChangeTexName','SpecularColor','SpecularPower'}|auxiliary
        values=row.get('m_mapTexChange',{})
        if not isinstance(values,dict):return dict(textures={},shader_changes=shader_changes,unresolved=True)
        for value in values.values():
            if not isinstance(value,dict):unresolved=True;continue
            if set(value)=={'m_OrgToonTex','m_ChangeToonTex'}:
                shader_changes=True
                if not all(isinstance(v,str) and v for v in value.values()):unresolved=True
                continue
            original=value.get('m_OrgTexName')
            if not isinstance(original,str) or not original or set(value)-allowed:
                unresolved=True;continue
            if 'm_ChangeTexName' in value:
                target=value['m_ChangeTexName']
                if not isinstance(target,str) or not target:unresolved=True
                elif original.upper() in changes and changes[original.upper()]!=target.upper():unresolved=True
                else:changes[original.upper()]=target.upper()
            # These are extra shader inputs, not replacements for the base image.
            if set(value)-{'m_OrgTexName','m_ChangeTexName'}:shader_changes=True
            if any(not isinstance(value[k],str) for k in auxiliary&value.keys()):unresolved=True
            for field in ('SpecularPower','SpecularColor'):
                if field not in value:continue
                numbers=value[field]
                if field=='SpecularColor':
                    if not isinstance(numbers,dict) or len(numbers)!=4 or {str(k) for k in numbers}!={'1','2','3','4'}:unresolved=True;continue
                    numbers=list(numbers.values())
                else:numbers=[numbers]
                if any(type(v) not in (int,float) or not math.isfinite(v) for v in numbers):unresolved=True
        return dict(textures=changes,shader_changes=shader_changes,unresolved=unresolved)

    def _texture_rules(self):
        result={}
        with self.catalog.connect() as db:
            names=[r[0] for r in db.execute("SELECT DISTINCT name FROM entries WHERE name LIKE 'XET_TABLE%.LUA' ORDER BY name")]
        for name in names:
            if not re.fullmatch(r'XET_TABLE(?:_CHARACTER(?:_2)?)?\.LUA',name,re.I):continue
            for row in self.data.table(name).get('XET_TABLE',{}).values():
                key=row.get('m_DeviceID','').upper()
                if not key:continue
                rule=self.parse_texture_rule(row)
                if key in result and result[key]!=rule:rule['ambiguous']=True
                result[key]=rule
        return result

    def definitions(self):
        return self.data.cached(('avatar-items',2),self._definitions,persistent=True)

    def _definitions(self):
        models={}
        for _,body in self._tables(r'ITEM_MODEL_TEMPLET[\d_]*\.NTF'):
            for v in ntf.rows(body):
                if len(v)!=36:raise ValueError('미지원 아바타 모델 테이블입니다.')
                if v[1].startswith('GUST_NPC_'):continue
                refs=list(dict.fromkeys(s.upper() for s in v[3:5] if s.upper().endswith('.XET')))
                for filename in v[2:5]:
                    g=classify(filename)
                    if not filename.upper().endswith('.X') or g['kind']!='avatar' or g['part']=='FACE':continue
                    character=g['character'] or (v[1].removeprefix('GUST_USER_') if v[1].startswith('GUST_USER_') else '')
                    key=(v[0],character,filename.upper())
                    priority=int(v[1]=='GUST_USER_'+character)
                    record=dict(item_id=v[0],character=character,model_name=filename.upper(),refs=refs.copy(),model_priority=priority)
                    if key not in models or priority>models[key][0]:models[key]=(priority,record)
                    elif priority==models[key][0]:
                        models[key][1]['refs']=list(dict.fromkeys(models[key][1]['refs']+refs))
        ids={k[0] for k in models};items={}
        for _,body in self._tables(r'ITEM_TEMPLET[\d_]*\.NTF'):
            for v in ntf.rows(body):
                if v[1] not in ids:continue
                record=dict(string_key=v[2],set_name=v[3],icon_name=v[5].upper(),owner=v[11])
                if v[1] in items and items[v[1]]!=record:raise ValueError('아바타 아이템 번호가 충돌합니다.')
                items[v[1]]=record
        keys={v['string_key'] for v in items.values()};strings={}
        for _,body in self._tables(r'STRING_TABLE_ITEM\d*_KOREA\.NTF'):
            types,_,start=ntf.header(body)
            if types!=(5,8,8):raise ValueError('미지원 아바타 이름 테이블입니다.')
            body=body[:start]+ntf.decrypt(body[start:],*self.data.keys)
            for v in ntf.rows(body):
                if v[1] in keys:
                    if v[1] in strings and strings[v[1]]!=v[2]:raise ValueError('아바타 이름이 충돌합니다.')
                    strings[v[1]]=v[2]
        result=[]
        for _,model in models.values():
            item=items.get(model['item_id'])
            if not item or item['owner'].startswith('GUST_NPC_'):continue
            label=strings.get(item['string_key'],'')
            if not label or label in ('BLANK','INVAILD_STRING') or '눈동자' in label:continue
            refs=model['refs'] or ['']
            for i,ref in enumerate(refs):
                result.append(dict(model,**item,label=label,reference=ref,
                                   key=model['character']+':'+str(model['item_id'])+':'+str(i),
                                   view=i+1 if len(refs)>1 else 0))
        return result

    def compositions(self):
        def build():
            groups=defaultdict(list)
            for item in self.definitions():groups[item['key']].append(item)
            for key,values in groups.items():
                priority=max(v.get('model_priority',0) for v in values)
                groups[key]=[v for v in values if v.get('model_priority',0)==priority]
            return dict(groups)
        # Reuse the definition objects in memory; serializing the full graph
        # would duplicate the large source-verified definition cache on disk.
        return self.data.cached(('avatar-item-compositions',2),build)

    def composition(self,key,name):
        values=self.compositions().get(key,[])
        matches=[v for v in values if v['model_name']==name.upper()]
        if len(matches)!=1:raise ValueError('선택한 아이템과 모델의 연결이 다릅니다.')
        # DYE is an optional dye mesh, not part of the ordinary appearance.
        dye=classify(name)['variant']=='DYE'
        return [v for v in values if (classify(v['model_name'])['variant']=='DYE')==dye]

    def expand(self,rows,character,composite=True):
        index=self.compositions()
        known_names={r['model_name'] for r in self.definitions() if r['character'] in (character,'')}
        definitions=[r for values in index.values() for r in values if r['character'] in (character,'')]
        specific={r['item_id'] for r in definitions if r['character']==character}
        definitions=[r for r in definitions if r['character'] or r['item_id'] not in specific]
        by_model=defaultdict(list)
        roots={};components={}
        available={r['name'].upper() for r in rows}
        for item in definitions:
            dye=classify(item['model_name'])['variant']=='DYE'
            composition=[v for v in index[item['key']] if (classify(v['model_name'])['variant']=='DYE')==dye]
            group=(item['key'],classify(item['model_name'])['variant']=='DYE')
            if group not in roots:
                primary=min(composition,key=lambda v:(v['model_name'] not in available,classify(v['model_name'])['variant']!='BASE',v['model_name']))
                roots[group]=primary['model_name'];components[group]=composition
            by_model[item['model_name']].append(item)
        names=sorted({r['icon_name'] for r in definitions if r['icon_name']})
        icons=defaultdict(list)
        sources=defaultdict(list)
        with self.catalog.connect() as db:
            for offset in range(0,len(names),400):
                batch=names[offset:offset+400]
                for r in db.execute("SELECT id,name FROM entries WHERE category='images' AND flag!=2 AND name COLLATE NOCASE IN ("+','.join('?' for _ in batch)+')',batch):icons[r['name'].upper()].append(r['id'])
            model_names=sorted({v['model_name'] for values in components.values() if len(values)>1 for v in values})
            for offset in range(0,len(model_names),400):
                batch=model_names[offset:offset+400]
                for r in db.execute("SELECT e.id,e.name,e.ordinal,a.path archive FROM entries e JOIN archives a ON a.id=e.archive_id WHERE e.format='x' AND e.flag!=2 AND e.name COLLATE NOCASE IN ("+','.join('?' for _ in batch)+') ORDER BY e.id',batch):sources[r['name'].upper()].append(dict(r))
        result=[]
        for row in rows:
            appearances=by_model[row['name'].upper()]
            if not appearances:
                if not composite or row['name'].upper() not in known_names:result.append(row)
                continue
            for item in appearances:
                group=(item['key'],classify(item['model_name'])['variant']=='DYE')
                if composite and row['name'].upper()!=roots[group]:continue
                code=item['set_name'];g=classify(row['name'])
                bundled=bool(code and code not in ('A','NA','NB') and g['family']!='ACCESSORY')
                label=item['label']+((' · 표시 '+str(item['view'])) if item['view'] else '')
                typed=re.search(r'\[([^\]]*?)\s*타입\]',item['label'])
                costume_type=typed[1].strip() if typed else (code.rsplit('_',1)[1] if re.search(r'_[A-Z]+\d*$',code) else '')
                value=dict(row,appearance_key=item['key'],item_id=item['item_id'],display_name=label,game_names=[label],game_name_count=1,
                           set_name=code,set_key=character+'|'+code if bundled else '',
                           family=code.split('_')[0] if code.split('_')[0] in LABELS['family'] else g['family'],
                           type_label=code,costume_type=costume_type,reference=item['reference'],preview_kind='icon')
                value.pop('item_icon',None)
                if composite and len(components[group])>1:
                    value['components']=[dict(name=v['model_name'],appearance_key=v['key'],reference=v['reference'],candidates=sources[v['model_name']],selected=row['id'] if v['model_name']==row['name'].upper() else (sources[v['model_name']][0]['id'] if len(sources[v['model_name']])==1 else None)) for v in components[group]]
                if len(icons[item['icon_name']])==1:value['preview_entry']=icons[item['icon_name']][0]
                result.append(value)
        return result

    def resolve(self,key,name):
        matches=[r for r in self.compositions().get(key,[]) if r['model_name']==name.upper()]
        if len(matches)!=1:raise ValueError('선택한 아이템과 모델의 연결이 다릅니다.')
        item=dict(matches[0])
        rules=self.texture_rules();ref=item['reference']
        if ref in rules:
            if rules[ref].get('ambiguous'):raise ValueError('타입의 텍스처 변경 정의가 충돌합니다: '+ref)
            if rules[ref].get('unresolved'):raise ValueError('타입의 텍스처 변경 정의를 해석할 수 없습니다: '+ref)
            item.update(rules[ref])
        elif not ref or Path(ref).stem==Path(name).stem:
            item.update(textures={},shader_changes=False)
        else:raise ValueError('타입의 표시 정의를 찾을 수 없습니다: '+ref)
        return item

    @staticmethod
    def texture_target(material,model,item):
        original=Path((material.get('texture') or '').replace('\\','/')).name.upper()
        changes=item.get('textures',{})
        if original in changes:return changes[original]
        # Packaging can change PNG/TGA extension while preserving the texture ID.
        matches={v for k,v in changes.items() if Path(k).stem==Path(original).stem}
        return next(iter(matches)) if len(matches)==1 else None
