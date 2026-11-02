"""수업에 배정되지 않은 학생을 일괄 등록에 직접 추가하는 권한·검증을 확인한다.

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


class ClassExtraStudentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.old_path = settings.SQLITE_DB_PATH
        settings.SQLITE_DB_PATH = str(Path(self.temp.name) / 'extra.db')
        create_fixture(settings.SQLITE_DB_PATH)
        database.init_system_tables()
        main.init_activity_tables()
        for name, role in [('teacher_a', 'teacher'), ('teacher_b', 'teacher'), ('manager_a', 'manager')]:
            database.create_user(name, '검증 암호', role, name)
        self.sql('DELETE FROM StudyLogs')
        self.sql("INSERT INTO Classes(Id, ClassName, TeacherUsername, DayOfWeek) VALUES (1, 'A 수업', 'teacher_a', '월'), (2, 'B 수업', 'teacher_b', '화')")
        # 학생 1만 A 수업에 배정되어 있고, 학생 3은 배정되지 않은 학생이다.
        self.sql('INSERT INTO ClassStudents(ClassId, StudentId) VALUES (1, 1), (2, 3)')
        self.sql("INSERT INTO Students(Id, Name, Sex, Grade) VALUES (3, '추가 대상 학생', '여', '초5')")
        # 학생 3은 A 수업으로 남아 있는 기존 기록이 3건(특강 2건) 있다.
        self.sql("""INSERT INTO StudyLogs(StudentId, BookId, StudiedDay, ClassId, IsSpecial, ActualTeacherUsername)
                    VALUES (3, 1, '2026-08-03', 1, 0, 'teacher_a'),
                           (3, 1, '2026-08-10', 1, 1, 'teacher_a'),
                           (3, 1, '2026-08-17', 1, 1, 'teacher_a')""")
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

    def extra_log(self, **overrides):
        item = {'StudentId': 3, 'include': True, 'is_special': True, 'allow_not_assigned': True}
        item.update(overrides)
        return item

    def test_extra_student_requires_explicit_request(self):
        response = self.batch([{'StudentId': 3, 'include': True}])
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body['created_count'], 0)
        self.assertIn('배정되지 않은 학생', body['results'][0]['message'])
        self.assertEqual(self.sql("SELECT * FROM StudyLogs WHERE ClassId = 1 AND StudiedDay = '2026-09-18'"), [])

    def test_extra_student_record_keeps_selected_class_and_teacher(self):
        response = self.batch([self.extra_log()])
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body['created_count'], 1)
        self.assertIn('수업 미배정 학생', body['results'][0]['message'])
        row = dict(self.sql("SELECT * FROM StudyLogs WHERE StudentId = 3 AND StudiedDay = '2026-09-18'")[0])
        self.assertEqual(row['ClassId'], 1)
        self.assertEqual(row['ActualTeacherUsername'], 'teacher_a')
        self.assertEqual(row['IsSpecial'], 1)
        self.assertEqual(row['LessonContent'], '누락 보강')
        self.assertEqual(row['CreatedBy'], 'manager_a')
        audit = self.sql('SELECT * FROM _app_audit_logs WHERE table_name = ? AND record_id = ?', ('StudyLogs', row['Id']))
        self.assertTrue(audit)
        # 학생의 수업 배정은 변경되지 않는다.
        self.assertEqual([r['ClassId'] for r in self.sql('SELECT ClassId FROM ClassStudents WHERE StudentId = 3')], [2])

    def test_teacher_cannot_register_extra_student(self):
        response = self.batch([self.extra_log()], headers=self.teacher_headers)
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body['created_count'], 0)
        self.assertIn('배정되지 않은 학생', body['results'][0]['message'])
        self.assertEqual(self.sql("SELECT * FROM StudyLogs WHERE StudiedDay = '2026-09-18'"), [])

    def test_extra_student_cannot_be_marked_absent(self):
        response = self.batch([self.extra_log(include=False, AbsenceReason='연락 두절')])
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body['created_count'], 0)
        self.assertIn('결석으로 등록할 수 없습니다', body['results'][0]['message'])
        self.assertEqual(self.sql('SELECT * FROM StudentAbsences'), [])

    def test_unknown_student_is_rejected(self):
        response = self.batch([self.extra_log(StudentId=9999)])
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body['created_count'], 0)
        self.assertIn('학생 정보를 확인할 수 없습니다', body['results'][0]['message'])
        self.assertEqual(self.sql("SELECT * FROM StudyLogs WHERE StudiedDay = '2026-09-18'"), [])

    def test_duplicate_extra_record_is_skipped(self):
        self.batch([self.extra_log()])
        response = self.batch([self.extra_log()])
        body = response.json()
        self.assertEqual(body['created_count'], 0)
        self.assertEqual(body['skipped_count'], 1)
        rows = self.sql("SELECT * FROM StudyLogs WHERE StudiedDay = '2026-09-18'")
        self.assertEqual(len(rows), 1)

    def test_closed_payroll_month_blocks_extra_student(self):
        self.sql("INSERT INTO TeacherPayrollClosures(PayrollMonth, TeacherUsername, ClosedBy) VALUES ('2026-09', 'teacher_a', '검증')")
        response = self.batch([self.extra_log()])
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.sql("SELECT * FROM StudyLogs WHERE StudiedDay = '2026-09-18'"), [])

    def test_assigned_student_still_registers(self):
        response = self.batch([{'StudentId': 1, 'include': True}])
        body = response.json()
        self.assertEqual(body['created_count'], 1)
        self.assertNotIn('수업 미배정 학생', body['results'][0]['message'])

    def test_student_candidates_suggest_lesson_type(self):
        response = self.client.get('/api/user/classes/1/student-candidates?q=추가', headers=self.manager_headers)
        self.assertEqual(response.status_code, 200)
        students = response.json()['students']
        self.assertEqual([s['row_id'] for s in students], [3])
        self.assertEqual(students[0]['PastRecordCount'], 3)
        self.assertTrue(students[0]['SuggestedIsSpecial'])

    def test_student_candidates_lists_any_student(self):
        # 검색어가 없어도 추가할 수 있는 학생을 돌려주고, 이미 배정된 학생은 제외한다.
        response = self.client.get('/api/user/classes/1/student-candidates', headers=self.manager_headers)
        self.assertEqual(response.status_code, 200)
        self.assertNotIn(1, [s['row_id'] for s in response.json()['students']])
        self.assertIn(3, [s['row_id'] for s in response.json()['students']])

    def test_student_candidates_without_records_has_no_suggestion(self):
        self.sql("INSERT INTO Students(Id, Name, Sex, Grade) VALUES (4, '기록 없는 학생', '남', '중1')")
        response = self.client.get('/api/user/classes/1/student-candidates?q=기록', headers=self.manager_headers)
        self.assertEqual(response.status_code, 200)
        students = response.json()['students']
        self.assertEqual([s['row_id'] for s in students], [4])
        self.assertEqual(students[0]['PastRecordCount'], 0)
        self.assertIsNone(students[0]['SuggestedIsSpecial'])

    def test_student_candidates_is_staff_only(self):
        response = self.client.get('/api/user/classes/1/student-candidates?q=추가', headers=self.teacher_headers)
        self.assertEqual(response.status_code, 403)


if __name__ == '__main__':
    unittest.main()
