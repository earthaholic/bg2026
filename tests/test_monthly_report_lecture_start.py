"""월말보고 시작 강의 번호가 결제 주기 경계를 반영하는지 검증한다."""
import sqlite3
import unittest
import uuid
from unittest.mock import patch

import main


class MonthlyReportLectureStartTests(unittest.TestCase):
    def setUp(self):
        self.uri = 'file:monthly_lecture_{}?mode=memory&cache=shared'.format(uuid.uuid4().hex)
        self.conn = self.connect()
        self.addCleanup(self.conn.close)
        connection_patch = patch.object(main, 'get_db_connection', side_effect=self.connect)
        connection_patch.start()
        self.addCleanup(connection_patch.stop)

        self.conn.executescript('''
            CREATE TABLE Students (Id INTEGER UNIQUE, Name TEXT, IsClassEnded INTEGER DEFAULT 0);
            CREATE TABLE Books (Id INTEGER UNIQUE, Title TEXT);
            CREATE TABLE Classes (Id INTEGER UNIQUE, ClassName TEXT, TeacherUsername TEXT);
            CREATE TABLE StudyLogs (
                Id INTEGER, StudentId INTEGER, BookId INTEGER,
                StudiedDay TEXT, LessonContent TEXT, IsSpecial INTEGER,
                Description TEXT, ClassId INTEGER, PayrollCategoryId INTEGER,
                ActualTeacherUsername TEXT
            );
            CREATE TABLE TuitionPayments (
                Id INTEGER UNIQUE, StudentId INTEGER, ClassType TEXT,
                PaidLessons INTEGER, ServiceLessons INTEGER, StartDate TEXT,
                PaidDate TEXT, FeeAmount INTEGER, Memo TEXT
            );
            INSERT INTO Students(rowid, Id, Name) VALUES (1, 101, '가 학생');
            INSERT INTO Books(rowid, Id, Title) VALUES (1, 1001, '도서');
            INSERT INTO TuitionPayments(rowid, Id, StudentId, ClassType, PaidLessons, ServiceLessons,
                StartDate, PaidDate, FeeAmount, Memo)
            VALUES (1, 501, 1, '초등부 독서반', 30, 6, '2026-01-05', '2026-01-05', 1800000, ''),
                   (2, 502, 1, '초등부 독서반', 10, 0, '2026-08-14', '2026-08-14', 500000, '');
        ''')
        self.conn.commit()

    def connect(self):
        conn = sqlite3.connect(self.uri, uri=True)
        conn.row_factory = sqlite3.Row
        return conn

    def add_lesson(self, day):
        self.conn.execute(
            'INSERT INTO StudyLogs(StudentId, BookId, StudiedDay, LessonContent, IsSpecial) VALUES (1, 1, ?, ?, 0)',
            (day, '수업')
        )
        self.conn.commit()

    def start(self, first_day, last_day=None):
        student = {'row_id': 1, 'Id': 101, 'Name': '가 학생'}
        return main._get_monthly_report_start_lecture(student, first_day, last_day)

    def test_cycle_boundary_restarts_numbering_after_new_payment(self):
        # 이전 주기 35회를 마친 뒤 8/10 수업, 8/14 새 결제, 8/17·8/24 수업
        for day in ('2026-01-12', '2026-02-09', '2026-03-09', '2026-04-13', '2026-05-11', '2026-06-08', '2026-07-13'):
            self.add_lesson(day)
        self.add_lesson('2026-08-10')
        self.add_lesson('2026-08-17')
        self.add_lesson('2026-08-24')

        result = self.start('2026-08-10', '2026-08-31')

        self.assertTrue(result['has_payment'])
        self.assertEqual(result['payment_start'], '2026-01-05')
        self.assertEqual(result['start_lecture_num'], 8)
        self.assertEqual([c['payment_start'] for c in result['cycles']], ['2026-01-05', '2026-08-14'])
        self.assertEqual(result['cycles'][1]['start_num'], 1, '새 결제 주기는 1강부터 시작한다')
        self.assertEqual(result['cycles'][1]['total_lessons'], 10)

    def test_empty_start_date_uses_paid_date_then_first_lesson(self):
        # 차시 시작일을 비워 둔 결제는 이전 주기를 다 쓴 다음 첫 수업일로 기록한다.
        self.conn.execute("UPDATE TuitionPayments SET StartDate='' WHERE rowid=2")
        self.conn.execute('UPDATE TuitionPayments SET PaidLessons=8, ServiceLessons=0 WHERE rowid=1')
        self.conn.commit()
        for day in ('2026-01-12', '2026-02-09', '2026-03-09', '2026-04-13', '2026-05-11', '2026-06-08', '2026-07-13'):
            self.add_lesson(day)
        self.add_lesson('2026-08-10')
        self.add_lesson('2026-08-17')
        self.add_lesson('2026-08-24')

        result = self.start('2026-08-10', '2026-08-31')

        self.assertEqual(result['start_lecture_num'], 8)
        self.assertEqual(result['cycles'][1]['payment_start'], '2026-08-17')
        self.assertEqual(result['cycles'][1]['start_num'], 1)
        stored = self.conn.execute('SELECT StartDate FROM TuitionPayments WHERE rowid=2').fetchone()[0]
        self.assertEqual(stored, '2026-08-17', '학습 기록으로 채운 차시 시작일을 저장한다')

    def test_period_after_new_payment_uses_only_that_cycle(self):
        # 기간이 새 결제 이후로만 잡히면 이전 주기는 번호 계산에 끼지 않는다.
        self.add_lesson('2026-08-17')
        result = self.start('2026-08-17', '2026-08-31')
        self.assertEqual(len(result['cycles']), 1)
        self.assertEqual(result['cycles'][0]['payment_start'], '2026-08-14')
        self.assertEqual(result['cycles'][0]['start_num'], 1)

    def test_no_payment_before_period_returns_empty(self):
        result = self.start('2026-01-01', '2026-01-04')
        self.assertFalse(result['has_payment'])
        self.assertEqual(result['cycles'], [])


if __name__ == '__main__':
    unittest.main()
