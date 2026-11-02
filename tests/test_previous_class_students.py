"""반을 옮긴 학생의 누락 기록을 이전 반 수업으로 등록하는 권한·검증을 확인한다.

실제 data.db는 사용하지 않고 테스트마다 임시 SQLite DB를 만든다.
"""
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

import database
import main
from auth import create_access_token
from config import settings
from test_studylog_permissions import create_fixture


class PreviousClassStudentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.old_path = settings.SQLITE_DB_PATH
        settings.SQLITE_DB_PATH = str(Path(self.temp.name) / 'previous.db')
        create_fixture(settings.SQLITE_DB_PATH)
        database.init_system_tables()
        main.init_activity_tables()
        for name, role in [('teacher_a', 'teacher'), ('teacher_b', 'teacher'), ('manager_a', 'manager')]:
            database.create_user(name, '검증 암호', role, name)
        self.sql('DELETE FROM StudyLogs')
        self.sql("INSERT INTO Classes(Id, ClassName, TeacherUsername, DayOfWeek) VALUES (1, '이전 반', 'teacher_a', '월'), (2, '새 반', 'teacher_b', '화')")
        # 학생 1은 이전 반 소속, 학생 3은 새 반으로 옮긴 학생이다.
        self.sql('INSERT INTO ClassStudents(ClassId, StudentId) VALUES (1, 1), (2, 3)')
        self.sql("INSERT INTO Students(Id, Name, Sex, Grade) VALUES (3, '옮긴 학생', '여', '초5')")
        # 학생 3은 이전 반 수업 기록이 3건(특강 2건) 있다.
        self.sql('''INSERT INTO StudyLogs(StudentId, BookId, StudiedDay, ClassId, IsSpecial, ActualTeacherUsername)
                    VALUES (3, 1, '2026-08-03', 1, 0, 'teacher_a'),
                           (3, 1, '2026-08-10', 1, 1, 'teacher_a'),
                           (3, 1, '2026-08-17', 1, 1, 'teacher_a')''')
        self.client = TestClient(main.app, raise_server_exceptions=False)
        self.manager_headers = self.headers_for('manager_a')
        self.teacher_headers = self.headers_for('teacher_a')

    def tearDown(self):
        self.client.close()
        settings.SQLITE_DB_PATH = self.old_path
        self.temp.cleanup()

    def headers_for(self, username):
        return {'Authorization': 'Bearer ' + create_access_token({'sub': username})}

    def sql(self, query, args=()):
        conn = database.get_db_connection()
        try:
            rows = conn.execute(query, args).fetchall()
            conn.commit()
            return rows
        finally:
            conn.close()

    def batch(self, logs, headers=None, day='2026-09-18', class_id=1):
        return self.client.post(
            f'/api/user/classes/{class_id}/studylogs',
            headers=headers or self.manager_headers,
            json={'BookIds': [1], 'StudiedDay': day, 'LessonContent': '누락 보강', 'logs': logs})

    def previous_log(self, **overrides):
        item = {'StudentId': 3, 'include': True, 'is_special': True, 'allow_not_assigned': True}
        item.update(overrides)
        return item

    def test_previous_student_requires_explicit_request(self):
        response = self.batch([{'StudentId': 3, 'include': True}])
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body['created_count'], 0)
        self.assertIn('배정되지 않은 학생', body['results'][0]['message'])
        self.assertEqual(self.sql('SELECT * FROM StudyLogs WHERE ClassId = 1 AND StudiedDay = "2026-09-18"'), [])

    def test_previous_student_record_keeps_previous_class_and_teacher(self):
        response = self.batch([self.previous_log()])
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body['created_count'], 1)
        self.assertIn('이전 반 학생', body['results'][0]['message'])
        row = dict(self.sql("SELECT * FROM StudyLogs WHERE StudentId = 3 AND StudiedDay = '2026-09-18'")[0])
        self.assertEqual(row['ClassId'], 1)
        self.assertEqual(row['ActualTeacherUsername'], 'teacher_a')
        self.assertEqual(row['IsSpecial'], 1)
        self.assertEqual(row['LessonContent'], '누락 보강')
        self.assertEqual(row['CreatedBy'], 'manager_a')
        audit = self.sql('SELECT * FROM _app_audit_logs WHERE table_name = ? AND record_id = ?', ('StudyLogs', row['Id']))
        self.assertTrue(audit)
        # 현재 소속은 변경되지 않는다.
        self.assertEqual([r['ClassId'] for r in self.sql('SELECT ClassId FROM ClassStudents WHERE StudentId = 3')], [2])

    def test_teacher_cannot_register_previous_student(self):
        response = self.batch([self.previous_log()], headers=self.teacher_headers)
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body['created_count'], 0)
        self.assertIn('배정되지 않은 학생', body['results'][0]['message'])
        self.assertEqual(self.sql("SELECT * FROM StudyLogs WHERE StudiedDay = '2026-09-18'"), [])

    def test_previous_student_cannot_be_marked_absent(self):
        response = self.batch([self.previous_log(include=False, AbsenceReason='연락 두절')])
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body['created_count'], 0)
        self.assertIn('결석으로 등록할 수 없습니다', body['results'][0]['message'])
        self.assertEqual(self.sql('SELECT * FROM StudentAbsences'), [])

    def test_unknown_student_is_rejected(self):
        response = self.batch([self.previous_log(StudentId=9999)])
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body['created_count'], 0)
        self.assertIn('학생 정보를 확인할 수 없습니다', body['results'][0]['message'])
        self.assertEqual(self.sql("SELECT * FROM StudyLogs WHERE StudiedDay = '2026-09-18'"), [])

    def test_duplicate_previous_record_is_skipped(self):
        self.batch([self.previous_log()])
        response = self.batch([self.previous_log()])
        body = response.json()
        self.assertEqual(body['created_count'], 0)
        self.assertEqual(body['skipped_count'], 1)
        rows = self.sql("SELECT * FROM StudyLogs WHERE StudiedDay = '2026-09-18'")
        self.assertEqual(len(rows), 1)

    def test_closed_payroll_month_blocks_previous_student(self):
        self.sql("INSERT INTO TeacherPayrollClosures(PayrollMonth, TeacherUsername, ClosedBy) VALUES ('2026-09', 'teacher_a', '검증')")
        response = self.batch([self.previous_log()])
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.sql("SELECT * FROM StudyLogs WHERE StudiedDay = '2026-09-18'"), [])

    def test_assigned_student_still_registers(self):
        response = self.batch([{'StudentId': 1, 'include': True}])
        body = response.json()
        self.assertEqual(body['created_count'], 1)
        self.assertNotIn('이전 반 학생', body['results'][0]['message'])

    def test_previous_student_search_suggests_lesson_type(self):
        response = self.client.get('/api/user/classes/1/previous-students?q=옮긴', headers=self.manager_headers)
        self.assertEqual(response.status_code, 200)
        students = response.json()['students']
        self.assertEqual([s['row_id'] for s in students], [3])
        self.assertEqual(students[0]['PastRecordCount'], 3)
        self.assertTrue(students[0]['SuggestedIsSpecial'])

    def test_previous_student_search_excludes_current_members(self):
        response = self.client.get('/api/user/classes/1/previous-students', headers=self.manager_headers)
        self.assertEqual(response.status_code, 200)
        self.assertNotIn(1, [s['row_id'] for s in response.json()['students']])
        self.assertIn(3, [s['row_id'] for s in response.json()['students']])

    def test_previous_student_search_without_past_records_has_no_suggestion(self):
        self.sql("INSERT INTO Students(Id, Name, Sex, Grade) VALUES (4, '기록 없는 학생', '남', '중1')")
        response = self.client.get('/api/user/classes/1/previous-students?q=기록', headers=self.manager_headers)
        self.assertEqual(response.status_code, 200)
        students = response.json()['students']
        self.assertEqual([s['row_id'] for s in students], [4])
        self.assertEqual(students[0]['PastRecordCount'], 0)
        self.assertIsNone(students[0]['SuggestedIsSpecial'])

    def test_previous_student_search_is_staff_only(self):
        response = self.client.get('/api/user/classes/1/previous-students?q=옮긴', headers=self.teacher_headers)
        self.assertEqual(response.status_code, 403)


if __name__ == '__main__':
    unittest.main()
