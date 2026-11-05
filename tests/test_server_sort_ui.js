// 실행: node --test tests/test_server_sort_ui.js
// 조회 목록의 머리글 클릭이 현재 페이지 재배열이 아니라 서버 전체 정렬로 이어지는지 확인한다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('static/js/app.js', 'utf8');

function setup() {
    const context = vm.createContext({
        document: { addEventListener() {}, getElementById() { return null; } },
        calls: [],
        setSortCalls: [],
        tableSchema: [],
        admin: true
    });
    vm.runInContext(`
        var bookSortBy = 'row_id', bookSortDirection = 'desc', searchPage = 3;
        var studylogSortBy = 'row_id', studylogSortDirection = 'desc', studylogSearchPage = 3;
        var studentSortBy = '', studentSortDirection = 'desc', studentSearchPage = 3;
        var classSortBy = '', classSortDirection = 'desc', classSearchPage = 3;
        var activitySortBy = '', activitySortDirection = 'desc';
        var auditSortBy = '', auditSortDirection = 'desc', auditLogPage = 3;
        var studioSortBy = '', studioSortDirection = 'desc', currentPage = 3;
        var tableHeadTr = { id: 'table-head-tr' };
        function loadBookSearchResults() { globalThis.calls.push('book'); }
        function loadStudyLogSearchResults() { globalThis.calls.push('studylog'); }
        function loadStudentSearchResults() { globalThis.calls.push('student'); }
        function loadClassSearchResults() { globalThis.calls.push('class'); }
        function loadActivityLogs(page) { globalThis.calls.push('activity:' + page); }
        function loadAuditLogs() { globalThis.calls.push('audit'); }
        function loadTableData() { globalThis.calls.push('studio'); }
        var tuitionCollection = { setSort(key, direction) { globalThis.setSortCalls.push(key + ':' + direction); } };
        function isAdmin() { return globalThis.admin; }
    `, context);
    const start = source.indexOf('    const NON_SORTABLE_HEADER_PATTERN');
    const end = source.indexOf("    document.querySelectorAll('table.modern-table').forEach", start);
    vm.runInContext(source.slice(start, end), context);
    return context;
}

// 열 순서: labels 배열 그대로. 관리 열은 버튼을 담은 셀로 둔다.
function tableFor(gridId, labels, { containsHead = false } = {}) {
    const headers = labels.map((label, index) => ({
        dataset: {}, colSpan: 1, textContent: label, cellIndex: index,
        classList: { add() {}, remove() {}, toggle() {}, contains() { return true; } },
        setAttribute() {}, querySelector() { return null; }
    }));
    headers.forEach(header => { header.parentElement = { children: headers }; });
    const body = {
        rows: labels.map(() => ({
            dataset: {},
            querySelector() { return null; },
            cells: labels.map(() => ({ textContent: '', dataset: {}, colSpan: 1, querySelector() { return null; } }))
        }))
    };
    const table = {
        dataset: {},
        tBodies: [body],
        querySelector(selector) { return selector === '#' + gridId ? body : null; },
        querySelectorAll() { return headers; },
        contains(target) { return containsHead && target === null ? false : Boolean(containsHead); }
    };
    headers.forEach(header => { header.closest = () => table; });
    return { table, headers };
}

const BOOK_LABELS = ['', 'ID', '도서명', '저자', '출판사', '대상/난이도', '분량 단계', '수업한 학생 수', '독서문제', 'PDF', '관리'];
const STUDENT_LABELS = ['ID', '학생 이름', '성별', '등록 학년', '추천인', '메모 / 특이사항', '수업 종료 여부', '관리'];
const CLASS_LABELS = ['ID', '수업명', '수업 요일', '시작 시간', '담당 선생님', '반 카테고리', '관리'];
const ACTIVITY_LABELS = ['일시 (한국 시간)', '계정 / 역할', '활동', '업무 영역', '대상', '결과', '상세'];
const AUDIT_LABELS = ['일시', '계정', '대상 테이블', '레코드', '액션', '변경 요약'];
const TC_LABELS = ['학생·수업', '잔여 차시', '진행 상태', '독촉', '결제창 발송', '다음 확인', '처리'];

test('도서 목록의 모든 정보 열이 서버 전체 정렬로 이어진다', () => {
    const context = setup();
    const { headers } = tableFor('book-cards-grid', BOOK_LABELS);
    const expected = { 1: 'row_id', 2: 'Title', 3: 'Author', 4: 'Publisher', 5: 'Target', 6: 'BookLength', 7: 'StudyStudentCount', 8: 'HasReadingQuestion', 9: 'IsPdfExist' };
    for (const [index, key] of Object.entries(expected)) {
        context.sortTableByHeader(headers[index]);
        assert.equal(context.bookSortBy, key, index);
        assert.equal(context.searchPage, 1);
    }
    assert.deepEqual(context.calls, Array(Object.keys(expected).length).fill('book'));
});

test('관리 열은 정렬하지 않고 목록을 다시 조회하지 않는다', () => {
    const context = setup();
    const { headers } = tableFor('book-cards-grid', BOOK_LABELS);
    context.sortTableByHeader(headers[10]);
    assert.deepEqual(context.calls, []);
    assert.equal(context.bookSortBy, 'row_id');
});

test('학생 목록은 이름·성별·학년·추천인·특이사항·수업 상태로 전체 정렬한다', () => {
    const context = setup();
    const { headers } = tableFor('student-cards-grid', STUDENT_LABELS);
    const expected = { 0: 'row_id', 1: 'Name', 2: 'Sex', 3: 'Grade', 4: 'Referrer', 5: 'Description', 6: 'IsClassEnded' };
    for (const [index, key] of Object.entries(expected)) {
        context.sortTableByHeader(headers[index]);
        assert.equal(context.studentSortBy, key, index);
        assert.equal(context.studentSearchPage, 1);
    }
    assert.equal(context.calls.length, Object.keys(expected).length);
});

test('수업 목록은 요일·시작 시간·담당 선생님·반 카테고리로 전체 정렬한다', () => {
    const context = setup();
    const { headers } = tableFor('class-cards-grid', CLASS_LABELS);
    const expected = { 0: 'Id', 1: 'ClassName', 2: 'DayOfWeek', 3: 'StartTime', 4: 'TeacherUsername', 5: 'CategoryName' };
    for (const [index, key] of Object.entries(expected)) {
        context.sortTableByHeader(headers[index]);
        assert.equal(context.classSortBy, key, index);
        assert.equal(context.classSearchPage, 1);
    }
    assert.equal(context.calls.length, Object.keys(expected).length);
});

test('활동 이력과 변경 이력은 첫 페이지부터 서버 정렬로 다시 조회한다', () => {
    const context = setup();
    const activity = tableFor('activity-body', ACTIVITY_LABELS);
    context.sortTableByHeader(activity.headers[2]);
    assert.equal(context.activitySortBy, 'event');
    assert.deepEqual(context.calls, ['activity:1']);

    const audit = tableFor('audit-log-body', AUDIT_LABELS);
    context.sortTableByHeader(audit.headers[3]);
    assert.equal(context.auditSortBy, 'record_id');
    assert.equal(context.auditLogPage, 1);
    assert.deepEqual(context.calls, ['activity:1', 'audit']);
});

test('납입 관리는 잔여 차시 등 열 정렬을 화면 모듈에 맡긴다', () => {
    const context = setup();
    const { headers } = tableFor('tc-body', TC_LABELS);
    context.sortTableByHeader(headers[1]);
    assert.deepEqual(context.setSortCalls, ['remaining:asc']);
    context.sortTableByHeader(headers[5]);
    assert.deepEqual(context.setSortCalls, ['remaining:asc', 'next_followup:asc']);
});

test('데이터 그리드 Studio는 동적 열 이름으로 전체 정렬한다', () => {
    const context = setup();
    context.tableSchema = [{ name: 'rowid' }, { name: 'Title' }, { name: 'Author' }];
    const { headers } = tableFor('data-grid-body', ['', 'rowid', 'Title', 'Author', '작업'], { containsHead: true });
    context.sortTableByHeader(headers[2]);
    assert.equal(context.studioSortBy, 'Title');
    assert.equal(context.currentPage, 1);
    assert.deepEqual(context.calls, ['studio']);
});

test('다시 누르면 정렬 방향이 바뀐다', () => {
    const context = setup();
    const { headers } = tableFor('book-cards-grid', BOOK_LABELS);
    context.sortTableByHeader(headers[2]);
    context.sortTableByHeader(headers[2]);
    assert.equal(context.bookSortBy, 'Title');
    assert.equal(context.bookSortDirection, 'desc');
});
