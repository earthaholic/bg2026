"""MCP 읽기 컨텍스트와 원본 무변경을 격리된 데이터베이스에서 검증한다."""
import asyncio
from datetime import datetime
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from starlette.concurrency import run_in_threadpool

import database
from read_only_context import ReadOnlyContextMiddleware, is_read_only_request, read_only_context


class ReadContextTests(unittest.IsolatedAsyncioTestCase):
    async def test_concurrent_requests_and_worker_threads_are_isolated(self):
        arrived = 0
        ready = asyncio.Event()
        results = {}

        async def app(scope, receive, send):
            nonlocal arrived
            arrived += 1
            if arrived == 2:
                ready.set()
            await ready.wait()
            results[scope['path']] = (
                is_read_only_request(), await run_in_threadpool(is_read_only_request))

        middleware = ReadOnlyContextMiddleware(app)
        await asyncio.gather(
            middleware({'type': 'http', 'path': 'mcp', 'headers': [(b'x-bg-read-only', b'1')]}, None, None),
            middleware({'type': 'http', 'path': 'web', 'headers': []}, None, None),
        )
        self.assertEqual(results, {'mcp': (True, True), 'web': (False, False)})
        self.assertFalse(is_read_only_request())

    async def test_exception_restores_outer_context_and_exact_header(self):
        async def app(scope, receive, send):
            self.assertFalse(is_read_only_request())
            raise RuntimeError('검증용 오류')

        token = read_only_context.set(True)
        try:
            with self.assertRaises(RuntimeError):
                await ReadOnlyContextMiddleware(app)(
                    {'type': 'http', 'headers': [(b'x-bg-read-only', b'0')]}, None, None)
            self.assertTrue(is_read_only_request())
        finally:
            read_only_context.reset(token)

    async def test_cancellation_restores_context(self):
        async def app(scope, receive, send):
            self.assertTrue(is_read_only_request())
            raise asyncio.CancelledError()
        with self.assertRaises(asyncio.CancelledError):
            await ReadOnlyContextMiddleware(app)(
                {'type': 'http', 'headers': [(b'X-BG-Read-Only', b'1')]}, None, None)
        self.assertFalse(is_read_only_request())


class ReadDatabaseTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.db_path = str(Path(directory.name) / 'isolated.db')
        patcher = patch.object(database.settings, 'SQLITE_DB_PATH', self.db_path)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.conn = database.get_db_connection()
        self.addCleanup(self.conn.close)
        self.conn.executescript('''
            CREATE TABLE Students (Id INTEGER, Name TEXT, Grade TEXT,
                GradeAtRegistration TEXT, RegistrationYear INTEGER, School TEXT);
            CREATE TABLE Books (Id INTEGER);
            CREATE TABLE StudyLogs (StudentId, BookId);
            CREATE TABLE _app_book_student_counts (book_rowid INTEGER PRIMARY KEY, student_count INTEGER NOT NULL);
            CREATE TABLE _app_book_student_counts_state (id INTEGER PRIMARY KEY, version INTEGER);
            CREATE TABLE _app_book_students_version (id INTEGER PRIMARY KEY, version INTEGER);
            CREATE TABLE _app_activity_logs (message TEXT);
            INSERT INTO Students VALUES (101, '예시학생', '초6', '초6', 2000, '예시초');
            INSERT INTO Students VALUES (202, '다른학생', '초1', '', 0, '');
            INSERT INTO Books VALUES (1001);
            INSERT INTO Books VALUES (2002);
            INSERT INTO StudyLogs VALUES (101, 1001), (1, 1), ('예시학생', 1001), (202, 1);
            INSERT INTO _app_book_student_counts VALUES (1, 99), (2, 88);
            INSERT INTO _app_book_students_version VALUES (1, 7);
            INSERT INTO _app_book_student_counts_state VALUES (1, 6);
        ''')
        self.conn.execute('UPDATE Students SET RegistrationYear = ? WHERE Id = 101', (datetime.now().year - 1,))
        self.conn.commit()

    def counts(self, schema=''):
        return [tuple(r) for r in self.conn.execute(
            'SELECT * FROM ' + schema + '_app_book_student_counts ORDER BY book_rowid')]

    def test_read_context_preserves_all_main_data_and_fresh_counts(self):
        before = '\n'.join(self.conn.iterdump())
        token = read_only_context.set(True)
        try:
            database.advance_student_grades()
            database.refresh_book_student_counts(self.conn)
            self.assertEqual(self.counts(), [(1, 2)])
            self.assertEqual(self.counts('main.'), [(1, 99), (2, 88)])
            self.assertTrue(self.conn.in_transaction)
            database.refresh_book_student_counts(self.conn)
            self.assertEqual(self.counts(), [(1, 2)])
            # 명시적으로 커밋하더라도 업무 원본·캐시는 바뀌지 않는다.
            self.conn.commit()
        finally:
            read_only_context.reset(token)
        other = database.get_db_connection()
        try:
            # iterdump도 이름을 한정하지 않아 TEMP를 읽으므로 새 연결로 비교한다.
            self.assertEqual('\n'.join(other.iterdump()), before)
            self.assertEqual([tuple(r) for r in other.execute('SELECT * FROM _app_book_student_counts')], [(1, 99), (2, 88)])
        finally:
            other.close()

    def test_temp_aggregation_works_with_read_only_main_database(self):
        # 영구 DB에 쓸 수 없는 연결에서도 TEMP 집계가 독립적으로 동작한다.
        conn = sqlite3.connect(Path(self.db_path).as_uri() + '?mode=ro', uri=True)
        conn.row_factory = sqlite3.Row
        token = read_only_context.set(True)
        try:
            database.refresh_book_student_counts(conn)
            self.assertEqual([tuple(r) for r in conn.execute('SELECT * FROM _app_book_student_counts')], [(1, 2)])
            conn.commit()
        finally:
            read_only_context.reset(token)
            conn.close()

    def test_web_updates_persistent_cache_and_grades(self):
        database.advance_student_grades()
        self.assertEqual(tuple(self.conn.execute('SELECT Grade, School FROM Students WHERE Id=101').fetchone()), ('중1', ''))
        database.refresh_book_student_counts(self.conn)
        self.assertEqual(self.counts('main.'), [(1, 2)])
        self.assertEqual(self.conn.execute('SELECT version FROM _app_book_student_counts_state').fetchone()[0], 7)

    def test_activity_log_is_not_blocked(self):
        token = read_only_context.set(True)
        try:
            conn = database.get_db_connection()
            try:
                conn.execute("INSERT INTO _app_activity_logs VALUES ('조회')")
                conn.commit()
            finally:
                conn.close()
        finally:
            read_only_context.reset(token)
        self.assertEqual(self.conn.execute('SELECT COUNT(*) FROM _app_activity_logs').fetchone()[0], 1)


if __name__ == '__main__':
    unittest.main()
