"""두 등록 화면의 중복 기준과 저장 원자성을 임시 DB에서 검증한다."""
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
import database
import main
from auth import create_access_token
from config import settings
from test_studylog_permissions import create_fixture


class StudyLogRegistrationDuplicateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.old_path = settings.SQLITE_DB_PATH
        settings.SQLITE_DB_PATH = str(Path(self.temp.name) / 'duplicates.db')
        create_fixture(settings.SQLITE_DB_PATH)
        database.init_system_tables()
        main.init_activity_tables()
        for name, role in [('teacher_a', 'teacher'), ('teacher_b', 'teacher'), ('manager_a', 'manager')]:
            database.create_user(name, '검증 암호', role, name)
        self.sql('DELETE FROM StudyLogs')
        self.sql("INSERT INTO Classes(Id, ClassName, TeacherUsername, DayOfWeek) VALUES (1, 'A', 'teacher_a', '월'), (2, 'B', 'teacher_b', '화'), (3, 'C', 'teacher_a', '수')")
        self.sql('INSERT INTO ClassStudents(ClassId, StudentId) VALUES (1, 1), (1, 2), (2, 1), (3, 1)')
        self.sql("INSERT INTO Books(Id, Title) VALUES (2, '다른 도서')")
        self.client = TestClient(main.app, raise_server_exceptions=False)
        self.headers = {'Authorization': 'Bearer ' + create_access_token({'sub': 'manager_a'})}

    def tearDown(self):
        self.client.close()
        settings.SQLITE_DB_PATH = self.old_path
        self.temp.cleanup()

    def sql(self, query, args=()):
        conn = database.get_db_connection()
        try:
            rows = conn.execute(query, args).fetchall()
            conn.commit()
            return rows
        finally:
            conn.close()

    def individual(self, **overrides):
        payload = {'StudentId': 1, 'BookId': 1, 'StudiedDay': '2026-09-18',
                   'ActualTeacherUsername': 'teacher_a', 'LessonContent': '토론'}
        payload.update(overrides)
        return self.client.post('/api/user/studylogs', headers=self.headers, json=payload)

    def batch(self, class_id=1, **overrides):
        payload = {'BookIds': [1], 'StudiedDay': '2026-09-18',
                   'LessonContent': '토론', 'logs': [{'StudentId': 1, 'include': True}]}
        payload.update(overrides)
        return self.client.post(f'/api/user/classes/{class_id}/studylogs', headers=self.headers, json=payload)

    def test_individual_repeat_rejected_even_if_content_or_special_changes(self):
        self.assertEqual(self.individual().status_code, 200)
        response = self.individual(LessonContent='다른 내용', IsSpecial=True)
        self.assertEqual(response.status_code, 409, response.text)
        self.assertIn('이미 등록', response.json()['detail'])
        self.assertEqual(len(self.sql('SELECT * FROM StudyLogs')), 1)
        self.assertEqual(len(self.sql("SELECT * FROM _app_audit_logs WHERE table_name='StudyLogs'")), 1)

    def test_each_key_can_differ(self):
        self.assertEqual(self.individual().status_code, 200)
        for change in [{'StudentId': 2}, {'BookId': 2}, {'StudiedDay': '2026-09-19'},
                       {'ActualTeacherUsername': 'teacher_b'}]:
            response = self.individual(**change)
            self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(self.sql('SELECT * FROM StudyLogs')), 5)

    def test_cross_registration_paths_and_other_class_same_teacher(self):
        self.assertEqual(self.batch().json()['created_count'], 1)
        self.assertEqual(self.individual().status_code, 409)
        response = self.batch(class_id=3)
        self.assertEqual(response.json()['created_count'], 0, response.text)
        self.assertEqual(response.json()['skipped_count'], 1)
        self.assertEqual(self.batch(class_id=2).json()['created_count'], 1)

    def test_individual_then_batch_and_substitute_teacher(self):
        self.individual()
        self.assertEqual(self.batch().json()['skipped_count'], 1)
        response = self.batch(ActualTeacherUsername='teacher_b')
        self.assertEqual(response.json()['created_count'], 1, response.text)
        self.assertEqual(self.batch(ActualTeacherUsername='teacher_b').json()['skipped_count'], 1)

    def test_legacy_teacher_fallback_and_actual_teacher_precedence(self):
        self.sql("INSERT INTO StudyLogs(StudentId, BookId, StudiedDay, ClassId, ActualTeacherUsername) VALUES (1, 1, '2026-09-18', 1, '   ')")
        self.assertEqual(self.individual().status_code, 409)
        self.sql("UPDATE StudyLogs SET ActualTeacherUsername='teacher_b'")
        self.assertEqual(self.individual().status_code, 200)
        self.assertEqual(self.individual(ActualTeacherUsername='teacher_b').status_code, 409)

    def test_missing_teacher_matches_missing_teacher(self):
        self.assertEqual(self.individual(ActualTeacherUsername='').status_code, 200)
        self.assertEqual(self.individual(ActualTeacherUsername='').status_code, 409)
        self.assertEqual(self.individual().status_code, 200)

    def test_multi_student_duplicate_rolls_back_prior_insert_and_audit(self):
        self.individual(StudentId=2)
        response = self.individual(StudentIds=[1, 2])
        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(len(self.sql('SELECT * FROM StudyLogs')), 1)
        self.assertEqual(len(self.sql("SELECT * FROM _app_audit_logs WHERE table_name='StudyLogs'")), 1)

    def test_audit_failure_rolls_back_individual(self):
        with patch.object(main, 'write_audit_log', side_effect=RuntimeError('감사 실패')):
            self.assertEqual(self.individual().status_code, 400)
        self.assertFalse(self.sql('SELECT * FROM StudyLogs'))

    def test_batch_skips_duplicate_but_registers_other_book(self):
        self.individual()
        response = self.batch(BookIds=[1, 2])
        self.assertEqual(response.json()['created_count'], 1, response.text)
        self.assertEqual(response.json()['skipped_count'], 1)

    def test_domain_id_aliases_match_existing_records(self):
        # Oracle 원본 ID와 SQLite rowid가 다른 도메인 테이블을 재현한다.
        self.sql('ALTER TABLE Students RENAME TO OldStudents')
        self.sql('CREATE TABLE Students AS SELECT * FROM OldStudents')
        self.sql('UPDATE Students SET Id=Id+100')
        self.sql('ALTER TABLE Books RENAME TO OldBooks')
        self.sql('CREATE TABLE Books AS SELECT * FROM OldBooks')
        self.sql('UPDATE Books SET Id=Id+200')
        self.assertEqual(self.individual(StudentId=101, BookId=201).status_code, 200)
        self.assertEqual(self.individual().status_code, 409)
        self.assertEqual(self.batch().json()['skipped_count'], 1)

    def test_simultaneous_individual_requests_create_only_one_record(self):
        payload = main.UserStudyLogRegisterRequest(StudentId=1, BookId=1,
                   StudiedDay='2026-09-18', ActualTeacherUsername='teacher_a')
        def register():
            try:
                main.user_register_studylog(payload, {'username': 'manager_a', 'role': 'manager'})
                return 200
            except main.HTTPException as exc:
                return exc.status_code
        with ThreadPoolExecutor(max_workers=2) as pool:
            statuses = list(pool.map(lambda _: register(), range(2)))
        self.assertEqual(sorted(statuses), [200, 409])
        self.assertEqual(len(self.sql('SELECT * FROM StudyLogs')), 1)
