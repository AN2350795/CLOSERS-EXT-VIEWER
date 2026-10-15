"""Loopback-only UI; all archive processing happens outside HTTP/UI threads."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
import os
from pathlib import Path
import secrets
import subprocess
import sys
import threading
import time
from urllib.parse import parse_qs, urlparse, quote
import webbrowser

from .catalog import CATEGORIES
from .cmf import Archive, Cancelled, describe
from .text import decode_preview
from .library import PreservationLinks, saved_file
from .issues import issue

STATIC = Path(__file__).resolve().parent.parent / 'web'
MEDIA_LIMIT = 64 * 1024 * 1024


def open_output_folder(value):
    if not isinstance(value,str) or not value.strip():
        raise ValueError('열 폴더를 입력해 주세요.')
    path = Path(value.strip()).resolve()
    if not path.is_dir():
        raise ValueError('폴더가 없습니다. 먼저 파일을 저장하거나 경로를 확인해 주세요.')
    if os.name != 'nt':
        raise ValueError('폴더 열기는 Windows 탐색기에서 지원합니다.')
    os.startfile(str(path), 'explore')
    return str(path)


def reveal_saved_file(row):
    path = saved_file(row)
    if path is None:
        raise ValueError('저장된 파일이 없습니다. 먼저 추출하거나 저장 경로를 확인하세요.')
    if os.name != 'nt':
        raise ValueError('파일 위치 확인은 Windows 탐색기에서 지원합니다.')
    subprocess.Popen(['explorer.exe', '/select,', str(path.resolve())])
    return str(path)


class Jobs:
    def __init__(self, catalog, preservations=None):
        self.catalog = catalog
        self.preservations = preservations
        self.lock = threading.Lock()
        self.cancel = threading.Event()
        self.state = dict(running=False, phase='idle', done=0, current='폴더를 분석하면 파일 목록이 표시됩니다.')
        self.thread = None

    def snapshot(self):
        with self.lock:
            state = dict(self.state)
        state['elapsed'] = round(time.monotonic() - state['started'], 1) if state.get('running') else state.get('elapsed', 0)
        return state

    def progress(self, **values):
        with self.lock:
            self.state.update(values)

    def start(self, phase, args):
        args = json.loads(json.dumps(args))
        with self.lock:
            if self.state['running']:
                raise ValueError('진행 중인 작업을 완료하거나 중단해 주세요.')
            self.cancel.clear()
            self.state = dict(running=True, phase=phase, done=0, failed=0, skipped=0, written=0,
                              current='작업 준비 중', started=time.monotonic(),
                              operation=phase,scope=dict(phase=phase,**args))
        def run():
            status = 'completed'
            message = '작업 완료'
            try:
                if phase == 'scan':
                    result = self.catalog.scan(args['paths'], self.cancel, self.progress, bool(args.get('retry_errors')))
                elif phase == 'process':
                    result = self.catalog.process(args['paths'], args['output'], args.get('filters', {}),
                                                  bool(args.get('raw')), self.cancel, self.progress,
                                                  args.get('verify', 'sha256'), bool(args.get('retry_errors')),int(args.get('workers',1)))
                elif phase == 'preserve':
                    result = self.catalog.preserve(args['destination'],args.get('filters',{}),self.cancel,self.progress)
                elif phase == 'index':
                    from .header_index import export_index
                    result = export_index(args['path'],args['destination'],self.cancel,self.progress)
                elif phase == 'compare':
                    from .updates import compare
                    from .catalog import operation_lock
                    with operation_lock(self.catalog.workspace):
                        result = compare(self.catalog,args['paths'],self.cancel,self.progress)
                else:
                    result = self.catalog.extract(args['output'], args.get('filters', {}),
                                                  bool(args.get('raw')), self.cancel, self.progress, args.get('verify', 'sha256'),
                                                  retry_errors=bool(args.get('retry_errors')))
                status = 'issues' if result.get('failed') or result.get('entry_errors') else 'completed'
                archive_failed = result.get('archive_failed',result.get('failed',0) if phase=='scan' else 0)
                entry_failed = result.get('entry_failed',result.get('failed',0) if phase in ('extract','preserve') else 0)
                message = f"처리 종료 · 아카이브 실패 {archive_failed}개 · 항목 실패 {entry_failed}개 · 스킵 {result.get('skipped',0)}개 · 인덱스 {result.get('indexes',0)}개"
                if result.get('entry_errors'):
                    message += f" · 분석 시 본문 판별 오류 {result['entry_errors']}개"
                if result.get('encrypted'):
                    message += f" · 암호화 건너뜀 {result['encrypted']}개"
                if result.get('cached_failures'):
                    message += f" · 이전 복원 실패 재사용 {result['cached_failures']}개 (다시 시도하지 않음)"
                if 'outside_scope' in result:
                    message += f" · 선택 범위 밖 {result['outside_scope']}개 (실패 아님)"
                if phase=='preserve':
                    message = f"저장 바이트 보존 {result['preserved']}개 · 스킵 {result['skipped']}개 · 실패 {result['failed']}개 · 원문 복원 아님 · {args['destination']}"
                elif phase=='index':
                    message = f"인덱스 내보내기 완료 · 아카이브 {result['archive_records']}개 · 항목 목록 {result['entry_descriptors']}개 · 본문 없음"
                elif phase=='compare':
                    counts = result['counts']
                    message = f"원본 변경 비교 · 추가 {counts['added']} · 변경 {counts['changed']} · 사라짐 {counts['missing']} · 동일 {counts['unchanged']} · 저장 파일 유지"
                self.progress(result=result)
            except Cancelled:
                status, message = 'cancelled', '중단됨 · 완료된 파일은 보존됩니다. 같은 작업을 실행하면 검증 후 건너뜁니다.'
                if phase == 'index':
                    message = '인덱스 내보내기 중단됨 · 미완료 DB는 .partial로 남습니다. 새 폴더를 지정해 다시 실행해 주세요.'
            except Exception as exc:
                status, message = 'error', str(exc)
            finally:
                if phase == 'preserve' and self.preservations and (Path(args['destination'])/'preservation.sqlite3').is_file():
                    try:
                        self.preservations.register(args['destination'])
                    except Exception as exc:
                        message += f' / 보존 결과 연결 안내: {exc}'
                self.progress(running=False, status=status, current=message,
                              elapsed=round(time.monotonic() - self.state['started'], 1))
        self.thread = threading.Thread(target=run, name='cmf-worker', daemon=False)
        self.thread.start()


class Media:
    def __init__(self, catalog):
        self.catalog = catalog
        self.directory = catalog.workspace / 'preview-cache'
        self.directory.mkdir(exist_ok=True)
        self.lock = threading.Lock()
        self.gate = threading.BoundedSemaphore(2)

    @staticmethod
    def output_file(row):
        if row.get('output') and row['status'] == 'extracted':
            path = Path(row['output'])
            if path.is_file() and path.stat().st_size == row['size']:
                return path
        return None

    def read(self, row, limit):
        if row['flag'] == 2:
            raise ValueError('암호화 데이터는 미리볼 수 없습니다.')
        output = self.output_file(row)
        if output:
            with output.open('rb') as stream:
                return stream.read(limit)
        self.catalog.verify_source(row)
        with Archive(row['archive']) as archive:
            result = bytearray()
            for block in archive.chunks(self.catalog.entry(row)):
                result.extend(block[:limit - len(result)])
                if len(result) >= limit:
                    break
        return bytes(result)

    def text(self, row, limit=4096, encoding='auto'):
        limit = min(1024 * 1024, max(256, int(limit)))
        try:
            data = self.read(row, limit)
            result = decode_preview(data, final=len(data) >= row['size'], encoding=encoding)
        except Exception as exc:
            result = dict(text='', encoding=None, consumed=0, error=f'본문 읽기 실패: {exc}')
        result.update(limit=limit, truncated=row['size'] > limit, full_size=row['size'],
                      scope='불러온 본문 내 검색. 전체 스크립트 검색·복호화는 지원하지 않습니다.')
        return result

    def file(self, row):
        if row['flag'] == 2 or row['size'] > MEDIA_LIMIT:
            raise ValueError('미리보기는 암호화되지 않은 64 MiB 이하 파일을 지원합니다. 추출 후 외부 프로그램으로 확인해 주세요.')
        if row['format'] not in ('png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'dds', 'tga', 'ogg', 'wav', 'mp3', 'flac'):
            raise ValueError('이 형식은 정보·바이너리 미리보기를 이용해 주세요.')
        identity = f"{row['id']}-{row['archive_mtime']}-{row['archive_size']}"
        convert = row['format'] in ('dds', 'tga')
        ext = 'png' if convert else row['format']
        output = self.output_file(row)
        if output:
            if not convert:
                return output.open('rb'), output.stat().st_size, mimetypes.guess_type(output.name)[0] or 'application/octet-stream'
            identity += f'-output-{output.stat().st_mtime_ns}'
        else:
            self.catalog.verify_source(row)
        target = self.directory / f'{identity}.{ext}'
        with self.lock:
            if not target.exists():
                temp = target.with_suffix('.partial')
                try:
                    if output:
                        with output.open('rb') as source, temp.open('wb') as dest:
                            while block := source.read(128 * 1024):
                                dest.write(block)
                    else:
                        with Archive(row['archive']) as archive, temp.open('wb') as dest:
                            for block in archive.chunks(self.catalog.entry(row)):
                                dest.write(block)
                    if convert:
                        try:
                            from PIL import Image
                        except ImportError:
                            raise ValueError('DDS/TGA 미리보기는 선택 기능 Pillow가 필요합니다. 추출은 설치 없이 가능합니다.')
                        with Image.open(temp) as source:
                            if source.width * source.height > 32_000_000:
                                raise ValueError('이미지가 너무 큽니다. 추출 후 확인해 주세요.')
                            source.thumbnail((2048, 2048))
                            source.convert('RGBA').save(target, 'PNG')
                    else:
                        temp.rename(target)
                finally:
                    temp.unlink(missing_ok=True)
            target.touch()
            # Limit persistent preview data. The original extracted assets are separate.
            files = sorted(self.directory.glob('*'), key=lambda p: p.stat().st_mtime)
            size = sum(p.stat().st_size for p in files)
            for path in files:
                if size <= 256 * 1024 * 1024:
                    break
                if path != target:
                    try:
                        length = path.stat().st_size
                        path.unlink()
                        size -= length
                    except OSError:
                        pass
            return target.open('rb'), target.stat().st_size, mimetypes.guess_type(target.name)[0] or 'application/octet-stream'


def create_server(catalog, port=0):
    preservations = PreservationLinks(catalog.workspace)
    jobs = Jobs(catalog, preservations)
    media = Media(catalog)
    from .composition import CompositionImages,resolve_sources
    composition = CompositionImages(catalog)
    from .model_library import Models
    models = Models(catalog)
    token = secrets.token_urlsafe(32)
    folder_gate = threading.Lock()
    from .reset import Reset, RequestGate
    reset = Reset(catalog, preservations)
    request_gate = RequestGate()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def authorized(self, api=False):
            expected = f'127.0.0.1:{self.server.server_port}'
            if self.headers.get('Host') != expected:
                raise PermissionError('허용되지 않은 Host입니다.')
            origin = self.headers.get('Origin')
            if origin and origin != 'http://' + expected:
                raise PermissionError('허용되지 않은 Origin입니다.')
            if api:
                query = parse_qs(urlparse(self.path).query)
                supplied = self.headers.get('X-Explorer-Token') or query.get('token', [''])[0]
                if not secrets.compare_digest(supplied, token):
                    raise PermissionError('인증 토큰이 올바르지 않습니다. 화면을 새로고침해 주세요.')

        def respond(self, body, mime='application/json; charset=utf-8', status=200):
            if not isinstance(body, bytes):
                body = json.dumps(body, ensure_ascii=False).encode('utf-8')
            self.send_response(status)
            self.send_header('Content-Type', mime)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Referrer-Policy', 'no-referrer')
            self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; media-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            try:
                if urlparse(self.path).path == '/api/state':
                    self.get_request()
                else:
                    with request_gate.read():
                        self.get_request()
            except ValueError as exc:
                self.respond({'error': str(exc)}, status=409)

        def get_request(self):
            try:
                url = urlparse(self.path)
                self.authorized(url.path.startswith('/api/'))
                query = {k: v[0] for k, v in parse_qs(url.query).items()}
                if url.path == '/':
                    self.respond((STATIC / 'index.html').read_bytes().replace(b'__TOKEN__', token.encode()), 'text/html; charset=utf-8')
                elif url.path == '/compose':
                    self.respond((STATIC / 'compose.html').read_bytes().replace(b'__TOKEN__',token.encode()),'text/html; charset=utf-8')
                elif url.path == '/model':
                    self.respond((STATIC / 'model.html').read_bytes().replace(b'__TOKEN__',token.encode()),'text/html; charset=utf-8')
                elif url.path in ('/app.js', '/library.js', '/updates.js', '/management.js', '/style.css','/compose.js','/composition-core.js','/compose.css','/model.js','/model-core.js','/face-preview.js','/model-picker.js','/model.css','/vendor/three/three.module.min.js','/vendor/three/three.core.min.js'):
                    self.respond((STATIC / url.path[1:]).read_bytes(), 'text/javascript; charset=utf-8' if url.path.endswith('.js') else 'text/css; charset=utf-8')
                elif url.path == '/api/model-scene':
                    ids = [int(v) for v in query.get('entries','').split(',') if v]
                    self.respond(models.scene(ids,int(query['skeleton']) if query.get('skeleton') else None))
                elif url.path == '/api/model-facets':
                    self.respond(models.groups.facets(query))
                elif url.path == '/api/model-browser':
                    self.respond(models.groups.browse(query))
                elif url.path == '/api/model-list':
                    self.respond(models.groups.entries(query))
                elif url.path == '/api/model-sets':
                    self.respond(models.groups.sets(query))
                elif url.path == '/api/model-bundle':
                    self.respond(models.groups.bundle(query.get('key',''),query.get('saved','existing')))
                elif url.path == '/api/model-animations':
                    self.respond(models.animations(int(query['skeleton']),int(query['animation'])))
                elif url.path == '/api/model-clip':
                    self.respond(models.clip(int(query['skeleton']),int(query['animation']),int(query['clip']),query.get('sha256')))
                elif url.path == '/api/state':
                    self.respond(dict(job=jobs.snapshot(), workspace=str(catalog.workspace), default_input=str(STATIC.parent.parent / 'data'),
                                      default_output=str(catalog.workspace / 'assets'), categories=CATEGORIES))
                elif url.path == '/api/stats':
                    self.respond(catalog.stats())
                elif url.path == '/api/reset-preview':
                    if jobs.snapshot()['running']:
                        raise ValueError('진행 중인 작업을 완료하거나 중단한 뒤 초기화해 주세요.')
                    if query.get('preserved', '0') not in ('0', '1'):
                        raise ValueError('보존 데이터 삭제 옵션이 올바르지 않습니다.')
                    self.respond(reset.preview(query.get('preserved') == '1'))
                elif url.path.startswith('/api/composition-source/'):
                    path,metadata = composition.prepare(int(url.path.rsplit('/',1)[1]))
                    self.respond(metadata)
                elif url.path.startswith('/api/composition-image/'):
                    path,metadata = composition.prepare(int(url.path.rsplit('/',1)[1]))
                    if query.get('sha256') != metadata['image_sha256']:
                        raise ValueError('합성 입력 내용이 변경되었습니다. 이미지를 다시 선택해 주세요.')
                    with path.open('rb') as stream:
                        self.send_response(200)
                        self.send_header('Content-Type',mimetypes.guess_type(path.name)[0] or 'application/octet-stream')
                        self.send_header('Content-Length',str(os.fstat(stream.fileno()).st_size))
                        self.send_header('Cache-Control','no-store')
                        self.send_header('X-Content-Type-Options','nosniff')
                        self.end_headers()
                        while block := stream.read(128*1024):
                            self.wfile.write(block)
                elif url.path == '/api/preservation-sources':
                    self.respond({'sources': sorted(str(p.parent) for p in preservations.sources)})
                elif url.path == '/api/entries':
                    self.respond(catalog.entries(query))
                elif url.path == '/api/groups':
                    self.respond(catalog.groups(query))
                elif url.path.startswith('/api/info/'):
                    row = catalog.get(int(url.path.rsplit('/', 1)[1]))
                    row['preservations'] = preservations.matches(row)
                    row['preview_error'] = None
                    with media.gate:
                        try:
                            prefix = media.read(row, 4096) if row['flag'] != 2 else b''
                        except Exception as exc:
                            prefix = b''
                            row['preview_error'] = str(exc)
                    row['hex'] = '\n'.join(f'{i:06X}  ' + ' '.join(f'{b:02X}' for b in prefix[i:i+16]) + '  ' + ''.join(chr(b) if 32 <= b < 127 else '.' for b in prefix[i:i+16]) for i in range(0, min(len(prefix), 512), 16))
                    row['text'] = ''
                    row['metadata'] = describe(prefix)
                    row['metadata']['미리보기 출처'] = '추출 결과 파일' if media.output_file(row) else '원본 CMF'
                    if row['category'] == 'scripts' or (row['format'] == 'x' and prefix[8:12] == b'txt '):
                        decoded = decode_preview(prefix, final=len(prefix) >= row['size'])
                        row['text'] = decoded['text']
                        row['text_encoding'] = decoded['encoding']
                        row['preview_error'] = row['preview_error'] or decoded['error']
                    row['preview_issue'] = issue(row['preview_error'], 'preview')
                    self.respond(row)
                elif url.path.startswith('/api/download/'):
                    row = catalog.get(int(url.path.rsplit('/', 1)[1]))
                    kind = query.get('kind', 'original')
                    if kind == 'original':
                        if row['flag'] == 2:
                            raise ValueError('암호화 저장 바이트는 원본 형식 파일이 아닙니다. 저장 바이트 보존을 사용하세요.')
                        path = saved_file(row)
                        filename = Path(row['name'].replace('\\', '/')).name
                    elif kind == 'stored':
                        match = next((r for r in preservations.matches(row) if r['current'] and r['exists']
                                      and (not query.get('catalog') or r['catalog'] == query['catalog'])), None)
                        path = saved_file(match) if match else None
                        filename = path.name if path else ''
                    else:
                        raise ValueError('다운로드 종류가 올바르지 않습니다.')
                    if path is None:
                        raise ValueError('저장된 파일이 없습니다. 먼저 추출·보존하거나 저장 경로를 확인하세요.')
                    # Download the saved bytes directly; never use the preview conversion/cache.
                    with path.open('rb') as stream:
                        self.send_response(200)
                        self.send_header('Content-Type', 'application/octet-stream')
                        self.send_header('Content-Disposition', "attachment; filename=\"resource.bin\"; filename*=UTF-8''" + quote(filename, safe=''))
                        self.send_header('Content-Length', str(os.fstat(stream.fileno()).st_size))
                        self.send_header('X-Content-Type-Options', 'nosniff')
                        self.send_header('Cache-Control', 'no-store')
                        self.send_header('Referrer-Policy', 'no-referrer')
                        self.end_headers()
                        while block := stream.read(128 * 1024):
                            self.wfile.write(block)
                elif url.path.startswith('/api/text/'):
                    row = catalog.get(int(url.path.rsplit('/', 1)[1]))
                    with media.gate:
                        self.respond(media.text(row, query.get('limit', 4096), query.get('encoding', 'auto')))
                elif url.path.startswith('/api/media/'):
                    row = catalog.get(int(url.path.rsplit('/', 1)[1]))
                    with media.gate:
                        stream, length, mime = media.file(row)
                        with stream:
                            start, end = 0, length - 1
                            value = self.headers.get('Range')
                            if value:
                                import re
                                match = re.fullmatch(r'bytes=(\d*)-(\d*)', value)
                                if not match or not any(match.groups()):
                                    raise ValueError('지원하지 않는 바이트 범위입니다.')
                                if match[1]:
                                    start = int(match[1])
                                    end = min(end, int(match[2])) if match[2] else end
                                else:
                                    start = max(0, length - int(match[2]))
                                if start > end or start >= length:
                                    self.send_response(416)
                                    self.send_header('Content-Range', f'bytes */{length}')
                                    self.send_header('Content-Length', '0')
                                    self.end_headers()
                                    return
                            self.send_response(206 if value else 200)
                            self.send_header('Content-Type', mime)
                            self.send_header('Content-Length', str(end - start + 1))
                            self.send_header('Accept-Ranges', 'bytes')
                            self.send_header('X-Content-Type-Options', 'nosniff')
                            self.send_header('Cache-Control', 'private, max-age=60')
                            if value:
                                self.send_header('Content-Range', f'bytes {start}-{end}/{length}')
                            self.end_headers()
                            stream.seek(start)
                            remaining = end - start + 1
                            while remaining:
                                block = stream.read(min(128 * 1024, remaining))
                                if not block:
                                    break
                                self.wfile.write(block)
                                remaining -= len(block)
                elif url.path == '/api/manifest':
                    from .reports import ensure_report
                    path = ensure_report(catalog)
                    with path.open('rb') as stream:
                        self.send_response(200)
                        self.send_header('Content-Type', 'text/csv; charset=utf-8')
                        self.send_header('Content-Disposition', 'attachment; filename="catalog.csv"')
                        self.send_header('Content-Length', str(os.fstat(stream.fileno()).st_size))
                        self.end_headers()
                        while block := stream.read(128 * 1024):
                            self.wfile.write(block)
                elif url.path == '/api/history':
                    from .updates import history
                    self.respond(history(catalog,int(query['archive_id']),int(query.get('page','1'))))
                elif url.path == '/api/update-comparison':
                    path = catalog.workspace / 'update-comparison.json'
                    self.respond(json.loads(path.read_text(encoding='utf-8')) if path.is_file() else {})
                elif url.path.startswith('/api/history-download/'):
                    from .updates import history_file
                    path,name = history_file(catalog,int(url.path.rsplit('/',1)[1]))
                    with path.open('rb') as stream:
                        self.send_response(200)
                        self.send_header('Content-Type','application/octet-stream')
                        self.send_header('Content-Disposition',"attachment; filename*=UTF-8''"+quote(name.replace('\\','/').rsplit('/',1)[-1],safe=''))
                        self.send_header('Content-Length',str(os.fstat(stream.fileno()).st_size))
                        self.end_headers()
                        while block := stream.read(128*1024):
                            self.wfile.write(block)
                else:
                    self.respond({'error': '경로가 없습니다.'}, status=404)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                pass
            except PermissionError as exc:
                self.respond({'error': str(exc)}, status=403)
            except Exception as exc:
                self.respond({'error': str(exc)}, status=400)

        def do_POST(self):
            try:
                with request_gate.write() if self.path == '/api/reset' else request_gate.read():
                    self.post_request()
            except ValueError as exc:
                self.respond({'error': str(exc)}, status=409)

        def post_request(self):
            nonlocal token
            try:
                self.authorized(True)
                length = int(self.headers.get('Content-Length', 0))
                if length <= 0 or length > 64 * 1024:
                    raise ValueError('잘못된 요청 크기입니다.')
                args = json.loads(self.rfile.read(length))
                if self.path == '/api/reset':
                    with jobs.lock:
                        if jobs.state['running']:
                            raise ValueError('진행 중인 작업을 완료하거나 중단한 뒤 초기화해 주세요.')
                        jobs.state = dict(running=True, phase='reset', operation='reset', done=0,
                                          started=time.monotonic(), current='전체 초기화 중…')
                    try:
                        result = reset.execute(args.get('plan_id'), args.get('confirmation'), jobs.progress)
                    except Exception as exc:
                        jobs.progress(running=False, status='error', current='초기화 중단: '+str(exc),
                                      elapsed=round(time.monotonic()-jobs.state['started'], 1))
                        raise
                    jobs.progress(running=False, status='completed', result=result,
                                  current='전체 초기화 완료 · 원본 폴더를 선택하고 다시 분석하세요.',
                                  elapsed=round(time.monotonic()-jobs.state['started'], 1))
                    # Expire other tabs' resource IDs before new rows reuse those IDs.
                    token = secrets.token_urlsafe(32)
                    self.respond({'ok': True, **result})
                elif self.path in ('/api/scan', '/api/process'):
                    if not isinstance(args.get('paths'), list) or not args['paths'] or not all(isinstance(p, str) and p.strip() for p in args['paths']):
                        raise ValueError('CMF 폴더 또는 파일 경로를 입력해 주세요.')
                    if self.path == '/api/process' and (not isinstance(args.get('output'), str) or not args['output'].strip()):
                        raise ValueError('출력 폴더를 입력해 주세요.')
                    catalog.where(args.get('filters', {}))
                    jobs.start('process' if self.path == '/api/process' else 'scan', args)
                    self.respond({'ok': True})
                elif self.path == '/api/compare':
                    if not isinstance(args.get('paths'),list) or not args['paths'] or not all(isinstance(p,str) and p.strip() for p in args['paths']):
                        raise ValueError('비교할 원본 위치를 입력해 주세요.')
                    jobs.start('compare',args)
                    self.respond({'ok':True})
                elif self.path == '/api/extract':
                    if not isinstance(args.get('output'), str) or not args['output'].strip():
                        raise ValueError('출력 폴더를 입력해 주세요.')
                    catalog.where(args.get('filters', {}))
                    jobs.start('extract', args)
                    self.respond({'ok': True})
                elif self.path == '/api/composition-resolve':
                    self.respond({'ids':resolve_sources(catalog,args.get('sources'))})
                elif self.path in ('/api/preserve','/api/index'):
                    if not isinstance(args.get('destination'),str) or not args['destination'].strip():
                        raise ValueError('별도 보존 폴더를 입력해 주세요.')
                    if self.path == '/api/preserve':
                        catalog.where(args.get('filters',{}))
                        jobs.start('preserve',args)
                    else:
                        if not isinstance(args.get('path'),str) or not args['path'].strip():
                            raise ValueError('HEADER.CMF 경로를 입력해 주세요.')
                        jobs.start('index',args)
                    self.respond({'ok':True})
                elif self.path == '/api/cancel':
                    jobs.cancel.set()
                    self.respond({'ok': True})
                elif self.path == '/api/group-note':
                    catalog.save_group(args['axis'], args['value'], args['label'], args.get('tags',''))
                    self.respond({'ok': True})
                elif self.path == '/api/open-folder':
                    self.respond({'path':open_output_folder(args.get('path'))})
                elif self.path == '/api/reveal-file':
                    self.respond({'path':reveal_saved_file(catalog.get(int(args['id'])))})
                elif self.path == '/api/register-preservation':
                    self.respond({'path':preservations.register(args['path'])})
                elif self.path == '/api/folder':
                    if not folder_gate.acquire(blocking=False):
                        raise ValueError('이미 폴더 선택창이 열려 있습니다.')
                    try:
                        script = "import tkinter as t; from tkinter import filedialog; r=t.Tk(); r.withdraw(); r.attributes('-topmost',True); p=filedialog.askdirectory(); print(p); r.destroy()"
                        env = dict(os.environ, PYTHONIOENCODING='utf-8')
                        result = subprocess.run([sys.executable, '-c', script], capture_output=True, text=True, encoding='utf-8',
                                                env=env, timeout=180, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                        if result.returncode:
                            raise ValueError('폴더 선택창을 열지 못했습니다. 경로를 직접 입력해 주세요.')
                        self.respond({'path': result.stdout.strip()})
                    finally:
                        folder_gate.release()
                else:
                    self.respond({'error': '경로가 없습니다.'}, status=404)
            except PermissionError as exc:
                self.respond({'error': str(exc)}, status=403)
            except Exception as exc:
                self.respond({'error': str(exc)}, status=400)

    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    server.jobs = jobs
    return server


def serve(catalog, port=8765, open_browser=True):
    server = create_server(catalog, port)
    jobs = server.jobs
    url = f'http://127.0.0.1:{server.server_port}'
    print(f'CLOSERS Explorer: {url}\n작업 폴더: {catalog.workspace}\n종료: Ctrl+C', flush=True)
    if open_browser:
        webbrowser.open(url)
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        pass
    finally:
        jobs.cancel.set()
        if jobs.thread:
            jobs.thread.join()
        server.server_close()
