import sqlite3
import hashlib
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

    # Seed Manager User (관리 선생님) if not exists
    cursor.execute("SELECT id FROM _app_users WHERE username = ?", (settings.MANAGER_USERNAME,))
    if not cursor.fetchone():
        cursor.execute(
            "INSERT INTO _app_users (username, password_hash, role) VALUES (?, ?, ?)",
            (settings.MANAGER_USERNAME, hash_password(settings.MANAGER_PASSWORD), "manager")
        )

    # Seed Teacher User (선생님) if not exists
    cursor.execute("SELECT id FROM _app_users WHERE username = ?", (settings.TEACHER_USERNAME,))
    if not cursor.fetchone():
        cursor.execute(
            "INSERT INTO _app_users (username, password_hash, role) VALUES (?, ?, ?)",
            (settings.TEACHER_USERNAME, hash_password(settings.TEACHER_PASSWORD), "teacher")
        )

    conn.commit()
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
    limit: int = 20, 
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
