"""완료로 저장한 월말보고 잠금은 임시 데이터베이스에서만 검증한다."""
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from fastapi.testclient import TestClient

import database
import main
from auth import create_access_token
from config import settings


class MonthlyReportLockTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        old_path = settings.SQLITE_DB_PATH
        self.addCleanup(setattr, settings, 'SQLITE_DB_PATH', old_path)
        settings.SQLITE_DB_PATH = str(Path(self.temp.name) / 'monthly_report_lock.db')
        with closing(sqlite3.connect(settings.SQLITE_DB_PATH)) as conn:
            conn.executescript('''
                CREATE TABLE Students (Id INTEGER UNIQUE, Name TEXT);
                INSERT INTO Students(Id, Name) VALUES (301, '잠금 검증 학생');
            ''')
        database.init_system_tables()
        main.init_activity_tables()
        for username, role in (('lock_admin', 'admin'), ('lock_subadmin', 'subadmin'),
                               ('lock_manager', 'manager'), ('lock_teacher', 'teacher')):
            database.create_user(username, '검증암호', role, username)
        with closing(database.get_db_connection()) as conn:
            conn.execute('INSERT INTO "Classes" ("Id","ClassName","TeacherUsername","DayOfWeek","StartTime")'
                         ' VALUES (1, ?, ?, ?, ?)', ('잠금 검증반', 'lock_teacher', '월', '10:00'))
            conn.execute('INSERT INTO "ClassStudents" ("ClassId","StudentId") VALUES (1, 1)')
            conn.commit()
        self.client = TestClient(main.app, raise_server_exceptions=False)
        self.addCleanup(self.client.close)

    def headers(self, actor):
        return {'Authorization': 'Bearer ' + create_access_token({'sub': actor})}

    def save(self, actor, content, status='completed', month='2026-10', student_id=1):
        return self.client.post('/api/user/monthly-reports', headers=self.headers(actor), json={
            'student_id': student_id,
            'report_year_month': month,
            'period_label': '2학기',
            'report_month_label': '10월',
            'start_lecture_num': 1,
            'special_teacher_name': '',
            'logs': [],
            'content': content,
            'status': status,
        })

    def report(self, month='2026-10'):
        with closing(database.get_db_connection()) as conn:
            row = conn.execute('SELECT "Content","Status","UpdatedBy" FROM "MonthlyReports"'
                               ' WHERE "ReportYearMonth" = ?', (month,)).fetchone()
        return dict(row) if row else None

    def audit_count(self):
        with closing(database.get_db_connection()) as conn:
            return conn.execute('SELECT COUNT(*) FROM "_app_audit_logs" WHERE table_name = ?',
                                ('MonthlyReports',)).fetchone()[0]

    def test_manager_keeps_editing_draft_but_cannot_overwrite_completed(self):
        self.assertEqual(self.save('lock_manager', '임시 초안', status='draft').status_code, 200)
        self.assertEqual(self.save('lock_manager', '임시 초안 수정', status='draft').status_code, 200)
        self.assertEqual(self.report()['Content'], '임시 초안 수정')

        self.assertEqual(self.save('lock_manager', '최종 문구').status_code, 200)
        self.assertEqual(self.report()['Status'], 'completed')

        blocked = self.save('lock_manager', '실수로 덮어쓴 문구')
        self.assertEqual(blocked.status_code, 403)
        self.assertEqual(blocked.json()['detail'], main.MONTHLY_REPORT_LOCK_MESSAGE)
        self.assertEqual(self.report()['Content'], '최종 문구')
        self.assertEqual(self.report()['Status'], 'completed')

    def test_completed_report_cannot_be_reverted_to_draft(self):
        self.assertEqual(self.save('lock_admin', '관리자 저장').status_code, 200)
        blocked = self.save('lock_manager', '임시로 되돌리기', status='draft')
        self.assertEqual(blocked.status_code, 403)
        self.assertEqual(self.report()['Status'], 'completed')
        self.assertEqual(self.report()['Content'], '관리자 저장')

    def test_teacher_cannot_overwrite_completed_report(self):
        self.assertEqual(self.save('lock_teacher', '선생님 저장').status_code, 200)
        blocked = self.save('lock_teacher', '선생님 재저장')
        self.assertEqual(blocked.status_code, 403)
        self.assertEqual(self.report()['Content'], '선생님 저장')

    def test_only_site_admin_can_overwrite_completed_report(self):
        self.assertEqual(self.save('lock_manager', '최초 완료').status_code, 200)

        self.assertEqual(self.save('lock_admin', '관리자 정정').status_code, 200)
        self.assertEqual(self.report()['Content'], '관리자 정정')
        self.assertEqual(self.report()['UpdatedBy'], 'lock_admin')

        blocked = self.save('lock_subadmin', '부관리자 정정')
        self.assertEqual(blocked.status_code, 403)
        self.assertEqual(blocked.json()['detail'], main.MONTHLY_REPORT_LOCK_MESSAGE)
        self.assertEqual(self.report()['Content'], '관리자 정정')
        self.assertEqual(self.report()['UpdatedBy'], 'lock_admin')
        self.assertEqual(self.report()['Status'], 'completed')

    def test_blocked_attempt_leaves_no_audit_log(self):
        self.assertEqual(self.save('lock_manager', '최종 문구').status_code, 200)
        before = self.audit_count()
        self.assertEqual(self.save('lock_manager', '덮어쓰기 시도').status_code, 403)
        self.assertEqual(self.save('lock_teacher', '덮어쓰기 시도').status_code, 403)
        self.assertEqual(self.save('lock_subadmin', '덮어쓰기 시도').status_code, 403)
        self.assertEqual(self.audit_count(), before)

    def test_lock_is_per_student_and_month(self):
        self.assertEqual(self.save('lock_manager', '10월 완료').status_code, 200)
        self.assertEqual(self.save('lock_manager', '9월 완료', month='2026-09').status_code, 200)
        self.assertEqual(self.save('lock_manager', '9월 수정', month='2026-09').status_code, 403)
        self.assertEqual(self.report('2026-10')['Content'], '10월 완료')
        self.assertEqual(self.report('2026-09')['Content'], '9월 완료')


if __name__ == '__main__':
    unittest.main()
