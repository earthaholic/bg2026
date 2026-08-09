"""
도서 제목 중복·유사 판정 엔진.

stdlib 전용: re, unicodedata. DB, 네트워크, 파일 IO 없음.
"""

import re
import unicodedata


def normalize_key(text: str) -> str:
    """NFC 정규화 → 소문자화 → 공백·문장부호·기호·밑줄 제거. 한글/영문/숫자 유지. 빈 입력 → 빈 문자열."""
    return re.sub(
        r'[\s\W_]+',
        '',
        unicodedata.normalize('NFC', text).lower(),
        flags=re.UNICODE,
    )


def syllable_bigrams(text: str) -> set:
    """인접 2음절 쌍 집합. 길이 < 2면 빈 set."""
    return set(zip(text, text[1:]))


def dice_coefficient(a: str, b: str) -> float:
    """2음절 bigram 기반 Dice 계수 (0.0 ~ 1.0)."""
    ba, bb = syllable_bigrams(a), syllable_bigrams(b)
    if not ba and not bb:
        return 0.0
    return 2.0 * len(ba & bb) / (len(ba) + len(bb))


def classify_match(norm_a: str, norm_b: str):
    """정규화된 두 문자열의 유사도 분류.

    반환값:
        None        - 하나라도 빈 문자열이거나, 어느 분류에도 해당하지 않음
        'exact'     - 완전 일치
        'contains'  - 짧은 쪽이 긴 쪽에 부분문자열로 포함됨 (길이 비율 ≥ 0.5, 짧은 쪽 길이 ≥ 2)
        'similar'   - 양쪽 길이 ≥ 2 이고 Dice 계수 ≥ 0.7
    """
    if not norm_a or not norm_b:
        return None

    if norm_a == norm_b:
        return 'exact'

    # 짧은 쪽, 긴 쪽 구분
    if len(norm_a) <= len(norm_b):
        short, long_ = norm_a, norm_b
    else:
        short, long_ = norm_b, norm_a

    if len(short) >= 2 and (len(short) / len(long_)) >= 0.5 and short in long_:
        return 'contains'

    if len(norm_a) >= 2 and len(norm_b) >= 2 and dice_coefficient(norm_a, norm_b) >= 0.7:
        return 'similar'

    return None
