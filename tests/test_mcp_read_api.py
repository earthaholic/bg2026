"""MCP SQL 검증은 독립 앱 및 임시 DB만 사용한다."""
import csv
from contextlib import closing
import io
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

import auth
import mcp_read_api as api


class McpReadApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.db = str(Path(self.temp.name) / '조회 # 전용.db')
        with closing(sqlite3.connect(self.db)) as conn:
            conn.executescript('''
                CREATE TABLE Books(Id INTEGER PRIMARY KEY, Title TEXT);
                INSERT INTO Books VALUES(1, '검증 도서'), (2, '=1+1');
                CREATE TABLE _app_users(secret TEXT);
                INSERT INTO _app_users VALUES('내부 비밀');
                CREATE VIEW leaked AS SELECT * FROM _app_users;
            ''')
        self.path_patch = patch.object(api.settings, 'SQLITE_DB_PATH', self.db)
        self.path_patch.start()
        self.addCleanup(self.path_patch.stop)
        self.app = FastAPI()
        self.app.include_router(api.router)
        self.client = TestClient(self.app, raise_server_exceptions=False)
        self.addCleanup(self.client.close)
        self.actor('admin')

    def actor(self, role):
        self.app.dependency_overrides[auth.get_current_user] = lambda: {'username': '검증', 'role': role}

    def post(self, sql, endpoint='query', **extra):
        return self.client.post('/api/admin/mcp/sql/' + endpoint, json={'sql': sql, **extra})

    def test_authentication_and_admin_authorization_on_both_routes(self):
        for endpoint in ('query', 'export-csv'):
            self.app.dependency_overrides.clear()
            self.assertEqual(self.post('SELECT 1', endpoint).status_code, 401)
            for role in ('teacher', 'manager', 'user', ''):
                self.actor(role)
                self.assertEqual(self.post('SELECT 1', endpoint).status_code, 403)
            for role in ('admin', 'subadmin'):
                self.actor(role)
                self.assertEqual(self.post('SELECT 1', endpoint).status_code, 200)

    def test_select_cte_and_bound_parameters(self):
        response = self.post('/* 설명 */ WITH b AS (SELECT * FROM Books) SELECT Id, Title FROM b WHERE Id = :id', parameters={'id': 1})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {'columns': ['Id', 'Title'], 'rows': [[1, '검증 도서']], 'row_count': 1, 'truncated': False})
        self.assertEqual(self.post('SELECT Title FROM Books WHERE Id=?', parameters=[2]).json()['rows'], [['=1+1']])
        self.assertEqual(self.post('SELECT count(*) FROM Books').json()['rows'], [[2]])

    def test_writes_pragmas_and_multiple_statements_are_blocked(self):
        statements = [
            "INSERT INTO Books VALUES(3,'금지') RETURNING *",
            "WITH x AS (SELECT 1) DELETE FROM Books RETURNING *",
            "WITH x AS (SELECT 1) UPDATE Books SET Title='금지' RETURNING *",
            'DROP TABLE Books', 'CREATE TABLE forbidden(x)', 'VACUUM',
            'PRAGMA table_info(Books)', 'PRAGMA query_only=OFF',
            "ATTACH DATABASE ':memory:' AS extra", 'BEGIN',
            'SELECT 1; DELETE FROM Books', 'SELECT 1; SELECT 2',
            "SELECT load_extension('비밀경로')", "SELECT writefile('파일', '내용')",
            'SELECT * FROM pragma_table_info(\'Books\')',
        ]
        for endpoint in ('query', 'export-csv'):
            for sql in statements:
                with self.subTest(sql=sql, endpoint=endpoint):
                    self.assertEqual(self.post(sql, endpoint).status_code, 400)
        with closing(sqlite3.connect(self.db)) as conn:
            self.assertEqual(conn.execute('SELECT * FROM Books').fetchall(), [(1, '검증 도서'), (2, '=1+1')])

    def test_private_tables_and_view_indirection_are_blocked(self):
        for sql in ('SELECT * FROM _app_users', 'SELECT count(*) FROM _APP_users',
                    'SELECT * FROM sqlite_master', 'SELECT * FROM sqlite_schema',
                    'SELECT * FROM leaked', 'WITH x AS (SELECT * FROM _app_users) SELECT * FROM x'):
            with self.subTest(sql=sql):
                response = self.post(sql)
                self.assertEqual(response.status_code, 400)
                self.assertNotIn('내부 비밀', response.text)
                self.assertNotIn('_app_users', response.text)
                self.assertNotIn(self.db, response.text)

    def test_limits_and_long_queries(self):
        sql = 'WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<1002) SELECT x FROM n'
        result = self.post(sql).json()
        self.assertEqual(result['row_count'], 1000)
        self.assertTrue(result['truncated'])
        self.assertEqual(self.post(sql, limit=3).json()['row_count'], 3)
        for limit in (0, 1001, True, '3'):
            self.assertEqual(self.post('SELECT 1', limit=limit).status_code, 422)
        endless = 'WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n) SELECT sum(x) FROM n'
        with patch.object(api, 'MAX_OPERATIONS', 2000):
            self.assertEqual(self.post(endless).status_code, 400)
        with patch.object(api, 'MAX_SECONDS', 0):
            self.assertEqual(self.post('SELECT * FROM Books').status_code, 400)
        with patch.object(api, 'MAX_RESULT_BYTES', 1):
            self.assertEqual(self.post('SELECT * FROM Books').status_code, 400)

    def test_connection_is_read_only_and_query_only(self):
        original = sqlite3.connect
        observed = []
        def capture(*args, **kwargs):
            conn = original(*args, **kwargs)
            observed.append((args, kwargs, conn))
            return conn
        with patch.object(api.sqlite3, 'connect', side_effect=capture):
            self.assertEqual(self.post('SELECT 1').status_code, 200)
        self.assertTrue(observed[0][0][0].endswith('?mode=ro'))
        self.assertTrue(observed[0][1]['uri'])
        with self.assertRaises(sqlite3.ProgrammingError):
            observed[0][2].execute('SELECT 1')
        # 설정 PRAGMA는 요청 SQL로 실행할 수 없으며, SQLite 파일 자체도 읽기 전용이다.
        with closing(original(Path(self.db).as_uri() + '?mode=ro', uri=True)) as conn:
            with self.assertRaises(sqlite3.OperationalError):
                conn.execute("INSERT INTO Books VALUES(3,'차단')")

    def test_csv_bom_formula_safety_and_truncation(self):
        response = self.post('SELECT Title FROM Books ORDER BY Id', 'export-csv')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.content.startswith(b'\xef\xbb\xbf'))
        rows = list(csv.reader(io.StringIO(response.content.decode('utf-8-sig'))))
        self.assertEqual(rows, [['Title'], ['검증 도서'], ["'=1+1"]])
        self.assertEqual(response.headers['x-row-count'], '2')
        self.assertEqual(response.headers['x-result-truncated'], 'false')
        response = self.post('SELECT * FROM Books', 'export-csv', limit=1)
        self.assertEqual(response.headers['x-result-truncated'], 'true')

    def test_invalid_sql_and_binding_errors_are_sanitized(self):
        for sql, extra in [('SELECT hidden_secret FROM Books', {}), ('SELECT ?', {'parameters': []}), ('SELECT ?', {'parameters': [{}]}), (' ', {})]:
            response = self.post(sql, **extra)
            self.assertEqual(response.status_code, 400)
            self.assertNotIn('hidden_secret', response.text)
            self.assertNotIn(self.db, response.text)
        self.assertEqual(self.post('SELECT 1', unexpected=True).status_code, 422)
        self.assertEqual(self.post("SELECT x'ff', 1e999").json()['rows'], [['base64:/w==', 'inf']])


if __name__ == '__main__':
    unittest.main()
