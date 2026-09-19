"""학습 기록 학생 이동의 엄격한 입력·별칭·정산 보호와 원자성을 검증한다."""
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


def create_transfer_fixture(path):
    """도서·학생 원본 Id 별칭과 학습 기록 rowid 충돌을 재현한다."""
    conn = sqlite3.connect(path)
    conn.executescript('''
        CREATE TABLE Books (Id INTEGER UNIQUE, Title TEXT);
        CREATE TABLE Students (Id INTEGER UNIQUE, Name TEXT, Grade TEXT);
        CREATE TABLE StudyLogs (Id INTEGER UNIQUE, StudentId INTEGER, BookId INTEGER, StudiedDay TEXT);
        INSERT INTO Books(rowid, Id, Title) VALUES (1, 101, '도서 A'), (2, 102, '도서 B');
        INSERT INTO Students(rowid, Id, Name, Grade) VALUES
            (1, 101, '기존 학생', '초3'), (2, 102, '이동할 학생', '초5'), (3, 103, '다른 학생', '초4');
        INSERT INTO StudyLogs(Id, StudentId, BookId, StudiedDay) VALUES
            (2, 101, 101, '2026-06-13'), (1, 1, 2, '2026-06-14'), (3, 103, 1, '2026-06-15');
    ''')
    conn.commit()
    conn.close()


class StudyLogBulkTransferTests(unittest.TestCase):
    confirmation = '선택한 기록 이동'

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.old_path = settings.SQLITE_DB_PATH
        settings.SQLITE_DB_PATH = str(Path(self.temp.name) / 'test.db')
        create_transfer_fixture(settings.SQLITE_DB_PATH)
        database.init_system_tables()
        main.init_activity_tables()
        for username, role in (('teacher_a', 'teacher'), ('teacher_b', 'teacher'),
                               ('manager_a', 'manager'), ('subadmin_a', 'subadmin')):
            database.create_user(username, '암호', role, username)
        self.sql('''INSERT INTO Classes(Id,ClassName,TeacherUsername,DayOfWeek,StartTime)
                    VALUES (1,'기존 수업','teacher_a','월','15:00')''')
        self.sql('''UPDATE StudyLogs SET ClassId=1, ActualTeacherUsername='teacher_a',
                    LessonContent='보존할 수업', Description='보존할 메모', IsSpecial=1,
                    GradeSnapshot='초2', SubstituteStatus='approved', CreatedBy='teacher_b',
                    UpdatedBy='기존 수정자', UpdatedAt='2026-01-01 10:00:00' ''')
        self.client = TestClient(main.app, raise_server_exceptions=False)
        self.headers = self.headers_for('manager_a')

    def tearDown(self):
        self.client.close()
        settings.SQLITE_DB_PATH = self.old_path
        self.temp.cleanup()

    def headers_for(self, username):
        return {'Authorization': 'Bearer ' + create_access_token({'sub': username})}

    def sql(self, statement, args=()):
        conn = database.get_db_connection()
        try:
            rows = conn.execute(statement, args).fetchall()
            conn.commit()
            return rows
        finally:
            conn.close()

    def records(self):
        return [dict(row) for row in self.sql('SELECT rowid AS _row_id,* FROM StudyLogs ORDER BY rowid')]

    def transfer(self, ids, target=102, confirmation=None, headers=None):
        return self.client.post('/api/user/studylogs/bulk-transfer', headers=headers or self.headers,
                                json={'log_ids': ids, 'target_student_id': target,
                                      'confirmation': self.confirmation if confirmation is None else confirmation})

    def assert_unchanged(self, ids, status=409, **kwargs):
        before = self.records()
        response = self.transfer(ids, **kwargs)
        self.assertEqual(response.status_code, status, response.text)
        self.assertEqual(self.records(), before)
        self.assertFalse(self.sql("SELECT 1 FROM _app_audit_logs WHERE table_name='StudyLogs'"))

    def test_authentication_and_teacher_denied(self):
        payload = {'log_ids': [1], 'target_student_id': 102, 'confirmation': self.confirmation}
        self.assertEqual(self.client.post('/api/user/studylogs/bulk-transfer', json=payload).status_code, 401)
        self.assert_unchanged([1], 403, headers=self.headers_for('teacher_a'))

    def test_strict_ids_exact_confirmation_and_required_fields(self):
        for ids in ([], [0], [-1], [1, 1], list(range(1, 52))):
            with self.subTest(ids=ids):
                self.assert_unchanged(ids, 400)
        for invalid in ('1', True, 1.0, None):
            with self.subTest(invalid=invalid):
                self.assert_unchanged([invalid], 422)
                self.assert_unchanged([1], 422, target=invalid)
        for target in (0, -1):
            self.assert_unchanged([1], 400, target=target)
        for confirmation in ('', '선택한 기록이동', ' 선택한 기록 이동', '선택한 기록 이동 '):
            self.assert_unchanged([1], 400, confirmation=confirmation)
        for missing in ('log_ids', 'target_student_id', 'confirmation'):
            payload = {'log_ids': [1], 'target_student_id': 102, 'confirmation': self.confirmation}
            del payload[missing]
            self.assertEqual(self.client.post('/api/user/studylogs/bulk-transfer', headers=self.headers,
                                              json=payload).status_code, 422)

    def test_missing_and_same_student_reject_entire_batch(self):
        self.assert_unchanged([1, 999], 404)
        self.assert_unchanged([1], 404, target=999)
        self.assert_unchanged([1], 400, target=101)
        self.assert_unchanged([1], 400, target=1)
        self.sql('UPDATE StudyLogs SET StudentId=999 WHERE rowid=2')
        self.assert_unchanged([1, 2], 404)
        self.sql('UPDATE StudyLogs SET StudentId=102 WHERE rowid=2')
        self.assert_unchanged([1, 2], 400)

    def test_exactly_fifty_rows_succeed(self):
        for index in range(4, 51):
            self.sql('''INSERT INTO StudyLogs(Id,StudentId,BookId,StudiedDay)
                        VALUES (?,1,1,?)''', (1000 + index, f'{2027 + index}-01-01'))
        response = self.transfer(list(range(1, 51)))
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['updated_rows'], 50)
        self.assertEqual(self.sql('SELECT COUNT(*) FROM StudyLogs WHERE StudentId=2')[0][0], 50)
        self.assertEqual(self.sql("SELECT COUNT(*) FROM _app_audit_logs WHERE action='UPDATE'")[0][0], 50)

    def test_rowid_identity_metadata_audits_and_historical_membership(self):
        # 현재 반 소속이 없어도 과거 기록을 이동하며 모든 업무 필드는 유지한다.
        self.assertFalse(self.sql('SELECT 1 FROM ClassStudents'))
        self.sql('UPDATE StudyLogs SET PayrollCategoryId=17 WHERE rowid=1')
        before = self.records()
        response = self.transfer([1, 3])
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['updated_rows'], 2)
        after = self.records()
        self.assertEqual(after[1], before[1])  # 원본 Id=1인 행은 변경하지 않는다.
        for index in (0, 2):
            for field, value in before[index].items():
                if field not in ('StudentId', 'UpdatedBy', 'UpdatedAt'):
                    self.assertEqual(after[index][field], value, field)
            self.assertEqual(after[index]['StudentId'], 2)
            self.assertEqual(after[index]['UpdatedBy'], 'manager_a')
            self.assertNotEqual(after[index]['UpdatedAt'], before[index]['UpdatedAt'])
        audits = self.sql("SELECT * FROM _app_audit_logs WHERE action='UPDATE' ORDER BY id")
        self.assertEqual([int(row['record_id']) for row in audits], [1, 3])
        for audit, index in zip(audits, (0, 2)):
            self.assertEqual(audit['username'], 'manager_a')
            self.assertEqual(audit['user_role'], 'manager')
            self.assertEqual(json.loads(audit['old_data'])['StudentId'], before[index]['StudentId'])
            self.assertEqual(json.loads(audit['new_data'])['StudentId'], 2)
            self.assertEqual(set(json.loads(audit['changed_fields'])), {'StudentId', 'UpdatedBy', 'UpdatedAt'})

    def test_staff_roles_are_allowed(self):
        for username, row_id in (('admin', 1), ('subadmin_a', 2), ('manager_a', 3)):
            response = self.transfer([row_id], headers=self.headers_for(username))
            self.assertEqual(response.status_code, 200, response.text)

    def test_student_alias_collision_and_destination_rowid_collision(self):
        # 목적지 Id=102는 유일하나 저장할 rowid=2가 다른 학생의 Id와 충돌한다.
        self.sql('UPDATE Students SET Id=2 WHERE rowid=3')
        self.assert_unchanged([1], target=102)
        self.assert_unchanged([1], target=2)
        self.sql('UPDATE Students SET Id=1 WHERE rowid=3')
        self.assert_unchanged([1])  # 출발 학생의 rowid 별칭 충돌도 차단한다.

    def test_existing_duplicate_uses_student_and_book_aliases(self):
        for student_id in (2, 102):
            for book_id in (1, 101):
                self.sql('''INSERT INTO StudyLogs(Id,StudentId,BookId,StudiedDay)
                            VALUES (999,?,?, '2026-06-13')''', (student_id, book_id))
                self.assert_unchanged([2, 1])
                self.sql('DELETE FROM StudyLogs WHERE Id=999')

    def test_batch_duplicate_uses_book_aliases(self):
        self.sql("UPDATE StudyLogs SET BookId=1, StudiedDay='2026-06-13' WHERE rowid=2")
        self.assert_unchanged([3, 1, 2])

    def test_book_alias_ambiguity_rejected(self):
        self.sql('UPDATE Books SET Id=1 WHERE rowid=2')
        self.assert_unchanged([1])

    def test_payroll_lines_block_staff_and_are_atomic(self):
        self.sql('''INSERT INTO TeacherPayrollLines(PayrollMonth,StudyLogId,TeacherUsername,UnitAmount,Amount,Reason)
                    VALUES ('2026-06',2,'teacher_a',1,1,'검증')''')
        self.assert_unchanged([1, 2])
        self.assert_unchanged([1, 2], headers=self.headers_for('admin'))

    def test_actual_teacher_closure_and_class_fallback_are_atomic(self):
        self.sql("UPDATE StudyLogs SET ActualTeacherUsername='teacher_b' WHERE rowid=2")
        self.sql('''INSERT INTO TeacherPayrollClosures(PayrollMonth,TeacherUsername,ClosedBy)
                    VALUES ('2026-06','teacher_b','admin')''')
        self.assert_unchanged([1, 2])
        self.sql('DELETE FROM TeacherPayrollClosures')
        self.sql("UPDATE StudyLogs SET ActualTeacherUsername='teacher_b' WHERE rowid=1")
        self.sql("UPDATE StudyLogs SET ActualTeacherUsername='' WHERE rowid=2")
        self.sql('''INSERT INTO TeacherPayrollClosures(PayrollMonth,TeacherUsername,ClosedBy)
                    VALUES ('2026-06','teacher_a','admin')''')
        self.assert_unchanged([1, 2])
        # 실제 진행 교사가 있으면 반 담당 교사의 마감은 적용하지 않는다.
        response = self.transfer([1])
        self.assertEqual(response.status_code, 200, response.text)

    def test_absence_aliases_and_cancellation_are_atomic(self):
        for student_id in (2, 102):
            self.sql('''INSERT INTO StudentAbsences(StudentId,ClassId,StudiedDay,AbsenceReason)
                        VALUES (?,1,'2026-06-14','검증')''', (student_id,))
            self.assert_unchanged([1, 2])
            self.sql('DELETE FROM StudentAbsences')
        self.sql("INSERT INTO ClassCancellations(ClassId,CancelledDay) VALUES (1,'2026-06-14')")
        self.assert_unchanged([1, 2])

    def test_audit_failure_rolls_back_updates_and_earlier_audits(self):
        before = self.records()
        original = main.write_audit_log
        connections = []

        def fail_second(*args, **kwargs):
            connections.append(kwargs['connection'])
            if len(connections) == 2:
                raise RuntimeError('감사 기록 실패')
            return original(*args, **kwargs)

        with self.assertLogs(level='ERROR'):
            with patch.object(main, 'write_audit_log', side_effect=fail_second):
                response = self.transfer([1, 2])
        self.assertEqual(response.status_code, 500)
        self.assertEqual(len(connections), 2)
        self.assertIs(connections[0], connections[1])
        self.assertEqual(self.records(), before)
        self.assertFalse(self.sql("SELECT 1 FROM _app_audit_logs WHERE table_name='StudyLogs'"))


if __name__ == '__main__':
    unittest.main()
