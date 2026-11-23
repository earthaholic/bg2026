"""결제 등록 때 비워 둔 차시 시작일이 학습 기록으로 기록되는지 검증한다."""
import sqlite3
import unittest
import uuid
from datetime import datetime
from unittest.mock import patch

import main


class TuitionCycleStartTests(unittest.TestCase):
    TODAY = '2026-09-20'
    CLASS_TYPE = '초등부 독서반'

    def setUp(self):
        self.uri = 'file:tuition_cycle_start_{}?mode=memory&cache=shared'.format(uuid.uuid4().hex)
        self.conn = self.connect()
        self.addCleanup(self.conn.close)
        connection_patch = patch.object(main, 'get_db_connection', side_effect=self.connect)
        connection_patch.start()
        self.addCleanup(connection_patch.stop)
        audit_patch = patch.object(main, '_audit_insert', autospec=True)
        self.audit = audit_patch.start()
        self.addCleanup(audit_patch.stop)
        clock_patch = patch.object(main, 'datetime', wraps=datetime)
        self.clock = clock_patch.start()
        self.clock.now.return_value = datetime(2026, 9, 20, 12, 0, 0)
        self.addCleanup(clock_patch.stop)

        self.conn.executescript('''
            CREATE TABLE Students (Id INTEGER UNIQUE, Name TEXT, IsClassEnded INTEGER DEFAULT 0);
            CREATE TABLE Books (Id INTEGER UNIQUE, Title TEXT);
            CREATE TABLE TuitionPayments (
                Id INTEGER UNIQUE, StudentId INTEGER, ClassType TEXT,
                PaidLessons INTEGER, ServiceLessons INTEGER, StartDate TEXT,
                PaidDate TEXT, FeeAmount INTEGER, Memo TEXT, CreatedBy TEXT,
                UpdatedBy TEXT, UpdatedAt TEXT
            );
            CREATE TABLE StudyLogs (
                Id INTEGER, StudentId INTEGER, BookId INTEGER,
                StudiedDay TEXT, LessonContent TEXT, IsSpecial INTEGER
            );
            INSERT INTO Students(rowid, Id, Name) VALUES (1, 101, '가 학생');
            INSERT INTO Books(rowid, Id, Title) VALUES
                (1, 1001, '첫 도서'), (2, 1002, ' 휴일 '), (3, 1003, '휴강');
        ''')
        self.conn.commit()

    def connect(self):
        conn = sqlite3.connect(self.uri, uri=True)
        conn.row_factory = sqlite3.Row
        return conn

    def add_payment(self, start='', paid='2026-09-10', lessons=10, service=0, student_id=1):
        cursor = self.conn.execute('''
            INSERT INTO TuitionPayments
                (StudentId, ClassType, PaidLessons, ServiceLessons, StartDate, PaidDate, FeeAmount, Memo)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ''', (student_id, self.CLASS_TYPE, lessons, service, start, paid, 100000, ''))
        self.conn.commit()
        return cursor.lastrowid

    def add_log(self, day, content='수업 내용', book_id=1, special=0):
        self.conn.execute(
            'INSERT INTO StudyLogs(StudentId, BookId, StudiedDay, LessonContent, IsSpecial) VALUES (1, ?, ?, ?, ?)',
            (book_id, day, content, special)
        )
        self.conn.commit()

    def stored_start(self, row_id):
        row = self.conn.execute('SELECT "StartDate" FROM TuitionPayments WHERE rowid = ?', (row_id,)).fetchone()
        return row[0]

    def progress(self):
        return main._get_tuition_progress(1, self.TODAY)

    def payments(self):
        params = dict(current_user={'username': 'admin', 'role': 'admin'}, include_progress=True)
        return main.get_tuition_payments(**params)['payments']

    def register_payment(self, **overrides):
        payload = dict(StudentId=1, ClassType=self.CLASS_TYPE, PaidLessons=10,
                       ServiceLessons=0, PaidDate='2026-09-10', FeeAmount=100000, Memo='')
        payload.update(overrides)
        return main.create_tuition_payment(
            main.TuitionPaymentRequest(**payload), {'username': 'admin', 'role': 'admin'}
        )

    def test_payment_starts_empty_and_waits_for_first_lesson(self):
        payment_id = self.add_payment()
        result = self.progress()
        self.assertTrue(result['has_payment'])
        self.assertEqual(result['used_lessons'], 0)
        self.assertEqual(result['payment_start'], '2026-09-10', '학습 기록이 없으면 납부일을 기준일로 쓴다')
        self.assertEqual(self.stored_start(payment_id), '', '학습 기록이 없으면 비워 둔다')

    def test_first_lesson_day_is_recorded_as_cycle_start(self):
        payment_id = self.add_payment(paid='2026-09-10')
        self.add_log('2026-09-05')  # 납부일 이전 수업은 이번 주기에 들어가지 않는다.
        self.add_log('2026-09-12')
        self.add_log('2026-09-19')

        result = self.progress()

        self.assertEqual(result['used_lessons'], 2)
        self.assertEqual(result['payment_start'], '2026-09-12')
        self.assertEqual(self.stored_start(payment_id), '2026-09-12', '첫 수업일을 차시 시작일로 기록한다')

    def test_holiday_log_does_not_start_cycle(self):
        payment_id = self.add_payment()
        self.add_log('2026-09-11', book_id=2)  # 휴일
        self.add_log('2026-09-13')

        result = self.progress()

        self.assertEqual(result['payment_start'], '2026-09-13')
        self.assertEqual(self.stored_start(payment_id), '2026-09-13')

    def test_registration_keeps_start_date_empty_until_lessons_exist(self):
        result = self.register_payment()
        payment_id = result['id']
        self.assertEqual(self.stored_start(payment_id), '')

        self.add_log('2026-09-14')
        rows = self.payments()

        self.assertEqual(rows[0]['StartDate'], '2026-09-14', '목록에서도 기록된 시작일을 보여 준다')
        self.assertEqual(self.stored_start(payment_id), '2026-09-14')

    def test_exhausted_cycle_restarts_at_first_lesson_of_new_payment(self):
        self.add_payment(start='2026-08-01', paid='2026-08-01', lessons=2)
        for day in ('2026-08-03', '2026-08-10'):
            self.add_log(day)

        new_id = self.add_payment(paid='2026-09-05', lessons=10)
        self.add_log('2026-09-07')
        self.add_log('2026-09-14')

        result = self.progress()

        self.assertEqual(result['used_lessons'], 2)
        self.assertEqual(result['total_lessons'], 10)
        self.assertEqual(result['payment_start'], '2026-09-07')
        self.assertEqual(self.stored_start(new_id), '2026-09-07')

        by_id = {row['row_id']: row for row in self.payments()}
        self.assertEqual(by_id[new_id]['ProgressState'], 'current')
        self.assertEqual(by_id[new_id]['TuitionProgress']['remaining_lessons'], 8)

    def test_late_payment_records_first_lesson_after_previous_cycle(self):
        # 지난 주기(2차시)를 다 쓴 뒤 수업한 9/7, 9/14 수업은 납부일(9/20)보다 앞서지만 새 주기의 1차시부터다.
        self.add_payment(start='2026-08-01', paid='2026-08-01', lessons=2)
        for day in ('2026-08-03', '2026-08-10', '2026-09-07', '2026-09-14'):
            self.add_log(day)

        new_id = self.add_payment(paid='2026-09-20', lessons=10)
        result = self.progress()

        self.assertEqual(self.stored_start(new_id), '2026-09-07', '납부 전에 진행한 차시도 새 주기로 기록한다')
        self.assertEqual(result['payment_start'], '2026-09-07')
        self.assertEqual(result['used_lessons'], 2)
        self.assertEqual(result['remaining_lessons'], 8)

    def test_next_cycle_waits_until_previous_cycle_is_used_up(self):
        # 지난 주기의 차시가 남아 있으면 새 결제는 아직 시작 전이다.
        self.add_payment(start='2026-08-01', paid='2026-08-01', lessons=10)
        self.add_log('2026-08-03')
        self.add_log('2026-08-10')

        new_id = self.add_payment(paid='2026-09-01', lessons=10)
        self.add_log('2026-09-07')

        self.progress()

        self.assertEqual(self.stored_start(new_id), '', '지난 주기가 남아 있으면 차시 시작일을 비워 둔다')

    def test_cycle_start_is_recorded_once_previous_cycle_is_used_up(self):
        self.add_payment(start='2026-08-01', paid='2026-08-01', lessons=3)
        for day in ('2026-08-03', '2026-08-10', '2026-09-07'):
            self.add_log(day)
        new_id = self.add_payment(paid='2026-09-01', lessons=10)

        self.progress()
        self.assertEqual(self.stored_start(new_id), '', '3차시를 다 쓰기 전에는 시작하지 않는다')

        self.add_log('2026-09-14')
        self.progress()

        self.assertEqual(self.stored_start(new_id), '2026-09-14', '지난 주기를 다 쓴 다음 수업일부터 새 주기다')

    def test_explicit_start_date_is_not_overwritten(self):
        payment_id = self.add_payment(start='2026-09-01', paid='2026-08-28')
        self.add_log('2026-09-12')

        self.progress()

        self.assertEqual(self.stored_start(payment_id), '2026-09-01')
        self.assertEqual(self.progress()['payment_start'], '2026-09-01')

    def test_clearing_start_date_lets_lessons_record_it_again(self):
        payment_id = self.add_payment(start='2026-09-01', paid='2026-08-28')
        self.add_log('2026-09-12')

        main.update_tuition_payment(
            payment_id,
            main.TuitionPaymentRequest(StudentId=1, ClassType=self.CLASS_TYPE, PaidLessons=10,
                                       ServiceLessons=0, StartDate='', PaidDate='2026-08-28',
                                       FeeAmount=100000, Memo=''),
            {'username': 'admin', 'role': 'admin'}
        )
        self.assertEqual(self.stored_start(payment_id), '')

        self.assertEqual(self.progress()['payment_start'], '2026-09-12')
        self.assertEqual(self.stored_start(payment_id), '2026-09-12')

    def test_progress_response_uses_recorded_start(self):
        self.add_payment(paid='2026-09-10')
        self.add_log('2026-09-11')

        result = main.get_student_tuition_progress(1, current_user={'username': 'admin', 'role': 'admin'})

        self.assertEqual(result['payment_start'], '2026-09-11')
        self.assertEqual(result['used_lessons'], 1)


if __name__ == '__main__':
    unittest.main()
