"""Python 3.9 호환 읽기 전용 조회 경계. MCP SDK와 분리한다."""
import base64
import json
import re
from pathlib import Path
from urllib.parse import quote, urlsplit

import httpx
from jsonschema import Draft202012Validator

CATALOG_PATH = Path(__file__).with_name('mcp_catalog.json')
MAX_RESPONSE_BYTES = 8 * 1024 * 1024
READ_POSTS = frozenset({
    '/api/user/monthly-report/preview',
    '/api/user/utilities/studylog-csv/preview',
    '/api/user/utilities/teacher-assignment/preview',
    '/api/admin/mcp/sql/query',
    '/api/admin/mcp/sql/export-csv',
})
SECRET_KEYS = frozenset({'password', 'password_hash', 'token', 'access_token', 'refresh_token', 'secret_key', 'authorization'})


def scrub(value):
    """미리보기에서 발급된 쓰기용 토큰과 인증정보는 모델에게 전달하지 않는다."""
    if isinstance(value, dict):
        return {k: scrub(v) for k, v in value.items() if k.lower() not in SECRET_KEYS}
    if isinstance(value, list):
        return [scrub(v) for v in value]
    return value


class ReadGateway:
    def __init__(self, base_url, token, transport=None):
        parsed = urlsplit(base_url)
        if (parsed.scheme not in ('http', 'https') or not parsed.hostname or
                parsed.username or parsed.password or parsed.query or parsed.fragment or
                (parsed.scheme == 'http' and parsed.hostname not in ('127.0.0.1', 'localhost', '::1'))):
            raise ValueError('사이트 주소는 HTTPS 또는 로컬 HTTP 주소여야 합니다.')
        if not token or '\n' in token or '\r' in token:
            raise ValueError('유효한 로그인 토큰을 환경변수 또는 토큰 파일로 지정하세요.')
        self.base_url = base_url.rstrip('/')
        self.token = token
        self.transport = transport
        self.catalog = json.loads(CATALOG_PATH.read_text(encoding='utf-8'))
        self.tools = {entry['name']: entry for entry in self.catalog}
        for entry in self.catalog:
            if entry['method'] != 'GET' and (entry['method'], entry['path']) not in {('POST', p) for p in READ_POSTS}:
                raise ValueError('허용되지 않은 변경 경로가 조회 목록에 포함되어 있습니다.')
            if not entry['path'].startswith('/api/') or '..' in entry['path']:
                raise ValueError('잘못된 조회 경로입니다.')
            Draft202012Validator.check_schema(entry['inputSchema'])

    async def request(self, method, route, **kwargs):
        async with httpx.AsyncClient(transport=self.transport, timeout=45, follow_redirects=False, trust_env=False) as client:
            async with client.stream(method, self.base_url + route,
                                     headers={'Authorization': 'Bearer ' + self.token, 'X-BG-Read-Only': '1'}, **kwargs) as response:
                if response.status_code != 200:
                    messages = {401: '로그인이 만료되었거나 유효하지 않습니다. 로그인 토큰을 갱신하세요.',
                                403: '현재 계정으로 조회할 수 없는 정보입니다.',
                                404: '대상을 찾을 수 없습니다.', 422: '조회 조건을 확인하세요.'}
                    raise ValueError(messages.get(response.status_code, f'사이트 조회 실패 (HTTP {response.status_code}).'))
                chunks, size = [], 0
                async for chunk in response.aiter_bytes():
                    size += len(chunk)
                    if size > MAX_RESPONSE_BYTES:
                        raise ValueError('조회 결과가 8MB를 초과합니다. 기간·검색 조건 또는 페이지 크기를 줄이세요.')
                    chunks.append(chunk)
                raw = b''.join(chunks)
                if 'application/json' in response.headers.get('content-type', ''):
                    return scrub(json.loads(raw))
                if 'text/csv' in response.headers.get('content-type', ''):
                    return {'mime_type': 'text/csv', 'text': raw.decode('utf-8-sig'),
                            'truncated': response.headers.get('x-result-truncated', 'false') == 'true',
                            'row_count': response.headers.get('x-row-count')}
                raise ValueError('지원하지 않는 사이트 응답 형식입니다.')

    async def call(self, name, arguments):
        entry = self.tools.get(name)
        if entry is None:
            raise ValueError('등록되지 않은 조회 도구입니다.')
        if not isinstance(arguments, dict) or not Draft202012Validator(entry['inputSchema']).is_valid(arguments):
            raise ValueError('조회 입력 형식이 도구 스키마와 맞지 않습니다.')
        route, query = entry['path'], {}
        for key, location in entry['locations'].items():
            if key not in arguments or arguments[key] is None:
                continue
            value = arguments[key]
            if location == 'path':
                text = str(value)
                if not re.fullmatch(r'[A-Za-z0-9_가-힣-]+', text):
                    raise ValueError('잘못된 대상 식별자입니다.')
                if key == 'table_name':
                    if text.lower().startswith(('_', 'sqlite_')):
                        raise ValueError('내부 시스템 테이블은 조회할 수 없습니다.')
                    tables = await self.request('GET', '/api/tables')
                    if text not in {t['name'] for t in tables.get('tables', [])}:
                        raise ValueError('조회 가능한 테이블 목록에 없는 대상입니다.')
                route = route.replace('{' + key + '}', quote(text, safe=''))
            else:
                query[key] = str(value).lower() if isinstance(value, bool) else value
        kwargs = {'params': query}
        if entry['encoding'] == 'json':
            kwargs['json'] = arguments['body']
        elif entry['encoding'] == 'multipart':
            try:
                data = base64.b64decode(arguments['file_base64'], validate=True)
            except Exception:
                raise ValueError('파일 내용은 올바른 Base64여야 합니다.') from None
            filename = arguments['filename']
            if len(data) > 5 * 1024 * 1024 or not re.fullmatch(r'[^/\\\x00-\x1f]+\.(xlsx|csv)', filename, re.I):
                raise ValueError('5MB 이하의 CSV 또는 XLSX 파일만 지원합니다.')
            kwargs['files'] = {'file': (filename, data, 'application/octet-stream')}
            kwargs['data'] = {k: v for k, v in arguments.items() if k not in ('filename', 'file_base64')}
        return await self.request(entry['method'], route, **kwargs)
