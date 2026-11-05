"""수업 간 학생 이동 API의 권한·검증·감사 기록을 확인한다.

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


class ClassStudentMoveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.old_path = settings.SQLITE_DB_PATH
        settings.SQLITE_DB_PATH = str(Path(self.temp.name) / 'class_student_move.db')
        create_fixture(settings.SQLITE_DB_PATH)
        database.init_system_tables()
        main.init_activity_tables()
        for name, role in [('teacher_a', 'teacher'), ('manager_a', 'manager')]:
            database.create_user(name, '검증 암호', role, name)
        self.sql("INSERT INTO Classes(Id, ClassName, TeacherUsername, DayOfWeek, IsEnded) "
                 "VALUES (1, '월요일 반', 'teacher_a', '월', 0)")
        self.sql("INSERT INTO Classes(Id, ClassName, TeacherUsername, DayOfWeek, IsEnded) "
                 "VALUES (2, '수요일 반', 'teacher_a', '수', 0)")
        self.sql("INSERT INTO Classes(Id, ClassName, TeacherUsername, DayOfWeek, IsEnded) "
                 "VALUES (3, '종강한 반', 'teacher_a', '금', 1)")
        self.sql('INSERT INTO ClassStudents(ClassId, StudentId, IsSpecial) VALUES (1, 1, 0)')
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

    def move(self, target_class_id=2, student_id=1, username='manager_a', class_id=1):
        return self.client.post(
            f'/api/user/classes/{class_id}/students/move',
            headers=self.headers_for(username),
            json={'StudentId': student_id, 'TargetClassId': target_class_id}
        )

    def assignments(self):
        return {row['ClassId']: row['IsSpecial'] for row in self.sql('SELECT ClassId, IsSpecial FROM ClassStudents')}

    def test_manager_moves_student_between_classes(self):
        response = self.move()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.assignments(), {2: 0})
        self.assertIn('수요일 반', response.json()['message'])

    def test_move_keeps_special_flag(self):
        self.sql('UPDATE ClassStudents SET IsSpecial = 1 WHERE ClassId = 1')
        response = self.move()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.assignments(), {2: 1})
        self.assertEqual(response.json()['is_special'], 1)

    def test_target_class_with_existing_assignment_is_rejected(self):
        self.sql('INSERT INTO ClassStudents(ClassId, StudentId, IsSpecial) VALUES (2, 1, 0)')
        response = self.move()
        self.assertEqual(response.status_code, 400, response.text)
        self.assertIn('이미 이동할 수업에 배정된 학생입니다', response.json()['detail'])
        self.assertEqual(self.assignments(), {1: 0, 2: 0})

    def test_ended_target_class_is_rejected(self):
        response = self.move(target_class_id=3)
        self.assertEqual(response.status_code, 400, response.text)
        self.assertIn('종강', response.json()['detail'])
        self.assertEqual(self.assignments(), {1: 0})

    def test_teacher_cannot_move_students(self):
        response = self.move(username='teacher_a')
        self.assertEqual(response.status_code, 403, response.text)
        self.assertEqual(self.assignments(), {1: 0})

    def test_student_must_belong_to_source_class(self):
        response = self.move(student_id=2)
        self.assertEqual(response.status_code, 400, response.text)
        self.assertIn('배정된 학생이 아닙니다', response.json()['detail'])

    def test_same_class_is_rejected(self):
        response = self.move(target_class_id=1)
        self.assertEqual(response.status_code, 400, response.text)

    def test_audit_log_records_class_change(self):
        response = self.move()
        self.assertEqual(response.status_code, 200, response.text)
        rows = self.sql(
            "SELECT table_name, record_id, action, old_data, new_data FROM _app_audit_logs "
            "WHERE table_name = 'ClassStudents' ORDER BY id DESC LIMIT 1"
        )
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['record_id'], '1')
        self.assertEqual(rows[0]['action'], 'UPDATE')
        self.assertIn('"ClassId": 1', rows[0]['old_data'])
        self.assertIn('"ClassId": 2', rows[0]['new_data'])


if __name__ == '__main__':
    unittest.main()
