"""MCP 전용 자격 증명. 원문은 발급 응답에서만 한 번 반환한다."""
import hashlib
import hmac
import json
import re
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
import database

PREFIX = 'bgmcp_'
_INTERNAL_MARKER = object()
_SCOPE_KEY = 'bg.mcp.internal.read'
_catalog = json.loads(Path(__file__).with_name('mcp_catalog.json').read_text(encoding='utf-8'))
_READ_ROUTES = tuple((item['method'], re.compile('^' + re.sub(r'\{[^}]+\}', r'[^/]+', item['path']) + '$')) for item in _catalog)


def internal_read_allowed(scope):
    return (scope.get(_SCOPE_KEY) is _INTERNAL_MARKER and
            any(scope.get('method') == method and pattern.fullmatch(scope.get('path', ''))
                for method, pattern in _READ_ROUTES))


class InternalReadApp:
    """HTTP 헤더가 아닌 프로세스 내부 객체로 고정 조회 경로만 인증한다."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        from starlette.responses import JSONResponse
        scope = dict(scope)
        scope[_SCOPE_KEY] = _INTERNAL_MARKER
        if not internal_read_allowed(scope):
            await JSONResponse({'detail': 'MCP 조회 경로가 아닙니다.'}, status_code=403)(scope, receive, send)
            return
        await self.app(scope, receive, send)


class TokenNoStoreMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        # 인증 의존성이 없는 공개 API까지 전용 토큰의 직접 사용을 막는다.
        if scope.get('path', '').startswith('/api/') and not internal_read_allowed(scope):
            for key, value in scope.get('headers', []):
                if key.lower() == b'authorization':
                    scheme, _, credential = value.decode('latin-1').partition(' ')
                    if scheme.lower() == 'bearer' and credential.startswith(PREFIX):
                        from starlette.responses import JSONResponse
                        await JSONResponse({'detail': 'MCP 전용 토큰은 /mcp에서만 사용할 수 있습니다.'},
                                           status_code=401, headers={'Cache-Control': 'no-store', 'WWW-Authenticate': 'Bearer'})(scope, receive, send)
                        return
        async def no_store(message):
            if message['type'] == 'http.response.start':
                message = dict(message)
                message['headers'] = [(k, v) for k, v in message.get('headers', []) if k.lower() != b'cache-control'] + [(b'cache-control', b'no-store')]
            await send(message)
        await self.app(scope, receive, no_store if scope.get('path', '').rstrip('/') == '/api/user/mcp-token' else send)


def init_mcp_token_tables():
    conn = database.get_db_connection()
    try:
        conn.execute('''CREATE TABLE IF NOT EXISTS _app_mcp_tokens (
            user_id INTEGER PRIMARY KEY, username TEXT NOT NULL,
            token_hash TEXT NOT NULL UNIQUE, password_fingerprint TEXT NOT NULL,
            created_at TEXT NOT NULL, expires_at TEXT NOT NULL)''')
        conn.execute('''CREATE TRIGGER IF NOT EXISTS _app_mcp_password_revoke
            AFTER UPDATE OF password_hash ON _app_users
            WHEN OLD.password_hash IS NOT NEW.password_hash
            BEGIN DELETE FROM _app_mcp_tokens WHERE user_id=OLD.id; END''')
        conn.execute('''CREATE TRIGGER IF NOT EXISTS _app_mcp_account_revoke
            AFTER DELETE ON _app_users
            BEGIN DELETE FROM _app_mcp_tokens WHERE user_id=OLD.id; END''')
        conn.commit()
    finally:
        conn.close()


def _now():
    return datetime.now(timezone.utc)


def _fingerprint(user):
    return hashlib.sha256(('mcp-password:' + user['password_hash']).encode()).hexdigest()


def _valid(row, user):
    return bool(row and user and row['user_id'] == user['id'] and row['username'] == user['username'] and
                hmac.compare_digest(row['password_fingerprint'], _fingerprint(user)) and
                datetime.fromisoformat(row['expires_at']) > _now())


def _unauthorized():
    return HTTPException(401, 'MCP 토큰이 만료되었거나 유효하지 않습니다.', headers={'WWW-Authenticate': 'Bearer'})


def authenticate_mcp_token(token):
    if not re.fullmatch(r'bgmcp_[A-Za-z0-9_-]{43}', token):
        raise _unauthorized()
    conn = database.get_db_connection()
    try:
        row = conn.execute('SELECT * FROM _app_mcp_tokens WHERE token_hash=?', (hashlib.sha256(token.encode()).hexdigest(),)).fetchone()
        user = conn.execute('SELECT * FROM _app_users WHERE id=? AND username=?', (row['user_id'], row['username'])).fetchone() if row else None
        if not _valid(row, user):
            raise _unauthorized()
        return dict(user)
    finally:
        conn.close()


def _metadata(row, user, enabled):
    return {'enabled': bool(enabled), 'active': _valid(row, user),
            'created_at': row['created_at'] if row else None,
            'expires_at': row['expires_at'] if row else None}


class Confirmation(BaseModel):
    confirmation: str

    class Config:
        extra = 'forbid'


from auth import get_current_user
# 인증정보 관리 경로는 공개 업무 조회 카탈로그 생성 대상에서 제외한다.
router = APIRouter(include_in_schema=False)


@router.get('/api/user/mcp-token')
def token_status(request: Request, user=Depends(get_current_user)):
    conn = database.get_db_connection()
    try:
        row = conn.execute('SELECT * FROM _app_mcp_tokens WHERE user_id=?', (user['id'],)).fetchone()
        return _metadata(row, user, getattr(request.app.state, 'mcp_http_enabled', False))
    finally:
        conn.close()


def _change(request, user, issue):
    enabled = getattr(request.app.state, 'mcp_http_enabled', False)
    if issue and not enabled:
        raise HTTPException(503, 'MCP 연결 기능이 비활성화되어 있습니다.')
    conn = database.get_db_connection()
    try:
        conn.execute('BEGIN IMMEDIATE')
        current = conn.execute('SELECT * FROM _app_users WHERE id=? AND username=?', (user['id'], user['username'])).fetchone()
        if current is None or current['password_hash'] != user['password_hash']:
            raise _unauthorized()
        old = conn.execute('SELECT * FROM _app_mcp_tokens WHERE user_id=?', (user['id'],)).fetchone()
        before = _metadata(old, current, enabled)
        conn.execute('DELETE FROM _app_mcp_tokens WHERE user_id=?', (user['id'],))
        token = None
        if issue:
            token = PREFIX + secrets.token_urlsafe(32)
            now = _now()
            conn.execute('INSERT INTO _app_mcp_tokens VALUES (?,?,?,?,?,?)',
                         (user['id'], user['username'], hashlib.sha256(token.encode()).hexdigest(),
                          _fingerprint(current), now.isoformat(), (now + timedelta(days=30)).isoformat()))
        row = conn.execute('SELECT * FROM _app_mcp_tokens WHERE user_id=?', (user['id'],)).fetchone()
        result = _metadata(row, current, enabled)
        database.write_audit_log('_app_mcp_tokens', user['id'], 'UPDATE' if old and issue else ('INSERT' if issue else 'DELETE'),
                                 before, result, None, current['username'], current['role'],
                                 request.client.host if request.client else '', connection=conn)
        conn.commit()
        if token:
            result['token'] = token
        return result
    except HTTPException:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise HTTPException(500, 'MCP 토큰 변경을 저장하지 못했습니다. 다시 시도하세요.') from None
    finally:
        conn.close()


@router.post('/api/user/mcp-token')
def issue_token(body: Confirmation, request: Request, user=Depends(get_current_user)):
    if body.confirmation != 'MCP 토큰 발급':
        raise HTTPException(400, '발급 확인 문구가 일치하지 않습니다.')
    return _change(request, user, True)


@router.delete('/api/user/mcp-token')
def revoke_token(body: Confirmation, request: Request, user=Depends(get_current_user)):
    if body.confirmation != 'MCP 토큰 폐기':
        raise HTTPException(400, '폐기 확인 문구가 일치하지 않습니다.')
    return _change(request, user, False)
