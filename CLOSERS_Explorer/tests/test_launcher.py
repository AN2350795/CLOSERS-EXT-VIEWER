from contextlib import redirect_stdout
import io
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
import json
from pathlib import Path
import socket
import tempfile
import threading
import unittest
from unittest.mock import patch

from closers.catalog import Catalog
from closers.launcher import forget,probe,record_path,start_or_reuse
from closers.server import create_server,serve


class LauncherTests(unittest.TestCase):
    def setUp(self):
        temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup)
        self.catalog=Catalog(Path(temp.name)/'one')
        self.other=Catalog(Path(temp.name)/'two')

    def running(self,catalog,port=0):
        server,url=start_or_reuse(catalog,port,create_server)
        self.assertIsNotNone(server)
        thread=threading.Thread(target=server.serve_forever,kwargs={'poll_interval':.01},daemon=True)
        thread.start()
        def close():
            server.shutdown();thread.join();server.server_close();forget(catalog,server)
        self.addCleanup(close)
        return server,url

    def test_same_workspace_reuses_server_and_preserves_jobs(self):
        server,url=self.running(self.catalog)
        identity=probe(server.server_port)
        self.assertNotIn('workspace',identity);self.assertNotIn('token',identity)
        with patch('closers.server.create_server') as factory,patch('closers.server.webbrowser.open',return_value=True) as browser:
            serve(self.catalog,server.server_port)
            factory.assert_not_called();browser.assert_called_once_with(url)
        self.assertFalse(server.jobs.cancel.is_set())
        self.assertIsNotNone(probe(server.server_port))

    def test_other_workspace_uses_free_port_and_reuses_recorded_port(self):
        first,_=self.running(self.catalog)
        second,url=self.running(self.other,first.server_port)
        self.assertNotEqual(first.server_port,second.server_port)
        with patch('closers.server.create_server') as factory:
            reused,reused_url=start_or_reuse(self.other,first.server_port,factory)
        self.assertIsNone(reused);self.assertEqual(reused_url,url);factory.assert_not_called()

    def test_missing_and_wrong_instance_record_do_not_reuse_an_unrelated_server(self):
        first,_=self.running(self.catalog)
        # Lost record can still discover a matching viewer on the requested port.
        record_path(self.catalog).unlink()
        reused,url=start_or_reuse(self.catalog,first.server_port,create_server)
        self.assertIsNone(reused);self.assertTrue(url.endswith(str(first.server_port)))
        record_path(self.other).write_text(json.dumps(dict(port=first.server_port,instance_id=first.instance_id)),encoding='utf-8')
        other,_=self.running(self.other)
        self.assertNotEqual(other.server_port,first.server_port)
        # Cleanup of an older process cannot remove a newer instance record.
        forget(self.other,first)
        self.assertTrue(record_path(self.other).exists())

    def test_unresponsive_port_falls_back_without_stopping_listener(self):
        listener=socket.socket();listener.bind(('127.0.0.1',0));listener.listen()
        self.addCleanup(listener.close)
        port=listener.getsockname()[1]
        output=io.StringIO()
        with redirect_stdout(output):server,_=self.running(self.catalog,port)
        self.assertNotEqual(server.server_port,port)
        self.assertIn('Ctrl+C',output.getvalue())
        self.assertEqual(listener.getsockname()[1],port)

    def test_stale_record_is_ignored_and_no_browser_flag_is_respected(self):
        record_path(self.catalog).write_text('{invalid',encoding='utf-8')
        server,_=self.running(self.catalog)
        with patch('closers.server.webbrowser.open') as browser:
            serve(self.catalog,server.server_port,False)
            browser.assert_not_called()

    def test_probe_rejects_non_http_service_and_invalid_ports(self):
        with patch('closers.launcher.HTTPConnection') as connection:
            from http.client import BadStatusLine
            connection.return_value.getresponse.side_effect=BadStatusLine('not HTTP')
            self.assertIsNone(probe(8765))
        for value in ('8765',True,0,-1,65536):self.assertIsNone(probe(value))

    def test_other_http_application_is_not_reused(self):
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def do_GET(self):
                body=b'{"application":"other"}'
                self.send_response(200);self.send_header('Content-Length',str(len(body)))
                self.end_headers();self.wfile.write(body)
        foreign=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        thread=threading.Thread(target=foreign.serve_forever,kwargs={'poll_interval':.01},daemon=True);thread.start()
        def close():foreign.shutdown();thread.join();foreign.server_close()
        self.addCleanup(close)
        server,_=self.running(self.catalog,foreign.server_port)
        self.assertNotEqual(server.server_port,foreign.server_port)

    def test_instance_endpoint_still_checks_host_and_origin(self):
        from http.client import HTTPConnection
        server,_=self.running(self.catalog)
        for headers in ({'Host':'evil.example'},{'Origin':'https://evil.example'}):
            connection=HTTPConnection('127.0.0.1',server.server_port,timeout=2)
            try:
                connection.request('GET','/instance',headers=headers)
                response=connection.getresponse();self.assertEqual(response.status,403);response.read()
            finally:connection.close()

    def test_browser_failure_keeps_server_available_and_cleans_record_on_exit(self):
        server=create_server(self.catalog,0)
        output=io.StringIO()
        with patch('closers.server.create_server',return_value=server),patch.object(server,'serve_forever',side_effect=KeyboardInterrupt) as run,\
             patch('closers.server.webbrowser.open',return_value=False),redirect_stdout(output):
            serve(self.catalog,0)
        run.assert_called_once()
        self.assertIn('직접 열어',output.getvalue())
        self.assertFalse(record_path(self.catalog).exists())

    def test_non_binding_error_is_not_hidden(self):
        with patch('closers.launcher.probe',return_value=None):
            with self.assertRaises(PermissionError):
                start_or_reuse(self.catalog,8765,lambda *args:(_ for _ in ()).throw(PermissionError('blocked')))

