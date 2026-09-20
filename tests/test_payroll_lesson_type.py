"""정산 화면의 특강 구분을 실제 데이터 변경 없이 검증한다."""
import sqlite3
import unittest
import uuid
from unittest.mock import patch

import main


class PayrollLessonTypeTests(unittest.TestCase):
    def setUp(self):
        self.uri = 'file:payroll_type_{}?mode=memory&cache=shared'.format(uuid.uuid4().hex)
        self.conn = self.connect()
        self.addCleanup(self.conn.close)
        connection_patch = patch.object(main, 'get_db_connection', side_effect=self.connect)
        connection_patch.start()
        self.addCleanup(connection_patch.stop)
        self.conn.executescript('''
            CREATE TABLE Students (Id INTEGER PRIMARY KEY, Name TEXT, Grade TEXT);
            CREATE TABLE Classes (Id INTEGER PRIMARY KEY, ClassName TEXT, CategoryId INTEGER, TeacherUsername TEXT);
            CREATE TABLE ClassStudents (ClassId INTEGER, StudentId INTEGER, IsSpecial INTEGER);
            CREATE TABLE ClassCategories (Id INTEGER PRIMARY KEY, Name TEXT);
            CREATE TABLE StudyLogs (Id INTEGER PRIMARY KEY, StudentId INTEGER, ClassId INTEGER,
                PayrollCategoryId INTEGER, StudiedDay TEXT, IsSpecial INTEGER, GradeSnapshot TEXT,
                ActualTeacherUsername TEXT, SubstituteStatus TEXT);
            CREATE TABLE TeacherPayrollClosures (PayrollMonth TEXT, TeacherUsername TEXT);
            CREATE TABLE TeacherPayrollLines (PayrollMonth TEXT, StudyLogId INTEGER,
                TeacherUsername TEXT, UnitAmount INTEGER, Amount INTEGER, Reason TEXT);
            CREATE TABLE TeacherPayRates (CategoryId INTEGER, GradeGroup TEXT, EffectiveFrom TEXT, UnitAmount INTEGER);
            CREATE TABLE SpecialLessonPayRates (EffectiveFrom TEXT, UnitAmount INTEGER);
            CREATE TABLE TeacherPayrollClaims (Id INTEGER, PayrollMonth TEXT, TeacherUsername TEXT, ClaimDate TEXT);
            CREATE TABLE BookMaterialRequests (BookId INTEGER, Status TEXT, PayrollMonth TEXT, RequestedBy TEXT);
            CREATE TABLE Books (Id INTEGER PRIMARY KEY, Title TEXT);
            INSERT INTO Students VALUES (1, '일반 학생', '초3'), (2, '특강 학생', '초3'), (3, '결석 학생', '초3');
            INSERT INTO Classes VALUES (1, '검증반', 1, 'teacher1');
            INSERT INTO ClassStudents VALUES (1, 1, 0), (1, 2, 1), (1, 3, 1);
            INSERT INTO ClassCategories VALUES (1, '독서');
            INSERT INTO StudyLogs VALUES (1, 1, 1, NULL, '2026-09-01', 0, '초3', 'teacher1', 'approved'),
                (2, 2, 1, NULL, '2026-09-01', 1, '초3', 'teacher1', 'approved');
            INSERT INTO TeacherPayRates VALUES (1, '초등', '2026-01-01', 10000);
            INSERT INTO SpecialLessonPayRates VALUES ('2026-01-01', 5000);
        ''')
        self.conn.commit()

    def connect(self):
        conn = sqlite3.connect(self.uri, uri=True)
        conn.row_factory = sqlite3.Row
        return conn

    def test_open_payroll_keeps_lesson_types_and_amounts(self):
        rows = main._payroll_rows('2026-09', 'teacher1')
        self.assertEqual([r['IsSpecial'] for r in rows], [0, 1])
        self.assertEqual([r['Amount'] for r in rows], [10000, 5000])

    def test_closed_payroll_uses_frozen_type_even_if_log_changes(self):
        self.conn.executescript('''
            INSERT INTO TeacherPayrollClosures VALUES ('2026-09', 'teacher1');
            INSERT INTO TeacherPayrollLines VALUES
                ('2026-09', 1, 'teacher1', 10000, 10000, '초등 일반 수업'),
                ('2026-09', 2, 'teacher1', 5000, 5000, '특강 학생수당');
            UPDATE StudyLogs SET IsSpecial = 1 - IsSpecial;
        ''')
        self.conn.commit()
        rows = main._payroll_rows('2026-09', 'teacher1')
        self.assertEqual([r['IsSpecial'] for r in rows], [0, 1])
        self.assertEqual([r['Amount'] for r in rows], [10000, 5000])

    def test_roster_supplies_type_for_students_without_logs(self):
        data = main.get_payroll('2026-09', 'teacher1', {'username': 'admin', 'role': 'admin'})
        roster = {r['StudentRowId']: r for r in data['team_students']}
        self.assertEqual(roster[1]['IsSpecial'], 0)
        self.assertEqual(roster[2]['IsSpecial'], 1)
        self.assertEqual(roster[3]['IsSpecial'], 1)
        self.assertEqual(data['totals'], {'teacher1': 15000})


if __name__ == '__main__':
    unittest.main()
