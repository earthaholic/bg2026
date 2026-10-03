"""반 종류·단가 변경 전후 정산 기준 보존 회귀 검증."""
from test_payroll_lesson_type import PayrollLessonTypeTests
from payroll_basis import install_payroll_basis
import main


class PayrollBasisTests(PayrollLessonTypeTests):
    def setUp(self):
        super().setUp()
        install_payroll_basis(self.conn)
        self.conn.commit()

    def row(self, rowid=1):
        return dict(self.conn.execute('SELECT * FROM StudyLogs WHERE rowid=?', (rowid,)).fetchone())

    def test_legacy_basis_does_not_follow_class_or_rate(self):
        self.conn.executescript("""
            INSERT INTO ClassCategories VALUES (2, '토론');
            INSERT INTO TeacherPayRates VALUES (2, '초등', '2026-01-01', 20000);
            UPDATE Classes SET CategoryId=2;
            UPDATE TeacherPayRates SET UnitAmount=90000 WHERE CategoryId=1;
        """)
        result = main._payroll_rows('2026-09', 'teacher1')[0]
        self.assertEqual(result['UnitAmount'], 10000)
        self.assertEqual(result['CategoryName'], '독서')
        self.assertEqual(result['PayrollBasisLabel'], '도입 시점 기준 보존')

    def test_new_records_take_new_category_old_records_keep_old(self):
        self.conn.executescript("""
            INSERT INTO ClassCategories VALUES (2, '토론');
            INSERT INTO TeacherPayRates VALUES (2, '초등', '2026-01-01', 20000);
            UPDATE Classes SET CategoryId=2;
            INSERT INTO StudyLogs(StudentId,ClassId,StudiedDay,IsSpecial,GradeSnapshot,ActualTeacherUsername,BookId)
                VALUES(1,1,'2026-09-17',0,'초3','teacher1',1);
        """)
        self.assertEqual(self.row(3)['PayUnitAmount'], 20000)
        self.assertEqual(self.row()['PayUnitAmount'], 10000)
        self.assertEqual(self.row(3)['PayBasisSource'], 'recorded')

    def test_missing_rate_is_not_zero_and_first_setting_is_preserved(self):
        self.conn.executescript("""
            INSERT INTO ClassCategories VALUES (2, '토론');
            UPDATE Classes SET CategoryId=2;
            INSERT INTO StudyLogs(StudentId,ClassId,StudiedDay,IsSpecial,GradeSnapshot,ActualTeacherUsername,BookId)
                VALUES(1,1,'2026-09-17',0,'초3','teacher1',1);
        """)
        self.assertIsNone(self.row(3)['PayUnitAmount'])
        self.assertFalse(main._payroll_rows('2026-09', 'teacher1')[-1]['IsRateConfigured'])
        self.conn.executescript("""
            UPDATE Classes SET CategoryId=1;
            INSERT INTO TeacherPayRates VALUES (2,'초등','2026-01-01',0);
            UPDATE TeacherPayRates SET UnitAmount=99999 WHERE CategoryId=2;
        """)
        self.assertEqual(self.row(3)['PayUnitAmount'], 0)
        self.assertEqual(self.row(3)['PayCategoryId'], 2)
        self.assertTrue(main._payroll_rows('2026-09', 'teacher1')[-1]['IsRateConfigured'])

    def test_date_correction_uses_saved_category_and_new_day_rate(self):
        self.conn.executescript("""
            INSERT INTO TeacherPayRates VALUES (1,'초등','2026-09-15',12000);
            UPDATE Classes SET CategoryId=2;
            UPDATE StudyLogs SET StudiedDay='2026-09-18' WHERE Id=1;
        """)
        self.assertEqual(self.row()['PayCategoryId'], 1)
        self.assertEqual(self.row()['PayUnitAmount'], 12000)
        self.assertEqual(self.row()['PayBasisSource'], 'corrected')

    def test_explicit_class_change_recalculates(self):
        self.conn.executescript("""
            INSERT INTO ClassCategories VALUES (2,'토론');
            INSERT INTO Classes VALUES (2,'토론반',2,'teacher1');
            INSERT INTO TeacherPayRates VALUES (2,'초등','2026-01-01',20000);
            UPDATE StudyLogs SET ClassId=2 WHERE Id=1;
        """)
        self.assertEqual(self.row()['PayCategoryName'], '토론')
        self.assertEqual(self.row()['PayUnitAmount'], 20000)

    def test_extra_book_keeps_original_session_rate(self):
        self.conn.executescript("""
            UPDATE TeacherPayRates SET UnitAmount=25000;
            INSERT INTO StudyLogs(StudentId,ClassId,StudiedDay,IsSpecial,GradeSnapshot,ActualTeacherUsername,BookId)
                VALUES(1,1,'2026-09-01',0,'초3','teacher1',2);
        """)
        self.assertEqual(self.row(3)['PayUnitAmount'], 10000)
        rows = main._payroll_rows('2026-09', 'teacher1')
        self.assertEqual(sum(r['Amount'] for r in rows), 15000)

    def test_content_teacher_and_student_changes_do_not_reset_basis(self):
        self.conn.executescript("""
            UPDATE TeacherPayRates SET UnitAmount=25000;
            UPDATE StudyLogs SET LessonContent='수업 내용 보완', ActualTeacherUsername='teacher2', StudentId=3 WHERE Id=1;
        """)
        self.assertEqual(self.row()['PayUnitAmount'], 10000)

    def test_restart_keeps_captured_values(self):
        self.conn.execute('UPDATE TeacherPayRates SET UnitAmount=25000')
        install_payroll_basis(self.conn)
        self.assertEqual(self.row()['PayUnitAmount'], 10000)

    def test_first_category_assignment_completes_only_unresolved_kind(self):
        self.conn.executescript("""
            INSERT INTO Classes VALUES (2,'새 반',NULL,'teacher1');
            INSERT INTO StudyLogs(StudentId,ClassId,StudiedDay,IsSpecial,GradeSnapshot,ActualTeacherUsername,BookId)
                VALUES(1,2,'2026-09-17',0,'초3','teacher1',1);
            UPDATE Classes SET CategoryId=1 WHERE Id=2;
        """)
        self.assertEqual(self.row(3)['PayUnitAmount'], 10000)
        self.assertEqual(self.row(3)['PayBasisSource'], 'completed')
        self.conn.execute('UPDATE Classes SET CategoryId=2 WHERE Id=2')
        self.assertEqual(self.row(3)['PayCategoryId'], 1)
