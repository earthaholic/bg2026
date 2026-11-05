"""수업 종강 여부 변경 API의 권한·감사 기록을 확인한다.

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


class ClassEndedTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.old_path = settings.SQLITE_DB_PATH
        settings.SQLITE_DB_PATH = str(Path(self.temp.name) / 'class_ended.db')
        create_fixture(settings.SQLITE_DB_PATH)
        database.init_system_tables()
        main.init_activity_tables()
        for name, role in [('teacher_a', 'teacher'), ('manager_a', 'manager')]:
            database.create_user(name, '검증 암호', role, name)
        self.sql("INSERT INTO Classes(Id, ClassName, TeacherUsername, DayOfWeek, IsEnded) "
                 "VALUES (1, 'A 수업', 'teacher_a', '월', 0)")
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

    def set_ended(self, value, username='manager_a', class_id=1):
        return self.client.put(
            f'/api/user/classes/{class_id}/ended',
            headers=self.headers_for(username),
            json={'IsEnded': value}
        )

    def test_manager_toggles_class_ended_and_audit_is_recorded(self):
        response = self.set_ended(True)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['IsEnded'], 1)
        detail = self.client.get('/api/user/classes/1', headers=self.headers_for('manager_a'))
        self.assertEqual(detail.json()['class_']['IsEnded'], 1)

        logs = self.sql("SELECT changed_fields FROM _app_audit_logs "
                        "WHERE table_name = 'Classes' AND record_id = '1'")
        self.assertTrue(any('IsEnded' in (row['changed_fields'] or '') for row in logs))

        again = self.set_ended(False)
        self.assertEqual(again.status_code, 200, again.text)
        self.assertEqual(again.json()['IsEnded'], 0)

    def test_teacher_cannot_change_class_ended(self):
        response = self.set_ended(True, username='teacher_a')
        self.assertEqual(response.status_code, 403, response.text)
        rows = self.sql("SELECT IsEnded FROM Classes WHERE Id = 1")
        self.assertEqual(rows[0]['IsEnded'], 0)

    def test_unknown_class_returns_404(self):
        response = self.set_ended(True, class_id=99)
        self.assertEqual(response.status_code, 404, response.text)


if __name__ == '__main__':
    unittest.main()
