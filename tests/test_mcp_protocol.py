"""SDK·실제 DB 없이 Python 3.9에서 HTTP MCP 규격과 인증 경계를 검증한다."""
import base64
import unittest
from datetime import timedelta
from unittest.mock import patch

from fastapi import Depends, FastAPI, Request
from fastapi.testclient import TestClient

from auth import create_access_token, get_current_user
from mcp_http import install_mcp_http
from mcp_protocol import LEGACY, META_PREFIX, MODERN


class McpProtocolTests(unittest.TestCase):
    def setUp(self):
        self.users = {
            'teacher-a': {'id': 1, 'username': 'teacher-a', 'role': 'teacher'},
            'manager-b': {'id': 2, 'username': 'manager-b', 'role': 'manager'},
        }
        self.calls = []
        self.db_guard = patch('database.get_db_connection', side_effect=AssertionError('실제 DB 접근 금지'))
        self.db_mock = self.db_guard.start()
        self.addCleanup(self.db_guard.stop)
        self.user_patch = patch('auth.get_user_by_username', side_effect=lambda name: self.users.get(name))
        self.user_patch.start()
        self.addCleanup(self.user_patch.stop)
        self.tokens = {name: create_access_token({'sub': name}) for name in self.users}
        app = FastAPI()

        @app.get('/api/auth/me')
        def me(request: Request, user=Depends(get_current_user)):
            self.calls.append((user['username'], request.headers.get('x-bg-read-only')))
            return dict(user)

        with patch.dict('os.environ', {
            'BG_MCP_HTTP': '1', 'BG_MCP_ALLOWED_HOSTS': 'testserver',
            'BG_MCP_ALLOWED_ORIGINS': 'https://trusted.example',
        }):
            install_mcp_http(app)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def tearDown(self):
        self.db_mock.assert_not_called()

    def message(self, method='tools/list', params=None):
        values = dict(params or {})
        values['_meta'] = {
            META_PREFIX + 'protocolVersion': MODERN,
            META_PREFIX + 'clientCapabilities': {},
        }
        return {'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': values}

    def headers(self, method='tools/list', user='teacher-a'):
        result = {
            'Authorization': 'Bearer ' + self.tokens[user],
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/event-stream',
            'MCP-Protocol-Version': MODERN, 'MCP-Method': method,
        }
        if method == 'tools/call':
            result['MCP-Name'] = 'read_get_me'
        return result

    def post(self, body=None, headers=None):
        body = self.message() if body is None else body
        headers = self.headers(body.get('method', 'tools/list')) if headers is None else headers
        return self.client.post('/mcp', json=body, headers=headers)

    def assert_error(self, response, code, status=400):
        self.assertEqual(response.status_code, status, response.text)
        self.assertEqual(response.json()['error']['code'], code, response.text)
        self.assertEqual(response.headers.get('cache-control'), 'no-store')

    def test_modern_required_metadata_and_optional_client_info(self):
        for info in (None, {'name': '검증 클라이언트', 'version': '1'}):
            with self.subTest(info=info):
                body = self.message()
                if info is not None:
                    body['params']['_meta'][META_PREFIX + 'clientInfo'] = info
                response = self.post(body)
                self.assertEqual(response.status_code, 200, response.text)
                result = response.json()['result']
                self.assertIn('tools', result)
                self.assertIn(META_PREFIX + 'serverInfo', result['_meta'])
                self.assertTrue(all(t['annotations']['readOnlyHint'] for t in result['tools']))
                self.assertFalse(any(t['annotations']['destructiveHint'] for t in result['tools']))
                self.assertEqual(response.headers['cache-control'], 'no-store')

    def test_discover_supported_versions(self):
        response = self.post(self.message('server/discover'))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['result']['supportedVersions'], [MODERN, LEGACY])

    def test_metadata_missing_and_invalid(self):
        for key in ('protocolVersion', 'clientCapabilities'):
            with self.subTest(key=key):
                body = self.message()
                del body['params']['_meta'][META_PREFIX + key]
                self.assert_error(self.post(body), -32602)
        for meta in (None, [], {'protocolVersion': MODERN, 'clientCapabilities': {}}):
            with self.subTest(meta=meta):
                body = self.message()
                body['params']['_meta'] = meta
                self.assert_error(self.post(body), -32602)
        body = self.message()
        body['params']['_meta'][META_PREFIX + 'clientInfo'] = {'name': '이름만'}
        self.assert_error(self.post(body), -32602)

    def test_method_and_version_headers_must_match(self):
        for key, value in (('MCP-Method', 'tools/call'), ('MCP-Method', None),
                           ('MCP-Protocol-Version', LEGACY), ('MCP-Protocol-Version', None)):
            with self.subTest(key=key, value=value):
                headers = self.headers()
                if value is None:
                    del headers[key]
                else:
                    headers[key] = value
                self.assert_error(self.post(headers=headers), -32020)

    def test_name_header_plain_base64_and_mismatch(self):
        body = self.message('tools/call', {'name': 'read_get_me'})
        for name in ('read_get_me', '=?base64?' + base64.b64encode(b'read_get_me').decode('ascii') + '?='):
            headers = self.headers('tools/call')
            headers['MCP-Name'] = name
            self.assertEqual(self.post(body, headers).status_code, 200)
        for name in (None, 'other', '=?base64?@@@?=', '=?base64?/w==?='):
            with self.subTest(name=name):
                headers = self.headers('tools/call')
                if name is None:
                    del headers['MCP-Name']
                else:
                    headers['MCP-Name'] = name
                self.assert_error(self.post(body, headers), -32020)
        self.assertEqual(len(self.calls), 2)

    def test_duplicate_routing_headers_rejected(self):
        body = self.message('tools/call', {'name': 'read_get_me'})
        base = self.headers('tools/call')
        for name in ('MCP-Method', 'MCP-Name', 'MCP-Protocol-Version', 'Authorization',
                     'Content-Type', 'Host', 'Origin', 'Content-Length'):
            with self.subTest(name=name):
                headers = dict(base)
                headers.setdefault(name, {'Host': 'testserver', 'Origin': 'https://trusted.example',
                                          'Content-Length': '0'}.get(name, 'value'))
                pairs = list(headers.items()) + [(name.lower(), headers[name])]
                self.assert_error(self.post(body, pairs), -32020)
        self.assertEqual(self.calls, [])

    def test_legacy_initialize_and_ping(self):
        headers = self.headers('initialize')
        del headers['MCP-Protocol-Version']
        body = {'jsonrpc': '2.0', 'id': 'init', 'method': 'initialize', 'params': {
            'protocolVersion': LEGACY, 'clientInfo': {'name': '검증', 'version': '1'}, 'capabilities': {}}}
        response = self.post(body, headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['result']['protocolVersion'], LEGACY)
        headers['MCP-Protocol-Version'] = LEGACY
        response = self.post({'jsonrpc': '2.0', 'id': 2, 'method': 'ping'}, headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['result'], {})

    def test_unknown_method_modern_404_and_tool_invalid_params(self):
        self.assert_error(self.post(self.message('unknown/method')), -32601, 404)
        body = self.message('tools/call', {'name': 'delete_everything'})
        headers = self.headers('tools/call')
        headers['MCP-Name'] = 'delete_everything'
        self.assert_error(self.post(body, headers), -32602)
        self.assertEqual(self.calls, [])

    def test_batch_response_and_invalid_ids(self):
        cases = [[], [self.message()], {'jsonrpc': '2.0', 'id': 1, 'result': {}},
                 dict(self.message(), result={}), dict(self.message(), error={})]
        cases.extend(dict(self.message(), id=value) for value in (True, False, None, 1.5, [], {}))
        for body in cases:
            with self.subTest(body=body):
                self.assert_error(self.client.post('/mcp', json=body, headers=self.headers()), -32600)
        for value in (0, '요청-1'):
            response = self.post(dict(self.message(), id=value))
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()['id'], value)

    def test_duplicate_json_nan_and_bad_encoding(self):
        raw_cases = [b'{"jsonrpc":"2.0","jsonrpc":"2.0"}',
                     b'{"jsonrpc":"2.0","id":NaN,"method":"tools/list"}',
                     b'{"value":Infinity}', b'{"value":-Infinity}', b'\xff', b'{']
        for raw in raw_cases:
            with self.subTest(raw=raw):
                self.assert_error(self.client.post('/mcp', content=raw, headers=self.headers()), -32700)

    def test_content_type_and_encoding(self):
        for overrides in ({'Content-Type': 'text/plain'}, {'Content-Encoding': 'gzip'}):
            headers = self.headers()
            headers.update(overrides)
            self.assertEqual(self.post(headers=headers).status_code, 415)
        headers = self.headers()
        headers['Content-Type'] = 'application/json; charset=utf-8'
        self.assertEqual(self.post(headers=headers).status_code, 200)

    def test_accept_requires_both_media_types(self):
        for accept in ('*/*', 'application/json', 'text/event-stream',
                       'application/json, text/event-stream;q=0',
                       'application/json;q=invalid, text/event-stream'):
            with self.subTest(accept=accept):
                headers = self.headers()
                headers['Accept'] = accept
                self.assertEqual(self.post(headers=headers).status_code, 406)

    def test_declared_and_streamed_body_limits(self):
        with patch('mcp_http.MAX_BODY_BYTES', 512):
            headers = self.headers()
            headers['Content-Length'] = '513'
            self.assertEqual(self.post(headers=headers).status_code, 413)
            headers['Content-Length'] = '1'
            response = self.client.post('/mcp', content=b' ' * 513, headers=headers)
            self.assertEqual(response.status_code, 413)
            headers['Content-Length'] = 'bad'
            self.assert_error(self.post(headers=headers), -32600)
        self.assertEqual(self.calls, [])

    def test_notifications_202_never_execute(self):
        with patch('mcp_gateway.ReadGateway.call', side_effect=AssertionError('알림에서 도구 실행 금지')) as call:
            for method in ('notifications/initialized', 'notifications/cancelled', 'notifications/tools/call'):
                body = self.message(method, {'name': 'read_get_me'})
                del body['id']
                response = self.post(body)
                self.assertEqual(response.status_code, 202)
                self.assertEqual(response.content, b'')
            body = self.message('tools/call', {'name': 'read_get_me'})
            del body['id']
            self.assert_error(self.post(body), -32600)
            call.assert_not_called()
        self.assertEqual(self.calls, [])

    def test_user_tokens_are_isolated(self):
        body = self.message('tools/call', {'name': 'read_get_me'})
        for user in ('teacher-a', 'manager-b', 'teacher-a'):
            response = self.post(body, self.headers('tools/call', user))
            self.assertEqual(response.status_code, 200)
            result = response.json()['result']
            self.assertFalse(result['isError'])
            self.assertEqual(result['structuredContent'], self.users[user])
        self.assertEqual(self.calls, [('teacher-a', '1'), ('manager-b', '1'), ('teacher-a', '1')])

    def test_missing_invalid_expired_and_deleted_user_tokens(self):
        expired = create_access_token({'sub': 'teacher-a'}, expires_delta=timedelta(seconds=-60))
        for value in ('', 'Basic abc', 'Bearer invalid', 'Bearer ' + expired):
            headers = self.headers()
            headers['Authorization'] = value
            response = self.post(headers=headers)
            self.assertEqual(response.status_code, 401)
            self.assertEqual(response.headers['www-authenticate'], 'Bearer')
        del self.users['teacher-a']
        self.assertEqual(self.post().status_code, 401)
        self.assertEqual(self.calls, [])

    def test_host_and_origin_checks(self):
        for header, value, status in (('Host', 'evil.example', 421), ('Origin', 'https://evil.example', 403),
                                      ('Origin', 'null', 403)):
            headers = self.headers()
            headers[header] = value
            self.assertEqual(self.post(headers=headers).status_code, status)
        headers = self.headers()
        headers['Origin'] = 'https://trusted.example'
        self.assertEqual(self.post(headers=headers).status_code, 200)

    def test_get_and_delete_do_not_expose_mutation(self):
        for method in ('GET', 'DELETE'):
            response = self.client.request(method, '/mcp', headers=self.headers())
            self.assertEqual(response.status_code, 405)
            self.assertEqual(response.headers.get('allow'), 'POST')
        self.assertEqual(self.calls, [])

    def test_invalid_tool_arguments_are_not_executed(self):
        for arguments in ([], {'unexpected': True}):
            body = self.message('tools/call', {'name': 'read_get_me', 'arguments': arguments})
            response = self.post(body)
            if isinstance(arguments, list):
                self.assert_error(response, -32602)
            else:
                self.assertEqual(response.status_code, 200)
                self.assertTrue(response.json()['result']['isError'])
        self.assertEqual(self.calls, [])

    def test_deep_json_rejected(self):
        raw = '{"nested":' + '[' * 66 + '0' + ']' * 66 + '}'
        self.assert_error(self.client.post('/mcp', content=raw, headers=self.headers()), -32700)


if __name__ == '__main__':
    unittest.main()
