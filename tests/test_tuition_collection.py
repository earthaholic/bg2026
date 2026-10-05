"""임시 DB로 납입 업무의 중복·취소·원자성을 검증한다."""
import os
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
