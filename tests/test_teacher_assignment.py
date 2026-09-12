"""교사 일괄 지정 회귀 검증. 실제 DB 대신 임시 SQLite만 사용한다."""
import io
import json
import sqlite3
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

from fastapi.testclient import TestClient
from openpyxl import Workbook

import database
import main
from auth import create_access_token
from config import settings
from teacher_assignment import parse_assignment_file


def create_fixture(path):
    conn = sqlite3.connect(path)
    conn.executescript('''
        CREATE TABLE Books (Id INTEGER PRIMARY KEY, Title TEXT, Author TEXT, Publisher TEXT);
        CREATE TABLE Students (Id INTEGER PRIMARY KEY, Name TEXT, Grade TEXT);
        CREATE TABLE StudyLogs (Id INTEGER PRIMARY KEY, StudentId INTEGER, BookId INTEGER, StudiedDay TEXT);
        INSERT INTO Books VALUES (1, '검증 도서', '', '');
        INSERT INTO Students VALUES (1, '검증학생', '초3');
        INSERT INTO Students VALUES (2, '두번째학생', '초4');
        INSERT INTO StudyLogs VALUES (1, 1, 1, '2026-06-13');
        INSERT INTO StudyLogs VALUES (2, 2, 1, '2026-06-13');
    ''')
    conn.commit()
    conn.close()


class TeacherAssignmentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.old_path = settings.SQLITE_DB_PATH
        settings.SQLITE_DB_PATH = str(Path(self.temp.name) / 'test.db')
        create_fixture(settings.SQLITE_DB_PATH)
        database.init_system_tables()
        main.init_activity_tables()
        database.create_user('assignment_teacher', '검증암호', 'teacher', '검증교사')
        self.client = TestClient(main.app)
        self.headers = {'Authorization': 'Bearer ' + create_access_token({'sub': settings.ADMIN_USERNAME})}

    def tearDown(self):
        self.client.close()
        settings.SQLITE_DB_PATH = self.old_path
        self.temp.cleanup()

    def sql(self, sql, args=()):
        conn = database.get_db_connection()
        try:
            rows = conn.execute(sql, args).fetchall()
            conn.commit()
            return rows
        finally:
            conn.close()

    def preview(self, text='이름,일자\n검증학생,2026-06-13\n', headers=None):
        return self.client.post('/api/user/utilities/teacher-assignment/preview',
                                headers=headers or self.headers,
                                files={'file': ('2026-7월.csv', text.encode('utf-8'), 'text/csv')},
                                data={'teacher_username': 'assignment_teacher', 'month': '2026-06'})

    def apply(self, preview):
        return self.client.post('/api/user/utilities/teacher-assignment/apply', headers=self.headers,
                                json={'tokens': [r['token'] for r in preview['rows'] if r['ready']]})

    def test_cell_date_overrides_sheet_month(self):
        workbook = Workbook()
        sheet = workbook.active
        sheet.title = '2026-7월'
        sheet.append(['이름', '1차시', '2차시'])
        sheet.append(['검증학생', datetime(2026, 6, 13), datetime(2026, 7, 1)])
        content = io.BytesIO()
        workbook.save(content)
        rows = parse_assignment_file(content.getvalue(), '차시표.xlsx', '2026-06')
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['studied_day'], '2026-06-13')
        self.assertEqual(rows[0]['error'], '')

    def test_xlsx_without_optional_module(self):
        import builtins
        from unittest.mock import patch
        workbook = Workbook()
        workbook.active.title = '2026-7월'
        workbook.active.append(['이름', '1차시'])
        workbook.active.append(['검증학생', datetime(2026, 6, 13)])
        content = io.BytesIO()
        workbook.save(content)
        normal = parse_assignment_file(content.getvalue(), '차시.xlsx', '2026-06')
        original_import = builtins.__import__
        def without_openpyxl(name, *args, **kwargs):
            if name == 'openpyxl':
                raise ModuleNotFoundError("No module named 'openpyxl'")
            return original_import(name, *args, **kwargs)
        with patch('builtins.__import__', side_effect=without_openpyxl):
            fallback = parse_assignment_file(content.getvalue(), '차시.xlsx', '2026-06')
        self.assertEqual(fallback, normal)

    def test_apply_is_audited_and_idempotent(self):
        preview = self.preview().json()
        self.assertEqual(preview['ready_count'], 1)
        self.assertEqual(self.sql('SELECT ActualTeacherUsername FROM StudyLogs WHERE Id=1')[0][0], '')
        self.assertEqual(self.apply(preview).status_code, 200)
        row = self.sql('SELECT ActualTeacherUsername, ClassId, PayrollCategoryId FROM StudyLogs WHERE Id=1')[0]
        self.assertEqual(tuple(row), ('assignment_teacher', None, None))
        audit = self.sql('SELECT old_data,new_data FROM _app_audit_logs WHERE table_name=?', ('StudyLogs',))[0]
        self.assertEqual(json.loads(audit['old_data'])['ActualTeacherUsername'], '')
        self.assertEqual(json.loads(audit['new_data'])['ActualTeacherUsername'], 'assignment_teacher')
        self.assertEqual(self.apply(preview).status_code, 409)
        self.assertEqual(self.preview().json()['ready_count'], 0)

    def test_stale_preview_rolls_back_entire_batch(self):
        preview = self.preview('이름,일자\n검증학생,2026-06-13\n두번째학생,2026-06-13\n').json()
        self.sql('UPDATE StudyLogs SET Description=? WHERE Id=2', ('다른 작업의 수정',))
        self.assertEqual(self.apply(preview).status_code, 409)
        self.assertEqual(self.sql("SELECT COUNT(*) FROM StudyLogs WHERE ActualTeacherUsername != ''")[0][0], 0)

    def test_duplicates_and_ambiguity(self):
        result = self.preview('이름,일자\n검증학생,2026-06-13\n검증학생,2026-06-13\n').json()
        self.assertEqual(result['ready_count'], 1)
        self.sql("INSERT INTO StudyLogs(Id,StudentId,BookId,StudiedDay) VALUES (3,1,1,'2026-06-13')")
        result = self.preview().json()
        self.assertEqual(result['ready_count'], 2)
        self.assertFalse(any(row['auto_select'] for row in result['rows']))

    def test_same_name_and_existing_teacher_excluded(self):
        self.sql("UPDATE StudyLogs SET ActualTeacherUsername='someone' WHERE Id=1")
        self.assertEqual(self.preview().json()['ready_count'], 0)
        self.sql("UPDATE StudyLogs SET ActualTeacherUsername='' WHERE Id=1")
        self.sql("INSERT INTO Students(Id,Name,Grade) VALUES (3,'검증학생','초4')")
        result = self.preview().json()
        self.assertEqual(result['ready_count'], 1)
        self.assertFalse(result['rows'][0]['auto_select'])

    def test_parentheses_on_both_sides_keep_server_identity(self):
        self.sql("UPDATE Students SET Name='검증학생(서버 주석)' WHERE Id=1")
        preview = self.preview('이름,일자\n검증학생（파일 주석）,2026-06-13\n').json()
        self.assertEqual(preview['ready_count'], 1)
        self.assertEqual(preview['rows'][0]['server_student_name'], '검증학생(서버 주석)')
        self.assertEqual(self.apply(preview).status_code, 200)
        self.assertEqual(self.sql('SELECT Name FROM Students WHERE Id=1')[0][0], '검증학생(서버 주석)')

    def test_two_books_repeated_source_can_apply_selected_book_only(self):
        self.sql("INSERT INTO Books(Id,Title) VALUES (2,'두 번째 도서')")
        self.sql("INSERT INTO StudyLogs(Id,StudentId,BookId,StudiedDay) VALUES (3,1,2,'2026-06-13')")
        preview = self.preview('이름,일자\n검증학생,2026-06-13\n검증학생(메모),2026-06-13\n').json()
        self.assertEqual(len(preview['rows']), 4)
        ready = [row for row in preview['rows'] if row['ready']]
        self.assertEqual({row['studylog_id'] for row in ready}, {1, 3})
        self.assertEqual({row['book_title'] for row in ready}, {'검증 도서', '두 번째 도서'})
        chosen = next(row for row in ready if row['studylog_id'] == 3)
        response = self.client.post('/api/user/utilities/teacher-assignment/apply', headers=self.headers,
                                    json={'tokens': [chosen['token']]})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.sql('SELECT ActualTeacherUsername FROM StudyLogs WHERE Id=1')[0][0], '')
        self.assertEqual(self.sql('SELECT ActualTeacherUsername FROM StudyLogs WHERE Id=3')[0][0], 'assignment_teacher')

    def test_same_normalized_server_names_are_separate_candidates(self):
        self.sql("UPDATE Students SET Name='검증학생(A)' WHERE Id=1")
        self.sql("UPDATE Students SET Name='검증학생(B)' WHERE Id=2")
        preview = self.preview().json()
        self.assertEqual(preview['ready_count'], 2)
        self.assertEqual({r['server_student_id'] for r in preview['rows']}, {1, 2})
        self.assertFalse(any(r['auto_select'] for r in preview['rows']))

    def test_closed_month_rechecked(self):
        preview = self.preview().json()
        self.sql('INSERT INTO TeacherPayrollClosures(PayrollMonth,TeacherUsername,ClosedBy) VALUES (?,?,?)', ('2026-06', 'assignment_teacher', '검증'))
        self.assertEqual(self.apply(preview).status_code, 409)
        self.assertEqual(self.preview().json()['ready_count'], 0)

    def test_teacher_role_cannot_preview_or_apply(self):
        headers = {'Authorization': 'Bearer ' + create_access_token({'sub': 'assignment_teacher'})}
        self.assertEqual(self.preview(headers=headers).status_code, 403)
        self.assertEqual(self.client.post('/api/user/utilities/teacher-assignment/apply', headers=headers, json={'tokens': ['x']}).status_code, 403)

    def test_tampered_preview_rejected(self):
        token = self.preview().json()['rows'][0]['token']
        response = self.client.post('/api/user/utilities/teacher-assignment/apply', headers=self.headers,
                                    json={'tokens': ['x' + token]})
        self.assertEqual(response.status_code, 400)

    def test_audit_failure_rolls_back_changes(self):
        from unittest.mock import patch
        preview = self.preview().json()
        with patch.object(main, 'write_audit_log', side_effect=RuntimeError('감사 기록 실패')):
            with self.assertRaises(RuntimeError):
                self.apply(preview)
        self.assertEqual(self.sql('SELECT ActualTeacherUsername FROM StudyLogs WHERE Id=1')[0][0], '')

    def test_csv_short_date_uses_year_only(self):
        rows = parse_assignment_file('이름,1차시\n검증학생,6/13\n'.encode(), '2026-7월.csv', '2026-06')
        self.assertEqual(rows[0]['studied_day'], '2026-06-13')

    def test_payroll_footer_is_not_a_student(self):
        text = '구분,학년,이름,1차시,2차시\n목,초3,검증학생,6/13,\n,,초등개인반,수업단가,회의\n,,합계,8000,10000\n'
        rows = parse_assignment_file(text.encode(), '2026-7월.csv')
        self.assertEqual(len(rows), 1)


if __name__ == '__main__':
    unittest.main()
