"""미입력 학습 기록 보완 API. 실제 데이터가 아닌 임시 SQLite에서 검증한다."""
import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from jose import jwt

import database
import main
import studylog_completion
from auth import create_access_token
from config import settings

BASE = '/api/user/studylog-completion'


class StudylogCompletionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        old_path = settings.SQLITE_DB_PATH
        self.addCleanup(setattr, settings, 'SQLITE_DB_PATH', old_path)
        settings.SQLITE_DB_PATH = str(Path(self.temp.name) / 'completion.db')
        with closing(sqlite3.connect(settings.SQLITE_DB_PATH)) as conn:
            conn.executescript('''
                CREATE TABLE Books (Id INTEGER UNIQUE, Title TEXT, Author TEXT, Publisher TEXT);
                CREATE TABLE Students (Id INTEGER UNIQUE, Name TEXT, Grade TEXT);
                CREATE TABLE StudyLogs (Id INTEGER UNIQUE, StudentId INTEGER, BookId INTEGER, StudiedDay TEXT);
                INSERT INTO Books VALUES (101, '검증 도서', '', '');
                INSERT INTO Students VALUES (201, '첫째학생', '초3'), (202, '둘째학생', '초4');
            ''')
        database.init_system_tables()
        main.init_activity_tables()
        for username, role in [('complete_a', 'teacher'), ('complete_b', 'teacher'),
                               ('complete_manager', 'manager'), ('complete_subadmin', 'subadmin')]:
            database.create_user(username, '검증용암호', role, username)
        self.sql('''INSERT INTO Classes(Id,ClassName,TeacherUsername,DayOfWeek)
            VALUES (1,'첫 수업','complete_a','금'), (2,'다른 수업','complete_b','금')''')
        self.sql('INSERT INTO ClassStudents(ClassId,StudentId) VALUES (1,201)')
        self.sql('''INSERT INTO StudyLogs(Id,StudentId,BookId,StudiedDay,ClassId,ActualTeacherUsername,LessonContent,Description)
            VALUES (501,201,101,'2026-09-18',1,'','','유지할 메모'),
                   (502,1,1,'2026-09-19',NULL,'complete_a','','다른 메모'),
                   (503,201,101,'2026-09-20',2,'complete_b','이미 입력',''),
                   (504,202,101,'2026-09-18',2,'complete_b','','')''')
        self.client = TestClient(main.app)
        self.addCleanup(self.client.close)

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

    def get(self, student=1, field='content', actor=None, **params):
        return self.client.get(BASE, headers=self.headers(actor),
                               params={'student_id': student, 'field': field, **params})

    def preview(self, **kwargs):
        response = self.get(**kwargs)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def row(self, row_id=1, **kwargs):
        return next(row for row in self.preview(**kwargs)['rows'] if row['row_id'] == row_id)

    def save(self, row_id=1, field='content', value='보완한 내용', actor=None, token=None, **extra):
        if token is None:
            token = self.row(row_id, field=field, actor=actor)['token']
        return self.client.post(BASE + '/' + str(row_id), headers=self.headers(actor),
                                json={'field': field, 'value': value, 'token': token, **extra})

    def record(self, row_id=1):
        return dict(self.sql('SELECT * FROM StudyLogs WHERE rowid=?', (row_id,))[0])

    def audits(self):
        return self.sql("SELECT * FROM _app_audit_logs WHERE table_name='StudyLogs'")

    def test_exact_rowid_dual_student_aliases_coverage_and_order(self):
        result = self.preview()
        self.assertEqual(result['student'], {'row_id': 1, 'Name': '첫째학생'})
        self.assertEqual(result['coverage'], {'total': 3, 'teacher_filled': 2, 'content_filled': 1})
        self.assertEqual([row['row_id'] for row in result['rows']], [2, 1])
        self.assertEqual(result['rows'][1]['BookTitle'], '검증 도서')
        self.assertEqual(result['rows'][1]['ClassName'], '첫 수업')
        self.assertEqual(self.get(student=201).status_code, 404)
        self.assertEqual(self.preview(field='teacher')['total_count'], 1)
        self.assertEqual(len(result['teachers']), 4)

    def test_pagination_counts_before_limit_and_validated_params(self):
        result = self.preview(limit=1, page=2)
        self.assertEqual((result['total_count'], result['total_pages']), (2, 2))
        self.assertEqual(result['rows'][0]['row_id'], 1)
        self.assertEqual(self.get(limit=51).status_code, 422)
        self.assertEqual(self.get(field='invalid').status_code, 422)
        self.assertEqual(self.get(student=0).status_code, 422)

    def test_shared_unicode_whitespace_rules(self):
        whitespace = database._STUDENT_RECORD_WHITESPACE
        self.sql('UPDATE StudyLogs SET ActualTeacherUsername=?,LessonContent=? WHERE rowid=1', (whitespace, whitespace))
        self.assertEqual(self.preview()['coverage']['content_filled'], 1)
        self.assertEqual(self.preview(field='teacher')['total_count'], 1)
        response = self.save(value=whitespace + '채운 내용' + whitespace)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.record()['LessonContent'], '채운 내용')

    def test_empty_student_has_zero_coverage(self):
        self.sql("INSERT INTO Students(Id,Name,Grade) VALUES (203,'기록없음','초1')")
        result = self.preview(student=3)
        self.assertEqual(result['rows'], [])
        self.assertEqual(result['coverage'], {'total': 0, 'teacher_filled': 0, 'content_filled': 0})
        self.assertEqual(result['total_pages'], 1)

    def test_content_success_only_changes_field_and_audit_metadata(self):
        before = self.record()
        response = self.save()
        self.assertEqual(response.status_code, 200, response.text)
        after = self.record()
        mutable = {'LessonContent', 'UpdatedBy', 'UpdatedAt'}
        self.assertEqual({k: v for k, v in before.items() if k not in mutable},
                         {k: v for k, v in after.items() if k not in mutable})
        self.assertEqual(after['LessonContent'], '보완한 내용')
        self.assertEqual(after['UpdatedBy'], settings.ADMIN_USERNAME)
        audits = self.audits()
        self.assertEqual(len(audits), 1)
        self.assertEqual(json.loads(audits[0]['old_data']), before)
        self.assertEqual(json.loads(audits[0]['new_data']), after)
        self.assertEqual(set(json.loads(audits[0]['changed_fields'])), mutable)
        self.assertEqual(self.preview()['coverage']['content_filled'], 2)

    def test_teacher_assignment_preserves_class_category_grade_and_status(self):
        self.sql("UPDATE StudyLogs SET PayrollCategoryId=77,GradeSnapshot='초2',SubstituteStatus='유지' WHERE rowid=1")
        before = self.record()
        response = self.save(field='teacher', value='complete_b')
        self.assertEqual(response.status_code, 200, response.text)
        mutable = {'ActualTeacherUsername', 'UpdatedBy', 'UpdatedAt'}
        self.assertEqual({k: v for k, v in before.items() if k not in mutable},
                         {k: v for k, v in self.record().items() if k not in mutable})
        self.assertEqual(self.record()['ActualTeacherUsername'], 'complete_b')

    def test_teacher_own_content_and_field_restriction(self):
        result = self.preview(actor='complete_a')
        self.assertEqual(result['teachers'], [])
        self.assertTrue(self.row(actor='complete_a')['CanEdit'])
        response = self.save(actor='complete_a')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.get(field='teacher', actor='complete_a').status_code, 403)
        self.assertEqual(self.save(field='teacher', value='complete_a', actor='complete_a', token='invalid').status_code, 403)

    def test_teacher_assigned_student_other_teacher_readonly(self):
        self.sql("UPDATE StudyLogs SET LessonContent='' WHERE rowid=3")
        row = self.row(3, actor='complete_a')
        self.assertFalse(row['CanEdit'])
        self.assertEqual(row['token'], '')
        self.assertIn('본인이 진행한', row['MutationBlockedReason'])

    def test_teacher_moved_student_only_own_records_and_no_unrelated_student(self):
        self.sql('DELETE FROM ClassStudents')
        result = self.preview(actor='complete_a')
        self.assertEqual([row['row_id'] for row in result['rows']], [2, 1])
        self.assertEqual(result['coverage']['total'], 3)
        self.assertEqual(self.get(student=2, actor='complete_a').status_code, 403)
        self.sql("UPDATE StudyLogs SET LessonContent='' WHERE rowid=3")
        self.assertNotIn(3, [row['row_id'] for row in self.preview(actor='complete_a')['rows']])

    def test_staff_roles_allowed_and_teacher_target_roles_checked(self):
        for actor in ['complete_manager', 'complete_subadmin']:
            self.assertTrue(self.row(actor=actor)['CanEdit'])
        for value in ['unknown', settings.ADMIN_USERNAME]:
            response = self.save(field='teacher', value=value)
            self.assertEqual(response.status_code, 400, response.text)
        self.assertEqual(self.save(field='teacher', value='complete_manager', actor='complete_subadmin').status_code, 200)

    def test_closed_payroll_line_blocks_staff_and_teacher(self):
        token = self.row()['token']
        self.sql("INSERT INTO TeacherPayrollLines(PayrollMonth,StudyLogId,TeacherUsername,UnitAmount,Amount) VALUES ('2026-09',1,'complete_a',100,100)")
        for actor in [None, 'complete_a']:
            row = self.row(actor=actor)
            self.assertFalse(row['CanEdit'])
            self.assertIn('마감', row['MutationBlockedReason'])
        self.assertEqual(self.save(token=token).status_code, 409)
        self.assertEqual(self.record()['LessonContent'], '')

    def test_existing_class_and_target_teacher_month_closures(self):
        token = self.row(field='teacher')['token']
        self.sql("INSERT INTO TeacherPayrollClosures(PayrollMonth,TeacherUsername,ClosedBy) VALUES ('2026-09','complete_b','검증')")
        self.assertEqual(self.save(field='teacher', value='complete_b', token=token).status_code, 409)
        self.sql("UPDATE TeacherPayrollClosures SET TeacherUsername='complete_a'")
        self.assertFalse(self.row()['CanEdit'])
        self.assertEqual(self.save(field='teacher', value='complete_b', token=token).status_code, 409)
        self.assertFalse(self.row(2)['CanEdit'])

    def test_student_alias_collision_rejected_without_changes(self):
        token = self.row()['token']
        self.sql("INSERT INTO Students(rowid,Id,Name,Grade) VALUES (201,901,'충돌학생','초1')")
        self.assertEqual(self.get().status_code, 409)
        self.assertEqual(self.save(token=token).status_code, 409)
        self.assertFalse(self.audits())

    def test_stale_record_and_class_changes_rejected(self):
        token = self.row()['token']
        self.sql("UPDATE StudyLogs SET Description='동시 변경' WHERE rowid=1")
        self.assertEqual(self.save(token=token).status_code, 409)
        token = self.row()['token']
        self.sql("UPDATE Classes SET TeacherUsername='complete_b' WHERE Id=1")
        self.assertEqual(self.save(token=token).status_code, 409)
        self.assertEqual(self.record()['LessonContent'], '')

    def test_replay_and_already_filled_value_never_overwritten(self):
        token = self.row()['token']
        self.assertEqual(self.save(token=token).status_code, 200)
        self.assertEqual(self.save(token=token, value='덮어쓰기').status_code, 409)
        self.assertEqual(self.record()['LessonContent'], '보완한 내용')
        self.assertEqual(len(self.audits()), 1)

    def test_token_tampering_actor_record_field_and_expiry(self):
        token = self.row()['token']
        for kwargs in [{'token': token + 'x'}, {'token': token, 'actor': 'complete_manager'},
                       {'token': token, 'row_id': 2}, {'token': token, 'field': 'teacher', 'value': 'complete_a'}]:
            self.assertEqual(self.save(**kwargs).status_code, 400)
        claims = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        claims['exp'] = datetime.utcnow() - timedelta(seconds=1)
        expired = jwt.encode(claims, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
        self.assertEqual(self.save(token=expired).status_code, 400)
        self.assertFalse(self.audits())

    def test_audit_failure_rolls_back_and_reports_generic_error(self):
        before = self.record()
        with patch.object(studylog_completion, 'write_audit_log', side_effect=RuntimeError('검증 오류')):
            response = self.save()
        self.assertEqual(response.status_code, 500, response.text)
        self.assertEqual(self.record(), before)
        self.assertFalse(self.audits())

    def test_invalid_value_and_extra_field_rejected(self):
        for value in ['', '\u3000\n', '가' * 10001]:
            self.assertEqual(self.save(value=value).status_code, 400)
        self.assertEqual(self.save(value=123).status_code, 422)
        self.assertEqual(self.save(StudentId=2).status_code, 422)
        self.assertFalse(self.audits())

    def test_permission_rechecked_at_save(self):
        token = self.row(actor='complete_a')['token']
        self.sql("UPDATE _app_users SET role='teacher' WHERE username='complete_manager'")
        self.sql("INSERT INTO TeacherPayrollClosures(PayrollMonth,TeacherUsername,ClosedBy) VALUES ('2026-09','complete_a','검증')")
        self.assertEqual(self.save(actor='complete_a', token=token).status_code, 409)
        self.assertEqual(self.record()['LessonContent'], '')

    def test_invalid_day_is_readonly(self):
        self.sql("UPDATE StudyLogs SET StudiedDay='일자 불명' WHERE rowid=1")
        row = self.row()
        self.assertFalse(row['CanEdit'])
        self.assertIn('일자', row['MutationBlockedReason'])

    def prepare_bulk(self, actor=None):
        self.sql("UPDATE StudyLogs SET ActualTeacherUsername='' WHERE rowid=2")
        rows = {row['row_id']: row for row in self.preview(field='teacher', actor=actor)['rows']}
        return [{'row_id': row_id, 'token': rows[row_id]['token']} for row_id in [1, 2]]

    def bulk_save(self, records, teacher='complete_b', actor=None, **extra):
        return self.client.post(BASE + '/bulk-teacher', headers=self.headers(actor),
                                json={'teacher_username': teacher, 'records': records, **extra})

    def assert_bulk_unchanged(self, before):
        self.assertEqual([self.record(1), self.record(2)], before)
        self.assertFalse(self.audits())

    def test_bulk_success_keeps_unrelated_fields_and_writes_individual_audits(self):
        self.sql("UPDATE StudyLogs SET PayrollCategoryId=77,GradeSnapshot='초2',SubstituteStatus='유지' WHERE rowid IN (1,2)")
        records = self.prepare_bulk()
        before = [self.record(1), self.record(2)]
        response = self.bulk_save(records)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['updated_count'], 2)
        mutable = {'ActualTeacherUsername', 'UpdatedBy', 'UpdatedAt'}
        for row_id, old in zip([1, 2], before):
            new = self.record(row_id)
            self.assertEqual(new['ActualTeacherUsername'], 'complete_b')
            self.assertEqual(new['UpdatedBy'], settings.ADMIN_USERNAME)
            self.assertEqual({k: v for k, v in old.items() if k not in mutable},
                             {k: v for k, v in new.items() if k not in mutable})
        audits = self.audits()
        self.assertEqual(len(audits), 2)
        self.assertEqual({str(row['record_id']) for row in audits}, {'1', '2'})
        self.assertTrue(all(row['action'] == 'UPDATE' for row in audits))
        self.assertTrue(all(set(json.loads(row['changed_fields'])) == mutable for row in audits))
        self.assertEqual(self.preview(field='teacher')['total_count'], 0)
        self.assertEqual(self.bulk_save(records).status_code, 409)
        self.assertEqual(len(self.audits()), 2)

    def test_bulk_staff_only_and_valid_teacher_roles(self):
        records = self.prepare_bulk()
        before = [self.record(1), self.record(2)]
        self.assertEqual(self.bulk_save(records, actor='complete_a').status_code, 403)
        for teacher in ['', '  ', database._STUDENT_RECORD_WHITESPACE, 'unknown', settings.ADMIN_USERNAME]:
            self.assertEqual(self.bulk_save(records, teacher=teacher).status_code, 400)
        self.assert_bulk_unchanged(before)
        records = self.prepare_bulk(actor='complete_manager')
        response = self.bulk_save(records, actor='complete_manager', teacher='complete_subadmin')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.record(2)['ActualTeacherUsername'], 'complete_subadmin')

    def test_bulk_count_id_types_duplicate_and_extra_fields(self):
        records = self.prepare_bulk()
        before = [self.record(1), self.record(2)]
        for invalid in [[], records * 26]:
            self.assertEqual(self.bulk_save(invalid).status_code, 422)
        self.assertEqual(self.bulk_save([records[0], records[0]]).status_code, 400)
        for row_id in [True, False, 1.0, 1.1, '1', 0, -1, None]:
            invalid = [records[0], {'row_id': row_id, 'token': records[1]['token']}]
            self.assertEqual(self.bulk_save(invalid).status_code, 422)
        self.assertEqual(self.bulk_save(records, teacher=123).status_code, 422)
        self.assertEqual(self.bulk_save(records, StudentId=2).status_code, 422)
        self.assertEqual(self.bulk_save([dict(records[0], ClassId=2)]).status_code, 422)
        self.assertEqual(self.bulk_save([{'row_id': 1, 'token': 123}]).status_code, 422)
        self.assertEqual(self.bulk_save([{'row_id': 1}]).status_code, 422)
        self.assert_bulk_unchanged(before)

    def test_bulk_second_bad_token_actor_field_row_and_expiry_cancel_all(self):
        records = self.prepare_bulk()
        before = [self.record(1), self.record(2)]
        token = records[1]['token']
        claims = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        variants = ['', token + 'tampered', records[0]['token'], self.row(2)['token']]
        for patch_claim in [{'actor': 'complete_manager'}, {'field': 'content'}, {'row_id': 999},
                            {'purpose': 'other'}, {'exp': datetime.utcnow() - timedelta(seconds=10)}]:
            variants.append(jwt.encode(dict(claims, **patch_claim), settings.SECRET_KEY, algorithm=settings.ALGORITHM))
        for invalid_token in variants:
            invalid = [records[0], {'row_id': 2, 'token': invalid_token}]
            response = self.bulk_save(invalid)
            self.assertEqual(response.status_code, 400, response.text)
            self.assertIn('전체 적용을 취소', response.json()['detail'])
            self.assert_bulk_unchanged(before)
        self.assertEqual(self.bulk_save(records, actor='complete_manager').status_code, 400)
        self.assert_bulk_unchanged(before)

    def test_bulk_second_stale_record_cancels_all(self):
        records = self.prepare_bulk()
        self.sql("UPDATE StudyLogs SET Description='다른 사용자가 수정' WHERE rowid=2")
        before = [self.record(1), self.record(2)]
        response = self.bulk_save(records)
        self.assertEqual(response.status_code, 409, response.text)
        self.assertIn('#2', response.json()['detail'])
        self.assert_bulk_unchanged(before)

    def test_bulk_second_stale_class_cancels_all(self):
        self.sql('UPDATE StudyLogs SET ClassId=2 WHERE rowid=2')
        records = self.prepare_bulk()
        self.sql("UPDATE Classes SET TeacherUsername='complete_manager' WHERE Id=2")
        before = [self.record(1), self.record(2)]
        self.assertEqual(self.bulk_save(records).status_code, 409)
        self.assert_bulk_unchanged(before)

    def test_bulk_second_deleted_record_cancels_all(self):
        records = self.prepare_bulk()
        before = self.record(1)
        self.sql('DELETE FROM StudyLogs WHERE rowid=2')
        response = self.bulk_save(records)
        self.assertEqual(response.status_code, 404, response.text)
        self.assertEqual(self.record(1), before)
        self.assertFalse(self.audits())

    def test_bulk_second_filled_field_cancels_all(self):
        records = self.prepare_bulk()
        self.sql("UPDATE StudyLogs SET ActualTeacherUsername='complete_manager' WHERE rowid=2")
        before = [self.record(1), self.record(2)]
        self.assertEqual(self.bulk_save(records).status_code, 409)
        self.assert_bulk_unchanged(before)

    def test_bulk_second_payroll_line_cancels_all(self):
        records = self.prepare_bulk()
        before = [self.record(1), self.record(2)]
        self.sql("INSERT INTO TeacherPayrollLines(PayrollMonth,StudyLogId,TeacherUsername,UnitAmount,Amount) VALUES ('2026-09',2,'complete_a',100,100)")
        response = self.bulk_save(records)
        self.assertEqual(response.status_code, 409, response.text)
        self.assertIn('#2', response.json()['detail'])
        self.assert_bulk_unchanged(before)

    def test_bulk_second_target_month_closure_cancels_all(self):
        self.sql("UPDATE StudyLogs SET StudiedDay='2026-10-01' WHERE rowid=2")
        records = self.prepare_bulk()
        before = [self.record(1), self.record(2)]
        self.sql("INSERT INTO TeacherPayrollClosures(PayrollMonth,TeacherUsername,ClosedBy) VALUES ('2026-10','complete_b','검증')")
        response = self.bulk_save(records)
        self.assertEqual(response.status_code, 409, response.text)
        self.assertIn('#2', response.json()['detail'])
        self.assert_bulk_unchanged(before)

    def test_bulk_second_class_month_closure_cancels_all(self):
        self.sql("UPDATE StudyLogs SET ClassId=2,StudiedDay='2026-10-01' WHERE rowid=2")
        records = self.prepare_bulk()
        before = [self.record(1), self.record(2)]
        self.sql("INSERT INTO TeacherPayrollClosures(PayrollMonth,TeacherUsername,ClosedBy) VALUES ('2026-10','complete_b','검증')")
        self.assertEqual(self.bulk_save(records, teacher='complete_subadmin').status_code, 409)
        self.assert_bulk_unchanged(before)

    def test_bulk_second_audit_failure_rolls_back_both_updates_and_first_audit(self):
        records = self.prepare_bulk()
        before = [self.record(1), self.record(2)]
        original = studylog_completion.write_audit_log
        calls = []
        def fail_second(*args, **kwargs):
            calls.append(args[1])
            if len(calls) == 2:
                raise RuntimeError('검증용 감사 실패')
            return original(*args, **kwargs)
        with patch.object(studylog_completion, 'write_audit_log', side_effect=fail_second):
            response = self.bulk_save(records)
        self.assertEqual(response.status_code, 500, response.text)
        self.assertEqual(calls, [1, 2])
        self.assert_bulk_unchanged(before)

    def test_bulk_alias_collision_is_revalidated(self):
        records = self.prepare_bulk()
        self.sql("INSERT INTO Students(rowid,Id,Name,Grade) VALUES (201,901,'충돌학생','초1')")
        before = [self.record(1), self.record(2)]
        self.assertEqual(self.bulk_save(records).status_code, 409)
        self.assert_bulk_unchanged(before)

    def test_bulk_accepts_fifty_distinct_rows_and_unicode_blank_fields(self):
        self.prepare_bulk()
        for index in range(48):
            self.sql('''INSERT INTO StudyLogs(Id,StudentId,BookId,StudiedDay,ActualTeacherUsername,LessonContent)
                VALUES (?,201,101,'2026-09-18',?,'유지')''', (600 + index, database._STUDENT_RECORD_WHITESPACE))
        result = self.preview(field='teacher', limit=50)
        records = [{'row_id': row['row_id'], 'token': row['token']} for row in result['rows']]
        self.assertEqual(len(records), 50)
        response = self.bulk_save(records, teacher='  complete_b  ')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['updated_count'], 50)
        self.assertEqual(len(self.audits()), 50)
        self.assertEqual(self.preview(field='teacher')['total_count'], 0)


if __name__ == '__main__':
    unittest.main()
