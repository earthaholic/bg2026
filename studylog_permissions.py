"""일반 선생님의 학습 기록 변경 권한과 입력 검증."""
from datetime import datetime

from fastapi import HTTPException


TEACHER_EDIT_FIELDS = {"BookId", "StudiedDay", "LessonContent", "Description", "IsSpecial"}


def mutation_permission(conn, log, row_id, user, target_day=None):
    """화면과 변경 API가 같은 권한 규칙을 사용한다."""
    if user.get("role") in ("admin", "subadmin", "manager"):
        return None
    if user.get("role") != "teacher":
        return (403, "학습 기록을 변경할 권한이 없습니다.")
    teacher = str(log.get("ActualTeacherUsername") or "").strip()
    if not teacher and log.get("ClassId"):
        row = conn.execute('SELECT "TeacherUsername" FROM "Classes" WHERE "Id"=?',
                           (log["ClassId"],)).fetchone()
        teacher = str(row["TeacherUsername"] or "").strip() if row else ""
    if not teacher or teacher != user["username"]:
        return (403, "본인이 진행한 수업 기록만 수정·삭제할 수 있습니다. 진행 선생님이 미지정된 기록은 관리 선생님에게 문의해 주세요.")
    if conn.execute('SELECT 1 FROM "TeacherPayrollLines" WHERE "StudyLogId"=?', (row_id,)).fetchone():
        return (409, "정산이 마감된 학습 기록은 수정·삭제할 수 없습니다. 관리 선생님에게 문의해 주세요.")
    months = {str(log.get("StudiedDay") or "")[:7]}
    if target_day is not None:
        months.add(target_day[:7])
    for month in months:
        if conn.execute('SELECT 1 FROM "TeacherPayrollClosures" WHERE "PayrollMonth"=? AND "TeacherUsername"=?',
                        (month, teacher)).fetchone():
            return (409, "기존 또는 변경할 날짜의 월 정산이 마감되어 수정·삭제할 수 없습니다. 관리 선생님에게 문의해 주세요.")
    return None


def validate_teacher_update(conn, data):
    if set(data) - TEACHER_EDIT_FIELDS:
        raise HTTPException(status_code=403, detail="일반 선생님은 날짜·도서·특강 여부·수업 내용·메모만 수정할 수 있습니다.")
    if not data:
        raise HTTPException(status_code=400, detail="수정할 항목을 입력해 주세요.")
    result = dict(data)
    if "StudiedDay" in result:
        day = result["StudiedDay"]
        try:
            if not isinstance(day, str) or datetime.strptime(day, "%Y-%m-%d").strftime("%Y-%m-%d") != day:
                raise ValueError()
        except ValueError:
            raise HTTPException(status_code=400, detail="학습 수행 일자는 유효한 YYYY-MM-DD 형식으로 입력해 주세요.")
    if "BookId" in result:
        book_id = result["BookId"]
        if type(book_id) is not int or book_id <= 0 or not conn.execute(
                'SELECT 1 FROM "Books" WHERE rowid=? OR "Id"=?', (book_id, book_id)).fetchone():
            raise HTTPException(status_code=400, detail="존재하는 학습 도서를 선택해 주세요.")
    if "IsSpecial" in result:
        if type(result["IsSpecial"]) not in (bool, int) or result["IsSpecial"] not in (0, 1):
            raise HTTPException(status_code=400, detail="특강 여부는 일반(0) 또는 특강(1)이어야 합니다.")
        result["IsSpecial"] = int(result["IsSpecial"])
    for field in ("LessonContent", "Description"):
        if field in result and not isinstance(result[field], str):
            raise HTTPException(status_code=400, detail="수업 내용과 메모는 문자열로 입력해 주세요.")
    return result
