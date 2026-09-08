"""사용자 활동 기록. 기여량을 계산하는 변경 이력과 독립적으로 관리한다."""
import json
import logging
import time
from datetime import date, datetime, timedelta, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from auth import get_current_admin, get_current_user
from database import get_db_connection

logger = logging.getLogger("uvicorn.error")
router = APIRouter()
EVENTS = {
    "LOGIN": "로그인", "LOGOUT": "로그아웃", "VIEW": "화면 진입",
    "SEARCH": "직접 검색", "LIST": "목록 조회", "DETAIL": "상세 조회",
    "CREATE": "등록 요청", "UPDATE": "수정 요청", "DELETE": "삭제 요청",
    "EXPORT": "내보내기", "IMPORT": "가져오기", "EXECUTE": "업무 실행",
    "AUDIT_READ": "이력 조회", "REQUEST": "기타 요청",
}
AREAS = {
    "auth": "접속", "books": "도서", "students": "학생", "studylogs": "학습 기록",
    "classes": "수업", "monthly-report": "월말보고",
    "payroll": "급여", "tuition-payments": "수업료", "tuition-fee-settings": "수업료 설정",
    "book-material-requests": "도서·자료 요청", "book-material-rates": "자료 제작 단가",
    "consultations": "상담", "utilities": "유틸리티", "tables": "데이터 Studio",
    "sql": "SQL", "users": "계정", "audit-logs": "변경 이력", "activity-logs": "활동 이력",
    "screen": "화면", "other": "기타",
}
# 화면 이름만 허용하며 자유 입력 텍스트는 수집하지 않는다.
VIEWS = {
    "book-search", "student-search", "studylog-search", "book-reg", "student-reg",
    "studylog-reg", "class-list", "class-reg", "class-rate-settings", "class-studylog-reg",
    "monthly-report", "teacher-payroll", "tuition-payment", "tuition-payment-search",
    "tuition-fee-settings", "book-material-request", "book-material-review", "book-material-rates",
    "utilities", "audit-log", "activity-log", "data-view", "sql-console", "user-manage",
}
FILTER_KEYS = {"q", "page", "limit", "sex", "grade", "date_from", "date_to", "month",
               "student_id", "book_id", "class_id", "teacher_username", "username", "status",
               "subject", "study_class", "include_ended", "is_special", "action", "table_name",
               "studied_day", "target", "voca_min", "voca_max", "length_min", "length_max",
               "has_quiz", "has_reading", "has_writing", "has_pdf", "pdf_status", "has_advanced", "has_debate",
               "has_paperbook", "has_yes24", "has_millie", "unstudied_student_ids"}


def init_activity_tables():
    conn = get_db_connection()
    try:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS _app_activity_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL,
                user_id INTEGER, username TEXT NOT NULL DEFAULT '', user_role TEXT NOT NULL DEFAULT '',
                attempted_username TEXT NOT NULL DEFAULT '', session_id TEXT NOT NULL DEFAULT '',
                request_id TEXT NOT NULL UNIQUE, event TEXT NOT NULL, area TEXT NOT NULL,
                target_id TEXT NOT NULL DEFAULT '', route TEXT NOT NULL DEFAULT '',
                method TEXT NOT NULL, status_code INTEGER NOT NULL, duration_ms INTEGER NOT NULL,
                source TEXT NOT NULL DEFAULT 'server', metadata TEXT NOT NULL DEFAULT '{}'
            );
            CREATE INDEX IF NOT EXISTS idx_activity_time ON _app_activity_logs(created_at, id);
            CREATE INDEX IF NOT EXISTS idx_activity_user_time ON _app_activity_logs(username, created_at);
            CREATE INDEX IF NOT EXISTS idx_activity_event_time ON _app_activity_logs(event, created_at);
        """)
        conn.commit()
    finally:
        conn.close()


def write_activity(values):
    """응답을 바꾸지 않으며 저장 실패는 운영 로그에 남긴다. 본문·토큰은 받지 않는다."""
    conn = None
    try:
        conn = get_db_connection()
        conn.execute("PRAGMA busy_timeout=250")
        columns = list(values)
        conn.execute('INSERT INTO _app_activity_logs (' + ','.join(columns) + ') VALUES (' +
                     ','.join('?' for _ in columns) + ')', list(values.values()))
        # 매 요청 최대 100건만 정리하여 오래 실행되는 삭제를 피한다. 변경 이력은 건드리지 않는다.
        cutoff = (datetime.now(timezone.utc) - timedelta(days=180)).strftime('%Y-%m-%d %H:%M:%S.%f')
        conn.execute("DELETE FROM _app_activity_logs WHERE id IN "
                     "(SELECT id FROM _app_activity_logs WHERE created_at < ? ORDER BY created_at LIMIT 100)",
                     (cutoff,))
        conn.commit()
    except Exception:
        logger.error("사용자 활동 이력 저장 실패 (요청 ID: %s)", values.get('request_id'), exc_info=True)
    finally:
        if conn is not None:
            conn.close()


def describe_request(request):
    route = getattr(request.scope.get('route'), 'path', '')
    if not route.startswith('/api/'):
        return None
    parts = route.strip('/').split('/')
    leaf = parts[-1]
    if route == '/api/auth/login':
        return 'LOGIN', 'auth', route
    if route == '/api/auth/logout':
        return 'LOGOUT', 'auth', route
    if route == '/api/user/activity-events':
        return 'VIEW', 'screen', route
    area = parts[2] if len(parts) > 2 and parts[1] in ('user', 'admin') else parts[1]
    if area == 'monthly-reports':
        area = 'monthly-report'
    area = area if area in AREAS else 'other'
    if 'export' in leaf:
        event = 'EXPORT'
    elif leaf == 'import':
        event = 'IMPORT'
    elif area in ('audit-logs', 'activity-logs'):
        event = 'AUDIT_READ'
    elif area == 'sql' or leaf in ('preview', 'review', 'close', 'merge-duplicate-books', 'transfer-sessions'):
        event = 'EXECUTE'
    elif request.method == 'GET':
        if leaf == 'search' or route == '/api/user/classes':
            event = 'SEARCH' if request.headers.get('X-Activity-Intent') == 'search' else 'LIST'
        else:
            event = 'DETAIL' if request.path_params else 'LIST'
        # 화면 구성 보조 요청은 성공 시 제외한다. 실패는 미들웨어에서 기록한다.
        if leaf in ('me', 'schema', 'similar', 'users') and area != 'users':
            return None
        if 'options' in leaf or leaf.startswith('recent-') or '/picker/' in route:
            return None
    else:
        event = {'POST': 'CREATE', 'PUT': 'UPDATE', 'PATCH': 'UPDATE', 'DELETE': 'DELETE'}.get(request.method, 'REQUEST')
    return event, area, route


async def activity_middleware(request: Request, call_next):
    started = time.perf_counter()
    request.state.activity_request_id = uuid4().hex
    code = 500
    try:
        response = await call_next(request)
        code = response.status_code
        response.headers['X-Request-ID'] = request.state.activity_request_id
        return response
    finally:
        description = describe_request(request)
        if description is None and code >= 400 and request.url.path.startswith('/api/'):
            # 실제 경로/쿼리에는 임의 텍스트가 포함될 수 있으므로 저장하지 않는다.
            description = ('REQUEST', 'other', getattr(request.scope.get('route'), 'path', '/api/unknown'))
        if description:
            event, area, route = description
            user = getattr(request.state, 'activity_user', {})
            metadata = {'filter_keys': sorted(set(request.query_params.keys()) & FILTER_KEYS)}
            source = 'server'
            target = ','.join(str(v)[:80] for k, v in request.path_params.items() if k.endswith('_id'))[:200]
            if event == 'VIEW':
                target = getattr(request.state, 'activity_view', '')
                source = 'client'
            metadata['intent'] = 'search' if event == 'SEARCH' else 'request'
            await run_in_threadpool(write_activity, {
                'created_at': datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S.%f'),
                'user_id': user.get('id'), 'username': user.get('username', ''),
                'user_role': user.get('role', ''),
                'attempted_username': getattr(request.state, 'activity_attempted_username', ''),
                'session_id': getattr(request.state, 'activity_session_id', ''),
                'request_id': request.state.activity_request_id, 'event': event, 'area': area,
                'target_id': target, 'route': route, 'method': request.method,
                'status_code': code, 'duration_ms': round((time.perf_counter() - started) * 1000),
                'source': source, 'metadata': json.dumps(metadata, ensure_ascii=False),
            })


class ActivityView(BaseModel):
    view: str = Field(..., max_length=60)


@router.post('/api/user/activity-events')
def report_view(payload: ActivityView, request: Request, user=Depends(get_current_user)):
    if payload.view not in VIEWS:
        raise HTTPException(422, '올바른 화면을 선택해 주세요.')
    request.state.activity_view = payload.view
    return {'ok': True}


@router.post('/api/auth/logout')
def report_logout(user=Depends(get_current_user)):
    # 클라이언트의 명시적 로그아웃을 기록한다. 기존 JWT 만료 정책은 유지한다.
    return {'ok': True}


@router.get('/api/admin/activity-logs/options')
def activity_options(user=Depends(get_current_admin)):
    conn = get_db_connection()
    try:
        users = [r[0] for r in conn.execute("SELECT username FROM _app_users UNION "
                 "SELECT username FROM _app_activity_logs WHERE username != '' ORDER BY username")]
        return {'users': users, 'events': EVENTS, 'areas': AREAS}
    finally:
        conn.close()


@router.get('/api/admin/activity-logs')
def list_activity_logs(
    username: str = Query('', max_length=200), date_from: date = Query(...), date_to: date = Query(...),
    event: str = '', area: str = '', result: str = '',
    page: int = Query(1, ge=1), limit: int = Query(30, ge=1, le=100), user=Depends(get_current_admin),
):
    if date_from > date_to or (date_to - date_from).days > 179:
        raise HTTPException(422, '조회 기간은 시작일부터 최대 180일 이내로 선택해 주세요.')
    if (event and event not in EVENTS) or (area and area not in AREAS) or result not in ('', 'success', 'failure'):
        raise HTTPException(422, '올바른 활동 필터를 선택해 주세요.')
    # 입력 날짜는 한국 날짜: UTC 기준 반개구간으로 변환한다.
    start = datetime.combine(date_from, datetime.min.time()) - timedelta(hours=9)
    end = datetime.combine(date_to, datetime.min.time()) + timedelta(days=1, hours=-9)
    clauses = ['created_at >= ?', 'created_at < ?']
    params = [start.strftime('%Y-%m-%d %H:%M:%S'), end.strftime('%Y-%m-%d %H:%M:%S')]
    for col, value in [('username', username), ('event', event), ('area', area)]:
        if value:
            clauses.append(col + ' = ?')
            params.append(value)
    if result:
        clauses.append('status_code < 400' if result == 'success' else 'status_code >= 400')
    where = ' WHERE ' + ' AND '.join(clauses)
    conn = get_db_connection()
    try:
        summary = dict(conn.execute("SELECT COUNT(*) AS total, COUNT(DISTINCT NULLIF(username, '')) AS users, "
            "COALESCE(SUM(event='LOGIN' AND status_code<400),0) AS logins, "
            "COALESCE(SUM(status_code>=400),0) AS failures FROM _app_activity_logs" + where, params).fetchone())
        total_pages = max(1, (summary['total'] + limit - 1) // limit)
        page = min(page, total_pages)
        rows = [dict(row) for row in conn.execute('SELECT * FROM _app_activity_logs' + where +
            ' ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?', params + [limit, (page - 1) * limit])]
        for row in rows:
            row['metadata'] = json.loads(row['metadata'])
        return {'items': rows, 'summary': summary, 'page': page, 'total_pages': total_pages}
    finally:
        conn.close()
