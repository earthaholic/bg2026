"""정산 종합 조회는 월급 정산과 같은 기준으로 선생님별 월 정산액을 집계한다."""
import unittest
from contextlib import closing

import database
import main
import test_payroll_exclusions as fixtures
from config import settings
from consultation_payroll import install_consultation_payroll


class PayrollSummaryTests(unittest.TestCase):
    tearDown = fixtures.PayrollExclusionTests.tearDown
    sql = fixtures.PayrollExclusionTests.sql
    headers = fixtures.PayrollExclusionTests.headers

    def setUp(self):
        fixtures.PayrollExclusionTests.setUp(self)
        # 상담 정산 컬럼·확정 테이블은 실제 서버 시작 시점과 같게 준비한다.
        with closing(database.get_db_connection()) as conn:
            install_consultation_payroll(conn)
            conn.commit()

    def summary(self, year='2026', actor='manager_a'):
        query = f'?year={year}' if year is not None else ''
        return self.client.get('/api/user/payroll/summary' + query, headers=self.headers(actor))

    def data(self, **kwargs):
        response = self.summary(**kwargs)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def teacher_row(self, data, username):
        return next(row for row in data['teachers'] if row['username'] == username)

    def month_cell(self, data, username, month):
        row = self.teacher_row(data, username)
        return next(cell for cell in row['cells'] if cell['month'] == month)

    def add_consultation(self, amount=20000, teacher='teacher_a', day='2026-09-20', excluded=0):
        self.sql('''INSERT INTO StudentConsultations
                    (StudentId, Content, ConsultationDate, DurationMinutes, TeacherUsername, PayUnitAmount,
                     PayEffectiveFrom, ExcludedFromPayroll)
                    VALUES (1, '상담 내용', ?, 30, ?, ?, '2026-09-01', ?)''', (day, teacher, amount, excluded))

    def test_manager_sees_monthly_totals_per_teacher(self):
        data = self.data()
        self.assertEqual(data['year'], 2026)
        self.assertEqual(len(data['months']), 12)
        self.assertEqual(data['months'][0], '2026-01')
        self.assertEqual(sorted(row['username'] for row in data['teachers']), ['teacher_a', 'teacher_b'])
        cell = self.month_cell(data, 'teacher_a', '2026-09')
        self.assertEqual(cell['lessons'], 35000)
        self.assertEqual(cell['lesson_sessions'], 4)
        self.assertEqual(cell['total'], 35000)
        self.assertFalse(cell['closed'])
        self.assertTrue(cell['has_activity'])
        self.assertFalse(self.month_cell(data, 'teacher_a', '2026-08')['has_activity'])
        self.assertEqual(self.teacher_row(data, 'teacher_b')['total'], 10000)
        self.assertEqual(data['grand_total'], 45000)
        self.assertEqual(data['month_totals'][8]['total'], 45000)
        self.assertEqual(data['month_totals'][7]['total'], 0)
        self.assertEqual(data['open_count'], 2)
        self.assertEqual(data['closed_count'], 0)

    def test_month_total_matches_payroll_screen(self):
        payroll = self.client.get('/api/user/payroll?month=2026-09', headers=self.headers()).json()
        self.assertEqual(sum(payroll['totals'].values()), self.data()['month_totals'][8]['total'])

    def test_role_guard(self):
        self.assertEqual(self.summary(actor='teacher_a').status_code, 403)
        self.assertEqual(self.summary(actor=settings.ADMIN_USERNAME).status_code, 200)

    def test_consultations_claims_and_materials_are_added(self):
        self.add_consultation()
        self.sql('''INSERT INTO TeacherPayrollClaims(PayrollMonth, TeacherUsername, ClaimDate, ItemName, Amount)
                    VALUES ('2026-09', 'teacher_a', '2026-09-25', '교재비', 5000)''')
        self.sql('''INSERT INTO BookMaterialRequests
                    (RequestType, BookId, BookData, BookCategory, MaterialFields, RequestedBy, Status,
                     ApprovedAmount, PayrollMonth)
                    VALUES ('material_add', 1, '{}', 'general', '[]', 'teacher_a', 'approved', 7000, '2026-09')''')
        cell = self.month_cell(self.data(), 'teacher_a', '2026-09')
        self.assertEqual((cell['lessons'], cell['consultations'], cell['claims'], cell['materials']),
                         (35000, 20000, 5000, 7000))
        self.assertEqual((cell['consultation_count'], cell['claim_count'], cell['material_count']), (1, 1, 1))
        self.assertEqual(cell['total'], 67000)

    def test_excluded_consultation_is_not_counted(self):
        self.add_consultation(excluded=1)
        cell = self.month_cell(self.data(), 'teacher_a', '2026-09')
        self.assertEqual((cell['consultations'], cell['consultation_count'], cell['total']), (0, 0, 35000))

    def test_closed_month_keeps_frozen_amounts(self):
        response = self.client.post('/api/user/payroll/2026-09/close?teacher_username=teacher_a',
                                    headers=self.headers())
        self.assertEqual(response.status_code, 200, response.text)
        self.sql('''INSERT INTO StudyLogs(Id, StudentId, BookId, StudiedDay, ClassId, ActualTeacherUsername, IsSpecial)
                    VALUES (6, 1, 1, '2026-09-15', 1, 'teacher_a', 0)''')
        data = self.data()
        cell = self.month_cell(data, 'teacher_a', '2026-09')
        self.assertTrue(cell['closed'])
        self.assertEqual(cell['lessons'], 35000)
        self.assertEqual(self.teacher_row(data, 'teacher_a')['closed_count'], 1)
        self.assertEqual(data['closed_count'], 1)

    def test_unconfigured_lessons_are_reported_separately(self):
        self.sql("INSERT INTO Students(Id, Name, Grade) VALUES (3, '학년 미설정 학생', '중1')")
        self.sql('''INSERT INTO StudyLogs(Id, StudentId, BookId, StudiedDay, ClassId, ActualTeacherUsername, IsSpecial)
                    VALUES (6, 3, 1, '2026-09-15', 1, 'teacher_a', 0)''')
        data = self.data()
        cell = self.month_cell(data, 'teacher_a', '2026-09')
        self.assertEqual(cell['unconfigured'], 1)
        self.assertEqual(cell['lessons'], 35000)
        self.assertEqual(data['unconfigured_count'], 1)

    def test_default_year_and_year_list(self):
        data = self.data(year=None)
        self.assertEqual(data['year'], int(main.kst_today()[:4]))
        self.assertIn(2026, data['years'])
        self.assertIn(data['year'], data['years'])

    def test_invalid_year_is_rejected(self):
        for year in ['2026-9', '1800', 'abc', '99999']:
            response = self.summary(year=year)
            self.assertEqual(response.status_code, 400, year)


if __name__ == '__main__':
    unittest.main()
