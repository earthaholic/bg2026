"""결석은 학습·정산 기록과 분리하고 월말 보고에만 날짜순으로 표시한다."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
import database
import main
from auth import create_access_token
from config import settings
from test_studylog_permissions import create_fixture


class StudentAbsenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.old_path = settings.SQLITE_DB_PATH
        settings.SQLITE_DB_PATH = str(Path(self.temp.name) / 'absences.db')
        create_fixture(settings.SQLITE_DB_PATH)
        database.init_system_tables()
        main.init_activity_tables()
        database.create_user('teacher_a', '테스트 암호', 'teacher', '교사 A')
        database.create_user('teacher_b', '테스트 암호', 'teacher', '교사 B')
        database.create_user('manager_a', '테스트 암호', 'manager', '관리 선생님')
        self.sql('INSERT INTO Classes(Id, ClassName, TeacherUsername, DayOfWeek) VALUES (1, ?, ?, ?), (2, ?, ?, ?)',
                 ('A 수업', 'teacher_a', '금', 'B 수업', 'teacher_b', '금'))
        self.sql('INSERT INTO ClassStudents(ClassId, StudentId) VALUES (1, 1), (2, 1), (2, 2)')
        self.client = TestClient(main.app, raise_server_exceptions=False)

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

    def headers(self, name='teacher_a'):
        return {'Authorization': 'Bearer ' + create_access_token({'sub': name})}

    def register(self, include=False, reason='수업 전 사정으로', sid=1, class_id=1, day='2026-09-18', books=None):
        return self.client.post('/api/user/classes/%s/studylogs' % class_id, headers=self.headers(), json={
            'StudiedDay': day, 'BookIds': books if books is not None else [1],
            'LessonContent': '토론', 'logs': [{'StudentId': sid, 'include': include, 'AbsenceReason': reason}]
        })

    def test_absence_is_saved_without_studylog_and_upserted(self):
        before = self.sql('SELECT COUNT(*) FROM StudyLogs')[0][0]
        response = self.register(books=[])
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['absence_count'], 1)
        self.assertEqual(self.sql('SELECT COUNT(*) FROM StudyLogs')[0][0], before)
        self.assertEqual(self.register(reason='가족 행사로').json()['absence_count'], 1)
        rows = self.sql('SELECT * FROM StudentAbsences')
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['AbsenceReason'], '가족 행사로')
        self.assertEqual([r[0] for r in self.sql("SELECT action FROM _app_audit_logs WHERE table_name='StudentAbsences' ORDER BY id")], ['INSERT', 'UPDATE'])

    def test_attendance_removes_absence_atomically(self):
        self.register()
        response = self.register(include=True)
        self.assertEqual(response.json()['created_count'], 1, response.text)
        self.assertFalse(self.sql('SELECT * FROM StudentAbsences'))
        self.assertEqual(len(self.sql("SELECT * FROM StudyLogs WHERE StudiedDay='2026-09-18'")), 1)
        self.assertEqual(self.sql("SELECT action FROM _app_audit_logs WHERE table_name='StudentAbsences' ORDER BY id DESC LIMIT 1")[0][0], 'DELETE')

    def test_audit_failure_rolls_back_absence(self):
        with patch.object(main, 'write_audit_log', side_effect=RuntimeError('감사 실패')):
            response = self.register()
        self.assertEqual(response.json()['results'][0]['status'], 'error')
        self.assertFalse(self.sql('SELECT * FROM StudentAbsences'))

    def test_attendance_audit_failure_keeps_absence(self):
        self.register()
        with patch.object(main, 'write_audit_log', side_effect=RuntimeError('감사 실패')):
            response = self.register(include=True)
        self.assertEqual(response.json()['created_count'], 0)
        self.assertEqual(len(self.sql('SELECT * FROM StudentAbsences')), 1)
        self.assertFalse(self.sql("SELECT * FROM StudyLogs WHERE StudiedDay='2026-09-18'"))

    def test_unassigned_student_and_other_class_rejected(self):
        self.assertEqual(self.register(sid=2).json()['results'][0]['status'], 'error')
        self.assertEqual(self.register(class_id=2).status_code, 403)
        self.assertFalse(self.sql('SELECT * FROM StudentAbsences'))

    def test_existing_attendance_cannot_be_marked_absent(self):
        self.register(include=True)
        response = self.register()
        self.assertEqual(response.json()['results'][0]['status'], 'error')
        self.assertFalse(self.sql('SELECT * FROM StudentAbsences'))

    def test_monthly_query_date_and_class_authorization(self):
        self.register()
        self.sql('INSERT INTO StudentAbsences(StudentId, ClassId, StudiedDay, AbsenceReason) VALUES (1, 2, ?, ?)',
                 ('2026-09-18', '다른 수업 사유'))
        url = '/api/user/monthly-report/studylogs?student_id=1&date_from=2026-09-01&date_to=2026-09-30'
        data = self.client.get(url, headers=self.headers()).json()
        self.assertEqual(len(data['absences']), 1)
        self.assertEqual(data['absences'][0]['ClassId'], 1)
        self.assertEqual(len(self.client.get(url, headers=self.headers('manager_a')).json()['absences']), 2)
        self.assertEqual(self.client.get(url.replace('2026-09', '2026-08'), headers=self.headers()).json()['absences'], [])

    def test_empty_reason_and_real_calendar_date(self):
        self.assertEqual(self.register(reason='  ').json()['absence_count'], 1)
        self.assertEqual(self.sql('SELECT AbsenceReason FROM StudentAbsences')[0][0], '')
        self.assertEqual(self.register(day='2026-09-31').status_code, 400)

    def test_saved_report_preserves_absence_snapshot(self):
        self.register()
        data = self.client.get('/api/user/monthly-report/studylogs?student_id=1', headers=self.headers()).json()
        absence = dict(data['absences'][0], IsAbsence=True)
        content = main.build_monthly_report_text('김학생', '', '9월', 1, '', [absence])
        response = self.client.post('/api/user/monthly-reports', headers=self.headers(), json={
            'student_id': 1, 'report_year_month': '2026-09', 'report_month_label': '9월',
            'logs': [absence], 'content': content, 'status': 'draft'
        })
        self.assertEqual(response.status_code, 200, response.text)
        report_id = response.json()['report']['Id']
        saved = self.client.get('/api/user/monthly-reports/%s' % report_id, headers=self.headers()).json()['report']
        self.assertTrue(saved['StudyLogSnapshot'][0]['IsAbsence'])
        self.assertEqual(saved['StudyLogSnapshot'][0]['AbsenceReason'], '수업 전 사정으로')
        self.assertIn('9/18(금) 수업 전 사정으로 수업 불참', saved['Content'])

    def test_migration_is_idempotent(self):
        self.register()
        database.init_system_tables()
        self.assertEqual(len(self.sql('SELECT * FROM StudentAbsences')), 1)

    def test_report_date_order_and_no_lecture_number_for_absence(self):
        text = main.build_monthly_report_text('김학생', '2학기', '9월', 3, '', [
            {'StudiedDay': '2026-09-25', 'BookTitle': '다음 도서', 'LessonContent': '토론'},
            {'StudiedDay': '2026-09-18', 'IsAbsence': True, 'AbsenceReason': '수업 전 사정으로'},
            {'StudiedDay': '2026-09-11', 'BookTitle': '첫 도서', 'LessonContent': '독서'},
            {'StudiedDay': '2026-09-19', 'IsAbsence': True, 'AbsenceReason': ''},
            {'StudiedDay': '2026-09-20', 'IsAbsence': True, 'AbsenceReason': '가족 행사로 수업 불참'},
        ])
        self.assertIn('9/18(금) 수업 전 사정으로 수업 불참', text)
        self.assertIn('9/19(토) 수업 불참', text)
        self.assertIn('9/20(일) 가족 행사로 수업 불참', text)
        self.assertNotIn('수업 불참 수업 불참', text)
        self.assertIn('<3강>', text)
        self.assertIn('<4강>', text)
        self.assertNotIn('<5강>', text)
        self.assertLess(text.index('첫 도서'), text.index('수업 전 사정으로'))
        self.assertLess(text.index('수업 전 사정으로'), text.index('다음 도서'))


if __name__ == '__main__':
    unittest.main()
