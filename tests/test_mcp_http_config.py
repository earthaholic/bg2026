"""최신 SDK 없는 Python 3.9 웹 환경과 선택적 MCP 실행을 검증한다."""
import unittest
import builtins
from unittest.mock import patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from mcp_http import install_mcp_http


class HttpConfigTests(unittest.TestCase):
    def test_auto_without_optional_packages_keeps_web_and_returns_unavailable(self):
        app = FastAPI()

        @app.get('/')
        def home():
            return {'ok': True}

        with patch.dict('os.environ', {'BG_MCP_HTTP': 'auto'}), patch('mcp_http.importlib.util.find_spec', return_value=None):
            install_mcp_http(app)
        with TestClient(app) as client:
            self.assertEqual(client.get('/').status_code, 200)
            self.assertEqual(client.post('/mcp').status_code, 503)
        self.assertFalse(app.state.mcp_http_enabled)

    def test_explicit_enable_fails_when_packages_missing(self):
        with patch.dict('os.environ', {'BG_MCP_HTTP': '1'}), patch('mcp_http.importlib.util.find_spec', return_value=None):
            with self.assertRaises(RuntimeError):
                install_mcp_http(FastAPI())

    def test_does_not_import_latest_sdk(self):
        original_import = builtins.__import__

        def without_sdk(name, *args, **kwargs):
            if name == 'mcp' or name.startswith('mcp.') or name == 'mcp_types':
                raise AssertionError('최신 MCP SDK를 서버에서 불러오면 안 됩니다.')
            return original_import(name, *args, **kwargs)

        with patch.dict('os.environ', {'BG_MCP_HTTP': '1'}), patch('builtins.__import__', side_effect=without_sdk):
            app = FastAPI()
            install_mcp_http(app)
        self.assertTrue(app.state.mcp_http_enabled)
        with TestClient(app, base_url='http://localhost') as client:
            self.assertEqual(client.get('/mcp').status_code, 401)

    def test_off_and_invalid_modes(self):
        with patch.dict('os.environ', {'BG_MCP_HTTP': '0'}):
            app = FastAPI()
            install_mcp_http(app)
        with TestClient(app) as client:
            self.assertEqual(client.post('/mcp').status_code, 404)
        with patch.dict('os.environ', {'BG_MCP_HTTP': 'unknown'}), self.assertRaises(RuntimeError):
            install_mcp_http(FastAPI())
