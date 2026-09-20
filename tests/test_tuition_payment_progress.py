"""실제 데이터베이스에 접근하지 않고 결제별 수강 진행률을 검증한다."""
import sqlite3
import unittest
import uuid
from datetime import datetime
from unittest.mock import patch

import main


class TuitionPaymentProgressTests(unittest.TestCase):
    TODAY = '2026-09-20'
    CLASS_TYPE = '초등부 독서반'

    def setUp(self):
        # 기준 연결을 유지하여 조회 함수가 연결을 닫아도 메모리 DB는 보존한다.
        self.uri = 'file:tuition_progress_{}?mode=memory&cache=shared'.format(uuid.uuid4().hex)
        self.conn = self.connect()
        self.addCleanup(self.conn.close)
        connection_patch = patch.object(main, 'get_db_connection', side_effect=self.connect)
        self.connection_mock = connection_patch.start()
        self.addCleanup(connection_patch.stop)
        clock_patch = patch.object(main, 'datetime', wraps=datetime)
        self.clock = clock_patch.start()
        self.clock.now.return_value = datetime(2026, 9, 20, 12, 0, 0)
        self.addCleanup(clock_patch.stop)
        # 원본 Id와 rowid를 분리하여 어느 식별자로 저장했든 대응하는지 확인한다.
        self.conn.executescript('''
            CREATE TABLE Students (Id INTEGER UNIQUE, Name TEXT);
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
            INSERT INTO Students(rowid, Id, Name) VALUES
                (1, 101, '가 학생'), (2, 202, '나 학생'), (3, 303, '다 학생');
            INSERT INTO Books(rowid, Id, Title) VALUES
                (1, 1001, '첫 도서'), (2, 1002, '둘째 도서'),
                (3, 1003, ' 휴일 '), (4, 1004, '휴강');
        ''')
        self.conn.commit()

    def connect(self):
        conn = sqlite3.connect(self.uri, uri=True)
        conn.row_factory = sqlite3.Row
        return conn

    def add_payment(self, student_id=1, start='2026-09-01', paid=10,
                    service=0, class_type=None, original_id=None):
        cursor = self.conn.execute('''
            INSERT INTO TuitionPayments
                (Id, StudentId, ClassType, PaidLessons, ServiceLessons,
                 StartDate, PaidDate, FeeAmount, Memo)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (original_id, student_id, class_type or self.CLASS_TYPE, paid,
              service, start, self.TODAY, 100000, '테스트 결제'))
        self.conn.commit()
        return cursor.lastrowid

    def add_log(self, student_id=1, day='2026-09-10', content='수업 내용',
                book_id=1, special=0):
        self.conn.execute('''
            INSERT INTO StudyLogs(StudentId, BookId, StudiedDay, LessonContent, IsSpecial)
            VALUES (?, ?, ?, ?, ?)
        ''', (student_id, book_id, day, content, special))
        self.conn.commit()

    def payments(self, **overrides):
        params = dict(current_user={'username': 'admin', 'role': 'admin'},
                      include_progress=True)
        params.update(overrides)
        return main.get_tuition_payments(**params)['payments']

    def assert_progress(self, payment, total, used, remaining):
        self.assertEqual(payment['ProgressState'], 'current')
        self.assertEqual(payment['TuitionProgress'], {
            'total_lessons': total,
            'used_lessons': used,
            'remaining_lessons': remaining,
        })
        for value in payment['TuitionProgress'].values():
            self.assertIs(type(value), int)

    def assert_state(self, payment, state):
        self.assertEqual(payment['ProgressState'], state)
        self.assertIsNone(payment['TuitionProgress'])

    def test_latest_started_payment_is_current_per_student(self):
        old = self.add_payment(start='2026-08-01')
        current = self.add_payment(start=self.TODAY, paid=20, service=2)
        future = self.add_payment(start='2026-09-21', paid=30)
        second = self.add_payment(student_id=202, start='2026-09-05')
        self.add_log(day='2026-09-19', content='이전 결제의 수업')
        self.add_log(day=self.TODAY)
        self.add_log(student_id=202)
        rows = self.payments()
        self.assertEqual([p['row_id'] for p in rows], [future, current, second, old])
        by_id = {p['row_id']: p for p in rows}
        self.assert_progress(by_id[current], 22, 1, 21)
        self.assert_progress(by_id[second], 10, 1, 9)
        self.assert_state(by_id[old], 'previous')
        self.assert_state(by_id[future], 'upcoming')

    def test_class_filter_does_not_promote_hidden_current_payment(self):
        old = self.add_payment(start='2026-08-01')
        self.add_payment(start='2026-09-01', class_type='중등부 토론반')
        rows = self.payments(class_type='  초등부 독서반  ', q='  가 학생  ')
        self.assertEqual([p['row_id'] for p in rows], [old])
        self.assert_state(rows[0], 'previous')

    def test_student_identifier_filter_does_not_promote_old_alias_payment(self):
        old = self.add_payment(student_id=1, start='2026-08-01')
        self.add_payment(student_id=101, start='2026-09-01')
        rows = self.payments(student_id=1)
        self.assertEqual([p['row_id'] for p in rows], [old])
        self.assert_state(rows[0], 'previous')

    def test_same_start_date_uses_larger_rowid_not_original_id(self):
        old = self.add_payment(original_id=999, paid=30)
        current = self.add_payment(original_id=100, paid=10, service=3)
        self.add_log()
        rows = self.payments()
        self.assertEqual([p['row_id'] for p in rows], [current, old])
        self.assert_progress(rows[0], 13, 1, 12)
        self.assert_state(rows[1], 'previous')

    def test_paid_and_service_lessons_preserve_remaining_boundaries(self):
        # 잔여 5회, 4회, 0회와 초과 수강의 음수를 반올림하거나 보정하지 않는다.
        for index, (used, remaining) in enumerate(((7, 5), (8, 4), (12, 0), (13, -1)), 10):
            with self.subTest(used=used, remaining=remaining):
                self.conn.execute('INSERT INTO Students(rowid, Id, Name) VALUES (?, ?, ?)',
                                  (index, index + 1000, '경계 학생 {}'.format(index)))
                self.conn.commit()
                self.add_payment(student_id=index, paid=10, service=2)
                for number in range(used):
                    self.add_log(student_id=index, content='서로 다른 수업 {}'.format(number))
                self.assert_progress(self.payments(student_id=index)[0], 12, used, remaining)

    def test_zero_paid_service_only_and_null_lesson_totals(self):
        for student_id, paid, service, total in ((1, 0, 0, 0), (2, 0, 5, 5), (3, None, None, 0)):
            with self.subTest(student_id=student_id):
                self.add_payment(student_id=student_id, paid=paid, service=service)
                self.assert_progress(self.payments(student_id=student_id)[0], total, 0, total)

    def test_only_records_between_start_and_today_are_counted(self):
        self.add_payment(start='2026-09-10')
        self.add_log(day='2026-09-09')
        self.add_log(day='2026-09-10')
        self.add_log(day=self.TODAY)
        self.add_log(day='2026-09-21')
        self.assert_progress(self.payments()[0], 10, 2, 8)

    def test_special_holiday_and_cancelled_records_are_excluded_by_both_book_keys(self):
        self.add_payment()
        self.add_log(content='정규 수업')
        self.add_log(content='특강', special=1)
        self.add_log(content='기존 정규 수업', special=None)
        for book_id in (3, 1003, 4, 1004):
            self.add_log(content='제외할 수업 {}'.format(book_id), book_id=book_id)
        self.assert_progress(self.payments()[0], 10, 2, 8)

    def test_multiple_books_with_same_day_and_trimmed_content_count_once(self):
        self.add_payment()
        self.add_log(content='같은 수업', book_id=1)
        self.add_log(content='  같은 수업\t', book_id=1002)
        self.add_log(content='다른 수업', book_id=2)
        self.add_log(day='2026-09-11', content='같은 수업', book_id=2)
        self.assert_progress(self.payments()[0], 10, 3, 7)

    def test_empty_contents_remain_individual_sessions(self):
        self.add_payment()
        for content in (None, '', '  \t'):
            self.add_log(content=content)
        self.assert_progress(self.payments()[0], 10, 3, 7)

    def test_student_rowid_original_id_and_name_records_are_all_counted(self):
        self.add_payment(student_id=101)
        for index, student_id in enumerate((1, '1', 101, '가 학생')):
            self.add_log(student_id=student_id, content='식별자별 수업 {}'.format(index))
        self.add_log(student_id=202, content='다른 학생 수업')
        payment = self.payments(q='가 학생')[0]
        self.assertEqual(payment['StudentRowId'], 1)
        self.assertEqual(payment['StudentName'], '가 학생')
        self.assert_progress(payment, 10, 4, 6)
        by_rowid = main._get_tuition_progress(1)
        by_original_id = main._get_tuition_progress(101)
        self.assertEqual(by_rowid, by_original_id)
        self.assertEqual(by_original_id['used_lessons'], 4)

    def test_missing_students_are_unknown_even_for_future_payments(self):
        self.add_payment(student_id=999)
        self.add_payment(student_id=998, start='2026-10-01')
        with patch.object(main, '_get_tuition_progress', wraps=main._get_tuition_progress) as calculate:
            rows = self.payments()
        self.assertEqual(len(rows), 2)
        calculate.assert_not_called()
        for payment in rows:
            self.assertIsNone(payment['StudentName'])
            self.assertIsNone(payment['StudentRowId'])
            self.assert_state(payment, 'unknown')

    def test_future_only_payment_has_no_progress(self):
        self.add_payment(start='2026-09-21')
        self.add_log()
        self.assert_state(self.payments()[0], 'upcoming')
        progress = main._get_tuition_progress(1)
        self.assertFalse(progress['has_payment'])
        self.assertEqual(progress['payments'], [])

    def test_missing_student_and_no_payment_return_empty_helper_result(self):
        expected = {'has_payment': False, 'total_lessons': 0, 'used_lessons': 0,
                    'next_lesson': None, 'remaining_lessons': 0, 'payments': []}
        self.assertEqual(main._get_tuition_progress(999), expected)
        self.assertEqual(main._get_tuition_progress(1), expected)

    def test_default_and_explicit_false_keep_unenriched_response(self):
        payment_id = self.add_payment(student_id=101, service=2, original_id=987)
        self.add_log()
        with patch.object(main, '_get_tuition_progress') as calculate:
            default = main.get_tuition_payments(
                current_user={'username': 'admin', 'role': 'admin'})
            explicit_false = main.get_tuition_payments(
                current_user={'username': 'admin', 'role': 'admin'}, include_progress=False)
        calculate.assert_not_called()
        self.assertEqual(default, explicit_false)
        self.assertEqual(default, {'payments': [{
            'row_id': payment_id, 'Id': 987, 'StudentId': 101,
            'ClassType': self.CLASS_TYPE, 'PaidLessons': 10, 'ServiceLessons': 2,
            'StartDate': '2026-09-01', 'PaidDate': self.TODAY, 'FeeAmount': 100000,
            'Memo': '테스트 결제', 'StudentName': '가 학생', 'StudentRowId': 1,
        }]})

    def test_progress_is_cached_once_per_student_using_shared_connection(self):
        for student_id in (1, 101, 2, 202):
            self.add_payment(student_id=student_id, start='2026-08-01')
            self.add_payment(student_id=student_id)
        with patch.object(main, '_get_tuition_progress', wraps=main._get_tuition_progress) as calculate, \
                patch.object(main, '_count_general_lesson_sessions',
                             wraps=main._count_general_lesson_sessions) as count_sessions:
            rows = self.payments()
        self.assertEqual(len(rows), 8)
        self.assertEqual(calculate.call_count, 2)
        self.assertEqual(count_sessions.call_count, 2)
        self.connection_mock.assert_called_once_with()
        self.assertEqual({call.args[0] for call in calculate.call_args_list}, {1, 2})
        borrowed = calculate.call_args_list[0].kwargs['connection']
        for call in calculate.call_args_list:
            self.assertEqual(call.args[1], self.TODAY)
            self.assertIs(call.kwargs['connection'], borrowed)
        self.assertEqual(sum(p['ProgressState'] == 'current' for p in rows), 2)
        # 연결 소유자인 목록 API가 마지막에 연결을 닫는다.
        with self.assertRaises(sqlite3.ProgrammingError):
            borrowed.execute('SELECT 1')

    def test_cache_does_not_survive_into_next_request(self):
        self.add_payment()
        self.assert_progress(self.payments()[0], 10, 0, 10)
        self.add_log()
        self.assert_progress(self.payments()[0], 10, 1, 9)

    def test_helper_borrowed_connection_stays_open_and_honors_as_of(self):
        self.add_payment(start='2026-09-01', paid=10)
        self.add_payment(start='2026-09-15', paid=20)
        self.add_log(day='2026-09-01')
        self.add_log(day='2026-09-10')
        self.add_log(day='2026-09-11')
        progress = main._get_tuition_progress(1, '2026-09-10', connection=self.conn)
        self.assertEqual(progress['payment_start'], '2026-09-01')
        self.assertEqual(progress['total_lessons'], 10)
        self.assertEqual(progress['used_lessons'], 2)
        self.assertEqual(progress['remaining_lessons'], 8)
        self.assertEqual(progress['next_lesson'], 3)
        self.assertFalse(progress['is_exhausted'])
        self.assertEqual(self.conn.execute('SELECT 1').fetchone()[0], 1)
        self.connection_mock.assert_not_called()
        # 학생 없음으로 조기 반환하여도 호출자가 제공한 연결은 유지한다.
        main._get_tuition_progress(999, connection=self.conn)
        self.assertEqual(self.conn.execute('SELECT 1').fetchone()[0], 1)

    def test_helper_owns_and_closes_its_new_connection(self):
        self.add_payment(paid=0)
        self.add_log()
        owned = self.connect()
        with patch.object(main, 'get_db_connection', return_value=owned) as factory:
            progress = main._get_tuition_progress(1)
        factory.assert_called_once_with()
        self.assertEqual(progress['remaining_lessons'], -1)
        self.assertTrue(progress['is_exhausted'])
        with self.assertRaises(sqlite3.ProgrammingError):
            owned.execute('SELECT 1')

    def test_empty_search_does_not_calculate_progress(self):
        self.add_payment()
        with patch.object(main, '_get_tuition_progress') as calculate:
            self.assertEqual(self.payments(q='없는 학생'), [])
        calculate.assert_not_called()


if __name__ == '__main__':
    unittest.main()
