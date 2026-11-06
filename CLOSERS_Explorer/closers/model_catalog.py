"""Publish a complete, source-preserving model and motion classification snapshot."""
from collections import Counter
from contextlib import closing
import json
import sqlite3

from .catalog import operation_lock
from .cmf import check_cancel
from .model_groups import LABELS
from .model_library import Models
from .motion_names import decorate
from .motion_catalog import decorate as registrations
from .model_motions import category
from .updates import atomic_json


def build(catalog,cancel=None,progress=lambda **kw:None):
    check_cancel(cancel)
    changed=catalog.reclassify_models()
    models=Models(catalog);files=[]
    with operation_lock(catalog.workspace),models.operation():
        with catalog.connect() as db:
            rows=[dict(row) for row in db.execute('''SELECT e.id,e.name,e.format,e.flag,e.output,e.sha256,e.status,
                e.ordinal,a.path archive FROM entries e JOIN archives a ON a.id=e.archive_id
                WHERE e.format IN ('x','xmd','fbx','obj','mesh','skel','anim') ORDER BY e.id''')]
        for index,row in enumerate(rows):
            check_cancel(cancel)
            group=catalog.game_names.group(row['name'])
            item=catalog.game_names.decorate(dict(row,model_group=group))
            item['name_status']='official' if item.get('game_names') else 'code'
            if row['format']=='xmd':
                item.update(motion_category=category(row['name']),clips=[])
                try:
                    body,_,source=models.read(row['id'],'xmd')
                    parsed=models.parse(body,source,'xmd')
                    character=group['character'] if group['kind'] in ('avatar','motion') else ''
                    item['clips']=registrations(decorate(parsed['clips'],character,catalog.game_names.motion_names),character,catalog.game_names.motion_catalog)
                    item['source']=source;item['parse_status']='ready'
                except (ValueError,OSError) as exc:item.update(parse_status='unavailable',parse_error=str(exc))
                progress(current='모션 분류·명칭 '+row['name'],done=index+1,total=len(rows))
            elif index%500==0:progress(current='모델 분류·명칭 '+row['name'],done=index+1,total=len(rows))
            files.append(item)
        kinds=Counter(item['model_group']['kind'] for item in files)
        formats=Counter(item['format'] for item in files)
        clips=[clip for item in files for clip in item.get('clips',[])]
        summary=dict(files=len(files),classified=len(files)-kinds.get('unknown',0),unclassified=kinds.get('unknown',0),
            official_file_names=sum(item['name_status']=='official' for item in files),clips=len(clips),
            official_clip_names=sum(clip.get('name_kind')=='official' for clip in clips),
            contextual_clip_names=sum(clip.get('name_kind')=='context' for clip in clips),
            related_clip_names=sum(clip.get('name_kind')=='reference' for clip in clips),
            unnamed_clips=sum(not clip.get('name_kind') for clip in clips),
            parse_unavailable=sum(item.get('parse_status')=='unavailable' for item in files),
            classifications=dict(kinds),formats=dict(formats),reclassified=changed,
            naming_index_available=bool(catalog.game_names.version))
        target=catalog.workspace/'model-catalog.json'
        warnings={}
        if catalog.game_names.path.is_file():
            with closing(sqlite3.connect(catalog.game_names.path.resolve().as_uri()+'?mode=ro',uri=True)) as db:
                for key,value in db.execute("SELECT key,value FROM metadata WHERE key IN ('unit_errors','extra_errors')"):
                    warnings[key]=json.loads(value)
        check_cancel(cancel)
        atomic_json(target,dict(summary=summary,kinds=LABELS['kind'],files=files,naming_warnings=warnings,
            evidence='실제 명칭은 원본 문자열과 명시적 참조 연결 기준입니다. 스킨명은 모션의 문맥 명칭입니다. 이름 없는 항목은 원본 코드를 유지합니다. 분류·형식 해석은 재생 가능 판정과 별개입니다.'))
    return dict(summary,report=str(target))
