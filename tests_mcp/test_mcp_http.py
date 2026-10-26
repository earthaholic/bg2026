"""운영 DB 없이 HTTP 전송·인증 격리·워커 간 세션 비의존성을 검증한다."""
import asyncio
from contextlib import AsyncExitStack, asynccontextmanager
from datetime import timedelta
import unittest
from unittest.mock import patch

import httpx
import httpx2
from fastapi import Depends, FastAPI
from mcp.client import Client
from mcp.client.streamable_http import streamable_http_client
from mcp.shared.exceptions import MCPError

import auth
from mcp_http import install_mcp_http


def environment(test):
    async def run(self):
        async with AsyncExitStack() as stack:
            self.stack = stack
            await self.prepare()
            await test(self)
    return run


class HttpTests(unittest.IsolatedAsyncioTestCase):
    async def prepare(self):
        self.users = {'first': {'id': 1, 'username': 'first', 'role': 'teacher'},
                      'second': {'id': 2, 'username': 'second', 'role': 'admin'}}
        self.stack.enter_context(patch.object(auth, 'get_user_by_username', lambda name: self.users.get(name)))
        self.stack.enter_context(patch.dict('os.environ', {'BG_MCP_HTTP': '1'}))
        self.tokens = {name: auth.create_access_token({'sub': name}) for name in self.users}
        self.apps = []
        for _ in range(2):
            @asynccontextmanager
            async def lifespan(app):
                app.state.running = True
                yield
                app.state.running = False
            app = FastAPI(lifespan=lifespan)

            @app.get('/api/auth/me')
            async def me(user=Depends(auth.get_current_user)):
                await asyncio.sleep(0.01)
                return user

            @app.get('/api/admin/users')
            async def admin_users(user=Depends(auth.get_current_admin)):
                return {'users': [user]}

            install_mcp_http(app)
            self.apps.append(app)
            await self.stack.enter_async_context(app.router.lifespan_context(app))
        self.http = await self.stack.enter_async_context(httpx.AsyncClient(
            transport=httpx.ASGITransport(app=self.apps[0]), base_url='http://localhost'))

    async def client(self, actor, worker=0, mode='auto'):
        http = await self.stack.enter_async_context(httpx2.AsyncClient(
            transport=httpx2.ASGITransport(app=self.apps[worker]),
            headers={'Authorization': 'Bearer ' + self.tokens[actor]}))
        transport = streamable_http_client('http://localhost/mcp', http_client=http)
        return await self.stack.enter_async_context(Client(transport, mode=mode))

    @environment
    async def test_official_modern_and_legacy_client(self):
        for mode, version in [('auto', '2026-07-28'), ('legacy', '2025-11-25')]:
            client = await self.client('first', mode=mode)
            self.assertEqual(client.protocol_version, version)
            self.assertEqual(len((await client.list_tools()).tools), 66)
            result = await client.call_tool('read_get_me', {})
            self.assertFalse(result.is_error, result)
            self.assertEqual(result.structured_content['username'], 'first')
        self.assertTrue(self.apps[0].state.running)

    @environment
    async def test_concurrent_tokens_do_not_cross_and_roles_stay_live(self):
        first, second = await self.client('first'), await self.client('second')
        results = await asyncio.gather(*[c.call_tool('read_get_me', {}) for c in [first, second] * 5])
        self.assertEqual([r.structured_content['username'] for r in results], ['first', 'second'] * 5)
        self.assertTrue((await first.call_tool('read_admin_list_users', {})).is_error)
        self.assertFalse((await second.call_tool('read_admin_list_users', {})).is_error)
        self.users['second']['role'] = 'teacher'
        self.assertTrue((await second.call_tool('read_admin_list_users', {})).is_error)

    @environment
    async def test_unauthorized_expired_deleted_and_cookie_only(self):
        expired = auth.create_access_token({'sub': 'first'}, expires_delta=timedelta(seconds=-1))
        deleted = auth.create_access_token({'sub': 'deleted'})
        for headers in ({}, {'Authorization': 'Bearer invalid'}, {'Authorization': 'Bearer ' + expired},
                        {'Authorization': 'Bearer ' + deleted}, {'Cookie': 'access_token=' + self.tokens['first']}):
            result = await self.http.post('/mcp', headers=headers, json={'jsonrpc': '2.0', 'id': 1, 'method': 'server/discover'})
            self.assertEqual(result.status_code, 401)
            self.assertNotIn(self.tokens['first'], result.text)

    @environment
    async def test_host_origin_and_body_limits(self):
        headers = {'Authorization': 'Bearer ' + self.tokens['first'], 'Accept': 'application/json, text/event-stream'}
        body = {'jsonrpc': '2.0', 'id': 1, 'method': 'server/discover'}
        for extra, status in [({'Host': 'evil.invalid'}, 421), ({'Origin': 'https://evil.invalid'}, 403)]:
            result = await self.http.post('/mcp', headers={**headers, **extra}, json=body)
            self.assertEqual(result.status_code, status)
        result = await self.http.post('/mcp', headers={**headers, 'Content-Length': str(9 * 1024 * 1024)}, json=body)
        self.assertEqual(result.status_code, 413)

    @environment
    async def test_two_workers_without_sticky_sessions(self):
        headers = {'Authorization': 'Bearer ' + self.tokens['first'], 'Accept': 'application/json, text/event-stream'}
        initialized = await self.http.post('/mcp', headers=headers, json={
            'jsonrpc': '2.0', 'id': 1, 'method': 'initialize',
            'params': {'protocolVersion': '2025-11-25', 'capabilities': {}, 'clientInfo': {'name': '검증', 'version': '1'}}})
        self.assertEqual(initialized.status_code, 200, initialized.text)
        self.assertNotIn('mcp-session-id', initialized.headers)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=self.apps[1]), base_url='http://localhost') as other:
            result = await other.post('/mcp', headers={**headers, 'MCP-Protocol-Version': '2025-11-25'},
                                      json={'jsonrpc': '2.0', 'id': 2, 'method': 'tools/call', 'params': {'name': 'read_get_me', 'arguments': {}}})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()['result']['structuredContent']['username'], 'first')

    @environment
    async def test_real_main_lifespan_and_internal_api(self):
        import main
        import activity
        self.users['first']['name'] = '검증 선생님'
        startup_mocks = [self.stack.enter_context(patch.object(main, name)) for name in
                         ('init_system_tables', 'init_activity_tables', 'init_tuition_collection_tables', 'advance_student_grades')]
        self.stack.enter_context(patch.object(activity, 'write_activity'))
        await self.stack.enter_async_context(main.app.router.lifespan_context(main.app))
        self.apps.append(main.app)
        client = await self.client('first', worker=2)
        result = await client.call_tool('read_get_me', {})
        self.assertFalse(result.is_error, result)
        self.assertEqual(result.structured_content['name'], '검증 선생님')
        self.assertTrue((await client.call_tool('read_admin_list_users', {})).is_error)
        for mock in startup_mocks:
            mock.assert_called_once()

    @environment
    async def test_write_tool_is_not_exposed(self):
        client = await self.client('first')
        with self.assertRaises(MCPError):
            await client.call_tool('delete_student', {})


if __name__ == '__main__':
    unittest.main()
