"""학습 이력의 미래 날짜 등록 차단을 임시 DB에서 검증한다.

한국 시간 기준 오늘 이후 날짜는 개별·일괄·수정·CSV 가져오기 어느 경로에서도
저장되지 않아야 한다. 휴강 일정은 학습 이력이 아니므로 미리 등록할 수 있다.
"""
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi.testclient import TestClient

import database
import main
import studylog_dates
from auth import create_access_token
from config import settings
from test_studylog_permissions import create_fixture


class StudyLogFutureDayTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.old_path = settings.SQLITE_DB_PATH
        settings.SQLITE_DB_PATH = str(Path(self.temp.name) / 'future-day.db')
        create_fixture(settings.SQLITE_DB_PATH)
        database.init_system_tables()
        main.init_activity_tables()
        for name, role in [('teacher_a', 'teacher'), ('teacher_b', 'teacher'), ('manager_a', 'manager')]:
            database.create_user(name, '검증 암호', role, name)
        self.sql('DELETE FROM StudyLogs')
        self.sql("INSERT INTO Classes(Id, ClassName, TeacherUsername, DayOfWeek) VALUES (1, 'A', 'teacher_a', '월')")
        self.sql('INSERT INTO ClassStudents(ClassId, StudentId) VALUES (1, 1), (1, 2)')
        self.sql("INSERT INTO Books(Id, Title) VALUES (2, '다른 도서')")
        self.today = studylog_dates.kst_today()
        self.future = (datetime.strptime(self.today, '%Y-%m-%d') + timedelta(days=1)).strftime('%Y-%m-%d')
        self.client = TestClient(main.app, raise_server_exceptions=False)
        self.staff_headers = {'Authorization': 'Bearer ' + create_access_token({'sub': 'manager_a'})}
        self.teacher_headers = {'Authorization': 'Bearer ' + create_access_token({'sub': 'teacher_a'})}

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

    def individual(self, day, headers=None, **overrides):
        payload = {'StudentId': 1, 'BookId': 1, 'StudiedDay': day,
                   'ActualTeacherUsername': 'teacher_a', 'LessonContent': '토론'}
        payload.update(overrides)
        return self.client.post('/api/user/studylogs', headers=headers or self.staff_headers, json=payload)

    def batch(self, day, **overrides):
        payload = {'BookIds': [1], 'StudiedDay': day, 'LessonContent': '토론',
                   'logs': [{'StudentId': 1, 'include': True}]}
        payload.update(overrides)
        return self.client.post('/api/user/classes/1/studylogs', headers=self.staff_headers, json=payload)

    def test_kst_today_ignores_server_timezone(self):
        expected = datetime.now(timezone(timedelta(hours=9))).strftime('%Y-%m-%d')
        self.assertEqual(studylog_dates.kst_today(), expected)
        self.assertFalse(studylog_dates.is_future_studied_day(self.today))
        self.assertTrue(studylog_dates.is_future_studied_day(self.future))

    def test_individual_blocks_future_day(self):
        response = self.individual(self.future)
        self.assertEqual(response.status_code, 400, response.text)
        self.assertIn('등록할 수 없습니다', response.json()['detail'])
        self.assertIn(self.future, response.json()['detail'])
        self.assertFalse(self.sql('SELECT * FROM StudyLogs'))
        self.assertFalse(self.sql("SELECT * FROM _app_audit_logs WHERE table_name='StudyLogs'"))

    def test_individual_allows_today(self):
        response = self.individual(self.today)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(self.sql('SELECT * FROM StudyLogs')), 1)

    def test_batch_blocks_future_day(self):
        response = self.batch(self.future)
        self.assertEqual(response.status_code, 400, response.text)
        self.assertIn('등록할 수 없습니다', response.json()['detail'])
        self.assertFalse(self.sql('SELECT * FROM StudyLogs'))

    def test_batch_allows_today(self):
        response = self.batch(self.today)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['created_count'], 1, response.text)

    def test_batch_future_cancellation_is_not_a_studylog(self):
        response = self.batch(self.future, IsCancelled=True, CancellationReason='공휴일', logs=[])
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()['is_cancelled'])
        self.assertFalse(self.sql('SELECT * FROM StudyLogs'))
        self.assertEqual(len(self.sql('SELECT * FROM ClassCancellations')), 1)

    def test_staff_update_to_future_day_blocked(self):
        self.assertEqual(self.individual(self.today).status_code, 200)
        log_id = self.sql('SELECT rowid FROM StudyLogs')[0][0]
        response = self.client.put(f'/api/user/studylogs/{log_id}', headers=self.staff_headers,
                                   json={'data': {'StudiedDay': self.future}})
        self.assertEqual(response.status_code, 400, response.text)
        self.assertEqual(self.sql('SELECT StudiedDay FROM StudyLogs')[0][0], self.today)

    def test_teacher_update_to_future_day_blocked(self):
        response = self.individual(self.today, headers=self.teacher_headers, ClassId=1)
        self.assertEqual(response.status_code, 200, response.text)
        log_id = self.sql('SELECT rowid FROM StudyLogs')[0][0]
        update = self.client.put(f'/api/user/studylogs/{log_id}', headers=self.teacher_headers,
                                 json={'data': {'StudiedDay': self.future}})
        self.assertEqual(update.status_code, 400, update.text)
        self.assertEqual(self.sql('SELECT StudiedDay FROM StudyLogs')[0][0], self.today)

    def test_csv_import_rejects_future_day(self):
        response = self.client.post('/api/user/utilities/studylog-csv/import', headers=self.staff_headers, json={
            'source_file': '미래날짜.csv',
            'rows': [{'row_number': 1, 'student_name': '같은 학생', 'book_title': '권한 검증 도서',
                      'studied_day': self.future, 'student_id': 1, 'book_id': 1}]
        })
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['success_count'], 0, response.text)
        self.assertIn('등록할 수 없습니다', response.json()['results'][0]['message'])
        self.assertFalse(self.sql('SELECT * FROM StudyLogs'))

    def test_csv_preview_marks_future_day_not_ready(self):
        response = self.client.post('/api/user/utilities/studylog-csv/preview', headers=self.staff_headers, json={
            'source_file': '미래날짜.csv',
            'rows': [{'row_number': 1, 'student_name': '같은 학생', 'book_title': '권한 검증 도서',
                      'studied_day': self.future}]
        })
        self.assertEqual(response.status_code, 200, response.text)
        row = response.json()['rows'][0]
        self.assertFalse(row['ready'])
        self.assertTrue(any('등록할 수 없습니다' in error for error in row['errors']), row['errors'])


if __name__ == '__main__':
    unittest.main()
