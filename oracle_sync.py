import os
import sqlite3
from typing import List, Dict, Any, Tuple
from pathlib import Path
from config import settings
from database import get_db_connection

def map_oracle_type_to_sqlite(data_type: str, data_precision: Any = None, data_scale: Any = None) -> str:
    """Map Oracle Data Types to SQLite storage classes."""
    dt = data_type.upper()
    if "NUMBER" in dt or "FLOAT" in dt or "DOUBLE" in dt:
        if data_scale is not None and data_scale > 0:
            return "REAL"
        return "INTEGER"
    elif "INT" in dt or "LONG" in dt:
        return "INTEGER"
    elif "DATE" in dt or "TIME" in dt or "TIMESTAMP" in dt:
        return "TEXT"
    elif "BLOB" in dt or "RAW" in dt:
        return "BLOB"
    else:
        # VARCHAR2, CHAR, CLOB, NVARCHAR2, etc.
        return "TEXT"

def run_oracle_migration() -> Dict[str, Any]:
    """
    Connects to Oracle Autonomous Database (ADB) using python-oracledb,
    reads all tables, columns, and data, and syncs them into SQLite.
    If Oracle connection parameters or wallet files are not configured/reachable,
    it creates sample demonstration tables to allow full testing.
    """
    oracle_user = settings.ORACLE_USER
    oracle_pass = settings.ORACLE_PASSWORD
    oracle_dsn = settings.ORACLE_DSN
    wallet_dir = Path(settings.ORACLE_WALLET_DIR).resolve()

    wallet_exists = wallet_dir.exists() and any(wallet_dir.glob("*.sso")) or any(wallet_dir.glob("*.ora"))

    # Attempt real Oracle connection if configured
    if oracle_user and oracle_pass and oracle_dsn and wallet_exists:
        try:
            import oracledb
            
            # Initialize oracledb connection in Thin mode with config_dir and wallet_location
            conn = oracledb.connect(
                user=oracle_user,
                password=oracle_pass,
                dsn=oracle_dsn,
                config_dir=str(wallet_dir),
                wallet_location=str(wallet_dir),
                wallet_password=settings.ORACLE_WALLET_PASSWORD if settings.ORACLE_WALLET_PASSWORD else None
            )
            
            cursor = conn.cursor()
            
            # 1. Fetch user tables
            cursor.execute("SELECT table_name FROM user_tables ORDER BY table_name")
            tables = [row[0] for row in cursor.fetchall()]

            sqlite_conn = get_db_connection()
            sqlite_cursor = sqlite_conn.cursor()

            # 0. Drop all existing user tables in SQLite (Clean Slate Migration)
            sqlite_cursor.execute("""
                SELECT name FROM sqlite_master 
                WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_app_%'
            """)
            existing_tables = [r['name'] for r in sqlite_cursor.fetchall()]
            for old_tbl in existing_tables:
                sqlite_cursor.execute(f'DROP TABLE IF EXISTS "{old_tbl}"')
            sqlite_conn.commit()

            total_migrated_tables = 0
            total_migrated_rows = 0
            table_details = []

            for tbl in tables:
                # Get columns
                cursor.execute("""
                    SELECT column_name, data_type, data_precision, data_scale, nullable 
                    FROM user_tab_columns 
                    WHERE table_name = :1 
                    ORDER BY column_id
                """, [tbl])
                cols_meta = cursor.fetchall()

                # Get primary keys
                cursor.execute("""
                    SELECT cols.column_name
                    FROM user_constraints cons
                    JOIN user_cons_columns cols ON cons.constraint_name = cols.constraint_name
                    WHERE cons.constraint_type = 'P' AND cons.table_name = :1
                """, [tbl])
                pk_cols = [r[0] for r in cursor.fetchall()]

                # Build SQLite CREATE TABLE statement
                col_defs = []
                col_names = []
                for cname, dtype, dprec, dscale, nullable in cols_meta:
                    col_names.append(cname)
                    sq_type = map_oracle_type_to_sqlite(dtype, dprec, dscale)
                    is_pk = " PRIMARY KEY" if cname in pk_cols and len(pk_cols) == 1 else ""
                    is_null = " NOT NULL" if nullable == 'N' else ""
                    col_defs.append(f'"{cname}" {sq_type}{is_pk}{is_null}')

                create_stmt = f'DROP TABLE IF EXISTS "{tbl}"; CREATE TABLE "{tbl}" ({", ".join(col_defs)});'
                sqlite_cursor.executescript(create_stmt)

                # Fetch rows from Oracle
                escaped_cols = [f'"{c}"' for c in col_names]
                select_sql = f'SELECT {", ".join(escaped_cols)} FROM "{tbl}"'
                cursor.execute(select_sql)
                rows = cursor.fetchall()

                # Convert date/time objects to ISO strings for SQLite
                processed_rows = []
                for r in rows:
                    p_row = []
                    for val in r:
                        if hasattr(val, 'isoformat'):
                            p_row.append(val.isoformat())
                        elif hasattr(val, 'read'): # LOB objects
                            p_row.append(val.read())
                        else:
                            p_row.append(val)
                    processed_rows.append(p_row)

                # Insert into SQLite
                if processed_rows:
                    placeholders = ", ".join(["?"] * len(col_names))
                    insert_sql = f'INSERT INTO "{tbl}" ({", ".join(escaped_cols)}) VALUES ({placeholders})'
                    sqlite_cursor.executemany(insert_sql, processed_rows)

                total_migrated_tables += 1
                total_migrated_rows += len(processed_rows)
                table_details.append({"table_name": tbl, "row_count": len(processed_rows)})

            sqlite_conn.commit()
            sqlite_conn.close()
            cursor.close()
            conn.close()

            return {
                "status": "success",
                "mode": "Oracle ADB Live Migration",
                "migrated_tables_count": total_migrated_tables,
                "migrated_rows_count": total_migrated_rows,
                "tables": table_details
            }

        except Exception as e:
            # Fallback to demo tables if Oracle connection fails or wallet missing
            res = seed_sample_demo_tables()
            res["notice"] = f"Oracle ADB 접속 불가로 샘플 테이블 마이그레이션이 실행되었습니다: {str(e)}"
            return res

    else:
        # Fallback / Sample Demo Migration Mode
        return seed_sample_demo_tables()

def seed_sample_demo_tables() -> Dict[str, Any]:
    """Generates sample tables simulating an Oracle ADB schema for testing purposes."""
    sqlite_conn = get_db_connection()
    sqlite_cursor = sqlite_conn.cursor()

    # Sample Table 1: EMPLOYEES
    sqlite_cursor.executescript("""
        DROP TABLE IF EXISTS EMPLOYEES;
        CREATE TABLE EMPLOYEES (
            EMPLOYEE_ID INTEGER PRIMARY KEY,
            FIRST_NAME TEXT NOT NULL,
            LAST_NAME TEXT NOT NULL,
            EMAIL TEXT UNIQUE,
            HIRE_DATE TEXT,
            JOB_ID TEXT,
            SALARY REAL,
            DEPARTMENT_NAME TEXT
        );

        INSERT INTO EMPLOYEES (EMPLOYEE_ID, FIRST_NAME, LAST_NAME, EMAIL, HIRE_DATE, JOB_ID, SALARY, DEPARTMENT_NAME) VALUES
        (101, 'Steven', 'King', 'sking@oracle.com', '2021-06-17', 'AD_PRES', 24000.0, 'Executive'),
        (102, 'Neena', 'Kochhar', 'nkochhar@oracle.com', '2022-09-21', 'AD_VP', 17000.0, 'Executive'),
        (103, 'Lex', 'De Haan', 'ldehaan@oracle.com', '2023-01-13', 'AD_VP', 17000.0, 'Executive'),
        (104, 'Alexander', 'Hunold', 'ahunold@oracle.com', '2023-05-20', 'IT_PROG', 9000.0, 'IT'),
        (105, 'Bruce', 'Ernst', 'bernst@oracle.com', '2024-02-15', 'IT_PROG', 6000.0, 'IT');

        DROP TABLE IF EXISTS PRODUCTS;
        CREATE TABLE PRODUCTS (
            PRODUCT_ID INTEGER PRIMARY KEY AUTOINCREMENT,
            PRODUCT_NAME TEXT NOT NULL,
            CATEGORY TEXT,
            UNIT_PRICE REAL,
            STOCK_QUANTITY INTEGER,
            STATUS TEXT
        );

        INSERT INTO PRODUCTS (PRODUCT_NAME, CATEGORY, UNIT_PRICE, STOCK_QUANTITY, STATUS) VALUES
        ('Oracle Database 23c Enterprise', 'Software', 47500.0, 50, 'Available'),
        ('Autonomous Data Warehouse Node', 'Cloud Service', 2.50, 1000, 'Active'),
        ('OCI Bare Metal Instance', 'Hardware', 12500.0, 15, 'Available'),
        ('Oracle Linux Premier Support', 'Service', 1499.0, 200, 'Active');

        DROP TABLE IF EXISTS SYSTEM_LOGS;
        CREATE TABLE SYSTEM_LOGS (
            LOG_ID INTEGER PRIMARY KEY AUTOINCREMENT,
            EVENT_TYPE TEXT,
            LOG_LEVEL TEXT,
            MESSAGE TEXT,
            CREATED_AT TEXT
        );

        INSERT INTO SYSTEM_LOGS (EVENT_TYPE, LOG_LEVEL, MESSAGE, CREATED_AT) VALUES
        ('ORACLE_SYNC', 'INFO', 'Initial database sync completed successfully from Oracle ADB', '2026-08-02 10:00:00'),
        ('USER_LOGIN', 'INFO', 'User admin logged in from 127.0.0.1', '2026-08-02 10:15:30');
    """)

    sqlite_conn.commit()
    sqlite_conn.close()

    return {
        "status": "success",
        "mode": "Demo/Sample Table Migration Mode (.env 내 Oracle 설정 필요)",
        "migrated_tables_count": 3,
        "migrated_rows_count": 11,
        "tables": [
            {"table_name": "EMPLOYEES", "row_count": 5},
            {"table_name": "PRODUCTS", "row_count": 4},
            {"table_name": "SYSTEM_LOGS", "row_count": 2}
        ]
    }

if __name__ == "__main__":
    result = run_oracle_migration()
    print("Migration Result:", result)
