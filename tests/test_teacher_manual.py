"""일반 선생님 웹 매뉴얼의 문서 구조와 연결을 검증한다."""
import unittest
from pathlib import Path
from html.parser import HTMLParser

ROOT = Path(__file__).resolve().parents[1]


class ManualParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = []
        self.anchors = []
        self.assets = []
        self.chapters = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if "id" in attrs:
            self.ids.append(attrs["id"])
        if tag == "a":
            self.anchors.append(attrs.get("href", ""))
        if tag == "link" and attrs.get("rel") == "stylesheet":
            self.assets.append(attrs["href"])
        if tag == "script" and "src" in attrs:
            self.assets.append(attrs["src"])
        if tag == "section" and "manual-chapter" in attrs.get("class", "").split():
            self.chapters.append(attrs["id"])


class TeacherManualTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.html = (ROOT / "templates/teacher_manual.html").read_text(encoding="utf-8")
        cls.parsed = ManualParser()
        cls.parsed.feed(cls.html)

    def test_unique_ids_and_working_fragment_targets(self):
        self.assertEqual(len(self.parsed.ids), len(set(self.parsed.ids)))
        for href in self.parsed.anchors:
            if href.startswith("#"):
                self.assertIn(href[1:], self.parsed.ids)

    def test_chapters_and_assets(self):
        self.assertEqual(len(self.parsed.chapters), 11)
        for url in self.parsed.assets:
            self.assertTrue((ROOT / url.split("?")[0].lstrip("/")).is_file(), url)
        self.assertIn('<html lang="ko">', self.html)
        self.assertIn("<noscript>", self.html)

    def test_teacher_safety_guidance(self):
        for text in ["선택한 기록 삭제", "결석과 휴강은 다릅니다", "실제 진행 선생님",
                     "변경사항 저장", "특이사항 저장", "문자를 자동 발송하지 않습니다",
                     "본인 정산을 조회할 수 있습니다", "즉시 포함됩니다", "마감된 월"]:
            self.assertIn(text, self.html)

    def test_route_and_new_tab_entry(self):
        source = (ROOT / "main.py").read_text(encoding="utf-8")
        self.assertIn('@app.get("/manual", response_class=HTMLResponse)', source)
        self.assertIn('name="teacher_manual.html"', source)
        index = (ROOT / "templates/index.html").read_text(encoding="utf-8")
        self.assertIn('href="/manual" target="_blank" rel="noopener"', index)

    def test_manual_has_no_student_data_requests(self):
        script = (ROOT / "static/js/teacher_manual.js").read_text(encoding="utf-8")
        self.assertNotIn("fetch(", script)
        self.assertNotIn("localStorage", script)
        self.assertNotIn("innerHTML", script)


if __name__ == "__main__":
    unittest.main()
