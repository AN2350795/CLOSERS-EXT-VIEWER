"""Reuse a verified local viewer, or let the OS choose an available port."""
import errno
import hashlib
from http.client import HTTPConnection,HTTPException
import json
import os
from pathlib import Path

from .updates import atomic_json

APPLICATION = 'closers-explorer'


def workspace_key(workspace):
    return hashlib.sha256(os.path.normcase(str(Path(workspace).resolve())).encode('utf-8')).hexdigest()


def record_path(catalog):
    return catalog.workspace / '.viewer-instance.json'


def read_record(catalog):
    try:
        path=record_path(catalog)
        if path.stat().st_size>4096:return {}
        value=json.loads(path.read_text(encoding='utf-8'))
        return value if isinstance(value,dict) else {}
    except (OSError,ValueError):return {}


def probe(port):
    if type(port) is not int or not 1<=port<=65535:return None
    connection=HTTPConnection('127.0.0.1',port,timeout=.75)
    try:
        connection.request('GET','/instance')
        response=connection.getresponse()
        body=response.read(4097)
        if response.status!=200 or len(body)>4096:return None
        value=json.loads(body)
        if (isinstance(value,dict) and value.get('application')==APPLICATION and
                value.get('protocol')==1 and isinstance(value.get('instance_id'),str) and
                isinstance(value.get('workspace_key'),str)):
            return value
    except (OSError,ValueError,HTTPException):pass
    finally:connection.close()
    return None


def start_or_reuse(catalog,port,factory):
    """Return (new server or None, URL). Never stop an existing process."""
    key=workspace_key(catalog.workspace)
    saved=read_record(catalog)
    existing=probe(saved.get('port'))
    if existing and existing['workspace_key']==key and existing['instance_id']==saved.get('instance_id'):
        print('같은 작업 폴더의 실행 중인 화면을 다시 엽니다.',flush=True)
        return None,f"http://127.0.0.1:{saved['port']}"
    try:
        server=factory(catalog,port)
    except OSError as exc:
        if not port or not (exc.errno==errno.EADDRINUSE or getattr(exc,'winerror',None) in (10048,10013)):
            raise
        existing=probe(port)
        if existing and existing['workspace_key']==key:
            print('같은 작업 폴더의 실행 중인 화면을 다시 엽니다.',flush=True)
            return None,f'http://127.0.0.1:{port}'
        if existing:
            print(f'포트 {port}에서 다른 작업 폴더의 탐색기가 실행 중입니다. 빈 포트로 실행합니다.',flush=True)
        else:
            print(f'포트 {port}가 사용 중이며 기존 탐색기를 확인할 수 없습니다. 빈 포트로 실행합니다.\n'
                  '기존 탐색기가 멈췄다면 해당 실행 창에서 Ctrl+C로 종료한 뒤 다시 실행할 수 있습니다.',flush=True)
        server=factory(catalog,0)
    try:
        atomic_json(record_path(catalog),dict(port=server.server_port,instance_id=server.instance_id))
    except OSError as exc:
        print(f'실행 주소 기록을 저장하지 못했습니다: {exc}',flush=True)
    return server,f'http://127.0.0.1:{server.server_port}'


def forget(catalog,server):
    if read_record(catalog).get('instance_id')==server.instance_id:
        try:record_path(catalog).unlink(missing_ok=True)
        except OSError:pass
