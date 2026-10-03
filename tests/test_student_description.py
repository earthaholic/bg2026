"""학생 특이사항 전용 수정 API는 임시 데이터베이스에서만 검증한다."""
import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

import database
import main
from auth import create_access_token
from config import settings


class StudentDescriptionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        old_path = settings.SQLITE_DB_PATH
        self.addCleanup(setattr, settings, 'SQLITE_DB_PATH', old_path)
        settings.SQLITE_DB_PATH = str(Path(self.temp.name) / 'student_description.db')
        with closing(sqlite3.connect(settings.SQLITE_DB_PATH)) as conn:
            conn.executescript('''
                CREATE TABLE Books (Id INTEGER UNIQUE, Title TEXT, Author TEXT, Publisher TEXT);
                CREATE TABLE Students (
                    Id INTEGER UNIQUE, Name TEXT, Grade TEXT, Description TEXT,
                    UpdatedBy TEXT DEFAULT '', UpdatedAt TEXT DEFAULT ''
                );
                CREATE TABLE StudyLogs (Id INTEGER UNIQUE, StudentId INTEGER, BookId INTEGER, StudiedDay TEXT);
                INSERT INTO Students(Id, Name, Grade, Description)
                    VALUES (201, '검증 학생', '초3', '기존 특이사항');
            ''')
        database.init_system_tables()
        main.init_activity_tables()
        database.create_user('description_teacher', '검증암호', 'teacher', '선생님')
        database.create_user('description_manager', '검증암호', 'manager', '관리 선생님')
        self.client = TestClient(main.app, raise_server_exceptions=False)
        self.addCleanup(self.client.close)

    def sql(self, statement, args=()):
        with closing(database.get_db_connection()) as conn:
            rows = conn.execute(statement, args).fetchall()
            conn.commit()
            return [dict(row) for row in rows]

    def headers(self, actor):
        return {'Authorization': 'Bearer ' + create_access_token({'sub': actor})}

    def description(self):
        return self.sql('SELECT rowid, Description, UpdatedBy FROM Students WHERE rowid = 1')[0]

    def update_description(self, actor, description, original='기존 특이사항'):
        return self.client.put('/api/user/students/1/description', headers=self.headers(actor), json={
            'Description': description,
            'original_description': original,
        })

    def test_teacher_and_staff_can_update_description_with_audit(self):
        teacher = self.update_description('description_teacher', '선생님 수정')
        self.assertEqual(teacher.status_code, 200, teacher.text)
        self.assertEqual(self.description()['Description'], '선생님 수정')
        self.assertEqual(self.description()['UpdatedBy'], 'description_teacher')
        manager = self.update_description('description_manager', '관리 선생님 수정', '선생님 수정')
        self.assertEqual(manager.status_code, 200, manager.text)
        self.assertEqual(self.description()['Description'], '관리 선생님 수정')
        audits = self.sql("SELECT old_data, new_data, changed_fields, username FROM _app_audit_logs WHERE table_name = 'Students' ORDER BY id")
        self.assertEqual(len(audits), 2)
        self.assertEqual(json.loads(audits[0]['changed_fields']), ['Description'])
        self.assertEqual(json.loads(audits[0]['old_data'])['Description'], '기존 특이사항')
        self.assertEqual(json.loads(audits[1]['new_data'])['Description'], '관리 선생님 수정')
        self.assertEqual(audits[1]['username'], 'description_manager')

    def test_rejects_other_fields_and_teacher_cannot_use_full_student_update(self):
        response = self.client.put('/api/user/students/1/description', headers=self.headers('description_teacher'), json={
            'Description': '변경 시도', 'original_description': '기존 특이사항', 'Name': '변경 금지',
        })
        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.description()['Description'], '기존 특이사항')
        full_update = self.client.put('/api/user/students/1', headers=self.headers('description_teacher'), json={
            'data': {'Description': '전체 수정 차단'},
        })
        self.assertEqual(full_update.status_code, 403)
        self.assertEqual(self.description()['Description'], '기존 특이사항')

    def test_rejects_concurrent_edit_and_missing_rowid(self):
        self.assertEqual(self.update_description('description_teacher', '먼저 저장').status_code, 200)
        conflict = self.update_description('description_manager', '나중 저장', '기존 특이사항')
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(self.description()['Description'], '먼저 저장')
        missing = self.client.put('/api/user/students/999999/description', headers=self.headers('description_teacher'), json={
            'Description': '없음', 'original_description': '',
        })
        self.assertEqual(missing.status_code, 404)

    def test_empty_string_deletes_description(self):
        response = self.update_description('description_teacher', '')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.description()['Description'], '')
        audit = self.sql("SELECT old_data, new_data FROM _app_audit_logs WHERE table_name = 'Students'")[0]
        self.assertEqual(json.loads(audit['old_data'])['Description'], '기존 특이사항')
        self.assertEqual(json.loads(audit['new_data'])['Description'], '')

    def test_audit_failure_rolls_back_description_change(self):
        with patch('main.write_audit_log', side_effect=RuntimeError('감사 저장 실패')):
            response = self.update_description('description_teacher', '저장되면 안 됨')
        self.assertEqual(response.status_code, 500)
        self.assertEqual(self.description()['Description'], '기존 특이사항')
        self.assertEqual(self.sql("SELECT * FROM _app_audit_logs WHERE table_name = 'Students'"), [])

    def test_requires_login(self):
        response = self.client.put('/api/user/students/1/description', json={
            'Description': '비로그인', 'original_description': '기존 특이사항',
        })
        self.assertEqual(response.status_code, 401)
        self.assertEqual(self.description()['Description'], '기존 특이사항')


if __name__ == '__main__':
    unittest.main()
