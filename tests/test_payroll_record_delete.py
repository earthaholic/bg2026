"""정산 화면의 학습 기록 삭제 권한·마감 보호·감사 원자성을 검증한다."""
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


class PayrollRecordDeleteTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.old_path = settings.SQLITE_DB_PATH
        settings.SQLITE_DB_PATH = str(Path(self.temp.name) / 'payroll_delete.db')
        create_fixture(settings.SQLITE_DB_PATH)
        database.init_system_tables()
        main.init_activity_tables()
        for username, role in [('teacher_a', 'teacher'), ('teacher_b', 'teacher'),
                               ('manager_a', 'manager'), ('subadmin_a', 'subadmin')]:
            database.create_user(username, '검증 암호', role, username)
        self.sql('DELETE FROM StudyLogs')
        self.sql("INSERT INTO ClassCategories(Id, Name) VALUES (1, '독서')")
        self.sql("INSERT INTO Classes(Id, ClassName, TeacherUsername, CategoryId, DayOfWeek) "
                 "VALUES (1, '검증반', 'teacher_a', 1, '화')")
        self.sql('INSERT INTO ClassStudents(ClassId, StudentId) VALUES (1, 1), (1, 2)')
        self.sql("INSERT INTO TeacherPayRates(CategoryId, GradeGroup, UnitAmount, EffectiveFrom) "
                 "VALUES (1, '초등', 10000, '2026-01-01')")
        self.sql("INSERT INTO SpecialLessonPayRates(UnitAmount, EffectiveFrom) VALUES (5000, '2026-01-01')")
        self.sql("""INSERT INTO StudyLogs(Id, StudentId, BookId, StudiedDay, ClassId, ActualTeacherUsername, IsSpecial)
                    VALUES (1, 1, 1, '2026-09-01', 1, 'teacher_a', 0),
                           (2, 1, 1, '2026-09-01', 1, 'teacher_a', 1),
                           (3, 2, 1, '2026-09-01', 1, 'teacher_a', 0),
                           (4, 1, 1, '2026-09-08', 1, 'teacher_a', 0),
                           (5, 1, 1, '2026-09-01', 1, 'teacher_b', 0)""")
        self.client = TestClient(main.app, raise_server_exceptions=False)

    def tearDown(self):
        self.client.close()
        settings.SQLITE_DB_PATH = self.old_path
        self.temp.cleanup()

    def sql(self, query, args=()):
        conn = database.get_db_connection()
        try:
            result = [dict(row) for row in conn.execute(query, args).fetchall()]
            conn.commit()
            return result
        finally:
            conn.close()

    def headers(self, user='manager_a'):
        return {'Authorization': 'Bearer ' + create_access_token({'sub': user})}

    def log_ids(self):
        return {row['Id'] for row in self.sql('SELECT Id FROM StudyLogs')}

    def delete(self, ids, user='manager_a', **overrides):
        payload = {'PayrollMonth': '2026-09', 'TeacherUsername': 'teacher_a', 'LogIds': ids,
                   'Confirmation': '학습 기록 삭제'}
        payload.update(overrides)
        return self.client.post('/api/user/payroll/records/delete', headers=self.headers(user), json=payload)

    def payroll(self, user='manager_a', teacher='teacher_a'):
        response = self.client.get('/api/user/payroll?month=2026-09&teacher_username=' + teacher,
                                   headers=self.headers(user))
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_payroll_response_marks_deletable_records_with_book_titles(self):
        data = self.payroll()
        self.assertTrue(data['lines'])
        for line in data['lines']:
            self.assertTrue(line['CanDelete'])
            self.assertEqual(line['DeleteBlockedReason'], '')
            self.assertEqual(len(line['RecordBooks']), len(line['StudyLogIds']))
            self.assertEqual(line['RecordBooks'][0]['BookTitle'], '권한 검증 도서')
        teacher_view = self.payroll(user='teacher_a', teacher='teacher_b')
        self.assertTrue(all(line['CanDelete'] for line in teacher_view['lines']))
        self.assertEqual({line['StudyLogId'] for line in teacher_view['lines']}, {1, 2, 3, 4})

    def test_manager_deletes_another_teachers_records_with_audit(self):
        response = self.delete([5], TeacherUsername='teacher_b')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertNotIn(5, self.log_ids())
        audits = self.sql("SELECT * FROM _app_audit_logs WHERE table_name='StudyLogs' AND action='DELETE'")
        self.assertEqual([int(row['record_id']) for row in audits], [5])

    def test_teacher_deletes_own_records_before_closing(self):
        response = self.delete([1], user='teacher_a')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertNotIn(1, self.log_ids())
        self.assertEqual(self.delete([1], user='teacher_a').status_code, 404)

    def test_teacher_cannot_delete_other_teachers_records(self):
        self.assertEqual(self.delete([5], user='teacher_a', TeacherUsername='teacher_b').status_code, 403)
        self.assertEqual(self.delete([5], user='teacher_a').status_code, 409)
        other = self.client.get('/api/user/payroll?month=2026-09', headers=self.headers('teacher_b')).json()
        self.assertEqual({line['StudyLogId'] for line in other['lines']}, {5})
        self.assertEqual(self.log_ids(), {1, 2, 3, 4, 5})

    def test_closed_payroll_blocks_delete_for_everyone(self):
        response = self.client.post('/api/user/payroll/2026-09/close?teacher_username=teacher_a',
                                    headers=self.headers())
        self.assertEqual(response.status_code, 200, response.text)
        data = self.payroll()
        frozen = [line for line in data['lines'] if line['IsPayrollClosed']]
        self.assertTrue(frozen)
        self.assertTrue(all(not line['CanDelete'] for line in frozen))
        self.assertTrue(all('마감' in line['DeleteBlockedReason'] for line in frozen))
        self.assertEqual(self.delete([1]).status_code, 409)
        self.assertEqual(self.delete([1], user='teacher_a').status_code, 409)
        self.assertEqual(self.log_ids(), {1, 2, 3, 4, 5})

    def test_invalid_or_mismatched_request_cancels_every_record(self):
        self.assertEqual(self.delete([1], Confirmation='삭제').status_code, 400)
        self.assertEqual(self.delete([1], PayrollMonth='2026-10').status_code, 409)
        self.assertEqual(self.delete([1, 999]).status_code, 404)
        self.assertEqual(self.delete([1, 1]).status_code, 400)
        self.assertEqual(self.delete([]).status_code, 400)
        self.assertEqual(self.delete(list(range(1, 52))).status_code, 400)
        self.assertEqual(self.delete([1], TeacherUsername='').status_code, 400)
        self.assertEqual(self.log_ids(), {1, 2, 3, 4, 5})
        self.assertFalse(self.sql("SELECT * FROM _app_audit_logs WHERE table_name='StudyLogs' AND action='DELETE'"))

    def test_stale_exclusion_rows_are_removed_with_the_record(self):
        excluded = self.client.post('/api/user/payroll/exclusions', headers=self.headers(), json={
            'PayrollMonth': '2026-09', 'TeacherUsername': 'teacher_a', 'StudentRowId': 1,
            'StudiedDay': '2026-09-01', 'LogIds': [1], 'Excluded': True, 'Reason': '중복 기록'})
        self.assertEqual(excluded.status_code, 200, excluded.text)
        self.assertEqual(self.delete([1]).status_code, 200)
        self.assertFalse(self.sql('SELECT * FROM TeacherPayrollExclusions'))
        self.assertTrue(self.sql("SELECT * FROM _app_audit_logs "
                                 "WHERE table_name='TeacherPayrollExclusions' AND action='DELETE'"))

    def test_audit_failure_rolls_back_every_deletion(self):
        with patch.object(main, 'write_audit_log', side_effect=RuntimeError('감사 실패')):
            self.assertEqual(self.delete([1, 3]).status_code, 500)
        self.assertEqual(self.log_ids(), {1, 2, 3, 4, 5})
        self.assertFalse(self.sql("SELECT * FROM _app_audit_logs WHERE table_name='StudyLogs' AND action='DELETE'"))
        self.assertEqual(self.delete([1, 3]).status_code, 200)
        self.assertEqual(self.log_ids(), {2, 4, 5})


if __name__ == '__main__':
    unittest.main()
