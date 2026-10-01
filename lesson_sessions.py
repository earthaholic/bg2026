"""도서와 무관한 학생별 수업 차시 식별 기준."""
import json


def lesson_session_key(log, student_identity=None):
    """학생·날짜·진행 교사·수업·일반/특강·수업 내용이 같으면 같은 차시다."""
    student = student_identity if student_identity is not None else (log.get('StudentRowId') if log.get('StudentRowId') is not None else log.get('StudentId', ''))
    day = str(log.get('StudiedDay') or log.get('studied_day') or '').strip()[:10]
    teacher = next((str(log.get(field) or '').strip() for field in
                    ('EffectiveTeacherUsername', 'ActualTeacherUsername', 'TeacherUsername')
                    if str(log.get(field) or '').strip()), '')
    class_id = str(log.get('ClassId') or '')
    category = str(log.get('PayrollCategoryId') or '') if not class_id else ''
    special = str(log.get('IsSpecial', log.get('is_special', 0)) or 0).lower() in ('1', 'true')
    content = str(log.get('LessonContent') or log.get('lesson_content') or '').strip()
    return json.dumps([str(student or ''), day, teacher, class_id, category, special, content], ensure_ascii=False)


def group_payroll_sessions(rows):
    """원본 기록 식별자를 모두 보관하면서 화면에는 차시당 한 행을 제공한다."""
    groups = {}
    for row in rows:
        key = row.get('SessionKey') or '__single__:' + str(row['StudyLogId'])
        if key not in groups:
            groups[key] = dict(row, StudyLogIds=[], Amount=0)
        group = groups[key]
        group['StudyLogIds'].append(row['StudyLogId'])
        group['Amount'] += row['Amount']
        group['IsRateConfigured'] = group.get('IsRateConfigured', True) and row.get('IsRateConfigured', True)
    return list(groups.values())
