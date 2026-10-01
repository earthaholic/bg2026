"""계정별 수업 정산 제외를 임시 DB에서 검증한다."""
import unittest
from unittest.mock import patch

import main
import test_payroll_exclusions as fixtures
from config import settings


class TeacherPayrollExclusionTests(unittest.TestCase):
    setUp = fixtures.PayrollExclusionTests.setUp
    tearDown = fixtures.PayrollExclusionTests.tearDown
    sql = fixtures.PayrollExclusionTests.sql
    headers = fixtures.PayrollExclusionTests.headers
    change = fixtures.PayrollExclusionTests.change
    payroll = fixtures.PayrollExclusionTests.payroll

    def toggle(self, excluded, actor=None, teacher='teacher_a'):
        user_id = self.sql('SELECT id FROM _app_users WHERE username=?', (teacher,))[0]['id']
        return self.client.put(f'/api/admin/users/{user_id}/payroll-exclusion',
                               headers=self.headers(actor or settings.ADMIN_USERNAME),
                               json={'excluded_from_payroll': excluded})

    def test_account_exclusion_preserves_logs_and_individual_exclusions(self):
        before = self.sql('SELECT * FROM StudyLogs')
        self.assertEqual(self.change().status_code, 200)
        self.assertEqual(self.toggle(True).status_code, 200)
        data = self.payroll()
        self.assertEqual(data['lines'], [])
        self.assertEqual(len(data['excluded_lines']), 4)
        self.assertTrue(all(r['IsTeacherExcluded'] for r in data['excluded_lines']))
        self.assertEqual(self.change(False).status_code, 409)
        self.assertEqual(self.payroll(teacher='teacher_b')['totals'], {'teacher_b': 10000})
        self.assertEqual(self.toggle(False).status_code, 200)
        self.assertEqual(self.payroll()['totals'], {'teacher_a': 20000})
        self.assertEqual(self.sql('SELECT * FROM StudyLogs'), before)

    def test_teacher_fallback_and_all_months(self):
        self.sql("UPDATE StudyLogs SET ActualTeacherUsername='' WHERE Id=4")
        self.sql("INSERT INTO StudyLogs(Id,StudentId,BookId,StudiedDay,ClassId) VALUES(6,1,1,'2026-10-01',1)")
        self.assertEqual(self.toggle(True).status_code, 200)
        self.assertEqual(main._payroll_rows('2026-09', 'teacher_a'), [])
        self.assertEqual(main._payroll_rows('2026-10', 'teacher_a'), [])
        all_rows = main._payroll_rows('2026-09')
        self.assertEqual({r['TeacherUsername'] for r in all_rows}, {'teacher_b'})

    def test_closed_payroll_is_preserved(self):
        response = self.client.post('/api/user/payroll/2026-09/close?teacher_username=teacher_a', headers=self.headers())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.toggle(True).status_code, 200)
        self.assertEqual(self.payroll()['totals'], {'teacher_a': 35000})
        self.assertEqual(sum(r['Amount'] for r in main._payroll_rows('2026-09')), 45000)

    def test_excluded_unconfigured_rates_do_not_block_close(self):
        self.sql('DELETE FROM TeacherPayRates')
        self.assertEqual(self.toggle(True).status_code, 200)
        response = self.client.post('/api/user/payroll/2026-09/close?teacher_username=teacher_a', headers=self.headers())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.sql('SELECT * FROM TeacherPayrollLines'), [])

    def test_permissions_validation_and_audit_rollback(self):
        for actor in ['teacher_a', 'manager_a']:
            self.assertEqual(self.toggle(True, actor).status_code, 403)
        self.assertEqual(self.toggle('true').status_code, 422)
        with patch.object(main, 'write_audit_log', side_effect=RuntimeError('감사 실패')):
            self.assertEqual(self.toggle(True).status_code, 500)
        self.assertEqual(self.sql("SELECT excluded_from_payroll FROM _app_users WHERE username='teacher_a'")[0]['excluded_from_payroll'], 0)
        self.assertEqual(self.toggle(True).status_code, 200)
        users = self.client.get('/api/admin/users', headers=self.headers(settings.ADMIN_USERNAME)).json()['users']
        target = next(u for u in users if u['username']=='teacher_a')
        self.assertEqual(target['excluded_from_payroll'], 1)
        self.assertNotIn('password_hash', target)


if __name__ == '__main__':
    unittest.main()
