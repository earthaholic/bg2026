"""처리 날짜 변경과 정산 보호를 임시 DB에서 검증한다."""
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


class BookMaterialReviewDateTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.addCleanup(setattr, settings, 'SQLITE_DB_PATH', settings.SQLITE_DB_PATH)
        settings.SQLITE_DB_PATH = str(Path(temp.name) / 'requests.db')
        with closing(sqlite3.connect(settings.SQLITE_DB_PATH)) as conn:
            conn.executescript('''
                CREATE TABLE Books (Id INTEGER, Title TEXT);
                CREATE TABLE Students (Id INTEGER, Name TEXT, Grade TEXT);
                CREATE TABLE StudyLogs (Id INTEGER, StudentId INTEGER, BookId INTEGER, StudiedDay TEXT);
            ''')
        database.init_system_tables()
        main.init_activity_tables()
        database.create_user('request_teacher', '검증암호', 'teacher', '검증 선생님')
        database.create_user('request_manager', '검증암호', 'manager', '관리 선생님')
        self.sql('''INSERT INTO BookMaterialRequests
            (Id,RequestType,BookCategory,MaterialFields,RequestedBy,Status,ReviewedAt,ReviewedBy,ApprovedAmount,PayrollMonth)
            VALUES (1,'material_add','general','["HasQuiz"]','request_teacher','approved','2026-09-20 12:34:56','원처리자',10000,'2026-09')''')
        self.sql("INSERT INTO BookMaterialPayRates(BookCategory,UnitAmount,EffectiveFrom) VALUES ('general',10000,'2026-09-01'),('general',20000,'2026-10-01')")
        self.client = TestClient(main.app, raise_server_exceptions=False)
        self.addCleanup(self.client.close)

    def sql(self, sql, args=()):
        with closing(sqlite3.connect(settings.SQLITE_DB_PATH)) as conn:
            conn.row_factory = sqlite3.Row
            rows = [dict(row) for row in conn.execute(sql, args).fetchall()]
            conn.commit()
            return rows

    def change(self, date='2026-10-02', actor='request_manager', expected='2026-09-20 12:34:56'):
        return self.client.put('/api/user/book-material-requests/1/review-date',
                               headers={'Authorization': 'Bearer ' + create_access_token({'sub': actor})},
                               json={'ReviewedDate': date, 'ExpectedReviewedAt': expected})

    def test_month_rate_time_and_audit(self):
        response = self.change()
        self.assertEqual(response.status_code, 200, response.text)
        row = self.sql('SELECT * FROM BookMaterialRequests')[0]
        self.assertEqual((row['ReviewedAt'], row['PayrollMonth'], row['ApprovedAmount'], row['ReviewedBy']),
                         ('2026-10-02 12:34:56', '2026-10', 20000, '원처리자'))
        audit = self.sql("SELECT * FROM _app_audit_logs WHERE table_name='BookMaterialRequests'")[0]
        self.assertEqual(set(json.loads(audit['changed_fields'])), {'ReviewedAt', 'PayrollMonth', 'ApprovedAmount'})

    def test_closed_source_and_target_months(self):
        for month in ('2026-09', '2026-10'):
            self.sql('INSERT INTO TeacherPayrollClosures(PayrollMonth,TeacherUsername,ClosedBy) VALUES (?, ?, ?)',
                     (month, 'request_teacher', '관리자'))
            self.assertEqual(self.change().status_code, 400)
            self.assertEqual(self.sql('SELECT PayrollMonth FROM BookMaterialRequests')[0]['PayrollMonth'], '2026-09')
            self.sql('DELETE FROM TeacherPayrollClosures')

    def test_invalid_date_stale_pending_and_permissions(self):
        for date in ('2026-02-30', '', '2026-1-01'):
            self.assertEqual(self.change(date).status_code, 400)
        self.assertEqual(self.change('2026-08-01').status_code, 400)
        self.assertEqual(self.change(expected='이전 값').status_code, 409)
        self.assertEqual(self.change(actor='request_teacher').status_code, 403)
        self.sql("UPDATE BookMaterialRequests SET Status='pending'")
        self.assertEqual(self.change().status_code, 400)

    def test_rejected_and_book_only_do_not_acquire_payroll(self):
        for status, request_type in [('rejected', 'material_add'), ('approved', 'new_book')]:
            self.sql("UPDATE BookMaterialRequests SET Status=?,RequestType=?,MaterialFields='[]',PayrollMonth='',ApprovedAmount=0,ReviewedAt='2026-09-20 12:34:56'", (status, request_type))
            self.assertEqual(self.change('2026-08-01').status_code, 200)
            row = self.sql('SELECT * FROM BookMaterialRequests')[0]
            self.assertEqual((row['PayrollMonth'], row['ApprovedAmount']), ('', 0))

    def test_audit_failure_rolls_back(self):
        with patch.object(main, 'write_audit_log', side_effect=RuntimeError('감사 실패')):
            self.assertEqual(self.change().status_code, 500)
        self.assertEqual(self.sql('SELECT ReviewedAt FROM BookMaterialRequests')[0]['ReviewedAt'], '2026-09-20 12:34:56')


if __name__ == '__main__':
    unittest.main()
