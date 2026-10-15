"""Small semantic fixtures plus read-only copies of two real game images."""
from io import BytesIO
import json
from pathlib import Path
import sqlite3

from closers.catalog import file_hash
from test_composition import png


def composition_fixtures(root):
    from PIL import Image
    dds=BytesIO();Image.new('RGBA',(4096,8),(12,34,56,200)).save(dds,'DDS')
    entries=[('compose-illustration.png',png(4,4),0),
             ('compose-frame.png',png(4,4,lambda x,y:(0,0,255,128) if x in (0,3) or y in (0,3) else (0,0,0,0)),0),
             ('compose-sheet.png',png(4,2,lambda x,y:(0,255,0,255) if x<2 else (255,255,0,255)),0),
             ('compose-full.dds',dds.getvalue(),1),
             ('compose-large.png',png(4096,1024,lambda x,y:(x%256,y%256,(x//256)*16,255)),1)]
    project=Path(__file__).resolve().parents[2]
    database=project/'results/catalog.sqlite3'
    manifest=dict(operating_db_hash_before=file_hash(database),sources=[])
    with sqlite3.connect(database.as_uri()+'?mode=ro',uri=True) as db:
        db.execute('PRAGMA query_only=ON')
        for name in ('DLG_PVP_LOADING_GUST_USER_AEGIS_DIMEN.PNG','DLG_FRAME_226.PNG'):
            candidates=db.execute('''SELECT e.output,a.path,e.ordinal FROM entries e JOIN archives a ON a.id=e.archive_id
                                      WHERE e.name=? AND e.output IS NOT NULL''',(name,)).fetchall()
            chosen=next((row for row in candidates if Path(row[0]).is_file()),None)
            if chosen is None:raise ValueError('실제 이미지 표본을 찾을 수 없습니다: '+name)
            source=Path(chosen[0]);stat=source.stat();digest=file_hash(source);body=source.read_bytes()
            if file_hash(source)!=digest:raise ValueError('실제 이미지 표본이 변경되었습니다.')
            with Image.open(source) as image:width,height=image.size
            entries.append((name,body,1))
            manifest['sources'].append(dict(name=name,output=str(source),archive=chosen[1],ordinal=chosen[2],
                                            width=width,height=height,size=stat.st_size,mtime=stat.st_mtime_ns,sha256=digest))
    manifest['operating_db_hash_after_prepare']=file_hash(database)
    assert manifest['operating_db_hash_before']==manifest['operating_db_hash_after_prepare']
    (root/'real-assets.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    return entries


def verify_real_sources(root):
    import hashlib
    from PIL import Image
    project=Path(__file__).resolve().parents[2]
    manifest=json.loads((root/'real-assets.json').read_text(encoding='utf-8'))
    manifest['operating_db_hash_after']=file_hash(project/'results/catalog.sqlite3')
    assert manifest['operating_db_hash_before']==manifest['operating_db_hash_after']
    for record in manifest['sources']:
        path=Path(record['output']);stat=path.stat()
        assert (stat.st_size,stat.st_mtime_ns)==(record['size'],record['mtime'])
        assert file_hash(path)==record['sha256']
    manifest['verified_unchanged']=True
    checks=json.loads((root/'composition-checks.json').read_text(encoding='utf-8'))
    with Image.open(root/'downloads/closers-composition.png') as image:
        assert image.size==(1024,1024)
        assert hashlib.sha256(image.convert('RGBA').tobytes()).hexdigest()==checks['real_rgba_sha256']
    manifest['download_pixels_verified']=True
    (root/'real-assets.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
