"""상담 정산은 임시 데이터베이스와 독립 라우터에서 검증한다."""
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

import database
import consultation_payroll as cp
from auth import create_access_token
from config import settings


class ConsultationPayrollTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        old_path = settings.SQLITE_DB_PATH
        self.addCleanup(setattr, settings, 'SQLITE_DB_PATH', old_path)
        settings.SQLITE_DB_PATH = str(Path(self.temp.name) / 'consultation.db')
        with closing(sqlite3.connect(settings.SQLITE_DB_PATH)) as conn:
            conn.executescript('''
                CREATE TABLE Books(Id INTEGER UNIQUE, Title TEXT, Author TEXT, Publisher TEXT);
                CREATE TABLE Students(Id INTEGER UNIQUE, Name TEXT, Grade TEXT);
                CREATE TABLE StudyLogs(Id INTEGER UNIQUE, StudentId INTEGER, BookId INTEGER, StudiedDay TEXT);
                INSERT INTO Students VALUES(201,'상담 학생','초3');
                CREATE TABLE StudentConsultations(Id INTEGER PRIMARY KEY, StudentId INTEGER NOT NULL,
                    Content TEXT DEFAULT '', CreatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
                    CreatedBy TEXT DEFAULT '', UpdatedBy TEXT DEFAULT '', UpdatedAt TEXT DEFAULT '');
                INSERT INTO StudentConsultations(StudentId,Content) VALUES(1,'기존 상담');
            ''')
        database.init_system_tables()
        with closing(database.get_db_connection()) as conn:
            cp.install_consultation_payroll(conn)
            conn.commit()
        for name, role in [('t1','teacher'),('t2','teacher'),('mgr','manager'),('sub','subadmin')]:
            database.create_user(name, '검증암호', role, name)
        app = FastAPI()
        app.include_router(cp.router)
        self.client = TestClient(app, raise_server_exceptions=False)
        self.addCleanup(self.client.close)

    def sql(self, query, args=()):
        with closing(database.get_db_connection()) as conn:
            result = [dict(r) for r in conn.execute(query, args).fetchall()]
            conn.commit()
            return result

    def request(self, method, url, data=None, actor='mgr'):
        headers = {'Authorization': 'Bearer ' + create_access_token({'sub': actor})} if actor else {}
        return self.client.request(method, '/api/user/' + url, json=data, headers=headers)

    def payload(self, **changes):
        return dict(Content='상담 내용', ConsultationDate='2026-09-15', DurationMinutes=30,
                    TeacherUsername='t1', **{}) | changes

    def create(self, **changes):
        response = self.request('POST','students/201/consultations',self.payload(**changes))
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()['id']

    def rate(self, amount=12000, effective='2026-09-01'):
        response = self.request('POST','consultation-pay-rates',{'EffectiveFrom':effective,'UnitAmount':amount})
        self.assertEqual(response.status_code,200,response.text)
        return response

    def rows(self, month='2026-09', teacher=None):
        with closing(database.get_db_connection()) as conn:
            return cp.payroll_consultation_rows(conn, month, teacher)

    def exclude(self, key, value=True, **changes):
        payload = dict(Excluded=value, Reason='중복 상담', PayrollMonth='2026-09',TeacherUsername='t1')
        payload.update(changes)
        return self.request('POST',f'payroll/consultations/{key}/exclusion',payload)

    def close(self, teacher='t1', month='2026-09', freeze=True):
        with closing(database.get_db_connection()) as conn:
            conn.execute('BEGIN IMMEDIATE')
            if freeze:
                cp.freeze_payroll_consultations(conn,month,teacher)
            conn.execute('INSERT INTO TeacherPayrollClosures(PayrollMonth,TeacherUsername,ClosedBy) VALUES(?,?,?)',(month,teacher,'mgr'))
            conn.commit()

    def test_excluded_consultation_keeps_status_after_date_and_teacher_correction(self):
        self.rate()
        key = self.create()
        self.assertEqual(self.exclude(key).status_code, 200)
        response = self.request('PUT', f'consultations/{key}', self.payload(
            ConsultationDate='2026-10-02', TeacherUsername='t2'))
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.rows(), [])
        row = self.rows('2026-10', 't2')[0]
        self.assertTrue(row['IsExcluded'])
        self.assertEqual(row['Amount'], 0)
        self.assertEqual(self.exclude(key, False).status_code, 409)
        response = self.exclude(key, False, PayrollMonth='2026-10', TeacherUsername='t2')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.rows('2026-10', 't2')[0]['Amount'], 12000)

    def test_schema_idempotence_legacy_explicit_completion(self):
        with closing(database.get_db_connection()) as conn:
            cp.install_consultation_payroll(conn)
            cp.install_consultation_payroll(conn)
            conn.commit()
        legacy = self.sql('SELECT * FROM StudentConsultations WHERE rowid=1')[0]
        self.assertEqual(legacy['ConsultationDate'],'')
        self.assertEqual(legacy['TeacherUsername'],'')
        self.assertIsNone(legacy['DurationMinutes'])
        self.rate()
        self.assertEqual(self.rows(),[])
        self.assertEqual(self.request('PUT','consultations/1',self.payload()).status_code,200)
        self.assertEqual(self.rows()[0]['Amount'],12000)

    def test_roles_read_scope_and_all_teacher_roles(self):
        key = self.create()
        for actor in ('t1','t2','mgr','sub',settings.ADMIN_USERNAME):
            self.assertEqual(self.request('GET','consultation-pay-rates',actor=actor).status_code,200)
            self.assertEqual(self.request('GET','students/201/consultations',actor=actor).status_code,200)
        self.assertEqual(self.request('GET','consultation-pay-rates',actor=None).status_code,401)
        self.assertEqual(self.request('GET',f'consultations/{key}',actor='t1').status_code,200)
        self.assertEqual(self.request('GET',f'consultations/{key}',actor='t2').status_code,403)
        for method,url,data in [('POST','students/201/consultations',self.payload()),
                                ('PUT',f'consultations/{key}',self.payload()),
                                ('DELETE',f'consultations/{key}',None),
                                ('POST','consultation-pay-rates',{'EffectiveFrom':'2026-09-01','UnitAmount':1}),
                                ('POST',f'payroll/consultations/{key}/exclusion',{'Excluded':True,'PayrollMonth':'2026-09','TeacherUsername':'t1'})]:
            self.assertEqual(self.request(method,url,data,actor='t1').status_code,403)
        for actor in ('mgr','sub',settings.ADMIN_USERNAME):
            self.assertEqual(self.request('POST','students/201/consultations',self.payload(TeacherUsername=actor),actor=actor).status_code,200)
        self.assertEqual(self.request('POST','students/201/consultations',self.payload(TeacherUsername='없음')).status_code,400)

    def test_strict_dates_duration_amount_and_exclusion(self):
        for value in ('2026-02-30','2026-9-01','20260901','2026-09-01T00:00:00'):
            self.assertEqual(self.request('POST','students/201/consultations',self.payload(ConsultationDate=value)).status_code,422)
            self.assertEqual(self.request('POST','consultation-pay-rates',{'EffectiveFrom':value,'UnitAmount':1}).status_code,422)
        for duration in (0,1441,True,30.5,'30',None):
            self.assertEqual(self.request('POST','students/201/consultations',self.payload(DurationMinutes=duration)).status_code,422)
        for amount in (-1,True,12.5,'100',None):
            self.assertEqual(self.request('POST','consultation-pay-rates',{'EffectiveFrom':'2026-09-01','UnitAmount':amount}).status_code,422)
        for field in ('Content','ConsultationDate','DurationMinutes','TeacherUsername'):
            body = self.payload(); del body[field]
            self.assertEqual(self.request('POST','students/201/consultations',body).status_code,422)
        key = self.create(DurationMinutes=1440)
        self.assertEqual(self.exclude(key,1).status_code,422)
        self.assertEqual(self.exclude(key,True,PayrollMonth='2026-13').status_code,400)
        self.assertEqual(self.exclude(key,True,TeacherUsername='t2').status_code,409)

    def test_effective_rate_freeze_zero_and_recalculation(self):
        before = self.create(ConsultationDate='2026-08-31')
        key = self.create()
        self.assertEqual(self.rows()[0]['Amount'],0)
        self.assertFalse(self.rows()[0]['IsRateConfigured'])
        self.rate(0)
        self.assertEqual(self.rows()[0]['Amount'],0)
        self.assertTrue(self.rows()[0]['IsRateConfigured'])
        self.rate(10000)
        self.assertEqual(self.rows()[0]['Amount'],0)
        new = self.create()
        self.assertEqual(self.rows()[-1]['Amount'],10000)
        self.rate(20000,'2026-09-20')
        self.assertEqual(self.request('PUT',f'consultations/{new}',self.payload(Content='수정',DurationMinutes=60,TeacherUsername='t2')).status_code,200)
        self.assertEqual(self.rows(teacher='t2')[0]['Amount'],10000)
        self.assertEqual(self.request('PUT',f'consultations/{new}',self.payload(ConsultationDate='2026-09-21')).status_code,200)
        self.assertEqual(next(r for r in self.rows() if r['ConsultationId']==new)['Amount'],20000)
        self.assertIsNone(self.sql('SELECT PayUnitAmount FROM StudentConsultations WHERE rowid=?',(before,))[0]['PayUnitAmount'])

    def test_exclusion_restoration_totals_ignore_lesson_account_flag(self):
        self.rate()
        first, second = self.create(), self.create()
        self.sql('UPDATE _app_users SET excluded_from_payroll=1 WHERE username=?',('t1',))
        self.assertEqual(sum(r['Amount'] for r in self.rows()),24000)
        self.assertEqual(self.exclude(first).status_code,200)
        self.assertEqual(sum(r['Amount'] for r in self.rows()),12000)
        excluded = next(r for r in self.rows() if r['ConsultationId']==first)
        self.assertTrue(excluded['IsExcluded']); self.assertEqual(excluded['ExclusionReason'],'중복 상담')
        self.assertEqual(self.request('PUT',f'consultations/{first}',self.payload(ConsultationDate='2026-09-16')).status_code,200)
        self.assertTrue(next(r for r in self.rows() if r['ConsultationId']==first)['IsExcluded'])
        self.assertEqual(self.exclude(first,False).status_code,200)
        self.assertEqual(sum(r['Amount'] for r in self.rows()),24000)
        self.assertEqual(self.request('DELETE',f'consultations/{second}').status_code,200)
        self.assertEqual(len(self.rows()),1)

    def test_missing_rate_blocks_freeze_excluded_missing_allowed(self):
        key = self.create()
        with self.assertRaises(HTTPException) as error:
            self.close()
        self.assertEqual(error.exception.status_code,400)
        self.assertEqual(self.sql('SELECT * FROM TeacherPayrollConsultationLines'),[])
        self.exclude(key)
        self.close()
        self.assertTrue(self.rows()[0]['IsPayrollClosed'])
        self.assertEqual(self.rows()[0]['Amount'],0)
        self.rate()
        self.assertIsNone(self.rows()[0]['UnitAmount'])
        self.assertIsNone(self.sql('SELECT PayUnitAmount FROM StudentConsultations WHERE rowid=?',(key,))[0]['PayUnitAmount'])

    def test_closed_all_mutations_original_target_and_frozen_snapshot(self):
        self.rate()
        key, excluded = self.create(), self.create()
        self.exclude(excluded)
        self.close()
        snapshot = self.rows()
        for record in (key,excluded):
            self.assertEqual(self.request('PUT',f'consultations/{record}',self.payload(ConsultationDate='2026-10-01',TeacherUsername='t2')).status_code,400)
            self.assertEqual(self.request('DELETE',f'consultations/{record}').status_code,400)
            self.assertEqual(self.exclude(record,False).status_code,400)
        self.assertEqual(self.request('POST','students/201/consultations',self.payload()).status_code,400)
        target = self.create(TeacherUsername='t2')
        self.assertEqual(self.request('PUT',f'consultations/{target}',self.payload()).status_code,400)
        self.rate(99999)
        self.sql('UPDATE Students SET Name=?',('변경 학생',))
        self.sql('UPDATE StudentConsultations SET Content=?,DurationMinutes=60,PayUnitAmount=9 WHERE rowid=?',('직접 변경',key))
        self.assertEqual(self.rows(teacher='t1'),snapshot)
        listed = self.request('GET','students/201/consultations').json()['consultations']
        self.assertFalse(next(r for r in listed if r['row_id']==key)['CanEdit'])
        self.sql('DELETE FROM TeacherPayrollClosures')
        self.assertEqual(self.request('DELETE',f'consultations/{key}').status_code,400)

    def test_legacy_empty_closure_never_falls_back(self):
        key = self.create()
        self.close(freeze=False)
        self.assertEqual(self.rows(),[])
        self.rate()
        self.assertIsNone(self.sql('SELECT PayUnitAmount FROM StudentConsultations WHERE rowid=?',(key,))[0]['PayUnitAmount'])
        self.assertEqual(self.request('DELETE',f'consultations/{key}').status_code,400)

    def test_ambiguous_student_exact_record_id_and_sql_content(self):
        self.sql('INSERT INTO Students(rowid,Id,Name,Grade) VALUES(201,999,?,?)',('겹침','초3'))
        self.assertEqual(self.request('POST','students/201/consultations',self.payload()).status_code,409)
        self.assertEqual(self.request('GET','students/201/consultations').status_code,409)
        self.assertEqual(self.request('GET','students/888/consultations').status_code,404)
        self.assertEqual(self.request('DELETE','consultations/888').status_code,404)
        response = self.request('POST','students/1/consultations',self.payload(Content="'); DROP TABLE Students;--"))
        self.assertEqual(response.status_code,200)
        self.assertEqual(len(self.sql('SELECT * FROM Students')),2)

    def test_main_payroll_totals_exclusion_restore_and_close(self):
        import main
        main.init_activity_tables()
        integrated = TestClient(main.app, raise_server_exceptions=False)
        self.addCleanup(integrated.close)
        self.client = integrated
        first, second = self.create(), self.create()
        endpoint = 'payroll?month=2026-09&teacher_username=t1'
        initial = self.request('GET',endpoint)
        self.assertEqual(initial.status_code,200,initial.text)
        self.assertEqual(initial.json()['totals']['t1'],0)
        failed = self.request('POST','payroll/2026-09/close?teacher_username=t1')
        self.assertEqual(failed.status_code,400,failed.text)
        self.assertEqual(self.sql('SELECT * FROM TeacherPayrollClosures'),[])
        self.rate()
        self.assertEqual(self.request('GET',endpoint).json()['totals']['t1'],24000)
        self.exclude(first)
        report = self.request('GET',endpoint).json()
        self.assertEqual(report['totals']['t1'],12000)
        self.assertEqual(len(report['consultation_lines']),1)
        self.assertEqual(len(report['excluded_consultations']),1)
        self.exclude(first,False)
        self.assertEqual(self.request('GET',endpoint).json()['totals']['t1'],24000)
        self.exclude(second)
        closed = self.request('POST','payroll/2026-09/close?teacher_username=t1')
        self.assertEqual(closed.status_code,200,closed.text)
        report = self.request('GET',endpoint).json()
        self.assertTrue(report['closed'])
        self.assertEqual(report['totals']['t1'],12000)
        self.assertTrue(report['consultation_lines'][0]['IsPayrollClosed'])
        self.assertTrue(report['excluded_consultations'][0]['IsPayrollClosed'])
        self.assertEqual(self.request('DELETE',f'consultations/{first}').status_code,400)
        self.assertEqual(self.exclude(second,False).status_code,400)
        self.assertEqual(self.request('GET',endpoint,actor='t2').json()['consultation_lines'],[])

    def test_audit_rollback_every_mutation_and_rate_backfill(self):
        key = self.create()
        initial = self.sql('SELECT * FROM StudentConsultations')
        audit_count = len(self.sql('SELECT * FROM _app_audit_logs'))
        with patch.object(database,'write_audit_log',side_effect=RuntimeError('감사 실패')):
            self.assertEqual(self.request('POST','students/201/consultations',self.payload()).status_code,500)
            self.assertEqual(self.request('PUT',f'consultations/{key}',self.payload(Content='변경')).status_code,500)
            self.assertEqual(self.request('DELETE',f'consultations/{key}').status_code,500)
            self.assertEqual(self.exclude(key).status_code,500)
            self.assertEqual(self.request('POST','consultation-pay-rates',{'EffectiveFrom':'2026-09-01','UnitAmount':1}).status_code,500)
        original_audit = database.write_audit_log
        def fail_backfill(*args, **kwargs):
            if args[0]=='StudentConsultations':
                raise RuntimeError('보완 감사 실패')
            return original_audit(*args, **kwargs)
        with patch.object(database,'write_audit_log',side_effect=fail_backfill):
            self.assertEqual(self.request('POST','consultation-pay-rates',{'EffectiveFrom':'2026-09-01','UnitAmount':1}).status_code,500)
        self.assertEqual(self.sql('SELECT * FROM StudentConsultations'),initial)
        self.assertEqual(self.sql('SELECT * FROM ConsultationPayRates'),[])
        self.assertEqual(len(self.sql('SELECT * FROM _app_audit_logs')),audit_count)


if __name__ == '__main__':
    unittest.main()
