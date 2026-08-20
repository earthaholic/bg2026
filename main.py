import os
import io
import csv
import re
import json
from datetime import datetime
from typing import Optional, Dict, Any, List
from fastapi import FastAPI, Depends, HTTPException, Query, Request, status
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse, StreamingResponse, JSONResponse
from pydantic import BaseModel

from config import settings
from database import (
    init_system_tables,
    advance_student_grades,
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
    get_db_connection,
    list_all_users,
    get_user_by_id,
    create_user,
    update_user_password,
    update_user_role,
    delete_user,
    create_class,
    update_class,
    delete_class,
    get_class_by_id,
    search_classes,
    set_class_students,
    get_class_students,
    get_class_student_ids,
    get_teacher_options,
    write_audit_log,
    get_record_snapshot,
    get_audit_logs,
    get_audit_username_options
)
from auth import create_access_token, get_current_user, get_current_admin, get_current_staff
from similarity import normalize_key, classify_match

app = FastAPI(
    title="한국토론교육연구협회 - 꿈꾸는봄결 데이터 관리 시스템",
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
    advance_student_grades()

# Pydantic Schemas



class LoginRequest(BaseModel):
    username: str
    password: str

class UserCreateRequest(BaseModel):
    username: str
    password: str
    role: str

class UserPasswordResetRequest(BaseModel):
    password: str

class UserRoleUpdateRequest(BaseModel):
    role: str

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
    Grade: Optional[str] = ""
    School: Optional[str] = ""
    Referrer: Optional[str] = ""
    IsClassEnded: Optional[int] = 0
    Description: Optional[str] = ""

class StudentConsultationRequest(BaseModel):
    Content: str

class UserStudyLogRegisterRequest(BaseModel):
    StudentId: Optional[int] = None
    StudentIds: Optional[List[int]] = []
    BookId: int
    StudiedDay: str
    IsSpecial: Optional[bool] = False
    LessonContent: Optional[str] = ""
    Description: Optional[str] = ""

class ClassRequest(BaseModel):
    ClassName: str
    TeacherUsername: str
    DayOfWeek: str
    StartTime: Optional[str] = ""
    StudentIds: List[int] = []
    StudentIsSpecial: Optional[Dict[int, bool]] = {}

class ClassStudyLogItem(BaseModel):
    StudentId: int
    include: bool = True
    is_special: bool = False

class ClassStudyLogBatchRequest(BaseModel):
    BookId: int
    StudiedDay: str
    LessonContent: Optional[str] = ""
    Description: Optional[str] = ""
    logs: List[ClassStudyLogItem]

class TuitionFeeSettingRequest(BaseModel):
    ClassType: str
    PaidLessons: int
    DefaultFee: int

class TuitionPaymentRequest(BaseModel):
    StudentId: int
    ClassType: str
    PaidLessons: int
    ServiceLessons: int = 0
    StartDate: str
    PaidDate: str
    FeeAmount: int
    Memo: Optional[str] = ""

TUITION_CLASS_TYPES = (
    "초등부 독서반", "초등부 기초글쓰기반", "초등부 토론반",
    "중등부 독서반", "중등부 기초글쓰기반", "중등부 토론반", "심화반"
)

def _validate_tuition_values(class_type: str, paid_lessons: int, service_lessons: int = 0, fee_amount: int = 0):
    if class_type not in TUITION_CLASS_TYPES:
        raise HTTPException(status_code=400, detail="올바른 반 정보를 선택해 주세요.")
    if paid_lessons not in (10, 20, 30):
        raise HTTPException(status_code=400, detail="결제차시는 10, 20, 30회 중에서 선택해 주세요.")
    if not 0 <= service_lessons <= 10:
        raise HTTPException(status_code=400, detail="서비스차시는 0~10회 사이로 입력해 주세요.")
    if fee_amount < 0:
        raise HTTPException(status_code=400, detail="수업료는 0원 이상으로 입력해 주세요.")

def _get_tuition_progress(student_id: int, as_of: Optional[str] = None) -> Dict[str, Any]:
    """시작일 순으로 결제차시를 합산하고, 시작일 이후의 학습 이력을 차감한다."""
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute('''SELECT rowid as row_id, * FROM "TuitionPayments"
                          WHERE "StudentId" = ? AND "StartDate" <= ? ORDER BY "StartDate", rowid''',
                       (student_id, as_of or datetime.now().strftime("%Y-%m-%d")))
        payments = [dict(r) for r in cursor.fetchall()]
        if not payments:
            return {"has_payment": False, "total_lessons": 0, "used_lessons": 0,
                    "next_lesson": None, "remaining_lessons": 0, "payments": []}
        earliest_start = payments[0]["StartDate"]
        cursor.execute('''SELECT COUNT(*) AS count FROM "StudyLogs"
                          WHERE "StudentId" = ? AND "StudiedDay" >= ? AND "StudiedDay" <= ?
                          AND COALESCE("IsSpecial", 0) = 0''',
                       (student_id, earliest_start, as_of or "9999-12-31"))
        used = cursor.fetchone()["count"]
        total = sum((p.get("PaidLessons") or 0) + (p.get("ServiceLessons") or 0) for p in payments)
        return {"has_payment": True, "total_lessons": total, "used_lessons": used,
                "next_lesson": used + 1, "remaining_lessons": total - used,
                "is_exhausted": used >= total, "payments": payments}
    finally:
        conn.close()

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
# 등록/수정/삭제: 관리 선생님(manager) 이상만 가능 / 조회: 모든 로그인 사용자 가능
@app.post("/api/user/books")
def user_register_book(
    payload: UserBookRegisterRequest,
    current_user: Dict[str, Any] = Depends(get_current_staff)
):
    if not payload.Title or not payload.Title.strip():
        raise HTTPException(status_code=400, detail="도서명(Title)은 필수 입력 항목입니다.")

    book_data = payload.dict()
    book_data["Title"] = book_data["Title"].strip()
    book_data["CreatedBy"] = current_user["username"]

    try:
        res = insert_table_row("Books", book_data)
        new_snapshot = get_record_snapshot("Books", res.get("id"))
        _audit_insert("Books", res.get("id"), new_snapshot,
                      current_user["username"], current_user["role"])
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
    voca_max: Optional[int] = Query(None),
    length_min: Optional[int] = Query(None),
    length_max: Optional[int] = Query(None),
    has_quiz: Optional[int] = Query(None),
    has_reading: Optional[int] = Query(None),
    has_writing: Optional[int] = Query(None),
    has_pdf: Optional[int] = Query(None),
    has_advanced: Optional[int] = Query(None),
    has_debate: Optional[int] = Query(None),
    has_paperbook: Optional[int] = Query(None),
    has_yes24: Optional[int] = Query(None),
    has_millie: Optional[int] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(30, ge=1, le=50),
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
        target_list = [t.strip() for t in target.split(',') if t.strip()]
        if target_list:
            or_conds = []
            for t in target_list:
                if t == '선택안함':
                    or_conds.append('("Target" IS NULL OR "Target" = \'\' OR TRIM("Target") = \'\')')
                else:
                    or_conds.append('"Target" LIKE ?')
                    params.append(f"%{t}%")
            if or_conds:
                conditions.append(f'({" OR ".join(or_conds)})')

    if voca_min is not None:
        conditions.append('COALESCE("Voca", 0) >= ?')
        params.append(voca_min)

    if voca_max is not None:
        conditions.append('COALESCE("Voca", 0) <= ?')
        params.append(voca_max)

    if length_min is not None:
        conditions.append('COALESCE("BookLength", 0) >= ?')
        params.append(length_min)

    if length_max is not None:
        conditions.append('COALESCE("BookLength", 0) <= ?')
        params.append(length_max)

    if has_quiz == 1:
        conditions.append('"HasQuiz" = 1')

    if has_reading == 1:
        conditions.append('("HasReadingQuestion" = 1 OR "HasReadingAnswer" = 1)')

    if has_writing == 1:
        conditions.append('("HasWritingQuestion" = 1 OR "HasWritingAnswer" = 1)')

    if has_pdf == 1:
        conditions.append('"IsPdfExist" = 1')
    if has_advanced == 1:
        conditions.append('"HasAdvancedMaterial" = 1')
    if has_debate == 1:
        conditions.append('"HasDebateMaterial" = 1')
    if has_paperbook == 1:
        conditions.append('"IsPaperbookExist" = 1')
    if has_yes24 == 1:
        conditions.append('"IsYes24Exist" = 1')
    if has_millie == 1:
        conditions.append('"IsMillieExist" = 1')

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

import glob
from google.oauth2 import service_account
from googleapiclient.discovery import build

def get_gdrive_files_for_book(title: str) -> List[Dict[str, Any]]:
    if not title or not title.strip():
        return []
    try:
        json_files = glob.glob(os.path.join("google", "*.json"))
        if not json_files:
            return []
        
        sa_file = json_files[0]
        scopes = ['https://www.googleapis.com/auth/drive.readonly']
        creds = service_account.Credentials.from_service_account_file(sa_file, scopes=scopes)
        service = build('drive', 'v3', credentials=creds)

        clean_title = title.strip().replace("'", "\\'")
        query = f"name contains '{clean_title}' and trashed = false"
        
        results = service.files().list(
            q=query,
            pageSize=30,
            fields="files(id, name, mimeType, webViewLink, iconLink)"
        ).execute()
        return results.get('files', [])
    except Exception as e:
        print(f"[Google Drive Service Error] {e}")
        return []

@app.get("/api/user/books/similar")
def user_get_similar_books(
    q: Optional[str] = Query(None),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    new_title = (q or "").strip()
    new_key = normalize_key(new_title)
    if not new_key:
        return {"total": 0, "summary": {"exact": 0, "contains": 0, "similar": 0}, "matches": []}

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT rowid as row_id, * FROM "Books"')
    rows = cursor.fetchall()
    conn.close()

    rank = {"exact": 0, "contains": 1, "similar": 2}
    results = []
    for r in rows:
        key = normalize_key(r["Title"] or "")
        mt = classify_match(new_key, key)
        if mt:
            results.append({"match_type": mt, "norm_len": len(key), "row": r})

    results.sort(key=lambda item: (rank[item["match_type"]], abs(len(new_key) - item["norm_len"]), item["row"]["row_id"]))

    summary = {"exact": 0, "contains": 0, "similar": 0}
    for item in results:
        summary[item["match_type"]] += 1

    matches = [
        {"row_id": item["row"]["row_id"], "Id": item["row"]["Id"], "Title": item["row"]["Title"],
         "Author": item["row"]["Author"], "Publisher": item["row"]["Publisher"],
         "match_type": item["match_type"]}
        for item in results[:30]
    ]
    return {"total": len(results), "summary": summary, "matches": matches}

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
    
    book_data = dict(row)
    gdrive_files = get_gdrive_files_for_book(book_data.get("Title", ""))
    return {"book": book_data, "gdrive_files": gdrive_files}

# --- User Student Registration & Search APIs ---
@app.post("/api/user/students")
def user_register_student(
    payload: UserStudentRegisterRequest,
    current_user: Dict[str, Any] = Depends(get_current_staff)
):
    if not payload.Name or not payload.Name.strip():
        raise HTTPException(status_code=400, detail="학생 이름(Name)은 필수 입력 항목입니다.")

    student_data = payload.dict()
    student_data["Name"] = student_data["Name"].strip()
    student_data["Birthday"] = (student_data.get("Birthday") or "").strip()
    if not student_data["Birthday"]:
        student_data["Birthday"] = "1970-01-01"
        
    student_data["Grade"] = (student_data.get("Grade") or "").strip()
    student_data["School"] = (student_data.get("School") or "").strip()
    student_data["GradeAtRegistration"] = student_data["Grade"]
    student_data["RegistrationYear"] = datetime.now().year
    student_data["RegistrationMonth"] = datetime.now().month
    student_data["Referrer"] = (student_data.get("Referrer") or "").strip()
    student_data["IsClassEnded"] = 1 if student_data.get("IsClassEnded") else 0
    student_data["Sex"] = (student_data["Sex"] or "").strip()
    student_data["Description"] = (student_data["Description"] or "").strip()
    student_data["CreatedBy"] = current_user["username"]

    try:
        res = insert_table_row("Students", student_data)
        new_snapshot = get_record_snapshot("Students", res.get("id"))
        _audit_insert("Students", res.get("id"), new_snapshot,
                      current_user["username"], current_user["role"])
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
    cursor.execute('SELECT rowid as row_id, * FROM "Students" WHERE (COALESCE("IsClassEnded", 0) = 0) ORDER BY rowid DESC LIMIT 5')
    rows = cursor.fetchall()
    conn.close()
    return {"students": [dict(r) for r in rows]}

@app.get("/api/user/students/search")
def user_search_students(
    q: Optional[str] = Query(None),
    sex: Optional[str] = Query(None),
    include_ended: bool = Query(False),
    page: int = Query(1, ge=1),
    limit: int = Query(30, ge=1, le=50),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    advance_student_grades()
    conn = get_db_connection()
    cursor = conn.cursor()

    conditions = []
    params = []

    if q and q.strip():
        search_pattern = f"%{q.strip()}%"
        conditions.append('("Name" LIKE ? OR "Grade" LIKE ? OR "Referrer" LIKE ? OR "Description" LIKE ?)')
        params.extend([search_pattern] * 4)

    if sex and sex.strip():
        s_val = sex.strip().upper()
        if sex.strip() == '__unspecified__':
            conditions.append('(\"Sex\" IS NULL OR TRIM(\"Sex\") = \'\')')
        elif s_val in ('남', '남성', 'M', 'MALE'):
            conditions.append('("Sex" = \'남\' OR "Sex" = \'남성\' OR "Sex" = \'M\' OR "Sex" = \'MALE\')')
        elif s_val in ('여', '여성', 'F', 'FEMALE'):
            conditions.append('("Sex" = \'여\' OR "Sex" = \'여성\' OR "Sex" = \'F\' OR "Sex" = \'FEMALE\')')
        else:
            conditions.append('"Sex" LIKE ?')
            params.append(f"%{sex.strip()}%")

    if not include_ended:
        conditions.append('(COALESCE("IsClassEnded", 0) = 0)')

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

@app.get("/api/user/students/similar")
def user_get_similar_students(
    q: Optional[str] = Query(None),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    new_name = (q or "").strip()
    new_key = normalize_key(new_name)
    if not new_key:
        return {"total": 0, "summary": {"exact": 0, "contains": 0, "similar": 0}, "matches": []}

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT rowid as row_id, * FROM "Students"')
    rows = cursor.fetchall()
    conn.close()

    results = []
    for r in rows:
        if normalize_key(r["Name"] or "") == new_key:
            results.append(r)

    results.sort(key=lambda r: r["row_id"])

    return {
        "total": len(results),
        "summary": {"exact": len(results), "contains": 0, "similar": 0},
        "matches": [
            {"row_id": r["row_id"], "Id": r["Id"], "Name": r["Name"],
             "Sex": r["Sex"], "Birthday": r["Birthday"], "Grade": r["Grade"], "Referrer": r["Referrer"], "match_type": "exact"}
            for r in results[:30]
        ],
    }

@app.get("/api/user/students/{student_id}")
def user_get_student_detail(
    student_id: int,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    advance_student_grades()
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT rowid as row_id, * FROM "Students" WHERE rowid = ? OR "Id" = ?', (student_id, student_id))
    student_row = cursor.fetchone()
    if not student_row:
        conn.close()
        raise HTTPException(status_code=404, detail="해당 학생을 찾을 수 없습니다.")
    
    student = dict(student_row)
    s_row_id = student['row_id']
    s_id = student.get('Id', s_row_id)
    s_name = student.get('Name', '')

    # Fetch all StudyLogs for this student joined with Books
    studylogs_query = '''
        SELECT sl.rowid as row_id, sl.*, 
               b.Title as BookTitle, b.Author as BookAuthor, b.Publisher as BookPublisher,
               b.Voca as BookVoca, b.BookLength as BookLength, b.Target as BookTarget
        FROM "StudyLogs" sl
        LEFT JOIN "Books" b ON sl.BookId = b.rowid OR sl.BookId = b.Id
        WHERE sl.StudentId = ? OR sl.StudentId = ? OR sl.StudentId = ? OR sl.StudentId = ?
        ORDER BY sl.rowid DESC
    '''
    cursor.execute(studylogs_query, (s_row_id, str(s_row_id), s_id, s_name))
    logs_rows = cursor.fetchall()

    # 추천인 이름은 학생 등록 시 문자열로 저장되므로, 현재 학생 이름과 일치하는 학생을 조회한다.
    cursor.execute('''
        SELECT rowid AS row_id, "Id", "Name", "Sex", "Grade", "School", "IsClassEnded"
        FROM "Students"
        WHERE TRIM(COALESCE("Referrer", '')) = ?
          AND rowid <> ?
        ORDER BY "Name" ASC, rowid ASC
    ''', (s_name.strip(), s_row_id))
    referred_students_rows = cursor.fetchall()
    conn.close()

    studylogs = [dict(r) for r in logs_rows]
    referred_students = [dict(r) for r in referred_students_rows]

    result = {
        "student": student,
        "studylogs": studylogs,
        "total_studylogs": len(studylogs),
        "referred_students": referred_students,
    }
    if current_user.get("role") in ("admin", "manager"):
        result["tuition_progress"] = _get_tuition_progress(s_row_id)
    return result

@app.get("/api/user/students/{student_id}/consultations")
def user_get_student_consultations(
    student_id: int,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    row_id = _resolve_domain_pk("Students", student_id)
    if row_id is None:
        raise HTTPException(status_code=404, detail="해당 학생을 찾을 수 없습니다.")
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute('''SELECT rowid AS row_id, * FROM "StudentConsultations"
                          WHERE "StudentId" = ? ORDER BY "CreatedAt" DESC, rowid DESC''', (row_id,))
        return {"consultations": [dict(row) for row in cursor.fetchall()]}
    finally:
        conn.close()

@app.post("/api/user/students/{student_id}/consultations")
def user_create_student_consultation(
    student_id: int,
    payload: StudentConsultationRequest,
    current_user: Dict[str, Any] = Depends(get_current_staff)
):
    row_id = _resolve_domain_pk("Students", student_id)
    content = payload.Content.strip()
    if row_id is None:
        raise HTTPException(status_code=404, detail="해당 학생을 찾을 수 없습니다.")
    if not content:
        raise HTTPException(status_code=400, detail="상담 기록을 입력해 주세요.")
    try:
        res = insert_table_row("StudentConsultations", {
            "StudentId": row_id, "Content": content, "CreatedBy": current_user["username"]
        })
        consultation_id = res.get("id")
        _audit_insert("StudentConsultations", consultation_id,
                      get_record_snapshot("StudentConsultations", consultation_id),
                      current_user["username"], current_user["role"])
        return {"status": "success", "message": "상담 기록이 추가되었습니다.", "id": consultation_id}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"상담 기록 추가 중 오류가 발생했습니다: {str(e)}")

@app.put("/api/user/consultations/{consultation_id}")
def user_update_student_consultation(
    consultation_id: int,
    payload: StudentConsultationRequest,
    current_user: Dict[str, Any] = Depends(get_current_staff)
):
    row_id = _resolve_domain_pk("StudentConsultations", consultation_id)
    content = payload.Content.strip()
    if row_id is None:
        raise HTTPException(status_code=404, detail="해당 상담 기록을 찾을 수 없습니다.")
    if not content:
        raise HTTPException(status_code=400, detail="상담 기록을 입력해 주세요.")
    try:
        old_snapshot = get_record_snapshot("StudentConsultations", row_id)
        update_table_row("StudentConsultations", "rowid", row_id, {
            "Content": content, "UpdatedBy": current_user["username"],
            "UpdatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        })
        _audit_update("StudentConsultations", row_id, old_snapshot,
                      get_record_snapshot("StudentConsultations", row_id),
                      current_user["username"], current_user["role"])
        return {"status": "success", "message": "상담 기록이 수정되었습니다."}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"상담 기록 수정 중 오류가 발생했습니다: {str(e)}")

@app.delete("/api/user/consultations/{consultation_id}")
def user_delete_student_consultation(
    consultation_id: int,
    current_user: Dict[str, Any] = Depends(get_current_staff)
):
    row_id = _resolve_domain_pk("StudentConsultations", consultation_id)
    if row_id is None:
        raise HTTPException(status_code=404, detail="해당 상담 기록을 찾을 수 없습니다.")
    try:
        old_snapshot = get_record_snapshot("StudentConsultations", row_id)
        delete_table_row("StudentConsultations", "rowid", row_id)
        _audit_delete("StudentConsultations", row_id, old_snapshot,
                      current_user["username"], current_user["role"])
        return {"status": "success", "message": "상담 기록이 삭제되었습니다."}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"상담 기록 삭제 중 오류가 발생했습니다: {str(e)}")

# --- Options List APIs for Forms ---
@app.get("/api/user/students-options")
def user_get_students_options(
    include_ended: bool = Query(False),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    advance_student_grades()
    conn = get_db_connection()
    cursor = conn.cursor()
    where_clause = '' if include_ended else ' WHERE (COALESCE("IsClassEnded", 0) = 0)'
    cursor.execute(f'SELECT rowid as row_id, * FROM "Students"{where_clause} ORDER BY "Name" ASC')
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
    include_ended: bool = Query(False),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    conn = get_db_connection()
    cursor = conn.cursor()
    conds = []
    params = []
    if not include_ended:
        conds.append('(COALESCE("IsClassEnded", 0) = 0)')
    if q and q.strip():
        pattern = f"%{q.strip()}%"
        conds.append('("Name" LIKE ? OR "Grade" LIKE ? OR "Referrer" LIKE ? OR "Description" LIKE ?)')
        params = [pattern] * 4

    where_str = f' WHERE {" AND ".join(conds)}' if conds else ''
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

# --- 수업료 결제 관리 APIs (관리 선생님 이상 전용) ---
@app.get("/api/user/tuition-fee-settings")
def get_tuition_fee_settings(current_user: Dict[str, Any] = Depends(get_current_staff)):
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute('SELECT rowid as row_id, * FROM "TuitionFeeSettings" ORDER BY "ClassType", "PaidLessons"')
        return {"settings": [dict(r) for r in cursor.fetchall()]}
    finally:
        conn.close()

@app.post("/api/user/tuition-fee-settings")
def save_tuition_fee_setting(payload: TuitionFeeSettingRequest, current_user: Dict[str, Any] = Depends(get_current_staff)):
    _validate_tuition_values(payload.ClassType, payload.PaidLessons, 0, payload.DefaultFee)
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute('SELECT rowid FROM "TuitionFeeSettings" WHERE "ClassType" = ? AND "PaidLessons" = ?', (payload.ClassType, payload.PaidLessons))
        row = cursor.fetchone()
        if row:
            record_id = row[0]
            old = get_record_snapshot("TuitionFeeSettings", record_id)
            cursor.execute('''UPDATE "TuitionFeeSettings" SET "DefaultFee" = ?, "UpdatedBy" = ?,
                              "UpdatedAt" = datetime('now','localtime') WHERE rowid = ?''',
                           (payload.DefaultFee, current_user["username"], record_id))
            conn.commit()
            _audit_update("TuitionFeeSettings", record_id, old, get_record_snapshot("TuitionFeeSettings", record_id), current_user["username"], current_user["role"])
        else:
            cursor.execute('''INSERT INTO "TuitionFeeSettings" ("ClassType", "PaidLessons", "DefaultFee", "CreatedBy")
                              VALUES (?, ?, ?, ?)''', (payload.ClassType, payload.PaidLessons, payload.DefaultFee, current_user["username"]))
            record_id = cursor.lastrowid
            conn.commit()
            _audit_insert("TuitionFeeSettings", record_id, get_record_snapshot("TuitionFeeSettings", record_id), current_user["username"], current_user["role"])
        return {"status": "success", "id": record_id, "message": "기본 수업료가 저장되었습니다."}
    finally:
        conn.close()

@app.get("/api/user/tuition-payments")
def get_tuition_payments(q: Optional[str] = None, class_type: Optional[str] = None, student_id: Optional[int] = None, current_user: Dict[str, Any] = Depends(get_current_staff)):
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        conditions, params = [], []
        if student_id:
            conditions.append('p."StudentId" = ?'); params.append(student_id)
        if q and q.strip():
            conditions.append('s."Name" LIKE ?'); params.append(f'%{q.strip()}%')
        if class_type and class_type.strip():
            conditions.append('p."ClassType" = ?'); params.append(class_type.strip())
        where = f" WHERE {' AND '.join(conditions)}" if conditions else ''
        cursor.execute(f'''SELECT p.rowid as row_id, p.*, s."Name" AS "StudentName"
                           FROM "TuitionPayments" p LEFT JOIN "Students" s ON p."StudentId" = s.rowid OR p."StudentId" = s."Id"
                           {where} ORDER BY p."StartDate" DESC, p.rowid DESC''', params)
        return {"payments": [dict(r) for r in cursor.fetchall()]}
    finally:
        conn.close()

@app.post("/api/user/tuition-payments")
def create_tuition_payment(payload: TuitionPaymentRequest, current_user: Dict[str, Any] = Depends(get_current_staff)):
    _validate_tuition_values(payload.ClassType, payload.PaidLessons, payload.ServiceLessons, payload.FeeAmount)
    try:
        datetime.strptime(payload.StartDate, "%Y-%m-%d")
        datetime.strptime(payload.PaidDate, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="차시 시작일과 납부일은 YYYY-MM-DD 형식이어야 합니다.")
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute('SELECT rowid FROM "Students" WHERE rowid = ? OR "Id" = ?', (payload.StudentId, payload.StudentId))
        if not cursor.fetchone():
            raise HTTPException(status_code=400, detail="해당 학생을 찾을 수 없습니다.")
        cursor.execute('''INSERT INTO "TuitionPayments" ("StudentId", "ClassType", "PaidLessons", "ServiceLessons", "StartDate", "PaidDate", "FeeAmount", "Memo", "CreatedBy")
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)''', (payload.StudentId, payload.ClassType, payload.PaidLessons, payload.ServiceLessons, payload.StartDate, payload.PaidDate, payload.FeeAmount, (payload.Memo or '').strip(), current_user["username"]))
        payment_id = cursor.lastrowid
        conn.commit()
        _audit_insert("TuitionPayments", payment_id, get_record_snapshot("TuitionPayments", payment_id), current_user["username"], current_user["role"])
        return {"status": "success", "id": payment_id, "message": "학생 결제 정보가 등록되었습니다."}
    finally:
        conn.close()

@app.get("/api/user/tuition-payments/{payment_id}")
def get_tuition_payment_detail(payment_id: int, current_user: Dict[str, Any] = Depends(get_current_staff)):
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute('''SELECT p.rowid as row_id, p.*, s."Name" AS "StudentName", s."Grade" AS "StudentGrade"
                          FROM "TuitionPayments" p LEFT JOIN "Students" s ON p."StudentId" = s.rowid OR p."StudentId" = s."Id"
                          WHERE p.rowid = ? OR p."Id" = ?''', (payment_id, payment_id))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="해당 결제 정보를 찾을 수 없습니다.")
        return {"payment": dict(row)}
    finally:
        conn.close()

@app.put("/api/user/tuition-payments/{payment_id}")
def update_tuition_payment(payment_id: int, payload: TuitionPaymentRequest, current_user: Dict[str, Any] = Depends(get_current_staff)):
    _validate_tuition_values(payload.ClassType, payload.PaidLessons, payload.ServiceLessons, payload.FeeAmount)
    try:
        datetime.strptime(payload.StartDate, "%Y-%m-%d")
        datetime.strptime(payload.PaidDate, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="차시 시작일과 납부일은 YYYY-MM-DD 형식이어야 합니다.")
    row_id = _resolve_domain_pk("TuitionPayments", payment_id)
    if row_id is None:
        raise HTTPException(status_code=404, detail="해당 결제 정보를 찾을 수 없습니다.")
    old = get_record_snapshot("TuitionPayments", row_id)
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute('''UPDATE "TuitionPayments" SET "StudentId"=?, "ClassType"=?, "PaidLessons"=?, "ServiceLessons"=?,
                          "StartDate"=?, "PaidDate"=?, "FeeAmount"=?, "Memo"=?, "UpdatedBy"=?, "UpdatedAt"=datetime('now','localtime') WHERE rowid=?''',
                       (payload.StudentId, payload.ClassType, payload.PaidLessons, payload.ServiceLessons, payload.StartDate, payload.PaidDate, payload.FeeAmount, (payload.Memo or '').strip(), current_user["username"], row_id))
        conn.commit()
    finally:
        conn.close()
    _audit_update("TuitionPayments", row_id, old, get_record_snapshot("TuitionPayments", row_id), current_user["username"], current_user["role"])
    return {"status": "success", "message": "결제 정보가 수정되었습니다."}

@app.delete("/api/user/tuition-payments/{payment_id}")
def delete_tuition_payment(payment_id: int, current_user: Dict[str, Any] = Depends(get_current_staff)):
    row_id = _resolve_domain_pk("TuitionPayments", payment_id)
    if row_id is None:
        raise HTTPException(status_code=404, detail="해당 결제 정보를 찾을 수 없습니다.")
    old = get_record_snapshot("TuitionPayments", row_id)
    delete_table_row("TuitionPayments", "rowid", row_id)
    _audit_delete("TuitionPayments", row_id, old, current_user["username"], current_user["role"])
    return {"status": "success", "message": "결제 정보가 삭제되었습니다."}

@app.get("/api/user/students/{student_id}/tuition-progress")
def get_student_tuition_progress(student_id: int, studied_day: Optional[str] = None, current_user: Dict[str, Any] = Depends(get_current_staff)):
    return _get_tuition_progress(student_id, studied_day)

# --- User StudyLog Registration & Search APIs ---
@app.post("/api/user/studylogs")
def user_register_studylog(
    payload: UserStudyLogRegisterRequest,
    current_user: Dict[str, Any] = Depends(get_current_staff)
):
    target_student_ids = []
    if payload.StudentIds:
        for sid in payload.StudentIds:
            if isinstance(sid, int) and sid > 0 and sid not in target_student_ids:
                target_student_ids.append(sid)
    if payload.StudentId and payload.StudentId > 0 and payload.StudentId not in target_student_ids:
        target_student_ids.append(payload.StudentId)

    if not target_student_ids:
        raise HTTPException(status_code=400, detail="학습할 학생을 1명 이상 선택해 주세요.")
    if not payload.BookId or payload.BookId <= 0:
        raise HTTPException(status_code=400, detail="도서를 선택해 주세요.")
    if not payload.StudiedDay or not payload.StudiedDay.strip():
        raise HTTPException(status_code=400, detail="학습 일자를 입력해 주세요.")

    created_log_ids = []
    try:
        for s_id in target_student_ids:
            log_data = {
                "StudentId": s_id,
                "BookId": payload.BookId,
                "StudiedDay": payload.StudiedDay.strip(),
                "IsSpecial": 1 if payload.IsSpecial else 0,
                "LessonContent": (payload.LessonContent or "").strip(),
                "Description": (payload.Description or "").strip(),
                "CreatedBy": current_user["username"]
            }
            res = insert_table_row("StudyLogs", log_data)
            log_id = res.get("id")
            if log_id:
                created_log_ids.append(log_id)
                new_snapshot = get_record_snapshot("StudyLogs", log_id)
                _audit_insert("StudyLogs", log_id, new_snapshot,
                              current_user["username"], current_user["role"])

        count = len(created_log_ids)
        return {
            "status": "success",
            "message": f"{count}명의 학습 기록이 성공적으로 수록되었습니다." if count > 1 else "학습 기록이 성공적으로 수록되었습니다.",
            "log_id": created_log_ids[0] if created_log_ids else None,
            "log_ids": created_log_ids,
            "count": count
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
               s.Grade as StudentGrade, s.Referrer as StudentReferrer,
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
    limit: int = Query(30, ge=1, le=50),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    conn = get_db_connection()
    cursor = conn.cursor()

    conditions = []
    params = []

    if q and q.strip():
        search_pattern = f"%{q.strip()}%"
        conditions.append('(s.Name LIKE ? OR b.Title LIKE ? OR b.Author LIKE ? OR b.Publisher LIKE ? OR s.Referrer LIKE ?)')
        params.extend([search_pattern] * 5)

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
               s.Grade as StudentGrade, s.Referrer as StudentReferrer,
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
               s.Grade as StudentGrade, s.Referrer as StudentReferrer,
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

# --- 월말 보고 문자 양식 생성 APIs ---

class MonthlyReportPreviewPayload(BaseModel):
    student_name: str
    period_label: Optional[str] = ""
    report_month: Optional[str] = ""
    start_lecture_num: Optional[int] = 1
    special_teacher_name: Optional[str] = ""
    logs: List[Dict[str, Any]] = []

def _get_korean_name_with_yi(name: str) -> str:
    if not name or len(name) == 0:
        return ""
    last_char_code = ord(name[-1])
    if 0xAC00 <= last_char_code <= 0xD7A3:
        has_patchim = (last_char_code - 0xAC00) % 28 > 0
        return name + "이" if has_patchim else name
    return name

def _format_date_korean(studied_day: str) -> str:
    """StudiedDay (e.g. 2026-07-02) -> 7/2(목)"""
    if not studied_day:
        return ""
    clean_date = str(studied_day).strip().split('T')[0].split(' ')[0]
    parts = clean_date.replace('.', '-').replace('/', '-').split('-')
    if len(parts) >= 3:
        try:
            year, month, day = int(parts[0]), int(parts[1]), int(parts[2])
            import datetime
            dt = datetime.date(year, month, day)
            days_kr = ['월', '화', '수', '목', '금', '토', '일']
            dow = days_kr[dt.weekday()]
            return f"{month}/{day}({dow})"
        except Exception:
            pass
    return studied_day

def build_monthly_report_text(
    student_name: str,
    period_label: str,
    report_month: str,
    start_lecture_num: int,
    special_teacher_name: str,
    logs: List[Dict[str, Any]]
) -> str:
    name_yi = _get_korean_name_with_yi(student_name)
    lines = []
    lines.append(f"{name_yi} 어머니")
    lines.append("안녕하세요")

    period_str = (period_label or "").strip()
    month_str = (report_month or "").strip()
    if period_str and month_str:
        lines.append(f"{period_str}중 {month_str} 수업보고드립니다^^")
    elif month_str:
        lines.append(f"{month_str} 수업보고드립니다^^")
    elif period_str:
        lines.append(f"{period_str} 수업보고드립니다^^")
    else:
        lines.append("수업보고드립니다^^")

    lines.append("")

    current_lecture = start_lecture_num or 1
    teacher_suffix = (special_teacher_name or "").strip()
    if teacher_suffix and not teacher_suffix.endswith("선생님"):
        teacher_suffix += " 선생님"

    for i, log in enumerate(logs):
        if i > 0:
            lines.append("")

        is_special = bool(log.get("IsSpecial") or log.get("is_special"))
        if is_special:
            if teacher_suffix:
                lines.append(f"<특강> {teacher_suffix}")
            else:
                lines.append("<특강>")
        else:
            lines.append(f"<{current_lecture}강>")
            current_lecture += 1

        book_title = (log.get("BookTitle") or log.get("book_title") or log.get("Title") or "").strip()
        lines.append(f"도서 : {book_title}")

        date_str = _format_date_korean(log.get("StudiedDay") or log.get("studied_day") or "")
        lesson_content = (log.get("LessonContent") or log.get("lesson_content") or log.get("Description") or "").strip()
        if date_str and lesson_content:
            lines.append(f"{date_str} {lesson_content}")
        elif date_str:
            lines.append(f"{date_str}")
        elif lesson_content:
            lines.append(f"{lesson_content}")

    return "\n".join(lines)

@app.get("/api/user/monthly-report/studylogs")
def user_get_monthly_report_studylogs(
    student_id: int = Query(...),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute('SELECT rowid as row_id, * FROM "Students" WHERE rowid = ? OR "Id" = ?', (student_id, student_id))
    student_row = cursor.fetchone()
    if not student_row:
        conn.close()
        raise HTTPException(status_code=404, detail="해당 학생을 찾을 수 없습니다.")
    student = dict(student_row)
    s_row_id = student['row_id']
    s_id = student.get('Id', s_row_id)
    s_name = student.get('Name', '')

    query = '''
        SELECT sl.rowid as row_id, sl.*, 
               b.Title as BookTitle, b.Author as BookAuthor, b.Publisher as BookPublisher
        FROM "StudyLogs" sl
        LEFT JOIN "Books" b ON sl.BookId = b.rowid OR sl.BookId = b.Id
        WHERE sl.StudentId = ? OR sl.StudentId = ? OR sl.StudentId = ? OR sl.StudentId = ?
        ORDER BY sl.StudiedDay DESC, sl.rowid DESC
    '''
    cursor.execute(query, (s_row_id, str(s_row_id), s_id, s_name))
    rows = cursor.fetchall()
    conn.close()

    logs = [dict(r) for r in rows]
    return {
        "student": student,
        "logs": logs,
        "total_count": len(logs)
    }

@app.post("/api/user/monthly-report/preview")
def user_generate_monthly_report_preview(
    payload: MonthlyReportPreviewPayload,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    text = build_monthly_report_text(
        student_name=payload.student_name,
        period_label=payload.period_label or "2학기(5, 6, 7월)",
        report_month=payload.report_month or "7월",
        start_lecture_num=payload.start_lecture_num or 23,
        special_teacher_name=payload.special_teacher_name or "",
        logs=payload.logs
    )
    return {"text": text}

# --- 수업(Classes) 관리 APIs ---
# 조회: 모든 로그인 사용자 (선생님은 본인 수업만)
# 등록/수정/삭제: 관리 선생님(manager) 이상 / 일괄 학습 이력 등록: staff + 본인 수업 선생님

DAY_OF_WEEK_VALUES = ['월', '화', '수', '목', '금', '토', '일']

def _get_accessible_class(class_id: int, current_user: Dict[str, Any]) -> Dict[str, Any]:
    """수업을 조회한다. 선생님(teacher)은 본인 수업만 접근 가능."""
    class_row = get_class_by_id(class_id)
    if not class_row:
        raise HTTPException(status_code=404, detail="해당 수업을 찾을 수 없습니다.")
    if current_user["role"] == "teacher" and class_row["TeacherUsername"] != current_user["username"]:
        raise HTTPException(status_code=403, detail="본인 수업만 조회할 수 있습니다.")
    return class_row

def _validate_class_payload(payload: ClassRequest) -> None:
    """수업 등록/수정 공통 검증 (오류 시 HTTPException 발생)."""
    if not payload.ClassName or not payload.ClassName.strip():
        raise HTTPException(status_code=400, detail="수업명은 필수 입력 항목입니다.")

    teacher = get_user_by_username(payload.TeacherUsername)
    if not teacher or teacher["role"] not in ("teacher", "manager"):
        raise HTTPException(status_code=400, detail="담당 선생님 계정을 확인해 주세요.")

    if payload.DayOfWeek not in DAY_OF_WEEK_VALUES:
        raise HTTPException(status_code=400, detail="요일은 월~일 중 하나여야 합니다.")

    if payload.StartTime and not re.match(r'^\d{2}:\d{2}$', payload.StartTime):
        raise HTTPException(status_code=400, detail="시간은 HH:MM 형식으로 입력해 주세요.")

def _resolve_student_row_id(student_id: int) -> Optional[int]:
    """학생의 rowid 또는 Id 중 실제 행의 rowid를 반환한다. 없으면 None."""
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute('SELECT rowid FROM "Students" WHERE rowid = ? OR "Id" = ?', (student_id, student_id))
        row = cursor.fetchone()
        return row[0] if row else None
    finally:
        conn.close()

def _class_student_items(payload: ClassRequest) -> List[dict]:
    """수업 배정 학생 목록을 ClassStudents 행 구조(StudentId + IsSpecial)로 변환한다."""
    special_map = payload.StudentIsSpecial or {}
    return [
        {"StudentId": sid, "IsSpecial": 1 if special_map.get(sid) else 0}
        for sid in payload.StudentIds
    ]

@app.get("/api/user/classes")
def user_list_classes(
    q: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(30, ge=1, le=100),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    teacher_username = current_user["username"] if current_user["role"] == "teacher" else None
    rows, total_count = search_classes(q=q, page=page, limit=limit, teacher_username=teacher_username)
    total_pages = (total_count + limit - 1) // limit if total_count > 0 else 1
    return {
        "page": page,
        "limit": limit,
        "total_count": total_count,
        "total_pages": total_pages,
        "classes": rows
    }

@app.get("/api/user/classes/{class_id}")
def user_get_class_detail(
    class_id: int,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    class_row = _get_accessible_class(class_id, current_user)
    students = get_class_students(class_id)
    return {"class_": class_row, "students": students}

@app.post("/api/user/classes")
def user_register_class(
    payload: ClassRequest,
    current_user: Dict[str, Any] = Depends(get_current_staff)
):
    _validate_class_payload(payload)
    try:
        payload_data = payload.dict()
        payload_data["CreatedBy"] = current_user["username"]
        res = create_class(payload_data)
        class_id = res.get("id")
        set_class_students(class_id, _class_student_items(payload))
        new_snapshot = get_record_snapshot("Classes", class_id)
        _audit_insert("Classes", class_id, new_snapshot,
                      current_user["username"], current_user["role"])
        return {
            "status": "success",
            "message": f"'{payload.ClassName.strip()}' 수업이 성공적으로 등록되었습니다.",
            "class_id": class_id
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"수업 등록 중 오류가 발생했습니다: {str(e)}")

@app.put("/api/user/classes/{class_id}")
def user_update_class(
    class_id: int,
    payload: ClassRequest,
    current_user: Dict[str, Any] = Depends(get_current_staff)
):
    if not get_class_by_id(class_id):
        raise HTTPException(status_code=404, detail="해당 수업을 찾을 수 없습니다.")
    _validate_class_payload(payload)
    try:
        old_snapshot = get_record_snapshot("Classes", class_id)
        payload_data = payload.dict()
        payload_data["UpdatedBy"] = current_user["username"]
        payload_data["UpdatedAt"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        update_class(class_id, payload_data)
        set_class_students(class_id, _class_student_items(payload))
        new_snapshot = get_record_snapshot("Classes", class_id)
        _audit_update("Classes", class_id, old_snapshot, new_snapshot,
                      current_user["username"], current_user["role"])
        return {"status": "success", "message": "수업 정보가 성공적으로 수정되었습니다."}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"수업 수정 중 오류가 발생했습니다: {str(e)}")

@app.delete("/api/user/classes/{class_id}")
def user_delete_class(
    class_id: int,
    current_user: Dict[str, Any] = Depends(get_current_staff)
):
    if not get_class_by_id(class_id):
        raise HTTPException(status_code=404, detail="해당 수업을 찾을 수 없습니다.")
    try:
        old_snapshot = get_record_snapshot("Classes", class_id)
        delete_class(class_id)
        _audit_delete("Classes", class_id, old_snapshot,
                      current_user["username"], current_user["role"])
        return {"status": "success", "message": "수업이 성공적으로 삭제되었습니다."}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"수업 삭제 중 오류가 발생했습니다: {str(e)}")

@app.get("/api/user/teachers-options")
def user_get_teachers_options(current_user: Dict[str, Any] = Depends(get_current_user)):
    return {"teachers": get_teacher_options()}

@app.get("/api/user/classes/{class_id}/batch-form")
def user_get_class_batch_form(
    class_id: int,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    class_row = _get_accessible_class(class_id, current_user)
    students = get_class_students(class_id)
    return {"class_": class_row, "students": students}

@app.get("/api/user/classes/{class_id}/studylog-calendar")
def user_get_class_studylog_calendar(
    class_id: int,
    month: str = Query(...),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """수업 배정 학생의 월별 학습 이력을 일괄 등록 달력에 제공한다."""
    _get_accessible_class(class_id, current_user)
    if not re.match(r"^\d{4}-\d{2}$", month):
        raise HTTPException(status_code=400, detail="조회할 월은 YYYY-MM 형식이어야 합니다.")
    students = get_class_students(class_id)
    student_ids = set()
    for student in students:
        for key in ("row_id", "Id"):
            value = student.get(key)
            if value is not None:
                student_ids.add(value)

    if not student_ids:
        return {"month": month, "days": {}}

    conn = get_db_connection()
    try:
        placeholders = ", ".join("?" for _ in student_ids)
        query = f'''
            SELECT sl."StudiedDay", sl."LessonContent", sl."Description",
                   s."Name" AS "StudentName", b."Title" AS "BookTitle"
            FROM "StudyLogs" sl
            LEFT JOIN "Students" s ON sl."StudentId" = s.rowid OR sl."StudentId" = s."Id"
            LEFT JOIN "Books" b ON sl."BookId" = b.rowid OR sl."BookId" = b."Id"
            WHERE sl."StudentId" IN ({placeholders})
              AND substr(sl."StudiedDay", 1, 7) = ?
            ORDER BY sl."StudiedDay", sl.rowid DESC
        '''
        cursor = conn.cursor()
        cursor.execute(query, [*student_ids, month])
        days: Dict[str, List[Dict[str, Any]]] = {}
        for row in cursor.fetchall():
            record = dict(row)
            days.setdefault(record["StudiedDay"], []).append({
                "student_name": record.get("StudentName") or "학생 정보 없음",
                "book_title": record.get("BookTitle") or "도서 정보 없음",
                "lesson_content": record.get("LessonContent") or "",
                "description": record.get("Description") or ""
            })
        return {"month": month, "days": days}
    finally:
        conn.close()

@app.post("/api/user/classes/{class_id}/studylogs")
def user_batch_register_class_studylogs(
    class_id: int,
    payload: ClassStudyLogBatchRequest,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    _get_accessible_class(class_id, current_user)

    if not payload.BookId or payload.BookId <= 0:
        raise HTTPException(status_code=400, detail="도서를 선택해 주세요.")
    if not payload.logs:
        raise HTTPException(status_code=400, detail="등록할 학생이 없습니다.")

    day = (payload.StudiedDay or "").strip()
    if not day or not re.match(r'^\d{4}-\d{2}-\d{2}$', day):
        raise HTTPException(status_code=400, detail="학습 일자는 YYYY-MM-DD 형식이어야 합니다.")
    lesson_content = (payload.LessonContent or "").strip()
    description = (payload.Description or "").strip()

    book_row = _resolve_domain_pk("Books", payload.BookId)
    if book_row is None:
        raise HTTPException(status_code=400, detail="해당 도서를 찾을 수 없습니다.")

    allowed_student_ids = set(get_class_student_ids(class_id))

    # 학생 이름 lookup 캐시
    name_cache: Dict[int, str] = {}

    def student_name(sid: int) -> str:
        if sid not in name_cache:
            conn = get_db_connection()
            try:
                cursor = conn.cursor()
                cursor.execute('SELECT "Name" FROM "Students" WHERE rowid = ? OR "Id" = ?', (sid, sid))
                row = cursor.fetchone()
                name_cache[sid] = row[0] if row else f"학생 #{sid}"
            finally:
                conn.close()
        return name_cache[sid]

    created_count = 0
    skipped_count = 0
    results = []

    for item in payload.logs:
        sid = item.StudentId
        name = student_name(sid)

        if not item.include:
            skipped_count += 1
            results.append({"StudentId": sid, "Name": name, "status": "skipped", "message": "결석 처리로 건너뜀"})
            continue

        if sid not in allowed_student_ids:
            results.append({"StudentId": sid, "Name": name, "status": "error", "message": "해당 수업에 배정되지 않은 학생입니다."})
            continue

        try:
            conn = get_db_connection()
            cursor = conn.cursor()
            cursor.execute(
                'SELECT COUNT(*) as cnt FROM "StudyLogs" WHERE "StudentId" = ? AND "BookId" = ? AND "StudiedDay" = ?',
                (sid, payload.BookId, day)
            )
            exists = cursor.fetchone()["cnt"] > 0
            conn.close()
            if exists:
                skipped_count += 1
                results.append({"StudentId": sid, "Name": name, "status": "duplicate", "message": "이미 등록된 학습 기록입니다."})
                continue

            res = insert_table_row("StudyLogs", {
                "StudentId": sid, "BookId": payload.BookId, "StudiedDay": day,
                "LessonContent": lesson_content, "Description": description,
                "IsSpecial": 1 if item.is_special else 0,
                "CreatedBy": current_user["username"]
            })
            new_snapshot = get_record_snapshot("StudyLogs", res.get("id"))
            _audit_insert("StudyLogs", res.get("id"), new_snapshot,
                          current_user["username"], current_user["role"])
            created_count += 1
            results.append({"StudentId": sid, "Name": name, "status": "created", "message": "등록 완료"})
        except Exception as e:
            results.append({"StudentId": sid, "Name": name, "status": "error", "message": f"등록 실패: {str(e)}"})

    return {
        "status": "success",
        "message": f"학습 이력 일괄 등록이 완료되었습니다. (등록 {created_count}건 / 건너뜀 {skipped_count}건)",
        "created_count": created_count,
        "skipped_count": skipped_count,
        "results": results
    }

# --- Domain Data Update/Delete APIs (관리 선생님 이상 전용) ---
def _resolve_domain_pk(table_name: str, id_val: Any) -> Optional[int]:
    """rowid 또는 Id 중 실제 행의 rowid를 찾는다. 없으면 None.
    INTEGER PRIMARY KEY 컬럼(Id)이 rowid 별칭이므로 결과 키가 'Id'로 나올 수 있어
    컬럼명 대신 인덱스(0)로 접근한다."""
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(f'SELECT rowid FROM "{table_name}" WHERE rowid = ? OR "Id" = ?', (id_val, id_val))
        row = cursor.fetchone()
        return row[0] if row else None
    finally:
        conn.close()

# --- 감사 로그(Audit Trail) 헬퍼 ---

def _audit_insert(table_name: str, record_id: Any, new_data: Optional[Dict[str, Any]],
                  username: str, role: str) -> None:
    """등록(INSERT) 감사 로그를 기록한다."""
    write_audit_log(table_name, record_id, "INSERT", None, new_data, None, username, role)

def _audit_update(table_name: str, record_id: Any, old_data: Optional[Dict[str, Any]],
                  new_data: Optional[Dict[str, Any]], username: str, role: str) -> None:
    """수정(UPDATE) 감사 로그를 기록한다. 변경된 필드 목록을 자동 추출한다."""
    changed = [k for k in (new_data or {}) if (old_data or {}).get(k) != (new_data or {}).get(k)]
    write_audit_log(table_name, record_id, "UPDATE", old_data, new_data, changed, username, role)

def _audit_delete(table_name: str, record_id: Any, old_data: Optional[Dict[str, Any]],
                  username: str, role: str) -> None:
    """삭제(DELETE) 감사 로그를 기록한다."""
    write_audit_log(table_name, record_id, "DELETE", old_data, None, None, username, role)

def _strip_user_password(user_dict: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """계정 정보에서 비밀번호 해시 등 민감정보를 제외한 데이터를 반환한다."""
    if not user_dict:
        return None
    return {k: v for k, v in user_dict.items() if k != "password_hash"}

def _parse_json_field(value: Any) -> Any:
    """감사 로그의 JSON 문자열 필드를 파싱한다. 파싱 불가 시 원본을 반환한다."""
    if not value:
        return None
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except Exception:
        return value

@app.put("/api/user/books/{book_id}")
def user_update_book(
    book_id: int,
    payload: RowDataRequest,
    current_user: Dict[str, Any] = Depends(get_current_staff)
):
    row_id = _resolve_domain_pk("Books", book_id)
    if row_id is None:
        raise HTTPException(status_code=404, detail="해당 도서를 찾을 수 없습니다.")
    try:
        old_snapshot = get_record_snapshot("Books", row_id)
        update_data = dict(payload.data)
        update_data["UpdatedBy"] = current_user["username"]
        update_data["UpdatedAt"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        res = update_table_row("Books", "rowid", row_id, update_data)
        new_snapshot = get_record_snapshot("Books", row_id)
        _audit_update("Books", row_id, old_snapshot, new_snapshot,
                      current_user["username"], current_user["role"])
        return {
            "status": "success",
            "message": "도서 정보가 성공적으로 수정되었습니다.",
            "updated_rows": res.get("updated_rows")
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"도서 수정 중 오류가 발생했습니다: {str(e)}")

@app.delete("/api/user/books/{book_id}")
def user_delete_book(
    book_id: int,
    current_user: Dict[str, Any] = Depends(get_current_staff)
):
    row_id = _resolve_domain_pk("Books", book_id)
    if row_id is None:
        raise HTTPException(status_code=404, detail="해당 도서를 찾을 수 없습니다.")
    try:
        old_snapshot = get_record_snapshot("Books", row_id)
        res = delete_table_row("Books", "rowid", row_id)
        _audit_delete("Books", row_id, old_snapshot,
                      current_user["username"], current_user["role"])
        return {
            "status": "success",
            "message": "도서가 성공적으로 삭제되었습니다.",
            "deleted_rows": res.get("deleted_rows")
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"도서 삭제 중 오류가 발생했습니다: {str(e)}")

@app.put("/api/user/students/{student_id}")
def user_update_student(
    student_id: int,
    payload: RowDataRequest,
    current_user: Dict[str, Any] = Depends(get_current_staff)
):
    row_id = _resolve_domain_pk("Students", student_id)
    if row_id is None:
        raise HTTPException(status_code=404, detail="해당 학생을 찾을 수 없습니다.")
    try:
        old_snapshot = get_record_snapshot("Students", row_id)
        update_data = dict(payload.data)
        update_data["UpdatedBy"] = current_user["username"]
        update_data["UpdatedAt"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        res = update_table_row("Students", "rowid", row_id, update_data)
        new_snapshot = get_record_snapshot("Students", row_id)
        _audit_update("Students", row_id, old_snapshot, new_snapshot,
                      current_user["username"], current_user["role"])
        return {
            "status": "success",
            "message": "학생 정보가 성공적으로 수정되었습니다.",
            "updated_rows": res.get("updated_rows")
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"학생 수정 중 오류가 발생했습니다: {str(e)}")

@app.delete("/api/user/students/{student_id}")
def user_delete_student(
    student_id: int,
    current_user: Dict[str, Any] = Depends(get_current_staff)
):
    row_id = _resolve_domain_pk("Students", student_id)
    if row_id is None:
        raise HTTPException(status_code=404, detail="해당 학생을 찾을 수 없습니다.")
    try:
        old_snapshot = get_record_snapshot("Students", row_id)
        res = delete_table_row("Students", "rowid", row_id)
        _audit_delete("Students", row_id, old_snapshot,
                      current_user["username"], current_user["role"])
        return {
            "status": "success",
            "message": "학생이 성공적으로 삭제되었습니다.",
            "deleted_rows": res.get("deleted_rows")
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"학생 삭제 중 오류가 발생했습니다: {str(e)}")

@app.put("/api/user/studylogs/{log_id}")
def user_update_studylog(
    log_id: int,
    payload: RowDataRequest,
    current_user: Dict[str, Any] = Depends(get_current_staff)
):
    row_id = _resolve_domain_pk("StudyLogs", log_id)
    if row_id is None:
        raise HTTPException(status_code=404, detail="해당 학습 기록을 찾을 수 없습니다.")
    try:
        old_snapshot = get_record_snapshot("StudyLogs", row_id)
        update_data = dict(payload.data)
        update_data["UpdatedBy"] = current_user["username"]
        update_data["UpdatedAt"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        res = update_table_row("StudyLogs", "rowid", row_id, update_data)
        new_snapshot = get_record_snapshot("StudyLogs", row_id)
        _audit_update("StudyLogs", row_id, old_snapshot, new_snapshot,
                      current_user["username"], current_user["role"])
        return {
            "status": "success",
            "message": "학습 기록이 성공적으로 수정되었습니다.",
            "updated_rows": res.get("updated_rows")
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"학습 기록 수정 중 오류가 발생했습니다: {str(e)}")

@app.delete("/api/user/studylogs/{log_id}")
def user_delete_studylog(
    log_id: int,
    current_user: Dict[str, Any] = Depends(get_current_staff)
):
    row_id = _resolve_domain_pk("StudyLogs", log_id)
    if row_id is None:
        raise HTTPException(status_code=404, detail="해당 학습 기록을 찾을 수 없습니다.")
    try:
        old_snapshot = get_record_snapshot("StudyLogs", row_id)
        res = delete_table_row("StudyLogs", "rowid", row_id)
        _audit_delete("StudyLogs", row_id, old_snapshot,
                      current_user["username"], current_user["role"])
        return {
            "status": "success",
            "message": "학습 기록이 성공적으로 삭제되었습니다.",
            "deleted_rows": res.get("deleted_rows")
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"학습 기록 삭제 중 오류가 발생했습니다: {str(e)}")

# --- Database & Table Metadata APIs (Admin Only) ---


@app.get("/api/tables")
def list_tables(current_user: Dict[str, Any] = Depends(get_current_user)):
    if current_user["role"] != "admin":
        return {"tables": []}
    tables = get_all_tables()
    return {"tables": tables}

@app.get("/api/tables/{table_name}/schema")
def table_schema(table_name: str, current_user: Dict[str, Any] = Depends(get_current_admin)):
    schema = get_table_schema(table_name)
    if not schema:
        raise HTTPException(status_code=404, detail="테이블을 찾을 수 없습니다.")
    return {"table_name": table_name, "columns": schema}

@app.get("/api/tables/{table_name}/data")
def table_data(
    table_name: str,
    page: int = Query(1, ge=1),
    limit: int = Query(30, ge=1, le=100),
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


# --- Admin User Management APIs (Admin Only) ---

def _resolve_target_user(user_id: int) -> Dict[str, Any]:
    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="해당 계정을 찾을 수 없습니다.")
    return user


@app.get("/api/admin/users")
def admin_list_users(current_admin: Dict[str, Any] = Depends(get_current_admin)):
    users = list_all_users()
    return {"users": users}


@app.post("/api/admin/users")
def admin_create_user(
    payload: UserCreateRequest,
    current_admin: Dict[str, Any] = Depends(get_current_admin)
):
    username = payload.username.strip()
    if not username:
        raise HTTPException(status_code=400, detail="아이디는 필수 입력 항목입니다.")
    if len(payload.password) < 4:
        raise HTTPException(status_code=400, detail="비밀번호는 4자 이상 입력해 주세요.")
    if payload.role not in ("manager", "teacher"):
        raise HTTPException(
            status_code=400,
            detail="발급 가능한 역할은 관리 선생님(manager) 또는 선생님(teacher)입니다."
        )

    try:
        res = create_user(username, payload.password, payload.role)
        user_row = _strip_user_password(get_user_by_id(res.get("id")))
        _audit_insert("_app_users", res.get("id"), user_row,
                      current_admin["username"], current_admin["role"])
        return {
            "status": "success",
            "message": f"'{username}' 계정이 성공적으로 발급되었습니다.",
            "id": res.get("id")
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.put("/api/admin/users/{user_id}/password")
def admin_reset_user_password(
    user_id: int,
    payload: UserPasswordResetRequest,
    current_admin: Dict[str, Any] = Depends(get_current_admin)
):
    if len(payload.password) < 4:
        raise HTTPException(status_code=400, detail="비밀번호는 4자 이상 입력해 주세요.")

    user = _resolve_target_user(user_id)
    if user["role"] == "admin":
        raise HTTPException(status_code=400, detail="관리자(admin) 계정은 비밀번호를 변경할 수 없습니다.")

    update_user_password(user_id, payload.password)
    write_audit_log("_app_users", user_id, "UPDATE", None, None, ["password_hash"],
                    current_admin["username"], current_admin["role"])
    return {"status": "success", "message": "비밀번호가 성공적으로 초기화되었습니다."}


@app.put("/api/admin/users/{user_id}/role")
def admin_update_user_role(
    user_id: int,
    payload: UserRoleUpdateRequest,
    current_admin: Dict[str, Any] = Depends(get_current_admin)
):
    if payload.role not in ("manager", "teacher"):
        raise HTTPException(
            status_code=400,
            detail="변경 가능한 역할은 관리 선생님(manager) 또는 선생님(teacher)입니다."
        )

    user = _resolve_target_user(user_id)
    if user["role"] == "admin":
        raise HTTPException(status_code=400, detail="관리자(admin) 계정의 역할은 변경할 수 없습니다.")

    update_user_role(user_id, payload.role)
    _audit_update("_app_users", user_id,
                  _strip_user_password(user),
                  _strip_user_password(get_user_by_id(user_id)),
                  current_admin["username"], current_admin["role"])
    return {"status": "success", "message": "계정 역할이 성공적으로 변경되었습니다."}


@app.delete("/api/admin/users/{user_id}")
def admin_delete_user(
    user_id: int,
    current_admin: Dict[str, Any] = Depends(get_current_admin)
):
    user = _resolve_target_user(user_id)
    if user["role"] == "admin":
        raise HTTPException(status_code=400, detail="관리자(admin) 계정은 삭제할 수 없습니다.")
    if current_admin["id"] == user_id:
        raise HTTPException(status_code=400, detail="자신의 계정은 삭제할 수 없습니다.")

    delete_user(user_id)
    _audit_delete("_app_users", user_id, _strip_user_password(user),
                  current_admin["username"], current_admin["role"])
    return {"status": "success", "message": "계정이 성공적으로 삭제되었습니다."}


# --- 감사 로그(Audit Trail) 조회 APIs (Admin Only) ---

@app.get("/api/admin/audit-logs/users")
def admin_audit_username_options(current_admin: Dict[str, Any] = Depends(get_current_admin)):
    """감사 로그 필터용 계정 목록을 반환한다."""
    return {"users": get_audit_username_options()}


@app.get("/api/admin/audit-logs")
def admin_list_audit_logs(
    username: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    table_name: Optional[str] = Query(None),
    action: Optional[str] = Query(None),
    record_id: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(30, ge=1, le=100),
    current_admin: Dict[str, Any] = Depends(get_current_admin)
):
    """계정별 변경 이력을 필터링해 조회한다. (계정·기간 필수 조합 지원)"""
    rows, total_count = get_audit_logs(
        table_name=table_name,
        record_id=record_id,
        username=username,
        action=action,
        date_from=date_from,
        date_to=date_to,
        page=page,
        limit=limit
    )
    for r in rows:
        r["old_data"] = _parse_json_field(r.get("old_data"))
        r["new_data"] = _parse_json_field(r.get("new_data"))
        r["changed_fields"] = _parse_json_field(r.get("changed_fields"))

    total_pages = (total_count + limit - 1) // limit if total_count > 0 else 1
    return {
        "logs": rows,
        "page": page,
        "limit": limit,
        "total_count": total_count,
        "total_pages": total_pages
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
