"""기존 학습 기록의 수업 내용(LessonContent)만 CSV로 일괄 반영한다.

기본 실행은 검증 모드다. 실제 데이터 변경은 반드시 --apply를 지정해야 한다.
운영 서버에서 실행할 때는 웹 서버를 먼저 중지해 DB에 동시에 쓰는 작업이 없도록 한다.
"""

import argparse
import csv
import json
import sqlite3
import sys
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Tuple


REQUIRED_COLUMNS = {"StudyLogId", "LessonContent", "ImportStatus"}


def read_rows(csv_path: Path, include_review: bool) -> Tuple[List[Dict[str, str]], List[str]]:
    """반영 대상 CSV 행과 형식 오류를 읽는다."""
    with csv_path.open("r", encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file)
        missing_columns = REQUIRED_COLUMNS - set(reader.fieldnames or [])
        if missing_columns:
            raise ValueError(f"CSV에 필수 열이 없습니다: {', '.join(sorted(missing_columns))}")
        allowed_statuses = {"ready", "review"} if include_review else {"ready"}
        rows: List[Dict[str, str]] = []
        errors: List[str] = []
        seen_ids = set()
        for line_number, row in enumerate(reader, start=2):
            if (row.get("ImportStatus") or "").strip().lower() not in allowed_statuses:
                continue
            raw_id = (row.get("StudyLogId") or "").strip()
            if not raw_id.isdigit() or int(raw_id) <= 0:
                errors.append(f"{line_number}행: StudyLogId가 올바른 양의 정수가 아닙니다.")
                continue
            log_id = int(raw_id)
            if log_id in seen_ids:
                errors.append(f"{line_number}행: StudyLogId {log_id}가 CSV에 중복되어 있습니다.")
                continue
            seen_ids.add(log_id)
            rows.append({"line": str(line_number), "id": str(log_id), "content": (row.get("LessonContent") or "").strip()})
    return rows, errors


def verify_schema(conn: sqlite3.Connection) -> None:
    tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if "StudyLogs" not in tables or "_app_audit_logs" not in tables:
        raise ValueError("StudyLogs 또는 _app_audit_logs 테이블이 없습니다. 서버를 한 번 기동해 스키마를 보완해 주세요.")
    columns = {row[1] for row in conn.execute('PRAGMA table_info("StudyLogs")')}
    required = {"LessonContent", "UpdatedBy", "UpdatedAt"}
    if required - columns:
        raise ValueError(f"StudyLogs에 필요한 열이 없습니다: {', '.join(sorted(required - columns))}")


def resolve_rows(conn: sqlite3.Connection, rows: List[Dict[str, str]]) -> Tuple[List[Dict[str, object]], List[str]]:
    """StudyLogId를 rowid 또는 Id로 안전하게 해석한다."""
    resolved: List[Dict[str, object]] = []
    errors: List[str] = []
    cursor = conn.cursor()
    for item in rows:
        log_id = int(item["id"])
        cursor.execute('SELECT rowid, "LessonContent" FROM "StudyLogs" WHERE rowid = ? OR "Id" = ?', (log_id, log_id))
        matches = cursor.fetchall()
        if not matches:
            errors.append(f"{item['line']}행: StudyLogId {log_id}에 해당하는 학습 기록이 없습니다.")
            continue
        if len(matches) != 1:
            errors.append(f"{item['line']}행: StudyLogId {log_id}가 둘 이상의 학습 기록과 일치합니다.")
            continue
        rowid, previous_content = matches[0]
        resolved.append({"line": item["line"], "id": log_id, "rowid": rowid,
                         "old_content": previous_content or "", "new_content": item["content"]})
    return resolved, errors


def create_backup(db_path: Path, backup_dir: Path) -> Path:
    backup_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = backup_dir / f"{db_path.stem}_before_lessoncontent_{timestamp}{db_path.suffix}"
    source = sqlite3.connect(str(db_path))
    destination = sqlite3.connect(str(backup_path))
    try:
        source.backup(destination)
    finally:
        destination.close()
        source.close()
    return backup_path


def apply_updates(db_path: Path, resolved: List[Dict[str, object]], operator: str, backup_dir: Path) -> Path:
    backup_path = create_backup(db_path, backup_dir)
    conn = sqlite3.connect(str(db_path))
    try:
        verify_schema(conn)
        conn.execute("BEGIN IMMEDIATE")
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        for item in resolved:
            cursor = conn.cursor()
            cursor.execute('SELECT * FROM "StudyLogs" WHERE rowid = ?', (item["rowid"],))
            old_row = cursor.fetchone()
            if old_row is None:
                raise RuntimeError(f"학습 기록 rowid {item['rowid']}를 다시 찾지 못했습니다.")
            names = [description[0] for description in cursor.description]
            old_data = dict(zip(names, old_row))
            cursor.execute('UPDATE "StudyLogs" SET "LessonContent" = ?, "UpdatedBy" = ?, "UpdatedAt" = ? WHERE rowid = ?',
                           (item["new_content"], operator, now, item["rowid"]))
            cursor.execute('SELECT * FROM "StudyLogs" WHERE rowid = ?', (item["rowid"],))
            new_data = dict(zip([description[0] for description in cursor.description], cursor.fetchone()))
            cursor.execute("""INSERT INTO _app_audit_logs
                (table_name, record_id, action, old_data, new_data, changed_fields, username, user_role, ip_address)
                VALUES (?, ?, 'UPDATE', ?, ?, ?, ?, 'admin', '')""",
                ("StudyLogs", str(item["rowid"]), json.dumps(old_data, ensure_ascii=False),
                 json.dumps(new_data, ensure_ascii=False), json.dumps(["LessonContent"], ensure_ascii=False), operator))
        conn.commit()
        return backup_path
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="StudyLogs.LessonContent CSV 일괄 반영 도구")
    parser.add_argument("--csv", required=True, type=Path, help="반영할 CSV 파일 경로")
    parser.add_argument("--db", type=Path, default=Path("data.db"), help="운영 SQLite DB 경로 (기본: data.db)")
    parser.add_argument("--apply", action="store_true", help="검증만 하지 않고 실제로 반영")
    parser.add_argument("--include-review", action="store_true", help="review 행도 함께 반영 (기본: ready만)")
    parser.add_argument("--operator", default="lessoncontent-csv-import", help="감사 이력에 남길 작업자명")
    parser.add_argument("--backup-dir", type=Path, default=Path("backups"), help="적용 전 DB 백업 폴더")
    args = parser.parse_args()
    if not args.csv.is_file() or not args.db.is_file():
        print("오류: CSV 또는 DB 파일을 찾을 수 없습니다.", file=sys.stderr)
        return 2
    try:
        rows, errors = read_rows(args.csv, args.include_review)
        conn = sqlite3.connect(str(args.db))
        try:
            verify_schema(conn)
            resolved, resolve_errors = resolve_rows(conn, rows)
        finally:
            conn.close()
        errors.extend(resolve_errors)
    except (OSError, ValueError, csv.Error) as error:
        print(f"오류: {error}", file=sys.stderr)
        return 2
    changes = [row for row in resolved if row["old_content"] != row["new_content"]]
    print(f"대상 CSV 행: {len(rows)}건\n일치한 학습 기록: {len(resolved)}건\n수업 내용 변경 예정: {len(changes)}건\n기존 값과 같아 건너뜀: {len(resolved) - len(changes)}건")
    if errors:
        print("\n반영을 중단합니다. 아래 오류를 해결해 주세요:", file=sys.stderr)
        print(*[f"- {error}" for error in errors], sep="\n", file=sys.stderr)
        return 1
    if not args.apply:
        print("\n검증 완료: 실제 반영은 하지 않았습니다. 반영하려면 --apply를 추가하세요.")
        return 0
    if not changes:
        print("\n변경할 수업 내용이 없습니다. 실제 반영은 하지 않았습니다.")
        return 0
    try:
        backup_path = apply_updates(args.db, changes, args.operator, args.backup_dir)
    except (OSError, sqlite3.Error, RuntimeError, ValueError) as error:
        print(f"오류: 반영에 실패했습니다. DB는 트랜잭션으로 되돌렸습니다: {error}", file=sys.stderr)
        return 1
    print(f"\n반영 완료: LessonContent {len(changes)}건을 수정했습니다.\nDB 백업: {backup_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
