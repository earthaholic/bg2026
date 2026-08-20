import sqlite3
import hashlib
import json
from typing import List, Dict, Any, Optional, Tuple
from config import settings

def get_db_connection():
    conn = sqlite3.connect(settings.SQLITE_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode('utf-8')).hexdigest()

def init_system_tables():
    """System table initialization for authentication and user management."""
    conn = get_db_connection()
    cursor = conn.cursor()

    # User authentication table (신규 스키마: admin / manager / teacher)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS _app_users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('admin', 'manager', 'teacher')),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # 구버전 스키마(role: admin/user)로 생성된 테이블이면 데이터 보존 마이그레이션
    cursor.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='_app_users'")
    row = cursor.fetchone()
    existing_ddl = (row['sql'] or '') if row else ''
    if existing_ddl and 'manager' not in existing_ddl:
        cursor.execute("ALTER TABLE _app_users RENAME TO _app_users_legacy")
        cursor.execute("""
            CREATE TABLE _app_users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('admin', 'manager', 'teacher')),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        # 기존 'user' 역할 계정은 'teacher'(선생님: 조회 전용)로 전환
        cursor.execute("""
            INSERT INTO _app_users (id, username, password_hash, role, created_at)
            SELECT id, username, password_hash,
                   CASE WHEN role = 'user' THEN 'teacher' ELSE role END,
                   created_at
            FROM _app_users_legacy
        """)
        cursor.execute("DROP TABLE _app_users_legacy")

    # Seed Admin User (사이트 관리자) if not exists
    cursor.execute("SELECT id FROM _app_users WHERE username = ?", (settings.ADMIN_USERNAME,))
    if not cursor.fetchone():
        cursor.execute(
            "INSERT INTO _app_users (username, password_hash, role) VALUES (?, ?, ?)",
            (settings.ADMIN_USERNAME, hash_password(settings.ADMIN_PASSWORD), "admin")
        )

    # 참고: 기본 manager/teacher 계정은 시드하지 않는다. (배포 시 admin 계정만 존재)
    # 필요한 staff(manager/teacher) 계정은 admin이 계정 관리 UI에서 직접 발급한다.

    # 수업료 기본 설정과 학생별 결제 이력 (로컬 전용 테이블)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS "TuitionFeeSettings" (
            "Id" INTEGER PRIMARY KEY,
            "ClassType" TEXT NOT NULL,
            "PaidLessons" INTEGER NOT NULL CHECK("PaidLessons" IN (10, 20, 30)),
            "DefaultFee" INTEGER NOT NULL DEFAULT 0 CHECK("DefaultFee" >= 0),
            "CreatedBy" TEXT DEFAULT '',
            "UpdatedBy" TEXT DEFAULT '',
            "UpdatedAt" TEXT DEFAULT '',
            UNIQUE("ClassType", "PaidLessons")
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS "TuitionPayments" (
            "Id" INTEGER PRIMARY KEY,
            "StudentId" INTEGER NOT NULL,
            "ClassType" TEXT NOT NULL,
            "PaidLessons" INTEGER NOT NULL CHECK("PaidLessons" IN (10, 20, 30)),
            "ServiceLessons" INTEGER NOT NULL DEFAULT 0 CHECK("ServiceLessons" BETWEEN 0 AND 10),
            "StartDate" TEXT NOT NULL,
            "PaidDate" TEXT NOT NULL DEFAULT '',
            "FeeAmount" INTEGER NOT NULL DEFAULT 0 CHECK("FeeAmount" >= 0),
            "Memo" TEXT DEFAULT '',
            "CreatedBy" TEXT DEFAULT '',
            "UpdatedBy" TEXT DEFAULT '',
            "UpdatedAt" TEXT DEFAULT ''
        )
    """)
    cursor.execute('PRAGMA table_info("TuitionPayments")')
    tuition_payment_cols = [r["name"] for r in cursor.fetchall()]
    if "PaidDate" not in tuition_payment_cols:
        cursor.execute('ALTER TABLE "TuitionPayments" ADD COLUMN "PaidDate" TEXT NOT NULL DEFAULT \'\'')
    if "Memo" not in tuition_payment_cols:
        cursor.execute('ALTER TABLE "TuitionPayments" ADD COLUMN "Memo" TEXT DEFAULT \'\'')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_tuition_payments_student_start ON "TuitionPayments"("StudentId", "StartDate")')

    # 학생별 상담 기록 (로컬 전용)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS "StudentConsultations" (
            "Id" INTEGER PRIMARY KEY,
            "StudentId" INTEGER NOT NULL,
            "Content" TEXT NOT NULL DEFAULT '',
            "CreatedAt" TEXT DEFAULT (datetime('now','localtime')),
            "CreatedBy" TEXT DEFAULT '',
            "UpdatedBy" TEXT DEFAULT '',
            "UpdatedAt" TEXT DEFAULT ''
        )
    """)
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_student_consultations_student_created ON "StudentConsultations"("StudentId", "CreatedAt" DESC)')

    # 수업(Classes) 및 수업-학생 관계(ClassStudents) 테이블
    # (로컬 전용 도메인 테이블 - oracle_sync.py 실행 시 DROP되므로 시작 시점에 재생성됨)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS "Classes" (
            "Id" INTEGER PRIMARY KEY,
            "ClassName" TEXT NOT NULL,
            "TeacherUsername" TEXT NOT NULL,
            "DayOfWeek" TEXT NOT NULL,
            "StartTime" TEXT DEFAULT '',
            "IsEnded" INTEGER DEFAULT 0,
            "CreatedAt" TEXT DEFAULT (datetime('now','localtime')),
            "CreatedBy" TEXT DEFAULT '',
            "UpdatedBy" TEXT DEFAULT '',
            "UpdatedAt" TEXT DEFAULT ''
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS "ClassStudents" (
            "Id" INTEGER PRIMARY KEY,
            "ClassId" INTEGER NOT NULL,
            "StudentId" INTEGER NOT NULL,
            "IsSpecial" INTEGER DEFAULT 0,
            UNIQUE("ClassId", "StudentId")
        )
    """)
    # ClassStudents에 특강 여부(IsSpecial) 컬럼 보완 (기존 DB 대응)
    try:
        cursor.execute('PRAGMA table_info("ClassStudents")')
        cs_cols = [r["name"] for r in cursor.fetchall()]
        if "IsSpecial" not in cs_cols:
            cursor.execute('ALTER TABLE "ClassStudents" ADD COLUMN "IsSpecial" INTEGER DEFAULT 0')
    except Exception:
        pass

    # Classes에 감사 추적 컬럼 및 IsEnded 컬럼 보완 (기존 DB 대응)
    try:
        cursor.execute('PRAGMA table_info("Classes")')
        classes_cols = [r["name"] for r in cursor.fetchall()]
        for _col in ["CreatedBy", "UpdatedBy", "UpdatedAt"]:
            if _col not in classes_cols:
                cursor.execute(f'ALTER TABLE "Classes" ADD COLUMN "{_col}" TEXT DEFAULT \'\'')
        if "IsEnded" not in classes_cols:
            cursor.execute('ALTER TABLE "Classes" ADD COLUMN "IsEnded" INTEGER DEFAULT 0')
    except Exception:
        pass

    # StudyLogs에 수업 내용(LessonContent)·수업 내용 메모(Description)·특강 여부(IsSpecial)·감사 추적 컬럼 추가
    # (StudyLogs는 oracle_sync.py가 만들므로, 재생성 후에도 시작 시점에 보완한다)
    # IsSpecial: 특강 여부 플래그. 기본값 0(FALSE), 일괄 등록 시 학생별로 기록된다.
    try:
        cursor.execute('PRAGMA table_info("StudyLogs")')
        studylog_cols = [r["name"] for r in cursor.fetchall()]
        for _col, _ddl in [
            ("Description", "TEXT DEFAULT ''"),
            ("LessonContent", "TEXT DEFAULT ''"),
            ("IsSpecial", "INTEGER DEFAULT 0"),
            ("CreatedBy", "TEXT DEFAULT ''"),
            ("UpdatedBy", "TEXT DEFAULT ''"),
            ("UpdatedAt", "TEXT DEFAULT ''"),
        ]:
            if _col not in studylog_cols:
                cursor.execute(f'ALTER TABLE "StudyLogs" ADD COLUMN "{_col}" {_ddl}')
    except Exception:
        pass  # StudyLogs 테이블이 아직 없으면 스킵 (oracle_sync 후 생성됨)

    # Books에 감사 추적 컬럼 보완 (기존 DB 대응)
    try:
        cursor.execute('PRAGMA table_info("Books")')
        books_cols = [r["name"] for r in cursor.fetchall()]
        for _col in ["CreatedBy", "UpdatedBy", "UpdatedAt"]:
            if _col not in books_cols:
                cursor.execute(f'ALTER TABLE "Books" ADD COLUMN "{_col}" TEXT DEFAULT \'\'')
    except Exception:
        pass  # Books 테이블이 아직 없으면 스킵

    # Students에 감사 추적 컬럼 보완 (기존 DB 대응)
    try:
        cursor.execute('PRAGMA table_info("Students")')
        students_cols = [r["name"] for r in cursor.fetchall()]
        for _col in ["CreatedBy", "UpdatedBy", "UpdatedAt"]:
            if _col not in students_cols:
                cursor.execute(f'ALTER TABLE "Students" ADD COLUMN "{_col}" TEXT DEFAULT \'\'')
    except Exception:
        pass  # Students 테이블이 아직 없으면 스킵

    # Students에 등록 학년(Grade)·추천인(Referrer) 컬럼 보완 (기존 DB 대응)
    try:
        cursor.execute('PRAGMA table_info("Students")')
        students_cols = [r["name"] for r in cursor.fetchall()]
        for _col, _ddl in [
            ("Grade", "TEXT DEFAULT ''"),
            ("Referrer", "TEXT DEFAULT ''"),
            ("School", "TEXT DEFAULT ''"),
            ("GradeAtRegistration", "TEXT DEFAULT ''"),
            ("RegistrationYear", "INTEGER DEFAULT 0"),
            ("RegistrationMonth", "INTEGER DEFAULT 0"),
        ]:
            if _col not in students_cols:
                cursor.execute(f'ALTER TABLE "Students" ADD COLUMN "{_col}" {_ddl}')
    except Exception:
        pass  # Students 테이블이 아직 없으면 스킵

    # Students에 수업 종료(IsClassEnded) 컬럼 보완 (기존 DB 대응)
    try:
        cursor.execute('PRAGMA table_info("Students")')
        students_cols = [r["name"] for r in cursor.fetchall()]
        for _col, _ddl in [
            ("IsClassEnded", "INTEGER DEFAULT 0"),
        ]:
            if _col not in students_cols:
                cursor.execute(f'ALTER TABLE "Students" ADD COLUMN "{_col}" {_ddl}')
    except Exception:
        pass  # Students 테이블이 아직 없으면 스킵

    # 감사 로그 테이블 생성
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS _app_audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            table_name TEXT NOT NULL,
            record_id TEXT NOT NULL,
            action TEXT NOT NULL CHECK(action IN ('INSERT','UPDATE','DELETE')),
            old_data TEXT,
            new_data TEXT,
            changed_fields TEXT,
            username TEXT NOT NULL,
            user_role TEXT NOT NULL,
            ip_address TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now','localtime'))
        )
    """)

    # 감사 로그 인덱스 생성
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_audit_table_record ON _app_audit_logs(table_name, record_id)
    """)
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_audit_username ON _app_audit_logs(username)
    """)
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_audit_created_at ON _app_audit_logs(created_at)
    """)

    conn.commit()
    conn.close()

def advance_student_grades() -> None:
    """등록 당시 학년을 기준으로 새해마다 학생 학년을 계산해 반영한다."""
    from datetime import datetime
    grade_order = ["초1", "초2", "초3", "초4", "초5", "초6", "중1", "중2", "중3", "고1", "고2", "고3"]
    now_year = datetime.now().year
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute('''SELECT rowid, "Grade", "GradeAtRegistration", "RegistrationYear"
                          FROM "Students" WHERE COALESCE("GradeAtRegistration", '') != '' AND COALESCE("RegistrationYear", 0) > 0''')
        for row in cursor.fetchall():
            base_grade = row["GradeAtRegistration"]
            if base_grade not in grade_order:
                continue
            target_index = min(grade_order.index(base_grade) + max(0, now_year - row["RegistrationYear"]), len(grade_order) - 1)
            next_grade = grade_order[target_index]
            if next_grade != row["Grade"]:
                clear_school = 1 if (row["Grade"] == "초6" and next_grade == "중1") or (row["Grade"] == "중3" and next_grade == "고1") else 0
                if clear_school:
                    cursor.execute('UPDATE "Students" SET "Grade" = ?, "School" = \'\' WHERE rowid = ?', (next_grade, row["rowid"]))
                else:
                    cursor.execute('UPDATE "Students" SET "Grade" = ? WHERE rowid = ?', (next_grade, row["rowid"]))
        conn.commit()
    except Exception:
        conn.rollback()
    finally:
        conn.close()

def get_user_by_username(username: str) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM _app_users WHERE username = ?", (username,))
    row = cursor.fetchone()
    conn.close()
    if row:
        return dict(row)
    return None

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return hash_password(plain_password) == hashed_password

def get_all_tables() -> List[Dict[str, Any]]:
    """List all user tables in SQLite excluding system tables."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_app_%'
        ORDER BY name
    """)
    rows = cursor.fetchall()
    
    tables_info = []
    for r in rows:
        tbl_name = r['name']
        cursor.execute(f'SELECT COUNT(*) as count FROM "{tbl_name}"')
        row_count = cursor.fetchone()['count']
        tables_info.append({
            "name": tbl_name,
            "row_count": row_count
        })
    
    conn.close()
    return tables_info

def get_table_schema(table_name: str) -> List[Dict[str, Any]]:
    """Get PRAGMA table_info for a specific table."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(f'PRAGMA table_info("{table_name}")')
    columns = cursor.fetchall()
    conn.close()
    
    return [
        {
            "cid": c["cid"],
            "name": c["name"],
            "type": c["type"],
            "notnull": c["notnull"],
            "dflt_value": c["dflt_value"],
            "pk": c["pk"]
        }
        for c in columns
    ]

def fetch_table_data(
    table_name: str,
    page: int = 1,
    limit: int = 30,
    search_query: Optional[str] = None
) -> Tuple[List[Dict[str, Any]], int]:
    """Fetch paginated rows from table with optional global search across text columns."""
    conn = get_db_connection()
    cursor = conn.cursor()

    schema = get_table_schema(table_name)
    col_names = [col['name'] for col in schema]
    
    where_clause = ""
    params = []

    if search_query and search_query.strip():
        search_pattern = f"%{search_query.strip()}%"
        conditions = [f'"{col}" LIKE ?' for col in col_names]
        where_clause = " WHERE " + " OR ".join(conditions)
        params = [search_pattern] * len(col_names)

    # Get total count
    count_query = f'SELECT COUNT(*) as total FROM "{table_name}"{where_clause}'
    cursor.execute(count_query, params)
    total_count = cursor.fetchone()['total']

    # Get paginated data
    offset = (page - 1) * limit
    data_query = f'SELECT * FROM "{table_name}"{where_clause} LIMIT {limit} OFFSET {offset}'
    cursor.execute(data_query, params)
    rows = cursor.fetchall()
    
    conn.close()

    result_rows = [dict(r) for r in rows]
    return result_rows, total_count

def fetch_all_table_data_for_export(table_name: str, search_query: Optional[str] = None) -> List[Dict[str, Any]]:
    """Fetch all rows from table without pagination for CSV Export."""
    conn = get_db_connection()
    cursor = conn.cursor()

    schema = get_table_schema(table_name)
    col_names = [col['name'] for col in schema]
    
    where_clause = ""
    params = []

    if search_query and search_query.strip():
        search_pattern = f"%{search_query.strip()}%"
        conditions = [f'"{col}" LIKE ?' for col in col_names]
        where_clause = " WHERE " + " OR ".join(conditions)
        params = [search_pattern] * len(col_names)

    data_query = f'SELECT * FROM "{table_name}"{where_clause}'
    cursor.execute(data_query, params)
    rows = cursor.fetchall()
    conn.close()

    return [dict(r) for r in rows]

def insert_table_row(table_name: str, row_data: Dict[str, Any]) -> Dict[str, Any]:
    conn = get_db_connection()
    cursor = conn.cursor()
    
    columns = list(row_data.keys())
    placeholders = ", ".join(["?"] * len(columns))
    col_str = ", ".join([f'"{c}"' for c in columns])
    values = [row_data[c] for c in columns]
    
    query = f'INSERT INTO "{table_name}" ({col_str}) VALUES ({placeholders})'
    cursor.execute(query, values)
    conn.commit()
    inserted_id = cursor.lastrowid
    conn.close()
    
    return {"status": "success", "id": inserted_id}

def update_table_row(table_name: str, pk_col: str, pk_val: Any, row_data: Dict[str, Any]) -> Dict[str, Any]:
    conn = get_db_connection()
    cursor = conn.cursor()
    
    columns = [c for c in row_data.keys() if c != pk_col]
    set_str = ", ".join([f'"{c}" = ?' for c in columns])
    values = [row_data[c] for c in columns] + [pk_val]
    
    query = f'UPDATE "{table_name}" SET {set_str} WHERE "{pk_col}" = ?'
    cursor.execute(query, values)
    conn.commit()
    conn.close()
    
    return {"status": "success", "updated_rows": cursor.rowcount}

def delete_table_row(table_name: str, pk_col: str, pk_val: Any) -> Dict[str, Any]:
    conn = get_db_connection()
    cursor = conn.cursor()
    
    query = f'DELETE FROM "{table_name}" WHERE "{pk_col}" = ?'
    cursor.execute(query, (pk_val,))
    conn.commit()
    conn.close()
    
    return {"status": "success", "deleted_rows": cursor.rowcount}

def batch_delete_table_rows(table_name: str, pk_col: str, pk_vals: List[Any]) -> Dict[str, Any]:
    """Batch delete multiple rows by primary key values."""
    if not pk_vals:
        return {"status": "success", "deleted_rows": 0}

    conn = get_db_connection()
    cursor = conn.cursor()
    
    placeholders = ", ".join(["?"] * len(pk_vals))
    query = f'DELETE FROM "{table_name}" WHERE "{pk_col}" IN ({placeholders})'
    cursor.execute(query, pk_vals)
    conn.commit()
    deleted_count = cursor.rowcount
    conn.close()
    
    return {"status": "success", "deleted_rows": deleted_count}

def execute_raw_sql(sql_query: str) -> Dict[str, Any]:
    """Execute raw SQL query for Admin and return headers and rows or affected rows."""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cleaned_sql = sql_query.strip()
    is_select = cleaned_sql.upper().startswith("SELECT") or cleaned_sql.upper().startswith("PRAGMA") or cleaned_sql.upper().startswith("EXPLAIN")

    try:
        cursor.execute(cleaned_sql)
        if is_select:
            columns = [description[0] for description in cursor.description] if cursor.description else []
            rows = cursor.fetchall()
            result_rows = [dict(r) for r in rows]
            conn.close()
            return {
                "status": "success",
                "is_select": True,
                "columns": columns,
                "rows": result_rows,
                "total_count": len(result_rows)
            }
        else:
            conn.commit()
            affected = cursor.rowcount
            conn.close()
            return {
                "status": "success",
                "is_select": False,
                "affected_rows": affected,
                "message": f"쿼리가 성공적으로 실행되었습니다. (영향을 받은 행: {affected}개)"
            }
    except Exception as e:
        conn.close()
        raise Exception(f"SQL 실행 오류: {str(e)}")

# --- 사용자 계정 관리 함수 ---

def list_all_users() -> List[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, username, role, created_at FROM _app_users ORDER BY id ASC")
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

def get_user_by_id(user_id: int) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM _app_users WHERE id = ?", (user_id,))
    row = cursor.fetchone()
    conn.close()
    if row:
        return dict(row)
    return None

def create_user(username: str, password: str, role: str) -> Dict[str, Any]:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "INSERT INTO _app_users (username, password_hash, role) VALUES (?, ?, ?)",
            (username, hash_password(password), role)
        )
        conn.commit()
        inserted_id = cursor.lastrowid
        return {"status": "success", "id": inserted_id}
    except sqlite3.IntegrityError:
        raise ValueError(f"이미 사용 중인 아이디입니다: {username}")
    finally:
        conn.close()

def update_user_password(user_id: int, new_password: str) -> int:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE _app_users SET password_hash = ? WHERE id = ?",
        (hash_password(new_password), user_id)
    )
    conn.commit()
    rowcount = cursor.rowcount
    conn.close()
    return rowcount

def update_user_role(user_id: int, new_role: str) -> int:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE _app_users SET role = ? WHERE id = ?",
        (new_role, user_id)
    )
    conn.commit()
    rowcount = cursor.rowcount
    conn.close()
    return rowcount

def delete_user(user_id: int) -> int:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM _app_users WHERE id = ?", (user_id,))
    conn.commit()
    rowcount = cursor.rowcount
    conn.close()
    return rowcount


# --- 수업(Classes) 관리 함수 ---

def create_class(class_data: Dict[str, Any]) -> Dict[str, Any]:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        'INSERT INTO "Classes" ("ClassName", "TeacherUsername", "DayOfWeek", "StartTime", "CreatedBy") VALUES (?, ?, ?, ?, ?)',
        (class_data.get("ClassName", ""), class_data.get("TeacherUsername", ""),
         class_data.get("DayOfWeek", ""), class_data.get("StartTime", "") or "",
         class_data.get("CreatedBy", ""))
    )
    conn.commit()
    inserted_id = cursor.lastrowid
    conn.close()
    return {"status": "success", "id": inserted_id}

def update_class(class_id: int, class_data: Dict[str, Any]) -> Dict[str, Any]:
    conn = get_db_connection()
    cursor = conn.cursor()
    fields = []
    values = []
    for k, v in class_data.items():
        if k in ("ClassName", "TeacherUsername", "DayOfWeek", "StartTime", "IsEnded", "UpdatedBy", "UpdatedAt"):
            fields.append(f'"{k}" = ?')
            values.append(v)
    if not fields:
        conn.close()
        return {"status": "success", "updated_rows": 0}
    values.append(class_id)
    sql = f'UPDATE "Classes" SET {", ".join(fields)} WHERE "Id" = ?'
    cursor.execute(sql, values)
    conn.commit()
    rowcount = cursor.rowcount
    conn.close()
    return {"status": "success", "updated_rows": rowcount}

def delete_class(class_id: int) -> int:
    """수업과 연결된 수업-학생 관계까지 함께 삭제한다."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('DELETE FROM "ClassStudents" WHERE "ClassId" = ?', (class_id,))
    cursor.execute('DELETE FROM "Classes" WHERE "Id" = ?', (class_id,))
    conn.commit()
    rowcount = cursor.rowcount
    conn.close()
    return rowcount

def get_class_by_id(class_id: int) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM "Classes" WHERE "Id" = ?', (class_id,))
    row = cursor.fetchone()
    conn.close()
    if row:
        return dict(row)
    return None

def search_classes(
    q: Optional[str] = None,
    page: int = 1,
    limit: int = 30,
    teacher_username: Optional[str] = None
) -> Tuple[List[Dict[str, Any]], int]:
    """수업 목록을 검색한다. teacher_username이 주어지면 해당 선생님 수업만 필터링."""
    conn = get_db_connection()
    cursor = conn.cursor()

    conditions = []
    params = []

    if q and q.strip():
        pattern = f"%{q.strip()}%"
        conditions.append('(c."ClassName" LIKE ? OR c."TeacherUsername" LIKE ?)')
        params.extend([pattern, pattern])

    if teacher_username:
        conditions.append('c."TeacherUsername" = ?')
        params.append(teacher_username)

    where_str = ""
    if conditions:
        where_str = " WHERE " + " AND ".join(conditions)

    count_query = f'SELECT COUNT(*) as total FROM "Classes" c{where_str}'
    cursor.execute(count_query, params)
    total_count = cursor.fetchone()['total']

    offset = (page - 1) * limit
    data_query = f'''
        SELECT c."Id", c."ClassName", c."TeacherUsername", c."DayOfWeek", c."StartTime", c."CreatedAt",
               (SELECT COUNT(*) FROM "ClassStudents" cs WHERE cs."ClassId" = c."Id") AS StudentCount
        FROM "Classes" c
        {where_str}
        ORDER BY c."Id" DESC LIMIT {limit} OFFSET {offset}
    '''
    cursor.execute(data_query, params)
    rows = cursor.fetchall()
    conn.close()

    return [dict(r) for r in rows], total_count

def set_class_students(class_id: int, student_items: List) -> None:
    """수업의 학생 배정을 전체 교체한다 (기존 관계 삭제 후 재삽입).

    student_items: student_id(int) 또는 {"StudentId": int, "IsSpecial": 0|1} 딕셔너리 목록.
    IsSpecial은 해당 학생의 이 수업이 특강인지 여부 (기본 0=일반 수업).
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('DELETE FROM "ClassStudents" WHERE "ClassId" = ?', (class_id,))
    for item in student_items:
        if isinstance(item, dict):
            sid = item["StudentId"]
            is_special = 1 if item.get("IsSpecial") else 0
        else:
            sid = item
            is_special = 0
        cursor.execute(
            'INSERT OR IGNORE INTO "ClassStudents" ("ClassId", "StudentId", "IsSpecial") VALUES (?, ?, ?)',
            (class_id, sid, is_special)
        )
    conn.commit()
    conn.close()

def get_class_students(class_id: int) -> List[Dict[str, Any]]:
    """수업에 배정된 학생 목록을 이름 순으로 반환한다. (IsSpecial: 해당 학생의 이 수업 특강 여부)"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT s.rowid AS row_id, s.*, cs."IsSpecial" AS IsSpecial
        FROM "ClassStudents" cs
        JOIN "Students" s ON cs."StudentId" = s.rowid OR cs."StudentId" = s."Id"
        WHERE cs."ClassId" = ?
        ORDER BY s."Name" ASC
    ''', (class_id,))
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

def get_class_student_ids(class_id: int) -> List[int]:
    """수업에 배정된 학생의 rowid 목록을 반환한다 (권한 검증용)."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT "StudentId" FROM "ClassStudents" WHERE "ClassId" = ?', (class_id,))
    rows = cursor.fetchall()
    conn.close()
    return [r["StudentId"] for r in rows]

def get_teacher_options() -> List[Dict[str, Any]]:
    """수업 담당 선생님으로 지정 가능한 계정(teacher/manager) 목록을 반환한다."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT id, username, role FROM _app_users WHERE role IN ('teacher', 'manager') ORDER BY username ASC"
    )
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]


# --- 감사 추적(Audit Trail) 함수 ---

def write_audit_log(
    table_name: str,
    record_id: Any,
    action: str,
    old_data: Optional[Dict[str, Any]],
    new_data: Optional[Dict[str, Any]],
    changed_fields: Optional[List[str]],
    username: str,
    user_role: str,
    ip_address: str = ""
) -> None:
    """감사 로그를 기록한다.
    
    Args:
        table_name: 테이블 이름
        record_id: 레코드 ID (rowid 또는 Id)
        action: 작업 유형 ('INSERT', 'UPDATE', 'DELETE')
        old_data: 변경 전 데이터 (딕셔너리 또는 None)
        new_data: 변경 후 데이터 (딕셔너리 또는 None)
        changed_fields: 변경된 필드 목록 (리스트 또는 None)
        username: 작업 수행자 사용자명
        user_role: 작업 수행자 역할
        ip_address: 요청 IP 주소 (기본값: '')
    """
    if action not in ('INSERT', 'UPDATE', 'DELETE'):
        raise ValueError(f"유효하지 않은 작업: {action}")
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    old_data_json = json.dumps(old_data, ensure_ascii=False) if old_data else None
    new_data_json = json.dumps(new_data, ensure_ascii=False) if new_data else None
    changed_fields_json = json.dumps(changed_fields, ensure_ascii=False) if changed_fields else None
    
    cursor.execute("""
        INSERT INTO _app_audit_logs (table_name, record_id, action, old_data, new_data, changed_fields, username, user_role, ip_address)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (table_name, str(record_id), action, old_data_json, new_data_json, changed_fields_json, username, user_role, ip_address))
    
    conn.commit()
    conn.close()


def get_record_snapshot(table_name: str, record_id: Any) -> Optional[Dict[str, Any]]:
    """테이블에서 레코드의 현재 스냅샷을 조회한다.
    
    Args:
        table_name: 테이블 이름
        record_id: 레코드 ID (rowid 또는 Id)
    
    Returns:
        레코드 데이터 딕셔너리 또는 None
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute(
            f'SELECT * FROM "{table_name}" WHERE rowid = ? OR "Id" = ?',
            (record_id, record_id)
        )
        row = cursor.fetchone()
        if row:
            return dict(row)
        return None
    finally:
        conn.close()


def get_audit_logs(
    table_name: Optional[str] = None,
    record_id: Optional[str] = None,
    username: Optional[str] = None,
    action: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    page: int = 1,
    limit: int = 30
) -> Tuple[List[Dict[str, Any]], int]:
    """감사 로그를 조회한다.
    
    Args:
        table_name: 테이블 이름 필터 (선택사항)
        record_id: 레코드 ID 필터 (선택사항)
        username: 사용자명 필터 (선택사항)
        action: 작업 유형 필터 (선택사항, 쉼표 구분 문자열 또는 단일 값)
        date_from: 시작 날짜 필터 (YYYY-MM-DD 형식)
        date_to: 종료 날짜 필터 (YYYY-MM-DD 형식)
        page: 페이지 번호 (1부터 시작)
        limit: 페이지당 행 수 (최대 100)
    
    Returns:
        (로그 행 리스트, 전체 행 수) 튜플
    """
    limit = min(limit, 100)
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    conditions = []
    params = []
    
    if table_name:
        conditions.append("table_name = ?")
        params.append(table_name)
    
    if record_id:
        conditions.append("record_id = ?")
        params.append(record_id)
    
    if username:
        conditions.append("username = ?")
        params.append(username)
    
    if action:
        if isinstance(action, str):
            action_list = [a.strip() for a in action.split(",")]
        else:
            action_list = [action]
        
        placeholders = ", ".join(["?"] * len(action_list))
        conditions.append(f"action IN ({placeholders})")
        params.extend(action_list)
    
    if date_from:
        conditions.append("created_at >= ?")
        params.append(date_from)
    
    if date_to:
        conditions.append("created_at <= ?")
        params.append(date_to + " 23:59:59")
    
    where_clause = ""
    if conditions:
        where_clause = " WHERE " + " AND ".join(conditions)
    
    # 전체 행 수 조회
    count_query = f"SELECT COUNT(*) as total FROM _app_audit_logs{where_clause}"
    cursor.execute(count_query, params)
    total_count = cursor.fetchone()['total']
    
    # 페이지네이션 조회
    offset = (page - 1) * limit
    data_query = f"""
        SELECT * FROM _app_audit_logs{where_clause}
        ORDER BY id DESC
        LIMIT {limit} OFFSET {offset}
    """
    cursor.execute(data_query, params)
    rows = cursor.fetchall()
    conn.close()
    
    return [dict(r) for r in rows], total_count


def get_audit_username_options() -> List[Dict[str, str]]:
    """감사 로그 필터용 계정 목록을 반환한다.
    감사 로그에 기록된 계정과 현재 존재하는 계정을 합쳐 중복 없이 정렬한다.
    (삭제된 계정도 과거 이력 조회를 위해 포함된다.)"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT username FROM _app_audit_logs UNION SELECT username FROM _app_users ORDER BY username"
    )
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]
