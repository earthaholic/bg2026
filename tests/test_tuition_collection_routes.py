"""납입 관리 라우터 통합과 권한 경계를 확인한다."""
import unittest
from unittest.mock import patch

import main
from auth import get_current_staff


class TuitionCollectionRouteTests(unittest.TestCase):
    def test_collection_routes_require_staff(self):
        routes = main.tuition_collection_router.routes
        paths = main.app.openapi()['paths']
        self.assertGreaterEqual(len(routes), 5)
        for route in routes:
            self.assertIn(route.path, paths)
        for route in routes:
            with self.subTest(path=route.path, methods=route.methods):
                dependencies = [dep.call for dep in route.dependant.dependencies]
                self.assertIn(get_current_staff, dependencies)

    def test_startup_initializes_collection_after_system_tables(self):
        calls = []
        with patch.object(main, 'init_system_tables', side_effect=lambda: calls.append('system')), \
             patch.object(main, 'init_activity_tables'), \
             patch.object(main, 'init_tuition_collection_tables', side_effect=lambda: calls.append('collection')), \
             patch.object(main, 'advance_student_grades'):
            main.on_startup()
        self.assertEqual(calls, ['system', 'collection'])


if __name__ == '__main__':
    unittest.main()
