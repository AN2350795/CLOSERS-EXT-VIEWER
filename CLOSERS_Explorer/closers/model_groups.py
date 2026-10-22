"""Observable model naming metadata and source-preserving avatar bundles.

Character labels: Naddic's official jumping guide, contentNo=118.
Costume codes are file-name evidence, not verified in-game costume names.
"""
from collections import Counter,defaultdict
from functools import lru_cache
from pathlib import Path
import re
import threading

CHARACTERS = dict(zip(
    'STRIKER CASTER RANGER FIGHTER LANCER IDOL HUNTER WITCH ROGUE ARMS VALKYRIE VAGABOND LIBRARIAN AEGIS ASTRA MYSTIC BEAST GATEKEEPER NONAME REAPER KNIVES ALTEREGO DEVILISH'.split(),
    '이세하 이슬비 서유리 제이 미스틸테인 윤리아 나타 레비아 하피 티나 바이올렛 트리스 볼프강 루나 소마 파이 세트 모아 김철수 미래 은하 루시 애리'.split()))
LABELS = {
    'kind':dict(avatar='캐릭터 아바타',motion='공용 뼈·동작',npc='NPC',monster='몬스터',background='배경·오브젝트',effect='효과',unknown='미분류'),
    'part':dict(HAIR='머리',FACE='얼굴',EYES='눈동자',UPBODY='상의',LOWBODY='하의',FOOT='신발',HAND='장갑',ONE_PIECE='한 벌',WEAPON='무기',
                ACC_HEAD_HAIR='헤어 액세서리',ACC_HEAD_EAR='귀 액세서리',ACC_HEAD_EYE='눈 액세서리',ACC_HEAD_MOUTH='입 액세서리',
                ACC_BODY_CHEST='가슴 액세서리',ACC_BODY_WING='등·날개 액세서리',ACC_BODY_WAIST='허리 액세서리',
                ACC_LEG='다리 액세서리',ACC_RING_RIGHT='오른손 반지',ACC_RING_LEFT='왼손 반지',unknown='기타 부위'),
    'family':dict(BASIC='기본',PROMOTION='승급',CLOTH='일반 의상',RARE='레어',SCHOOL='학교',SBENU='SBENU',ACCESSORY='공통 액세서리',OTHER='기타 의상',unknown='미분류'),
    'variant':dict(BASE='기본 메시',ALPHA='ALPHA 보조 메시',DYE='DYE 염색 메시',unknown='미분류')}
CORE = {'HAIR','UPBODY','LOWBODY','FOOT','HAND','ONE_PIECE','FACE'}


@lru_cache(maxsize=65536)
def classify(name):
    stem = Path(name.replace('\\','/')).stem.upper()
    value = dict(character='',kind='unknown',family='unknown',part='unknown',variant='BASE',set_key='',set_name='',item_code='',raw_part='')
    match = re.search(r'(?:^|_)GUST_USER_([A-Z]+)_(.+?)_EP_AVATAR(?:_(.*))?$',stem)
    if match:
        character,descriptor,raw = match.groups();raw=raw or ''
        value.update(character=character,kind='avatar',raw_part=raw,item_code=stem.split('_')[0] if stem.split('_')[0].isdigit() else '')
        suffix = re.search(r'_(ALPHA|DYE|\d+)$',raw)
        if suffix:raw=raw[:suffix.start()];value['variant']=suffix[1]
        part = raw.removeprefix('DEFENCE_')
        value['part'] = part if part else 'unknown'
        family = descriptor.split('_')[0]
        value['family'] = family if family in LABELS['family'] else 'OTHER'
        # A/NA/NB are shared pools, not coherent outfits. Keep them unbundled.
        if descriptor in ('A','NA','NB'):value['family']='ACCESSORY'
        elif (re.fullmatch(r'(?:CLOTH|RARE)_\d+_[A-Z]+',descriptor)
              or re.fullmatch(r'(?:BASIC|PROMOTION)(?:_\d+)?',descriptor)
              or re.fullmatch(r'(?:SCHOOL|SBENU|ALPHA)_[A-Z]+',descriptor)):
            value.update(set_key=character+'|'+descriptor,set_name=descriptor)
        return value
    if stem.startswith('MOTION_'):
        value['kind']='motion'
        match=re.match(r'MOTION_([A-Z]+)(?:_|$)',stem)
        if match:value['character']=match[1]
    elif 'GUST_NPC_' in stem:
        value['kind']='monster' if 'MONSTER' in stem else 'npc'
        # An NPC bearing a playable class is still kept in the NPC category.
        codes=[c for c in CHARACTERS if re.search(r'(?:^|_)'+c+r'(?:_|$)',stem)]
        if len(codes)==1:value['character']=codes[0]
    elif re.match(r'(?:FX|EFF|EFFECT|GUST_EFFECT)_',stem):value['kind']='effect'
    elif stem.startswith(('WI_','GUST_MAP_','GUST_BG_')):value['kind']='background'
    return value


def field(name,key):
    return classify(name).get(key,'')


class ModelGroups:
    def __init__(self,catalog):
        self.catalog=catalog;self.lock=threading.RLock();self.version=None;self.rows=[]

    def snapshot(self,refresh=False):
        with self.lock, self.catalog.connect() as db:
            db.execute('BEGIN')
            revision=db.execute("SELECT value FROM catalog_meta WHERE key='revision'").fetchone()[0]
            version=(revision,self.catalog.game_names.version)
            if refresh or version!=self.version:
                rows=db.execute('''SELECT e.id,e.name,e.format,e.flag,e.status,e.output,e.archive_id,e.ordinal,a.path archive,a.mtime/1000000 updated_at
                    FROM entries e JOIN archives a ON a.id=e.archive_id WHERE e.category='models' ORDER BY e.id''').fetchall()
                self.rows=[self.catalog.game_names.decorate(dict(r,**classify(r['name']))) for r in rows]
                self.version=version
            return self.rows.copy()

    @staticmethod
    def saved(row):
        return bool(row['output'] and Path(row['output']).is_file())

    def filtered(self,filters,exclude=None):
        rows=self.snapshot(filters.get('refresh')=='1')
        for key in ('character','kind','part','family','variant','format'):
            if key!=exclude and filters.get(key):rows=[r for r in rows if r[key]==filters[key]]
        saved=filters.get('saved','')
        if saved=='existing':rows=[r for r in rows if self.saved(r)]
        elif saved=='missing':rows=[r for r in rows if not self.saved(r)]
        if filters.get('q'):
            q=filters['q'].casefold()
            rows=[r for r in rows if q in (r['name']+' '+r['archive']+' '+CHARACTERS.get(r['character'],'')+' '+self.catalog.game_names.text(r['name'])).casefold()]
        return rows

    def facets(self,filters):
        keys=('character','kind','family','part','variant')
        base=self.filtered({k:v for k,v in filters.items() if k not in keys})
        return self.facet_rows(base,filters)

    @staticmethod
    def facet_rows(base,filters):
        result={};keys=('character','kind','family','part','variant')
        for key in keys:
            rows=[r for r in base if all(not filters.get(k) or r[k]==filters[k] for k in keys if k!=key)]
            counts=Counter(r[key] for r in rows if r[key])
            result[key]=[dict(value=v,label=CHARACTERS.get(v,v) if key=='character' else LABELS[key].get(v,v),count=n)
                         for v,n in sorted(counts.items())]
        return dict(facets=result,evidence='파일명 기반 분류 · 의상 코드는 인게임 의상명 미확정')

    @staticmethod
    def paginate(rows,filters):
        if filters.get('sort') in ('newest','oldest'):
            direction=-1 if filters['sort']=='newest' else 1
            rows=sorted(rows,key=lambda r:(r.get('updated_at') is None,direction*(r.get('updated_at') or 0)))
        page=max(1,int(filters.get('page',1)));limit=min(60,max(1,int(filters.get('limit',20))))
        return dict(items=rows[(page-1)*limit:page*limit],total=len(rows),page=page,limit=limit)

    def entries(self,filters):
        result=self.paginate(self.filtered(filters),filters)
        result['items']=[dict(r,saved_exists=self.saved(r)) for r in result['items']]
        return result

    def sets(self,filters):
        return self.set_rows(self.filtered(filters),filters)

    def set_rows(self,rows,filters):
        groups=defaultdict(list)
        for row in rows:
            if row['set_key'] and row['format']=='x':groups[row['set_key']].append(row)
        items=[]
        for key,rows in sorted(groups.items()):
            # Display count follows filters; bundle detail resolves the entire exact set.
            parts=sorted({r['part'] for r in rows})
            items.append(dict(key=key,character=rows[0]['character'],label=self.bundle_label(rows),
                              count=len(rows),parts=parts,part_labels=[LABELS['part'].get(p,p) for p in parts],
                              updated_at=max((r['updated_at'] for r in rows if r.get('updated_at') is not None),default=None)))
            # A set thumbnail represents one observed item, never a full outfit illustration.
            for part in ('ONE_PIECE','UPBODY','HAIR','WEAPON','LOWBODY','FOOT','HAND'):
                icons={r['item_icon']['sha256']:r['item_icon'] for r in rows
                       if r['part']==part and r['variant']=='BASE' and r.get('item_icon')}
                if len(icons)==1:
                    items[-1]['item_icon']=dict(next(iter(icons.values())),part_label=LABELS['part'].get(part,part))
                    break
        return self.paginate(items,filters)

    @staticmethod
    def bundle_label(rows):
        import os
        names=[r['game_names'][0] for r in rows if r.get('game_names')]
        # Show an observed common name prefix only when different parts agree.
        prefix=os.path.commonprefix(names).strip() if len(set(names))>1 else ''
        character=CHARACTERS.get(rows[0]['character'],rows[0]['character'])
        title=prefix if len(prefix)>len(character)+2 else character
        return title+' · '+rows[0]['set_name']

    def browse(self,filters):
        keys=('character','kind','family','part','variant')
        # One existence pass for both the page and all facet counts.
        base=self.filtered({k:v for k,v in filters.items() if k not in keys})
        if filters.get('mode')=='sets':base=[r for r in base if r['set_key']]
        elif filters.get('mode')=='accessories':base=[r for r in base if r['family']=='ACCESSORY']
        rows=[r for r in base if all(not filters.get(k) or r[k]==filters[k] for k in keys)]
        if filters.get('mode')=='sets':result=self.set_rows(rows,filters)
        else:
            result=self.paginate(rows,filters)
            result['items']=[dict(r,saved_exists=self.saved(r)) for r in result['items']]
        result.update(self.facet_rows(base,filters))
        return result

    def bundle(self,key,saved='existing'):
        all_rows=self.filtered(dict(saved=saved,format='x',character=key.split('|')[0]))
        rows=[r for r in all_rows if r['set_key']==key and r['flag']!=2]
        if not rows:raise ValueError('해당 조건의 아바타 묶음이 없습니다. 저장 파일·필터를 확인하세요.')
        character=rows[0]['character'];slots=defaultdict(list)
        for row in rows:slots[(row['part'],row['variant'])].append(row)
        has_one_piece=any(part=='ONE_PIECE' and variant=='BASE' for part,variant in slots)
        def choices(rows):
            return [dict(id=r['id'],name=r['name'],display_name=r.get('display_name',r['name']),archive=r['archive'],ordinal=r['ordinal'],saved_exists=self.saved(r)) for r in rows]
        result=[]
        for (part,variant),candidates in sorted(slots.items()):
            checked=part in CORE and part!='FACE' and variant in ('BASE','ALPHA') and not(has_one_piece and part in ('UPBODY','LOWBODY'))
            result.append(dict(part=part,variant=variant,label=LABELS['part'].get(part,part)+' · '+LABELS['variant'].get(variant,variant),
                               candidates=choices(candidates),selected=candidates[0]['id'] if len(candidates)==1 else None,checked=checked))
        faces=[r for r in rows if r['part']=='FACE' and r['variant']=='BASE']
        if not faces:faces=[r for r in all_rows if r['kind']=='avatar' and r['character']==character and r['part']=='FACE' and r['set_name']=='BASIC' and r['variant']=='BASE' and r['flag']!=2]
        motions=[r for r in all_rows if r['name'].upper()=='MOTION_'+character+'.X' and r['flag']!=2]
        defaults=[]
        basic=[r for r in all_rows if r['kind']=='avatar' and r['family']=='BASIC' and r['flag']!=2]
        for part in sorted(CORE):
            bases=[r for r in basic if r['part']==part and r['variant']=='BASE']
            canonical=[r for r in bases if r['set_name']=='BASIC']
            if canonical:bases=canonical
            if not bases:continue
            sets={r['set_name'] for r in bases}
            variants=[('BASE',bases)]
            # Supplements must belong to the same basic outfit as the base.
            if len(sets)==1:
                alpha=[r for r in basic if r['part']==part and r['variant']=='ALPHA' and r['set_name'] in sets]
                if alpha:variants.append(('ALPHA',alpha))
            for variant,candidates in variants:
                defaults.append(dict(part=part,variant=variant,label='기본 '+LABELS['part'].get(part,part)+' · '+LABELS['variant'][variant],
                                     candidates=choices(candidates),selected=candidates[0]['id'] if len(candidates)==1 else None))
        return dict(key=key,character=character,label=self.bundle_label(rows),slots=result,
                    defaults=defaults,
                    face=dict(candidates=choices(faces),selected=faces[0]['id'] if len(faces)==1 else None),
                    motion=dict(candidates=choices(motions),selected=motions[0]['id'] if len(motions)==1 else None),
                    evidence='같은 캐릭터·의상 코드·타입의 파일명 묶음; 얼굴은 동일 캐릭터 기본 얼굴 후보')
