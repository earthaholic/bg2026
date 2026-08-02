import os
import io
import csv
from typing import Optional, Dict, Any, List
from fastapi import FastAPI, Depends, HTTPException, Query, Request, status
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse, StreamingResponse, JSONResponse
from pydantic import BaseModel

from config import settings
from database import (
    init_system_tables,
    get_user_by_username,
    verify_password,
    get_all_tables,
    get_table_schema,
    fetch_table_data,
    fetch_all_table_data_for_export,
    insert_table_row,
    update_table_row,
    delete_table_row,
    batch_delete_table_rows,
    execute_raw_sql,
    get_db_connection
)
from auth import create_access_token, get_current_user, get_current_admin

app = FastAPI(
    title="bg2026 - 꿈꾸는봄결 데이터 관리 시스템",
    version="2.0.0"
)

# Mount static & template files
base_dir = os.path.dirname(os.path.abspath(__file__))
static_dir = os.path.join(base_dir, "static")
templates_dir = os.path.join(base_dir, "templates")

os.makedirs(static_dir, exist_ok=True)
os.makedirs(os.path.join(static_dir, "css"), exist_ok=True)
os.makedirs(os.path.join(static_dir, "js"), exist_ok=True)
os.makedirs(templates_dir, exist_ok=True)

app.mount("/static", StaticFiles(directory=static_dir), name="static")
templates = Jinja2Templates(directory=templates_dir)

# Initialize System DB Tables on Startup
@app.on_event("startup")
def on_startup():
    init_system_tables()

# Pydantic Schemas



class LoginRequest(BaseModel):
    username: str
    password: str

class RowDataRequest(BaseModel):
    data: Dict[str, Any]

class RowUpdateRequest(BaseModel):
    pk_col: str
    pk_val: Any
    data: Dict[str, Any]

class RowDeleteRequest(BaseModel):
    pk_col: str
    pk_val: Any

class BatchDeleteRequest(BaseModel):
    pk_col: str
    pk_vals: List[Any]

class SQLExecuteRequest(BaseModel):
    query: str

class UserBookRegisterRequest(BaseModel):
    Title: str
    Author: Optional[str] = ""
    Publisher: Optional[str] = ""
    Subject: Optional[str] = ""
    Target: Optional[str] = ""
    BookLength: Optional[int] = 0
    Voca: Optional[int] = 0
    Metaphor: Optional[int] = 0
    HasQuiz: Optional[int] = 0
    HasReadingQuestion: Optional[int] = 0
    HasReadingAnswer: Optional[int] = 0
    HasWritingQuestion: Optional[int] = 0
    HasWritingAnswer: Optional[int] = 0
    HasAdvancedMaterial: Optional[int] = 0
    HasDebateMaterial: Optional[int] = 0
    IsPaperbookExist: Optional[int] = 0
    IsPdfExist: Optional[int] = 0
    IsYes24Exist: Optional[int] = 0
    IsMillieExist: Optional[int] = 0
    Desc: Optional[str] = ""

class UserStudentRegisterRequest(BaseModel):
    Name: str
    Sex: Optional[str] = ""
    Birthday: Optional[str] = "1970-01-01"
    Description: Optional[str] = ""

class UserStudyLogRegisterRequest(BaseModel):
    StudentId: int
    BookId: int
    StudiedDay: str

# --- Web UI Route ---

@app.get("/", response_class=HTMLResponse)
def index_page(request: Request):
    return templates.TemplateResponse(request=request, name="index.html")




# --- Authentication APIs ---
@app.post("/api/auth/login")
def login(payload: LoginRequest):
    user = get_user_by_username(payload.username)
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="아이디 또는 비밀번호가 올바르지 않습니다."
        )
    
    token = create_access_token(data={"sub": user["username"], "role": user["role"]})
    return {
        "access_token": token,
        "token_type": "bearer",
        "username": user["username"],
        "role": user["role"]
    }

@app.get("/api/auth/me")
def get_me(current_user: Dict[str, Any] = Depends(get_current_user)):
    return {
        "username": current_user["username"],
        "role": current_user["role"]
    }

# --- User Book Registration & Search APIs ---
@app.post("/api/user/books")
def user_register_book(
    payload: UserBookRegisterRequest,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    if not payload.Title or not payload.Title.strip():
        raise HTTPException(status_code=400, detail="도서명(Title)은 필수 입력 항목입니다.")

    book_data = payload.dict()
    book_data["Title"] = book_data["Title"].strip()

    try:
        res = insert_table_row("Books", book_data)
        return {
            "status": "success",
            "message": f"'{payload.Title}' 도서가 성공적으로 등록되었습니다.",
            "book_id": res.get("id")
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"도서 등록 중 오류가 발생했습니다: {str(e)}")

@app.get("/api/user/recent-books")
def user_get_recent_books(current_user: Dict[str, Any] = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT rowid as row_id, * FROM "Books" ORDER BY rowid DESC LIMIT 5')
    rows = cursor.fetchall()
    conn.close()
    return {"books": [dict(r) for r in rows]}

@app.get("/api/user/books/search")
def user_search_books(
    q: Optional[str] = Query(None),
    target: Optional[str] = Query(None),
    voca_min: Optional[int] = Query(None),
    length_min: Optional[int] = Query(None),
    has_quiz: Optional[int] = Query(None),
    has_reading: Optional[int] = Query(None),
    has_writing: Optional[int] = Query(None),
    has_pdf: Optional[int] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(12, ge=1, le=50),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    conn = get_db_connection()
    cursor = conn.cursor()

    conditions = []
    params = []

    if q and q.strip():
        search_pattern = f"%{q.strip()}%"
        conditions.append('("Title" LIKE ? OR "Author" LIKE ? OR "Publisher" LIKE ? OR "Subject" LIKE ? OR "Desc" LIKE ?)')
        params.extend([search_pattern] * 5)

    if target and target.strip():
        conditions.append('"Target" LIKE ?')
        params.append(f"%{target.strip()}%")

    if voca_min is not None and voca_min > 0:
        conditions.append('"Voca" >= ?')
        params.append(voca_min)

    if length_min is not None and length_min > 0:
        conditions.append('"BookLength" >= ?')
        params.append(length_min)

    if has_quiz == 1:
        conditions.append('"HasQuiz" = 1')

    if has_reading == 1:
        conditions.append('("HasReadingQuestion" = 1 OR "HasReadingAnswer" = 1)')

    if has_writing == 1:
        conditions.append('("HasWritingQuestion" = 1 OR "HasWritingAnswer" = 1)')

    if has_pdf == 1:
        conditions.append('"IsPdfExist" = 1')

    where_str = ""
    if conditions:
        where_str = " WHERE " + " AND ".join(conditions)

    # Count total
    count_query = f'SELECT COUNT(*) as total FROM "Books"{where_str}'
    cursor.execute(count_query, params)
    total_count = cursor.fetchone()['total']

    # Paginated data
    offset = (page - 1) * limit
    data_query = f'SELECT rowid as row_id, * FROM "Books"{where_str} ORDER BY rowid DESC LIMIT {limit} OFFSET {offset}'
    cursor.execute(data_query, params)
    rows = cursor.fetchall()
    conn.close()

    total_pages = (total_count + limit - 1) // limit if total_count > 0 else 1

    return {
        "page": page,
        "limit": limit,
        "total_count": total_count,
        "total_pages": total_pages,
        "books": [dict(r) for r in rows]
    }

@app.get("/api/user/books/{book_id}")
def user_get_book_detail(
    book_id: int,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT rowid as row_id, * FROM "Books" WHERE rowid = ? OR "Id" = ?', (book_id, book_id))
    row = cursor.fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="해당 도서를 찾을 수 없습니다.")
    return {"book": dict(row)}

# --- User Student Registration & Search APIs ---
@app.post("/api/user/students")
def user_register_student(
    payload: UserStudentRegisterRequest,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    if not payload.Name or not payload.Name.strip():
        raise HTTPException(status_code=400, detail="학생 이름(Name)은 필수 입력 항목입니다.")

    student_data = payload.dict()
    student_data["Name"] = student_data["Name"].strip()
    student_data["Birthday"] = (student_data.get("Birthday") or "").strip()
    if not student_data["Birthday"]:
        student_data["Birthday"] = "1970-01-01"
        
    student_data["Sex"] = (student_data["Sex"] or "").strip()
    student_data["Description"] = (student_data["Description"] or "").strip()

    try:
        res = insert_table_row("Students", student_data)
        return {
            "status": "success",
            "message": f"'{payload.Name}' 학생이 성공적으로 등록되었습니다.",
            "student_id": res.get("id")
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"학생 등록 중 오류가 발생했습니다: {str(e)}")

@app.get("/api/user/recent-students")
def user_get_recent_students(current_user: Dict[str, Any] = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT rowid as row_id, * FROM "Students" ORDER BY rowid DESC LIMIT 5')
    rows = cursor.fetchall()
    conn.close()
    return {"students": [dict(r) for r in rows]}

@app.get("/api/user/students/search")
def user_search_students(
    q: Optional[str] = Query(None),
    sex: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(12, ge=1, le=50),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    conn = get_db_connection()
    cursor = conn.cursor()

    conditions = []
    params = []

    if q and q.strip():
        search_pattern = f"%{q.strip()}%"
        conditions.append('("Name" LIKE ? OR "Birthday" LIKE ? OR "Description" LIKE ?)')
        params.extend([search_pattern] * 3)

    if sex and sex.strip():
        s_val = sex.strip().upper()
        if s_val in ('남', '남성', 'M', 'MALE'):
            conditions.append('("Sex" = \'남\' OR "Sex" = \'남성\' OR "Sex" = \'M\' OR "Sex" = \'MALE\')')
        elif s_val in ('여', '여성', 'F', 'FEMALE'):
            conditions.append('("Sex" = \'여\' OR "Sex" = \'여성\' OR "Sex" = \'F\' OR "Sex" = \'FEMALE\')')
        else:
            conditions.append('"Sex" LIKE ?')
            params.append(f"%{sex.strip()}%")

    where_str = ""
    if conditions:
        where_str = " WHERE " + " AND ".join(conditions)

    # Count total
    count_query = f'SELECT COUNT(*) as total FROM "Students"{where_str}'
    cursor.execute(count_query, params)
    total_count = cursor.fetchone()['total']

    # Paginated data
    offset = (page - 1) * limit
    data_query = f'SELECT rowid as row_id, * FROM "Students"{where_str} ORDER BY rowid DESC LIMIT {limit} OFFSET {offset}'
    cursor.execute(data_query, params)
    rows = cursor.fetchall()
    conn.close()

    total_pages = (total_count + limit - 1) // limit if total_count > 0 else 1

    return {
        "page": page,
        "limit": limit,
        "total_count": total_count,
        "total_pages": total_pages,
        "students": [dict(r) for r in rows]
    }

@app.get("/api/user/students/{student_id}")
def user_get_student_detail(
    student_id: int,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT rowid as row_id, * FROM "Students" WHERE rowid = ? OR "Id" = ?', (student_id, student_id))
    row = cursor.fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="해당 학생을 찾을 수 없습니다.")
    return {"student": dict(row)}

# --- Options List APIs for Forms ---
@app.get("/api/user/students-options")
def user_get_students_options(current_user: Dict[str, Any] = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT rowid as row_id, * FROM "Students" ORDER BY "Name" ASC')
    rows = cursor.fetchall()
    conn.close()
    return {"students": [dict(r) for r in rows]}

@app.get("/api/user/books-options")
def user_get_books_options(current_user: Dict[str, Any] = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT rowid as row_id, * FROM "Books" ORDER BY "Title" ASC')
    rows = cursor.fetchall()
    conn.close()
    return {"books": [dict(r) for r in rows]}

# --- Picker Modal Search APIs ---
@app.get("/api/user/picker/students")
def picker_search_students(
    q: Optional[str] = Query(None),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    conn = get_db_connection()
    cursor = conn.cursor()
    where_str = ""
    params = []
    if q and q.strip():
        pattern = f"%{q.strip()}%"
        where_str = ' WHERE ("Name" LIKE ? OR "Birthday" LIKE ? OR "Description" LIKE ?)'
        params = [pattern] * 3

    cursor.execute(f'SELECT rowid as row_id, * FROM "Students"{where_str} ORDER BY rowid DESC LIMIT 25', params)
    rows = cursor.fetchall()
    conn.close()
    return {"students": [dict(r) for r in rows]}

@app.get("/api/user/picker/books")
def picker_search_books(
    q: Optional[str] = Query(None),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    conn = get_db_connection()
    cursor = conn.cursor()
    where_str = ""
    params = []
    if q and q.strip():
        pattern = f"%{q.strip()}%"
        where_str = ' WHERE ("Title" LIKE ? OR "Author" LIKE ? OR "Publisher" LIKE ? OR "Subject" LIKE ?)'
        params = [pattern] * 4

    cursor.execute(f'SELECT rowid as row_id, * FROM "Books"{where_str} ORDER BY rowid DESC LIMIT 25', params)
    rows = cursor.fetchall()
    conn.close()
    return {"books": [dict(r) for r in rows]}

# --- User StudyLog Registration & Search APIs ---
@app.post("/api/user/studylogs")
def user_register_studylog(
    payload: UserStudyLogRegisterRequest,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    if not payload.StudentId or payload.StudentId <= 0:
        raise HTTPException(status_code=400, detail="학생을 선택해 주세요.")
    if not payload.BookId or payload.BookId <= 0:
        raise HTTPException(status_code=400, detail="도서를 선택해 주세요.")
    if not payload.StudiedDay or not payload.StudiedDay.strip():
        raise HTTPException(status_code=400, detail="학습 일자를 입력해 주세요.")

    log_data = {
        "StudentId": payload.StudentId,
        "BookId": payload.BookId,
        "StudiedDay": payload.StudiedDay.strip()
    }

    try:
        res = insert_table_row("StudyLogs", log_data)
        return {
            "status": "success",
            "message": "학습 기록이 성공적으로 수록되었습니다.",
            "log_id": res.get("id")
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"학습 기록 등록 중 오류가 발생했습니다: {str(e)}")

@app.get("/api/user/recent-studylogs")
def user_get_recent_studylogs(current_user: Dict[str, Any] = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    query = '''
        SELECT sl.rowid as row_id, sl.*, 
               s.Name as StudentName, s.Sex as StudentSex, s.Birthday as StudentBirthday,
               b.Title as BookTitle, b.Author as BookAuthor, b.Publisher as BookPublisher
        FROM "StudyLogs" sl
        LEFT JOIN "Students" s ON sl.StudentId = s.rowid OR sl.StudentId = s.Id
        LEFT JOIN "Books" b ON sl.BookId = b.rowid OR sl.BookId = b.Id
        ORDER BY sl.rowid DESC LIMIT 5
    '''
    cursor.execute(query)
    rows = cursor.fetchall()
    conn.close()
    return {"studylogs": [dict(r) for r in rows]}

@app.get("/api/user/studylogs/search")
def user_search_studylogs(
    q: Optional[str] = Query(None),
    studied_day: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(12, ge=1, le=50),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    conn = get_db_connection()
    cursor = conn.cursor()

    conditions = []
    params = []

    if q and q.strip():
        search_pattern = f"%{q.strip()}%"
        conditions.append('(s.Name LIKE ? OR b.Title LIKE ? OR b.Author LIKE ? OR b.Publisher LIKE ?)')
        params.extend([search_pattern] * 4)

    if studied_day and studied_day.strip():
        conditions.append('sl.StudiedDay LIKE ?')
        params.append(f"%{studied_day.strip()}%")

    where_str = ""
    if conditions:
        where_str = " WHERE " + " AND ".join(conditions)

    count_query = f'''
        SELECT COUNT(*) as total 
        FROM "StudyLogs" sl
        LEFT JOIN "Students" s ON sl.StudentId = s.rowid OR sl.StudentId = s.Id
        LEFT JOIN "Books" b ON sl.BookId = b.rowid OR sl.BookId = b.Id
        {where_str}
    '''
    cursor.execute(count_query, params)
    total_count = cursor.fetchone()['total']

    offset = (page - 1) * limit
    data_query = f'''
        SELECT sl.rowid as row_id, sl.*, 
               s.Name as StudentName, s.Sex as StudentSex, s.Birthday as StudentBirthday,
               b.Title as BookTitle, b.Author as BookAuthor, b.Publisher as BookPublisher, b.Subject as BookSubject
        FROM "StudyLogs" sl
        LEFT JOIN "Students" s ON sl.StudentId = s.rowid OR sl.StudentId = s.Id
        LEFT JOIN "Books" b ON sl.BookId = b.rowid OR sl.BookId = b.Id
        {where_str}
        ORDER BY sl.rowid DESC LIMIT {limit} OFFSET {offset}
    '''
    cursor.execute(data_query, params)
    rows = cursor.fetchall()
    conn.close()

    total_pages = (total_count + limit - 1) // limit if total_count > 0 else 1

    return {
        "page": page,
        "limit": limit,
        "total_count": total_count,
        "total_pages": total_pages,
        "studylogs": [dict(r) for r in rows]
    }

@app.get("/api/user/studylogs/{log_id}")
def user_get_studylog_detail(
    log_id: int,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    conn = get_db_connection()
    cursor = conn.cursor()
    query = '''
        SELECT sl.rowid as row_id, sl.*, 
               s.Name as StudentName, s.Sex as StudentSex, s.Birthday as StudentBirthday, s.Description as StudentDescription,
               b.Title as BookTitle, b.Author as BookAuthor, b.Publisher as BookPublisher, b.Subject as BookSubject, b.Target as BookTarget,
               b.BookLength, b.Voca, b.Metaphor, b.HasQuiz, b.HasReadingQuestion, b.HasReadingAnswer, b.HasWritingQuestion, b.HasWritingAnswer,
               b.HasAdvancedMaterial, b.HasDebateMaterial, b.IsPaperbookExist, b.IsPdfExist, b.IsYes24Exist, b.IsMillieExist, b.Desc as BookDesc
        FROM "StudyLogs" sl
        LEFT JOIN "Students" s ON sl.StudentId = s.rowid OR sl.StudentId = s.Id
        LEFT JOIN "Books" b ON sl.BookId = b.rowid OR sl.BookId = b.Id
        WHERE sl.rowid = ? OR sl.Id = ?
    '''
    cursor.execute(query, (log_id, log_id))
    row = cursor.fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="해당 학습 기록을 찾을 수 없습니다.")
    return {"studylog": dict(row)}

# --- Database & Table Metadata APIs (Admin Only) ---


@app.get("/api/tables")
def list_tables(current_user: Dict[str, Any] = Depends(get_current_user)):
    if current_user["role"] != "admin":
        return {"tables": []}
    tables = get_all_tables()
    return {"tables": tables}

@app.get("/api/tables/{table_name}/schema")
def table_schema(table_name: str, current_user: Dict[str, Any] = Depends(get_current_user)):
    schema = get_table_schema(table_name)
    if not schema:
        raise HTTPException(status_code=404, detail="테이블을 찾을 수 없습니다.")
    return {"table_name": table_name, "columns": schema}

@app.get("/api/tables/{table_name}/data")
def table_data(
    table_name: str,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    q: Optional[str] = Query(None),
    current_admin: Dict[str, Any] = Depends(get_current_admin)
):
    rows, total_count = fetch_table_data(table_name, page, limit, q)
    total_pages = (total_count + limit - 1) // limit if total_count > 0 else 1
    return {
        "table_name": table_name,
        "page": page,
        "limit": limit,
        "total_count": total_count,
        "total_pages": total_pages,
        "rows": rows
    }

# --- CSV Export for Table ---
@app.get("/api/tables/{table_name}/export-csv")
def export_table_csv(
    table_name: str,
    q: Optional[str] = Query(None),
    current_admin: Dict[str, Any] = Depends(get_current_admin)
):
    schema = get_table_schema(table_name)
    if not schema:
        raise HTTPException(status_code=404, detail="테이블을 찾을 수 없습니다.")
    
    col_names = [col['name'] for col in schema]
    rows = fetch_all_table_data_for_export(table_name, q)

    output = io.StringIO()
    # Add UTF-8 BOM for Excel compatibility
    output.write('\ufeff')
    writer = csv.writer(output)
    writer.writerow(col_names)
    for r in rows:
        writer.writerow([r.get(c, '') for c in col_names])
    
    output.seek(0)
    filename = f"{table_name}_export.csv"
    return StreamingResponse(
        io.BytesIO(output.getvalue().encode('utf-8')),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

# --- Data CRUD Operations (Admin only for C/U/D & Batch Delete) ---
@app.post("/api/tables/{table_name}/row")
def create_row(
    table_name: str,
    payload: RowDataRequest,
    current_admin: Dict[str, Any] = Depends(get_current_admin)
):
    try:
        res = insert_table_row(table_name, payload.data)
        return res
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"데이터 추가 실패: {str(e)}")

@app.put("/api/tables/{table_name}/row")
def update_row(
    table_name: str,
    payload: RowUpdateRequest,
    current_admin: Dict[str, Any] = Depends(get_current_admin)
):
    try:
        res = update_table_row(table_name, payload.pk_col, payload.pk_val, payload.data)
        return res
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"데이터 수정 실패: {str(e)}")

@app.delete("/api/tables/{table_name}/row")
def delete_row(
    table_name: str,
    payload: RowDeleteRequest,
    current_admin: Dict[str, Any] = Depends(get_current_admin)
):
    try:
        res = delete_table_row(table_name, payload.pk_col, payload.pk_val)
        return res
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"데이터 삭제 실패: {str(e)}")

@app.post("/api/tables/{table_name}/rows/batch-delete")
def batch_delete_rows(
    table_name: str,
    payload: BatchDeleteRequest,
    current_admin: Dict[str, Any] = Depends(get_current_admin)
):
    try:
        res = batch_delete_table_rows(table_name, payload.pk_col, payload.pk_vals)
        return res
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"다중 삭제 실패: {str(e)}")

# --- Admin Raw SQL Runner & CSV Export ---
@app.post("/api/admin/sql/execute")
def run_sql(
    payload: SQLExecuteRequest,
    current_admin: Dict[str, Any] = Depends(get_current_admin)
):
    try:
        res = execute_raw_sql(payload.query)
        return res
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/admin/sql/export-csv")
def export_sql_csv(
    payload: SQLExecuteRequest,
    current_admin: Dict[str, Any] = Depends(get_current_admin)
):
    try:
        res = execute_raw_sql(payload.query)
        if not res.get("is_select"):
            raise HTTPException(status_code=400, detail="SELECT 쿼리만 CSV로 내보낼 수 있습니다.")
        
        columns = res.get("columns", [])
        rows = res.get("rows", [])

        output = io.StringIO()
        # Add UTF-8 BOM
        output.write('\ufeff')
        writer = csv.writer(output)
        writer.writerow(columns)
        for r in rows:
            writer.writerow([r.get(c, '') for c in columns])
        
        output.seek(0)
        return StreamingResponse(
            io.BytesIO(output.getvalue().encode('utf-8')),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=sql_query_result.csv"}
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
