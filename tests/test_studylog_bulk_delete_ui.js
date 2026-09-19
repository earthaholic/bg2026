// 실행: node --test tests/test_studylog_bulk_delete_ui.js
// 실제 app.js의 학습 기록 선택 삭제 함수를 VM에서 실행하며 운영 DB에는 접근하지 않는다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../static/js/app.js'), 'utf8');
function between(start, end) {
    const first = source.indexOf(start);
    const last = source.indexOf(end, first);
    assert.ok(first >= 0 && last > first, `검증할 app.js 범위를 찾을 수 있어야 한다: ${start}`);
    return source.slice(first, last);
}

const code = [
    // 추출 범위 밖의 검색 상태 초기값도 실제 app.js 값과 동일하게 제공한다.
    "const token = 'test-token'; let studylogSearchPage = 1; let studylogSearchLimit = 30; let studylogSearchTotalPages = 1;",
    between('    // StudyLog Search View Elements', '    // StudyLog Detail Modal Elements'),
    between("    let studylogSortBy = 'row_id';", '    // Load StudyLog Search Results Grid'),
    between('    async function loadStudyLogSearchResults', '    async function toggleBookField'),
    between('    function renderStudyLogCards', '    // Open StudyLog Detail Modal'),
    `globalThis.__bulkTest = {
        clear: clearStudylogBulkSelection, update: updateStudylogBulkSelectionUI,
        sync: syncStudylogRowSelection, open: openStudylogBulkDeleteModal,
        close: closeStudylogBulkDeleteModal, updateSubmit: updateStudylogBulkDeleteSubmitState,
        render: renderStudyLogCards, load: loadStudyLogSearchResults,
        selected: () => Array.from(studylogBulkSelected.values()),
        snapshot: () => studylogBulkDeleteSnapshot.map(item => ({ ...item })),
        deleting: () => isStudylogBulkDeleting,
        requestId: () => studylogSearchRequestId
    };`
].join('\n');

function classList() {
    const values = new Set(['hidden']);
    return { add: value => values.add(value), remove: value => values.delete(value), contains: value => values.has(value) };
}
function element(extra = {}) {
    const listeners = {};
    return {
        value: '', textContent: '', innerHTML: '', disabled: false, checked: false, indeterminate: false,
        classList: classList(), dataset: {}, focus() {},
        addEventListener(type, listener) { listeners[type] = listener; },
        async click() { return listeners.click?.(); },
        ...extra
    };
}
function row(id, selectable = true) {
    return element({
        value: String(id), disabled: !selectable,
        dataset: { studentName: `학생${id}`, bookTitle: `도서${id}`, studiedDay: '2026-09-19' }
    });
}
function fixture({ apiFetch } = {}) {
    const rows = [];
    const nodes = {
        'studylog-search-q': element(), 'studylog-filter-date': element(),
        'studylog-search-total-count': element(), 'studylog-search-pagination-info': element(),
        'studylog-cards-grid': element(), 'btn-studylog-search-prev': element(),
        'btn-studylog-search-next': element(), 'studylog-search-current-page': element(),
        'studylog-select-all': element(), 'studylog-bulk-selected-count': element(),
        'btn-open-studylog-bulk-delete': element(), 'modal-studylog-bulk-delete': element(),
        'input-studylog-bulk-delete-confirm': element(), 'btn-submit-studylog-bulk-delete': element(),
        'studylog-bulk-delete-error': element(), 'studylog-bulk-delete-count': element(),
        'studylog-bulk-delete-list': element()
    };
    Object.defineProperty(nodes['studylog-cards-grid'], 'innerHTML', {
        get() { return this._html || ''; },
        set(html) {
            this._html = html;
            rows.length = 0;
            const pattern = /<input type="checkbox" class="studylog-row-select" value="(\d+)" data-student-name="([^"]*)" data-book-title="([^"]*)" data-studied-day="([^"]*)"/g;
            for (const match of html.matchAll(pattern)) rows.push(row(match[1], true));
        }
    });
    const document = {
        getElementById: id => nodes[id] || null,
        querySelectorAll(selector) {
            if (selector.startsWith('.studylog-row-select')) return selector.includes(':not(:disabled)') ? rows.filter(item => !item.disabled) : rows;
            return [];
        }
    };
    const feedback = [];
    const context = vm.createContext({
        document, URLSearchParams, JSON, Math, Number, Array, Promise,
        isStaff: () => false, escapeHtml: value => String(value),
        createActionFeedback: () => ({ show: (message, type) => feedback.push({ message, type }) }),
        loadRecentStudyLogs: async () => {},
        apiFetch: apiFetch || (async () => ({}))
    });
    vm.runInContext(code, context);
    return { nodes, rows, apiCalls: [], feedback, api: context.apiFetch, testApi: context.__bulkTest };
}
function renderRows(f, items) {
    f.testApi.render(items.map((item, index) => ({
        row_id: index + 1, StudentName: `학생${index + 1}`, BookTitle: `도서${index + 1}`,
        StudiedDay: '2026-09-19', CanDelete: item
    })));
}

// onchange 내부에서 update UI가 select-all 상태를 바꿔도, 처음 읽은 checked 값으로 현재 페이지 전체가 선택되어야 한다.
test('현재 페이지 전체 선택은 순회 중 체크 상태가 변해도 모든 삭제 가능 항목을 선택한다', () => {
    const f = fixture();
    renderRows(f, [true, true, true]);
    f.nodes['studylog-select-all'].checked = true;
    f.nodes['studylog-select-all'].onchange();
    assert.deepEqual(f.testApi.selected().map(item => item.id), [1, 2, 3]);
    assert.ok(f.rows.every(item => item.checked));
});

test('부분 선택은 전체 선택 상자를 indeterminate로 표시한다', () => {
    const f = fixture();
    renderRows(f, [true, true, false]);
    f.rows[0].checked = true;
    f.testApi.sync(f.rows[0]);
    assert.equal(f.nodes['studylog-select-all'].checked, false);
    assert.equal(f.nodes['studylog-select-all'].indeterminate, true);
    assert.equal(f.nodes['studylog-bulk-selected-count'].textContent, '현재 페이지에서 1건 선택됨');
});

test('정확한 확인 문자열만 제출 버튼을 활성화한다', () => {
    const f = fixture();
    renderRows(f, [true]);
    f.rows[0].checked = true;
    f.testApi.sync(f.rows[0]);
    f.testApi.open();
    for (const value of [' 선택한 기록 삭제', '선택한 기록 삭제 ', '선택한 기록삭제', '선택한 기록 삭제\n']) {
        f.nodes['input-studylog-bulk-delete-confirm'].value = value;
        f.testApi.updateSubmit();
        assert.equal(f.nodes['btn-submit-studylog-bulk-delete'].disabled, true, value);
    }
    f.nodes['input-studylog-bulk-delete-confirm'].value = '선택한 기록 삭제';
    f.testApi.updateSubmit();
    assert.equal(f.nodes['btn-submit-studylog-bulk-delete'].disabled, false);
});

test('모달을 닫고 다시 열면 확인 입력과 제출 상태를 초기화한다', () => {
    const f = fixture();
    renderRows(f, [true]); f.rows[0].checked = true; f.testApi.sync(f.rows[0]);
    f.testApi.open();
    f.nodes['input-studylog-bulk-delete-confirm'].value = '선택한 기록 삭제'; f.testApi.updateSubmit();
    f.testApi.close();
    f.testApi.open();
    assert.equal(f.nodes['input-studylog-bulk-delete-confirm'].value, '');
    assert.equal(f.nodes['btn-submit-studylog-bulk-delete'].disabled, true);
});

test('모달은 선택 당시의 삭제 대상 snapshot을 유지한다', () => {
    const f = fixture();
    renderRows(f, [true, true]);
    f.rows[0].checked = true; f.testApi.sync(f.rows[0]); f.testApi.open();
    f.rows[0].checked = false; f.testApi.sync(f.rows[0]); f.rows[1].checked = true; f.testApi.sync(f.rows[1]);
    assert.deepEqual(f.testApi.snapshot().map(item => item.id), [1]);
    assert.match(f.nodes['studylog-bulk-delete-list'].innerHTML, /#1/);
    assert.doesNotMatch(f.nodes['studylog-bulk-delete-list'].innerHTML, /#2/);
});

test('제출 중 이중 클릭과 모달 닫기를 막는다', async () => {
    let resolveDelete;
    let calls = 0;
    const f = fixture({ apiFetch: async (url) => {
        calls++;
        if (url === '/api/user/studylogs/bulk-delete') return new Promise(resolve => { resolveDelete = resolve; });
        return { total_pages: 1, total_count: 0, studylogs: [] };
    }});
    renderRows(f, [true]); f.rows[0].checked = true; f.testApi.sync(f.rows[0]); f.testApi.open();
    f.nodes['input-studylog-bulk-delete-confirm'].value = '선택한 기록 삭제';
    const first = f.nodes['btn-submit-studylog-bulk-delete'].click();
    await Promise.resolve();
    const second = f.nodes['btn-submit-studylog-bulk-delete'].click();
    f.testApi.close();
    assert.equal(calls, 1);
    assert.equal(f.testApi.deleting(), true);
    assert.equal(f.nodes['modal-studylog-bulk-delete'].classList.contains('hidden'), false);
    resolveDelete({}); await Promise.all([first, second]);
});

test('삭제 실패 뒤 snapshot과 선택을 비워 직접 재전송하지 못하게 한다', async () => {
    let calls = 0;
    const f = fixture({ apiFetch: async () => { calls++; throw new Error('네트워크 오류'); } });
    renderRows(f, [true]); f.rows[0].checked = true; f.testApi.sync(f.rows[0]); f.testApi.open();
    f.nodes['input-studylog-bulk-delete-confirm'].value = '선택한 기록 삭제';
    await f.nodes['btn-submit-studylog-bulk-delete'].click();
    assert.equal(f.testApi.snapshot().length, 0);
    assert.equal(f.testApi.selected().length, 0);
    assert.equal(f.nodes['btn-submit-studylog-bulk-delete'].disabled, true);
    assert.match(f.nodes['studylog-bulk-delete-error'].textContent, /새로고침하여 확인하고 다시 선택/);
    await f.nodes['btn-submit-studylog-bulk-delete'].click();
    assert.equal(calls, 1);
});

test('검색 새로고침은 선택을 초기화하고 늦은 이전 응답이 최신 결과를 덮어쓰지 않는다', async () => {
    const resolvers = [];
    const f = fixture({ apiFetch: () => new Promise(resolve => resolvers.push(resolve)) });
    renderRows(f, [true]); f.rows[0].checked = true; f.testApi.sync(f.rows[0]);
    const older = f.testApi.load();
    await Promise.resolve();
    const newer = f.testApi.load();
    await Promise.resolve();
    assert.equal(f.testApi.selected().length, 0);
    assert.equal(resolvers.length, 2);
    resolvers[1]({ total_pages: 1, total_count: 1, studylogs: [{ row_id: 22, StudentName: '최신', BookTitle: '최신 도서', StudiedDay: '2026-09-19', CanDelete: true }] });
    await newer;
    resolvers[0]({ total_pages: 1, total_count: 1, studylogs: [{ row_id: 11, StudentName: '이전', BookTitle: '이전 도서', StudiedDay: '2026-09-19', CanDelete: true }] });
    await older;
    assert.match(f.nodes['studylog-cards-grid'].innerHTML, /#22/);
    assert.doesNotMatch(f.nodes['studylog-cards-grid'].innerHTML, /#11/);
});


test('선택 열을 추가해도 수업 메모까지 기존 여덟 데이터 열의 정렬을 유지한다', () => {
    const context = vm.createContext({});
    vm.runInContext(between('    const NON_SORTABLE_HEADER_PATTERN', '    function enhanceSortableTable'), context);
    const table = { querySelector: selector => selector === '#studylog-cards-grid' };
    const headers = ['선택', 'ID', '학습 일자', '학생 이름', '수업 교사', '도서 제목', '특강 여부', '수업 내용', '수업 메모', '관리'].map((label, index) => ({
        dataset: {}, colSpan: 1, textContent: label, closest: () => table,
        querySelector: () => index === 0 ? {} : null
    }));
    headers.forEach(header => { header.parentElement = { children: headers }; });
    assert.equal(context.isSortableTableHeader(headers[0]), false);
    for (const header of headers.slice(1, 9)) assert.equal(context.isSortableTableHeader(header), true);
    assert.equal(context.isSortableTableHeader(headers[9]), false);
});
