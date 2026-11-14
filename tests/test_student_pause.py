"""학생 휴강 상태 저장과 일괄 등록 자동 제외를 확인한다.

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


class StudentPauseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.old_path = settings.SQLITE_DB_PATH
        settings.SQLITE_DB_PATH = str(Path(self.temp.name) / 'student_pause.db')
        create_fixture(settings.SQLITE_DB_PATH)
        database.init_system_tables()
        main.init_activity_tables()
        for name, role in [('teacher_a', 'teacher'), ('manager_a', 'manager')]:
            database.create_user(name, '검증 암호', role, name)
        self.sql("INSERT INTO Classes(Id, ClassName, TeacherUsername, DayOfWeek, IsEnded) "
                 "VALUES (1, '월요일 반', 'teacher_a', '월', 0)")
        self.sql('INSERT INTO ClassStudents(ClassId, StudentId, IsSpecial) VALUES (1, 1, 0)')
        # 둘째 학생은 다른 선생님 반에만 배정되어 있다.
        self.sql("INSERT INTO Classes(Id, ClassName, TeacherUsername, DayOfWeek, IsEnded) "
                 "VALUES (2, '다른 선생님 반', 'teacher_b', '수', 0)")
        self.sql('INSERT INTO ClassStudents(ClassId, StudentId, IsSpecial) VALUES (2, 2, 0)')
        self.client = TestClient(main.app, raise_server_exceptions=False)

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

    def set_paused(self, value=1, student_id=1, username='manager_a'):
        return self.client.put(
            f'/api/user/students/{student_id}',
            headers=self.headers_for(username),
            json={'data': {'IsPaused': value}}
        )

    def pause_via_endpoint(self, value=1, student_id=1, username='manager_a'):
        return self.client.post(
            f'/api/user/students/{student_id}/pause',
            headers=self.headers_for(username),
            json={'IsPaused': bool(value)}
        )

    def test_teacher_toggles_pause_for_own_class_student(self):
        response = self.pause_via_endpoint(1, student_id=1, username='teacher_a')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.sql('SELECT "IsPaused" FROM "Students" WHERE rowid = 1')[0]['IsPaused'], 1)
        again = self.pause_via_endpoint(0, student_id=1, username='teacher_a')
        self.assertEqual(again.status_code, 200, again.text)
        self.assertEqual(self.sql('SELECT "IsPaused" FROM "Students" WHERE rowid = 1')[0]['IsPaused'], 0)

    def test_teacher_cannot_toggle_pause_for_other_class_student(self):
        response = self.pause_via_endpoint(1, student_id=2, username='teacher_a')
        self.assertEqual(response.status_code, 403, response.text)
        self.assertEqual(self.sql('SELECT "IsPaused" FROM "Students" WHERE rowid = 2')[0]['IsPaused'], 0)

    def test_manager_toggles_pause_for_any_student(self):
        response = self.pause_via_endpoint(1, student_id=2, username='manager_a')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.sql('SELECT "IsPaused" FROM "Students" WHERE rowid = 2')[0]['IsPaused'], 1)

    def test_pause_toggle_is_audited(self):
        self.assertEqual(self.pause_via_endpoint(1, student_id=1, username='teacher_a').status_code, 200)
        rows = self.sql(
            "SELECT table_name, record_id, action FROM _app_audit_logs "
            "WHERE table_name = 'Students' ORDER BY id DESC LIMIT 1"
        )
        self.assertEqual(rows[0]['record_id'], '1')
        self.assertEqual(rows[0]['action'], 'UPDATE')

    def batch(self, include, username='manager_a', day='2026-07-11'):
        return self.client.post(
            '/api/user/classes/1/studylogs',
            headers=self.headers_for(username),
            json={'BookIds': [1], 'StudiedDay': day, 'LessonContent': '휴강 검증',
                  'logs': [{'StudentId': 1, 'include': include}]}
        )

    def test_pause_flag_is_saved_on_student(self):
        response = self.set_paused(1)
        self.assertEqual(response.status_code, 200, response.text)
        row = self.sql('SELECT "IsPaused" FROM "Students" WHERE rowid = 1')[0]
        self.assertEqual(row['IsPaused'], 1)

    def test_batch_skips_absence_for_paused_student(self):
        self.assertEqual(self.set_paused(1).status_code, 200)
        response = self.batch(False)
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body['paused_count'], 1)
        self.assertEqual(body['absence_count'], 0)
        self.assertEqual(body['results'][0]['status'], 'paused')
        self.assertEqual(len(self.sql('SELECT * FROM "StudentAbsences"')), 0)
        self.assertEqual(len(self.sql('SELECT * FROM "StudyLogs" WHERE "StudiedDay" = \'2026-07-11\'')), 0)

    def test_paused_student_can_be_registered_as_makeup_lesson(self):
        self.assertEqual(self.set_paused(1).status_code, 200)
        response = self.batch(True)
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body['created_count'], 1)
        self.assertEqual(len(self.sql('SELECT * FROM "StudyLogs" WHERE "StudiedDay" = \'2026-07-11\'')), 1)

    def test_unchecked_active_student_is_still_absent(self):
        response = self.batch(False)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['absence_count'], 1)
        self.assertEqual(len(self.sql('SELECT * FROM "StudentAbsences"')), 1)

    def test_teacher_cannot_change_pause_flag(self):
        response = self.set_paused(1, username='teacher_a')
        self.assertEqual(response.status_code, 403, response.text)


if __name__ == '__main__':
    unittest.main()

