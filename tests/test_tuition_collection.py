"""임시 DB로 납입 업무의 중복·취소·원자성을 검증한다."""
import os
import json
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
from fastapi import HTTPException
import tuition_collection as tc

USER = {'username': 'manager', 'role': 'manager'}


class TuitionCollectionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = os.path.join(self.tmp.name, 'test.db')
        self.connections = []
        def connection():
            conn = sqlite3.connect(self.db)
            conn.row_factory = sqlite3.Row
            self.connections.append(conn)
            return conn
        self.connection = connection
        c = connection()
        c.executescript('''CREATE TABLE Students(Id INTEGER,Name TEXT,IsClassEnded INTEGER);
        INSERT INTO Students VALUES(1,'가학생',0),(2,'나학생',0),(3,'종료학생',1);
        CREATE TABLE Classes(Id INTEGER,ClassName TEXT,TeacherUsername TEXT);
        CREATE TABLE ClassStudents(ClassId INTEGER,StudentId INTEGER);
        CREATE TABLE TuitionPayments(Id INTEGER PRIMARY KEY,StudentId INTEGER,ClassType TEXT,PaidLessons INTEGER,ServiceLessons INTEGER,StartDate TEXT,PaidDate TEXT,FeeAmount INTEGER,Memo TEXT,CreatedBy TEXT);
        CREATE TABLE _app_audit_logs(table_name TEXT,record_id TEXT,action TEXT,old_data TEXT,new_data TEXT,changed_fields TEXT,username TEXT,user_role TEXT,ip_address TEXT);
        ''')
        tc.init_tuition_collection_tables(c)
        c.commit()
        c.close()
        self.patch = patch.object(tc, 'get_db_connection', connection)
        self.patch.start()
        self.config = (tc._progress, tc._validate)
        tc.configure(lambda *a, **kw: {'has_payment': False, 'remaining_lessons': 0, 'payments': []}, lambda *a: None)

    def tearDown(self):
        tc.configure(*self.config)
        self.patch.stop()
        for conn in self.connections:
            conn.close()
        self.tmp.cleanup()

    def event(self, student=1, kind='reminder', **kw):
        data = dict(kind=kind, occurred_on='2026-01-01', request_id='request-' + str(self.counter()))
        data.update(kw)
        return tc.add_event(student, tc.EventRequest(**data), USER)['case']

    def counter(self):
        self.count = getattr(self, 'count', 0) + 1
        return self.count

    def listing(self, **kw):
        opts = dict(q='', class_id=None, teacher='', status='', urgency='', unsent=False, reminder_count=0, include_ended=False, followup_due=False, page=1, limit=30, current_user=USER)
        opts.update(kw)
        return tc.list_collection(**opts)

    def test_no_payment_and_ended(self):
        self.event(3)
        rows = self.listing()
        self.assertEqual(rows['total'], 2)
        self.assertEqual(rows['summary']['ended_open'], 1)
        self.assertEqual(rows['students'][0]['urgency'], 'unknown')
        self.assertEqual(self.listing(include_ended=True)['total'], 3)

    def test_event_idempotency_and_conflict(self):
        c = self.event(request_id='same-request')
        c2 = self.event(request_id='same-request')
        self.assertEqual(c2['reminder_count'], 1)
        self.assertEqual(c['id'], c2['id'])
        with self.assertRaises(HTTPException):
            self.event(2, request_id='same-request')

    def test_cancel_recalculates_and_audits(self):
        c = self.event()
        result = tc.cancel_event(c['events'][0]['id'], tc.CancelRequest(reason='잘못 기록'), USER)
        self.assertEqual(result['case']['reminder_count'], 0)
        self.assertEqual(result['case']['status'], 'pending')
        with self.connection() as conn:
            self.assertGreater(conn.execute('SELECT COUNT(*) FROM _app_audit_logs').fetchone()[0], 2)

    def test_link_counts_and_confirmed_blocks_reminder(self):
        c = self.event(kind='link_sent')
        self.assertEqual(c['reminder_count'], 0)
        c = self.event(kind='link_sent', counts_as_reminder=True)
        self.assertEqual(c['reminder_count'], 1)
        self.event(kind='confirmed', paid_date='2026-01-01', amount=10000)
        with self.assertRaises(HTTPException):
            self.event()

    def test_complete_atomic_idempotent_new_cycle(self):
        c = tc.start_case(1, USER)['case']
        payment = tc.PaymentRequest(ClassType='일반', PaidLessons=10, ServiceLessons=0, StartDate='2026-01-01', PaidDate='2026-01-01', FeeAmount=10000)
        payload = tc.CompleteRequest(version=c['version'], payment=payment)
        result = tc.complete_case(c['id'], payload, USER)
        again = tc.complete_case(c['id'], payload, USER)
        self.assertEqual(result['payment_id'], again['payment_id'])
        with self.connection() as conn:
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM TuitionPayments').fetchone()[0], 1)
        c2 = self.event()
        self.assertNotEqual(c['id'], c2['id'])
        self.assertEqual(c2['reminder_count'], 1)
        with self.assertRaises(HTTPException):
            tc.complete_case(c2['id'], tc.CompleteRequest(version=c2['version'], payment_id=result['payment_id']), USER)

    def test_stale_version_and_wrong_student_payment(self):
        c = self.event()
        self.event()
        with self.assertRaises(HTTPException):
            tc.complete_case(c['id'], tc.CompleteRequest(version=c['version'], payment_id=1), USER)
        with self.connection() as conn:
            conn.execute("INSERT INTO TuitionPayments(StudentId) VALUES(2)")
        latest = tc.collection_detail(1, USER)['cases'][0]
        with self.assertRaises(HTTPException):
            tc.complete_case(c['id'], tc.CompleteRequest(version=latest['version'], payment_id=1), USER)

    def test_audit_failure_rolls_back(self):
        with patch.object(tc, 'write_audit_log', side_effect=RuntimeError('실패')):
            with self.assertRaises(RuntimeError):
                self.event()
        with self.connection() as conn:
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM TuitionCollectionCases').fetchone()[0], 0)
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM TuitionCollectionEvents').fetchone()[0], 0)

    def test_legacy_promise_date_is_not_exposed_or_used_for_followup(self):
        c = self.event()
        with self.connection() as conn:
            conn.execute("UPDATE TuitionCollectionEvents SET promise_date='2020-01-01' WHERE case_id=?", (c['id'],))
        detail = tc.collection_detail(1, USER)['cases'][0]
        self.assertNotIn('promise_date', detail)
        self.assertNotIn('promise_date', detail['events'][0])
        self.assertEqual(self.listing(followup_due=True)['total'], 0)
        self.event(kind='note', next_followup='2020-01-01')
        self.assertEqual(self.listing(followup_due=True)['total'], 1)

    def delete_history(self, case, event_id=None, **overrides):
        data = dict(confirmation='처리 이력 삭제', version=case['version'], student_id=case['student_id'])
        data.update(overrides)
        return tc.delete_event(event_id or case['events'][-1]['id'], tc.DeleteEventRequest(**data), USER)

    def test_delete_reminder_physically_and_preserve_delete_audit(self):
        first = self.event(next_followup='2026-01-02')
        c = self.event(next_followup='2026-01-03')
        eid = c['events'][-1]['id']
        result = self.delete_history(c)['case']
        self.assertEqual(result['reminder_count'], 1)
        self.assertEqual(result['next_followup'], '2026-01-02')
        self.assertEqual(result['version'], c['version'] + 1)
        self.assertEqual([e['id'] for e in result['events']], [first['events'][0]['id']])
        with self.connection() as conn:
            self.assertIsNone(conn.execute('SELECT * FROM TuitionCollectionEvents WHERE id=?', (eid,)).fetchone())
            audit = conn.execute("SELECT * FROM _app_audit_logs WHERE table_name='TuitionCollectionEvents' AND record_id=? AND action='DELETE'", (str(eid),)).fetchone()
            self.assertEqual(json.loads(audit['old_data'])['kind'], 'reminder')
            self.assertIsNone(audit['new_data'])
            self.assertEqual(audit['username'], USER['username'])
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM _app_audit_logs WHERE table_name='TuitionCollectionCases' AND action='UPDATE'").fetchone()[0], 3)

    def test_delete_last_event_retains_empty_pending_case(self):
        c = self.event(kind='link_sent', counts_as_reminder=True, next_followup='2026-01-02')
        result = self.delete_history(c)['case']
        self.assertEqual(result['id'], c['id'])
        self.assertEqual(result['events'], [])
        self.assertEqual(result['status'], 'pending')
        self.assertEqual(result['reminder_count'], 0)
        self.assertEqual(result['next_followup'], '')
        self.assertIsNone(result['last_sent_at'])
        self.assertIsNone(result['last_reminded_at'])

    def test_delete_confirmation_recalculates_previous_waiting_state(self):
        self.event(kind='notice', next_followup='2026-01-02')
        c = self.event(kind='confirmed', paid_date='2026-01-01', amount=10000)
        result = self.delete_history(c)['case']
        self.assertEqual(result['status'], 'waiting')
        self.assertEqual(result['confirmed_paid_date'], '')
        self.assertIsNone(result['confirmed_amount'])
        self.assertEqual(result['next_followup'], '2026-01-02')
        self.assertEqual(self.event()['reminder_count'], 1)

    def test_delete_cancelled_event(self):
        c = self.event()
        eid = c['events'][0]['id']
        c = tc.cancel_event(eid, tc.CancelRequest(reason='오입력'), USER)['case']
        result = self.delete_history(c, eid)['case']
        self.assertEqual(result['events'], [])
        self.assertEqual(result['reminder_count'], 0)
        self.assertEqual(result['status'], 'pending')

    def test_delete_completed_event_preserves_payment_and_completion(self):
        c = self.event(kind='confirmed', paid_date='2026-01-01', amount=10000)
        payment = tc.PaymentRequest(ClassType='일반', PaidLessons=10, ServiceLessons=0, StartDate='2026-01-01', PaidDate='2026-01-01', FeeAmount=10000)
        tc.complete_case(c['id'], tc.CompleteRequest(version=c['version'], payment=payment), USER)
        c = tc.collection_detail(1, USER)['cases'][0]
        with self.connection() as conn:
            original_payment = dict(conn.execute('SELECT * FROM TuitionPayments').fetchone())
        result = self.delete_history(c)['case']
        self.assertEqual(result['events'], [])
        for field in ('status', 'payment_id', 'completed_at'):
            self.assertEqual(result[field], c[field])
        self.assertEqual(result['status'], 'completed')
        with self.connection() as conn:
            self.assertEqual(dict(conn.execute('SELECT * FROM TuitionPayments').fetchone()), original_payment)
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM TuitionPayments').fetchone()[0], 1)

    def test_delete_confirmation_student_version_and_already_deleted_protection(self):
        c = self.event()
        for confirmation in ('', '처리 이력 삭제 ', '처리 이력 취소'):
            with self.assertRaises(HTTPException) as failure:
                self.delete_history(c, confirmation=confirmation)
            self.assertEqual(failure.exception.status_code, 400)
        with self.assertRaises(HTTPException) as failure:
            self.delete_history(c, student_id=2)
        self.assertEqual(failure.exception.status_code, 409)
        with self.assertRaises(HTTPException) as failure:
            self.delete_history(c, version=c['version'] + 1)
        self.assertEqual(failure.exception.status_code, 409)
        self.assertEqual(len(tc.collection_detail(1, USER)['cases'][0]['events']), 1)
        self.delete_history(c)
        with self.assertRaises(HTTPException) as failure:
            self.delete_history(c)
        self.assertEqual(failure.exception.status_code, 404)

    def test_delete_audit_failure_rolls_back_event_case_and_audit(self):
        c = self.event()
        with self.connection() as conn:
            original_count = conn.execute('SELECT COUNT(*) FROM _app_audit_logs').fetchone()[0]
        # DELETE 감사 이후 UPDATE 감사 실패도 앞선 감사와 삭제를 함께 롤백한다.
        audit = tc.write_audit_log
        def fail_case_update(*args, **kwargs):
            if args[0] == 'TuitionCollectionCases':
                raise RuntimeError('감사 실패')
            return audit(*args, **kwargs)
        with patch.object(tc, 'write_audit_log', side_effect=fail_case_update):
            with self.assertRaises(RuntimeError):
                self.delete_history(c)
        result = tc.collection_detail(1, USER)['cases'][0]
        self.assertEqual(result, c)
        with self.connection() as conn:
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM _app_audit_logs').fetchone()[0], original_count)

    def test_deleted_event_number_is_never_reused(self):
        c = self.event()
        deleted_id = c['events'][0]['id']
        self.delete_history(c)
        other = self.event(student=2)
        self.assertGreater(other['events'][0]['id'], deleted_id)
        with self.assertRaises(HTTPException) as failure:
            tc.cancel_event(deleted_id, tc.CancelRequest(reason='오래된 화면'), USER)
        self.assertEqual(failure.exception.status_code, 404)
        self.assertIsNone(tc.collection_detail(2, USER)['cases'][0]['events'][0]['cancelled_at'])
        self.delete_history(other)
        again = self.event()
        self.assertGreater(again['events'][0]['id'], other['events'][0]['id'])

    def test_event_number_uses_larger_live_or_audit_maximum(self):
        c = self.event()
        with self.connection() as conn:
            conn.execute("INSERT INTO _app_audit_logs(table_name,record_id,action) VALUES('TuitionCollectionEvents','100','DELETE')")
        newer = self.event()
        self.assertEqual(newer['events'][-1]['id'], 101)
        with self.connection() as conn:
            conn.execute('UPDATE TuitionCollectionEvents SET id=200 WHERE id=101')
        newest = self.event()
        self.assertEqual(newest['events'][-1]['id'], 201)

    def test_delete_payload_rejects_coercion_and_extra_fields(self):
        from pydantic import ValidationError
        valid = dict(confirmation='처리 이력 삭제', version=1, student_id=1)
        for changes in ({'version': True}, {'version': '1'}, {'student_id': 0}, {'student_id': '1'}, {'confirmation': 1}, {'other': '금지'}):
            with self.assertRaises(ValidationError):
                tc.DeleteEventRequest(**dict(valid, **changes))

    def test_identity_collision(self):
        with self.connection() as conn:
            conn.execute('UPDATE Students SET Id=1 WHERE rowid=2')
        with self.assertRaises(HTTPException):
            self.event()

    def test_collision_does_not_expose_related_class(self):
        with self.connection() as conn:
            conn.execute('UPDATE Students SET Id=2 WHERE rowid=1')
            conn.execute("INSERT INTO Classes VALUES(1,'다른 학생 수업','teacher')")
            conn.execute('INSERT INTO ClassStudents VALUES(1,2)')
        row = next(r for r in self.listing()['students'] if r['student_id'] == 1)
        self.assertTrue(row['blocked_reason'])
        self.assertEqual(row['classes'], [])
        self.assertIsNone(row['upcoming_payment'])

    def test_explicit_normal_filter_includes_students_without_case(self):
        tc.configure(lambda *a, **kw: {'has_payment': True, 'remaining_lessons': 6, 'payments': []}, lambda *a: None)
        self.assertEqual(self.listing()['total'], 0)
        self.assertEqual(self.listing(urgency='normal')['total'], 2)
        self.assertEqual(self.listing(q='가학생')['total'], 1)

    def test_urgent_order_and_summary_respect_name_filter(self):
        remaining = {1: -2, 2: -8, 3: 3}
        tc.configure(lambda sid, *a, **kw: {'has_payment': True, 'remaining_lessons': remaining[sid], 'payments': []}, lambda *a: None)
        rows = self.listing(urgency='urgent')['students']
        self.assertEqual([r['student_id'] for r in rows], [2, 1])
        self.assertEqual(self.listing(q='가학생')['summary']['urgent'], 1)

    def test_urgent_summary_and_filter_exclude_confirmed(self):
        tc.configure(lambda *a, **kw: {'has_payment': True, 'remaining_lessons': -1, 'payments': []}, lambda *a: None)
        self.event(kind='confirmed', paid_date='2026-01-01', amount=10000)
        result = self.listing(urgency='urgent')
        self.assertEqual(result['summary']['urgent'], 1)
        self.assertEqual(result['total'], 1)
        self.assertEqual(result['students'][0]['student_id'], 2)
        self.assertEqual(self.listing(status='confirmed', urgency='urgent')['total'], 1)

    def test_payment_audit_failure_rolls_back_payment_and_completion(self):
        c = tc.start_case(1, USER)['case']
        payment = tc.PaymentRequest(ClassType='일반', PaidLessons=10, ServiceLessons=0, StartDate='2026-01-01', PaidDate='2026-01-01', FeeAmount=10000)
        with patch.object(tc, 'write_audit_log', side_effect=RuntimeError('감사 실패')):
            with self.assertRaises(RuntimeError):
                tc.complete_case(c['id'], tc.CompleteRequest(version=c['version'], payment=payment), USER)
        with self.connection() as conn:
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM TuitionPayments').fetchone()[0], 0)
            self.assertEqual(conn.execute('SELECT status FROM TuitionCollectionCases WHERE id=?', (c['id'],)).fetchone()[0], 'pending')


if __name__ == '__main__':
    unittest.main()
