"""MCP 전용 환경에서 실행. 실제 계정·업무 데이터 없이 프로토콜과 프록시 경계를 검증한다."""
import base64
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import httpx
from mcp.client import Client
from mcp.client.stdio import StdioServerParameters
import mcp_gateway
from mcp_server import ReadGateway, create_server


class GatewayTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.requests = []
        self.status = 200
        self.body = {'ok': True, 'token': '숨김', 'nested': [{'password_hash': '숨김', 'name': '검증'}]}
        def handler(request):
            self.requests.append(request)
            if request.url.path == '/api/tables':
                return httpx.Response(200, json={'tables': [{'name': 'Books'}]})
            return httpx.Response(self.status, json=self.body)
        self.gateway = ReadGateway('http://127.0.0.1:8000', 'test-user-token', httpx.MockTransport(handler))

    async def test_read_filters_auth_and_secret_scrub(self):
        result = await self.gateway.call('read_user_search_students', {'q': '검증', 'page': 2, 'teacher_record_state': 'empty'})
        request = self.requests[-1]
        self.assertEqual(request.method, 'GET')
        self.assertEqual(request.url.params['page'], '2')
        self.assertEqual(request.headers['authorization'], 'Bearer test-user-token')
        self.assertEqual(request.headers['x-bg-read-only'], '1')
        self.assertNotIn('token', result)
        self.assertEqual(result['nested'], [{'name': '검증'}])

    async def test_no_write_unknown_or_arbitrary_url(self):
        for name, args in [('delete_student', {}), ('read_user_search_students', {'url': 'https://evil.invalid'}),
                           ('read_table_data', {'table_name': '../_app_users'}),
                           ('read_table_data', {'table_name': '_app_users'}),
                           ('read_table_data', {'table_name': 'sqlite_master'})]:
            with self.subTest(name=name, args=args), self.assertRaises(ValueError):
                await self.gateway.call(name, args)
        self.assertFalse(self.requests)

    async def test_admin_table_allowlist(self):
        await self.gateway.call('read_table_data', {'table_name': 'Books'})
        self.assertEqual(self.requests[-1].url.path, '/api/tables/Books/data')
        with self.assertRaises(ValueError):
            await self.gateway.call('read_table_data', {'table_name': 'Unknown'})

    async def test_invalid_schema_and_permissions(self):
        with self.assertRaises(ValueError):
            await self.gateway.call('read_user_search_students', {'page': 0})
        for status in (401, 403, 302, 500):
            self.status = status
            with self.subTest(status=status), self.assertRaises(ValueError):
                await self.gateway.call('read_get_me', {})

    async def test_preview_upload_and_sql_only_safe_route(self):
        await self.gateway.call('read_preview_teacher_assignment', {'file_base64': base64.b64encode(b'a,b').decode(), 'filename': '검증.csv', 'teacher_username': 'test'})
        self.assertIn('multipart/form-data', self.requests[-1].headers['content-type'])
        self.assertEqual(self.requests[-1].method, 'POST')
        await self.gateway.call('read_query', {'body': {'sql': 'SELECT 1'}})
        self.assertEqual(self.requests[-1].url.path, '/api/admin/mcp/sql/query')
        self.assertEqual(json.loads(self.requests[-1].content), {'sql': 'SELECT 1'})
        with self.assertRaises(ValueError):
            await self.gateway.call('read_preview_teacher_assignment', {'file_base64': '!!', 'filename': '검증.csv', 'teacher_username': 'test'})

    async def test_csv_and_size_limit(self):
        self.gateway.transport = httpx.MockTransport(lambda request: httpx.Response(200, text='이름\n검증\n', headers={'content-type': 'text/csv'}))
        result = await self.gateway.call('read_export_csv', {'body': {'sql': 'SELECT 1'}})
        self.assertEqual(result['mime_type'], 'text/csv')
        with patch.object(mcp_gateway, 'MAX_RESPONSE_BYTES', 2), self.assertRaises(ValueError):
            await self.gateway.call('read_get_me', {})

    async def test_modern_and_legacy_protocol(self):
        for mode, version in [('auto', '2026-07-28'), ('legacy', '2025-11-25')]:
            async with Client(create_server(self.gateway), mode=mode) as client:
                self.assertEqual(client.protocol_version, version)
                tools = (await client.list_tools()).tools
                self.assertEqual(len(tools), 66)
                self.assertTrue(all(t.annotations.read_only_hint for t in tools))
                result = await client.call_tool('read_get_me', {})
                self.assertFalse(result.is_error)
                self.assertTrue(result.structured_content['ok'])
                self.status = 403
                denied = await client.call_tool('read_get_me', {})
                self.assertTrue(denied.is_error)
                self.status = 200

    async def test_real_stdio_discovery(self):
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                valid = (self.path == '/api/auth/me' and self.headers.get('Authorization') == 'Bearer test-token'
                         and self.headers.get('X-BG-Read-Only') == '1')
                self.send_response(200 if valid else 403)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'username': '검증 계정', 'role': 'teacher'}).encode())

        backend = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = Thread(target=backend.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(backend.server_close)
        self.addCleanup(backend.shutdown)
        root = Path(__file__).resolve().parents[1]
        params = StdioServerParameters(command=sys.executable, args=[str(root / 'mcp_server.py')],
                                       env={**os.environ, 'BG_MCP_TOKEN': 'test-token',
                                            'BG_MCP_BASE_URL': f'http://127.0.0.1:{backend.server_port}'})
        async with Client(params) as client:
            self.assertEqual(client.protocol_version, '2026-07-28')
            self.assertEqual(len((await client.list_tools()).tools), 66)
            result = await client.call_tool('read_get_me', {})
            self.assertFalse(result.is_error)
            self.assertEqual(result.structured_content['role'], 'teacher')

    def test_no_remote_plaintext_or_missing_credentials(self):
        for url, token in [('http://example.com', 'test'), ('https://user:pass@example.com', 'test'),
                           ('https://example.com?x=1', 'test'), ('https://example.com', '')]:
            with self.subTest(url=url), self.assertRaises(ValueError):
                ReadGateway(url, token)


if __name__ == '__main__':
    unittest.main()
