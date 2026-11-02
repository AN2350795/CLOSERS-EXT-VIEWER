"""Check the viewer import graph through Explorer's actual HTTP routes."""
from pathlib import Path
import re
import tempfile
import threading
import unittest
from urllib.parse import urljoin, urlparse
from urllib.request import urlopen
from urllib.error import HTTPError

from closers.catalog import Catalog
from closers.server import create_server


class ModelModuleRouteTests(unittest.TestCase):
    def test_viewer_imports_are_served_as_javascript(self):
        with tempfile.TemporaryDirectory() as temp:
            server = create_server(Catalog(Path(temp)/'work'), 0)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                base = f'http://127.0.0.1:{server.server_port}'
                with urlopen(base+'/model', timeout=5) as response:
                    html = response.read().decode('utf8')
                pending = re.findall(r'<script\s+type="module"\s+src="([^"]+)"', html)
                self.assertIn('/model.js', pending)
                visited = set()
                while pending:
                    path = pending.pop()
                    if path in visited:
                        continue
                    visited.add(path)
                    try:
                        with urlopen(base+path, timeout=5) as response:
                            self.assertEqual(response.status, 200)
                            self.assertEqual(response.headers.get_content_type(), 'text/javascript', path)
                            body = response.read().decode('utf8')
                    except HTTPError as error:
                        with error:
                            self.fail(f'{path}: HTTP {error.code}')
                    imports = re.findall(r'''(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)['"](\.[^'"]+)['"]''', body)
                    for dependency in imports:
                        target = urlparse(urljoin(base+path, dependency))
                        self.assertEqual(target.netloc, urlparse(base).netloc)
                        pending.append(target.path)
                self.assertIn('/model-occlusion.js', visited)
                self.assertIn('/vendor/three/three.core.min.js', visited)
            finally:
                server.shutdown()
                server.server_close()
                thread.join()
