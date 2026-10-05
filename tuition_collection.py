"""수업료 납입 업무와 실제 결제 내역을 분리해 관리한다."""
from datetime import date, datetime
from typing import Optional, Literal
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, StrictInt
from auth import get_current_staff
from database import get_db_connection, write_audit_log

router = APIRouter(prefix='/api/user/tuition-collection')
_progress = None
_validate = None


def configure(progress, validate):
    global _progress, _validate
    _progress, _validate = progress, validate


def init_tuition_collection_tables(connection=None):
    conn = connection if connection is not None else get_db_connection()
    try:
        conn.executescript('''
        CREATE TABLE IF NOT EXISTS TuitionCollectionCases (
          id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending', payment_id INTEGER,
          version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL,
          created_by TEXT NOT NULL, completed_at TEXT);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_active ON TuitionCollectionCases(student_id) WHERE status != 'completed';
        CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_payment ON TuitionCollectionCases(payment_id) WHERE payment_id IS NOT NULL;
        CREATE TABLE IF NOT EXISTS TuitionCollectionEvents (
          id INTEGER PRIMARY KEY, case_id INTEGER NOT NULL,
          kind TEXT NOT NULL, occurred_on TEXT NOT NULL, channel TEXT NOT NULL DEFAULT '',
          memo TEXT NOT NULL DEFAULT '', next_followup TEXT NOT NULL DEFAULT '',
          promise_date TEXT NOT NULL DEFAULT '', paid_date TEXT NOT NULL DEFAULT '', amount INTEGER,
          counts_as_reminder INTEGER NOT NULL DEFAULT 0, actor TEXT NOT NULL,
          created_at TEXT NOT NULL, request_id TEXT NOT NULL UNIQUE,
          cancelled_at TEXT, cancelled_by TEXT, cancel_reason TEXT);
        CREATE INDEX IF NOT EXISTS idx_collection_events ON TuitionCollectionEvents(case_id,id);
        ''')
        if connection is None:
            conn.commit()
    finally:
        if connection is None:
            conn.close()


class EventRequest(BaseModel):
    kind: Literal['notice', 'link_sent', 'reminder', 'confirmed', 'note']
    occurred_on: str
    channel: str = Field('', max_length=100)
    memo: str = Field('', max_length=4000)
    next_followup: str = ''
    promise_date: str = ''
    paid_date: str = ''
    amount: Optional[StrictInt] = Field(None, ge=0)
    counts_as_reminder: bool = False
    request_id: str = Field(..., min_length=8, max_length=100)

    class Config:
        extra = 'forbid'


class CancelRequest(BaseModel):
    reason: str = Field(..., min_length=1, max_length=1000)
    class Config:
        extra = 'forbid'


class PaymentRequest(BaseModel):
    ClassType: str
    PaidLessons: StrictInt
    ServiceLessons: StrictInt
    StartDate: str
    PaidDate: str
    FeeAmount: StrictInt
    Memo: str = Field('', max_length=4000)
    class Config:
        extra = 'forbid'


class CompleteRequest(BaseModel):
    version: StrictInt = Field(..., gt=0)
    payment: Optional[PaymentRequest] = None
    payment_id: Optional[StrictInt] = Field(None, gt=0)
    class Config:
        extra = 'forbid'


def _day(value, required=False):
    if not value and not required:
        return
    try:
        if date.fromisoformat(value).isoformat() != value:
            raise ValueError()
    except (ValueError, TypeError):
        raise HTTPException(400, '날짜는 YYYY-MM-DD 형식이어야 합니다.')


def _student(conn, student_id):
    r = conn.execute('SELECT rowid AS row_id,* FROM Students WHERE rowid=?', (student_id,)).fetchone()
    if not r:
        raise HTTPException(404, '학생을 찾을 수 없습니다.')
    s = dict(r)
    aliases = (s['row_id'], s.get('Id'))
    if conn.execute('SELECT 1 FROM Students WHERE rowid != ? AND (rowid IN (?,?) OR Id IN (?,?))', (student_id, *aliases, *aliases)).fetchone():
        raise HTTPException(409, '학생 식별자가 중복되어 관리자 확인이 필요합니다.')
    return s


def _audit(conn, table, rid, user, old=None):
    new = dict(conn.execute('SELECT * FROM "' + table + '" WHERE rowid=?', (rid,)).fetchone())
    write_audit_log(table, rid, 'UPDATE' if old else 'INSERT', old, new,
                    [k for k in new if old and old.get(k) != new[k]] if old else None,
                    user['username'], user['role'], connection=conn)


def _case(conn, row):
    c = dict(row)
    events = [dict(x) for x in conn.execute('SELECT * FROM TuitionCollectionEvents WHERE case_id=? ORDER BY id', (c['id'],))]
    c.update(reminder_count=0, last_reminded_at=None, last_sent_at=None, last_contact_at=None, next_followup='', promise_date='', confirmed_paid_date='', confirmed_amount=None)
    status = 'pending'
    for e in events:
        if e['cancelled_at']:
            continue
        if e['kind'] in ('notice', 'link_sent', 'reminder'):
            c['last_contact_at'] = max(c['last_contact_at'] or '', e['occurred_on'])
            if status != 'confirmed':
                status = 'waiting'
        if e['kind'] == 'reminder' or (e['kind'] == 'link_sent' and e['counts_as_reminder']):
            c['reminder_count'] += 1
            c['last_reminded_at'] = max(c['last_reminded_at'] or '', e['occurred_on'])
        if e['kind'] == 'link_sent':
            c['last_sent_at'] = max(c['last_sent_at'] or '', e['occurred_on'])
        c['next_followup'] = e['next_followup']
        c['promise_date'] = e['promise_date']
        if e['kind'] == 'confirmed':
            status = 'confirmed'
            c['confirmed_paid_date'], c['confirmed_amount'] = e['paid_date'], e['amount']
    if c['status'] != 'completed':
        c['status'] = status
    c['events'] = events
    return c


def _sync(conn, cid):
    row = conn.execute('SELECT * FROM TuitionCollectionCases WHERE id=?', (cid,)).fetchone()
    c = _case(conn, row)
    conn.execute('UPDATE TuitionCollectionCases SET status=?,version=version+1 WHERE id=?', (c['status'], cid))
    return _case(conn, conn.execute('SELECT * FROM TuitionCollectionCases WHERE id=?', (cid,)).fetchone())


def _functions():
    if _progress is not None:
        return _progress, _validate
    from main import _get_tuition_progress, _validate_tuition_values
    return _get_tuition_progress, _validate_tuition_values


@router.get('')
def list_collection(q: str = '', class_id: Optional[int] = None, teacher: str = '', status: str = '', urgency: str = '', unsent: bool = False, reminder_count: int = Query(0, ge=0), include_ended: bool = False, followup_due: bool = False, page: int = Query(1, ge=1), limit: int = Query(30, ge=1, le=100), current_user=Depends(get_current_staff)):
    if status not in ('', 'pending', 'waiting', 'confirmed', 'completed') or urgency not in ('', 'urgent', 'overdue', 'exhausted', 'low', 'normal', 'unknown'):
        raise HTTPException(400, '올바른 진행 상태와 차시 상태를 선택해 주세요.')
    conn = get_db_connection()
    try:
        today = date.today().isoformat()
        progress_fn, _ = _functions()
        rows = []
        summary = dict(urgent=0, low=0, followup_due=0, confirmed=0, unknown=0, ended_open=0)
        for sr in conn.execute('SELECT rowid AS row_id,* FROM Students ORDER BY Name'):
            s = dict(sr)
            cr = conn.execute("SELECT * FROM TuitionCollectionCases WHERE student_id=? ORDER BY (status != 'completed') DESC,id DESC LIMIT 1", (s['row_id'],)).fetchone()
            c = _case(conn, cr) if cr else None
            if c and c['status'] == 'completed' and status != 'completed':
                c = None
            ended = bool(s.get('IsClassEnded'))
            if ended and c and c['status'] != 'completed':
                summary['ended_open'] += 1
            if ended and not include_ended:
                continue
            blocked = ''
            try:
                _student(conn, s['row_id'])
            except HTTPException as exc:
                blocked = exc.detail
            classes = [] if blocked else [dict(x) for x in conn.execute('SELECT DISTINCT c.Id AS id,c.ClassName AS name,c.TeacherUsername AS teacher FROM Classes c JOIN ClassStudents cs ON cs.ClassId=c.Id WHERE cs.StudentId IN (?,?)', (s['row_id'], s.get('Id')))]
            if q.strip() and q.strip().lower() not in (s.get('Name') or '').lower():
                continue
            if class_id is not None and not any(x['id'] == class_id for x in classes):
                continue
            if teacher and not any(x['teacher'] == teacher for x in classes):
                continue
            try:
                _student(conn, s['row_id'])
                p = progress_fn(s['row_id'], today, connection=conn)
                upcoming = conn.execute('SELECT rowid AS row_id,* FROM TuitionPayments WHERE StudentId IN (?,?) AND StartDate>? ORDER BY StartDate,rowid DESC LIMIT 1', (s['row_id'], s.get('Id'), today)).fetchone()
                blocked = ''
            except HTTPException as exc:
                p = {'has_payment': False, 'remaining_lessons': None, 'payments': []}
                upcoming = None
                blocked = exc.detail
            remaining = p.get('remaining_lessons')
            u = 'unknown' if not p['has_payment'] else ('overdue' if remaining < 0 else 'exhausted' if remaining == 0 else 'low' if remaining <= 4 else 'normal')
            st = c['status'] if c else 'pending'
            due = bool(c and st not in ('completed', 'confirmed') and ((c['next_followup'] and c['next_followup'] <= today) or (c['promise_date'] and c['promise_date'] < today)))
            if st not in ('confirmed', 'completed'):
                summary['urgent'] += int(u in ('overdue', 'exhausted'))
                summary['low'] += int(u == 'low')
            summary['unknown'] += int(u == 'unknown')
            summary['confirmed'] += int(st == 'confirmed')
            summary['followup_due'] += int(due)
            if not status and not urgency and not q and class_id is None and not teacher and not c and u == 'normal':
                continue
            if not status and urgency in ('urgent', 'overdue', 'exhausted', 'low') and st in ('confirmed', 'completed'):
                continue
            if status and st != status or urgency and not (u in ('overdue', 'exhausted') if urgency == 'urgent' else u == urgency) or unsent and c and c['last_sent_at'] or reminder_count and (not c or c['reminder_count'] < reminder_count) or followup_due and not due:
                continue
            # 완료 이력은 상세에 보존하며 다음 납입 건은 별도로 생성한다.
            rows.append(dict(student_id=s['row_id'], name=s.get('Name', ''), is_ended=ended, classes=classes, progress=p, urgency=u, upcoming_payment=dict(upcoming) if upcoming else None, case={k:v for k,v in c.items() if k != 'events'} if c else None, blocked_reason=blocked, followup_due=due))
        order = {'overdue': 0, 'exhausted': 1, 'low': 2, 'unknown': 3, 'normal': 4}
        rows.sort(key=lambda r: (int(bool(r['case'] and r['case']['status'] in ('confirmed', 'completed'))), order[r['urgency']], r['progress'].get('remaining_lessons') or 0, not r['followup_due'], (r['case'] or {}).get('last_contact_at') or '', r['name']))
        return dict(students=rows[(page-1)*limit:page*limit], total=len(rows), page=page, summary=summary)
    finally:
        conn.close()


@router.get('/students/{student_id}')
def collection_detail(student_id: int, current_user=Depends(get_current_staff)):
    conn = get_db_connection()
    try:
        s = _student(conn, student_id)
        cases = [_case(conn, r) for r in conn.execute('SELECT * FROM TuitionCollectionCases WHERE student_id=? ORDER BY id DESC', (student_id,))]
        payments = [dict(r) for r in conn.execute('SELECT rowid AS row_id,* FROM TuitionPayments WHERE StudentId IN (?,?) ORDER BY StartDate DESC,rowid DESC', (student_id,s.get('Id')))]
        return dict(student=s, cases=cases, payments=payments)
    finally:
        conn.close()


@router.post('/students/{student_id}/events')
def add_event(student_id: int, payload: EventRequest, current_user=Depends(get_current_staff)):
    for field in ('occurred_on', 'next_followup', 'promise_date', 'paid_date'):
        _day(getattr(payload, field), field == 'occurred_on')
    if payload.kind == 'confirmed' and (not payload.paid_date or payload.amount is None):
        raise HTTPException(400, '결제 확인에는 납부일과 금액이 필요합니다.')
    if payload.occurred_on > date.today().isoformat():
        raise HTTPException(400, '처리 일시는 미래 날짜로 기록할 수 없습니다.')
    conn = get_db_connection()
    try:
        conn.execute('BEGIN IMMEDIATE')
        _student(conn, student_id)
        old_event = conn.execute('SELECT e.*,c.student_id FROM TuitionCollectionEvents e JOIN TuitionCollectionCases c ON c.id=e.case_id WHERE e.request_id=?', (payload.request_id,)).fetchone()
        if old_event:
            if old_event['student_id'] != student_id or old_event['actor'] != current_user['username'] or any(old_event[k] != v for k,v in payload.dict().items()):
                raise HTTPException(409, '이미 사용된 요청 번호입니다. 새로고침 후 확인해 주세요.')
            return {'case': _case(conn, conn.execute('SELECT * FROM TuitionCollectionCases WHERE id=?', (old_event['case_id'],)).fetchone())}
        row = conn.execute("SELECT * FROM TuitionCollectionCases WHERE student_id=? AND status!='completed'", (student_id,)).fetchone()
        now = datetime.now().isoformat(timespec='seconds')
        if not row:
            cid = conn.execute('INSERT INTO TuitionCollectionCases(student_id,created_at,created_by) VALUES(?,?,?)', (student_id,now,current_user['username'])).lastrowid
            _audit(conn, 'TuitionCollectionCases', cid, current_user)
            row = conn.execute('SELECT * FROM TuitionCollectionCases WHERE id=?', (cid,)).fetchone()
        cid = row['id']
        if row['status'] == 'confirmed' and payload.kind in ('notice', 'link_sent', 'reminder'):
            raise HTTPException(409, '결제가 확인된 건은 독촉하지 않습니다. 잘못된 확인 기록을 취소해 주세요.')
        values = payload.dict()
        eid = conn.execute('INSERT INTO TuitionCollectionEvents(case_id,kind,occurred_on,channel,memo,next_followup,promise_date,paid_date,amount,counts_as_reminder,request_id,actor,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)', (cid,values['kind'],values['occurred_on'],values['channel'],values['memo'],values['next_followup'],values['promise_date'],values['paid_date'],values['amount'],values['counts_as_reminder'],values['request_id'],current_user['username'],now)).lastrowid
        _audit(conn, 'TuitionCollectionEvents', eid, current_user)
        c = _sync(conn, cid)
        _audit(conn, 'TuitionCollectionCases', cid, current_user, dict(row))
        conn.commit()
        return {'case': c}
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@router.post('/events/{event_id}/cancel')
def cancel_event(event_id: int, payload: CancelRequest, current_user=Depends(get_current_staff)):
    if not payload.reason.strip():
        raise HTTPException(400, '취소 사유를 입력해 주세요.')
    conn = get_db_connection()
    try:
        conn.execute('BEGIN IMMEDIATE')
        r = conn.execute('SELECT * FROM TuitionCollectionEvents WHERE id=?', (event_id,)).fetchone()
        if not r:
            raise HTTPException(404, '처리 기록을 찾을 수 없습니다.')
        c = conn.execute('SELECT * FROM TuitionCollectionCases WHERE id=?', (r['case_id'],)).fetchone()
        if c['status'] == 'completed':
            raise HTTPException(409, '완료된 납입 건의 이력은 변경할 수 없습니다.')
        if not r['cancelled_at']:
            conn.execute('UPDATE TuitionCollectionEvents SET cancelled_at=?,cancelled_by=?,cancel_reason=? WHERE id=?', (datetime.now().isoformat(timespec='seconds'),current_user['username'],payload.reason.strip(),event_id))
            _audit(conn, 'TuitionCollectionEvents', event_id, current_user, dict(r))
            _sync(conn, c['id'])
            _audit(conn, 'TuitionCollectionCases', c['id'], current_user, dict(c))
        conn.commit()
        return {'case': _case(conn, conn.execute('SELECT * FROM TuitionCollectionCases WHERE id=?', (c['id'],)).fetchone())}
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@router.post('/cases/{case_id}/complete')
def complete_case(case_id: int, payload: CompleteRequest, current_user=Depends(get_current_staff)):
    if (payload.payment is None) == (payload.payment_id is None):
        raise HTTPException(400, '새 결제 등록 또는 기존 결제 연결 중 하나를 선택해 주세요.')
    if payload.payment:
        p = payload.payment
        _, validate = _functions()
        validate(p.ClassType, p.PaidLessons, p.ServiceLessons, p.FeeAmount)
        _day(p.StartDate, True)
        _day(p.PaidDate, True)
    conn = get_db_connection()
    try:
        conn.execute('BEGIN IMMEDIATE')
        row = conn.execute('SELECT * FROM TuitionCollectionCases WHERE id=?', (case_id,)).fetchone()
        if not row:
            raise HTTPException(404, '납입 관리 건을 찾을 수 없습니다.')
        s = _student(conn, row['student_id'])
        if row['status'] == 'completed':
            return {'status': 'success', 'payment_id': row['payment_id'], 'already_completed': True}
        if row['version'] != payload.version:
            raise HTTPException(409, '다른 담당자가 처리 내용을 변경했습니다. 새로고침 후 확인해 주세요.')
        if payload.payment_id:
            pay = conn.execute('SELECT rowid AS row_id,* FROM TuitionPayments WHERE rowid=?', (payload.payment_id,)).fetchone()
            if not pay or pay['StudentId'] not in (s['row_id'], s.get('Id')):
                raise HTTPException(400, '해당 학생의 결제만 연결할 수 있습니다.')
            pid = pay['row_id']
        else:
            p = payload.payment
            duplicate = conn.execute('SELECT rowid FROM TuitionPayments WHERE StudentId IN (?,?) AND StartDate=? AND PaidDate=? AND FeeAmount=? AND PaidLessons=? AND ServiceLessons=? AND ClassType=?', (s['row_id'],s.get('Id'),p.StartDate,p.PaidDate,p.FeeAmount,p.PaidLessons,p.ServiceLessons,p.ClassType)).fetchone()
            if duplicate:
                raise HTTPException(409, '같은 결제 내역이 이미 있습니다. 기존 결제 연결을 이용해 주세요.')
            pid = conn.execute('INSERT INTO TuitionPayments(StudentId,ClassType,PaidLessons,ServiceLessons,StartDate,PaidDate,FeeAmount,Memo,CreatedBy) VALUES(?,?,?,?,?,?,?,?,?)', (s['row_id'],p.ClassType,p.PaidLessons,p.ServiceLessons,p.StartDate,p.PaidDate,p.FeeAmount,p.Memo.strip(),current_user['username'])).lastrowid
            _audit(conn, 'TuitionPayments', pid, current_user)
        if conn.execute('SELECT 1 FROM TuitionCollectionCases WHERE payment_id=?', (pid,)).fetchone():
            raise HTTPException(409, '다른 납입 관리 건에 연결된 결제입니다.')
        conn.execute("UPDATE TuitionCollectionCases SET status='completed',payment_id=?,completed_at=?,version=version+1 WHERE id=?", (pid,datetime.now().isoformat(timespec='seconds'),case_id))
        _audit(conn, 'TuitionCollectionCases', case_id, current_user, dict(row))
        conn.commit()
        return {'status': 'success', 'payment_id': pid}
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@router.post('/students/{student_id}/cases')
def start_case(student_id: int, current_user=Depends(get_current_staff)):
    """안내하지 않고도 결제 등록 업무를 시작할 수 있다."""
    conn = get_db_connection()
    try:
        conn.execute('BEGIN IMMEDIATE')
        _student(conn, student_id)
        row = conn.execute("SELECT * FROM TuitionCollectionCases WHERE student_id=? AND status!='completed'", (student_id,)).fetchone()
        if not row:
            cid = conn.execute('INSERT INTO TuitionCollectionCases(student_id,created_at,created_by) VALUES(?,?,?)', (student_id,datetime.now().isoformat(timespec='seconds'),current_user['username'])).lastrowid
            _audit(conn, 'TuitionCollectionCases', cid, current_user)
            row = conn.execute('SELECT * FROM TuitionCollectionCases WHERE id=?', (cid,)).fetchone()
        conn.commit()
        return {'case': _case(conn, row)}
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
