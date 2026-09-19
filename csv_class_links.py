"""CSV로 가져온 기존 기록의 수업 연결. 미리보기 후 선택한 항목만 원자적으로 변경한다."""
import json
from datetime import datetime, timedelta
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Request
from jose import jwt
from pydantic import BaseModel, StrictInt

from auth import get_current_staff
from config import settings
from database import get_db_connection, write_audit_log
from teacher_assignment import fingerprint

router = APIRouter(prefix='/api/user/utilities/studylog-csv')


class ClassLinkItem(BaseModel):
    token: str
    class_id: StrictInt


class ClassLinkRequest(BaseModel):
    links: List[ClassLinkItem]


def _run(conn, run_id):
    run = conn.execute('SELECT * FROM _app_studylog_import_runs WHERE id=?', (run_id,)).fetchone()
    if not run:
        raise HTTPException(status_code=404, detail='CSV 실행 이력을 찾을 수 없습니다.')
    return dict(run)


def _imported_rows(run):
    # 실패한 행과 중복 ID는 연결 대상에 포함하지 않는다.
    return {int(row['studylog_id']): row for row in json.loads(run['results_json'] or '[]')
            if row.get('status') == 'success' and row.get('studylog_id')}


def _record(conn, row_id):
    row = conn.execute('SELECT * FROM "StudyLogs" WHERE rowid=?', (row_id,)).fetchone()
    return dict(row) if row else None


def _classes(conn):
    return [dict(row) for row in conn.execute('''
        SELECT c.*, u.name AS teacher_name FROM "Classes" c
        JOIN _app_users u ON u.username=c."TeacherUsername"
        WHERE u.role IN ('teacher', 'manager', 'subadmin')
        ORDER BY u.name, c."ClassName", c."Id"
    ''')]


def _student(conn, student_id):
    rows = conn.execute('SELECT rowid AS row_id, * FROM "Students" WHERE rowid=? OR "Id"=?',
                        (student_id, student_id)).fetchall()
    # 서로 다른 학생의 원본 ID와 rowid가 충돌한 경우 추정하여 연결하지 않는다.
    return dict(rows[0]) if len(rows) == 1 else None


def _blocked_reason(conn, record, row_id):
    if not record:
        return '삭제되었거나 존재하지 않는 기록입니다.'
    if record.get('ClassId'):
        return '이미 수업에 연결된 기록입니다.'
    if record.get('PayrollCategoryId'):
        return '이미 정산 카테고리에 연결된 기록입니다.'
    day = str(record.get('StudiedDay') or '')
    try:
        if datetime.strptime(day, '%Y-%m-%d').strftime('%Y-%m-%d') != day:
            raise ValueError()
    except ValueError:
        return '학습 일자를 확인해 주세요.'
    if not _student(conn, record.get('StudentId')):
        return '학생을 확인할 수 없거나 학생 식별자가 중복됩니다.'
    if conn.execute('SELECT 1 FROM "TeacherPayrollLines" WHERE "StudyLogId"=?', (row_id,)).fetchone():
        return '마감 정산에 포함된 기록입니다.'
    teacher = str(record.get('ActualTeacherUsername') or '').strip()
    if teacher and conn.execute('SELECT 1 FROM "TeacherPayrollClosures" WHERE "PayrollMonth"=? AND "TeacherUsername"=?',
                                (day[:7], teacher)).fetchone():
        return '기존 진행 선생님의 해당 월 정산이 마감되었습니다.'
    return ''


@router.get('/runs/{run_id}/class-links')
def preview_csv_class_links(run_id: int, current_user=Depends(get_current_staff)):
    conn = get_db_connection()
    try:
        conn.execute('BEGIN')
        run = _run(conn, run_id)
        classes = _classes(conn)
        class_stamp = fingerprint(classes)
        class_map = {item['Id']: item for item in classes}
        results = []
        for row_id, source in _imported_rows(run).items():
            record = _record(conn, row_id)
            reason = _blocked_reason(conn, record, row_id)
            student = _student(conn, record['StudentId']) if record else None
            book = conn.execute('SELECT "Title" FROM "Books" WHERE rowid=? OR "Id"=?',
                                (record['BookId'], record['BookId'])).fetchone() if record else None
            current_class = conn.execute('SELECT "ClassName" FROM "Classes" WHERE "Id"=?',
                                         (record.get('ClassId'),)).fetchone() if record else None
            teacher = str((record or {}).get('ActualTeacherUsername') or '').strip()
            suggested = []
            if student and not reason:
                suggested = [row[0] for row in conn.execute('''
                    SELECT DISTINCT "ClassId" FROM "ClassStudents"
                    WHERE "StudentId" IN (?, ?) AND COALESCE("IsSpecial", 0)=?
                ''', (student['row_id'], student['Id'], int(record.get('IsSpecial') or 0)))
                    if row[0] in class_map and (not teacher or class_map[row[0]]['TeacherUsername'] == teacher)]
            token = ''
            if not reason:
                token = jwt.encode({'purpose': 'csv-class-links', 'actor': current_user['username'],
                                    'run_id': run_id, 'row_id': row_id, 'fingerprint': fingerprint(record),
                                    'classes': class_stamp,
                                    'exp': datetime.utcnow() + timedelta(minutes=30)},
                                   settings.SECRET_KEY, algorithm=settings.ALGORITHM)
            results.append({'studylog_id': row_id,
                            'student_name': student['Name'] if student else source.get('student_name', ''),
                            'book_title': book['Title'] if book else source.get('book_title', ''),
                            'studied_day': record['StudiedDay'] if record else source.get('studied_day', ''),
                            'is_special': bool((record or {}).get('IsSpecial')),
                            'current_teacher': teacher, 'class_name': current_class[0] if current_class else '',
                            'reason': reason, 'token': token,
                            'suggested_class_id': suggested[0] if len(suggested) == 1 else None})
        return {'run_id': run_id, 'source_file': run['source_file'], 'total_count': len(results),
                'rows': results, 'classes': [{'id': c['Id'], 'name': c['ClassName'],
                                            'teacher_username': c['TeacherUsername'],
                                            'teacher_name': c['teacher_name'] or c['TeacherUsername']} for c in classes]}
    finally:
        conn.close()


@router.post('/class-links/apply')
def apply_csv_class_links(payload: ClassLinkRequest, request: Request, current_user=Depends(get_current_staff)):
    if not payload.links or len(payload.links) > 500:
        raise HTTPException(status_code=400, detail='연결할 기록을 1~500건 선택해 주세요.')
    claims = []
    try:
        for link in payload.links:
            claim = jwt.decode(link.token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
            if (claim.get('purpose') != 'csv-class-links' or claim.get('actor') != current_user['username']
                    or link.class_id <= 0):
                raise ValueError()
            claims.append(claim)
        if len({c['run_id'] for c in claims}) != 1 or len({c['row_id'] for c in claims}) != len(claims):
            raise ValueError()
    except Exception:
        raise HTTPException(status_code=400, detail='미리보기가 만료되었거나 유효하지 않습니다. 다시 불러와 주세요.')
    conn = get_db_connection()
    try:
        conn.execute('BEGIN IMMEDIATE')
        imported = _imported_rows(_run(conn, claims[0]['run_id']))
        classes = _classes(conn)
        class_stamp = fingerprint(classes)
        class_map = {item['Id']: item for item in classes}
        changes = []
        for link, claim in zip(payload.links, claims):
            row_id = claim['row_id']
            record = _record(conn, row_id)
            if (row_id not in imported or not record or fingerprint(record) != claim['fingerprint']
                    or class_stamp != claim['classes']):
                raise HTTPException(status_code=409, detail='미리보기 이후 기록 또는 수업 정보가 바뀌었습니다. 다시 불러와 주세요. 변경된 기록은 없습니다.')
            reason = _blocked_reason(conn, record, row_id)
            if reason:
                raise HTTPException(status_code=409, detail=f'기록 #{row_id}: {reason} 변경된 기록은 없습니다.')
            target = class_map.get(link.class_id)
            if not target:
                raise HTTPException(status_code=400, detail='진행 선생님이 등록된 수업을 선택해 주세요.')
            teacher = target['TeacherUsername']
            old_teacher = str(record.get('ActualTeacherUsername') or '').strip()
            if old_teacher and old_teacher != teacher:
                raise HTTPException(status_code=409, detail=f'기록 #{row_id}: 기존 진행 선생님과 같은 선생님의 수업을 선택해 주세요.')
            if conn.execute('SELECT 1 FROM "TeacherPayrollClosures" WHERE "PayrollMonth"=? AND "TeacherUsername"=?',
                            (record['StudiedDay'][:7], teacher)).fetchone():
                raise HTTPException(status_code=409, detail=f'기록 #{row_id}: 선택한 선생님의 해당 월 정산이 마감되었습니다. 변경된 기록은 없습니다.')
            if conn.execute('SELECT 1 FROM "ClassCancellations" WHERE "ClassId"=? AND "CancelledDay"=?',
                            (link.class_id, record['StudiedDay'])).fetchone():
                raise HTTPException(status_code=409, detail=f'기록 #{row_id}: 해당 날짜는 선택한 수업의 휴강일입니다.')
            student = _student(conn, record['StudentId'])
            if conn.execute('''SELECT 1 FROM "StudentAbsences" WHERE "ClassId"=? AND "StudiedDay"=?
                               AND "StudentId" IN (?, ?)''',
                            (link.class_id, record['StudiedDay'], student['row_id'], student['Id'])).fetchone():
                raise HTTPException(status_code=409, detail=f'기록 #{row_id}: 해당 수업·날짜에 결석 기록이 있습니다. 결석 기록을 먼저 확인해 주세요.')
            # 과거 반 이동을 고려해 현재 소속은 추천에만 사용한다. 명시적으로 선택한 수업에 연결한다.
            changes.append((row_id, record, link.class_id, teacher, student.get('Grade') or ''))
        now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        for row_id, old, class_id, teacher, grade in changes:
            conn.execute('''UPDATE "StudyLogs" SET "ClassId"=?, "ActualTeacherUsername"=?,
                            "SubstituteStatus"='approved',
                            "GradeSnapshot"=CASE WHEN COALESCE(TRIM("GradeSnapshot"), '')='' THEN ? ELSE "GradeSnapshot" END,
                            "UpdatedBy"=?, "UpdatedAt"=? WHERE rowid=?''',
                         (class_id, teacher, grade, current_user['username'], now, row_id))
            new = _record(conn, row_id)
            write_audit_log('StudyLogs', row_id, 'UPDATE', old, new,
                            [key for key in new if old.get(key) != new[key]],
                            current_user['username'], current_user['role'],
                            request.client.host if request.client else '', connection=conn)
        conn.commit()
        return {'linked_count': len(changes), 'message': f'{len(changes)}건의 CSV 학습 기록을 수업에 연결했습니다.'}
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
