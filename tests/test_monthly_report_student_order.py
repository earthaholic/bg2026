"""월말보고 학생 정렬은 실제 데이터 대신 메모리 DB에서 검증한다."""
import sqlite3
import unittest
from unittest.mock import patch

import main


class MonthlyReportStudentOrderTests(unittest.TestCase):
    def query(self, monthly=True, role='manager', include_ended=False):
        conn = sqlite3.connect(':memory:')
        conn.row_factory = sqlite3.Row
        conn.executescript('''
            CREATE TABLE Students(Id INTEGER, Name TEXT, IsClassEnded INTEGER);
            CREATE TABLE MonthlyReports(StudentId INTEGER, UpdatedAt TEXT, CreatedAt TEXT);
            CREATE TABLE Classes(Id INTEGER, TeacherUsername TEXT);
            CREATE TABLE ClassStudents(ClassId INTEGER, StudentId INTEGER);
            INSERT INTO Students VALUES
                (101, '가최신', 0), (102, '나오래됨', 0), (103, '다미저장', 0),
                (104, '라같은날', 0), (105, '마종료', 1), (106, '바미저장', 0);
            INSERT INTO MonthlyReports VALUES
                (1, '2026-10-05 12:00:00', '2026-09-01'),
                (1, '2026-08-01', '2026-08-01'),
                (2, '', '2026-09-01 12:00:00'),
                (4, '2026-09-01 12:00:00', '2026-08-01');
            INSERT INTO Classes VALUES (1, 'teacher1');
            INSERT INTO ClassStudents VALUES (1, 101), (1, 103);
        ''')
        with patch.object(main, 'get_db_connection', return_value=conn), patch.object(main, 'advance_student_grades'):
            return main.user_get_students_options(
                include_ended=include_ended, monthly_report_order=monthly,
                current_user={'role': role, 'username': 'teacher1'})['students']

    def test_latest_save_ascending_then_name_and_no_history_first(self):
        rows = self.query()
        self.assertEqual([r['row_id'] for r in rows], [3, 6, 2, 4, 1])
        self.assertEqual(rows[-1]['LastMonthlyReportAt'], '2026-10-05 12:00:00')

    def test_other_screens_keep_name_order(self):
        self.assertEqual([r['row_id'] for r in self.query(False)], [1, 2, 3, 4, 6])

    def test_teacher_scope_is_preserved(self):
        self.assertEqual([r['row_id'] for r in self.query(role='teacher')], [3, 1])

    def test_ended_filter_is_preserved(self):
        self.assertEqual([r['row_id'] for r in self.query(include_ended=True)], [3, 5, 6, 2, 4, 1])


if __name__ == '__main__':
    unittest.main()
