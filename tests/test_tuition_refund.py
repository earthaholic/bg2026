"""수업료 환불 등록·삭제와 잔여 차시 반영을 실제 DB 없이 검증한다."""
import sqlite3
import unittest
import uuid
from unittest.mock import patch

from fastapi import HTTPException

import main


class TuitionRefundTests(unittest.TestCase):
    def setUp(self):
        self.uri = 'file:tuition_refund_{}?mode=memory&cache=shared'.format(uuid.uuid4().hex)
        self.conn = self.connect()
        self.addCleanup(self.conn.close)
        connection_patch = patch.object(main, 'get_db_connection', side_effect=self.connect)
        self.connection_mock = connection_patch.start()
        self.addCleanup(connection_patch.stop)
        snapshot_patch = patch.object(main, 'get_record_snapshot', side_effect=self.snapshot)
        snapshot_patch.start()
        self.addCleanup(snapshot_patch.stop)
        for helper in ('_audit_insert', '_audit_delete', '_audit_update'):
            helper_patch = patch.object(main, helper)
            helper_patch.start()
            self.addCleanup(helper_patch.stop)

        self.conn.executescript('''
            CREATE TABLE Students (Id INTEGER UNIQUE, Name TEXT, IsClassEnded INTEGER DEFAULT 0);
            CREATE TABLE Books (Id INTEGER UNIQUE, Title TEXT);
            CREATE TABLE TuitionPayments (
                Id INTEGER UNIQUE, StudentId INTEGER, ClassType TEXT,
                PaidLessons INTEGER, ServiceLessons INTEGER, StartDate TEXT,
                PaidDate TEXT, FeeAmount INTEGER, Memo TEXT
            );
            CREATE TABLE StudyLogs (
                Id INTEGER, StudentId INTEGER, BookId INTEGER,
                StudiedDay TEXT, LessonContent TEXT, IsSpecial INTEGER
            );
            INSERT INTO Students(rowid, Id, Name) VALUES (1, 101, '가 학생');
            INSERT INTO Books(rowid, Id, Title) VALUES (1, 1001, '첫 도서');
            INSERT INTO TuitionPayments(rowid, Id, StudentId, ClassType, PaidLessons, ServiceLessons,
                StartDate, PaidDate, FeeAmount, Memo)
            VALUES (1, 501, 1, '초등부 독서반', 10, 2, '2026-09-01', '2026-09-01', 400000, '');
        ''')
        self.conn.commit()
        main.init_tuition_refund_tables(connection=self.conn)

    def snapshot(self, table, row_id):
        row = self.conn.execute('SELECT * FROM {} WHERE id = ?'.format(table), (row_id,)).fetchone()
        return dict(row) if row else None

    def connect(self):
        conn = sqlite3.connect(self.uri, uri=True)
        conn.row_factory = sqlite3.Row
        return conn

    def refund(self, **kwargs):
        payload = {
            'payment_id': 1,
            'refund_date': '2026-09-10',
            'refund_lessons': 0,
            'refund_amount': 0,
            'reason': '',
        }
        payload.update(kwargs)
        return main.create_tuition_refund(main.TuitionRefundRequest(**payload),
                                          {'username': 'manager_a', 'role': 'manager'})

    def add_lesson(self, day):
        self.conn.execute(
            'INSERT INTO StudyLogs(StudentId, BookId, StudiedDay, LessonContent, IsSpecial) VALUES (1, 1, ?, ?, 0)',
            (day, '수업 내용')
        )
        self.conn.commit()

    def progress(self):
        return main._get_tuition_progress(1, '2026-09-20', connection=self.conn)

    def test_refund_is_recorded_and_subtracted_from_remaining_lessons(self):
        result = self.refund(refund_lessons=2, refund_amount=100000, reason='중도 퇴원')
        self.assertEqual(result['status'], 'success')
        self.assertEqual(result['remaining_lessons'], 10)

        rows = self.conn.execute('SELECT * FROM TuitionRefunds').fetchall()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['refund_lessons'], 2)
        self.assertEqual(rows[0]['refund_amount'], 100000)
        self.assertEqual(rows[0]['created_by'], 'manager_a')

        progress = self.progress()
        self.assertEqual(progress['total_lessons'], 10)   # 12 - 2
        self.assertEqual(progress['refunded_lessons'], 2)
        self.assertEqual(progress['remaining_lessons'], 10)

    def test_used_lessons_and_refund_are_counted_together(self):
        self.add_lesson('2026-09-05')
        self.add_lesson('2026-09-12')
        self.add_lesson('2026-09-19')
        self.refund(refund_lessons=2)
        progress = self.progress()
        self.assertEqual(progress['used_lessons'], 3)
        self.assertEqual(progress['total_lessons'], 10)
        self.assertEqual(progress['remaining_lessons'], 7)

    def test_refund_lessons_cannot_exceed_payment_lessons(self):
        self.refund(refund_lessons=10)
        with self.assertRaises(HTTPException) as ctx:
            self.refund(refund_lessons=3)
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn('남은 차시는 2회', ctx.exception.detail)

    def test_refund_amount_cannot_exceed_payment_amount(self):
        self.refund(refund_amount=300000)
        with self.assertRaises(HTTPException) as ctx:
            self.refund(refund_amount=200000)
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn('남은 금액은 100,000원', ctx.exception.detail)

    def test_refund_date_cannot_be_before_paid_date(self):
        with self.assertRaises(HTTPException) as ctx:
            self.refund(refund_date='2026-08-31', refund_amount=1000)
        self.assertEqual(ctx.exception.status_code, 400)

    def test_refund_requires_lessons_or_amount(self):
        with self.assertRaises(HTTPException) as ctx:
            self.refund()
        self.assertEqual(ctx.exception.status_code, 400)

    def test_delete_refund_restores_remaining_lessons(self):
        self.add_lesson('2026-09-05')
        created = self.refund(refund_lessons=2)
        self.assertEqual(self.progress()['total_lessons'], 10)
        main.delete_tuition_refund(created['refund_id'], {'username': 'manager_a', 'role': 'manager'})
        progress = self.progress()
        self.assertEqual(progress['total_lessons'], 12)
        self.assertEqual(progress['remaining_lessons'], 11)

    def test_payment_list_includes_refund_totals(self):
        self.refund(refund_lessons=1, refund_amount=30000)
        self.refund(refund_lessons=1, refund_amount=20000)
        row = self.conn.execute(
            '''SELECT p.rowid as row_id, p.*, {agg} FROM "TuitionPayments" p'''.format(
                agg=main.TUITION_REFUND_AGGREGATE_SQL
            )
        ).fetchone()
        self.assertEqual(row['RefundLessons'], 2)
        self.assertEqual(row['RefundAmount'], 50000)
        self.assertEqual(row['RefundCount'], 2)


if __name__ == '__main__':
    unittest.main()
