"""월별 차시표를 기존 학습 기록과 대조하는 읽기 전용 도우미."""
import csv
import hashlib
import io
import json
import re
import unicodedata
import zipfile
from collections import defaultdict
from datetime import date, datetime


def clean(value):
    return unicodedata.normalize('NFKC', str(value or '')).strip()


def fingerprint(record):
    return hashlib.sha256(json.dumps(record, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()


def parse_day(value, month):
    if isinstance(value, (datetime, date)):
        return value.strftime('%Y-%m-%d')
    value = clean(value)
    match = re.fullmatch(r'(\d{4})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{1,2})\s*\.?', value)
    if match:
        return date(*map(int, match.groups())).isoformat()
    match = re.fullmatch(r'(\d{1,2})\s*[./-]\s*(\d{1,2})\s*\.?', value)
    if match and month:
        return date(int(month[:4]), *map(int, match.groups())).isoformat()
    raise ValueError('날짜를 확인해 주세요. 연도가 없는 날짜는 기준 월이 필요합니다.')


def parse_assignment_file(content, filename, month=''):
    if month and not re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])', month):
        raise ValueError('기준 월은 YYYY-MM 형식이어야 합니다.')
    workbook = None
    if filename.lower().endswith('.xlsx'):
        import openpyxl
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            if sum(item.file_size for item in archive.infolist()) > 40 * 1024 * 1024:
                raise ValueError('압축 해제한 파일이 너무 큽니다. 월별 CSV를 사용해 주세요.')
        workbook = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
        sheets = [(sheet.title, sheet.iter_rows(values_only=True)) for sheet in workbook]
    elif filename.lower().endswith('.csv'):
        try:
            text = content.decode('utf-8-sig')
        except UnicodeDecodeError:
            text = content.decode('cp949')
        sheets = [(filename, csv.reader(io.StringIO(text))) ]
    else:
        raise ValueError('XLSX 또는 CSV 파일을 선택해 주세요.')
    results = []
    try:
        for title, rows in sheets:
            inferred = re.search(r'(20\d{2})\s*[-.]\s*(\d{1,2})', clean(title))
            sheet_month = f'{inferred[1]}-{int(inferred[2]):02d}' if inferred else month
            header = None
            for row_number, cells in enumerate(rows, 1):
                if row_number > 10000:
                    raise ValueError('시트는 10,000행 이내로 준비해 주세요.')
                values = [clean(v) for v in cells]
                if '이름' in values and ('1차시' in values or '일자' in values):
                    header = values
                    continue
                if header is None:
                    continue
                name_index = header.index('이름')
                name = values[name_index] if name_index < len(values) else ''
                date_indexes = [i for i, value in enumerate(header) if re.fullmatch(r'\d+차시', value) or value == '일자']
                if not any(values):
                    continue
                # 월별 차시표 아래 자료 분석·정산 표는 학습 기록으로 읽지 않는다.
                if values[0] in ('자료분석', '자료 분석', '개별수업', '근무내용') or any(
                    value in ('수업단가', '수업 단가', '근무일시', '근무 일시', '상담단가') for value in values
                ):
                    break
                if not name:
                    continue
                for index in date_indexes:
                    if index >= len(cells) or not clean(cells[index]):
                        continue
                    item = {'sheet': title, 'row_number': row_number, 'column': header[index],
                            'student_name': name, 'studied_day': clean(cells[index]), 'error': ''}
                    try:
                        item['studied_day'] = parse_day(cells[index], sheet_month)
                        # 월 필터도 탭 이름이 아닌 셀의 실제 날짜에 적용한다.
                        if month and item['studied_day'][:7] != month:
                            continue
                    except ValueError as exc:
                        item['error'] = str(exc)
                    results.append(item)
                    if len(results) > 3000:
                        raise ValueError('한 번에 3,000차시까지 처리할 수 있습니다. 기준 월로 범위를 줄여 주세요.')
    finally:
        if workbook:
            workbook.close()
    if not results:
        raise ValueError('차시를 찾지 못했습니다. 이름·1차시~5차시 또는 이름·일자 헤더와 기준 월을 확인해 주세요.')
    return results


def assignment_context(conn):
    students = defaultdict(list)
    for row in conn.execute('SELECT rowid AS _rowid, "Id", "Name" FROM "Students"'):
        students[clean(row['Name'])].append(dict(row))
    logs = defaultdict(dict)
    for row in conn.execute('SELECT rowid AS _rowid, * FROM "StudyLogs"'):
        record = dict(row)
        logs[(str(row['StudentId']), str(row['StudiedDay'])[:10])][row['_rowid']] = record
    frozen = {str(row[0]) for row in conn.execute('SELECT "StudyLogId" FROM "TeacherPayrollLines"')}
    closures = {(row[0], row[1]) for row in conn.execute('SELECT "PayrollMonth", "TeacherUsername" FROM "TeacherPayrollClosures"')}
    classes = {str(row[0]): row[1] for row in conn.execute('SELECT "Id", "TeacherUsername" FROM "Classes"')}
    books = defaultdict(set)
    for row in conn.execute('SELECT rowid, "Id", "Title" FROM "Books"'):
        for key in (row[0], row[1]):
            books[str(key)].add(row[2] or '')
    return students, logs, frozen, closures, classes, books


def match_assignment(source, teacher, context):
    students, logs, frozen, closures, classes, books = context
    if source.get('error'):
        return None, source['error']
    candidates = students.get(clean(source['student_name']), [])
    if len(candidates) != 1:
        return None, '동명이인 학생이 있습니다.' if candidates else '등록된 학생을 찾을 수 없습니다.'
    student = candidates[0]
    matches = {}
    for key in (student['_rowid'], student['Id']):
        matches.update(logs.get((str(key), source['studied_day']), {}))
    if len(matches) != 1:
        return None, '같은 날 학습 기록이 여러 건입니다. 개별 확인이 필요합니다.' if matches else '해당 날짜의 학습 기록이 없습니다.'
    record = next(iter(matches.values()))
    actual = clean(record.get('ActualTeacherUsername'))
    if actual:
        return record, '이미 같은 선생님이 지정되어 있습니다.' if actual == teacher else '다른 선생님이 지정되어 있습니다.'
    class_teacher = classes.get(str(record.get('ClassId')), '')
    if class_teacher and class_teacher != teacher:
        return record, '연결된 수업의 담당 선생님이 다릅니다.'
    if str(record['_rowid']) in frozen or str(record.get('Id')) in frozen or (source['studied_day'][:7], teacher) in closures:
        return record, '해당 기록 또는 선생님의 월 정산이 마감되었습니다.'
    return record, ''
