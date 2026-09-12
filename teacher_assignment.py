"""월별 차시표를 기존 학습 기록과 대조하는 읽기 전용 도우미."""
import csv
import hashlib
import io
import json
import re
import unicodedata
import zipfile
import posixpath
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import date, datetime, timedelta

MAX_ASSIGNMENT_LESSONS = 30000
MAX_ASSIGNMENT_ROWS = 60000
MAX_ASSIGNMENT_SHEET_ROWS = 50000


def read_xlsx_without_openpyxl(content):
    """선택 의존성이 없는 운영 환경에서 XLSX의 저장된 셀 값을 읽는다."""
    ns = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        workbook = ET.fromstring(archive.read('xl/workbook.xml'))
        relationships = ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))
        targets = {r.attrib['Id']: r.attrib['Target'] for r in relationships
                   if r.attrib.get('TargetMode') != 'External'}
        strings = []
        if 'xl/sharedStrings.xml' in archive.namelist():
            for item in ET.fromstring(archive.read('xl/sharedStrings.xml')):
                strings.append(''.join(node.text or '' for node in item.findall('.//s:t', ns)))
        date_styles = set()
        if 'xl/styles.xml' in archive.namelist():
            styles = ET.fromstring(archive.read('xl/styles.xml'))
            formats = {int(item.attrib['numFmtId']): item.attrib.get('formatCode', '')
                       for item in styles.findall('s:numFmts/s:numFmt', ns)}
            for index, item in enumerate(styles.findall('s:cellXfs/s:xf', ns)):
                format_id = int(item.attrib.get('numFmtId', '0'))
                code = re.sub(r'"[^"]*"|\[[^\]]*\]|\\.', '', formats.get(format_id, '')).lower()
                if format_id in set(range(14, 23)) | {45, 46, 47} or re.search(r'[yd]', code):
                    date_styles.add(index)
        props = workbook.find('s:workbookPr', ns)
        epoch_1904 = props is not None and props.attrib.get('date1904') in ('1', 'true')
        sheets = []
        for sheet in workbook.findall('s:sheets/s:sheet', ns):
            relation_id = sheet.attrib.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')
            target = targets.get(relation_id, '')
            if not target:
                continue
            path = posixpath.normpath(target.lstrip('/') if target.startswith('/') else 'xl/' + target)
            if not path.startswith('xl/'):
                raise ValueError('XLSX 시트 경로가 올바르지 않습니다.')
            root = ET.fromstring(archive.read(path))
            rows = []
            for row in root.findall('s:sheetData/s:row', ns):
                number = int(row.attrib.get('r', len(rows) + 1))
                if number > MAX_ASSIGNMENT_SHEET_ROWS:
                    raise ValueError(f'시트는 {MAX_ASSIGNMENT_SHEET_ROWS:,}행 이내로 준비해 주세요.')
                while len(rows) < number:
                    rows.append([])
                values = rows[number - 1]
                for cell in row.findall('s:c', ns):
                    address = re.match(r'([A-Z]+)', cell.attrib.get('r', ''))
                    column = 0
                    for char in address[1] if address else 'A':
                        column = column * 26 + ord(char) - 64
                    if column > 256:
                        raise ValueError('차시표는 256열 이내로 준비해 주세요.')
                    while len(values) < column:
                        values.append(None)
                    kind = cell.attrib.get('t', 'n')
                    value = cell.findtext('s:v', default='', namespaces=ns)
                    if kind == 's' and value:
                        value = strings[int(value)]
                    elif kind == 'inlineStr':
                        value = ''.join(t.text or '' for t in cell.findall('s:is//s:t', ns))
                    elif kind == 'd' and value:
                        value = datetime.fromisoformat(value.rstrip('Z'))
                    elif kind == 'n' and value:
                        value = float(value)
                        if int(cell.attrib.get('s', '0')) in date_styles:
                            # Excel의 1900년 윤년 호환 규칙과 1904 날짜 체계를 지원한다.
                            days = value + (1 if not epoch_1904 and 0 < value < 60 else 0)
                            value = datetime(1904, 1, 1) + timedelta(days=days) if epoch_1904 else datetime(1899, 12, 30) + timedelta(days=days)
                    values[column - 1] = value
            sheets.append((sheet.attrib.get('name', ''), rows))
        return sheets


def clean(value):
    return unicodedata.normalize('NFKC', str(value or '')).strip()


def student_name_key(value):
    """파일·서버 양쪽 학생명의 괄호 주석을 제외하며 원본 이름은 보존한다."""
    value = clean(value)
    while re.search(r'\([^()]*\)', value):
        value = re.sub(r'\([^()]*\)', '', value)
    return value.strip()


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
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            if sum(item.file_size for item in archive.infolist()) > 40 * 1024 * 1024:
                raise ValueError('압축 해제한 파일이 너무 큽니다. 월별 CSV를 사용해 주세요.')
        try:
            import openpyxl
        except ModuleNotFoundError:
            sheets = read_xlsx_without_openpyxl(content)
        else:
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
                if row_number > MAX_ASSIGNMENT_SHEET_ROWS:
                    raise ValueError(f'시트는 {MAX_ASSIGNMENT_SHEET_ROWS:,}행 이내로 준비해 주세요.')
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
                    if len(results) > MAX_ASSIGNMENT_LESSONS:
                        raise ValueError(f'한 번에 {MAX_ASSIGNMENT_LESSONS:,}차시까지 처리할 수 있습니다. 기준 월로 범위를 줄여 주세요.')
    finally:
        if workbook:
            workbook.close()
    if not results:
        raise ValueError('차시를 찾지 못했습니다. 이름·1차시~5차시 또는 이름·일자 헤더와 기준 월을 확인해 주세요.')
    return results


def assignment_context(conn):
    students = defaultdict(list)
    for row in conn.execute('SELECT rowid AS _rowid, "Id", "Name" FROM "Students"'):
        students[student_name_key(row['Name'])].append(dict(row))
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


def assignment_candidates(source, context):
    students, logs, *_ = context
    candidates = students.get(student_name_key(source['student_name']), [])
    results = []
    for student in candidates:
        matches = {}
        for key in (student['_rowid'], student['Id']):
            matches.update(logs.get((str(key), source['studied_day']), {}))
        results.extend((student, record) for record in matches.values())
    return candidates, results


def match_assignment(source, teacher, context):
    students, logs, frozen, closures, classes, books = context
    if source.get('error'):
        return None, source['error']
    candidates = students.get(student_name_key(source['student_name']), [])
    if source.get('matched_student_id') is not None:
        candidates = [student for student in candidates if student['_rowid'] == source['matched_student_id']]
    if len(candidates) != 1:
        return None, '동명이인 학생이 있습니다.' if candidates else '등록된 학생을 찾을 수 없습니다.'
    student = candidates[0]
    matches = {}
    for key in (student['_rowid'], student['Id']):
        matches.update(logs.get((str(key), source['studied_day']), {}))
    if source.get('matched_log_id') is not None:
        matches = {key: record for key, record in matches.items() if key == source['matched_log_id']}
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
