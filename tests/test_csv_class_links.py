"""CSV 수업 연결 API 회귀 검증. 모든 데이터는 임시 SQLite에만 저장한다."""
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from jose import jwt

import csv_class_links
import database
import main
from auth import create_access_token
from config import settings


BASE = '/api/user/utilities/studylog-csv'


def create_fixture(path):
    # 원본 Id와 SQLite rowid가 다른 Oracle형 테이블도 함께 검증한다.
    with sqlite3.connect(path) as conn:
        conn.executescript('''
            CREATE TABLE Books (Id INTEGER UNIQUE, Title TEXT, Author TEXT, Publisher TEXT);
            CREATE TABLE Students (Id INTEGER UNIQUE, Name TEXT, Grade TEXT);
            CREATE TABLE StudyLogs (Id INTEGER UNIQUE, StudentId INTEGER, BookId INTEGER, StudiedDay TEXT);
            INSERT INTO Books VALUES (101, '검증 도서', '', '');
            INSERT INTO Students VALUES (201, '첫째학생', '초3'), (202, '둘째학생', '초4');
        ''')


class CsvClassLinkTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        old_path = settings.SQLITE_DB_PATH
        self.addCleanup(setattr, settings, 'SQLITE_DB_PATH', old_path)
        settings.SQLITE_DB_PATH = str(Path(self.temp.name) / 'class-links.db')
        create_fixture(settings.SQLITE_DB_PATH)
        database.init_system_tables()
        main.init_activity_tables()
        for username, role in [('link_a', 'teacher'), ('link_b', 'teacher'), ('link_manager', 'manager')]:
            database.create_user(username, '검증용암호', role, username)
        self.sql('''INSERT INTO Classes(Id,ClassName,TeacherUsername,DayOfWeek,IsEnded)
                    VALUES (1,'현재 수업','link_a','금',0),
                           (2,'과거 수업','link_a','화',1),
                           (3,'다른 교사 수업','link_b','금',0)''')
        self.sql('INSERT INTO ClassStudents(ClassId,StudentId) VALUES (1,1),(1,2)')
        self.client = TestClient(main.app)
        self.addCleanup(self.client.close)
        self.run_id, self.ids = self.import_run()
        self.sql('UPDATE StudyLogs SET Id=1000+rowid')

    def sql(self, statement, args=()):
        conn = database.get_db_connection()
        try:
            rows = conn.execute(statement, args).fetchall()
            conn.commit()
            return rows
        finally:
            conn.close()

    def headers(self, actor=None):
        return {'Authorization': 'Bearer ' + create_access_token({'sub': actor or settings.ADMIN_USERNAME})}

    def import_run(self, day='2026-09-18'):
        response = self.client.post(BASE + '/import', headers=self.headers(), json={
            'source_file': '검증.csv', 'rows': [
                {'row_number': sid, 'student_name': name, 'book_title': '검증 도서',
                 'studied_day': day, 'lesson_content': '원래 수업 내용', 'student_id': sid, 'book_id': 1}
                for sid, name in [(1, '첫째학생'), (2, '둘째학생')]]})
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertEqual(result['success_count'], 2, result)
        return result['run_id'], [r['studylog_id'] for r in result['results']]

    def preview(self, run_id=None):
        response = self.client.get(BASE + '/runs/%s/class-links' % (run_id or self.run_id), headers=self.headers())
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def links(self, class_id=1, run_id=None):
        return [{'token': r['token'], 'class_id': class_id} for r in self.preview(run_id)['rows'] if r['token']]

    def apply(self, links, actor=None):
        return self.client.post(BASE + '/class-links/apply', headers=self.headers(actor), json={'links': links})

    def records(self):
        return [dict(r) for r in self.sql('SELECT rowid AS row_id,* FROM StudyLogs ORDER BY rowid')]

    def audits(self):
        return [dict(r) for r in self.sql("SELECT * FROM _app_audit_logs WHERE table_name='StudyLogs' AND action='UPDATE' ORDER BY id")]

    def assert_rejected_unchanged(self, links, status=409, actor=None):
        records, audits = self.records(), self.audits()
        response = self.apply(links, actor)
        self.assertEqual(response.status_code, status, response.text)
        self.assertEqual(self.records(), records)
        self.assertEqual(self.audits(), audits)
        return response

    def test_current_membership_unique_multiple_and_teacher_special_filters(self):
        preview = self.preview()
        self.assertEqual(preview['total_count'], 2)
        self.assertEqual(preview['source_file'], '검증.csv')
        self.assertEqual([r['suggested_class_id'] for r in preview['rows']], [1, 1])
        self.sql('INSERT INTO ClassStudents(ClassId,StudentId) VALUES (2,1),(3,1)')
        self.assertIsNone(self.preview()['rows'][0]['suggested_class_id'])
        self.sql("UPDATE StudyLogs SET ActualTeacherUsername='link_b' WHERE rowid=?", (self.ids[0],))
        self.assertEqual(self.preview()['rows'][0]['suggested_class_id'], 3)
        self.sql('UPDATE StudyLogs SET IsSpecial=1 WHERE rowid=?', (self.ids[0],))
        self.assertIsNone(self.preview()['rows'][0]['suggested_class_id'])
        self.sql('UPDATE ClassStudents SET IsSpecial=1 WHERE ClassId=3')
        self.assertEqual(self.preview()['rows'][0]['suggested_class_id'], 3)

    def test_preview_excludes_linked_category_deleted_and_closed_records(self):
        cases = [
            ('UPDATE StudyLogs SET ClassId=1 WHERE rowid=?', '이미 수업'),
            ('UPDATE StudyLogs SET PayrollCategoryId=1 WHERE rowid=?', '정산 카테고리'),
            ('INSERT INTO TeacherPayrollLines(PayrollMonth,StudyLogId,TeacherUsername,UnitAmount,Amount) '
             "VALUES ('2026-09',?,'link_a',100,100)", '마감 정산'),
            ("UPDATE StudyLogs SET ActualTeacherUsername='link_a' WHERE rowid=?", '기존 진행 선생님'),
            ('DELETE FROM StudyLogs WHERE rowid=?', '삭제'),
        ]
        for statement, reason in cases:
            with self.subTest(reason=reason):
                self.sql("INSERT OR IGNORE INTO TeacherPayrollClosures(PayrollMonth,TeacherUsername,ClosedBy) VALUES ('2026-09','link_a','검증')")
                self.sql(statement, (self.ids[0],))
                row = self.preview()['rows'][0]
                self.assertIn(reason, row['reason'])
                self.assertEqual(row['token'], '')
                self.assertIsNone(row['suggested_class_id'])
                self.sql("UPDATE StudyLogs SET ClassId=NULL,PayrollCategoryId=NULL,ActualTeacherUsername='' WHERE rowid=?", (self.ids[0],))
                self.sql('DELETE FROM TeacherPayrollLines')

    def test_success_preserves_fields_and_audits_each_record(self):
        self.sql("UPDATE StudyLogs SET Description='남길 메모',IsSpecial=1,CreatedBy='원등록자',GradeSnapshot='초2' WHERE rowid=?", (self.ids[0],))
        before = self.records()
        response = self.apply(self.links())
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['linked_count'], 2)
        audits = self.audits()
        self.assertEqual(len(audits), 2)
        mutable = {'ClassId', 'ActualTeacherUsername', 'SubstituteStatus', 'GradeSnapshot', 'UpdatedBy', 'UpdatedAt'}
        for old, new, audit in zip(before, self.records(), audits):
            self.assertEqual({k: v for k, v in new.items() if k not in mutable},
                             {k: v for k, v in old.items() if k not in mutable})
            self.assertEqual((new['ClassId'], new['ActualTeacherUsername'], new['SubstituteStatus']), (1, 'link_a', 'approved'))
            self.assertEqual(new['GradeSnapshot'], '초2' if old['row_id'] == self.ids[0] else '초4')
            self.assertEqual(new['UpdatedBy'], settings.ADMIN_USERNAME)
            self.assertTrue(new['UpdatedAt'])
            self.assertEqual(str(audit['record_id']), str(old['row_id']))
            self.assertEqual(audit['username'], settings.ADMIN_USERNAME)
            self.assertEqual(audit['user_role'], 'admin')
            self.assertEqual(json.loads(audit['old_data']), {k: v for k, v in old.items() if k != 'row_id'})
            self.assertEqual(json.loads(audit['new_data']), {k: v for k, v in new.items() if k != 'row_id'})
            self.assertEqual(set(json.loads(audit['changed_fields'])), {k for k in new if old[k] != new[k]})

    def test_explicit_past_class_without_current_membership_allowed(self):
        self.assertFalse(self.sql('SELECT * FROM ClassStudents WHERE ClassId=2'))
        self.assertEqual(self.preview()['rows'][0]['suggested_class_id'], 1)
        response = self.apply(self.links(class_id=2))
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual([r['ClassId'] for r in self.records()], [2, 2])

    def test_existing_teacher_rejects_other_teacher_for_entire_batch(self):
        self.sql("UPDATE StudyLogs SET ActualTeacherUsername='link_a' WHERE rowid=?", (self.ids[1],))
        links = self.links()
        links[1]['class_id'] = 3
        response = self.assert_rejected_unchanged(links)
        self.assertIn('기존 진행 선생님', response.json()['detail'])

    def test_target_closure_cancellation_and_absence_rechecked(self):
        cases = [
            ('TeacherPayrollClosures', "INSERT INTO TeacherPayrollClosures(PayrollMonth,TeacherUsername,ClosedBy) VALUES ('2026-09','link_b','검증')", '마감'),
            ('ClassCancellations', "INSERT INTO ClassCancellations(ClassId,CancelledDay) VALUES (3,'2026-09-18')", '휴강'),
            ('StudentAbsences', "INSERT INTO StudentAbsences(StudentId,ClassId,StudiedDay) VALUES (202,3,'2026-09-18')", '결석'),
        ]
        for table, statement, reason in cases:
            with self.subTest(reason=reason):
                links = self.links()
                links[1]['class_id'] = 3
                self.sql(statement)
                response = self.assert_rejected_unchanged(links)
                self.assertIn(reason, response.json()['detail'])
                self.sql('DELETE FROM ' + table)

    def test_preview_changes_to_record_or_classes_reject_entire_batch(self):
        for statement in ["UPDATE StudyLogs SET Description='동시 수정' WHERE rowid=2",
                          "UPDATE Classes SET ClassName='변경된 수업' WHERE Id=1"]:
            with self.subTest(statement=statement):
                links = self.links()
                self.sql(statement)
                self.assert_rejected_unchanged(links)

    def test_replay_does_not_duplicate_updates_or_audits(self):
        links = self.links()
        self.assertEqual(self.apply(links).status_code, 200)
        self.assert_rejected_unchanged(links)
        self.assertTrue(all(not r['token'] for r in self.preview()['rows']))

    def test_teacher_cannot_preview_or_apply(self):
        response = self.client.get(BASE + '/runs/%s/class-links' % self.run_id, headers=self.headers('link_a'))
        self.assertEqual(response.status_code, 403)
        self.assert_rejected_unchanged(self.links(), 403, actor='link_a')

    def test_token_actor_expiry_purpose_and_signature_checked(self):
        link = self.links()[0]
        self.assert_rejected_unchanged([link], 400, actor='link_manager')
        claims = jwt.decode(link['token'], settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        for changes in [{'actor': 'link_manager'}, {'exp': 1}, {'purpose': 'teacher-assignment'}]:
            with self.subTest(changes=changes):
                token = jwt.encode(dict(claims, **changes), settings.SECRET_KEY, algorithm=settings.ALGORITHM)
                self.assert_rejected_unchanged([dict(link, token=token)], 400)
        self.assert_rejected_unchanged([dict(link, token='x' + link['token'])], 400)

    def test_duplicate_tokens_and_mixed_runs_rejected(self):
        link = self.links()[0]
        self.assert_rejected_unchanged([link, dict(link, class_id=2)], 400)
        other_run, _ = self.import_run('2026-09-25')
        self.assert_rejected_unchanged([link, self.links(run_id=other_run)[0]], 400)

    def test_audit_exception_rolls_back_updates_and_prior_audit(self):
        links = self.links()
        before = self.records(), self.audits()
        real_audit = csv_class_links.write_audit_log
        calls = []

        def fail_second(*args, **kwargs):
            calls.append(args)
            if len(calls) == 2:
                raise RuntimeError('감사 기록 실패')
            return real_audit(*args, **kwargs)

        with patch.object(csv_class_links, 'write_audit_log', side_effect=fail_second):
            with self.assertRaisesRegex(RuntimeError, '감사 기록 실패'):
                self.apply(links)
        self.assertEqual(len(calls), 2)
        self.assertEqual((self.records(), self.audits()), before)

    def test_rowid_and_original_id_aliases_preserve_identity(self):
        self.sql('UPDATE StudyLogs SET StudentId=201,BookId=101 WHERE rowid=?', (self.ids[0],))
        self.sql('UPDATE ClassStudents SET StudentId=202 WHERE StudentId=2')
        preview = self.preview()
        self.assertEqual([r['studylog_id'] for r in preview['rows']], self.ids)
        self.assertEqual([r['student_name'] for r in preview['rows']], ['첫째학생', '둘째학생'])
        self.assertEqual([r['book_title'] for r in preview['rows']], ['검증 도서', '검증 도서'])
        self.assertEqual([r['suggested_class_id'] for r in preview['rows']], [1, 1])
        response = self.apply(self.links())
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual([r['Id'] for r in self.records()], [1001, 1002])
        self.assertEqual([r['StudentId'] for r in self.records()], [201, 2])

    def test_student_alias_collision_excluded_and_absence_rowid_alias_checked(self):
        self.sql('UPDATE StudyLogs SET StudentId=201 WHERE rowid=?', (self.ids[0],))
        links = self.links()
        self.sql("INSERT INTO StudentAbsences(StudentId,ClassId,StudiedDay) VALUES (1,1,'2026-09-18')")
        self.assertIn('결석', self.assert_rejected_unchanged(links).json()['detail'])
        self.sql('DELETE FROM StudentAbsences')
        self.sql("INSERT INTO Students(rowid,Id,Name,Grade) VALUES (201,301,'충돌학생','초5')")
        row = self.preview()['rows'][0]
        self.assertIn('학생 식별자가 중복', row['reason'])
        self.assertEqual(row['token'], '')

    def test_existing_payroll_line_and_closure_added_after_preview_rejected(self):
        self.sql("UPDATE StudyLogs SET ActualTeacherUsername='link_a' WHERE rowid=?", (self.ids[1],))
        for table, statement in [
            ('TeacherPayrollLines', "INSERT INTO TeacherPayrollLines(PayrollMonth,StudyLogId,TeacherUsername,UnitAmount,Amount) VALUES ('2026-09',2,'link_a',100,100)"),
            ('TeacherPayrollClosures', "INSERT INTO TeacherPayrollClosures(PayrollMonth,TeacherUsername,ClosedBy) VALUES ('2026-09','link_a','검증')"),
        ]:
            with self.subTest(table=table):
                links = self.links()
                self.sql(statement)
                self.assert_rejected_unchanged(links)
                self.assertEqual(self.preview()['rows'][1]['token'], '')
                self.sql('DELETE FROM ' + table)

    def test_run_success_scope_deduplicates_and_rechecks_membership(self):
        links = self.links()
        results = json.loads(self.sql('SELECT results_json FROM _app_studylog_import_runs WHERE id=?', (self.run_id,))[0][0])
        results = [results[0], results[0], dict(results[1], status='failure')]
        self.sql('UPDATE _app_studylog_import_runs SET results_json=? WHERE id=?', (json.dumps(results), self.run_id))
        preview = self.preview()
        self.assertEqual(preview['total_count'], 1)
        self.assertEqual(preview['rows'][0]['studylog_id'], self.ids[0])
        self.assert_rejected_unchanged(links)
        response = self.client.get(BASE + '/runs/999999/class-links', headers=self.headers())
        self.assertEqual(response.status_code, 404)

    def test_request_count_and_class_id_validation(self):
        link = self.links()[0]
        for links, status in [([], 400), ([link] * 501, 400),
                              ([dict(link, class_id=0)], 400), ([dict(link, class_id=9999)], 400),
                              ([dict(link, class_id='1')], 422), ([dict(link, class_id=True)], 422)]:
            with self.subTest(count=len(links), status=status, class_id=links[0]['class_id'] if links else None):
                self.assert_rejected_unchanged(links, status)


if __name__ == '__main__':
    unittest.main()
