"""과거 학습 기록의 수업 연결 정정: 현재 소속과 정산 권한을 분리한다.

모든 검증은 실제 데이터와 분리한 임시 SQLite 및 실제 API를 사용한다.
"""
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

import database
import main
from auth import create_access_token
from config import settings


class StudyLogClassCorrectionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.old_path = settings.SQLITE_DB_PATH
        settings.SQLITE_DB_PATH = str(Path(self.temp.name) / 'correction.db')
        conn = sqlite3.connect(settings.SQLITE_DB_PATH)
        conn.executescript('''
            CREATE TABLE Books (Id INTEGER PRIMARY KEY, Title TEXT, Author TEXT, Publisher TEXT);
            CREATE TABLE Students (Id INTEGER PRIMARY KEY, Name TEXT, Grade TEXT);
            CREATE TABLE StudyLogs (Id INTEGER PRIMARY KEY, StudentId INTEGER,
                                    BookId INTEGER, StudiedDay TEXT);
            INSERT INTO Books VALUES (1, '과거 수업 검증 도서', '', '');
            INSERT INTO Students VALUES (1, '반 이동 학생', '초3');
        ''')
        conn.commit()
        conn.close()
        database.init_system_tables()
        main.init_activity_tables()
        for username, role in [('past_teacher', 'teacher'), ('current_teacher', 'teacher'),
                               ('correction_manager', 'manager'), ('correction_subadmin', 'subadmin')]:
            database.create_user(username, '검증용 암호', role, '정정 검증 계정')
        self.sql("INSERT INTO ClassCategories(Id,Name) VALUES (1,'독서글쓰기'),(2,'토론')")
        self.sql('''INSERT INTO TeacherPayRates(CategoryId,GradeGroup,UnitAmount,EffectiveFrom)
                    VALUES (1,'초등',10000,'2026-01-01'),(2,'초등',20000,'2026-01-01')''')
        self.sql('''INSERT INTO Classes(Id,ClassName,CategoryId,TeacherUsername,DayOfWeek,StartTime,IsEnded)
                    VALUES (1,'종료된 이전 독서글쓰기반',1,'past_teacher','월','15:00',1),
                           (2,'현재 토론반',2,'current_teacher','화','15:00',0)''')
        self.sql('INSERT INTO ClassStudents(ClassId,StudentId,IsSpecial) VALUES (2,1,0)')
        self.sql('''INSERT INTO StudyLogs(Id,StudentId,BookId,StudiedDay,ClassId,
                    ActualTeacherUsername,GradeSnapshot,IsSpecial,LessonContent,Description)
                    VALUES (1,1,1,'2026-09-03',2,'current_teacher','초3',0,'과거 수업 내용','보존할 메모')''')
        self.client = TestClient(main.app, raise_server_exceptions=False)

    def tearDown(self):
        self.client.close()
        settings.SQLITE_DB_PATH = self.old_path
        self.temp.cleanup()

    def sql(self, statement, args=()):
        conn = database.get_db_connection()
        try:
            rows = conn.execute(statement, args).fetchall()
            conn.commit()
            return rows
        finally:
            conn.close()

    def row(self):
        return dict(self.sql('SELECT * FROM StudyLogs WHERE Id=1')[0])

    def memberships(self):
        return [dict(row) for row in self.sql('SELECT * FROM ClassStudents ORDER BY Id')]

    def update(self, username=None, data=None):
        username = username or settings.ADMIN_USERNAME
        payload = {'ClassId': 1, 'ActualTeacherUsername': 'past_teacher'} if data is None else data
        return self.client.put('/api/user/studylogs/1', json={'data': payload},
                               headers={'Authorization': 'Bearer ' + create_access_token({'sub': username})})

    def assert_allowed_correction(self, username):
        before = self.row()
        memberships = self.memberships()
        self.assertEqual(before['PayCategoryId'], 2)
        self.assertEqual(before['PayUnitAmount'], 20000)
        response = self.update(username)
        self.assertEqual(response.status_code, 200, response.text)
        after = self.row()
        self.assertEqual(after['ClassId'], 1)
        self.assertEqual(after['ActualTeacherUsername'], 'past_teacher')
        self.assertEqual(after['PayCategoryId'], 1)
        self.assertEqual(after['PayCategoryName'], '독서글쓰기')
        self.assertEqual(after['PayUnitAmount'], 10000)
        self.assertEqual(after['PayBasisSource'], 'corrected')
        for field in ('Id', 'StudentId', 'BookId', 'StudiedDay', 'LessonContent',
                      'Description', 'IsSpecial', 'GradeSnapshot'):
            self.assertEqual(after[field], before[field], field)
        self.assertEqual(self.memberships(), memberships)
        audit = self.sql("SELECT * FROM _app_audit_logs WHERE table_name='StudyLogs' AND action='UPDATE'")
        self.assertEqual(len(audit), 1)
        self.assertEqual(audit[0]['username'], username)
        old_data, new_data = json.loads(audit[0]['old_data']), json.loads(audit[0]['new_data'])
        self.assertEqual(old_data['ClassId'], 2)
        self.assertEqual(new_data['ClassId'], 1)
        self.assertEqual(old_data['PayUnitAmount'], 20000)
        self.assertEqual(new_data['PayUnitAmount'], 10000)
        self.assertIn('ClassId', json.loads(audit[0]['changed_fields']))

    def assert_blocked(self, expected_status, **kwargs):
        before, memberships = self.row(), self.memberships()
        audit_count = self.sql('SELECT COUNT(*) FROM _app_audit_logs')[0][0]
        response = self.update(**kwargs)
        self.assertEqual(response.status_code, expected_status, response.text)
        self.assertEqual(self.row(), before)
        self.assertEqual(self.memberships(), memberships)
        self.assertEqual(self.sql('SELECT COUNT(*) FROM _app_audit_logs')[0][0], audit_count)

    def test_admin_can_reconnect_ended_past_class_without_changing_membership(self):
        self.assert_allowed_correction(settings.ADMIN_USERNAME)

    def test_subadmin_can_reconnect_past_class(self):
        self.assert_allowed_correction('correction_subadmin')

    def test_manager_can_reconnect_past_class(self):
        self.assert_allowed_correction('correction_manager')

    def test_student_without_any_current_membership_can_reconnect(self):
        self.sql('DELETE FROM ClassStudents')
        self.assert_allowed_correction(settings.ADMIN_USERNAME)

    def test_active_past_class_without_membership_can_reconnect(self):
        self.sql('UPDATE Classes SET IsEnded=0 WHERE Id=1')
        self.assert_allowed_correction(settings.ADMIN_USERNAME)

    def test_class_only_correction_preserves_explicit_actual_teacher(self):
        response = self.update(data={'ClassId': 1})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.row()['ClassId'], 1)
        self.assertEqual(self.row()['ActualTeacherUsername'], 'current_teacher')
        self.assertEqual(self.row()['PayUnitAmount'], 10000)
        self.assertEqual(self.memberships()[0]['ClassId'], 2)

    def test_teacher_cannot_change_class_even_for_own_record(self):
        self.assert_blocked(403, username='current_teacher')

    def test_missing_target_class_is_rejected(self):
        self.assert_blocked(400, data={'ClassId': 999, 'ActualTeacherUsername': 'past_teacher'})

    def test_confirmed_payroll_line_blocks_class_correction(self):
        self.sql('''INSERT INTO TeacherPayrollLines(PayrollMonth,StudyLogId,TeacherUsername,UnitAmount,Amount)
                    VALUES ('2026-09',1,'current_teacher',20000,20000)''')
        self.assert_blocked(409)

    def test_original_actual_teacher_closed_month_blocks_correction(self):
        self.sql('''INSERT INTO TeacherPayrollClosures(PayrollMonth,TeacherUsername,ClosedBy)
                    VALUES ('2026-09','current_teacher','검증')''')
        self.assert_blocked(409)

    def test_original_class_teacher_closed_month_blocks_when_actual_teacher_empty(self):
        self.sql("UPDATE StudyLogs SET ActualTeacherUsername='' WHERE Id=1")
        self.sql('''INSERT INTO TeacherPayrollClosures(PayrollMonth,TeacherUsername,ClosedBy)
                    VALUES ('2026-09','current_teacher','검증')''')
        self.assert_blocked(409)

    def test_target_teacher_closed_month_blocks_correction(self):
        self.sql('''INSERT INTO TeacherPayrollClosures(PayrollMonth,TeacherUsername,ClosedBy)
                    VALUES ('2026-09','past_teacher','검증')''')
        self.assert_blocked(409)

    def test_original_closed_month_cannot_be_bypassed_by_changing_date(self):
        self.sql('''INSERT INTO TeacherPayrollClosures(PayrollMonth,TeacherUsername,ClosedBy)
                    VALUES ('2026-09','current_teacher','검증')''')
        self.assert_blocked(409, data={'ClassId': 1, 'ActualTeacherUsername': 'past_teacher',
                                       'StudiedDay': '2026-10-03'})


if __name__ == '__main__':
    unittest.main()
