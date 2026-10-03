"""상담 기록과 상담별 정산 기준. 마감 트랜잭션은 호출자가 관리한다."""
from contextlib import contextmanager
from datetime import date, datetime
import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, StrictStr, field_validator

import database
from auth import get_current_staff, get_current_user

router = APIRouter()


def _date(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ValueError("날짜는 YYYY-MM-DD 형식으로 입력해 주세요.")
    date.fromisoformat(value)
    return value


def _month(value):
    try:
        _date(value + "-01")
    except (ValueError, TypeError):
        raise HTTPException(400, "정산월은 YYYY-MM 형식으로 입력해 주세요.")
    return value


class ConsultationPayRateRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    EffectiveFrom: StrictStr
    UnitAmount: StrictInt = Field(ge=0, le=9223372036854775807)

    @field_validator("EffectiveFrom")
    @classmethod
    def valid_date(cls, value):
        return _date(value)


class StudentConsultationRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    Content: StrictStr
    ConsultationDate: StrictStr
    DurationMinutes: StrictInt = Field(ge=1, le=1440)
    TeacherUsername: StrictStr

    @field_validator("ConsultationDate")
    @classmethod
    def valid_date(cls, value):
        return _date(value)

    @field_validator("Content", "TeacherUsername")
    @classmethod
    def nonempty(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("필수 항목을 입력해 주세요.")
        return value


class ConsultationExclusionRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    Excluded: StrictBool
    Reason: Optional[StrictStr] = ""
    PayrollMonth: StrictStr
    TeacherUsername: StrictStr


def install_consultation_payroll(conn):
    """기존 상담은 추정 보완하지 않는다. 커밋은 호출자가 담당한다."""
    columns = {r[1] for r in conn.execute('PRAGMA table_info("StudentConsultations")')}
    additions = {
        "ConsultationDate": "TEXT NOT NULL DEFAULT ''", "DurationMinutes": "INTEGER",
        "TeacherUsername": "TEXT NOT NULL DEFAULT ''", "PayUnitAmount": "INTEGER",
        "PayEffectiveFrom": "TEXT NOT NULL DEFAULT ''",
        "ExcludedFromPayroll": "INTEGER NOT NULL DEFAULT 0", "ExclusionReason": "TEXT NOT NULL DEFAULT ''",
    }
    for name, definition in additions.items():
        if name not in columns:
            conn.execute(f'ALTER TABLE "StudentConsultations" ADD COLUMN "{name}" {definition}')
    conn.execute('''CREATE TABLE IF NOT EXISTS "ConsultationPayRates" (
        "Id" INTEGER PRIMARY KEY, "EffectiveFrom" TEXT NOT NULL UNIQUE,
        "UnitAmount" INTEGER NOT NULL CHECK("UnitAmount">=0),
        "CreatedBy" TEXT NOT NULL DEFAULT '', "UpdatedBy" TEXT NOT NULL DEFAULT '',
        "UpdatedAt" TEXT NOT NULL DEFAULT '')''')
    conn.execute('''CREATE TABLE IF NOT EXISTS "TeacherPayrollConsultationLines" (
        "Id" INTEGER PRIMARY KEY, "PayrollMonth" TEXT NOT NULL,
        "ConsultationId" INTEGER NOT NULL, "StudentId" INTEGER NOT NULL,
        "StudentName" TEXT NOT NULL DEFAULT '', "Content" TEXT NOT NULL,
        "ConsultationDate" TEXT NOT NULL, "DurationMinutes" INTEGER NOT NULL,
        "TeacherUsername" TEXT NOT NULL, "UnitAmount" INTEGER,
        "Amount" INTEGER, "PayEffectiveFrom" TEXT NOT NULL DEFAULT '',
        "IsExcluded" INTEGER NOT NULL DEFAULT 0, "ExclusionReason" TEXT NOT NULL DEFAULT '',
        "IsRateConfigured" INTEGER NOT NULL DEFAULT 0,
        UNIQUE("PayrollMonth", "TeacherUsername", "ConsultationId"))''')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_consultation_payroll_date_teacher ON "StudentConsultations"("ConsultationDate","TeacherUsername")')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_consultation_frozen_record ON "TeacherPayrollConsultationLines"("ConsultationId")')


@contextmanager
def _connection(write=False):
    conn = database.get_db_connection()
    try:
        if write:
            conn.execute("BEGIN IMMEDIATE")
        yield conn
        if write:
            conn.commit()
    except Exception:
        if write:
            conn.rollback()
        raise
    finally:
        conn.close()


def _audit(conn, table, key, old, new, user):
    action = "DELETE" if new is None else "INSERT" if old is None else "UPDATE"
    changed = [k for k in new if old.get(k) != new[k]] if old and new else None
    database.write_audit_log(table, key, action, old, new, changed,
                             user["username"], user["role"], connection=conn)


def _student(conn, student_id):
    rows = conn.execute('SELECT rowid AS row_id, * FROM "Students" WHERE rowid=? OR "Id"=?',
                        (student_id, student_id)).fetchall()
    if not rows:
        raise HTTPException(404, "해당 학생을 찾을 수 없습니다.")
    if len(rows) != 1:
        raise HTTPException(409, "학생 식별자가 중복됩니다. 학생 정보를 확인해 주세요.")
    return dict(rows[0])


def _record(conn, record_id):
    row = conn.execute('SELECT rowid AS row_id, * FROM "StudentConsultations" WHERE rowid=?', (record_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "해당 상담 기록을 찾을 수 없습니다.")
    return dict(row)


def _teacher(conn, username):
    if not conn.execute("SELECT 1 FROM _app_users WHERE username=? AND role IN ('admin','subadmin','manager','teacher')", (username,)).fetchone():
        raise HTTPException(400, "상담 선생님 계정을 찾을 수 없습니다.")


def _closed(conn, month, teacher):
    return bool(conn.execute('SELECT 1 FROM "TeacherPayrollClosures" WHERE "PayrollMonth"=? AND "TeacherUsername"=?',
                             (month, teacher)).fetchone())


def _protected(conn, record=None, consultation_date="", teacher=""):
    if record:
        if conn.execute('SELECT 1 FROM "TeacherPayrollConsultationLines" WHERE "ConsultationId"=?', (record["row_id"],)).fetchone():
            raise HTTPException(400, "마감에 포함된 상담 기록은 변경할 수 없습니다.")
        if _closed(conn, record["ConsultationDate"][:7], record["TeacherUsername"]):
            raise HTTPException(400, "기존 상담의 정산월이 마감되어 변경할 수 없습니다.")
    if consultation_date and _closed(conn, consultation_date[:7], teacher):
        raise HTTPException(400, "대상 선생님의 정산월이 마감되어 변경할 수 없습니다.")


def _basis(conn, consultation_date):
    row = conn.execute('SELECT "UnitAmount","EffectiveFrom" FROM "ConsultationPayRates" WHERE "EffectiveFrom"<=? ORDER BY "EffectiveFrom" DESC LIMIT 1', (consultation_date,)).fetchone()
    return (row["UnitAmount"], row["EffectiveFrom"]) if row else (None, "")


def _eligible(record):
    try:
        _date(record["ConsultationDate"])
    except (ValueError, TypeError):
        return False
    return bool(record["TeacherUsername"] and isinstance(record["DurationMinutes"], int)
                and 1 <= record["DurationMinutes"] <= 1440 and record["Content"].strip())


def payroll_consultation_rows(conn, month, teacher=None):
    """포함·제외 상담을 반환한다. 빈 과거 마감도 원본을 다시 합산하지 않는다."""
    _month(month)
    closed = {r[0] for r in conn.execute('SELECT "TeacherUsername" FROM "TeacherPayrollClosures" WHERE "PayrollMonth"=?', (month,))}
    result = []
    frozen = conn.execute('SELECT * FROM "TeacherPayrollConsultationLines" WHERE "PayrollMonth"=? ORDER BY "ConsultationDate","ConsultationId"', (month,)).fetchall()
    for raw in frozen:
        row = dict(raw)
        if row["TeacherUsername"] in closed and (teacher is None or row["TeacherUsername"] == teacher):
            row.pop("Id", None)
            row["IsExcluded"] = bool(row["IsExcluded"])
            row["IsRateConfigured"] = bool(row["IsRateConfigured"])
            row["IsPayrollClosed"] = True
            result.append(row)
    live = conn.execute('''SELECT c.rowid AS row_id, c.*, COALESCE(s."Name",'') AS "StudentName"
        FROM "StudentConsultations" c LEFT JOIN "Students" s ON s.rowid=c."StudentId"
        WHERE substr(c."ConsultationDate",1,7)=? ORDER BY c."ConsultationDate",c.rowid''', (month,)).fetchall()
    for raw in live:
        row = dict(raw)
        if row["TeacherUsername"] in closed or (teacher is not None and row["TeacherUsername"] != teacher) or not _eligible(row):
            continue
        excluded = bool(row["ExcludedFromPayroll"])
        result.append({"ConsultationId": row["row_id"], "StudentId": row["StudentId"],
                       "StudentName": row["StudentName"], "Content": row["Content"],
                       "ConsultationDate": row["ConsultationDate"], "DurationMinutes": row["DurationMinutes"],
                       "TeacherUsername": row["TeacherUsername"], "UnitAmount": row["PayUnitAmount"],
                       "Amount": 0 if excluded else (row["PayUnitAmount"] or 0), "IsExcluded": excluded,
                       "ExclusionReason": row["ExclusionReason"], "IsRateConfigured": row["PayUnitAmount"] is not None,
                       "IsPayrollClosed": False, "PayEffectiveFrom": row["PayEffectiveFrom"], "PayrollMonth": month})
    return sorted(result, key=lambda r: (r["ConsultationDate"], r["ConsultationId"]))


def freeze_payroll_consultations(conn, month, teacher):
    """호출자의 BEGIN IMMEDIATE 내부에서 전체 행을 고정한다. 커밋하지 않는다."""
    if not conn.in_transaction:
        raise RuntimeError("상담 정산 마감은 쓰기 트랜잭션 안에서 실행해야 합니다.")
    _month(month)
    if _closed(conn, month, teacher):
        raise HTTPException(400, "이미 마감된 정산입니다.")
    rows = payroll_consultation_rows(conn, month, teacher)
    if any(not r["IsExcluded"] and not r["IsRateConfigured"] for r in rows):
        raise HTTPException(400, "상담 단가가 미설정된 기록이 있어 마감할 수 없습니다.")
    columns = ("PayrollMonth", "ConsultationId", "StudentId", "StudentName", "Content", "ConsultationDate",
               "DurationMinutes", "TeacherUsername", "UnitAmount", "Amount", "PayEffectiveFrom",
               "IsExcluded", "ExclusionReason", "IsRateConfigured")
    for row in rows:
        conn.execute('INSERT INTO "TeacherPayrollConsultationLines" (' + ','.join('"' + c + '"' for c in columns) + ') VALUES (' + ','.join('?' for c in columns) + ')', tuple(row[c] for c in columns))
    return rows


def _view_record(conn, record, user):
    frozen = bool(conn.execute('SELECT 1 FROM "TeacherPayrollConsultationLines" WHERE "ConsultationId"=?', (record["row_id"],)).fetchone())
    record["IsPayrollClosed"] = frozen or _closed(conn, record["ConsultationDate"][:7], record["TeacherUsername"])
    record["CanEdit"] = user["role"] in ("admin", "subadmin", "manager") and not record["IsPayrollClosed"]
    record["CanDelete"] = record["CanEdit"]
    return record


@router.get("/api/user/consultation-pay-rates")
def get_consultation_pay_rates(current_user=Depends(get_current_user)):
    with _connection() as conn:
        return {"rates": [dict(r) for r in conn.execute('SELECT * FROM "ConsultationPayRates" ORDER BY "EffectiveFrom" DESC')]}


@router.post("/api/user/consultation-pay-rates")
def save_consultation_pay_rate(payload: ConsultationPayRateRequest, current_user=Depends(get_current_staff)):
    with _connection(True) as conn:
        old = conn.execute('SELECT * FROM "ConsultationPayRates" WHERE "EffectiveFrom"=?', (payload.EffectiveFrom,)).fetchone()
        conn.execute('''INSERT INTO "ConsultationPayRates"("EffectiveFrom","UnitAmount","CreatedBy","UpdatedBy","UpdatedAt")
            VALUES(?,?,?,?,?) ON CONFLICT("EffectiveFrom") DO UPDATE SET "UnitAmount"=excluded."UnitAmount",
            "UpdatedBy"=excluded."UpdatedBy","UpdatedAt"=excluded."UpdatedAt"''',
            (payload.EffectiveFrom, payload.UnitAmount, current_user["username"], current_user["username"], datetime.now().isoformat(timespec="seconds")))
        new = dict(conn.execute('SELECT * FROM "ConsultationPayRates" WHERE "EffectiveFrom"=?', (payload.EffectiveFrom,)).fetchone())
        _audit(conn, "ConsultationPayRates", new["Id"], dict(old) if old else None, new, current_user)
        pending = conn.execute('SELECT rowid AS row_id,* FROM "StudentConsultations" WHERE "PayUnitAmount" IS NULL').fetchall()
        for raw in pending:
            record = dict(raw)
            if not _eligible(record):
                continue
            try:
                _protected(conn, record)
            except HTTPException:
                continue
            amount, effective = _basis(conn, record["ConsultationDate"])
            if amount is not None:
                conn.execute('UPDATE "StudentConsultations" SET "PayUnitAmount"=?,"PayEffectiveFrom"=?,"UpdatedBy"=?,"UpdatedAt"=? WHERE rowid=?',
                             (amount, effective, current_user["username"], datetime.now().isoformat(timespec="seconds"), record["row_id"]))
                _audit(conn, "StudentConsultations", record["row_id"], record, _record(conn, record["row_id"]), current_user)
        return {"status": "success", "id": new["Id"], "message": "상담 단가가 저장되었습니다."}


@router.get("/api/user/students/{student_id}/consultations")
def get_student_consultations(student_id: int, current_user=Depends(get_current_user)):
    with _connection() as conn:
        student = _student(conn, student_id)
        rows = conn.execute('SELECT rowid AS row_id,* FROM "StudentConsultations" WHERE "StudentId"=? ORDER BY "CreatedAt" DESC,rowid DESC', (student["row_id"],)).fetchall()
        return {"consultations": [_view_record(conn, dict(r), current_user) for r in rows]}


@router.get("/api/user/consultations/{consultation_id}")
def get_consultation(consultation_id: int, current_user=Depends(get_current_user)):
    with _connection() as conn:
        record = _record(conn, consultation_id)
        if current_user["role"] == "teacher" and record["TeacherUsername"] != current_user["username"]:
            raise HTTPException(403, "본인이 진행한 상담만 상세 조회할 수 있습니다.")
        student = conn.execute('SELECT "Name" FROM "Students" WHERE rowid=?', (record["StudentId"],)).fetchone()
        record["StudentName"] = student[0] if student else ""
        return {"consultation": _view_record(conn, record, current_user)}


@router.post("/api/user/students/{student_id}/consultations")
def create_consultation(student_id: int, payload: StudentConsultationRequest, current_user=Depends(get_current_staff)):
    with _connection(True) as conn:
        student = _student(conn, student_id)
        _teacher(conn, payload.TeacherUsername)
        _protected(conn, consultation_date=payload.ConsultationDate, teacher=payload.TeacherUsername)
        amount, effective = _basis(conn, payload.ConsultationDate)
        cursor = conn.execute('''INSERT INTO "StudentConsultations"("StudentId","Content","ConsultationDate","DurationMinutes",
            "TeacherUsername","PayUnitAmount","PayEffectiveFrom","CreatedBy") VALUES(?,?,?,?,?,?,?,?)''',
            (student["row_id"], payload.Content, payload.ConsultationDate, payload.DurationMinutes, payload.TeacherUsername, amount, effective, current_user["username"]))
        key = cursor.lastrowid
        _audit(conn, "StudentConsultations", key, None, _record(conn, key), current_user)
        return {"status": "success", "message": "상담 기록이 추가되었습니다.", "id": key}


@router.put("/api/user/consultations/{consultation_id}")
def update_consultation(consultation_id: int, payload: StudentConsultationRequest, current_user=Depends(get_current_staff)):
    with _connection(True) as conn:
        old = _record(conn, consultation_id)
        _teacher(conn, payload.TeacherUsername)
        _protected(conn, old, payload.ConsultationDate, payload.TeacherUsername)
        amount, effective = (old["PayUnitAmount"], old["PayEffectiveFrom"])
        if old["ConsultationDate"] != payload.ConsultationDate:
            amount, effective = _basis(conn, payload.ConsultationDate)
        conn.execute('''UPDATE "StudentConsultations" SET "Content"=?,"ConsultationDate"=?,"DurationMinutes"=?,
            "TeacherUsername"=?,"PayUnitAmount"=?,"PayEffectiveFrom"=?,"UpdatedBy"=?,"UpdatedAt"=? WHERE rowid=?''',
            (payload.Content, payload.ConsultationDate, payload.DurationMinutes, payload.TeacherUsername, amount, effective,
             current_user["username"], datetime.now().isoformat(timespec="seconds"), consultation_id))
        _audit(conn, "StudentConsultations", consultation_id, old, _record(conn, consultation_id), current_user)
        return {"status": "success", "message": "상담 기록이 수정되었습니다."}


@router.delete("/api/user/consultations/{consultation_id}")
def delete_consultation(consultation_id: int, current_user=Depends(get_current_staff)):
    with _connection(True) as conn:
        old = _record(conn, consultation_id)
        _protected(conn, old)
        conn.execute('DELETE FROM "StudentConsultations" WHERE rowid=?', (consultation_id,))
        _audit(conn, "StudentConsultations", consultation_id, old, None, current_user)
        return {"status": "success", "message": "상담 기록이 삭제되었습니다."}


@router.post("/api/user/payroll/consultations/{consultation_id}/exclusion")
def exclude_consultation(consultation_id: int, payload: ConsultationExclusionRequest, current_user=Depends(get_current_staff)):
    _month(payload.PayrollMonth)
    with _connection(True) as conn:
        old = _record(conn, consultation_id)
        if not _eligible(old) or old["ConsultationDate"][:7] != payload.PayrollMonth or old["TeacherUsername"] != payload.TeacherUsername:
            raise HTTPException(409, "상담의 정산월 또는 선생님이 변경되었습니다. 다시 조회해 주세요.")
        _protected(conn, old)
        conn.execute('''UPDATE "StudentConsultations" SET "ExcludedFromPayroll"=?,"ExclusionReason"=?,"UpdatedBy"=?,"UpdatedAt"=? WHERE rowid=?''',
            (int(payload.Excluded), (payload.Reason or "").strip() if payload.Excluded else "", current_user["username"], datetime.now().isoformat(timespec="seconds"), consultation_id))
        _audit(conn, "StudentConsultations", consultation_id, old, _record(conn, consultation_id), current_user)
        return {"status": "success", "message": "상담 정산 제외 설정이 저장되었습니다."}
