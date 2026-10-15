"""Own temporary server/browser, synthetic inputs, and explicitly new workspace."""
import argparse
import base64
import json
from pathlib import Path
import re
import socket
import subprocess
import sys
import time
import urllib.request

from test_explorer import fixture
from test_preservation import header_fixture
from closers.catalog import Catalog


def port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--destination', required=True)
    parser.add_argument('--browser', action='store_true')
    parser.add_argument('--browser-no-sandbox', action='store_true', help='격리된 합성 데이터 브라우저 시험에서만 Chrome sandbox 비활성화')
    parser.add_argument('--ui-script', choices=('ui_smoke.mjs','local_library_smoke.mjs','stage2_smoke.mjs','composition_smoke.mjs','model_smoke.mjs','reset_smoke.mjs'), default='ui_smoke.mjs')
    args = parser.parse_args()
    root = Path(args.destination).resolve()
    root.mkdir(parents=True, exist_ok=False)
    extra = []
    if args.ui_script in ('local_library_smoke.mjs','stage2_smoke.mjs'):
        extra = [('duplicate.unknown',b'same saved bytes',0),('alias.unknown',b'same saved bytes',1),
                 ('duplicate.unknown',b'different bytes',0),('unsupported-image.dds',b'DDS '+bytes(124),0),
                 ('image.png',base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='),1)]
    elif args.ui_script == 'composition_smoke.mjs':
        from composition_fixtures import composition_fixtures
        extra=composition_fixtures(root)
    elif args.ui_script == 'model_smoke.mjs':
        from model_fixtures import model_fixtures
        extra=model_fixtures(root)
    source = fixture(root/'input.cmf', [(f'ST_QUEST_DUNGEON_100_GUST_{i}.ogg', b'OggS', 0) for i in range(205)]
                     + [('readme.lua', ('한글 대사\n'*3000).encode('utf-16'), 1),
                        ('unsupported.lua', b'plain', 1, b'YWJjZGVm'),
                        ('portrait.TET', b'plain TET', 1, b'VEVUc3RvcmVk')] + extra, 1)
    catalog = Catalog(root/'work')
    catalog.scan([source])
    if args.ui_script == 'stage2_smoke.mjs':
        historical = fixture(root/'history.cmf',[('history.unknown',b'old history bytes',1)])
        catalog.process([historical],root/'assets')
        fixture(historical,[('history.unknown',b'new history bytes with change',1)])
    http_port = port()
    base = f'http://127.0.0.1:{http_port}'
    flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
    log = (root/'server.log').open('w', encoding='utf-8')
    process = subprocess.Popen([sys.executable, 'explorer.py', '--workspace', str(catalog.workspace),
                                'serve', '--port', str(http_port), '--no-browser'],
                               cwd=Path(__file__).resolve().parents[1], stdout=log, stderr=log, creationflags=flags)
    chrome = None
    try:
        deadline = time.monotonic()+20
        while True:
            try:
                html = urllib.request.urlopen(base, timeout=1).read().decode()
                break
            except OSError:
                if time.monotonic()>deadline:
                    raise
                time.sleep(0.1)
        token = re.search(r'name="explorer-token" content="([^"]+)"', html)[1]
        assert 'id="open-preservation"' in html
        def request(path, payload=None):
            req = urllib.request.Request(base+path, data=json.dumps(payload).encode() if payload is not None else None,
                                         headers={'X-Explorer-Token':token,'Content-Type':'application/json'})
            return json.loads(urllib.request.urlopen(req,timeout=15).read())
        groups = request('/api/groups?group_axis=quest_candidate')
        assert groups['items'][0]['count']==205
        text_rows = request('/api/entries?category=scripts')['items']
        text_id = next(r['id'] for r in text_rows if r['name']=='readme.lua')
        bad_id = next(r['id'] for r in text_rows if r['name']=='unsupported.lua')
        tet_id = next(r['id'] for r in text_rows if r['name']=='portrait.TET')
        assert request(f'/api/text/{text_id}')['text'].startswith('한글 대사')
        assert request(f'/api/info/{bad_id}')['preview_error']
        assert request(f'/api/text/{bad_id}')['error']
        request('/api/process', {'paths':[str(source)],'output':str(root/'assets'),
                                 'filters':{'group_axis':'quest_candidate','group_value':groups['items'][0]['value']}})
        deadline=time.monotonic()+20
        while request('/api/state')['job']['running']:
            if time.monotonic()>deadline:
                raise TimeoutError('process')
            time.sleep(0.1)
        job=request('/api/state')['job']
        assert job['result']['done']==205 and job['result']['failed']==0,job
        assert len(list((root/'assets').rglob('*.ogg')))==205
        request('/api/preserve', {'destination':str(root/'stored'), 'filters':{'ids':[bad_id,tet_id]}})
        deadline=time.monotonic()+20
        while request('/api/state')['job']['running']:
            if time.monotonic()>deadline:
                raise TimeoutError('preserve')
            time.sleep(0.1)
        preserved=request('/api/state')['job']
        assert preserved['result']['preserved']==2 and preserved['result']['restored_plaintext']==0,preserved
        assert next((root/'stored').rglob('*.stored.bin')).read_bytes()==b'YWJjZGVm'
        assert next((root/'stored').rglob('*.TET')).read_bytes()==b'VEVUc3RvcmVk'
        header=header_fixture(root/'index-input')
        request('/api/index', {'path':str(header),'destination':str(root/'header-index')})
        deadline=time.monotonic()+20
        while request('/api/state')['job']['running']:
            if time.monotonic()>deadline:
                raise TimeoutError('index')
            time.sleep(0.1)
        indexed=request('/api/state')['job']
        assert indexed['result']['archive_records']==10 and indexed['done']==10,indexed
        if args.ui_script == 'model_smoke.mjs':
            names={entry[0] for entry in extra}
            with catalog.connect() as db:
                ids=[row[0] for row in db.execute('SELECT id,name FROM entries') if row[1] in names]
            extracted=catalog.extract(root/'assets',{'ids':ids})
            assert extracted['failed']==0,extracted
            assert source.resolve().parent==root and source.name=='input.cmf'
            source.unlink() # This is only the newly created synthetic test CMF.
        browser_result = 'not requested'
        if args.browser:
            cdp_port=port()
            browser_flags = ['--no-sandbox'] if args.browser_no_sandbox else []
            chrome=subprocess.Popen([r'C:\Program Files\Google\Chrome\Application\chrome.exe',
                                     '--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
                                     *browser_flags,
                                     f'--remote-debugging-port={cdp_port}',f'--user-data-dir={root / "browser-profile"}',
                                     '--window-size=1512,1100',base],stdout=log,stderr=log,creationflags=flags)
            result=subprocess.run(['node',str(Path(__file__).with_name(args.ui_script)),base,
                                   f'http://127.0.0.1:{cdp_port}',str(root)],capture_output=True,text=True,encoding='utf-8',timeout=90)
            if result.returncode:
                raise RuntimeError(result.stdout+'\n'+result.stderr)
            browser_result=result.stdout.strip()
        if args.ui_script == 'composition_smoke.mjs':
            from composition_fixtures import verify_real_sources
            verify_real_sources(root)
        elif args.ui_script == 'model_smoke.mjs':
            from model_fixtures import verify_models
            verify_models(root)
        (root/'smoke.json').write_text(json.dumps(dict(http='passed',browser=browser_result,job=job,preserved=preserved,indexed=indexed),ensure_ascii=False,indent=2),encoding='utf-8')
        print('PASS: isolated HTTP groups, text, unsupported metadata, integrated group extraction; '+browser_result)
    finally:
        if chrome and chrome.poll() is None:
            chrome.terminate()
            chrome.wait(timeout=15)
        process.terminate()
        process.wait(timeout=15)
        log.close()


if __name__=='__main__':
    main()
