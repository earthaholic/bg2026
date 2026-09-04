import os
import io
import csv
import re
import json
from difflib import SequenceMatcher
from datetime import datetime, timedelta
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
    validate_class_student_assignments,
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

class StudyLogCsvRow(BaseModel):
    row_number: int
    student_name: str
    book_title: str
    studied_day: str
    lesson_content: Optional[str] = ""
    student_id: Optional[int] = None
    book_id: Optional[int] = None

class StudyLogCsvRequest(BaseModel):
    source_file: Optional[str] = ""
    rows: List[StudyLogCsvRow]

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

class BookMaterialRequestCreate(BaseModel):
    RequestType: str
    BookId: Optional[int] = None
    BookData: Optional[UserBookRegisterRequest] = None
    BookCategory: str
    MaterialFields: List[str]

class BookMaterialRequestReview(BaseModel):
    Status: str
    RejectReason: Optional[str] = ""

class BookMaterialPayRateRequest(BaseModel):
    BookCategory: str
    UnitAmount: int
    EffectiveFrom: str

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
    BookId: Optional[int] = None
    BookIds: Optional[List[int]] = []
    StudiedDay: str
    IsSpecial: Optional[bool] = False
    LessonContent: Optional[str] = ""
    Description: Optional[str] = ""
    ClassId: Optional[int] = None
    PayrollCategoryId: Optional[int] = None
    ActualTeacherUsername: Optional[str] = ""

class ClassRequest(BaseModel):
    ClassName: str
    TeacherUsername: str
    DayOfWeek: str
    StartTime: Optional[str] = ""
    StudentIds: List[int] = []
    StudentIsSpecial: Optional[Dict[int, bool]] = {}
    CategoryId: Optional[int] = None

class ClassCategoryRequest(BaseModel):
    CategoryId: int

class ClassStudyLogItem(BaseModel):
    StudentId: int
    include: bool = True
    is_special: bool = False
    Description: Optional[str] = ""

class ClassStudyLogBatchRequest(BaseModel):
    BookId: Optional[int] = None
    BookIds: Optional[List[int]] = []
    StudiedDay: str
    LessonContent: Optional[str] = ""
    logs: List[ClassStudyLogItem] = []
    ActualTeacherUsername: Optional[str] = ""
    IsCancelled: bool = False
    CancellationReason: Optional[str] = ""

class PayRateRequest(BaseModel):
    CategoryId: int
    GradeGroup: str
    UnitAmount: int
    EffectiveFrom: str

class SpecialLessonPayRateRequest(BaseModel):
    UnitAmount: int
    EffectiveFrom: str

class PayrollClaimRequest(BaseModel):
    PayrollMonth: str
    ClaimDate: str
    ItemName: str
    Amount: int
    Description: Optional[str] = ""
    TeacherUsername: Optional[str] = ""

class PayrollSessionTransferItem(BaseModel):
    ClassId: int
    StudiedDay: str

class PayrollSessionTransferRequest(BaseModel):
    PayrollMonth: str
    SourceTeacherUsername: str
    TargetTeacherUsername: str
    Sessions: List[PayrollSessionTransferItem]

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

# --- 도서·자료 제작 요청 / 승인 APIs ---
BOOK_MATERIAL_FIELDS = {
    "HasQuiz", "HasReadingQuestion", "HasReadingAnswer", "HasWritingQuestion",
    "HasWritingAnswer", "HasAdvancedMaterial", "HasDebateMaterial", "IsPdfExist"
}
BOOK_MATERIAL_CATEGORIES = {"picture": "그림책", "general": "일반 도서"}

def _book_material_request_dict(row: Any) -> Dict[str, Any]:
    data = dict(row)
    for key, default in (("BookData", {}), ("MaterialFields", [])):
        try:
            data[key] = json.loads(data.get(key) or json.dumps(default))
        except (TypeError, json.JSONDecodeError):
            data[key] = default
    data["BookCategoryLabel"] = BOOK_MATERIAL_CATEGORIES.get(data.get("BookCategory"), data.get("BookCategory", ""))
    return data

@app.get("/api/user/book-material-rates")
def get_book_material_rates(current_user: Dict[str, Any] = Depends(get_current_user)):
    conn = get_db_connection()
    try:
        return {"rates": [dict(r) for r in conn.execute('SELECT * FROM "BookMaterialPayRates" ORDER BY "BookCategory", "EffectiveFrom" DESC').fetchall()]}
    finally:
        conn.close()

@app.post("/api/user/book-material-rates")
def save_book_material_rate(payload: BookMaterialPayRateRequest, current_user: Dict[str, Any] = Depends(get_current_staff)):
    if payload.BookCategory not in BOOK_MATERIAL_CATEGORIES or payload.UnitAmount < 0 or not re.match(r'^\d{4}-\d{2}-\d{2}$', payload.EffectiveFrom):
        raise HTTPException(status_code=400, detail="자료 제작 단가 정보를 확인해 주세요.")
    conn = get_db_connection()
    try:
        conn.execute('INSERT OR REPLACE INTO "BookMaterialPayRates"("BookCategory","UnitAmount","EffectiveFrom") VALUES(?,?,?)', (payload.BookCategory, payload.UnitAmount, payload.EffectiveFrom))
        conn.commit()
        return {"status": "success", "message": "자료 제작 단가를 저장했습니다."}
    finally:
        conn.close()

@app.post("/api/user/book-material-requests")
def create_book_material_request(payload: BookMaterialRequestCreate, current_user: Dict[str, Any] = Depends(get_current_user)):
    if current_user.get("role") != "teacher":
        raise HTTPException(status_code=403, detail="도서·자료 요청은 일반 선생님 계정으로 등록해 주세요.")
    if payload.RequestType not in ("new_book", "material_add") or payload.BookCategory not in BOOK_MATERIAL_CATEGORIES:
        raise HTTPException(status_code=400, detail="요청 유형 또는 도서 분류를 확인해 주세요.")
    fields = sorted(set(payload.MaterialFields))
    if not fields or any(field not in BOOK_MATERIAL_FIELDS for field in fields):
        raise HTTPException(status_code=400, detail="추가할 자료 종류를 한 개 이상 선택해 주세요.")
    book_data: Dict[str, Any] = {}
    book_id = None
    if payload.RequestType == "new_book":
        if not payload.BookData or not payload.BookData.Title.strip():
            raise HTTPException(status_code=400, detail="새 도서 요청에는 도서명을 입력해 주세요.")
        book_data = payload.BookData.dict()
    else:
        if not payload.BookId or _resolve_domain_pk("Books", payload.BookId) is None:
            raise HTTPException(status_code=404, detail="자료를 추가할 도서를 찾을 수 없습니다.")
        book_id = _resolve_domain_pk("Books", payload.BookId)
    conn = get_db_connection()
    try:
        cursor = conn.execute('''INSERT INTO "BookMaterialRequests"("RequestType","BookId","BookData","BookCategory","MaterialFields","RequestedBy")
                                 VALUES(?,?,?,?,?,?)''', (payload.RequestType, book_id, json.dumps(book_data, ensure_ascii=False), payload.BookCategory, json.dumps(fields), current_user["username"]))
        conn.commit()
        return {"status": "success", "id": cursor.lastrowid, "message": "도서·자료 요청을 등록했습니다. 승인 후 도서와 정산에 반영됩니다."}
    finally:
        conn.close()

@app.get("/api/user/book-material-requests")
def list_book_material_requests(status_filter: Optional[str] = Query(None, alias="status"), current_user: Dict[str, Any] = Depends(get_current_user)):
    if status_filter and status_filter not in ("pending", "approved", "rejected"):
        raise HTTPException(status_code=400, detail="요청 상태를 확인해 주세요.")
    conn = get_db_connection()
    try:
        sql = '''SELECT r.*, b."Title" AS "BookTitle" FROM "BookMaterialRequests" r
                 LEFT JOIN "Books" b ON r."BookId"=b.rowid OR r."BookId"=b."Id"'''
        conditions, params = [], []
        if current_user["role"] == "teacher":
            conditions.append('r."RequestedBy"=?'); params.append(current_user["username"])
        if status_filter:
            conditions.append('r."Status"=?'); params.append(status_filter)
        if conditions: sql += " WHERE " + " AND ".join(conditions)
        sql += ' ORDER BY CASE r."Status" WHEN \'pending\' THEN 0 ELSE 1 END, r."CreatedAt" DESC'
        return {"requests": [_book_material_request_dict(row) for row in conn.execute(sql, params).fetchall()]}
    finally:
        conn.close()

@app.post("/api/user/book-material-requests/{request_id}/review")
def review_book_material_request(request_id: int, payload: BookMaterialRequestReview, current_user: Dict[str, Any] = Depends(get_current_staff)):
    if payload.Status not in ("approved", "rejected"):
        raise HTTPException(status_code=400, detail="승인 또는 반려 상태를 선택해 주세요.")
    if payload.Status == "rejected" and not (payload.RejectReason or "").strip():
        raise HTTPException(status_code=400, detail="반려 사유를 입력해 주세요.")
    conn = get_db_connection()
    try:
        request_row = conn.execute('SELECT * FROM "BookMaterialRequests" WHERE "Id"=?', (request_id,)).fetchone()
        if not request_row: raise HTTPException(status_code=404, detail="요청을 찾을 수 없습니다.")
        request_data = _book_material_request_dict(request_row)
        if request_data["Status"] != "pending": raise HTTPException(status_code=400, detail="이미 처리된 요청입니다.")
        now = datetime.now()
        reviewed_at, payroll_month = now.strftime("%Y-%m-%d %H:%M:%S"), now.strftime("%Y-%m")
        if payload.Status == "rejected":
            conn.execute('UPDATE "BookMaterialRequests" SET "Status"=?,"ReviewedBy"=?,"ReviewedAt"=?,"RejectReason"=? WHERE "Id"=?', ("rejected", current_user["username"], reviewed_at, payload.RejectReason.strip(), request_id))
            conn.commit(); return {"status": "success", "message": "요청을 반려했습니다."}
        if conn.execute('SELECT 1 FROM "TeacherPayrollClosures" WHERE "PayrollMonth"=? AND "TeacherUsername"=?', (payroll_month, request_data["RequestedBy"])).fetchone():
            raise HTTPException(status_code=400, detail="요청자의 승인월 정산이 이미 마감되어 승인할 수 없습니다.")
        rate = conn.execute('SELECT "UnitAmount" FROM "BookMaterialPayRates" WHERE "BookCategory"=? AND "EffectiveFrom"<=? ORDER BY "EffectiveFrom" DESC LIMIT 1', (request_data["BookCategory"], now.strftime("%Y-%m-%d"))).fetchone()
        if not rate: raise HTTPException(status_code=400, detail="승인일 기준 자료 제작 단가가 설정되어 있지 않습니다.")
        fields = request_data["MaterialFields"]
        if request_data["RequestType"] == "new_book":
            book_data = request_data["BookData"]
            book_data.update({field: 1 for field in fields})
            book_data["CreatedBy"] = request_data["RequestedBy"]
            columns = list(book_data.keys()); placeholders = ", ".join("?" for _ in columns)
            cursor = conn.execute(f'INSERT INTO "Books" ({", ".join(chr(34)+c+chr(34) for c in columns)}) VALUES ({placeholders})', [book_data[c] for c in columns])
            book_id = cursor.lastrowid
            new_snapshot = None
        else:
            book_id = request_data["BookId"]
            old_snapshot = dict(conn.execute('SELECT rowid AS row_id, * FROM "Books" WHERE rowid=?', (book_id,)).fetchone() or {})
            if not old_snapshot: raise HTTPException(status_code=404, detail="자료를 추가할 도서를 찾을 수 없습니다.")
            assignments = ", ".join(f'"{field}"=1' for field in fields) + ', "UpdatedBy"=?, "UpdatedAt"=?'
            conn.execute(f'UPDATE "Books" SET {assignments} WHERE rowid=?', [current_user["username"], reviewed_at, book_id])
            new_snapshot = None
        conn.execute('''UPDATE "BookMaterialRequests" SET "BookId"=?,"Status"='approved',"ReviewedBy"=?,"ReviewedAt"=?,"ApprovedAmount"=?,"PayrollMonth"=? WHERE "Id"=?''', (book_id, current_user["username"], reviewed_at, rate[0], payroll_month, request_id))
        conn.commit()
    finally:
        conn.close()
    snapshot = get_record_snapshot("Books", book_id)
    if request_data["RequestType"] == "new_book": _audit_insert("Books", book_id, snapshot, current_user["username"], current_user["role"])
    else: _audit_update("Books", book_id, old_snapshot, snapshot, current_user["username"], current_user["role"])
    return {"status": "success", "message": f"요청을 승인했습니다. {payroll_month} 정산에 {rate[0]:,}원이 반영됩니다."}

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
    unstudied_student_ids: Optional[str] = Query(None),
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

    # 선택된 학생 중 한 명이라도 학습한 도서는 제외한다. Students/StudyLogs가
    # rowid 또는 원본 Id를 참조하는 기존 데이터 모두를 지원한다.
    if unstudied_student_ids and unstudied_student_ids.strip():
        selected_rowids = [value.strip() for value in unstudied_student_ids.split(',') if value.strip().isdigit()]
        if selected_rowids:
            placeholders = ','.join('?' for _ in selected_rowids)
            cursor.execute(
                f'SELECT rowid AS row_id, "Id" FROM "Students" WHERE rowid IN ({placeholders})',
                selected_rowids
            )
            student_identity_values = []
            for student in cursor.fetchall():
                student_identity_values.extend([str(student['row_id']), str(student['Id'])])
            student_identity_values = list(dict.fromkeys(student_identity_values))
            if student_identity_values:
                identity_placeholders = ','.join('?' for _ in student_identity_values)
                conditions.append(
                    f'''NOT EXISTS (
                        SELECT 1 FROM "StudyLogs" sl
                        WHERE (sl."BookId" = "Books".rowid OR sl."BookId" = "Books"."Id")
                          AND CAST(sl."StudentId" AS TEXT) IN ({identity_placeholders})
                    )'''
                )
                params.extend(student_identity_values)

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

    # 일반 선생님은 본인 수업에 배정된 학생만 조회할 수 있다.
    if current_user.get("role") == "teacher":
        conditions.append('''EXISTS (
            SELECT 1
            FROM "ClassStudents" cs
            JOIN "Classes" c ON c."Id" = cs."ClassId"
            WHERE c."TeacherUsername" = ?
              AND (cs."StudentId" = "Students".rowid OR cs."StudentId" = "Students"."Id")
        )''')
        params.append(current_user["username"])

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
    if current_user.get("role") in ("admin", "subadmin", "manager"):
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
    conditions = []
    params = []
    if not include_ended:
        conditions.append('(COALESCE("IsClassEnded", 0) = 0)')
    # 일반 선생님은 본인 수업에 배정된 학생만 선택할 수 있다.
    if current_user.get("role") == "teacher":
        conditions.append('''EXISTS (
            SELECT 1
            FROM "ClassStudents" cs
            JOIN "Classes" c ON c."Id" = cs."ClassId"
            WHERE c."TeacherUsername" = ?
              AND (cs."StudentId" = "Students".rowid OR cs."StudentId" = "Students"."Id")
        )''')
        params.append(current_user["username"])
    where_clause = f' WHERE {" AND ".join(conditions)}' if conditions else ''
    cursor.execute(
        f'SELECT rowid as row_id, * FROM "Students"{where_clause} ORDER BY "Name" ASC',
        params
    )
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
    class_id: Optional[int] = Query(None),
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
        params.extend([pattern] * 4)

    if class_id is not None:
        _get_accessible_class(class_id, current_user)
        conds.append('''EXISTS (
            SELECT 1 FROM "ClassStudents" cs
            WHERE cs."ClassId" = ?
              AND (cs."StudentId" = "Students".rowid OR cs."StudentId" = "Students"."Id")
        )''')
        params.append(class_id)

    # 일반 선생님은 본인 수업에 배정된 학생만 검색할 수 있다.
    if current_user.get("role") == "teacher":
        conds.append('''EXISTS (
            SELECT 1
            FROM "ClassStudents" cs
            JOIN "Classes" c ON c."Id" = cs."ClassId"
            WHERE c."TeacherUsername" = ?
              AND (cs."StudentId" = "Students".rowid OR cs."StudentId" = "Students"."Id")
        )''')
        params.append(current_user["username"])

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
    current_user: Dict[str, Any] = Depends(get_current_user)
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
    target_book_ids = []
    for book_id in payload.BookIds or ([payload.BookId] if payload.BookId else []):
        if isinstance(book_id, int) and book_id > 0 and book_id not in target_book_ids:
            target_book_ids.append(book_id)
    if not target_book_ids:
        raise HTTPException(status_code=400, detail="학습할 도서를 1권 이상 선택해 주세요.")
    for book_id in target_book_ids:
        if _resolve_domain_pk("Books", book_id) is None:
            raise HTTPException(status_code=400, detail=f"해당 도서를 찾을 수 없습니다. (도서 #{book_id})")
    if not payload.StudiedDay or not payload.StudiedDay.strip():
        raise HTTPException(status_code=400, detail="학습 일자를 입력해 주세요.")

    studied_day = payload.StudiedDay.strip()
    if not re.match(r'^\d{4}-\d{2}-\d{2}$', studied_day):
        raise HTTPException(status_code=400, detail="학습 일자는 YYYY-MM-DD 형식이어야 합니다.")
    class_row = None
    actual_teacher = ""
    payroll_category_id = None
    if current_user.get("role") == "teacher" and not payload.ClassId:
        raise HTTPException(status_code=400, detail="일반 선생님은 본인 담당 수업을 선택해야 합니다.")
    if payload.ClassId:
        class_row = _get_accessible_class(payload.ClassId, current_user)
        allowed_student_ids = {
            student_id
            for student in get_class_students(payload.ClassId)
            for student_id in (student.get("row_id"), student.get("Id"))
            if student_id is not None
        }
        invalid_students = [sid for sid in target_student_ids if sid not in allowed_student_ids]
        if invalid_students:
            raise HTTPException(status_code=400, detail="선택한 수업에 배정되지 않은 학생이 포함되어 있습니다.")
        actual_teacher = class_row["TeacherUsername"] if current_user.get("role") == "teacher" else ((payload.ActualTeacherUsername or "").strip() or class_row["TeacherUsername"])
        teacher = get_user_by_username(actual_teacher)
        if not teacher or teacher.get("role") not in ("teacher", "manager"):
            raise HTTPException(status_code=400, detail="실제 진행 선생님 계정을 확인해 주세요.")
        conn = get_db_connection()
        try:
            if conn.execute('SELECT 1 FROM "TeacherPayrollClosures" WHERE "PayrollMonth"=? AND "TeacherUsername"=?',
                            (studied_day[:7], actual_teacher)).fetchone():
                raise HTTPException(status_code=409, detail="실제 진행 선생님의 해당 월 정산이 마감되어 학습 이력을 등록할 수 없습니다.")
        finally:
            conn.close()
    else:
        actual_teacher = (payload.ActualTeacherUsername or "").strip()
        if actual_teacher:
            teacher = get_user_by_username(actual_teacher)
            if not teacher or teacher.get("role") not in ("teacher", "manager"):
                raise HTTPException(status_code=400, detail="실제 진행 선생님 계정을 확인해 주세요.")
        if payload.PayrollCategoryId:
            conn = get_db_connection()
            try:
                category = conn.execute(
                    'SELECT "Id" FROM "ClassCategories" WHERE "Id" = ? AND "IsActive" = 1',
                    (payload.PayrollCategoryId,)
                ).fetchone()
            finally:
                conn.close()
            if not category:
                raise HTTPException(status_code=400, detail="사용 가능한 정산 카테고리를 선택해 주세요.")
            if not actual_teacher:
                raise HTTPException(status_code=400, detail="정산 카테고리를 지정하려면 실제 진행 선생님을 선택해 주세요.")
            payroll_category_id = payload.PayrollCategoryId
            conn = get_db_connection()
            try:
                if conn.execute('SELECT 1 FROM "TeacherPayrollClosures" WHERE "PayrollMonth"=? AND "TeacherUsername"=?',
                                (studied_day[:7], actual_teacher)).fetchone():
                    raise HTTPException(status_code=409, detail="실제 진행 선생님의 해당 월 정산이 마감되어 학습 이력을 등록할 수 없습니다.")
            finally:
                conn.close()

    created_log_ids = []
    try:
        for s_id in target_student_ids:
            for book_id in target_book_ids:
                log_data = {
                    "StudentId": s_id,
                    "BookId": book_id,
                    "StudiedDay": studied_day,
                    "IsSpecial": 1 if payload.IsSpecial else 0,
                    "LessonContent": (payload.LessonContent or "").strip(),
                    "Description": (payload.Description or "").strip(),
                    "ClassId": payload.ClassId if class_row else None,
                    "PayrollCategoryId": payroll_category_id,
                    "ActualTeacherUsername": actual_teacher,
                    "SubstituteStatus": "approved" if class_row or payroll_category_id else "",
                    "GradeSnapshot": _student_grade(s_id) if class_row or payroll_category_id else "",
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
            "message": f"학습 기록 {count}건이 성공적으로 수록되었습니다.",
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

    # 일반 선생님은 본인 수업에 배정된 학생의 학습 기록만 조회할 수 있다.
    if current_user.get("role") == "teacher":
        conditions.append('''EXISTS (
            SELECT 1
            FROM "ClassStudents" cs
            JOIN "Classes" c ON c."Id" = cs."ClassId"
            WHERE c."TeacherUsername" = ?
              AND (cs."StudentId" = sl."StudentId"
                   OR cs."StudentId" = s.rowid
                   OR cs."StudentId" = s."Id")
        )''')
        params.append(current_user["username"])

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
               b.HasAdvancedMaterial, b.HasDebateMaterial, b.IsPaperbookExist, b.IsPdfExist, b.IsYes24Exist, b.IsMillieExist, b.Desc as BookDesc,
               c."ClassName", COALESCE(cc."Name", pc."Name") AS "PayrollCategoryName"
        FROM "StudyLogs" sl
        LEFT JOIN "Students" s ON sl.StudentId = s.rowid OR sl.StudentId = s.Id
        LEFT JOIN "Books" b ON sl.BookId = b.rowid OR sl.BookId = b.Id
        LEFT JOIN "Classes" c ON sl."ClassId" = c."Id"
        LEFT JOIN "ClassCategories" cc ON c."CategoryId" = cc."Id"
        LEFT JOIN "ClassCategories" pc ON sl."PayrollCategoryId" = pc."Id"
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

class MonthlyReportSavePayload(BaseModel):
    student_id: int
    report_year_month: str
    period_label: Optional[str] = ""
    report_month_label: Optional[str] = ""
    start_lecture_num: Optional[int] = 1
    special_teacher_name: Optional[str] = ""
    logs: List[Dict[str, Any]] = []
    content: str
    status: str = "draft"

def _get_monthly_report_student(cursor, student_id: int, current_user: Dict[str, Any]):
    cursor.execute('SELECT rowid AS row_id, * FROM "Students" WHERE rowid = ? OR "Id" = ?', (student_id, student_id))
    student = cursor.fetchone()
    if not student:
        raise HTTPException(status_code=404, detail="해당 학생을 찾을 수 없습니다.")
    student_data = dict(student)
    if current_user.get("role") == "teacher":
        cursor.execute('''SELECT 1 FROM "ClassStudents" cs JOIN "Classes" c ON c."Id" = cs."ClassId"
                          WHERE c."TeacherUsername" = ? AND (cs."StudentId" = ? OR cs."StudentId" = ?) LIMIT 1''',
                       (current_user["username"], student_data["row_id"], student_data.get("Id", student_data["row_id"])))
        if not cursor.fetchone():
            raise HTTPException(status_code=403, detail="본인 수업에 배정된 학생의 월말보고만 이용할 수 있습니다.")
    return student_data

def _monthly_report_response(row: Any) -> Dict[str, Any]:
    item = dict(row)
    try:
        item["StudyLogSnapshot"] = json.loads(item.get("StudyLogSnapshot") or "[]")
    except (TypeError, json.JSONDecodeError):
        item["StudyLogSnapshot"] = []
    return item

def _get_monthly_report_start_lecture(student: Dict[str, Any], first_studied_day: str) -> Dict[str, Any]:
    """선택한 첫 수업일 직전까지 사용한 일반 수업 차시를 기준으로 시작 번호를 계산한다."""
    try:
        datetime.strptime(first_studied_day, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="학습 일자가 올바르지 않습니다.")

    student_row_id = student["row_id"]
    student_id = student.get("Id", student_row_id)
    student_name = student.get("Name", "")
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute('''SELECT rowid AS row_id, * FROM "TuitionPayments"
                          WHERE ("StudentId" = ? OR "StudentId" = ?) AND "StartDate" <= ?
                          ORDER BY "StartDate", rowid''',
                       (student_row_id, student_id, first_studied_day))
        payments = [dict(row) for row in cursor.fetchall()]
        if not payments:
            return {"has_payment": False, "start_lecture_num": None, "used_before": 0}

        earliest_start = payments[0]["StartDate"]
        cursor.execute('''SELECT rowid AS row_id, "StudiedDay", COALESCE("LessonContent", '') AS "LessonContent"
                          FROM "StudyLogs"
                          WHERE ("StudentId" = ? OR "StudentId" = ? OR "StudentId" = ? OR "StudentId" = ?)
                            AND "StudiedDay" >= ? AND "StudiedDay" < ?
                            AND COALESCE("IsSpecial", 0) = 0
                          ORDER BY "StudiedDay", rowid''',
                       (student_row_id, str(student_row_id), student_id, student_name,
                        earliest_start, first_studied_day))
        seen_sessions = set()
        used_before = 0
        for row in cursor.fetchall():
            lesson_content = (row["LessonContent"] or "").strip()
            key = (row["StudiedDay"], lesson_content) if lesson_content else ("__single__", row["row_id"])
            if key not in seen_sessions:
                seen_sessions.add(key)
                used_before += 1
        total_lessons = sum((payment.get("PaidLessons") or 0) + (payment.get("ServiceLessons") or 0) for payment in payments)
        return {
            "has_payment": True,
            "start_lecture_num": used_before + 1,
            "used_before": used_before,
            "total_lessons": total_lessons,
            "earliest_start": earliest_start
        }
    finally:
        conn.close()

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

    # 같은 날짜·수업 내용·특강 여부의 기록은 여러 도서를 사용했더라도 한 강으로 묶는다.
    grouped_logs: List[Dict[str, Any]] = []
    grouped_by_key: Dict[Any, Dict[str, Any]] = {}
    for log_index, log in enumerate(logs):
        studied_day = str(log.get("StudiedDay") or log.get("studied_day") or "").strip()
        lesson_content = str(log.get("LessonContent") or log.get("lesson_content") or log.get("Description") or "").strip()
        is_special = bool(log.get("IsSpecial") or log.get("is_special"))
        key = (studied_day, lesson_content, is_special) if studied_day and lesson_content else ("__single__", log_index)
        if key not in grouped_by_key:
            grouped = dict(log)
            grouped["_book_titles"] = []
            grouped_by_key[key] = grouped
            grouped_logs.append(grouped)
        title = str(log.get("BookTitle") or log.get("book_title") or log.get("Title") or "").strip()
        if title and title not in grouped_by_key[key]["_book_titles"]:
            grouped_by_key[key]["_book_titles"].append(title)

    current_lecture = start_lecture_num or 1
    teacher_suffix = (special_teacher_name or "").strip()
    if teacher_suffix and not teacher_suffix.endswith("선생님"):
        teacher_suffix += " 선생님"

    for i, log in enumerate(grouped_logs):
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

        book_titles = log.get("_book_titles") or []
        lines.append(f"도서 : {', '.join(book_titles)}")

        date_str = _format_date_korean(log.get("StudiedDay") or log.get("studied_day") or "")
        lesson_content = (log.get("LessonContent") or log.get("lesson_content") or log.get("Description") or "").strip()
        if date_str and lesson_content:
            lines.append(f"{date_str} {lesson_content}")
        elif date_str:
            lines.append(f"{date_str}")
        elif lesson_content:
            lines.append(f"{lesson_content}")

    return "\n".join(lines)

@app.get("/api/user/monthly-report/default-period")
def user_get_monthly_report_default_period(
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """서버 날짜에 따라 월말에는 이번 달, 그 외에는 지난달 기간을 반환한다."""
    today = datetime.now().date()
    first_day_of_this_month = today.replace(day=1)
    last_day_of_this_month = (first_day_of_this_month + timedelta(days=32)).replace(day=1) - timedelta(days=1)
    is_month_end = today >= last_day_of_this_month - timedelta(days=3)

    if is_month_end:
        date_from = first_day_of_this_month
        date_to = last_day_of_this_month
    else:
        date_to = first_day_of_this_month - timedelta(days=1)
        date_from = date_to.replace(day=1)

    return {
        "date_from": date_from.isoformat(),
        "date_to": date_to.isoformat()
    }

@app.get("/api/user/monthly-report/studylogs")
def user_get_monthly_report_studylogs(
    student_id: int = Query(...),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
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

    # 일반 선생님은 본인 수업에 배정된 학생의 월말보고만 조회할 수 있다.
    if current_user.get("role") == "teacher":
        cursor.execute('''
            SELECT 1
            FROM "ClassStudents" cs
            JOIN "Classes" c ON c."Id" = cs."ClassId"
            WHERE c."TeacherUsername" = ?
              AND (cs."StudentId" = ? OR cs."StudentId" = ?)
            LIMIT 1
        ''', (current_user["username"], s_row_id, s_id))
        if not cursor.fetchone():
            conn.close()
            raise HTTPException(status_code=403, detail="본인 수업에 배정된 학생의 월말보고만 조회할 수 있습니다.")

    query = '''
        SELECT sl.rowid as row_id, sl.*, 
               b.Title as BookTitle, b.Author as BookAuthor, b.Publisher as BookPublisher
        FROM "StudyLogs" sl
        LEFT JOIN "Books" b ON sl.BookId = b.rowid OR sl.BookId = b.Id
        WHERE (sl.StudentId = ? OR sl.StudentId = ? OR sl.StudentId = ? OR sl.StudentId = ?)
    '''
    params = [s_row_id, str(s_row_id), s_id, s_name]
    if date_from:
        query += ' AND sl.StudiedDay >= ?'
        params.append(date_from)
    if date_to:
        query += ' AND sl.StudiedDay <= ?'
        params.append(date_to)
    query += ' ORDER BY sl.StudiedDay DESC, sl.rowid DESC'
    cursor.execute(query, params)
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

@app.get("/api/user/monthly-reports")
def user_list_monthly_reports(
    student_id: Optional[int] = Query(None),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    conn = get_db_connection()
    cursor = conn.cursor()
    params: List[Any] = []
    where = []
    if student_id is not None:
        student = _get_monthly_report_student(cursor, student_id, current_user)
        where.append('mr."StudentId" = ?')
        params.append(student["row_id"])
    if current_user.get("role") == "teacher":
        where.append('EXISTS (SELECT 1 FROM "ClassStudents" cs JOIN "Classes" c ON c."Id" = cs."ClassId" WHERE c."TeacherUsername" = ? AND (cs."StudentId" = s.rowid OR cs."StudentId" = s."Id"))')
        params.append(current_user["username"])
    sql = '''SELECT mr.*, s."Name" AS "StudentName" FROM "MonthlyReports" mr
             LEFT JOIN "Students" s ON mr."StudentId" = s.rowid'''
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += ' ORDER BY mr."ReportYearMonth" DESC, mr."UpdatedAt" DESC, mr."Id" DESC LIMIT 100'
    cursor.execute(sql, params)
    reports = [_monthly_report_response(row) for row in cursor.fetchall()]
    conn.close()
    return {"reports": reports}

@app.get("/api/user/monthly-reports/{report_id}")
def user_get_monthly_report(report_id: int, current_user: Dict[str, Any] = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT mr.*, s."Name" AS "StudentName" FROM "MonthlyReports" mr LEFT JOIN "Students" s ON mr."StudentId" = s.rowid WHERE mr."Id" = ?', (report_id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="저장된 월말보고를 찾을 수 없습니다.")
    _get_monthly_report_student(cursor, row["StudentId"], current_user)
    result = _monthly_report_response(row)
    conn.close()
    return {"report": result}

@app.post("/api/user/monthly-reports")
def user_save_monthly_report(payload: MonthlyReportSavePayload, current_user: Dict[str, Any] = Depends(get_current_user)):
    if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", (payload.report_year_month or "").strip()):
        raise HTTPException(status_code=400, detail="보고 월을 올바르게 선택해 주세요.")
    if payload.status not in ("draft", "completed"):
        raise HTTPException(status_code=400, detail="저장 상태가 올바르지 않습니다.")
    if not payload.content.strip():
        raise HTTPException(status_code=400, detail="저장할 문자 내용을 입력해 주세요.")
    conn = get_db_connection()
    cursor = conn.cursor()
    student = _get_monthly_report_student(cursor, payload.student_id, current_user)
    student_id = student["row_id"]
    cursor.execute('SELECT * FROM "MonthlyReports" WHERE "StudentId" = ? AND "ReportYearMonth" = ?', (student_id, payload.report_year_month))
    old_row = cursor.fetchone()
    old_data = dict(old_row) if old_row else None
    snapshot = json.dumps(payload.logs, ensure_ascii=False)
    username = current_user["username"]
    if old_row:
        cursor.execute('''UPDATE "MonthlyReports" SET "PeriodLabel"=?, "ReportMonthLabel"=?, "StartLectureNum"=?,
                          "SpecialTeacherName"=?, "StudyLogSnapshot"=?, "Content"=?, "Status"=?, "UpdatedBy"=?,
                          "UpdatedAt"=datetime('now','localtime') WHERE "Id"=?''',
                       (payload.period_label, payload.report_month_label, max(1, payload.start_lecture_num or 1),
                        payload.special_teacher_name, snapshot, payload.content, payload.status, username, old_row["Id"]))
        report_id = old_row["Id"]
        action = "UPDATE"
    else:
        cursor.execute('''INSERT INTO "MonthlyReports" ("StudentId","ReportYearMonth","PeriodLabel","ReportMonthLabel",
                          "StartLectureNum","SpecialTeacherName","StudyLogSnapshot","Content","Status","CreatedBy","UpdatedBy","UpdatedAt")
                          VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now','localtime'))''',
                       (student_id, payload.report_year_month, payload.period_label, payload.report_month_label,
                        max(1, payload.start_lecture_num or 1), payload.special_teacher_name, snapshot, payload.content,
                        payload.status, username, username))
        report_id = cursor.lastrowid
        action = "INSERT"
    conn.commit()
    cursor.execute('SELECT mr.*, s."Name" AS "StudentName" FROM "MonthlyReports" mr LEFT JOIN "Students" s ON mr."StudentId" = s.rowid WHERE mr."Id"=?', (report_id,))
    new_data = dict(cursor.fetchone())
    conn.close()
    changed = [key for key in new_data if not old_data or old_data.get(key) != new_data.get(key)]
    write_audit_log("MonthlyReports", report_id, action, old_data, new_data, changed if action == "UPDATE" else None,
                    username, current_user.get("role", ""))
    return {"report": _monthly_report_response(new_data), "message": "월말보고가 저장되었습니다."}

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

    if payload.CategoryId is None:
        raise HTTPException(status_code=400, detail="수업 카테고리를 선택해 주세요.")
    conn = get_db_connection()
    try:
        category = conn.execute(
            'SELECT 1 FROM "ClassCategories" WHERE "Id" = ? AND "IsActive" = 1',
            (payload.CategoryId,)
        ).fetchone()
        if not category:
            raise HTTPException(status_code=400, detail="사용 가능한 수업 카테고리를 선택해 주세요.")
    finally:
        conn.close()

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
        validate_class_student_assignments(None, _class_student_items(payload))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
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
        validate_class_student_assignments(class_id, _class_student_items(payload))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
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

@app.put("/api/user/classes/{class_id}/category")
def user_update_class_category(
    class_id: int,
    payload: ClassCategoryRequest,
    current_user: Dict[str, Any] = Depends(get_current_staff)
):
    class_row = get_class_by_id(class_id)
    if not class_row:
        raise HTTPException(status_code=404, detail="해당 수업을 찾을 수 없습니다.")
    conn = get_db_connection()
    try:
        category = conn.execute(
            'SELECT "Name" FROM "ClassCategories" WHERE "Id" = ? AND "IsActive" = 1',
            (payload.CategoryId,)
        ).fetchone()
        if not category:
            raise HTTPException(status_code=400, detail="사용 가능한 수업 카테고리를 선택해 주세요.")
    finally:
        conn.close()
    old_snapshot = get_record_snapshot("Classes", class_id)
    update_class(class_id, {
        "CategoryId": payload.CategoryId,
        "UpdatedBy": current_user["username"],
        "UpdatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    })
    new_snapshot = get_record_snapshot("Classes", class_id)
    _audit_update("Classes", class_id, old_snapshot, new_snapshot,
                  current_user["username"], current_user["role"])
    return {"status": "success", "message": f"'{class_row['ClassName']}' 수업의 카테고리를 '{category['Name']}'(으)로 저장했습니다."}

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
    class_row = _get_accessible_class(class_id, current_user)
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
        cancellation_rows = cursor.execute('''
            SELECT "Id", "CancelledDay", "Reason", "CreatedAt", "CreatedBy"
            FROM "ClassCancellations"
            WHERE "ClassId" = ? AND substr("CancelledDay", 1, 7) = ?
            ORDER BY "CancelledDay", "Id" DESC
        ''', (class_id, month)).fetchall()
        cancellations = {
            row["CancelledDay"]: dict(row)
            for row in cancellation_rows
        }
        return {"month": month, "days": days, "cancellations": cancellations}
    finally:
        conn.close()

@app.get("/api/user/classes/{class_id}/studylog-date-warning")
def user_get_class_studylog_date_warning(
    class_id: int,
    studied_day: str = Query(...),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """일괄 등록일의 주차 오입력 가능성을 확인한다."""
    _get_accessible_class(class_id, current_user)
    try:
        selected_day = datetime.strptime(studied_day, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="학습 일자는 YYYY-MM-DD 형식이어야 합니다.")

    student_ids = set(get_class_student_ids(class_id))
    previous_week_day = (selected_day - timedelta(days=7)).isoformat()
    two_weeks_ago_day = (selected_day - timedelta(days=14)).isoformat()
    if not student_ids:
        return {"should_warn": False}

    conn = get_db_connection()
    try:
        placeholders = ", ".join("?" for _ in student_ids)
        query = f'''
            SELECT "StudiedDay", COUNT(*) AS count
            FROM "StudyLogs"
            WHERE "StudentId" IN ({placeholders})
              AND "StudiedDay" IN (?, ?)
            GROUP BY "StudiedDay"
        '''
        rows = conn.execute(query, [*student_ids, previous_week_day, two_weeks_ago_day]).fetchall()
        counts = {row["StudiedDay"]: row["count"] for row in rows}
        previous_week_count = counts.get(previous_week_day, 0)
        two_weeks_ago_count = counts.get(two_weeks_ago_day, 0)
        return {
            "should_warn": two_weeks_ago_count > 0 and previous_week_count == 0,
            "previous_week_day": previous_week_day,
            "previous_week_count": previous_week_count,
            "two_weeks_ago_day": two_weeks_ago_day,
            "two_weeks_ago_count": two_weeks_ago_count
        }
    finally:
        conn.close()

@app.post("/api/user/classes/{class_id}/studylogs")
def user_batch_register_class_studylogs(
    class_id: int,
    payload: ClassStudyLogBatchRequest,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    class_row = _get_accessible_class(class_id, current_user)

    day = (payload.StudiedDay or "").strip()
    if not day or not re.match(r'^\d{4}-\d{2}-\d{2}$', day):
        raise HTTPException(status_code=400, detail="학습 일자는 YYYY-MM-DD 형식이어야 합니다.")

    if payload.IsCancelled:
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            existing = cursor.execute(
                'SELECT "Id" FROM "ClassCancellations" WHERE "ClassId" = ? AND "CancelledDay" = ?',
                (class_id, day)
            ).fetchone()
            if existing:
                raise HTTPException(status_code=409, detail="해당 날짜는 이미 휴강으로 등록되어 있습니다.")
            studylog_exists = cursor.execute(
                'SELECT 1 FROM "StudyLogs" WHERE "ClassId" = ? AND "StudiedDay" = ? LIMIT 1',
                (class_id, day)
            ).fetchone()
            if studylog_exists:
                raise HTTPException(status_code=409, detail="해당 날짜에 이미 학습 이력이 등록되어 있어 휴강으로 바꿀 수 없습니다.")
            cursor.execute('''
                INSERT INTO "ClassCancellations" ("ClassId", "CancelledDay", "Reason", "CreatedBy")
                VALUES (?, ?, ?, ?)
            ''', (class_id, day, (payload.CancellationReason or "").strip(), current_user["username"]))
            cancellation_id = cursor.lastrowid
            conn.commit()
        finally:
            conn.close()
        _audit_insert("ClassCancellations", cancellation_id,
                      get_record_snapshot("ClassCancellations", cancellation_id),
                      current_user["username"], current_user["role"])
        return {
            "status": "success",
            "message": f"{day} 휴강이 등록되었습니다.",
            "is_cancelled": True,
            "cancellation_id": cancellation_id,
            "created_count": 0,
            "skipped_count": 0,
            "results": []
        }

    book_ids = list(dict.fromkeys(
        book_id for book_id in (payload.BookIds or ([payload.BookId] if payload.BookId else []))
        if book_id and book_id > 0
    ))
    if not book_ids:
        raise HTTPException(status_code=400, detail="도서를 선택해 주세요.")
    if not payload.logs:
        raise HTTPException(status_code=400, detail="등록할 학생이 없습니다.")
    conn = get_db_connection()
    try:
        is_cancelled_day = conn.execute(
            'SELECT 1 FROM "ClassCancellations" WHERE "ClassId" = ? AND "CancelledDay" = ?',
            (class_id, day)
        ).fetchone()
        if is_cancelled_day:
            raise HTTPException(status_code=409, detail="해당 날짜는 휴강으로 등록되어 있어 학습 이력을 추가할 수 없습니다.")
    finally:
        conn.close()
    lesson_content = (payload.LessonContent or "").strip()
    actual_teacher = (payload.ActualTeacherUsername or "").strip()
    if actual_teacher and actual_teacher != class_row["TeacherUsername"]:
        teacher = get_user_by_username(actual_teacher)
        if not teacher or teacher["role"] not in ("teacher", "manager"):
            raise HTTPException(status_code=400, detail="대체 진행 선생님 계정을 확인해 주세요.")
        if current_user["role"] not in ("admin", "subadmin", "manager"):
            raise HTTPException(status_code=403, detail="다른 선생님을 실제 진행자로 지정하는 작업은 관리 선생님 이상만 가능합니다.")
    else:
        actual_teacher = class_row["TeacherUsername"]
    conn = get_db_connection()
    try:
        if conn.execute('SELECT 1 FROM "TeacherPayrollClosures" WHERE "PayrollMonth"=? AND "TeacherUsername"=?',
                        (day[:7], actual_teacher)).fetchone():
            raise HTTPException(status_code=409, detail="실제 진행 선생님의 해당 월 정산이 마감되어 학습 이력을 등록할 수 없습니다.")
    finally:
        conn.close()
    book_names: Dict[int, str] = {}
    for book_id in book_ids:
        book_row = _resolve_domain_pk("Books", book_id)
        if book_row is None:
            raise HTTPException(status_code=400, detail=f"해당 도서를 찾을 수 없습니다. (도서 #{book_id})")
        snapshot = get_record_snapshot("Books", book_row) or {}
        book_names[book_id] = snapshot.get("Title") or f"도서 #{book_id}"

    allowed_student_ids = set(get_class_student_ids(class_id))

    # 학생 이름 lookup 캐시
    name_cache: Dict[int, str] = {}

    def student_name(sid: int) -> str:
        if sid not in name_cache:
            conn = get_db_connection()
            try:
                cursor = conn.cursor()
                cursor.execute('SELECT "Name", "Grade" FROM "Students" WHERE rowid = ? OR "Id" = ?', (sid, sid))
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

        for book_id in book_ids:
            book_title = book_names[book_id]
            try:
                conn = get_db_connection()
                cursor = conn.cursor()
                cursor.execute(
                    'SELECT COUNT(*) as cnt FROM "StudyLogs" WHERE "StudentId" = ? AND "BookId" = ? AND "StudiedDay" = ?',
                    (sid, book_id, day)
                )
                exists = cursor.fetchone()["cnt"] > 0
                conn.close()
                if exists:
                    skipped_count += 1
                    results.append({"StudentId": sid, "Name": name, "BookId": book_id, "BookTitle": book_title, "status": "duplicate", "message": "이미 등록된 학습 기록입니다."})
                    continue

                res = insert_table_row("StudyLogs", {
                    "StudentId": sid, "BookId": book_id, "StudiedDay": day,
                    "LessonContent": lesson_content, "Description": (item.Description or "").strip(),
                    "IsSpecial": 1 if item.is_special else 0, "ClassId": class_id,
                    "ActualTeacherUsername": actual_teacher,
                    "SubstituteStatus": "approved",
                    "GradeSnapshot": _student_grade(sid),
                    "CreatedBy": current_user["username"]
                })
                new_snapshot = get_record_snapshot("StudyLogs", res.get("id"))
                _audit_insert("StudyLogs", res.get("id"), new_snapshot,
                              current_user["username"], current_user["role"])
                created_count += 1
                results.append({"StudentId": sid, "Name": name, "BookId": book_id, "BookTitle": book_title, "status": "created", "message": "등록 완료"})
            except Exception as e:
                results.append({"StudentId": sid, "Name": name, "BookId": book_id, "BookTitle": book_title, "status": "error", "message": f"등록 실패: {str(e)}"})

    return {
        "status": "success",
        "message": f"학습 이력 일괄 등록이 완료되었습니다. (등록 {created_count}건 / 건너뜀 {skipped_count}건)",
        "created_count": created_count,
        "skipped_count": skipped_count,
        "results": results
    }

@app.get("/api/user/monthly-report/start-lecture")
def user_get_monthly_report_start_lecture(
    student_id: int = Query(...),
    first_studied_day: str = Query(...),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    conn = get_db_connection()
    try:
        student = _get_monthly_report_student(conn.cursor(), student_id, current_user)
    finally:
        conn.close()
    return _get_monthly_report_start_lecture(student, first_studied_day)

@app.delete("/api/user/classes/{class_id}/cancellations/{cancellation_id}")
def user_delete_class_cancellation(
    class_id: int,
    cancellation_id: int,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """잘못 등록한 휴강을 해제한다. 선생님은 본인 수업만 해제할 수 있다."""
    _get_accessible_class(class_id, current_user)
    conn = get_db_connection()
    try:
        row = conn.execute(
            'SELECT rowid FROM "ClassCancellations" WHERE "Id" = ? AND "ClassId" = ?',
            (cancellation_id, class_id)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="해당 휴강 기록을 찾을 수 없습니다.")
        old_snapshot = get_record_snapshot("ClassCancellations", row["rowid"])
        conn.execute('DELETE FROM "ClassCancellations" WHERE rowid = ?', (row["rowid"],))
        conn.commit()
    finally:
        conn.close()
    _audit_delete("ClassCancellations", cancellation_id, old_snapshot,
                  current_user["username"], current_user["role"])
    return {"status": "success", "message": "휴강 등록이 해제되었습니다."}

# --- 선생님 급여 정산 API ---
@app.get("/api/user/payroll/categories")
def payroll_categories(current_user: Dict[str, Any] = Depends(get_current_user)):
    conn=get_db_connection()
    try: return {"categories":[dict(r) for r in conn.execute('SELECT * FROM "ClassCategories" WHERE "IsActive"=1 ORDER BY "Name"').fetchall()]}
    finally: conn.close()

@app.post("/api/user/payroll/categories")
def create_payroll_category(name: str, current_user: Dict[str, Any] = Depends(get_current_staff)):
    if not name.strip(): raise HTTPException(status_code=400, detail="카테고리명을 입력해 주세요.")
    conn=get_db_connection()
    try:
        conn.execute('INSERT INTO "ClassCategories"("Name") VALUES(?)',(name.strip(),)); conn.commit()
        return {"status":"success"}
    except Exception: raise HTTPException(status_code=400, detail="이미 등록된 카테고리입니다.")
    finally: conn.close()

@app.post("/api/user/payroll/rates")
def create_payroll_rate(payload: PayRateRequest, current_user: Dict[str, Any] = Depends(get_current_staff)):
    if payload.GradeGroup not in ("초등", "중등", "기타") or payload.UnitAmount < 0 or not re.match(r'^\d{4}-\d{2}-\d{2}$', payload.EffectiveFrom): raise HTTPException(status_code=400, detail="단가 정보를 확인해 주세요.")
    conn=get_db_connection()
    try:
        conn.execute('INSERT OR REPLACE INTO "TeacherPayRates"("CategoryId","GradeGroup","UnitAmount","EffectiveFrom") VALUES(?,?,?,?)',(payload.CategoryId,payload.GradeGroup,payload.UnitAmount,payload.EffectiveFrom)); conn.commit(); return {"status":"success"}
    finally: conn.close()

@app.get("/api/user/payroll/rates")
def get_payroll_rates(current_user: Dict[str, Any] = Depends(get_current_user)):
    conn=get_db_connection()
    try:
        rows=conn.execute('''SELECT r.*, c."Name" AS "CategoryName" FROM "TeacherPayRates" r
                             JOIN "ClassCategories" c ON c."Id"=r."CategoryId"
                             ORDER BY r."EffectiveFrom" DESC, c."Name", r."GradeGroup"''').fetchall()
        return {"rates":[dict(r) for r in rows]}
    finally: conn.close()

@app.post("/api/user/payroll/special-rates")
def create_special_pay_rate(payload: SpecialLessonPayRateRequest, current_user: Dict[str, Any] = Depends(get_current_staff)):
    if payload.UnitAmount < 0 or not re.match(r'^\d{4}-\d{2}-\d{2}$', payload.EffectiveFrom):
        raise HTTPException(status_code=400, detail="특강 학생수당 단가 정보를 확인해 주세요.")
    conn=get_db_connection()
    try:
        conn.execute('INSERT OR REPLACE INTO "SpecialLessonPayRates"("UnitAmount","EffectiveFrom") VALUES(?,?)',(payload.UnitAmount,payload.EffectiveFrom)); conn.commit()
        return {"status":"success"}
    finally: conn.close()

@app.get("/api/user/payroll/special-rates")
def get_special_pay_rates(current_user: Dict[str, Any] = Depends(get_current_user)):
    conn=get_db_connection()
    try:
        rows=conn.execute('SELECT * FROM "SpecialLessonPayRates" ORDER BY "EffectiveFrom" DESC').fetchall()
        return {"rates":[dict(r) for r in rows]}
    finally: conn.close()

@app.get("/api/user/payroll")
def get_payroll(month: str = Query(...), teacher_username: Optional[str] = Query(None), current_user: Dict[str, Any] = Depends(get_current_user)):
    if not re.match(r'^\d{4}-\d{2}$', month): raise HTTPException(status_code=400, detail="정산월은 YYYY-MM 형식이어야 합니다.")
    teacher = current_user["username"] if current_user["role"] == "teacher" else (teacher_username or None)
    rows=_payroll_rows(month, teacher)
    totals={}
    for r in rows: totals[r["TeacherUsername"]]=totals.get(r["TeacherUsername"],0)+r["Amount"]
    conn=get_db_connection()
    try:
        closed=bool(teacher and conn.execute('SELECT 1 FROM "TeacherPayrollClosures" WHERE "PayrollMonth"=? AND "TeacherUsername"=?',(month, teacher)).fetchone())
        claim_sql = 'SELECT * FROM "TeacherPayrollClaims" WHERE "PayrollMonth"=?'
        claim_params = [month]
        if teacher:
            claim_sql += ' AND "TeacherUsername"=?'; claim_params.append(teacher)
        claim_sql += ' ORDER BY "ClaimDate" DESC, "Id" DESC'
        claims = [dict(r) for r in conn.execute(claim_sql, claim_params).fetchall()]
        material_sql = 'SELECT r.*, b."Title" AS "BookTitle" FROM "BookMaterialRequests" r LEFT JOIN "Books" b ON r."BookId"=b.rowid OR r."BookId"=b."Id" WHERE r."Status"=\'approved\' AND r."PayrollMonth"=?'
        material_params = [month]
        if teacher:
            material_sql += ' AND r."RequestedBy"=?'; material_params.append(teacher)
        material_requests = [_book_material_request_dict(r) for r in conn.execute(material_sql, material_params).fetchall()]
    finally: conn.close()
    # 추가 청구는 별도 승인 없이 등록 즉시 해당 월 정산에 포함한다.
    for claim in claims:
        totals[claim["TeacherUsername"]] = totals.get(claim["TeacherUsername"], 0) + claim["Amount"]
    for item in material_requests:
        totals[item["RequestedBy"]] = totals.get(item["RequestedBy"], 0) + (item["ApprovedAmount"] or 0)
    return {"month":month,"closed":closed,"lines":rows,"claims":claims,"material_requests":material_requests,"totals":totals}

@app.post("/api/user/payroll/backfill-class-links")
def backfill_payroll_class_links(
    month: str = Query(...),
    current_user: Dict[str, Any] = Depends(get_current_staff)
):
    """수업 연결이 누락된 과거 일괄 등록 이력을 현재 배정 규칙으로 보정한다.

    학생에게 같은 특강 여부의 수업이 정확히 하나일 때만 연결하므로, 기존 연결값이나
    여러 수업 후보가 있는 기록은 절대 변경하지 않는다.
    """
    if not re.match(r'^\d{4}-\d{2}$', month):
        raise HTTPException(status_code=400, detail="정산월은 YYYY-MM 형식이어야 합니다.")

    conn = get_db_connection()
    try:
        candidates = conn.execute('''
            SELECT sl.rowid AS "StudyLogId", cs."ClassId", c."TeacherUsername", s."Grade"
            FROM "StudyLogs" sl
            JOIN "ClassStudents" cs
              ON cs."StudentId" = sl."StudentId"
             AND COALESCE(cs."IsSpecial", 0) = COALESCE(sl."IsSpecial", 0)
            JOIN "Classes" c ON c."Id" = cs."ClassId"
            LEFT JOIN "Students" s ON s.rowid = sl."StudentId" OR s."Id" = sl."StudentId"
            WHERE sl."ClassId" IS NULL
              AND substr(sl."StudiedDay", 1, 7) = ?
              AND 1 = (
                  SELECT COUNT(*)
                  FROM "ClassStudents" cs2
                  WHERE cs2."StudentId" = sl."StudentId"
                    AND COALESCE(cs2."IsSpecial", 0) = COALESCE(sl."IsSpecial", 0)
              )
        ''', (month,)).fetchall()
        unmatched = conn.execute('''
            SELECT COUNT(*)
            FROM "StudyLogs" sl
            WHERE sl."ClassId" IS NULL AND substr(sl."StudiedDay", 1, 7) = ?
        ''', (month,)).fetchone()[0] - len(candidates)

        if not candidates:
            return {"status": "success", "linked_count": 0, "unmatched_count": unmatched,
                    "message": "자동 연결할 수 있는 누락 학습 이력이 없습니다."}

        before_snapshots = {
            row["StudyLogId"]: get_record_snapshot("StudyLogs", row["StudyLogId"])
            for row in candidates
        }
        for row in candidates:
            conn.execute('''
                UPDATE "StudyLogs"
                SET "ClassId" = ?, "ActualTeacherUsername" = ?, "SubstituteStatus" = 'approved',
                    "GradeSnapshot" = CASE WHEN COALESCE("GradeSnapshot", '') = '' THEN COALESCE(?, '') ELSE "GradeSnapshot" END,
                    "UpdatedBy" = ?, "UpdatedAt" = datetime('now', 'localtime')
                WHERE rowid = ? AND "ClassId" IS NULL
            ''', (row["ClassId"], row["TeacherUsername"], row["Grade"], current_user["username"], row["StudyLogId"]))
        conn.commit()
    finally:
        conn.close()

    for row in candidates:
        log_id = row["StudyLogId"]
        _audit_update("StudyLogs", log_id, before_snapshots[log_id], get_record_snapshot("StudyLogs", log_id),
                      current_user["username"], current_user["role"])
    return {"status": "success", "linked_count": len(candidates), "unmatched_count": unmatched,
            "message": f"{len(candidates)}건의 누락 학습 이력을 수업에 연결했습니다."}


def _duplicate_book_groups(conn) -> List[Dict[str, Any]]:
    """도서명·저자·출판사가 완전히 같은 중복 도서 그룹을 반환한다."""
    rows = conn.execute('''
        SELECT COALESCE("Title", '') AS "Title",
               COALESCE("Author", '') AS "Author",
               COALESCE("Publisher", '') AS "Publisher",
               COUNT(*) AS "BookCount",
               MIN(rowid) AS "SurvivorRowId",
               GROUP_CONCAT(rowid) AS "RowIds"
        FROM "Books"
        GROUP BY COALESCE("Title", ''), COALESCE("Author", ''), COALESCE("Publisher", '')
        HAVING COUNT(*) > 1
        ORDER BY "Title", "Author", "Publisher"
    ''').fetchall()
    return [dict(row) for row in rows]


def _book_reference_tables(conn) -> List[str]:
    """BookId 컬럼이 있는 모든 로컬 테이블을 찾아 참조 누락을 방지한다."""
    table_names = [row[0] for row in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ).fetchall()]
    result = []
    for table_name in table_names:
        columns = [column[1] for column in conn.execute(
            f'PRAGMA table_info("{table_name.replace(chr(34), chr(34) * 2)}")'
        ).fetchall()]
        if table_name != "Books" and "BookId" in columns:
            result.append(table_name)
    return result


@app.get("/api/user/utilities/duplicate-books")
def preview_duplicate_books(current_user: Dict[str, Any] = Depends(get_current_staff)):
    """병합 전에 중복 그룹과 이동될 참조 건수를 미리 보여준다."""
    conn = get_db_connection()
    try:
        groups = _duplicate_book_groups(conn)
        reference_tables = _book_reference_tables(conn)
        total_references = 0
        for group in groups:
            row_ids = [int(value) for value in group["RowIds"].split(",")]
            duplicate_ids = [row_id for row_id in row_ids if row_id != group["SurvivorRowId"]]
            placeholders = ",".join("?" for _ in row_ids)
            books = [dict(row) for row in conn.execute(
                f'SELECT rowid AS "RowId", "Id" FROM "Books" WHERE rowid IN ({placeholders}) ORDER BY rowid',
                row_ids
            ).fetchall()]
            aliases = set(duplicate_ids)
            if duplicate_ids:
                placeholders = ",".join("?" for _ in duplicate_ids)
                aliases.update(row[0] for row in conn.execute(
                    f'SELECT "Id" FROM "Books" WHERE rowid IN ({placeholders})', duplicate_ids
                ).fetchall())
            references_by_table = {}
            for table_name in reference_tables:
                if not aliases:
                    continue
                placeholders = ",".join("?" for _ in aliases)
                quoted_table = table_name.replace('"', '""')
                count = conn.execute(
                    f'SELECT COUNT(*) FROM "{quoted_table}" WHERE "BookId" IN ({placeholders})',
                    list(aliases)
                ).fetchone()[0]
                if count:
                    references_by_table[table_name] = count
            reference_count = sum(references_by_table.values())
            group["ReferenceCount"] = reference_count
            group["ReferencesByTable"] = references_by_table
            group["SurvivorBook"] = next(book for book in books if book["RowId"] == group["SurvivorRowId"])
            group["RemovedBooks"] = [book for book in books if book["RowId"] != group["SurvivorRowId"]]
            group["DuplicateCount"] = group.pop("BookCount") - 1
            group.pop("RowIds")
            total_references += reference_count
        return {
            "groups": groups,
            "group_count": len(groups),
            "duplicate_count": sum(group["DuplicateCount"] for group in groups),
            "reference_count": total_references,
            "reference_tables": reference_tables
        }
    finally:
        conn.close()


def _csv_book_score(source: str, target: str) -> float:
    """표기 차이를 허용하되 과도한 자동 연결은 피하는 도서명 유사도 점수."""
    source_key, target_key = normalize_key(source), normalize_key(target)
    if not source_key or not target_key:
        return 0.0
    if source_key == target_key:
        return 1.0
    sequence = SequenceMatcher(None, source_key, target_key).ratio()
    kind = classify_match(source_key, target_key)
    if kind == "contains":
        sequence = max(sequence, min(len(source_key), len(target_key)) / max(len(source_key), len(target_key)))
    return round(sequence, 4)


@app.post("/api/user/utilities/studylog-csv/preview")
def preview_studylog_csv(payload: StudyLogCsvRequest, current_user: Dict[str, Any] = Depends(get_current_staff)):
    """CSV 행별 학생·도서 후보를 판정한다. 이 단계에서는 데이터를 변경하지 않는다."""
    if not payload.rows or len(payload.rows) > 500:
        raise HTTPException(status_code=400, detail="CSV는 한 번에 1~500개의 데이터 행만 처리할 수 있습니다.")
    conn = get_db_connection()
    try:
        students = [dict(row) for row in conn.execute('SELECT rowid AS row_id, "Id", "Name" FROM "Students"').fetchall()]
        books = [dict(row) for row in conn.execute('SELECT rowid AS row_id, "Id", "Title", "Author", "Publisher" FROM "Books"').fetchall()]
        existing = {(str(row[0]), str(row[1]), row[2]) for row in conn.execute('SELECT "StudentId", "BookId", "StudiedDay" FROM "StudyLogs"').fetchall()}
    finally:
        conn.close()
    student_map = {}
    for student in students:
        student_map.setdefault(normalize_key(student.get("Name") or ""), []).append(student)
    results = []
    for source in payload.rows:
        errors, warnings = [], []
        matched_students = student_map.get(normalize_key(source.student_name), [])
        student = matched_students[0] if len(matched_students) == 1 else None
        if not matched_students:
            errors.append("일치하는 학생을 찾을 수 없습니다.")
        elif len(matched_students) > 1:
            errors.append("동명이인 학생이 있어 자동 선택할 수 없습니다.")
        try:
            datetime.strptime(source.studied_day.strip(), "%Y-%m-%d")
        except ValueError:
            errors.append("일자는 YYYY-MM-DD 형식의 실제 날짜여야 합니다.")
        ranked = sorted(
            [(_csv_book_score(source.book_title, book.get("Title") or ""), book) for book in books],
            key=lambda item: (-item[0], item[1]["row_id"])
        )
        candidates = [{
            "book_id": item[1]["row_id"], "title": item[1].get("Title") or "",
            "author": item[1].get("Author") or "", "publisher": item[1].get("Publisher") or "",
            "score": item[0]
        } for item in ranked[:5] if item[0] >= 0.35]
        selected_book_id = None
        match_type = "none"
        if ranked:
            top_score = ranked[0][0]
            second_score = ranked[1][0] if len(ranked) > 1 else 0.0
            exact_count = sum(1 for score, _ in ranked if score == 1.0)
            if top_score == 1.0 and exact_count == 1:
                selected_book_id, match_type = ranked[0][1]["row_id"], "exact"
            elif top_score >= 0.85 and top_score - second_score >= 0.08:
                selected_book_id, match_type = ranked[0][1]["row_id"], "similar"
                warnings.append(f"도서명을 유사도 {top_score * 100:.1f}%로 자동 연결했습니다.")
            else:
                errors.append("도서 후보가 불확실합니다. 후보에서 직접 선택해 주세요.")
        else:
            errors.append("등록된 도서가 없습니다.")
        duplicate = False
        if student and selected_book_id:
            aliases = {str(student["row_id"]), str(student.get("Id"))}
            duplicate = any((sid, str(selected_book_id), source.studied_day.strip()) in existing for sid in aliases)
            if duplicate:
                errors.append("같은 학생·도서·일자의 학습 기록이 이미 있습니다.")
        results.append({
            **source.dict(), "student_id": student["row_id"] if student else None,
            "book_id": selected_book_id, "book_match_type": match_type,
            "book_candidates": candidates, "errors": errors, "warnings": warnings,
            "ready": not errors
        })
    return {"rows": results, "total_count": len(results), "ready_count": sum(1 for row in results if row["ready"])}


@app.post("/api/user/utilities/studylog-csv/import")
def import_studylog_csv(payload: StudyLogCsvRequest, current_user: Dict[str, Any] = Depends(get_current_staff)):
    """확정된 CSV 행을 수업·정산·진행 선생님 연결 없이 등록하고 실행 결과를 보존한다."""
    if not payload.rows or len(payload.rows) > 500:
        raise HTTPException(status_code=400, detail="가져올 행은 1~500개여야 합니다.")
    results, audit_items = [], []
    conn = get_db_connection()
    try:
        columns = {row[1] for row in conn.execute('PRAGMA table_info("StudyLogs")').fetchall()}
        for source in payload.rows:
            result = {"row_number": source.row_number, "student_name": source.student_name,
                      "book_title": source.book_title, "studied_day": source.studied_day}
            try:
                datetime.strptime(source.studied_day.strip(), "%Y-%m-%d")
                if not source.student_id or not conn.execute('SELECT 1 FROM "Students" WHERE rowid=? OR "Id"=?', (source.student_id, source.student_id)).fetchone():
                    raise ValueError("학생을 확인할 수 없습니다.")
                if not source.book_id or not conn.execute('SELECT 1 FROM "Books" WHERE rowid=? OR "Id"=?', (source.book_id, source.book_id)).fetchone():
                    raise ValueError("도서를 확인할 수 없습니다.")
                if conn.execute('SELECT 1 FROM "StudyLogs" WHERE "StudentId"=? AND "BookId"=? AND "StudiedDay"=? LIMIT 1',
                                (source.student_id, source.book_id, source.studied_day.strip())).fetchone():
                    raise ValueError("같은 학생·도서·일자의 학습 기록이 이미 있습니다.")
                values = {
                    "StudentId": source.student_id, "BookId": source.book_id,
                    "StudiedDay": source.studied_day.strip(), "LessonContent": (source.lesson_content or "").strip(),
                    "Description": "", "IsSpecial": 0, "ClassId": None, "PayrollCategoryId": None,
                    "ActualTeacherUsername": "", "SubstituteStatus": "", "GradeSnapshot": "",
                    "CreatedBy": current_user["username"]
                }
                values = {key: value for key, value in values.items() if key in columns}
                names = list(values)
                cursor = conn.execute(
                    f'INSERT INTO "StudyLogs" ({", ".join(chr(34) + name + chr(34) for name in names)}) VALUES ({", ".join("?" for _ in names)})',
                    [values[name] for name in names]
                )
                log_id = cursor.lastrowid
                conn.commit()
                snapshot = dict(conn.execute('SELECT * FROM "StudyLogs" WHERE rowid=?', (log_id,)).fetchone())
                audit_items.append((log_id, snapshot))
                result.update({"status": "success", "studylog_id": log_id, "message": "등록 완료"})
            except Exception as exc:
                conn.rollback()
                result.update({"status": "failure", "message": str(exc)})
            results.append(result)
        success_count = sum(1 for item in results if item["status"] == "success")
        conn.execute('''INSERT INTO _app_studylog_import_runs
                        (source_file,total_count,success_count,failure_count,results_json,username)
                        VALUES (?,?,?,?,?,?)''',
                     ((payload.source_file or "")[:255], len(results), success_count, len(results) - success_count,
                      json.dumps(results, ensure_ascii=False), current_user["username"]))
        run_id = conn.execute('SELECT last_insert_rowid()').fetchone()[0]
        conn.commit()
    finally:
        conn.close()
    for log_id, snapshot in audit_items:
        _audit_insert("StudyLogs", log_id, snapshot, current_user["username"], current_user["role"])
    return {"status": "success", "run_id": run_id, "total_count": len(results),
            "success_count": success_count, "failure_count": len(results) - success_count, "results": results,
            "message": f"{success_count}건을 등록했고 {len(results) - success_count}건은 실패했습니다."}


@app.get("/api/user/utilities/studylog-csv/runs")
def list_studylog_csv_runs(current_user: Dict[str, Any] = Depends(get_current_staff)):
    conn = get_db_connection()
    try:
        rows = conn.execute('''SELECT id,source_file,total_count,success_count,failure_count,username,created_at
                               FROM _app_studylog_import_runs ORDER BY id DESC LIMIT 20''').fetchall()
        return {"runs": [dict(row) for row in rows]}
    finally:
        conn.close()


@app.get("/api/user/utilities/studylog-csv/runs/{run_id}")
def get_studylog_csv_run(run_id: int, current_user: Dict[str, Any] = Depends(get_current_staff)):
    conn = get_db_connection()
    try:
        row = conn.execute('SELECT * FROM _app_studylog_import_runs WHERE id=?', (run_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="CSV 실행 이력을 찾을 수 없습니다.")
        result = dict(row)
        result["results"] = json.loads(result.pop("results_json") or "[]")
        return result
    finally:
        conn.close()


@app.post("/api/user/utilities/merge-duplicate-books")
def merge_duplicate_books(current_user: Dict[str, Any] = Depends(get_current_staff)):
    """중복 도서의 모든 BookId 참조를 대표 도서로 옮기고 중복 행을 삭제한다."""
    conn = get_db_connection()
    deleted_snapshots = []
    updated_studylog_snapshots = []
    try:
        conn.execute("BEGIN IMMEDIATE")
        groups = _duplicate_book_groups(conn)
        reference_tables = _book_reference_tables(conn)
        moved_by_table = {table_name: 0 for table_name in reference_tables}
        deleted_count = 0

        for group in groups:
            title, author, publisher = group["Title"], group["Author"], group["Publisher"]
            books = conn.execute('''
                SELECT rowid AS row_id, * FROM "Books"
                WHERE COALESCE("Title", '') = ? AND COALESCE("Author", '') = ?
                  AND COALESCE("Publisher", '') = ?
                ORDER BY rowid
            ''', (title, author, publisher)).fetchall()
            survivor_id = books[0]["row_id"]
            duplicates = books[1:]
            aliases = {value for book in duplicates for value in (book["row_id"], book["Id"])}
            if aliases:
                placeholders = ",".join("?" for _ in aliases)
                for table_name in reference_tables:
                    quoted_table = table_name.replace('"', '""')
                    if table_name == "StudyLogs":
                        affected_logs = conn.execute(
                            f'SELECT rowid AS row_id, * FROM "StudyLogs" WHERE "BookId" IN ({placeholders})',
                            list(aliases)
                        ).fetchall()
                        updated_studylog_snapshots.extend(
                            (row["row_id"], dict(row)) for row in affected_logs
                        )
                    cursor = conn.execute(
                        f'UPDATE "{quoted_table}" SET "BookId" = ? WHERE "BookId" IN ({placeholders})',
                        [survivor_id, *aliases]
                    )
                    moved_by_table[table_name] += cursor.rowcount
            for book in duplicates:
                deleted_snapshots.append((book["row_id"], dict(book)))
                conn.execute('DELETE FROM "Books" WHERE rowid = ?', (book["row_id"],))
                deleted_count += 1
        conn.commit()
    except Exception as exc:
        conn.rollback()
        raise HTTPException(status_code=400, detail=f"중복 도서 병합 중 오류가 발생했습니다: {exc}")
    finally:
        conn.close()

    for row_id, snapshot in deleted_snapshots:
        _audit_delete("Books", row_id, snapshot, current_user["username"], current_user["role"])
    for row_id, snapshot in updated_studylog_snapshots:
        _audit_update("StudyLogs", row_id, snapshot, get_record_snapshot("StudyLogs", row_id),
                      current_user["username"], current_user["role"])
    moved_count = sum(moved_by_table.values())
    return {
        "status": "success",
        "group_count": len(groups),
        "deleted_count": deleted_count,
        "moved_reference_count": moved_count,
        "moved_by_table": moved_by_table,
        "message": f"중복 도서 {deleted_count}권을 병합하고 참조 {moved_count}건을 이동했습니다."
    }

@app.post("/api/user/payroll/transfer-sessions")
def transfer_payroll_sessions(
    payload: PayrollSessionTransferRequest,
    current_user: Dict[str, Any] = Depends(get_current_staff)
):
    """정산 마감 전 선택 차시 전체를 다른 선생님의 정산으로 이전한다."""
    month = (payload.PayrollMonth or "").strip()
    source_teacher = (payload.SourceTeacherUsername or "").strip()
    target_teacher = (payload.TargetTeacherUsername or "").strip()
    if not re.match(r'^\d{4}-\d{2}$', month):
        raise HTTPException(status_code=400, detail="정산월은 YYYY-MM 형식이어야 합니다.")
    if not source_teacher or not target_teacher or source_teacher == target_teacher:
        raise HTTPException(status_code=400, detail="현재 담당자와 다른 이전 대상 선생님을 선택해 주세요.")
    if not payload.Sessions:
        raise HTTPException(status_code=400, detail="이전할 차시를 하나 이상 선택해 주세요.")
    if len(payload.Sessions) > 50:
        raise HTTPException(status_code=400, detail="차시는 한 번에 최대 50개까지 이전할 수 있습니다.")

    for username, label in ((source_teacher, "현재 담당"), (target_teacher, "이전 대상")):
        user = get_user_by_username(username)
        if not user or user.get("role") not in ("teacher", "manager"):
            raise HTTPException(status_code=400, detail=f"{label} 선생님 계정을 확인해 주세요.")

    unique_sessions = []
    seen_sessions = set()
    for session in payload.Sessions:
        day = (session.StudiedDay or "").strip()
        key = (session.ClassId, day)
        if session.ClassId <= 0 or not re.match(r'^\d{4}-\d{2}-\d{2}$', day) or not day.startswith(f"{month}-"):
            raise HTTPException(status_code=400, detail="선택한 차시의 수업 또는 날짜 정보가 올바르지 않습니다.")
        if key not in seen_sessions:
            seen_sessions.add(key)
            unique_sessions.append(key)

    conn = get_db_connection()
    old_snapshots: Dict[int, Dict[str, Any]] = {}
    updated_ids: List[int] = []
    try:
        # 마감 처리와 동시에 실행되어 중간 상태가 생기지 않도록 쓰기 잠금을 먼저 확보한다.
        conn.execute("BEGIN IMMEDIATE")
        closed_rows = conn.execute('''
            SELECT "TeacherUsername" FROM "TeacherPayrollClosures"
            WHERE "PayrollMonth" = ? AND "TeacherUsername" IN (?, ?)
        ''', (month, source_teacher, target_teacher)).fetchall()
        closed_teachers = {row["TeacherUsername"] for row in closed_rows}
        if closed_teachers:
            names = ", ".join(sorted(closed_teachers))
            raise HTTPException(status_code=409, detail=f"{names} 선생님의 {month} 정산이 이미 마감되어 차시를 이전할 수 없습니다.")

        for class_id, studied_day in unique_sessions:
            class_row = conn.execute(
                'SELECT "Id", "ClassName", "TeacherUsername" FROM "Classes" WHERE "Id" = ?',
                (class_id,)
            ).fetchone()
            if not class_row:
                raise HTTPException(status_code=404, detail="선택한 차시의 수업 정보를 찾을 수 없습니다.")

            rows = conn.execute('''
                SELECT sl.rowid AS "StudyLogRowId", sl.*,
                       CASE
                           WHEN COALESCE(sl."ActualTeacherUsername", '') != '' THEN sl."ActualTeacherUsername"
                           ELSE c."TeacherUsername"
                       END AS "EffectiveTeacherUsername"
                FROM "StudyLogs" sl
                JOIN "Classes" c ON c."Id" = sl."ClassId"
                WHERE sl."ClassId" = ? AND sl."StudiedDay" = ?
            ''', (class_id, studied_day)).fetchall()
            if not rows:
                raise HTTPException(status_code=404, detail=f"{class_row['ClassName']} {studied_day} 차시의 학습 이력을 찾을 수 없습니다.")
            if any((row["SubstituteStatus"] or "") == "pending" for row in rows):
                raise HTTPException(status_code=409, detail=f"{class_row['ClassName']} {studied_day} 차시에 처리 대기 중인 대체수업 기록이 있습니다.")
            effective_teachers = {row["EffectiveTeacherUsername"] for row in rows}
            if effective_teachers != {source_teacher}:
                raise HTTPException(
                    status_code=409,
                    detail=f"{class_row['ClassName']} {studied_day} 차시의 현재 담당자가 조회한 선생님과 일치하지 않습니다. 새로고침 후 다시 선택해 주세요."
                )

            for row in rows:
                row_id = row["StudyLogRowId"]
                old_snapshots[row_id] = {key: row[key] for key in row.keys() if key not in ("StudyLogRowId", "EffectiveTeacherUsername")}
                conn.execute('''
                    UPDATE "StudyLogs"
                    SET "ActualTeacherUsername" = ?, "SubstituteStatus" = 'approved',
                        "UpdatedBy" = ?, "UpdatedAt" = datetime('now', 'localtime')
                    WHERE rowid = ?
                ''', (target_teacher, current_user["username"], row_id))
                updated_ids.append(row_id)
        conn.commit()
    except HTTPException:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise HTTPException(status_code=500, detail="차시 담당 선생님 이전 중 오류가 발생했습니다.")
    finally:
        conn.close()

    for row_id in updated_ids:
        _audit_update("StudyLogs", row_id, old_snapshots[row_id], get_record_snapshot("StudyLogs", row_id),
                      current_user["username"], current_user["role"])
    return {
        "status": "success",
        "message": f"선택한 {len(unique_sessions)}개 차시를 {target_teacher} 선생님에게 이전했습니다.",
        "transferred_session_count": len(unique_sessions),
        "updated_log_count": len(updated_ids)
    }

@app.post("/api/user/payroll/claims")
def create_payroll_claim(payload: PayrollClaimRequest, current_user: Dict[str, Any] = Depends(get_current_user)):
    if (not re.match(r'^\d{4}-\d{2}$', payload.PayrollMonth) or not re.match(r'^\d{4}-\d{2}-\d{2}$', payload.ClaimDate)
            or not payload.ClaimDate.startswith(payload.PayrollMonth) or not payload.ItemName.strip() or payload.Amount < 0):
        raise HTTPException(status_code=400, detail="청구월에 맞는 청구일, 항목명, 금액을 확인해 주세요.")
    teacher_username = (payload.TeacherUsername or '').strip() if current_user["role"] in ("admin", "subadmin", "manager") else current_user["username"]
    if not teacher_username:
        raise HTTPException(status_code=400, detail="추가 청구를 등록할 선생님을 선택해 주세요.")
    target_user = get_user_by_username(teacher_username)
    if not target_user or target_user.get("role") not in ("teacher", "manager"):
        raise HTTPException(status_code=404, detail="선생님 계정을 찾을 수 없습니다.")
    conn=get_db_connection()
    try:
        if conn.execute('SELECT 1 FROM "TeacherPayrollClosures" WHERE "PayrollMonth"=? AND "TeacherUsername"=?',(payload.PayrollMonth,teacher_username)).fetchone():
            raise HTTPException(status_code=400, detail="마감된 정산월에는 청구할 수 없습니다.")
        conn.execute('''INSERT INTO "TeacherPayrollClaims"
                        ("PayrollMonth","TeacherUsername","ClaimDate","ItemName","Amount","Description")
                        VALUES(?,?,?,?,?,?)''',
                     (payload.PayrollMonth,teacher_username,payload.ClaimDate,payload.ItemName.strip(),payload.Amount,(payload.Description or '').strip()))
        conn.commit(); return {"status":"success","message":"추가 청구를 등록하고 정산에 반영했습니다."}
    finally: conn.close()

def _get_manageable_payroll_claim(conn, claim_id: int, current_user: Dict[str, Any]):
    claim = conn.execute('SELECT * FROM "TeacherPayrollClaims" WHERE "Id"=?', (claim_id,)).fetchone()
    if not claim:
        raise HTTPException(status_code=404, detail="추가 청구 항목을 찾을 수 없습니다.")
    if current_user["role"] not in ("admin", "subadmin", "manager") and claim["TeacherUsername"] != current_user["username"]:
        raise HTTPException(status_code=403, detail="다른 선생님의 추가 청구 항목을 변경할 권한이 없습니다.")
    return claim

@app.put("/api/user/payroll/claims/{claim_id}")
def update_payroll_claim(claim_id: int, payload: PayrollClaimRequest, current_user: Dict[str, Any] = Depends(get_current_user)):
    if (not re.match(r'^\d{4}-\d{2}$', payload.PayrollMonth) or not re.match(r'^\d{4}-\d{2}-\d{2}$', payload.ClaimDate)
            or not payload.ClaimDate.startswith(payload.PayrollMonth) or not payload.ItemName.strip() or payload.Amount < 0):
        raise HTTPException(status_code=400, detail="청구월에 맞는 청구일, 항목명, 금액을 확인해 주세요.")
    conn = get_db_connection()
    try:
        claim = _get_manageable_payroll_claim(conn, claim_id, current_user)
        if conn.execute('SELECT 1 FROM "TeacherPayrollClosures" WHERE "PayrollMonth"=? AND "TeacherUsername"=?',
                        (claim["PayrollMonth"], claim["TeacherUsername"])).fetchone():
            raise HTTPException(status_code=400, detail="마감된 정산월의 추가 청구는 수정할 수 없습니다.")
        if payload.PayrollMonth != claim["PayrollMonth"]:
            if conn.execute('SELECT 1 FROM "TeacherPayrollClosures" WHERE "PayrollMonth"=? AND "TeacherUsername"=?',
                            (payload.PayrollMonth, claim["TeacherUsername"])).fetchone():
                raise HTTPException(status_code=400, detail="이동할 정산월이 이미 마감되었습니다.")
        conn.execute('''UPDATE "TeacherPayrollClaims"
                        SET "PayrollMonth"=?, "ClaimDate"=?, "ItemName"=?, "Amount"=?, "Description"=? WHERE "Id"=?''',
                     (payload.PayrollMonth, payload.ClaimDate, payload.ItemName.strip(), payload.Amount,
                      (payload.Description or '').strip(), claim_id))
        conn.commit()
        return {"status":"success", "message":"추가 청구를 수정하고 정산에 반영했습니다."}
    finally:
        conn.close()

@app.delete("/api/user/payroll/claims/{claim_id}")
def delete_payroll_claim(claim_id: int, current_user: Dict[str, Any] = Depends(get_current_user)):
    conn = get_db_connection()
    try:
        claim = _get_manageable_payroll_claim(conn, claim_id, current_user)
        if conn.execute('SELECT 1 FROM "TeacherPayrollClosures" WHERE "PayrollMonth"=? AND "TeacherUsername"=?',
                        (claim["PayrollMonth"], claim["TeacherUsername"])).fetchone():
            raise HTTPException(status_code=400, detail="마감된 정산월의 추가 청구는 삭제할 수 없습니다.")
        conn.execute('DELETE FROM "TeacherPayrollClaims" WHERE "Id"=?', (claim_id,))
        conn.commit()
        return {"status":"success", "message":"추가 청구를 삭제하고 정산에서 제외했습니다."}
    finally:
        conn.close()

@app.post("/api/user/payroll/{month}/close")
def close_payroll(month: str, teacher_username: str = Query(...), current_user: Dict[str, Any] = Depends(get_current_staff)):
    if not re.match(r'^\d{4}-\d{2}$', month): raise HTTPException(status_code=400, detail="정산월은 YYYY-MM 형식이어야 합니다.")
    if not get_user_by_username(teacher_username): raise HTTPException(status_code=404, detail="선생님 계정을 찾을 수 없습니다.")
    rows=_payroll_rows(month, teacher_username)
    if any(not row.get("IsRateConfigured", True) for row in rows):
        raise HTTPException(status_code=400, detail="단가가 설정되지 않은 수업 내역이 있어 정산을 마감할 수 없습니다.")
    conn=get_db_connection()
    try:
        if conn.execute('SELECT 1 FROM "TeacherPayrollClosures" WHERE "PayrollMonth"=? AND "TeacherUsername"=?',(month,teacher_username)).fetchone(): raise HTTPException(status_code=400, detail="이미 마감된 선생님 정산입니다.")
        for r in rows: conn.execute('INSERT INTO "TeacherPayrollLines"("PayrollMonth","StudyLogId","TeacherUsername","UnitAmount","Amount","Reason") VALUES(?,?,?,?,?,?)',(month,r['StudyLogId'],r['TeacherUsername'],r['UnitAmount'],r['Amount'],r['Reason']))
        conn.execute('INSERT INTO "TeacherPayrollClosures"("PayrollMonth","TeacherUsername","ClosedBy") VALUES(?,?,?)',(month,teacher_username,current_user['username'])); conn.commit()
        return {"status":"success","message":f"{teacher_username} 선생님의 {month} 급여 정산을 마감했습니다."}
    except HTTPException: raise
    finally: conn.close()

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

def _student_grade(student_id: int) -> str:
    conn = get_db_connection()
    try:
        row = conn.execute('SELECT "Grade" FROM "Students" WHERE rowid = ? OR "Id" = ?', (student_id, student_id)).fetchone()
        return (row[0] or "") if row else ""
    finally:
        conn.close()

def _grade_group(grade: str) -> str:
    normalized = (grade or "").strip()
    if normalized.startswith("초"):
        return "초등"
    if normalized.startswith("중"):
        return "중등"
    if re.fullmatch(r"[1-6]", normalized):
        return "초등"
    if re.fullmatch(r"[7-9]", normalized):
        return "중등"
    return "기타"

def _payroll_rows(month: str, teacher_username: Optional[str] = None) -> List[Dict[str, Any]]:
    """마감 전에는 해당 일자에 유효한 단가를, 마감 후에는 확정 단가를 반환한다."""
    conn = get_db_connection()
    try:
        closed = teacher_username and conn.execute('SELECT 1 FROM "TeacherPayrollClosures" WHERE "PayrollMonth"=? AND "TeacherUsername"=?', (month, teacher_username)).fetchone()
        if closed:
            sql = '''SELECT pl.*, sl."StudiedDay", sl."ClassId", s."Name" AS "StudentName", s."Grade" AS "CurrentGrade",
                            sl."GradeSnapshot", COALESCE(c."ClassName", '수업 없음 · ' || pc."Name") AS "ClassName"
                     FROM "TeacherPayrollLines" pl JOIN "StudyLogs" sl ON sl.rowid=pl."StudyLogId"
                     LEFT JOIN "Students" s ON sl."StudentId"=s.rowid OR sl."StudentId"=s."Id"
                     LEFT JOIN "Classes" c ON sl."ClassId"=c."Id"
                     LEFT JOIN "ClassCategories" pc ON sl."PayrollCategoryId"=pc."Id"
                     WHERE pl."PayrollMonth"=?'''
            params = [month]
            if teacher_username: sql += ' AND pl."TeacherUsername"=?'; params.append(teacher_username)
            return [dict(r) for r in conn.execute(sql, params).fetchall()]
        sql = '''SELECT sl.rowid AS "StudyLogId", sl."StudiedDay", sl."ClassId", sl."IsSpecial", sl."GradeSnapshot",
                        sl."ActualTeacherUsername", sl."SubstituteStatus",
                        s."Name" AS "StudentName", s."Grade" AS "CurrentGrade",
                        COALESCE(c."ClassName", '수업 없음 · ' || pc."Name") AS "ClassName",
                        COALESCE(c."CategoryId", sl."PayrollCategoryId") AS "CategoryId", c."TeacherUsername"
                 FROM "StudyLogs" sl LEFT JOIN "Classes" c ON sl."ClassId"=c."Id"
                 LEFT JOIN "ClassCategories" pc ON sl."PayrollCategoryId"=pc."Id"
                 LEFT JOIN "Students" s ON sl."StudentId"=s.rowid OR sl."StudentId"=s."Id"
                 WHERE substr(sl."StudiedDay",1,7)=?
                   AND (sl."SubstituteStatus" IN ('','approved') OR sl."SubstituteStatus" IS NULL)
                   AND (c."Id" IS NOT NULL OR (sl."ClassId" IS NULL AND sl."PayrollCategoryId" IS NOT NULL
                                                AND COALESCE(sl."ActualTeacherUsername", '') != ''))'''
        rows=[]
        for row in conn.execute(sql, (month,)).fetchall():
            r=dict(row); teacher=r["ActualTeacherUsername"] or r["TeacherUsername"]
            if teacher_username and teacher != teacher_username: continue
            # 과거 학습 이력에 학년 스냅샷이 없으면 현재 학생 학년을 사용한다.
            payroll_grade = (r["GradeSnapshot"] or "").strip() or (r["CurrentGrade"] or "").strip()
            if r["IsSpecial"]:
                rate=conn.execute('SELECT "UnitAmount" FROM "SpecialLessonPayRates" WHERE "EffectiveFrom"<=? ORDER BY "EffectiveFrom" DESC LIMIT 1',(r["StudiedDay"],)).fetchone()
                reason="특강 학생수당" if rate else "특강 학생수당 단가 미설정"
            else:
                grade_group = _grade_group(payroll_grade)
                rate=conn.execute('SELECT "UnitAmount" FROM "TeacherPayRates" WHERE "CategoryId"=? AND "GradeGroup"=? AND "EffectiveFrom"<=? ORDER BY "EffectiveFrom" DESC LIMIT 1',(r["CategoryId"],grade_group,r["StudiedDay"])).fetchone()
                if r["CategoryId"] is None:
                    reason="수업 카테고리 미설정"
                elif not rate:
                    reason=f'{grade_group} 일반 수업 단가 미설정'
                else:
                    reason=f'{grade_group} 일반 수업'
            r.update({
                "TeacherUsername": teacher,
                "UnitAmount": rate[0] if rate else 0,
                "Amount": rate[0] if rate else 0,
                "Reason": reason,
                "IsRateConfigured": bool(rate)
            })
            rows.append(r)
        return rows
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
        if "StudiedDay" in update_data:
            studied_day = str(update_data["StudiedDay"] or "").strip()
            if not studied_day:
                raise HTTPException(status_code=400, detail="학습 수행 일자를 입력해 주세요.")
            try:
                datetime.strptime(studied_day, "%Y-%m-%d")
            except ValueError:
                raise HTTPException(status_code=400, detail="학습 수행 일자는 YYYY-MM-DD 형식으로 입력해 주세요.")
            update_data["StudiedDay"] = studied_day

        assignment_fields = {"ClassId", "ActualTeacherUsername", "PayrollCategoryId"}
        assignment_requested = assignment_fields.intersection(update_data)
        assignment_changed = any(
            (str((update_data.get(field) or "")).strip() != str((old_snapshot.get(field) or "")).strip())
            for field in assignment_requested
        )
        if assignment_changed:
            conn = get_db_connection()
            try:
                if conn.execute('SELECT 1 FROM "TeacherPayrollLines" WHERE "StudyLogId" = ?', (row_id,)).fetchone():
                    raise HTTPException(status_code=409, detail="이미 마감된 정산에 포함된 학습 기록의 수업·선생님·카테고리는 수정할 수 없습니다.")
            finally:
                conn.close()

            target_class_id = (update_data.get("ClassId") if "ClassId" in update_data else old_snapshot.get("ClassId")) or None
            target_teacher_value = (update_data.get("ActualTeacherUsername") if "ActualTeacherUsername" in update_data
                                    else old_snapshot.get("ActualTeacherUsername"))
            target_teacher = str(target_teacher_value or "").strip()
            target_category_id = (update_data.get("PayrollCategoryId") if "PayrollCategoryId" in update_data
                                  else old_snapshot.get("PayrollCategoryId")) or None
            target_day = str(update_data.get("StudiedDay") or old_snapshot.get("StudiedDay") or "").strip()
            student_id = old_snapshot.get("StudentId")

            if target_class_id:
                class_row = get_class_by_id(int(target_class_id))
                if not class_row:
                    raise HTTPException(status_code=400, detail="정산에 연결할 수업 정보를 찾을 수 없습니다.")
                if student_id not in set(get_class_student_ids(int(target_class_id))):
                    raise HTTPException(status_code=400, detail="해당 학생이 선택한 수업에 배정되어 있지 않습니다.")
                target_teacher = target_teacher or class_row["TeacherUsername"]
                target_category_id = None
            elif target_category_id:
                conn = get_db_connection()
                try:
                    category = conn.execute(
                        'SELECT "Id" FROM "ClassCategories" WHERE "Id" = ? AND "IsActive" = 1',
                        (target_category_id,)
                    ).fetchone()
                finally:
                    conn.close()
                if not category:
                    raise HTTPException(status_code=400, detail="사용 가능한 정산 카테고리를 선택해 주세요.")
                if not target_teacher:
                    raise HTTPException(status_code=400, detail="정산 카테고리를 지정하려면 실제 진행 선생님을 선택해 주세요.")

            if target_teacher:
                teacher = get_user_by_username(target_teacher)
                if not teacher or teacher.get("role") not in ("teacher", "manager"):
                    raise HTTPException(status_code=400, detail="실제 진행 선생님 계정을 확인해 주세요.")
            if target_teacher and (target_class_id or target_category_id):
                conn = get_db_connection()
                try:
                    if conn.execute('SELECT 1 FROM "TeacherPayrollClosures" WHERE "PayrollMonth"=? AND "TeacherUsername"=?',
                                    (target_day[:7], target_teacher)).fetchone():
                        raise HTTPException(status_code=409, detail="실제 진행 선생님의 해당 월 정산이 마감되어 학습 기록을 수정할 수 없습니다.")
                finally:
                    conn.close()

            update_data["ClassId"] = int(target_class_id) if target_class_id else None
            update_data["PayrollCategoryId"] = int(target_category_id) if target_category_id else None
            update_data["ActualTeacherUsername"] = target_teacher
            update_data["SubstituteStatus"] = "approved" if target_class_id or target_category_id else ""
            if (target_class_id or target_category_id) and not str(old_snapshot.get("GradeSnapshot") or "").strip():
                update_data["GradeSnapshot"] = _student_grade(student_id)
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
    except HTTPException:
        raise
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
    if current_user["role"] not in ("admin", "subadmin"):
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
    if payload.role not in ("subadmin", "manager", "teacher"):
        raise HTTPException(
            status_code=400,
            detail="발급 가능한 역할은 부관리자(subadmin), 관리 선생님(manager), 선생님(teacher)입니다."
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
    if payload.role not in ("subadmin", "manager", "teacher"):
        raise HTTPException(
            status_code=400,
            detail="변경 가능한 역할은 부관리자(subadmin), 관리 선생님(manager), 선생님(teacher)입니다."
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


# --- 감사 로그(Audit Trail) 조회 APIs (Staff Only) ---

@app.get("/api/admin/audit-logs/users")
def admin_audit_username_options(current_staff: Dict[str, Any] = Depends(get_current_staff)):
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
    current_staff: Dict[str, Any] = Depends(get_current_staff)
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
