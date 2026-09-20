"""학생의 기존 학습 기록에서 비어 있는 항목만 안전하게 보완한다."""
from datetime import datetime, timedelta
from typing import List, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from jose import jwt
from pydantic import BaseModel, Field, StrictInt, StrictStr

from auth import get_current_user
from config import settings
from database import (get_db_connection, write_audit_log,
                      _attach_student_record_coverage, _STUDENT_RECORD_WHITESPACE)
from studylog_permissions import mutation_permission
from teacher_assignment import fingerprint

router = APIRouter(prefix='/api/user/studylog-completion')
FIELDS = {'teacher': 'ActualTeacherUsername', 'content': 'LessonContent'}
STAFF_ROLES = ('admin', 'subadmin', 'manager')


class CompletionRequest(BaseModel):
    field: Literal['teacher', 'content']
    value: StrictStr
    token: StrictStr

    class Config:
        extra = 'forbid'


class CompletionRecord(BaseModel):
    row_id: StrictInt = Field(..., gt=0)
    token: StrictStr

    class Config:
        extra = 'forbid'


class BulkTeacherRequest(BaseModel):
    teacher_username: StrictStr
    records: List[CompletionRecord] = Field(..., min_length=1, max_length=50)

    class Config:
        extra = 'forbid'


def _authorize_field(user, field):
    if user.get('role') not in STAFF_ROLES + ('teacher',):
        raise HTTPException(status_code=403, detail='학습 기록을 보완할 권한이 없습니다.')
    if field == 'teacher' and user.get('role') not in STAFF_ROLES:
        raise HTTPException(status_code=403, detail='실제 진행 선생님 지정은 관리 선생님에게 요청해 주세요.')


def _student_by_rowid(conn, student_id):
    row = conn.execute('SELECT rowid AS row_id, * FROM "Students" WHERE rowid=?', (student_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail='학생을 찾을 수 없습니다.')
    student = dict(row)
    aliases = (student['row_id'], student.get('Id'))
    if conn.execute('SELECT 1 FROM "Students" WHERE rowid != ? AND (rowid IN (?,?) OR "Id" IN (?,?))',
                    (student['row_id'], *aliases, *aliases)).fetchone():
        raise HTTPException(status_code=409, detail='학생 식별자가 중복되어 보완할 수 없습니다. 관리자에게 확인을 요청해 주세요.')
    return student


def _student_for_record(conn, record):
    rows = conn.execute('SELECT rowid AS row_id FROM "Students" WHERE rowid=? OR "Id"=?',
                        (record['StudentId'], record['StudentId'])).fetchall()
    if len(rows) != 1:
        raise HTTPException(status_code=409, detail='학생을 확인할 수 없거나 학생 식별자가 중복됩니다.')
    return _student_by_rowid(conn, rows[0]['row_id'])


def _visibility(conn, student, user):
    """학습 기록 검색과 동일한 소속 학생·실제 진행·연결 수업 기준을 사용한다."""
    if user['role'] in STAFF_ROLES:
        return '1=1', []
    username = user['username']
    assigned = conn.execute('''SELECT 1 FROM "ClassStudents" cs JOIN "Classes" c ON c."Id"=cs."ClassId"
        WHERE c."TeacherUsername"=? AND cs."StudentId" IN (?,?) LIMIT 1''',
        (username, student['row_id'], student.get('Id'))).fetchone()
    if assigned:
        return '1=1', []
    return '''(TRIM(sl."ActualTeacherUsername")=? OR
        (COALESCE(TRIM(sl."ActualTeacherUsername"), '')='' AND EXISTS (
         SELECT 1 FROM "Classes" own_class WHERE own_class."Id"=sl."ClassId"
         AND own_class."TeacherUsername"=?)))''', [username, username]


def _class(conn, record):
    row = conn.execute('SELECT * FROM "Classes" WHERE "Id"=?', (record.get('ClassId'),)).fetchone()
    return dict(row) if row else {}


def _blocked(conn, record, row_id, user, target_teacher=''):
    blocked = mutation_permission(conn, record, row_id, user)
    if blocked:
        return blocked
    day = str(record.get('StudiedDay') or '')
    try:
        if datetime.strptime(day, '%Y-%m-%d').strftime('%Y-%m-%d') != day:
            raise ValueError()
    except ValueError:
        return 409, '학습 일자를 확인해 주세요.'
    if conn.execute('SELECT 1 FROM "TeacherPayrollLines" WHERE "StudyLogId"=?', (row_id,)).fetchone():
        return 409, '정산이 마감된 학습 기록은 이 화면에서 보완할 수 없습니다.'
    teachers = {str(record.get('ActualTeacherUsername') or '').strip(),
                str(_class(conn, record).get('TeacherUsername') or '').strip(), target_teacher}
    for teacher in teachers - {''}:
        if conn.execute('SELECT 1 FROM "TeacherPayrollClosures" WHERE "PayrollMonth"=? AND "TeacherUsername"=?',
                        (day[:7], teacher)).fetchone():
            return 409, '기존 또는 선택한 선생님의 해당 월 정산이 마감되어 보완할 수 없습니다.'
    return None


def _stamp(conn, record, student):
    # 수업 담당자가 바뀐 경우에도 이전 화면의 판단으로 저장하지 않는다.
    return fingerprint({'record': record, 'class': _class(conn, record),
                        'student': {'row_id': student['row_id'], 'Id': student.get('Id')}})


@router.get('')
def get_completion_records(student_id: int = Query(..., gt=0),
                           field: Literal['teacher', 'content'] = 'content',
                           page: int = Query(1, ge=1), limit: int = Query(30, ge=1, le=50),
                           current_user=Depends(get_current_user)):
    _authorize_field(current_user, field)
    conn = get_db_connection()
    try:
        conn.execute('BEGIN')
        student = _student_by_rowid(conn, student_id)
        visible, visible_params = _visibility(conn, student, current_user)
        student_where = '(sl."StudentId"=? OR sl."StudentId"=?)'
        aliases = [student['row_id'], student.get('Id')]
        if current_user['role'] == 'teacher' and visible != '1=1' and not conn.execute(
                f'SELECT 1 FROM "StudyLogs" sl WHERE {student_where} AND {visible} LIMIT 1',
                aliases + visible_params).fetchone():
            raise HTTPException(status_code=403, detail='본인 수업에 소속되었거나 본인이 진행한 기록이 있는 학생만 조회할 수 있습니다.')
        _attach_student_record_coverage(conn, [student])
        column = FIELDS[field]
        where = f'{student_where} AND {visible} AND TRIM(COALESCE(sl."{column}", \'\'), ?)=\'\''
        params = aliases + visible_params + [_STUDENT_RECORD_WHITESPACE]
        total = conn.execute(f'SELECT COUNT(*) FROM "StudyLogs" sl WHERE {where}', params).fetchone()[0]
        records = conn.execute(f'''SELECT sl.rowid AS row_id, sl.* FROM "StudyLogs" sl WHERE {where}
            ORDER BY sl."StudiedDay" DESC, sl.rowid DESC LIMIT ? OFFSET ?''', params + [limit, (page - 1) * limit]).fetchall()
        results = []
        for row in records:
            record = dict(row)
            row_id = record.pop('row_id')
            blocked = _blocked(conn, record, row_id, current_user)
            books = conn.execute('SELECT "Title" FROM "Books" WHERE rowid=? OR "Id"=?',
                                 (record.get('BookId'), record.get('BookId'))).fetchall()
            token = '' if blocked else jwt.encode({
                'purpose': 'studylog-completion', 'actor': current_user['username'], 'field': field,
                'row_id': row_id, 'fingerprint': _stamp(conn, record, student),
                'exp': datetime.utcnow() + timedelta(minutes=30)}, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
            results.append({'row_id': row_id, 'StudiedDay': record.get('StudiedDay') or '',
                            'ClassName': _class(conn, record).get('ClassName') or '수업 미연결',
                            'BookTitle': books[0]['Title'] if len(books) == 1 else '도서 확인 필요',
                            'ActualTeacherUsername': record.get('ActualTeacherUsername') or '',
                            'LessonContent': record.get('LessonContent') or '',
                            'CanEdit': blocked is None, 'MutationBlockedReason': blocked[1] if blocked else '',
                            'token': token})
        teachers = [dict(row) for row in conn.execute('''SELECT username, name FROM _app_users
            WHERE role IN ('teacher','manager','subadmin') ORDER BY name, username''')] if current_user['role'] in STAFF_ROLES else []
        return {'student': {'row_id': student['row_id'], 'Name': student['Name']},
                'coverage': student['RecordCoverage'], 'page': page, 'limit': limit,
                'total_count': total, 'total_pages': max(1, (total + limit - 1) // limit),
                'rows': results, 'teachers': teachers}
    finally:
        conn.close()


def _decode_completion_token(token, row_id, field, user):
    try:
        claim = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        if (claim.get('purpose') != 'studylog-completion' or claim.get('actor') != user['username']
                or claim.get('row_id') != row_id or claim.get('field') != field):
            raise ValueError()
        return claim
    except Exception:
        raise HTTPException(status_code=400, detail='조회가 만료되었거나 유효하지 않습니다. 목록을 다시 불러와 주세요.')


def _validate_completion_record(conn, row_id, field, value, claim, user):
    row = conn.execute('SELECT * FROM "StudyLogs" WHERE rowid=?', (row_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail='학습 기록을 찾을 수 없습니다.')
    record = dict(row)
    student = _student_for_record(conn, record)
    visible, params = _visibility(conn, student, user)
    if not conn.execute(f'SELECT 1 FROM "StudyLogs" sl WHERE sl.rowid=? AND {visible}', [row_id] + params).fetchone():
        raise HTTPException(status_code=403, detail='이 학습 기록을 조회·보완할 권한이 없습니다.')
    if claim.get('fingerprint') != _stamp(conn, record, student):
        raise HTTPException(status_code=409, detail='조회 이후 기록 또는 수업 정보가 변경되었습니다. 목록을 다시 불러와 주세요.')
    column = FIELDS[field]
    if str(record.get(column) or '').strip(_STUDENT_RECORD_WHITESPACE):
        raise HTTPException(status_code=409, detail='이미 입력된 항목은 덮어쓸 수 없습니다. 목록을 다시 불러와 주세요.')
    if field == 'teacher' and not conn.execute('''SELECT 1 FROM _app_users
            WHERE username=? AND role IN ('teacher','manager','subadmin')''', (value,)).fetchone():
        raise HTTPException(status_code=400, detail='실제 진행 선생님 계정을 확인해 주세요.')
    blocked = _blocked(conn, record, row_id, user, value if field == 'teacher' else '')
    if blocked:
        raise HTTPException(status_code=blocked[0], detail=blocked[1])
    return record


def _write_completion(conn, row_id, field, value, record, user, request):
    column = FIELDS[field]
    conn.execute(f'UPDATE "StudyLogs" SET "{column}"=?, "UpdatedBy"=?, "UpdatedAt"=? WHERE rowid=?',
                 (value, user['username'], datetime.now().strftime('%Y-%m-%d %H:%M:%S'), row_id))
    updated = dict(conn.execute('SELECT * FROM "StudyLogs" WHERE rowid=?', (row_id,)).fetchone())
    changed = [key for key in updated if updated[key] != record.get(key)]
    write_audit_log('StudyLogs', row_id, 'UPDATE', record, updated, changed,
                    user['username'], user['role'],
                    request.client.host if request.client else '', connection=conn)


@router.post('/bulk-teacher')
def save_bulk_teacher(payload: BulkTeacherRequest, request: Request,
                      current_user=Depends(get_current_user)):
    """선택한 빈 항목을 한 트랜잭션으로 지정한다. 부분 성공은 허용하지 않는다."""
    _authorize_field(current_user, 'teacher')
    value = payload.teacher_username.strip(_STUDENT_RECORD_WHITESPACE)
    if not value or len(value) > 10000:
        raise HTTPException(status_code=400, detail='실제 진행 선생님을 선택해 주세요.')
    ids = [item.row_id for item in payload.records]
    if len(ids) != len(set(ids)):
        raise HTTPException(status_code=400, detail='같은 학습 기록을 중복하여 선택할 수 없습니다.')
    conn = get_db_connection()
    try:
        conn.execute('BEGIN IMMEDIATE')
        validated = []
        for item in payload.records:
            try:
                claim = _decode_completion_token(item.token, item.row_id, 'teacher', current_user)
                record = _validate_completion_record(conn, item.row_id, 'teacher', value, claim, current_user)
                validated.append((item.row_id, record))
            except HTTPException as exc:
                raise HTTPException(status_code=exc.status_code,
                                    detail=f'기록 #{item.row_id}: {exc.detail} 전체 적용을 취소했습니다.')
        for row_id, record in validated:
            _write_completion(conn, row_id, 'teacher', value, record, current_user, request)
        conn.commit()
        return {'status': 'success', 'updated_count': len(validated),
                'message': f'{len(validated)}건의 실제 진행 선생님을 지정했습니다.'}
    except HTTPException:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise HTTPException(status_code=500, detail='저장하지 못했습니다. 전체 변경 사항은 취소되었으니 다시 시도해 주세요.')
    finally:
        conn.close()


@router.post('/{row_id}')
def save_completion(row_id: int, payload: CompletionRequest, request: Request,
                    current_user=Depends(get_current_user)):
    _authorize_field(current_user, payload.field)
    value = payload.value.strip(_STUDENT_RECORD_WHITESPACE)
    if not value or len(value) > 10000:
        raise HTTPException(status_code=400, detail='보완할 내용을 1~10,000자로 입력해 주세요.')
    claim = _decode_completion_token(payload.token, row_id, payload.field, current_user)
    conn = get_db_connection()
    try:
        conn.execute('BEGIN IMMEDIATE')
        record = _validate_completion_record(conn, row_id, payload.field, value, claim, current_user)
        _write_completion(conn, row_id, payload.field, value, record, current_user, request)
        conn.commit()
        return {'status': 'success', 'message': '미입력 항목을 보완했습니다.'}
    except HTTPException:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise HTTPException(status_code=500, detail='저장하지 못했습니다. 변경 사항은 취소되었으니 다시 시도해 주세요.')
    finally:
        conn.close()
