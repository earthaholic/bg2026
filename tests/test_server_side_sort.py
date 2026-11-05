"""조회 목록의 열 정렬이 현재 페이지가 아니라 전체 결과에 적용되는지 확인한다.

학생 검색·수업 목록·변경 이력·활동 이력·데이터 그리드 Studio를 대상으로 하며,
실제 data.db는 사용하지 않고 임시 SQLite DB를 만든다.
"""
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

from fastapi.testclient import TestClient

import activity
import database
import main
from auth import create_access_token
from config import settings
from test_studylog_permissions import create_fixture


STUDENTS = ['마지막 학생', '가운데 학생', '처음 학생']
CLASSES = [
    ('다반', '목', '19:00', 'teacher_b'),
    ('가반', '월', '09:00', 'teacher_a'),
    ('나반', '수', '13:00', 'teacher_a'),
]


class ServerSideSortTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.old_path = settings.SQLITE_DB_PATH
        settings.SQLITE_DB_PATH = str(Path(self.temp.name) / 'sort.db')
        create_fixture(settings.SQLITE_DB_PATH)
        database.init_system_tables()
        main.init_activity_tables()
        activity.init_activity_tables()
        database.create_user('admin_a', '검증 암호', 'admin', 'admin_a')
        self.sql('DELETE FROM StudyLogs')
        self.sql('DELETE FROM Students')
        self.sql('DELETE FROM ClassStudents')
        self.sql('DELETE FROM Classes')
        self.sql('DELETE FROM _app_audit_logs')
        self.sql('DELETE FROM _app_activity_logs')
        for index, name in enumerate(STUDENTS, start=1):
            self.sql('INSERT INTO Students(Id, Name, Grade, IsClassEnded) VALUES (?, ?, ?, 0)', (100 + index, name, '초1'))
        for index, (class_name, day, start, teacher) in enumerate(CLASSES, start=1):
            self.sql(
                'INSERT INTO Classes(Id, ClassName, TeacherUsername, DayOfWeek, StartTime) VALUES (?, ?, ?, ?, ?)',
                (500 + index, class_name, teacher, day, start)
            )
        for hour in (1, 2, 3):
            self.sql(
                '''INSERT INTO _app_audit_logs(table_name, record_id, action, old_data, new_data,
                        changed_fields, username, user_role, ip_address, created_at)
                   VALUES ('Books', ?, 'UPDATE', '{}', '{}', '[]', ?, 'admin', '', ?)''',
                (str(hour), f'user_{hour}', f'{self.day(hour)} 10:00:00')
            )
        for hour, name in ((1, 'ccc'), (2, 'aaa'), (3, 'bbb')):
            self.sql(
                '''INSERT INTO _app_activity_logs(request_id, created_at, username, user_role, event,
                        area, target_id, route, method, status_code, duration_ms, source, metadata)
                   VALUES (?, ?, ?, 'admin', 'VIEW', 'books', '', '/', 'GET', 200, 5, 'server', '{}')''',
                (f'request-{hour}', f'{self.day(hour)} 10:00:00', name)
            )
        self.client = TestClient(main.app, raise_server_exceptions=False)
        self.headers = {'Authorization': 'Bearer ' + create_access_token({'sub': 'admin_a'})}

    def tearDown(self):
        self.client.close()
        settings.SQLITE_DB_PATH = self.old_path
        self.temp.cleanup()

    def sql(self, query, args=()):
        conn = database.get_db_connection()
        try:
            rows = conn.execute(query, args).fetchall()
            conn.commit()
            return rows
        finally:
            conn.close()

    def day(self, offset):
        # 활동 이력은 180일이 지난 기록을 지우므로 최근 날짜를 사용한다.
        return (date.today() - timedelta(days=4 - offset)).isoformat()

    def get(self, path):
        response = self.client.get(path, headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_student_search_sorts_every_page_by_name(self):
        asc = self.get('/api/user/students/search?include_ended=true&sort_by=Name&sort_direction=asc&limit=2&page=1')
        self.assertEqual([s['Name'] for s in asc['students']], ['가운데 학생', '마지막 학생'])
        second = self.get('/api/user/students/search?include_ended=true&sort_by=Name&sort_direction=asc&limit=2&page=2')
        self.assertEqual([s['Name'] for s in second['students']], ['처음 학생'])
        desc = self.get('/api/user/students/search?include_ended=true&sort_by=Name&sort_direction=desc&limit=2&page=1')
        self.assertEqual([s['Name'] for s in desc['students']], ['처음 학생', '마지막 학생'])

    def test_student_search_rejects_unknown_sort_column(self):
        response = self.client.get('/api/user/students/search?sort_by=Name%20DESC', headers=self.headers)
        self.assertEqual(response.status_code, 422, response.text)

    def test_class_list_sorts_by_weekday_and_student_count(self):
        rows = self.get('/api/user/classes?sort_by=DayOfWeek&sort_direction=asc&limit=2&page=1')
        self.assertEqual([c['ClassName'] for c in rows['classes']], ['가반', '나반'])
        second = self.get('/api/user/classes?sort_by=DayOfWeek&sort_direction=asc&limit=2&page=2')
        self.assertEqual([c['ClassName'] for c in second['classes']], ['다반'])
        by_name = self.get('/api/user/classes?sort_by=ClassName&sort_direction=asc&limit=30&page=1')
        self.assertEqual([c['ClassName'] for c in by_name['classes']], ['가반', '나반', '다반'])

    def test_audit_log_sorts_by_record_across_pages(self):
        asc = self.get('/api/admin/audit-logs?sort_by=record_id&sort_direction=asc&limit=2&page=1')
        self.assertEqual([log['record_id'] for log in asc['logs']], ['1', '2'])
        page_two = self.get('/api/admin/audit-logs?sort_by=record_id&sort_direction=asc&limit=2&page=2')
        self.assertEqual([log['record_id'] for log in page_two['logs']], ['3'])

    def test_activity_log_sorts_by_account_across_pages(self):
        # 조회 자체도 활동 이력에 기록되므로, 전체를 한 번에 받아 정렬이 전 구간에 적용되는지 본다.
        data = self.get('/api/admin/activity-logs?date_from=' + self.day(1) + '&date_to=' + self.day(3) + '&sort_by=username&sort_direction=asc&limit=100&page=1')
        names = [row['username'] for row in data['items']]
        self.assertGreaterEqual(len(names), 3)
        self.assertEqual(names, sorted(names))
        self.assertEqual(names[0], 'aaa')
        first_page = self.get('/api/admin/activity-logs?date_from=' + self.day(1) + '&date_to=' + self.day(3) + '&sort_by=username&sort_direction=asc&limit=2&page=1')
        self.assertEqual([row['username'] for row in first_page['items']], ['aaa', 'bbb'])

    def test_studio_table_data_sorts_by_column(self):
        rows = self.get('/api/tables/Students/data?sort_by=Name&sort_direction=asc&limit=2&page=1')
        self.assertEqual([row['Name'] for row in rows['rows']], ['가운데 학생', '마지막 학생'])
        second = self.get('/api/tables/Students/data?sort_by=Name&sort_direction=asc&limit=2&page=2')
        self.assertEqual([row['Name'] for row in second['rows']], ['처음 학생'])

    def test_studio_table_data_rejects_unknown_column(self):
        response = self.client.get('/api/tables/Students/data?sort_by=Name%3B%20DROP%20TABLE', headers=self.headers)
        self.assertEqual(response.status_code, 400, response.text)


if __name__ == '__main__':
    unittest.main()

