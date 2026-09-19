"""학습 기록 수정·삭제의 교사 귀속 및 정산 마감 권한을 검증한다.

실제 data.db를 전혀 사용하지 않고, 테스트마다 임시 SQLite DB를 만든다.
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


def create_fixture(path):
    """상세 조회 조인에 필요한 Books/Students 컬럼까지 갖춘 최소 도메인 DB."""
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
        CREATE TABLE StudyLogs (
            Id INTEGER PRIMARY KEY, StudentId INTEGER NOT NULL, BookId INTEGER NOT NULL,
            StudiedDay TEXT NOT NULL
        );

        INSERT INTO Books VALUES
            (1, '권한 검증 도서', '저자', '출판사', '', '', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, '');
        INSERT INTO Students VALUES
            (1, '같은 학생', '', '', '', '초3', ''),
            (2, '다른 학생', '', '', '', '초4', '');

        -- Id 1: 실제 진행 교사가 본인이지만 연결 수업 교사는 다른 기록
        INSERT INTO StudyLogs(Id, StudentId, BookId, StudiedDay) VALUES (1, 1, 1, '2026-06-13');
        -- Id 2: 실제 진행 교사 없이 본인 수업에 연결된 기록
        INSERT INTO StudyLogs(Id, StudentId, BookId, StudiedDay) VALUES (2, 1, 1, '2026-06-13');
        -- Id 3: 학생은 본인 수업 소속이지만 실제 진행 교사는 다른 기록
        INSERT INTO StudyLogs(Id, StudentId, BookId, StudiedDay) VALUES (3, 1, 1, '2026-06-13');
        -- Id 4: 학생은 본인 수업 소속이지만 연결 수업 교사는 다른 기록
        INSERT INTO StudyLogs(Id, StudentId, BookId, StudiedDay) VALUES (4, 1, 1, '2026-06-13');
        -- Id 5: 실제 진행 교사가 본인인 수업 미연결 기록
        INSERT INTO StudyLogs(Id, StudentId, BookId, StudiedDay) VALUES (5, 2, 1, '2026-06-13');
        -- Id 6: 실제 진행 교사 및 수업 연결이 모두 없는 기록
        INSERT INTO StudyLogs(Id, StudentId, BookId, StudiedDay) VALUES (6, 2, 1, '2026-06-13');
    ''')
    conn.commit()
    conn.close()


class StudyLogPermissionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.old_path = settings.SQLITE_DB_PATH
        settings.SQLITE_DB_PATH = str(Path(self.temp.name) / 'test.db')
        create_fixture(settings.SQLITE_DB_PATH)
        database.init_system_tables()
        main.init_activity_tables()
        database.create_user('teacher_a', '암호', 'teacher', '교사 A')
        database.create_user('teacher_b', '암호', 'teacher', '교사 B')
        database.create_user('manager_a', '암호', 'manager', '관리 선생님')

        self.sql('''INSERT INTO Classes(Id, ClassName, TeacherUsername, DayOfWeek, StartTime)
                    VALUES (1, 'A 수업', 'teacher_a', '월', '15:00'),
                           (2, 'B 수업', 'teacher_b', '화', '15:00')''')
        # 같은 학생이 A/B 수업에 모두 속해도, 학생 소속만으로 수정 권한이 생기면 안 된다.
        self.sql('''INSERT INTO ClassStudents(ClassId, StudentId) VALUES
                    (1, 1), (2, 1)''')
        self.sql('''UPDATE StudyLogs
                    SET ActualTeacherUsername=CASE Id
                        WHEN 1 THEN 'teacher_a' WHEN 3 THEN 'teacher_b' WHEN 5 THEN 'teacher_a'
                        ELSE '' END,
                        ClassId=CASE Id WHEN 1 THEN 2 WHEN 2 THEN 1 WHEN 4 THEN 2 ELSE NULL END,
                        LessonContent='기존 수업', Description='기존 메모', IsSpecial=0''')

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

    def update(self, log_id, data, headers=None):
        return self.client.put('/api/user/studylogs/' + str(log_id), headers=headers or self.teacher_headers,
                               json={'data': data})

    def delete(self, log_id, headers=None):
        return self.client.delete('/api/user/studylogs/' + str(log_id), headers=headers or self.teacher_headers)

    def detail(self, log_id):
        response = self.client.get('/api/user/studylogs/' + str(log_id), headers=self.teacher_headers)
        self.assertEqual(response.status_code, 200)
        return response.json()['studylog']

    def test_teacher_authorization_prefers_actual_teacher_then_class_teacher(self):
        # ActualTeacherUsername이 있으면 ClassId의 다른 교사와 무관하게 실제 진행 교사만 판단한다.
        self.assertEqual(self.update(1, {'Description': '본인 실제 진행'}).status_code, 200)
        # ActualTeacherUsername이 비어 있으면 연결된 Classes.TeacherUsername으로 판단한다.
        self.assertEqual(self.update(2, {'Description': '본인 수업'}).status_code, 200)
        # 수업 미연결이어도 ActualTeacherUsername이 본인이면 허용한다.
        self.assertEqual(self.update(5, {'Description': '수업 미연결 본인'}).status_code, 200)

    def test_student_membership_cannot_grant_teacher_mutation_permission(self):
        for log_id in (3, 4, 6):
            with self.subTest(log_id=log_id):
                before = self.sql('SELECT Description FROM StudyLogs WHERE Id=?', (log_id,))[0][0]
                self.assertEqual(self.update(log_id, {'Description': '권한 없는 수정'}).status_code, 403)
                self.assertEqual(self.delete(log_id).status_code, 403)
                self.assertEqual(self.sql('SELECT Description FROM StudyLogs WHERE Id=?', (log_id,))[0][0], before)

    def test_teacher_payload_is_allowlisted_even_for_same_value(self):
        for field, value in {
            'StudentId': 1,
            'ClassId': None,
            'ActualTeacherUsername': 'teacher_a',
            'UpdatedBy': '',
            'PayrollCategoryId': None,
        }.items():
            with self.subTest(field=field):
                self.assertEqual(self.update(1, {field: value}).status_code, 403)
        self.assertEqual(self.update(1, {
            'BookId': 1, 'StudiedDay': '2026-06-14', 'LessonContent': '변경 수업',
            'Description': '변경 메모', 'IsSpecial': True,
        }).status_code, 200)

    def test_teacher_payload_validates_book_special_text_and_calendar_date(self):
        invalid = [
            ({'BookId': 0}, '양의 정수'),
            ({'BookId': -1}, '양의 정수'),
            ({'BookId': True}, '정수 아닌 bool'),
            ({'BookId': 999}, '존재하지 않는 도서'),
            ({'IsSpecial': 2}, '특강 값 범위'),
            ({'IsSpecial': '1'}, '특강 문자열'),
            ({'Description': 123}, '메모 숫자'),
            ({'LessonContent': ['목록']}, '수업 내용 목록'),
            ({'StudiedDay': '2026-02-30'}, '실제 없는 날짜'),
            ({'StudiedDay': '2026/06/13'}, '날짜 형식'),
        ]
        for data, label in invalid:
            with self.subTest(label=label):
                self.assertEqual(self.update(1, data).status_code, 400)
        self.assertEqual(self.update(1, {'IsSpecial': 0, 'Description': '', 'LessonContent': ''}).status_code, 200)
        self.assertEqual(self.update(1, {'IsSpecial': True}).status_code, 200)

    def test_payroll_closure_for_original_or_target_month_blocks_teacher_update_and_delete(self):
        self.sql('''INSERT INTO TeacherPayrollClosures(PayrollMonth, TeacherUsername, ClosedBy)
                    VALUES ('2026-06', 'teacher_a', 'admin')''')
        self.assertEqual(self.update(1, {'Description': '마감월 수정'}).status_code, 409)
        self.assertEqual(self.delete(1).status_code, 409)

        self.sql('DELETE FROM TeacherPayrollClosures')
        self.sql('''INSERT INTO TeacherPayrollClosures(PayrollMonth, TeacherUsername, ClosedBy)
                    VALUES ('2026-07', 'teacher_a', 'admin')''')
        self.assertEqual(self.update(1, {'StudiedDay': '2026-07-01'}).status_code, 409)
        self.assertEqual(self.sql('SELECT StudiedDay FROM StudyLogs WHERE Id=1')[0][0], '2026-06-13')

    def test_payroll_line_blocks_teacher_update_and_delete(self):
        self.sql('''INSERT INTO TeacherPayrollLines
                    (PayrollMonth, StudyLogId, TeacherUsername, UnitAmount, Amount, Reason)
                    VALUES ('2026-06', 1, 'teacher_b', 1, 1, '')''')
        self.assertEqual(self.update(1, {'Description': '정산 행 수정'}).status_code, 409)
        self.assertEqual(self.delete(1).status_code, 409)

    def test_detail_returns_server_calculated_mutation_flags_and_reason(self):
        editable = self.detail(1)
        self.assertTrue(editable['CanEdit'])
        self.assertTrue(editable['CanDelete'])
        self.assertEqual(editable['MutationBlockedReason'], '')

        denied = self.detail(3)
        self.assertFalse(denied['CanEdit'])
        self.assertFalse(denied['CanDelete'])
        self.assertTrue(denied['MutationBlockedReason'])

        self.sql('''INSERT INTO TeacherPayrollClosures(PayrollMonth, TeacherUsername, ClosedBy)
                    VALUES ('2026-06', 'teacher_a', 'admin')''')
        closed = self.detail(1)
        self.assertFalse(closed['CanEdit'])
        self.assertFalse(closed['CanDelete'])
        self.assertTrue(closed['MutationBlockedReason'])

    def test_audit_write_failure_rolls_back_teacher_update_and_delete(self):
        before = tuple(self.sql('''SELECT BookId, StudiedDay, LessonContent, Description, IsSpecial
                                   FROM StudyLogs WHERE Id=1''')[0])
        with patch.object(main, 'write_audit_log', side_effect=RuntimeError('감사 기록 실패')):
            response = self.update(1, {'Description': '감사 실패 수정'})
        self.assertGreaterEqual(response.status_code, 400)
        self.assertEqual(tuple(self.sql('''SELECT BookId, StudiedDay, LessonContent, Description, IsSpecial
                                           FROM StudyLogs WHERE Id=1''')[0]), before)

        with patch.object(main, 'write_audit_log', side_effect=RuntimeError('감사 기록 실패')):
            response = self.delete(1)
        self.assertGreaterEqual(response.status_code, 400)
        self.assertEqual(self.sql('SELECT COUNT(*) FROM StudyLogs WHERE Id=1')[0][0], 1)

    def test_successful_update_and_delete_preserve_audit_snapshots(self):
        self.assertEqual(self.update(1, {'Description': '오기입 정정'}).status_code, 200)
        audit = self.sql("SELECT * FROM _app_audit_logs WHERE table_name='StudyLogs' AND action='UPDATE'")[0]
        self.assertEqual(audit['username'], 'teacher_a')
        self.assertEqual(audit['user_role'], 'teacher')
        self.assertEqual(json.loads(audit['old_data'])['Description'], '기존 메모')
        self.assertEqual(json.loads(audit['new_data'])['Description'], '오기입 정정')
        self.assertIn('Description', json.loads(audit['changed_fields']))
        self.assertEqual(self.delete(1).status_code, 200)
        self.assertFalse(self.sql('SELECT 1 FROM StudyLogs WHERE Id=1'))
        audit = self.sql("SELECT * FROM _app_audit_logs WHERE table_name='StudyLogs' AND action='DELETE'")[0]
        self.assertEqual(json.loads(audit['old_data'])['Description'], '오기입 정정')
        self.assertEqual(self.delete(1).status_code, 404)

    def test_date_change_rejects_cancellation_and_duplicate(self):
        self.sql("INSERT INTO ClassCancellations(ClassId,CancelledDay) VALUES (2,'2026-06-14')")
        self.assertEqual(self.update(1, {'StudiedDay': '2026-06-14'}).status_code, 409)
        self.sql("UPDATE StudyLogs SET StudiedDay='2026-06-15' WHERE Id=2")
        self.assertEqual(self.update(1, {'StudiedDay': '2026-06-15'}).status_code, 409)

    def test_search_includes_own_records_after_student_leaves_class(self):
        response = self.client.get('/api/user/studylogs/search', headers=self.teacher_headers)
        self.assertEqual(response.status_code, 200)
        ids = {row['Id'] for row in response.json()['studylogs']}
        self.assertIn(5, ids)
        self.assertNotIn(6, ids)

    def test_manager_keeps_existing_staff_mutation_authority(self):
        # manager 이상은 기존처럼 귀속과 무관하게 수정·삭제할 수 있다.
        self.assertEqual(self.update(3, {'Description': '관리자 수정'}, self.manager_headers).status_code, 200)
        self.assertEqual(self.delete(4, self.manager_headers).status_code, 200)


if __name__ == '__main__':
    unittest.main()
