"""실제 DB 없이 전용 토큰과 내부 ASGI 경계를 검증한다."""
import hashlib
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
import auth
import database
import mcp_tokens as tokens
from mcp_http import install_mcp_http
from mcp_protocol import LEGACY


class McpTokenTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.db = str(Path(self.temp.name) / 'tokens.db')
        self.patch = patch.object(database.settings, 'SQLITE_DB_PATH', self.db)
        self.patch.start()
        self.addCleanup(self.patch.stop)
        self.sql('''CREATE TABLE _app_users(id INTEGER PRIMARY KEY, username TEXT, password_hash TEXT, role TEXT)''')
        self.sql("INSERT INTO _app_users VALUES(1,'teacher','password-one','teacher'),(2,'other','password-two','admin')")
        self.sql('''CREATE TABLE _app_audit_logs(id INTEGER PRIMARY KEY,table_name TEXT,record_id TEXT,action TEXT,old_data TEXT,new_data TEXT,changed_fields TEXT,username TEXT,user_role TEXT,ip_address TEXT)''')
        tokens.init_mcp_token_tables()
        self.app = FastAPI()
        self.app.include_router(tokens.router)
        self.app.add_middleware(tokens.TokenNoStoreMiddleware)

        @self.app.get('/api/public-check')
        def public_check():
            return {'ok': True}

        @self.app.get('/api/auth/me')
        def me(user=Depends(auth.get_current_user)):
            return {'username': user['username'], 'role': user['role']}

        @self.app.delete('/api/user/books/1')
        def delete(user=Depends(auth.get_current_staff)):
            return {'changed': True}

        with patch.dict('os.environ', {'BG_MCP_HTTP': '1', 'BG_MCP_ALLOWED_HOSTS': 'testserver'}):
            install_mcp_http(self.app)
        self.client = TestClient(self.app, raise_server_exceptions=False)
        self.addCleanup(self.client.close)
        self.web = {'Authorization': 'Bearer ' + auth.create_access_token({'sub': 'teacher'})}

    def sql(self, sql, args=()):
        conn = sqlite3.connect(self.db)
        try:
            result = conn.execute(sql, args).fetchall()
            conn.commit()
            return result
        finally:
            conn.close()

    def issue(self):
        response = self.client.post('/api/user/mcp-token', headers=self.web, json={'confirmation': 'MCP 토큰 발급'})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.headers['cache-control'], 'no-store')
        return response.json()['token']

    def call(self, token):
        return self.client.post('/mcp', headers={'Authorization': 'Bearer ' + token,
            'Accept': 'application/json, text/event-stream', 'MCP-Protocol-Version': LEGACY},
            json={'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call',
                  'params': {'name': 'read_get_me', 'arguments': {}}})

    def test_issue_metadata_storage_rotation_revoke(self):
        first = self.issue()
        self.assertRegex(first, r'^bgmcp_[A-Za-z0-9_-]{43}$')
        status = self.client.get('/api/user/mcp-token', headers=self.web).json()
        self.assertEqual(set(status), {'enabled', 'active', 'created_at', 'expires_at'})
        self.assertTrue(status['active'])
        self.assertEqual(self.sql('SELECT token_hash FROM _app_mcp_tokens')[0][0], hashlib.sha256(first.encode()).hexdigest())
        second = self.issue()
        self.assertEqual(self.call(first).status_code, 401)
        self.assertEqual(self.call(second).status_code, 200)
        response = self.client.request('DELETE', '/api/user/mcp-token', headers=self.web, json={'confirmation': 'MCP 토큰 폐기'})
        self.assertFalse(response.json()['active'])
        self.assertEqual(self.call(second).status_code, 401)
        audit = str(self.sql('SELECT * FROM _app_audit_logs'))
        for secret in (first, second, hashlib.sha256(first.encode()).hexdigest(), 'password-one'):
            self.assertNotIn(secret, audit)

    def test_external_read_write_and_management_rejected_even_with_headers(self):
        token = self.issue()
        headers = {'Authorization': 'Bearer ' + token, 'X-BG-Read-Only': '1', 'bg.mcp.internal.read': 'true'}
        for method, route in [('GET', '/api/public-check'), ('GET', '/api/auth/me'), ('DELETE', '/api/user/books/1'), ('GET', '/api/user/mcp-token'), ('POST', '/api/user/mcp-token'), ('DELETE', '/api/user/mcp-token')]:
            response = self.client.request(method, route, headers=headers, json={'confirmation': 'MCP 토큰 발급'})
            self.assertEqual(response.status_code, 401, response.text)
        result = self.call(token).json()['result']
        self.assertFalse(result.get('isError'), result)
        self.assertIn('teacher', json.dumps(result))
        self.assertNotIn(token, json.dumps(result))

    def test_live_role_password_expiry_and_deleted_account(self):
        token = self.issue()
        self.sql("UPDATE _app_users SET role='manager' WHERE id=1")
        self.assertIn('manager', self.call(token).text)
        self.sql("UPDATE _app_users SET password_hash='changed' WHERE id=1")
        self.assertEqual(self.call(token).status_code, 401)
        self.sql("UPDATE _app_users SET password_hash='password-one' WHERE id=1")
        self.assertEqual(self.call(token).status_code, 401)
        token = self.issue()
        self.sql("UPDATE _app_mcp_tokens SET expires_at='2000-01-01T00:00:00+00:00'")
        self.assertEqual(self.call(token).status_code, 401)
        token = self.issue()
        self.sql('DELETE FROM _app_users WHERE id=1')
        self.sql("INSERT INTO _app_users VALUES(3,'teacher','changed','admin')")
        self.assertEqual(self.call(token).status_code, 401)

    def test_self_only_confirmation_no_store_and_audit_rollback(self):
        first = self.issue()
        other = {'Authorization': 'Bearer ' + auth.create_access_token({'sub': 'other'})}
        self.assertFalse(self.client.get('/api/user/mcp-token', headers=other).json()['active'])
        for body in ({'confirmation': 'wrong'}, {'confirmation': 'MCP 토큰 발급', 'user_id': 2}):
            response = self.client.post('/api/user/mcp-token', headers=self.web, json=body)
            self.assertIn(response.status_code, (400, 422))
            self.assertEqual(response.headers['cache-control'], 'no-store')
        with patch('database.write_audit_log', side_effect=RuntimeError('검증 실패')):
            response = self.client.post('/api/user/mcp-token', headers=self.web, json={'confirmation': 'MCP 토큰 발급'})
            self.assertEqual(response.status_code, 500)
            self.assertEqual(response.headers['cache-control'], 'no-store')
        self.assertEqual(self.call(first).status_code, 200)
        self.assertEqual(len(self.sql('SELECT * FROM _app_mcp_tokens')), 1)

    def test_web_jwt_compatibility_and_disabled_mode(self):
        self.assertEqual(self.call(self.web['Authorization'][7:]).status_code, 200)
        self.app.state.mcp_http_enabled = False
        response = self.client.post('/api/user/mcp-token', headers=self.web, json={'confirmation': 'MCP 토큰 발급'})
        self.assertEqual(response.status_code, 503)
        self.assertFalse(self.client.get('/api/user/mcp-token', headers=self.web).json()['enabled'])

    def test_internal_wrapper_denies_non_catalog_paths(self):
        client = TestClient(tokens.InternalReadApp(self.app))
        self.addCleanup(client.close)
        token = self.issue()
        for method, route in [('GET', '/api/user/mcp-token'), ('DELETE', '/api/user/books/1')]:
            self.assertEqual(client.request(method, route, headers={'Authorization': 'Bearer ' + token}).status_code, 403)


if __name__ == '__main__':
    unittest.main()
