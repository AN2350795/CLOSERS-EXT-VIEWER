import tempfile
import unittest
from pathlib import Path

from closers.catalog import Catalog
from closers.server import create_server


class ServerBindingTests(unittest.TestCase):
    def test_duplicate_port_is_rejected_and_released_port_can_restart(self):
        with tempfile.TemporaryDirectory() as temp:
            catalog = Catalog(Path(temp) / 'work')
            first = create_server(catalog, 0)
            port = first.server_port
            duplicate = None
            try:
                with self.assertRaises(OSError):
                    duplicate = create_server(catalog, port)
            finally:
                if duplicate is not None:
                    duplicate.server_close()
                first.server_close()
            restarted = create_server(catalog, port)
            try:
                self.assertEqual(restarted.server_port, port)
            finally:
                restarted.server_close()
