"""Source-defined equipment omitted by the ordinary model/eye pickers.

Selection here records equipment for condition calculations only. It does not
render particle gear or face-linked costume effects.
"""
import re
from . import ntf
from .model_groups import classify, LABELS


def read_options(data, catalog, rules):
    wanted={i for r in rules for i in r['item_ids']}
    if not wanted:return []
    def tables(pattern):
        with catalog.connect() as db:
            names=[r[0] for r in db.execute("SELECT DISTINCT name FROM entries WHERE format='ntf' ORDER BY name") if re.fullmatch(pattern,r[0],re.I)]
        for name in names:yield name,data.body(name)
    models={}
    for name,body in tables(r'ITEM_MODEL_TEMPLET[\d_]*\.NTF'):
        for row in ntf.rows(body):
            if len(row)!=36:raise ValueError('추가 장비의 모델 테이블 형식을 지원하지 않습니다.')
            if row[0] not in wanted:continue
            owner=row[1]
            if owner!='GUST_INVALID' and not owner.startswith('GUST_USER_'):continue
            character=owner.removeprefix('GUST_USER_') if owner!='GUST_INVALID' else ''
            group=classify(row[2])
            ordinary=any(isinstance(v,str) and v.upper().endswith('.X') and classify(v)['part']!='FACE' for v in row[2:5])
            key=(row[0],character)
            record=dict(ordinary=ordinary,source=name)
            if key in models:record['ordinary'] |= models[key]['ordinary']
            models[key]=record
    items={}
    for name,body in tables(r'ITEM_TEMPLET[\d_]*\.NTF'):
        for row in ntf.rows(body):
            if len(row)<15:raise ValueError('추가 장비의 아이템 테이블 형식을 지원하지 않습니다.')
            if row[1] not in wanted:continue
            if row[9] not in ('IT_AVATAR','IT_AVATAR_ACC') or not row[14].startswith('EP_AVATAR_'):continue
            part=row[14].removeprefix('EP_AVATAR_').removeprefix('DEFENCE_')
            if part not in LABELS['part'] or part in ('FACE','EYES','unknown'):continue
            record=dict(item_id=row[1],string_key=row[2],part=part,owner=row[11],source=name)
            if row[1] in items and {k:v for k,v in items[row[1]].items() if k!='source'}!={k:v for k,v in record.items() if k!='source'}:raise ValueError('추가 장비의 아이템 연결이 충돌합니다.')
            items[row[1]]=record
    eligible={}
    for rule in rules:
        for item_id in rule['item_ids']:
            item=items.get(item_id)
            if not item:continue
            for character in rule['characters']:
                model=models.get((item_id,character),models.get((item_id,'')))
                if not model or model['ordinary'] or item['owner'] not in ('GUST_INVALID','GUST_USER_'+character):continue
                eligible[(item_id,character)]=(item,model)
    keys={item['string_key'] for item,model in eligible.values()};strings={}
    if keys:
        for name,body in tables(r'STRING_TABLE_ITEM\d*_KOREA\.NTF'):
            types,_,start=ntf.header(body)
            if types!=(5,8,8):raise ValueError('추가 장비의 이름 테이블 형식을 지원하지 않습니다.')
            body=body[:start]+ntf.decrypt(body[start:],*data.keys)
            for _,key,label in ntf.rows(body):
                if key not in keys:continue
                if key in strings and strings[key]!=label:raise ValueError('추가 장비의 이름이 충돌합니다.')
                strings[key]=label
    result=[]
    for (item_id,character),(item,model) in sorted(eligible.items()):
        label=strings.get(item['string_key'],'')
        if not label or label in ('BLANK','INVAILD_STRING') or '눈동자' in label:continue
        result.append(dict(item_id=item_id,character=character,part=item['part'],part_label=LABELS['part'][item['part']],
                           label=label,rendered=False,sources=[item['source'],model['source']]))
    return result


def options(data,catalog,rules):
    return data.cached(('avatar-condition-items',1),lambda:read_options(data,catalog,rules),persistent=True)
