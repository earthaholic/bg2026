"""3.11 공식 클라이언트가 별도 Python 3.9 서버와 실제 HTTP로 통신한다."""
import asyncio
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import unittest

import httpx2
from mcp.client import Client
from mcp.client.streamable_http import streamable_http_client
from auth import create_access_token


@unittest.skipUnless(os.environ.get('BG_MCP_TEST_PYTHON39'), '별도 Python 3.9 검증 실행 파일을 지정해야 합니다.')
class Python39ProcessTests(unittest.IsolatedAsyncioTestCase):
    async def test_official_client_against_python39_server(self):
        root = Path(__file__).resolve().parents[1]
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        env = dict(os.environ)
        env.pop('PYTHONHOME', None)
        with tempfile.TemporaryFile() as output:
            process = subprocess.Popen([env['BG_MCP_TEST_PYTHON39'], '-m', 'uvicorn', 'tests_mcp.http_fixture:app',
                                        '--host', '127.0.0.1', '--port', str(port), '--log-level', 'error'],
                                       cwd=str(root), env=env, stdin=subprocess.DEVNULL,
                                       stdout=output, stderr=output)
            try:
                url = f'http://127.0.0.1:{port}/mcp'
                async with httpx2.AsyncClient(timeout=2) as probe:
                    for _ in range(100):
                        if process.poll() is not None:
                            self.fail('검증용 Python 3.9 서버가 시작 전에 종료되었습니다.')
                        try:
                            if (await probe.get(url)).status_code == 401:
                                break
                        except httpx2.HTTPError:
                            pass
                        await asyncio.sleep(0.1)
                    else:
                        self.fail('검증 서버 기동 제한 시간을 초과했습니다.')
                token = create_access_token({'sub': 'mcp-verification'})
                async with httpx2.AsyncClient(headers={'Authorization': 'Bearer ' + token}) as http:
                    for mode, version in [('auto', '2026-07-28'), ('legacy', '2025-11-25')]:
                        async with Client(streamable_http_client(url, http_client=http), mode=mode) as client:
                            self.assertEqual(client.protocol_version, version)
                            self.assertEqual(len((await client.list_tools()).tools), 66)
                            result = await client.call_tool('read_get_me', {})
                            self.assertFalse(result.is_error)
                            self.assertEqual(result.structured_content['role'], 'teacher')
            finally:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
