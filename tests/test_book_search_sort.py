"""도서 검색의 도서명 정렬이 현재 페이지가 아니라 전체 검색 결과에 적용되는지 확인한다.

실제 data.db는 사용하지 않고 임시 SQLite DB를 만든다.
"""
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

import database
import main
from auth import create_access_token
from config import settings
from test_studylog_permissions import create_fixture


BOOKS = ['다섯째 책', '둘째 책', '넷째 책', '첫째 책', '셋째 책']


class BookSearchSortTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.old_path = settings.SQLITE_DB_PATH
        settings.SQLITE_DB_PATH = str(Path(self.temp.name) / 'books.db')
        create_fixture(settings.SQLITE_DB_PATH)
        database.init_system_tables()
        main.init_activity_tables()
        database.create_user('manager_a', '검증 암호', 'manager', 'manager_a')
        self.sql('DELETE FROM StudyLogs')
        self.sql('DELETE FROM Books')
        for index, title in enumerate(BOOKS, start=1):
            self.sql(
                '''INSERT INTO Books(Id, Title, Author, Publisher, Subject, Target, BookLength, Voca,
                        Metaphor, HasQuiz, HasReadingQuestion, HasReadingAnswer, HasWritingQuestion,
                        HasWritingAnswer, HasAdvancedMaterial, HasDebateMaterial, IsPaperbookExist,
                        IsPdfExist, IsYes24Exist, IsMillieExist, Desc)
                   VALUES (?, ?, '', '', '', '', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, '')''',
                (index, title)
            )
        self.client = TestClient(main.app, raise_server_exceptions=False)
        self.headers = {'Authorization': 'Bearer ' + create_access_token({'sub': 'manager_a'})}

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

    def search(self, query):
        response = self.client.get(f'/api/user/books/search?{query}', headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def all_pages(self, sort_direction, limit=2):
        first = self.search(f'sort_by=Title&sort_direction={sort_direction}&limit={limit}&page=1')
        titles = [book['Title'] for book in first['books']]
        for page in range(2, first['total_pages'] + 1):
            data = self.search(f'sort_by=Title&sort_direction={sort_direction}&limit={limit}&page={page}')
            titles.extend(book['Title'] for book in data['books'])
        return titles

    def test_title_sort_covers_every_page(self):
        # 페이지 경계를 넘어 전체 검색 결과가 도서명 순서로 정렬되어야 한다.
        self.assertEqual(self.all_pages('asc'), sorted(BOOKS))
        self.assertEqual(self.all_pages('desc'), sorted(BOOKS, reverse=True))

    def test_title_sort_keeps_total_count(self):
        data = self.search('sort_by=Title&sort_direction=asc&limit=2&page=1')
        self.assertEqual(data['total_count'], len(BOOKS))
        self.assertEqual(data['total_pages'], 3)
        self.assertEqual([book['Title'] for book in data['books']], sorted(BOOKS)[:2])

    def test_unknown_sort_column_is_rejected(self):
        response = self.client.get('/api/user/books/search?sort_by=Title%20DESC', headers=self.headers)
        self.assertEqual(response.status_code, 422, response.text)


if __name__ == '__main__':
    unittest.main()
