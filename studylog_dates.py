"""학습 이력 등록 가능 날짜 검증.

학습 이력은 실제로 진행한 수업의 기록이므로 오늘 이후 날짜에는 등록할 수 없다.
서버 시각대 설정과 무관하게 한국 표준시(KST, UTC+9) 기준 오늘을 사용한다.
개별 등록·수업 일괄 등록·수정·CSV 가져오기가 같은 규칙을 공유한다.
"""
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

KST = timezone(timedelta(hours=9), "KST")
FUTURE_DAY_MESSAGE = (
    "미래 날짜({day})에는 학습 이력을 등록할 수 없습니다. "
    "학습 일자는 오늘({today}, 한국 시간)까지만 등록할 수 있습니다."
)


def kst_today() -> str:
    """한국 시간 기준 오늘 날짜(YYYY-MM-DD)."""
    return datetime.now(KST).strftime("%Y-%m-%d")


def is_future_studied_day(day) -> bool:
    """형식이 올바른 날짜가 한국 시간 기준 오늘보다 뒤인지 확인한다."""
    text = str(day or "").strip()[:10]
    try:
        parsed = datetime.strptime(text, "%Y-%m-%d")
    except ValueError:
        return False
    return parsed.strftime("%Y-%m-%d") > kst_today()


def future_studied_day_message(day) -> str:
    return FUTURE_DAY_MESSAGE.format(day=str(day or "").strip()[:10], today=kst_today())


def ensure_not_future_studied_day(day) -> str:
    """미래 날짜면 400 오류를 발생시키고, 아니면 정리한 날짜를 돌려준다."""
    text = str(day or "").strip()
    if is_future_studied_day(text):
        raise HTTPException(status_code=400, detail=future_studied_day_message(text))
    return text
