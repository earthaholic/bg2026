"""복수 도서의 차시 기준·정산 마감·제외·월말 보고의 일관성을 검증한다."""
import unittest
import main
from lesson_sessions import lesson_session_key
import test_payroll_exclusions as exclusion_fixture


class LessonSessionTests(unittest.TestCase):
    def setUp(self):
        self.fixture = exclusion_fixture.PayrollExclusionTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.tearDown)
        self.sql = self.fixture.sql
        self.sql("INSERT INTO Books(Id, Title) VALUES (2, '두 번째 도서')")
        self.sql("UPDATE StudyLogs SET LessonContent='토론', Description='메모'")
        self.sql("""INSERT INTO StudyLogs(Id, StudentId, BookId, StudiedDay, ClassId, ActualTeacherUsername, IsSpecial, LessonContent)
                    VALUES (6, 1, 2, '2026-09-01', 1, 'teacher_a', 0, ' 토론 ')""")

    def close(self):
        return self.fixture.client.post('/api/user/payroll/2026-09/close?teacher_username=teacher_a',
                                        headers=self.fixture.headers())

    def test_multi_book_payroll_counts_one_session_and_keeps_all_original_ids(self):
        before = self.sql('SELECT * FROM StudyLogs')
        data = self.fixture.payroll()
        self.assertEqual(data['totals'], {'teacher_a': 35000})
        self.assertEqual(len(data['lines']), 4)
        session = next(r for r in data['lines'] if r['StudyLogId'] == 1)
        self.assertEqual(session['StudyLogIds'], [1, 6])
        self.assertEqual(session['Amount'], 10000)
        self.assertEqual(self.sql('SELECT * FROM StudyLogs'), before)

    def test_changed_content_teacher_class_or_special_is_separate_session(self):
        for column, value in [('LessonContent', '독서'), ('ActualTeacherUsername', 'teacher_b'),
                              ('ClassId', 2), ('IsSpecial', 1)]:
            if column == 'ClassId':
                self.sql("INSERT INTO Classes(Id,ClassName,TeacherUsername,CategoryId,DayOfWeek) VALUES(2,'다른 반','teacher_a',1,'수')")
            self.sql(f'UPDATE StudyLogs SET "{column}"=? WHERE Id=6', (value,))
            row1 = self.sql('SELECT * FROM StudyLogs WHERE Id=1')[0]
            row6 = self.sql('SELECT * FROM StudyLogs WHERE Id=6')[0]
            self.assertNotEqual(lesson_session_key(row1), lesson_session_key(row6))
            self.sql("UPDATE StudyLogs SET LessonContent='토론', ActualTeacherUsername='teacher_a', ClassId=1, IsSpecial=0 WHERE Id=6")

    def test_new_closed_session_freezes_group_and_locks_every_book(self):
        self.assertEqual(self.close().status_code, 200)
        frozen = self.sql('SELECT * FROM TeacherPayrollLines ORDER BY StudyLogId')
        self.assertEqual({r['StudyLogId'] for r in frozen}, {1, 2, 3, 4, 6})
        self.assertEqual(sum(r['Amount'] for r in frozen), 35000)
        self.assertEqual(frozen[0]['SessionKey'], frozen[-1]['SessionKey'])
        self.assertEqual(frozen[-1]['Amount'], 0)
        self.sql("UPDATE StudyLogs SET LessonContent='마감 후 변경' WHERE Id=6")
        data = self.fixture.payroll()
        self.assertEqual(data['totals'], {'teacher_a': 35000})
        self.assertEqual(len(data['lines']), 4)
        self.assertEqual(self.fixture.change(LogIds=[6]).status_code, 409)
        all_teachers = self.fixture.payroll(teacher='')
        self.assertEqual(all_teachers['totals']['teacher_a'], 35000)
        self.assertEqual(all_teachers['totals']['teacher_b'], 10000)

    def test_partial_exclusion_keeps_session_until_all_books_excluded(self):
        self.assertEqual(self.fixture.change(LogIds=[1]).status_code, 200)
        self.assertEqual(self.fixture.payroll()['totals']['teacher_a'], 35000)
        self.assertEqual(self.fixture.change(LogIds=[6]).status_code, 200)
        self.assertEqual(self.fixture.payroll()['totals']['teacher_a'], 25000)
        self.assertEqual(self.fixture.change(False, LogIds=[1, 6]).status_code, 200)
        self.assertEqual(self.fixture.payroll()['totals']['teacher_a'], 35000)

    def test_monthly_report_groups_books_and_preserves_different_content_teacher_and_class(self):
        response = self.fixture.client.get('/api/user/monthly-report/studylogs?student_id=1&date_from=2026-09-01&date_to=2026-09-30', headers=self.fixture.headers())
        self.assertEqual(response.status_code, 200)
        logs = response.json()['logs']
        text = main.build_monthly_report_text('김학생', '', '9월', 1, '', logs)
        self.assertEqual(text.count('<1강>'), 1)
        # 날짜 9/1은 진행 교사 두 명의 일반 수업과 특강, 9/8은 별도 일반 수업이다.
        self.assertEqual(text.count('강>'), 4)
        self.assertIn('두 번째 도서', text)
        self.assertNotIn('<4강>', text)
        for field, value in [('LessonContent', '다른 내용'), ('EffectiveTeacherUsername', 'teacher_b'), ('ClassId', 2), ('IsSpecial', 1)]:
            base = {'StudentId': 1, 'StudiedDay': '2026-09-01', 'ClassId': 1, 'EffectiveTeacherUsername': 'teacher_a', 'IsSpecial': 0, 'LessonContent': '토론', 'BookTitle': '첫 도서'}
            other = dict(base, BookTitle='두 번째 도서')
            other[field] = value
            changed = main.build_monthly_report_text('김학생', '', '', 1, '', [base, other])
            self.assertEqual(changed.count('도서 :'), 2, field)

    def test_start_lecture_uses_same_session_key_as_report(self):
        self.sql("INSERT INTO TuitionPayments(StudentId, ClassType, PaidLessons, ServiceLessons, StartDate, PaidDate, FeeAmount) VALUES (1, '일반', 10, 0, '2026-09-01', '2026-09-01', 100000)")
        response = self.fixture.client.get('/api/user/monthly-report/start-lecture?student_id=1&first_studied_day=2026-09-08', headers=self.fixture.headers())
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['used_before'], 2)
        self.assertEqual(response.json()['start_lecture_num'], 3)

    def test_empty_content_books_are_one_session(self):
        self.sql("UPDATE StudyLogs SET LessonContent='' WHERE Id=1")
        self.sql("UPDATE StudyLogs SET LessonContent='  ' WHERE Id=6")
        data = self.fixture.payroll()
        self.assertEqual(data['totals']['teacher_a'], 35000)

    def test_existing_closure_keeps_historical_amounts_and_session_count(self):
        self.sql("""INSERT INTO TeacherPayrollLines(PayrollMonth, StudyLogId, TeacherUsername, UnitAmount, Amount, Reason)
            SELECT '2026-09', rowid, 'teacher_a', CASE WHEN IsSpecial=1 THEN 5000 ELSE 10000 END,
                   CASE WHEN IsSpecial=1 THEN 5000 ELSE 10000 END,
                   CASE WHEN IsSpecial=1 THEN '특강 학생수당' ELSE '초등 일반 수업' END
            FROM StudyLogs WHERE ActualTeacherUsername='teacher_a'""")
        self.sql("INSERT INTO TeacherPayrollClosures(PayrollMonth, TeacherUsername, ClosedBy) VALUES('2026-09', 'teacher_a', 'manager_a')")
        self.assertEqual(self.fixture.payroll()['totals']['teacher_a'], 45000)
        self.assertEqual(len(self.fixture.payroll()['lines']), 5)
        self.assertEqual(self.fixture.payroll(teacher='')['totals']['teacher_a'], 45000)
