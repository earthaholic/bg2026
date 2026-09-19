"""학습 기록 선택 삭제의 검증·권한·트랜잭션 동작을 검증한다.

실제 data.db 대신 테스트마다 별도 SQLite 데이터베이스를 생성한다.
"""
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

import database
import main
from auth import create_access_token
from config import settings


def create_bulk_delete_fixture(path):
    """rowid와 원본 Id가 충돌하는 학습 기록을 포함한 최소 DB를 만든다."""
    conn = sqlite3.connect(path)
    conn.executescript('''
        CREATE TABLE Books (
            Id INTEGER PRIMARY KEY, Title TEXT, Author TEXT, Publisher TEXT,
            Subject TEXT, Target TEXT, BookLength INTEGER, Voca INTEGER, Metaphor INTEGER,
            HasQuiz INTEGER, HasReadingQuestion INTEGER, HasReadingAnswer INTEGER,
            HasWritingQuestion INTEGER, HasWritingAnswer INTEGER, HasAdvancedMaterial INTEGER,
            HasDebateMaterial INTEGER, IsPaperbookExist INTEGER, IsPdfExist INTEGER,
            IsYes24Exist INTEGER, IsMillieExist INTEGER, Desc TEXT
        );
        CREATE TABLE Students (
            Id INTEGER PRIMARY KEY, Name TEXT, Sex TEXT, Birthday TEXT, Description TEXT,
            Grade TEXT, Referrer TEXT
        );
        -- Id를 rowid 별칭이 아닌 일반 고유 컬럼으로 둬 원본 Id 충돌을 재현한다.
        CREATE TABLE StudyLogs (
            Id INTEGER NOT NULL UNIQUE, StudentId INTEGER NOT NULL, BookId INTEGER NOT NULL,
            StudiedDay TEXT NOT NULL
        );
        INSERT INTO Books VALUES
            (1, '선택 삭제 도서', '저자', '출판사', '', '', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, '');
        INSERT INTO Students VALUES
            (1, '학생', '', '', '', '초3', '');
        -- 첫 행의 rowid=1, Id=2이고 둘째 행의 Id=1이다.
        INSERT INTO StudyLogs(Id, StudentId, BookId, StudiedDay) VALUES
            (2, 1, 1, '2026-06-13'),
            (1, 1, 1, '2026-06-13'),
            (3, 1, 1, '2026-06-13'),
            (4, 1, 1, '2026-06-13'),
            (5, 1, 1, '2026-06-13');
    ''')
    conn.commit()
    conn.close()


class StudyLogBulkDeleteTests(unittest.TestCase):
    confirmation = '선택한 기록 삭제'

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.old_path = settings.SQLITE_DB_PATH
        settings.SQLITE_DB_PATH = str(Path(self.temp.name) / 'test.db')
        create_bulk_delete_fixture(settings.SQLITE_DB_PATH)
        database.init_system_tables()
        main.init_activity_tables()
        database.create_user('teacher_a', '암호', 'teacher', '교사 A')
        database.create_user('teacher_b', '암호', 'teacher', '교사 B')
        database.create_user('manager_a', '암호', 'manager', '관리 선생님')
        self.sql('''INSERT INTO Classes(Id, ClassName, TeacherUsername, DayOfWeek, StartTime)
                    VALUES (1, 'A 수업', 'teacher_a', '월', '15:00'),
                           (2, 'B 수업', 'teacher_b', '화', '15:00')''')
        self.sql('''UPDATE StudyLogs
                    SET ActualTeacherUsername=CASE rowid
                        WHEN 1 THEN 'teacher_a' WHEN 2 THEN 'teacher_a'
                        WHEN 3 THEN '' WHEN 4 THEN 'teacher_b' WHEN 5 THEN 'teacher_a' END,
                        ClassId=CASE rowid WHEN 3 THEN 1 ELSE NULL END,
                        LessonContent='기존 수업', Description='기존 메모', IsSpecial=0''')
        # 50건 상한 성공 경계를 검증할 수 있도록 본인 기록을 추가한다.
        for row_id in range(6, 56):
            self.sql('''INSERT INTO StudyLogs(Id, StudentId, BookId, StudiedDay,
                                               ActualTeacherUsername, LessonContent, Description, IsSpecial)
                        VALUES (?, 1, 1, '2026-06-13', 'teacher_a', '기존 수업', '기존 메모', 0)''',
                     (1000 + row_id,))
        self.client = TestClient(main.app, raise_server_exceptions=False)
        self.teacher_headers = self.headers_for('teacher_a')
        self.manager_headers = self.headers_for('manager_a')

    def tearDown(self):
        self.client.close()
        settings.SQLITE_DB_PATH = self.old_path
        self.temp.cleanup()

    def headers_for(self, username):
        return {'Authorization': 'Bearer ' + create_access_token({'sub': username})}

    def sql(self, statement, args=()):
        conn = database.get_db_connection()
        try:
            result = conn.execute(statement, args).fetchall()
            conn.commit()
            return result
        finally:
            conn.close()

    def bulk_delete(self, log_ids, confirmation=None, headers=None):
        return self.client.post('/api/user/studylogs/bulk-delete', headers=headers or self.teacher_headers,
                                json={'log_ids': log_ids,
                                      'confirmation': self.confirmation if confirmation is None else confirmation})

    def existing_rowids(self):
        return [row[0] for row in self.sql('SELECT rowid FROM StudyLogs ORDER BY rowid')]

    def test_requires_authentication_and_exact_confirmation_without_changes(self):
        self.assertEqual(self.client.post('/api/user/studylogs/bulk-delete', json={
            'log_ids': [1], 'confirmation': self.confirmation
        }).status_code, 401)
        before = self.existing_rowids()
        for confirmation in ('선택한 기록삭제', '', ' 선택한 기록 삭제', '선택한 기록 삭제 '):
            self.assertEqual(self.bulk_delete([1], confirmation).status_code, 400)
            self.assertEqual(self.existing_rowids(), before)
        self.assertEqual(self.client.post('/api/user/studylogs/bulk-delete', headers=self.teacher_headers,
                                          json={'log_ids': [1]}).status_code, 422)

    def test_validates_strict_positive_unique_and_maximum_ids(self):
        for log_ids in ([], [0], [-1], [1, 1], list(range(1, 52))):
            with self.subTest(log_ids=log_ids[:3]):
                self.assertEqual(self.bulk_delete(log_ids).status_code, 400)
        for value in ('1', True, 1.0):
            with self.subTest(value=value):
                self.assertEqual(self.bulk_delete([value]).status_code, 422)

        # 정확히 50건은 허용되며, 모두 존재하면 정상 삭제된다.
        response = self.bulk_delete(list(range(6, 56)))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['deleted_rows'], 50)
        self.assertEqual(self.existing_rowids(), [1, 2, 3, 4, 5])

    def test_uses_rowid_not_original_id_and_records_delete_audits(self):
        response = self.bulk_delete([1, 3])
        self.assertEqual(response.status_code, 200)
        # rowid 1(Id=2)만 삭제되고, 원본 Id=1인 rowid 2는 남는다.
        self.assertEqual(self.sql('SELECT Id FROM StudyLogs WHERE rowid=2')[0][0], 1)
        self.assertFalse(self.sql('SELECT 1 FROM StudyLogs WHERE rowid IN (1, 3)'))
        audits = self.sql("""SELECT record_id, old_data FROM _app_audit_logs
                           WHERE table_name='StudyLogs' AND action='DELETE' ORDER BY record_id""")
        self.assertEqual([int(row[0]) for row in audits], [1, 3])
        self.assertEqual(json.loads(audits[0][1])['Id'], 2)

    def test_mixed_missing_unauthorized_or_closed_records_roll_back_everything(self):
        for log_ids, status in (([1, 999], 404), ([1, 4], 403)):
            with self.subTest(log_ids=log_ids):
                before = self.existing_rowids()
                self.assertEqual(self.bulk_delete(log_ids).status_code, status)
                self.assertEqual(self.existing_rowids(), before)
                self.assertFalse(self.sql("SELECT 1 FROM _app_audit_logs WHERE action='DELETE'"))

        self.sql('''INSERT INTO TeacherPayrollLines(PayrollMonth,StudyLogId,TeacherUsername,UnitAmount,Amount,Reason)
                    VALUES ('2026-06',5,'teacher_a',1,1,'검증')''')
        before = self.existing_rowids()
        self.assertEqual(self.bulk_delete([1, 5]).status_code, 409)
        self.assertEqual(self.existing_rowids(), before)
        self.assertFalse(self.sql("SELECT 1 FROM _app_audit_logs WHERE action='DELETE'"))
        self.sql('DELETE FROM TeacherPayrollLines')
        self.sql('''INSERT INTO TeacherPayrollClosures(PayrollMonth, TeacherUsername, ClosedBy)
                    VALUES ('2026-06', 'teacher_a', 'admin')''')
        before = self.existing_rowids()
        self.assertEqual(self.bulk_delete([1, 5]).status_code, 409)
        self.assertEqual(self.existing_rowids(), before)
        self.assertFalse(self.sql("SELECT 1 FROM _app_audit_logs WHERE action='DELETE'"))

    def test_search_returns_server_calculated_delete_flags_and_reason(self):
        self.sql('''INSERT INTO TeacherPayrollClosures(PayrollMonth, TeacherUsername, ClosedBy)
                    VALUES ('2026-06', 'teacher_a', 'admin')''')
        response = self.client.get('/api/user/studylogs/search?page=2&limit=50', headers=self.teacher_headers)
        self.assertEqual(response.status_code, 200)
        by_rowid = {row['row_id']: row for row in response.json()['studylogs']}
        self.assertIn(5, by_rowid)
        self.assertFalse(by_rowid[5]['CanDelete'])
        self.assertTrue(by_rowid[5]['MutationBlockedReason'])

    def test_manager_can_delete_regardless_of_teacher_assignment_and_retry_deletes_nothing_more(self):
        self.assertEqual(self.bulk_delete([4], headers=self.manager_headers).status_code, 200)
        after_success = self.existing_rowids()
        self.assertEqual(self.bulk_delete([4], headers=self.manager_headers).status_code, 404)
        self.assertEqual(self.existing_rowids(), after_success)

    def test_audit_failure_rolls_back_all_rows_and_earlier_audits(self):
        before = self.existing_rowids()
        original_write = main.write_audit_log
        calls = []
        def fail_second_audit(*args, **kwargs):
            calls.append(args)
            if len(calls) == 2:
                raise RuntimeError('감사 기록 실패')
            return original_write(*args, **kwargs)
        with self.assertLogs(level='ERROR'):
            with patch.object(main, 'write_audit_log', side_effect=fail_second_audit):
                response = self.bulk_delete([1, 3])
        self.assertEqual(len(calls), 2)
        self.assertEqual(response.status_code, 500)
        self.assertEqual(self.existing_rowids(), before)
        self.assertFalse(self.sql("SELECT 1 FROM _app_audit_logs WHERE action='DELETE'"))


if __name__ == '__main__':
    unittest.main()
