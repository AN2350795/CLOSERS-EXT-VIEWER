"""Generate full reports only when requested, with durable revision stamps."""
import json
from .catalog import operation_lock
from .updates import atomic_json


def ensure_report(catalog, kind='csv', force=False):
    if kind not in ('csv','summary'):
        raise ValueError('보고서 형식이 올바르지 않습니다.')
    with operation_lock(catalog.workspace), catalog.session():
        revision = catalog.revision()
        path = catalog.workspace / ('catalog.csv' if kind == 'csv' else 'summary.json')
        marker = catalog.workspace / (path.name + '.revision.json')
        try:
            prior = json.loads(marker.read_text(encoding='utf-8'))
            stat = path.stat()
            valid = prior == dict(revision=revision,size=stat.st_size,mtime=stat.st_mtime_ns)
        except (OSError,ValueError):
            valid = False
        if force or not valid:
            if kind == 'csv':
                catalog.export_manifest(path)
            else:
                atomic_json(path,catalog.stats())
            stat = path.stat()
            atomic_json(marker,dict(revision=revision,size=stat.st_size,mtime=stat.st_mtime_ns))
        return path
