"""A names-only postprocess update must invalidate exported names too."""
from contextlib import closing
from pathlib import Path
import sqlite3
import tempfile
import unittest

from closers.catalog import Catalog
from closers.reports import ensure_report
from test_explorer import fixture
from test_model import binary_model


class NamedReportTests(unittest.TestCase):
    def test_csv_refreshes_when_only_actual_names_index_changes(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);catalog=Catalog(root/'work')
            catalog.scan([fixture(root/'one.cmf',[('RIG.X',binary_model(),0)])])
            with closing(sqlite3.connect(catalog.game_names.path)) as db,db:
                db.executescript('''PRAGMA user_version=1; CREATE TABLE metadata(key TEXT,value TEXT);
                    CREATE TABLE names(filename TEXT,label TEXT,priority INTEGER);
                    INSERT INTO names VALUES('RIG.X','이전 이름',1);''')
            path=ensure_report(catalog)
            revision=catalog.revision()
            self.assertIn('이전 이름',path.read_text(encoding='utf-8-sig'))
            with closing(sqlite3.connect(catalog.game_names.path)) as db,db:
                db.execute("UPDATE names SET label='실제 새 이름'")
            self.assertEqual(catalog.revision(),revision)
            path=ensure_report(catalog)
            self.assertIn('실제 새 이름',path.read_text(encoding='utf-8-sig'))
