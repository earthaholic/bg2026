"""도서 검색의 보유 자료 조건을 확인한다.

자료 구성(퀴즈·독서 문제/답안·글쓰기 문제/답안·심화·토론)은 선택한 조합과 정확히
일치하는 도서만 조회하고, 자료 보유(PDF·종이책·YES24·밀리)는 선택한 자료를 반드시
갖고 있는 도서를 조회한다. 실제 data.db는 사용하지 않고 임시 SQLite DB를 만든다.
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


BOOKS = [
    # Title, HasQuiz, HasReadingQuestion, HasReadingAnswer, HasWritingQuestion,
    # HasWritingAnswer, HasAdvancedMaterial, HasDebateMaterial, IsPaperbookExist,
    # IsYes24Exist, IsMillieExist, IsPdfExist
    ('자료 없음', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
    ('퀴즈만', 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
    ('독서 문제만', 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1),
    ('독서 답안만', 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0),
    ('퀴즈와 토론', 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0),
    ('심화만', 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0),
    ('종이책만', 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0),
    ('퀴즈와 종이책', 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0),
    ('글쓰기 답안만', 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0),
]


class BookMaterialFilterTests(unittest.TestCase):
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
        for index, row in enumerate(BOOKS, start=1):
            self.sql(
                '''INSERT INTO Books(Id, Title, Author, Publisher, Subject, Target, BookLength, Voca,
                        Metaphor, HasQuiz, HasReadingQuestion, HasReadingAnswer, HasWritingQuestion,
                        HasWritingAnswer, HasAdvancedMaterial, HasDebateMaterial, IsPaperbookExist,
                        IsPdfExist, IsYes24Exist, IsMillieExist, Desc)
                   VALUES (?, ?, '', '', '', '', 0, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '')''',
                (index, row[0], *row[1:6], row[6], row[7], row[8], row[11], row[9], row[10])
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

    def search(self, query=''):
        response = self.client.get(f'/api/user/books/search?limit=50{query}', headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        titles = sorted(book['Title'] for book in data['books'])
        self.assertEqual(data['total_count'], len(titles), query)
        return titles

    def test_default_shows_only_books_without_composition_materials(self):
        self.assertEqual(self.search(), ['자료 없음', '종이책만'])

    def test_selected_material_excludes_other_composition_materials(self):
        self.assertEqual(self.search('&has_reading=1'), ['독서 답안만', '독서 문제만'])
        self.assertEqual(self.search('&has_quiz=1'), ['퀴즈만', '퀴즈와 종이책'])
        self.assertEqual(self.search('&has_writing=1'), ['글쓰기 답안만'])
        self.assertEqual(self.search('&has_advanced=1'), ['심화만'])

    def test_multiple_composition_materials_require_exact_combination(self):
        self.assertEqual(self.search('&has_quiz=1&has_debate=1'), ['퀴즈와 토론'])
        self.assertEqual(self.search('&has_quiz=1&has_reading=1'), [])

    def test_holding_materials_require_only_the_selected_item(self):
        self.assertEqual(self.search('&has_paperbook=1'), ['종이책만'])
        self.assertEqual(self.search('&has_writing=1&has_yes24=1'), ['글쓰기 답안만'])
        self.assertEqual(
            self.search('&has_quiz=1&has_paperbook=1'),
            ['퀴즈와 종이책']
        )
        self.assertEqual(self.search('&has_reading=1&pdf_status=1'), ['독서 문제만'])
        self.assertEqual(self.search('&pdf_status=0&has_debate=1'), [])


if __name__ == '__main__':
    unittest.main()

