"""정산 제외는 학습 기록을 보존하고 마감·권한·감사 원자성을 지킨다."""
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


class PayrollExclusionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.old_path = settings.SQLITE_DB_PATH
        settings.SQLITE_DB_PATH = str(Path(self.temp.name) / 'payroll.db')
        create_fixture(settings.SQLITE_DB_PATH)
        database.init_system_tables()
        main.init_activity_tables()
        for username, role in [('teacher_a', 'teacher'), ('teacher_b', 'teacher'), ('manager_a', 'manager')]:
            database.create_user(username, '검증 암호', role, username)
        self.sql('DELETE FROM StudyLogs')
        self.sql("INSERT INTO ClassCategories(Id, Name) VALUES (1, '독서')")
        self.sql("INSERT INTO Classes(Id, ClassName, TeacherUsername, CategoryId, DayOfWeek) VALUES (1, '검증반', 'teacher_a', 1, '화')")
        self.sql('INSERT INTO ClassStudents(ClassId, StudentId) VALUES (1, 1), (1, 2)')
        self.sql("INSERT INTO TeacherPayRates(CategoryId, GradeGroup, UnitAmount, EffectiveFrom) VALUES (1, '초등', 10000, '2026-01-01')")
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

    def change(self, excluded=True, user='manager_a', **overrides):
        payload = {'PayrollMonth': '2026-09', 'TeacherUsername': 'teacher_a', 'StudentRowId': 1,
                   'StudiedDay': '2026-09-01', 'LogIds': [1, 2], 'Excluded': excluded, 'Reason': '중복 정산 제외'}
        payload.update(overrides)
        return self.client.post('/api/user/payroll/exclusions', headers=self.headers(user), json=payload)

    def payroll(self, user='manager_a', teacher='teacher_a'):
        return self.client.get('/api/user/payroll?month=2026-09&teacher_username=' + teacher,
                               headers=self.headers(user)).json()

    def test_exclude_and_restore_preserves_every_studylog_column(self):
        before = self.sql('SELECT rowid, * FROM StudyLogs')
        self.assertEqual(self.change().status_code, 200)
        data = self.payroll()
        self.assertEqual({r['StudyLogId'] for r in data['lines']}, {3, 4})
        self.assertEqual({r['StudyLogId'] for r in data['excluded_lines']}, {1, 2})
        self.assertEqual(data['totals'], {'teacher_a': 20000})
        self.assertEqual(self.sql('SELECT rowid, * FROM StudyLogs'), before)
        self.assertEqual(len(self.sql("SELECT * FROM _app_audit_logs WHERE table_name='TeacherPayrollExclusions'")), 2)
        self.assertEqual(self.change(False).status_code, 200)
        self.assertEqual(self.payroll()['totals'], {'teacher_a': 35000})
        self.assertEqual(self.payroll()['excluded_lines'], [])
        self.assertEqual(self.sql('SELECT rowid, * FROM StudyLogs'), before)

    def test_teacher_can_view_own_exclusions_but_cannot_change(self):
        self.assertEqual(self.change(user='teacher_a').status_code, 403)
        self.change()
        own = self.payroll(user='teacher_a', teacher='teacher_b')
        self.assertEqual(len(own['excluded_lines']), 2)
        self.assertTrue(all(r['TeacherUsername'] == 'teacher_a' for r in own['excluded_lines']))
        self.assertEqual(self.payroll(user='teacher_b')['excluded_lines'], [])

    def test_wrong_student_day_teacher_or_missing_record_rejects_entire_request(self):
        for ids in [[1, 3], [1, 4], [1, 5], [1, 999]]:
            self.assertEqual(self.change(LogIds=ids).status_code, 409)
            self.assertFalse(self.sql('SELECT * FROM TeacherPayrollExclusions'))

    def test_closed_month_blocks_exclusion_and_restore(self):
        self.change()
        response = self.client.post('/api/user/payroll/2026-09/close?teacher_username=teacher_a', headers=self.headers())
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual({r['StudyLogId'] for r in self.sql('SELECT * FROM TeacherPayrollLines')}, {3, 4})
        self.assertEqual(self.change(False).status_code, 409)
        self.assertEqual(self.change(LogIds=[3], StudentRowId=2).status_code, 409)
        data = self.payroll()
        self.assertEqual(data['totals'], {'teacher_a': 20000})
        self.assertEqual(len(data['excluded_lines']), 2)
        self.assertTrue(all(r['IsPayrollClosed'] for r in data['excluded_lines']))

    def test_stale_repeat_rejected(self):
        self.change()
        self.assertEqual(self.change().status_code, 409)
        self.change(False)
        self.assertEqual(self.change(False).status_code, 409)

    def test_invalid_input(self):
        for override in [{'PayrollMonth': '2026-13'}, {'StudiedDay': '2026-09-31'},
                         {'StudiedDay': '2026-10-01'}, {'LogIds': []}, {'LogIds': [1, 1]},
                         {'LogIds': [-1]}, {'LogIds': list(range(1, 52))}, {'Reason': '가' * 501}]:
            self.assertEqual(self.change(**override).status_code, 400)

    def test_audit_failure_rolls_back_all_exclusions_and_restores(self):
        real_audit = main.write_audit_log
        calls = []
        def failing_audit(*args, **kwargs):
            calls.append(args)
            if len(calls) == 2:
                raise RuntimeError('감사 실패')
            return real_audit(*args, **kwargs)
        with patch.object(main, 'write_audit_log', side_effect=failing_audit):
            self.assertEqual(self.change().status_code, 500)
        self.assertFalse(self.sql('SELECT * FROM TeacherPayrollExclusions'))
        self.assertFalse(self.sql("SELECT * FROM _app_audit_logs WHERE table_name='TeacherPayrollExclusions'"))
        self.change()
        with patch.object(main, 'write_audit_log', side_effect=RuntimeError('감사 실패')):
            self.assertEqual(self.change(False).status_code, 500)
        self.assertEqual(len(self.sql('SELECT * FROM TeacherPayrollExclusions')), 2)

    def test_excluded_unconfigured_record_does_not_block_closure(self):
        self.sql('DELETE FROM SpecialLessonPayRates')
        self.change(LogIds=[2])
        response = self.client.post('/api/user/payroll/2026-09/close?teacher_username=teacher_a', headers=self.headers())
        self.assertEqual(response.status_code, 200, response.text)

    def test_changed_record_does_not_inherit_old_exclusion(self):
        self.change(LogIds=[1])
        self.sql('UPDATE StudyLogs SET StudentId=2 WHERE Id=1')
        self.assertEqual(self.payroll()['excluded_lines'], [])
        self.assertEqual(self.payroll()['totals'], {'teacher_a': 35000})
