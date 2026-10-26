"""사이트 API 변경 시 MCP 조회 도구 누락이나 변경 경로 혼입을 검출한다."""
import json
from pathlib import Path
import unittest
from generate_mcp_catalog import build_catalog, READ_POSTS
from main import app


class CatalogTests(unittest.TestCase):
    def test_generated_catalog_matches_reviewed_file(self):
        saved = json.loads((Path(__file__).resolve().parents[1] / 'mcp_catalog.json').read_text(encoding='utf-8'))
        self.assertEqual(saved, build_catalog())

    def test_all_api_reads_and_only_reviewed_posts(self):
        catalog = build_catalog()
        paths = {(e['method'], e['path']) for e in catalog}
        expected = {('GET', p) for p, methods in app.openapi()['paths'].items() if p.startswith('/api/') and 'get' in methods}
        expected |= {('POST', p) for p in READ_POSTS}
        self.assertEqual(paths, expected)
        self.assertNotIn(('POST', '/api/admin/sql/execute'), paths)
        self.assertNotIn(('POST', '/api/admin/sql/export-csv'), paths)
        self.assertEqual(len(catalog), len({e['name'] for e in catalog}))


if __name__ == '__main__':
    unittest.main()
