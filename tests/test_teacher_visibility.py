"""선생님 선택 목록 숨김은 임시 데이터베이스에서만 검증한다."""
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


class TeacherVisibilityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        old_path = settings.SQLITE_DB_PATH
        self.addCleanup(setattr, settings, 'SQLITE_DB_PATH', old_path)
        settings.SQLITE_DB_PATH = str(Path(self.temp.name) / 'visibility.db')
        with closing(sqlite3.connect(settings.SQLITE_DB_PATH)) as conn:
            conn.executescript('''
                CREATE TABLE Books (Id INTEGER UNIQUE, Title TEXT, Author TEXT, Publisher TEXT);
                CREATE TABLE Students (Id INTEGER UNIQUE, Name TEXT, Grade TEXT);
                CREATE TABLE StudyLogs (Id INTEGER UNIQUE, StudentId INTEGER, BookId INTEGER, StudiedDay TEXT);
                INSERT INTO Books VALUES (101, '검증 도서', '', '');
                INSERT INTO Students VALUES (201, '검증 학생', '초3');
            ''')
        database.init_system_tables()
        main.init_activity_tables()
        self.ids = {}
        for username, role in [('visible_teacher', 'teacher'), ('hidden_teacher', 'teacher'),
                               ('visibility_manager', 'manager'), ('visibility_subadmin', 'subadmin')]:
            self.ids[username] = database.create_user(username, '검증암호', role, username)['id']
        self.sql('''INSERT INTO Classes(Id,ClassName,TeacherUsername,DayOfWeek)
                    VALUES (1,'기존 수업','hidden_teacher','금')''')
        self.sql('INSERT INTO ClassStudents(ClassId,StudentId) VALUES (1,201)')
        self.sql('''INSERT INTO StudyLogs(Id,StudentId,BookId,StudiedDay,ClassId,ActualTeacherUsername,LessonContent)
                    VALUES (501,201,101,'2026-09-18',1,'hidden_teacher','기존 내용'),
                           (502,201,101,'2026-09-19',1,'','')''')
        self.client = TestClient(main.app, raise_server_exceptions=False)
        self.addCleanup(self.client.close)

    def sql(self, statement, args=()):
        with closing(database.get_db_connection()) as conn:
            rows = conn.execute(statement, args).fetchall()
            conn.commit()
            return [dict(row) for row in rows]

    def headers(self, actor=None):
        return {'Authorization': 'Bearer ' + create_access_token({'sub': actor or settings.ADMIN_USERNAME})}

    def toggle(self, hidden, actor=None, user_id=None):
        user_id = self.ids['hidden_teacher'] if user_id is None else user_id
        return self.client.put(f'/api/admin/users/{user_id}/teacher-visibility',
                               headers=self.headers(actor), json={'hidden_from_teacher_options': hidden})

    def options(self):
        response = self.client.get('/api/user/teachers-options', headers=self.headers())
        self.assertEqual(response.status_code, 200)
        return [t['username'] for t in response.json()['teachers']]

    def test_default_hide_restore_and_all_eligible_roles(self):
        self.assertEqual(set(self.options()), set(self.ids))
        for name, user_id in self.ids.items():
            self.assertEqual(self.toggle(True, user_id=user_id).status_code, 200)
            self.assertNotIn(name, self.options())
        self.assertEqual(self.options(), [])
        for name, user_id in self.ids.items():
            self.assertEqual(self.toggle(False, user_id=user_id).status_code, 200)
            self.assertIn(name, self.options())

    def test_admin_list_names_auth_and_existing_records_unchanged(self):
        before_class = self.sql('SELECT * FROM Classes')
        before_logs = self.sql('SELECT * FROM StudyLogs')
        self.assertEqual(self.toggle(True).status_code, 200)
        users = self.client.get('/api/admin/users', headers=self.headers()).json()['users']
        target = next(u for u in users if u['username'] == 'hidden_teacher')
        self.assertEqual(target['hidden_from_teacher_options'], 1)
        self.assertNotIn('password_hash', target)
        names = self.client.get('/api/user/display-names', headers=self.headers()).json()['names']
        self.assertEqual(names['hidden_teacher'], 'hidden_teacher')
        own_options = self.client.get('/api/user/teachers-options', headers=self.headers('hidden_teacher'))
        self.assertEqual(own_options.status_code, 200)
        login = self.client.post('/api/auth/login', json={'username': 'hidden_teacher', 'password': '검증암호'})
        self.assertEqual(login.status_code, 200)
        self.assertEqual(self.sql('SELECT * FROM Classes'), before_class)
        self.assertEqual(self.sql('SELECT * FROM StudyLogs'), before_logs)

    def test_completion_uses_same_hidden_filter(self):
        self.toggle(True)
        response = self.client.get('/api/user/studylog-completion', headers=self.headers(),
                                   params={'student_id': 1, 'field': 'teacher'})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertNotIn('hidden_teacher', [t['username'] for t in response.json()['teachers']])
        self.assertIn('visible_teacher', [t['username'] for t in response.json()['teachers']])

    def test_permissions_and_request_validation(self):
        for actor in ('visible_teacher', 'visibility_manager'):
            self.assertEqual(self.toggle(True, actor=actor).status_code, 403)
        self.assertEqual(self.toggle(True, actor='visibility_subadmin').status_code, 200)
        self.assertEqual(self.toggle(False, actor='visibility_subadmin').status_code, 200)
        self.assertEqual(self.toggle(True, user_id=999999).status_code, 404)
        admin_id = database.get_user_by_username(settings.ADMIN_USERNAME)['id']
        self.assertEqual(self.toggle(True, user_id=admin_id).status_code, 400)
        for invalid in ('true', 1, None, {}, []):
            self.assertEqual(self.toggle(invalid).status_code, 422)
        unauth = self.client.put(f"/api/admin/users/{self.ids['hidden_teacher']}/teacher-visibility",
                                 json={'hidden_from_teacher_options': True})
        self.assertEqual(unauth.status_code, 401)

    def test_atomic_audit_without_credentials_and_idempotency(self):
        self.assertEqual(self.toggle(True).status_code, 200)
        audits = self.sql("SELECT * FROM _app_audit_logs WHERE table_name='_app_users'")
        self.assertEqual(len(audits), 1)
        self.assertEqual(json.loads(audits[0]['changed_fields']), ['hidden_from_teacher_options'])
        self.assertEqual(json.loads(audits[0]['old_data'])['hidden_from_teacher_options'], 0)
        self.assertEqual(json.loads(audits[0]['new_data'])['hidden_from_teacher_options'], 1)
        self.assertNotIn('password', audits[0]['old_data'])
        self.assertNotIn('password', audits[0]['new_data'])
        self.toggle(True)
        self.assertEqual(len(self.sql("SELECT * FROM _app_audit_logs WHERE table_name='_app_users'")), 1)
        with patch('main.write_audit_log', side_effect=RuntimeError('감사 검증 실패')):
            self.assertEqual(self.toggle(False).status_code, 500)
        self.assertEqual(database.get_user_by_id(self.ids['hidden_teacher'])['hidden_from_teacher_options'], 1)

    def test_migration_adds_visible_default_and_preserves_accounts(self):
        with closing(database.get_db_connection()) as conn:
            conn.executescript('''
                ALTER TABLE _app_users RENAME TO _app_users_before_test;
                CREATE TABLE _app_users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL, role TEXT NOT NULL
                    CHECK(role IN ('admin','subadmin','manager','teacher')),
                    name TEXT NOT NULL DEFAULT '', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
                INSERT INTO _app_users(id, username, password_hash, role, name, created_at)
                    SELECT id, username, password_hash, role, name, created_at FROM _app_users_before_test;
                DROP TABLE _app_users_before_test;
            ''')
        database.init_system_tables()
        self.assertEqual(set(self.options()), set(self.ids))
        self.toggle(True)
        database.init_system_tables()
        self.assertNotIn('hidden_teacher', self.options())
        self.assertEqual(database.get_user_by_id(self.ids['hidden_teacher'])['name'], 'hidden_teacher')


if __name__ == '__main__':
    unittest.main()
