"""관리자용 MCP 조회 전용 SQL 경계. 운영 DB 초기화나 쓰기 연결을 사용하지 않는다."""
import base64
import csv
import io
import re
import sqlite3
import time
from pathlib import Path
from typing import Any, Dict, List, Union

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field

from auth import get_current_admin
from config import settings

router = APIRouter(prefix="/api/admin/mcp/sql", tags=["MCP 읽기 전용"])
MAX_ROWS = 1000
MAX_SECONDS = 2.0
MAX_OPERATIONS = 1_000_000
PROGRESS_INTERVAL = 1000
MAX_RESULT_BYTES = 4 * 1024 * 1024
MAX_VALUE_BYTES = 1024 * 1024
# 확장 기능, 파일 접근, 가상 테이블 확장을 통한 우회는 허용하지 않는다.
SAFE_FUNCTIONS = frozenset('''abs avg char coalesce concat concat_ws count cume_dist
 date datetime dense_rank exp first_value floor glob group_concat hex ifnull
 iif instr json json_array json_array_length json_error_position json_extract
 json_group_array json_group_object json_insert json_object json_patch json_quote
 json_remove json_replace json_set json_type json_valid julianday lag last_value
 lead length like likelihood likely ln log log10 log2 lower ltrim max min mod
 nth_value ntile nullif percent_rank pi pow power quote radians rank replace
 round row_number rtrim sign sin cos tan sqrt strftime string_agg substr substring
 sum time timediff total trim trunc typeof unicode unixepoch unlikely upper
 random sqlite_version sqlite_source_id'''.split())
_ALLOWED_ACTIONS = frozenset((sqlite3.SQLITE_SELECT, sqlite3.SQLITE_READ,
                              sqlite3.SQLITE_FUNCTION, sqlite3.SQLITE_RECURSIVE))


class ReadQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sql: str = Field(min_length=1, max_length=50_000)
    limit: int = Field(default=MAX_ROWS, ge=1, le=MAX_ROWS, strict=True)
    parameters: Union[List[Any], Dict[str, Any]] = Field(default_factory=list)


def _authorize(action, arg1, arg2, database_name, source):
    if action not in _ALLOWED_ACTIONS:
        return sqlite3.SQLITE_DENY
    if action == sqlite3.SQLITE_READ:
        name = (arg1 or '').lower()
        if database_name not in ('main', None) or name.startswith(('_app_', 'sqlite_')):
            return sqlite3.SQLITE_DENY
    if action == sqlite3.SQLITE_FUNCTION and (arg2 or arg1 or '').lower() not in SAFE_FUNCTIONS:
        return sqlite3.SQLITE_DENY
    return sqlite3.SQLITE_OK


def _cell(value):
    if isinstance(value, bytes):
        return 'base64:' + base64.b64encode(value).decode('ascii')
    # JSON 표준으로 표현할 수 없는 무한대도 안전하게 문자열로 반환한다.
    if isinstance(value, float) and (value != value or abs(value) == float('inf')):
        return str(value)
    return value


def execute_read_query(request: ReadQuery):
    sql_head = re.sub(r'\A(?:\s+|--[^\n]*(?:\n|$)|/\*[\s\S]*?\*/)*', '', request.sql)
    if not re.match(r'(SELECT|WITH)\b', sql_head, re.IGNORECASE):
        raise HTTPException(400, 'SELECT 또는 읽기 전용 CTE만 사용할 수 있습니다.')
    connection = None
    cursor = None
    started = time.monotonic()
    operations = 0

    def progress():
        nonlocal operations
        operations += PROGRESS_INTERVAL
        return int(operations >= MAX_OPERATIONS or time.monotonic() - started >= MAX_SECONDS)

    try:
        uri = Path(settings.SQLITE_DB_PATH).resolve().as_uri() + '?mode=ro'
        connection = sqlite3.connect(uri, uri=True, timeout=0.25)
        connection.execute('PRAGMA query_only=ON')
        connection.execute('PRAGMA trusted_schema=OFF')
        # Python 3.9에서도 동작하며, 3.11 이상은 SQLite 자체 크기 제한도 적용한다.
        if hasattr(connection, 'setlimit'):
            connection.setlimit(sqlite3.SQLITE_LIMIT_LENGTH, MAX_VALUE_BYTES)
            connection.setlimit(sqlite3.SQLITE_LIMIT_SQL_LENGTH, 50_000)
            connection.setlimit(sqlite3.SQLITE_LIMIT_COLUMN, 256)
            connection.setlimit(sqlite3.SQLITE_LIMIT_EXPR_DEPTH, 100)
            connection.setlimit(sqlite3.SQLITE_LIMIT_COMPOUND_SELECT, 50)
        connection.set_authorizer(_authorize)
        connection.set_progress_handler(progress, PROGRESS_INTERVAL)
        cursor = connection.execute(request.sql, request.parameters)
        if cursor.description is None:
            raise HTTPException(400, '조회 결과가 있는 SQL만 사용할 수 있습니다.')
        columns = [column[0] for column in cursor.description]
        rows = []
        size = sum(len(column.encode('utf-8')) for column in columns)
        truncated = False
        for raw in cursor:
            if time.monotonic() - started >= MAX_SECONDS:
                raise HTTPException(400, '조회 실행 제한을 초과했습니다.')
            if len(rows) >= request.limit:
                truncated = True
                break
            row = [_cell(value) for value in raw]
            size += sum(len(str(value).encode('utf-8')) for value in row)
            if size > MAX_RESULT_BYTES:
                raise HTTPException(400, '조회 결과 크기 제한을 초과했습니다.')
            rows.append(row)
        return {'columns': columns, 'rows': rows, 'row_count': len(rows), 'truncated': truncated}
    except (sqlite3.Error, sqlite3.Warning, ValueError, TypeError, OverflowError):
        # SQL, 경로, 내부 스키마, 바인딩 값이나 원본 오류를 응답에 포함하지 않는다.
        raise HTTPException(400, '읽기 전용 SQL을 실행할 수 없거나 조회 제한을 초과했습니다.') from None
    finally:
        if cursor is not None:
            cursor.close()
        if connection is not None:
            connection.close()


@router.post('/query')
def query(request: ReadQuery, current_user=Depends(get_current_admin)):
    return execute_read_query(request)


def _csv_cell(value):
    # 스프레드시트에서 데이터가 수식으로 실행되지 않도록 문자열을 보호한다.
    if isinstance(value, str) and (value.lstrip().startswith(('=', '+', '-', '@')) or value.startswith(('\t', '\r', '\n'))):
        return "'" + value
    return value


@router.post('/export-csv')
def export_csv(request: ReadQuery, current_user=Depends(get_current_admin)):
    result = execute_read_query(request)
    output = io.StringIO(newline='')
    writer = csv.writer(output)
    writer.writerow([_csv_cell(value) for value in result['columns']])
    writer.writerows([_csv_cell(value) for value in row] for row in result['rows'])
    return Response(content=('\ufeff' + output.getvalue()).encode('utf-8'),
                    media_type='text/csv; charset=utf-8', headers={
                        'Content-Disposition': 'attachment; filename="mcp-query.csv"',
                        'X-Row-Count': str(result['row_count']),
                        'X-Result-Truncated': str(result['truncated']).lower(),
                    })
