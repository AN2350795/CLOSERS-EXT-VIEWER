"""Integration check against a running Explorer with the supplied sample catalog."""
import hashlib
import json
from pathlib import Path
import re
import urllib.error
import urllib.request

BASE = 'http://127.0.0.1:8765'
html = urllib.request.urlopen(BASE).read().decode()
token = re.search(r'name="explorer-token" content="([^"]+)"', html)[1]


def request(path, *, method='GET', payload=None, headers=None, expected=200):
    req = urllib.request.Request(BASE + path, method=method,
                                 data=json.dumps(payload).encode() if payload is not None else None,
                                 headers={'X-Explorer-Token': token, **(headers or {})})
    try:
        response = urllib.request.urlopen(req)
    except urllib.error.HTTPError as exc:
        assert exc.code == expected, (path, exc.code, exc.read())
        return exc.read()
    assert response.status == expected
    return response.read()


request('/api/stats', headers={'X-Explorer-Token': ''}, expected=403)
request('/api/stats', headers={'Host': 'evil.example'}, expected=403)
request('/api/cancel', method='POST', payload={}, headers={'Origin': 'https://evil.example'}, expected=403)
request('/api/scan', method='POST', payload={'paths': []}, expected=400)
request('/api/extract', method='POST', payload={'output': ''}, expected=400)
request('/api/extract', method='POST', payload={'output': 'unused', 'filters': {'ids': [1]*201}}, expected=400)
entries = json.loads(request('/api/entries?format=wav&limit=200'))
assert entries['total'] == 6
row = entries['items'][0]
content = request('/api/media/' + str(row['id']))
assert content[:4] == b'RIFF' and content[8:12] == b'WAVE'
assert hashlib.sha256(content).hexdigest() == row['sha256']
assert request('/api/media/' + str(row['id']), headers={'Range': 'bytes=2-10'}, expected=206) == content[2:11]
assert request('/api/media/' + str(row['id']), headers={'Range': 'bytes=-12'}, expected=206) == content[-12:]
request('/api/media/' + str(row['id']), headers={'Range': 'bytes=999999999-'}, expected=416)
dds = json.loads(request('/api/entries?format=dds'))['items'][0]
assert request('/api/media/' + str(dds['id'])).startswith(b'\x89PNG\r\n\x1a\n')
assert request('/api/manifest').startswith(b'\xef\xbb\xbf')
print('PASS: HTTP authorization, request validation, filters, WAV signature/hash, byte ranges, DDS conversion, CSV download')
