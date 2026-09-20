"""학생별 전체 학습 기록 입력 현황을 실제 DB 없이 검증한다."""
import sqlite3
import unittest
import uuid
from unittest.mock import patch

import database


class StudentRecordCoverageTests(unittest.TestCase):
    def setUp(self):
        # 연결을 닫는 조회 함수들도 같은 메모리 DB를 사용하도록 기준 연결을 유지한다.
        self.uri = 'file:record_coverage_{}?mode=memory&cache=shared'.format(uuid.uuid4().hex)
        self.conn = self.connect()
        self.addCleanup(self.conn.close)
        connection_patch = patch.object(database, 'get_db_connection', side_effect=self.connect)
        self.connection_mock = connection_patch.start()
        self.addCleanup(connection_patch.stop)
        # Id를 INTEGER PRIMARY KEY로 만들지 않아 원본 Id와 SQLite rowid를 구분한다.
        self.conn.executescript('''
            CREATE TABLE Students (
                Id INTEGER UNIQUE, Name TEXT, Sex TEXT, Grade TEXT,
                Referrer TEXT, Description TEXT, IsClassEnded INTEGER DEFAULT 0
            );
            CREATE TABLE StudyLogs (
                StudentId INTEGER, ClassId INTEGER, StudiedDay TEXT,
                ActualTeacherUsername TEXT, LessonContent TEXT, Description TEXT,
                CreatedBy TEXT
            );
            CREATE TABLE Classes (
                Id INTEGER PRIMARY KEY, ClassName TEXT, TeacherUsername TEXT,
                DayOfWeek TEXT, StartTime TEXT, CategoryId INTEGER, CreatedAt TEXT
            );
            CREATE TABLE ClassStudents (ClassId INTEGER, StudentId INTEGER, IsSpecial INTEGER);
            CREATE TABLE ClassCategories (Id INTEGER PRIMARY KEY, Name TEXT);
            CREATE TABLE _app_users (username TEXT, name TEXT);
            INSERT INTO Students(rowid, Id, Name) VALUES
                (1, 101, '가 학생'), (2, 202, '나 학생'), (3, 3, '다 학생'),
                (4, 404, '라 학생');
            INSERT INTO Classes VALUES
                (10, '정규 수업', 'assigned_teacher', '월', '15:00', 1, '2026-01-01'),
                (20, '특강 수업', 'other_teacher', '토', '10:00', 1, '2026-01-01'),
                (30, '빈 수업', 'assigned_teacher', '수', '15:00', NULL, '2026-01-01');
            INSERT INTO ClassStudents VALUES
                (10, 101, 0), (10, 2, 0), (10, 3, 0), (10, 404, 0),
                (20, 1, 1), (20, 202, 1);
            INSERT INTO ClassCategories VALUES (1, '독서');
            INSERT INTO _app_users VALUES ('assigned_teacher', '담당 선생님');
        ''')
        self.conn.commit()

    def connect(self):
        conn = sqlite3.connect(self.uri, uri=True)
        conn.row_factory = sqlite3.Row
        return conn

    def add_log(self, student_id, teacher=None, content=None, description=None,
                class_id=None, day='2026-09-20', created_by=None):
        self.conn.execute('''
            INSERT INTO StudyLogs
                (StudentId, ClassId, StudiedDay, ActualTeacherUsername,
                 LessonContent, Description, CreatedBy)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (student_id, class_id, day, teacher, content, description, created_by))
        self.conn.commit()

    def coverage(self, row_id):
        students = [{'row_id': row_id}]
        database._attach_student_record_coverage(self.conn, students)
        return students[0]['RecordCoverage']

    def assertCoverage(self, actual, total, teacher, content):
        self.assertEqual(actual, {
            'total': total, 'teacher_filled': teacher, 'content_filled': content,
        })
        for value in actual.values():
            self.assertIs(type(value), int)

    def seed_mixed_records(self):
        self.add_log(1, 'actual_teacher', '옛 수업', class_id=10, day='1999-01-01')
        self.add_log(101, None, '다른 반 내용', class_id=20, day='2025-01-01')
        self.add_log(101, 'outside_teacher', None, class_id=None, day='2035-12-31')
        self.add_log(1, ' \t\n\u3000', None, '메모만 있음', class_id=999)
        self.add_log(202, 'second_teacher', None, '별도 학생 메모', class_id=20)
        self.add_log(3, 'same_identifier_teacher', '동일 식별자 내용', class_id=10)

    def search_response(self, **overrides):
        import main
        params = dict(q=None, sex=None, include_ended=False, page=1, limit=30,
                      teacher_record_state=None, content_record_state=None,
                      current_user={'username': 'admin', 'role': 'admin'})
        params.update(overrides)
        with patch.object(main, 'get_db_connection', side_effect=self.connect), \
                patch.object(main, 'advance_student_grades'):
            return main.user_search_students(**params)

    def test_student_search_includes_same_coverage_as_class_detail(self):
        self.seed_mixed_records()
        result = self.search_response()
        self.assertEqual(result['total_count'], 4)
        detail = {row['row_id']: row['RecordCoverage'] for row in
                  database.get_class_students(10, include_record_coverage=True)}
        for student in result['students']:
            self.assertEqual(student['RecordCoverage'], detail[student['row_id']])
        self.assertCoverage(result['students'][0]['RecordCoverage'], 0, 0, 0)

    def test_student_search_keeps_filters_and_pagination(self):
        self.seed_mixed_records()
        self.conn.execute('UPDATE Students SET Sex = ? WHERE rowid = 1', ('여',))
        self.conn.execute('UPDATE Students SET IsClassEnded = 1 WHERE rowid = 2')
        self.conn.commit()
        filtered = self.search_response(q='가 학생', sex='여')
        self.assertEqual(filtered['total_count'], 1)
        self.assertCoverage(filtered['students'][0]['RecordCoverage'], 4, 2, 2)
        self.assertEqual(self.search_response()['total_count'], 3)
        paged = self.search_response(include_ended=True, page=2, limit=2)
        self.assertEqual(paged['total_count'], 4)
        self.assertEqual(paged['total_pages'], 2)
        self.assertEqual([row['row_id'] for row in paged['students']], [2, 1])
        empty = self.search_response(q='없는 학생')
        self.assertEqual(empty['students'], [])
        self.assertEqual(empty['total_pages'], 1)

    def test_student_search_keeps_teacher_scope_but_counts_all_student_history(self):
        self.seed_mixed_records()
        teacher = {'username': 'other_teacher', 'role': 'teacher'}
        result = self.search_response(current_user=teacher)
        self.assertEqual([row['row_id'] for row in result['students']], [2, 1])
        self.assertCoverage(result['students'][1]['RecordCoverage'], 4, 2, 2)
        hidden = self.search_response(q='다 학생', current_user=teacher)
        self.assertEqual(hidden['students'], [])
        self.assertEqual(hidden['total_count'], 0)

    def seed_filter_states(self):
        profiles = {10: (0, 0, 0), 11: (4, 0, 4), 12: (100, 49, 50),
                    13: (100, 50, 49), 14: (100, 99, 0), 15: (100, 100, 99),
                    16: (1, 1, 1), 17: (4, 0, 0)}
        for student_id, (total, teacher, content) in profiles.items():
            self.conn.execute('INSERT INTO Students(rowid, Id, Name, Sex) VALUES (?, ?, ?, ?)',
                              (student_id, student_id + 10000, '상태 {}'.format(student_id), '여'))
            self.conn.executemany('''INSERT INTO StudyLogs
                (StudentId, ClassId, StudiedDay, ActualTeacherUsername, LessonContent, Description)
                VALUES (?, ?, ?, ?, ?, ?)''', [
                (student_id if i % 2 else student_id + 10000,
                 999 if i % 2 else None, '2000-01-01',
                 'teacher' if i < teacher else '\t\n\u3000',
                 '수업 내용' if i < content else '\t\n\u3000', '메모만으로는 완료되지 않음')
                for i in range(total)
            ])
        self.conn.commit()

    def test_record_filters_match_all_five_lamp_states_and_boundaries(self):
        self.seed_filter_states()
        expected = {
            'teacher_record_state': {'empty': [10], 'none': [17, 11], 'low': [12],
                                     'partial': [14, 13], 'complete': [16, 15]},
            'content_record_state': {'empty': [10], 'none': [17, 14], 'low': [13],
                                     'partial': [15, 12], 'complete': [16, 11]},
        }
        for field, states in expected.items():
            for state, ids in states.items():
                with self.subTest(field=field, state=state):
                    result = self.search_response(q='상태', **{field: state})
                    self.assertEqual([row['row_id'] for row in result['students']], ids)
                    self.assertEqual(result['total_count'], len(ids))
                    self.assertEqual(result['total_pages'], 1)
        # 두 필터의 모든 조합은 교집합이며 입력 비율은 서로 독립적이다.
        for teacher_state, teacher_ids in expected['teacher_record_state'].items():
            for content_state, content_ids in expected['content_record_state'].items():
                with self.subTest(teacher=teacher_state, content=content_state):
                    result = self.search_response(q='상태', teacher_record_state=teacher_state,
                                                  content_record_state=content_state)
                    ids = sorted(set(teacher_ids) & set(content_ids), reverse=True)
                    self.assertEqual([row['row_id'] for row in result['students']], ids)
                    self.assertEqual(result['total_count'], len(ids))

    def test_record_filter_precedes_pagination_and_combines_existing_filters(self):
        self.seed_filter_states()
        first = self.search_response(q='상태', teacher_record_state='complete', limit=1)
        second = self.search_response(q='상태', teacher_record_state='complete', page=2, limit=1)
        self.assertEqual(first['total_count'], 2)
        self.assertEqual(first['total_pages'], 2)
        self.assertEqual([row['row_id'] for row in first['students']], [16])
        self.assertEqual([row['row_id'] for row in second['students']], [15])
        self.assertCoverage(second['students'][0]['RecordCoverage'], 100, 100, 99)
        self.conn.execute('UPDATE Students SET IsClassEnded = 1 WHERE rowid = 16')
        self.conn.commit()
        self.assertEqual(self.search_response(q='상태', teacher_record_state='complete')['total_count'], 1)
        self.assertEqual(self.search_response(q='상태', teacher_record_state='complete', include_ended=True)['total_count'], 2)
        self.assertEqual(self.search_response(q='상태', teacher_record_state='complete', sex='남')['total_count'], 0)
        self.assertEqual(self.search_response(q='상태 15', teacher_record_state='complete', sex='여')['total_count'], 1)

    def test_record_filter_preserves_teacher_scope(self):
        self.seed_filter_states()
        self.conn.executemany('INSERT INTO ClassStudents VALUES (20, ?, 0)', [(10012,), (16,)])
        self.conn.commit()
        teacher = {'username': 'other_teacher', 'role': 'teacher'}
        result = self.search_response(q='상태', teacher_record_state='complete', current_user=teacher)
        self.assertEqual([row['row_id'] for row in result['students']], [16])
        # 다른 수업·미연결 과거 기록도 학생의 전체 입력 비율에 포함한다.
        result = self.search_response(q='상태', teacher_record_state='low', current_user=teacher)
        self.assertEqual([row['row_id'] for row in result['students']], [12])
        self.assertCoverage(result['students'][0]['RecordCoverage'], 100, 49, 50)

    def test_record_filter_rejects_unknown_states(self):
        import main
        from fastapi.testclient import TestClient
        for args in [('invalid', None), (None, "none' OR 1=1")]:
            with self.assertRaises(ValueError):
                database.student_record_coverage_filter(*args)
        original_overrides = dict(main.app.dependency_overrides)
        main.app.dependency_overrides[main.get_current_user] = lambda: {'username': 'admin', 'role': 'admin'}
        try:
            client = TestClient(main.app)
            with patch.object(main, 'get_db_connection') as connection, patch('activity.write_activity'):
                for field in ('teacher_record_state', 'content_record_state'):
                    response = client.get('/api/user/students/search', params={field: 'invalid'})
                    self.assertEqual(response.status_code, 422)
                connection.assert_not_called()
        finally:
            main.app.dependency_overrides.clear()
            main.app.dependency_overrides.update(original_overrides)

    def test_empty_input_does_not_query_database(self):
        statements = []
        self.conn.set_trace_callback(statements.append)
        self.assertIsNone(database._attach_student_record_coverage(self.conn, []))
        self.assertEqual(statements, [])

    def test_zero_logs_have_integer_zero_counts(self):
        self.assertCoverage(self.coverage(4), 0, 0, 0)
        rows = database.get_class_students(10, include_record_coverage=True)
        empty_student = next(row for row in rows if row['row_id'] == 4)
        self.assertCoverage(empty_student['RecordCoverage'], 0, 0, 0)

    def test_all_dates_all_classes_and_unlinked_logs_are_counted(self):
        self.seed_mixed_records()
        self.assertCoverage(self.coverage(1), 4, 2, 2)

    def test_only_stored_actual_teacher_and_lesson_content_count(self):
        # 담당 선생님·등록자·메모가 있어도 해당 입력값을 대신하지 않는다.
        self.add_log(101, description='내용처럼 보이는 메모', class_id=10,
                     created_by='assigned_teacher')
        self.add_log(1, teacher='not_in_user_table', content='실제 수업 내용', class_id=10)
        self.assertCoverage(self.coverage(1), 2, 1, 1)

    def test_null_empty_and_whitespace_are_excluded_independently(self):
        whitespace_values = [None, '', ' ', '\t', '\n', '\r', '\u3000',
                             ' \t\n\r\u3000 ', '\v\f', '\u00a0', '\u2003']
        for value in whitespace_values:
            with self.subTest(value=repr(value)):
                self.conn.execute('DELETE FROM StudyLogs')
                self.add_log(1, teacher=value, content='수업 내용', description='메모')
                self.add_log(101, teacher='실제 선생님', content=value, description='메모')
                self.assertCoverage(self.coverage(1), 2, 1, 1)

    def test_nonempty_values_surrounded_by_whitespace_count(self):
        self.add_log(1, '\t\u3000teacher\n ', '\n \u3000내용\t')
        self.add_log(101, '0', '0')
        self.assertCoverage(self.coverage(1), 2, 2, 2)

    def test_rowid_and_original_id_both_match_without_double_count(self):
        self.add_log(1, 'teacher', None)
        self.add_log(101, None, '내용')
        self.add_log(3, 'teacher', '내용')
        self.assertCoverage(self.coverage(1), 2, 1, 1)
        # rowid == Id일 때 OR 조인의 양쪽 조건이 참이어도 한 기록만 집계한다.
        self.assertCoverage(self.coverage(3), 1, 1, 1)

    def test_each_student_is_separate_and_repeated_input_is_not_multiplied(self):
        self.seed_mixed_records()
        students = [{'row_id': 1, 'Name': '가 학생'}, {'row_id': 2},
                    {'row_id': 1}, {'row_id': 3}, {'row_id': 4}]
        original_ids = [id(student) for student in students]
        self.assertIsNone(database._attach_student_record_coverage(self.conn, students))
        self.assertEqual([id(student) for student in students], original_ids)
        self.assertEqual(students[0]['Name'], '가 학생')
        expected = [(4, 2, 2), (1, 1, 0), (4, 2, 2), (1, 1, 1), (0, 0, 0)]
        for student, counts in zip(students, expected):
            self.assertCoverage(student['RecordCoverage'], *counts)

    def test_detail_opt_in_preserves_default_response_and_special_flag(self):
        self.seed_mixed_records()
        for rows in (database.get_class_students(10),
                     database.get_class_students(10, include_record_coverage=False)):
            self.assertEqual([row['row_id'] for row in rows], [1, 2, 3, 4])
            self.assertTrue(all('RecordCoverage' not in row for row in rows))
        rows = database.get_class_students(20, include_record_coverage=True)
        self.assertEqual([row['row_id'] for row in rows], [1, 2])
        self.assertEqual([row['IsSpecial'] for row in rows], [1, 1])
        self.assertCoverage(rows[0]['RecordCoverage'], 4, 2, 2)
        self.assertCoverage(rows[1]['RecordCoverage'], 1, 1, 0)

    def test_list_and_detail_match_for_students_in_multiple_classes(self):
        self.seed_mixed_records()
        classes, total = database.search_classes()
        self.assertEqual(total, 3)
        self.assertEqual([row['Id'] for row in classes], [30, 20, 10])
        expected = {1: (4, 2, 2), 2: (1, 1, 0), 3: (1, 1, 1), 4: (0, 0, 0)}
        for class_row in classes:
            detail = database.get_class_students(class_row['Id'], include_record_coverage=True)
            list_coverage = {row['row_id']: row['RecordCoverage'] for row in class_row['Students']}
            detail_coverage = {row['row_id']: row['RecordCoverage'] for row in detail}
            self.assertEqual(list_coverage, detail_coverage)
            self.assertEqual(class_row['StudentCount'], len(detail))
            for row_id, coverage in list_coverage.items():
                self.assertCoverage(coverage, *expected[row_id])
        self.assertEqual(classes[0]['Students'], [])

    def test_list_filters_and_pagination_do_not_narrow_student_history(self):
        self.seed_mixed_records()
        classes, total = database.search_classes(q='정규', teacher_username='assigned_teacher', limit=1)
        self.assertEqual(total, 1)
        self.assertEqual([row['Id'] for row in classes], [10])
        self.assertCoverage(classes[0]['Students'][0]['RecordCoverage'], 4, 2, 2)
        classes, total = database.search_classes(page=2, limit=1)
        self.assertEqual(total, 3)
        self.assertEqual([row['Id'] for row in classes], [20])
        self.assertCoverage(classes[0]['Students'][0]['RecordCoverage'], 4, 2, 2)

    def test_empty_class_and_missing_results(self):
        self.assertEqual(database.get_class_students(30, include_record_coverage=True), [])
        self.assertEqual(database.get_class_students(999, include_record_coverage=True), [])
        self.assertEqual(database.search_classes(q='존재하지 않는 수업'), ([], 0))
        self.assertEqual(database.search_classes(page=100), ([], 3))

    def test_more_than_400_students_use_chunks_and_keep_all_counts(self):
        students = [{'row_id': number} for number in range(1000, 1805)]
        self.conn.executemany('INSERT INTO Students(rowid, Id, Name) VALUES (?, ?, ?)',
                              [(row['row_id'], row['row_id'] + 100000, '학생 {}'.format(row['row_id']))
                               for row in students])
        self.conn.executemany('''INSERT INTO StudyLogs
            (StudentId, ActualTeacherUsername, LessonContent) VALUES (?, ?, ?)''',
            [(row['row_id'], 'teacher', None) for row in students]
            + [(row['row_id'] + 100000, None, '내용') for row in students])
        self.conn.executemany('INSERT INTO ClassStudents VALUES (30, ?, 0)',
                              [(row['row_id'],) for row in students])
        self.conn.commit()
        statements = []
        self.conn.set_trace_callback(statements.append)
        database._attach_student_record_coverage(self.conn, students + [dict(students[0])])
        queries = [sql for sql in statements if 'AS student_row_id' in sql]
        self.assertEqual(len(queries), 3)
        batch_sizes = [len(sql.split('WHERE s.rowid IN (', 1)[1].split(')', 1)[0].split(','))
                       for sql in queries]
        self.assertEqual(batch_sizes, [400, 400, 5])
        for student in students:
            self.assertCoverage(student['RecordCoverage'], 2, 1, 1)
        # 실제 목록·상세 경로에서도 분할된 전체 학생의 결과가 일치해야 한다.
        detail = database.get_class_students(30, include_record_coverage=True)
        classes, total = database.search_classes(q='빈 수업')
        self.assertEqual(total, 1)
        self.assertEqual(len(detail), 805)
        self.assertEqual(len(classes[0]['Students']), 805)
        expected = {row['row_id']: row['RecordCoverage'] for row in students}
        self.assertEqual({row['row_id']: row['RecordCoverage'] for row in detail}, expected)
        self.assertEqual({row['row_id']: row['RecordCoverage'] for row in classes[0]['Students']}, expected)
        self.assertGreater(self.connection_mock.call_count, 0)


if __name__ == '__main__':
    unittest.main()
