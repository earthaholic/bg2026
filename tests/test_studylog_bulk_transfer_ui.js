// 실행: node --test tests/test_studylog_bulk_transfer_ui.js
// 실제 app.js를 추출해 실행한다. DOM과 통신만 대체하며 운영 DB에는 접근하지 않는다.
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
    "const token = 'test-token'; let studylogSearchPage = 1; let studylogSearchLimit = 30; let studylogSearchTotalPages = 1;",
    between('    // StudyLog Search View Elements', '    // StudyLog Detail Modal Elements'),
    between("    let studylogSortBy = 'row_id';", '    // Load StudyLog Search Results Grid'),
    between('    async function loadStudyLogSearchResults', '    async function toggleBookField'),
    between('    function renderStudyLogCards', '    // Open StudyLog Detail Modal'),
    `globalThis.__transferTest = {
        open: openStudylogBulkTransferModal, close: closeStudylogBulkTransferModal,
        search: searchStudylogTransferStudents, submit: submitStudylogBulkTransfer,
        update: updateStudylogTransferSubmit, sync: syncStudylogRowSelection,
        render: renderStudyLogCards, load: loadStudyLogSearchResults,
        selected: () => Array.from(studylogBulkSelected.values()),
        snapshot: () => studylogTransferSnapshot.map(item => ({ ...item })),
        target: () => studylogTransferTarget && ({ ...studylogTransferTarget }),
        busy: () => studylogTransferBusy
    };`
].join('\n');

function element(extra = {}) {
    const listeners = new Map();
    const classes = new Set(['hidden']);
    return {
        value: '', textContent: '', innerHTML: '', disabled: false, checked: false,
        indeterminate: false, dataset: {}, focus() {},
        classList: {
            add: value => classes.add(value), remove: value => classes.delete(value),
            contains: value => classes.has(value)
        },
        addEventListener(type, listener) {
            if (!listeners.has(type)) listeners.set(type, []);
            listeners.get(type).push(listener);
        },
        // 비활성 버튼의 콜백도 호출하여 화면 상태뿐 아니라 함수 내부 방어를 검증한다.
        async emit(type, event = {}) {
            for (const listener of listeners.get(type) || []) await listener(event);
        },
        async click() { await this.emit('click'); },
        ...extra
    };
}
function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
const students = [
    { row_id: 101, Id: 901, Name: '받는학생', Grade: 3 },
    { Id: 202, Name: '다른학생', Grade: 4 }
];
const emptySearch = () => ({ total_pages: 1, total_count: 0, studylogs: [] });
const plain = value => JSON.parse(JSON.stringify(value));
const flush = () => new Promise(resolve => setImmediate(resolve));

function fixture({ staff = true, apiFetch } = {}) {
    const ids = [
        'studylog-search-q', 'studylog-filter-date', 'btn-do-studylog-search',
        'btn-reset-studylog-filter', 'studylog-search-total-count',
        'studylog-search-pagination-info', 'studylog-cards-grid',
        'btn-studylog-search-prev', 'btn-studylog-search-next', 'studylog-search-current-page',
        'studylog-select-all', 'studylog-bulk-selected-count', 'btn-open-studylog-bulk-delete',
        'modal-studylog-bulk-delete', 'input-studylog-bulk-delete-confirm',
        'btn-submit-studylog-bulk-delete', 'studylog-bulk-delete-error',
        'studylog-bulk-delete-count', 'studylog-bulk-delete-list',
        'modal-studylog-bulk-transfer', 'studylog-transfer-confirm',
        'btn-submit-studylog-bulk-transfer', 'studylog-transfer-student-q',
        'studylog-transfer-student-results', 'studylog-transfer-target', 'studylog-transfer-error',
        'studylog-bulk-transfer-count', 'studylog-bulk-transfer-list',
        'btn-open-studylog-bulk-transfer', 'btn-close-studylog-bulk-transfer',
        'btn-cancel-studylog-bulk-transfer', 'btn-search-studylog-transfer-student'
    ];
    const nodes = Object.fromEntries(ids.map(id => [id, element()]));
    const rows = [];
    let targetButtons = [];
    Object.defineProperty(nodes['studylog-cards-grid'], 'innerHTML', {
        get() { return this._html || ''; },
        set(html) {
            this._html = html;
            rows.length = 0;
            const pattern = /<input type="checkbox" class="studylog-row-select" value="(\d+)" data-student-name="([^"]*)" data-book-title="([^"]*)" data-studied-day="([^"]*)"/g;
            for (const match of html.matchAll(pattern)) rows.push(element({
                value: match[1],
                dataset: { studentName: match[2], bookTitle: match[3], studiedDay: match[4] }
            }));
        }
    });
    const results = nodes['studylog-transfer-student-results'];
    Object.defineProperties(results, {
        innerHTML: {
            get() { return this._html || ''; },
            set(html) {
                this._html = html;
                this._text = '';
                targetButtons = Array.from(html.matchAll(/data-transfer-student="(\d+)"/g), match =>
                    element({ dataset: { transferStudent: match[1] } }));
            }
        },
        textContent: {
            get() { return this._text || ''; },
            set(text) { this._text = text; this._html = ''; targetButtons = []; }
        }
    });
    results.querySelectorAll = selector => selector === '[data-transfer-student]' ? targetButtons : [];
    const calls = [], feedback = [];
    let recentReloads = 0;
    const context = vm.createContext({
        document: {
            getElementById: id => nodes[id] || null,
            querySelectorAll: selector => selector.startsWith('.studylog-row-select') ? rows : []
        },
        URLSearchParams, JSON, Math, Number, Array, Promise,
        isStaff: () => staff, escapeHtml: value => String(value), formatGrade: value => `${value}학년`,
        createActionFeedback: () => ({ show: (message, type) => feedback.push({ message, type }) }),
        loadRecentStudyLogs: async () => { recentReloads++; },
        apiFetch: async (url, options) => {
            calls.push({ url, options });
            if (apiFetch) return apiFetch(url, options);
            if (url.startsWith('/api/user/picker/students?')) return { students };
            if (url.startsWith('/api/user/studylogs/search?')) return emptySearch();
            return {};
        }
    });
    vm.runInContext(code, context);
    return {
        nodes, rows, calls, feedback, api: context.__transferTest,
        buttons: () => targetButtons, setStaff: value => { staff = value; },
        recentReloads: () => recentReloads,
        posts: () => calls.filter(call => call.url === '/api/user/studylogs/bulk-transfer')
    };
}
function selectRows(f, ids = [7, 12]) {
    f.api.render(ids.map(id => ({
        row_id: id, Id: id + 1000, StudentName: `원래학생${id}`, BookTitle: `도서${id}`,
        StudiedDay: '2026-09-19', CanDelete: true
    })));
    for (const row of f.rows) { row.checked = true; f.api.sync(row); }
}
async function openReady(f) {
    selectRows(f);
    await f.nodes['btn-open-studylog-bulk-transfer'].click();
    await flush();
    assert.equal(f.buttons().length, 2);
    await f.buttons()[0].click();
}
async function confirm(f, text = '선택한 기록 이동') {
    f.nodes['studylog-transfer-confirm'].value = text;
    await f.nodes['studylog-transfer-confirm'].emit('input');
}

test('일반 선생님은 선택해도 이동 창·검색·제출을 실행할 수 없다', async () => {
    const f = fixture({ staff: false });
    selectRows(f);
    assert.equal(f.nodes['btn-open-studylog-bulk-transfer'].disabled, true);
    await f.nodes['btn-open-studylog-bulk-transfer'].click();
    await f.api.search();
    await confirm(f);
    await f.api.submit();
    assert.equal(f.nodes['modal-studylog-bulk-transfer'].classList.contains('hidden'), true);
    assert.equal(f.api.snapshot().length, 0);
    assert.equal(f.calls.length, 0);
});

test('모달을 연 뒤 권한을 잃어도 함수가 제출을 다시 차단한다', async () => {
    const f = fixture();
    await openReady(f);
    await confirm(f);
    f.setStaff(false);
    f.api.update();
    assert.equal(f.nodes['btn-submit-studylog-bulk-transfer'].disabled, true);
    await f.api.submit();
    assert.equal(f.posts().length, 0);
});

test('선택 수는 1~50건으로 제한하고 모달은 열 때의 행과 표시값을 복사한다', async () => {
    const f = fixture();
    f.api.open();
    assert.equal(f.api.snapshot().length, 0);
    selectRows(f, Array.from({ length: 51 }, (_, i) => i + 1));
    f.api.open();
    assert.equal(f.api.snapshot().length, 0);
    for (const row of f.rows) { row.checked = false; f.api.sync(row); }
    selectRows(f);
    f.api.open();
    const before = plain(f.api.snapshot());
    f.api.selected()[0].studentName = '뒤늦은 변경';
    f.rows[0].checked = false; f.api.sync(f.rows[0]);
    assert.deepEqual(plain(f.api.snapshot()), before);
    assert.match(f.nodes['studylog-bulk-transfer-list'].innerHTML, /#7.*원래학생7/);
    assert.match(f.nodes['studylog-bulk-transfer-list'].innerHTML, /#12/);
    assert.match(f.nodes['studylog-bulk-transfer-count'].textContent, /2건/);
    await flush();
});

test('대상 학생을 바꾸면 기존 확인 문구와 제출 허용 상태를 초기화한다', async () => {
    const f = fixture();
    await openReady(f);
    await confirm(f);
    assert.equal(f.nodes['btn-submit-studylog-bulk-transfer'].disabled, false);
    await f.buttons()[1].click();
    assert.deepEqual(plain(f.api.target()), { id: 202, name: '다른학생' });
    assert.match(f.nodes['studylog-transfer-target'].textContent, /다른학생.*#202/);
    assert.equal(f.nodes['studylog-transfer-confirm'].value, '');
    assert.equal(f.nodes['btn-submit-studylog-bulk-transfer'].disabled, true);
});

test('대상 선택과 정확한 확인 문자열이 모두 있어야 제출할 수 있다', async () => {
    const f = fixture();
    selectRows(f); f.api.open(); await flush();
    await confirm(f);
    assert.equal(f.nodes['btn-submit-studylog-bulk-transfer'].disabled, true);
    await f.api.submit();
    await f.buttons()[0].click();
    for (const value of ['', ' 선택한 기록 이동', '선택한 기록 이동 ', '선택한 기록이동', '선택한 기록 이동\n', '선택한 기록 삭제']) {
        await confirm(f, value);
        assert.equal(f.nodes['btn-submit-studylog-bulk-transfer'].disabled, true, value);
        await f.api.submit();
    }
    assert.equal(f.posts().length, 0);
    await confirm(f);
    assert.equal(f.nodes['btn-submit-studylog-bulk-transfer'].disabled, false);
});

test('닫고 다시 열면 대상과 확인 입력을 초기화한다', async () => {
    const f = fixture();
    await openReady(f); await confirm(f);
    await f.nodes['btn-cancel-studylog-bulk-transfer'].click();
    assert.equal(f.api.target(), null);
    assert.equal(f.api.snapshot().length, 0);
    await f.nodes['btn-open-studylog-bulk-transfer'].click(); await flush();
    assert.equal(f.api.target(), null);
    assert.equal(f.nodes['studylog-transfer-confirm'].value, '');
    assert.equal(f.nodes['btn-submit-studylog-bulk-transfer'].disabled, true);
});

test('처리 중 재제출·닫기·재열기·학생 검색·대상 변경을 막고 전송 대상을 고정한다', async () => {
    const pending = deferred();
    const f = fixture({ apiFetch: url => {
        if (url === '/api/user/studylogs/bulk-transfer') return pending.promise;
        if (url.startsWith('/api/user/picker/students?')) return { students };
        return emptySearch();
    }});
    await openReady(f); await confirm(f);
    const otherButton = f.buttons()[1];
    const first = f.nodes['btn-submit-studylog-bulk-transfer'].click();
    await flush();
    const callCount = f.calls.length;
    assert.equal(f.api.busy(), true);
    assert.equal(f.nodes['studylog-transfer-confirm'].disabled, true);
    assert.equal(f.nodes['studylog-transfer-student-q'].disabled, true);
    assert.equal(f.nodes['btn-submit-studylog-bulk-transfer'].disabled, true);
    await f.nodes['btn-submit-studylog-bulk-transfer'].click();
    await f.nodes['btn-close-studylog-bulk-transfer'].click();
    await f.nodes['btn-cancel-studylog-bulk-transfer'].click();
    await f.nodes['btn-open-studylog-bulk-transfer'].click();
    await f.nodes['btn-search-studylog-transfer-student'].click();
    await otherButton.click();
    f.rows[0].checked = false; f.api.sync(f.rows[0]);
    assert.equal(f.calls.length, callCount);
    assert.equal(f.posts().length, 1);
    assert.equal(f.nodes['modal-studylog-bulk-transfer'].classList.contains('hidden'), false);
    assert.deepEqual(plain(f.api.snapshot()).map(item => item.id), [7, 12]);
    assert.equal(f.api.target().id, 101);
    assert.deepEqual(JSON.parse(f.posts()[0].options.body), {
        log_ids: [7, 12], target_student_id: 101, confirmation: '선택한 기록 이동'
    });
    pending.resolve({}); await first;
    assert.equal(f.api.busy(), false);
});

test('늦은 이전 학생 검색 응답이 최신 결과를 덮어쓰지 않는다', async () => {
    const requests = [];
    const f = fixture({ apiFetch: () => { const d = deferred(); requests.push(d); return d.promise; } });
    selectRows(f); f.api.open();
    f.nodes['studylog-transfer-student-q'].value = '최신';
    const latest = f.api.search();
    assert.equal(requests.length, 2);
    requests[1].resolve({ students: [{ row_id: 22, Name: '최신학생', Grade: 2 }] });
    await latest;
    requests[0].resolve({ students: [{ row_id: 11, Name: '이전학생', Grade: 1 }] });
    await flush();
    assert.match(f.nodes['studylog-transfer-student-results'].innerHTML, /최신학생/);
    assert.doesNotMatch(f.nodes['studylog-transfer-student-results'].innerHTML, /이전학생/);
    await f.buttons()[0].click();
    assert.equal(f.api.target().id, 22);
});

test('검색어 변경 및 모달 닫기는 대기 중인 검색의 성공·실패 응답을 무효화한다', async () => {
    const requests = [];
    const f = fixture({ apiFetch: () => { const d = deferred(); requests.push(d); return d.promise; } });
    selectRows(f); f.api.open();
    f.nodes['studylog-transfer-student-q'].value = '변경';
    await f.nodes['studylog-transfer-student-q'].emit('input');
    requests[0].resolve({ students }); await flush();
    assert.equal(f.buttons().length, 0);
    const searching = f.api.search();
    f.api.close();
    requests[1].reject(new Error('지난 검색 오류')); await searching;
    assert.doesNotMatch(f.nodes['studylog-transfer-student-results'].textContent, /지난 검색 오류/);
    assert.equal(f.api.target(), null);
});

test('이동 시작 전에 실행한 학생 검색은 처리 중 늦게 도착해도 반영하지 않는다', async () => {
    const pendingSearch = deferred(), pendingTransfer = deferred();
    let searches = 0;
    const f = fixture({ apiFetch: url => {
        if (url.startsWith('/api/user/picker/students?')) return ++searches === 1 ? { students } : pendingSearch.promise;
        if (url === '/api/user/studylogs/bulk-transfer') return pendingTransfer.promise;
        return emptySearch();
    }});
    await openReady(f); await confirm(f);
    const searching = f.api.search();
    const submitting = f.api.submit();
    pendingSearch.resolve({ students: [{ row_id: 303, Name: '늦은학생', Grade: 1 }] });
    await searching;
    assert.doesNotMatch(f.nodes['studylog-transfer-student-results'].innerHTML, /늦은학생/);
    assert.equal(f.api.target().id, 101);
    pendingTransfer.resolve({}); await submitting;
});

test('이동 실패는 선택과 스냅샷을 비워 같은 요청의 직접 재시도를 차단한다', async () => {
    const f = fixture({ apiFetch: url => {
        if (url === '/api/user/studylogs/bulk-transfer') throw new Error('통신 끊김');
        return { students };
    }});
    await openReady(f); await confirm(f);
    await f.nodes['btn-submit-studylog-bulk-transfer'].click();
    assert.equal(f.api.snapshot().length, 0);
    assert.equal(f.api.selected().length, 0);
    assert.equal(f.api.busy(), false);
    assert.equal(f.nodes['studylog-transfer-confirm'].value, '');
    assert.equal(f.nodes['studylog-transfer-confirm'].disabled, false);
    assert.equal(f.nodes['studylog-transfer-student-q'].disabled, false);
    assert.equal(f.nodes['studylog-transfer-error'].classList.contains('hidden'), false);
    assert.match(f.nodes['studylog-transfer-error'].textContent, /통신 끊김.*이미 처리되었을 수.*새로고침하여 확인하고 다시 선택/);
    await confirm(f);
    assert.equal(f.nodes['btn-submit-studylog-bulk-transfer'].disabled, true);
    await f.api.submit();
    assert.equal(f.posts().length, 1);
    assert.equal(f.recentReloads(), 0);
    assert.equal(f.feedback.length, 0);
});

test('성공은 원본 Id가 아닌 row_id와 대상 학생을 전송하고 목록·최근 기록을 새로 읽는다', async () => {
    const f = fixture();
    await openReady(f); await confirm(f);
    await f.nodes['btn-submit-studylog-bulk-transfer'].click();
    assert.equal(f.posts().length, 1);
    assert.equal(f.posts()[0].options.method, 'POST');
    assert.deepEqual(JSON.parse(f.posts()[0].options.body), {
        log_ids: [7, 12], target_student_id: 101, confirmation: '선택한 기록 이동'
    });
    assert.equal(f.calls.filter(call => call.url.startsWith('/api/user/studylogs/search?')).length, 1);
    assert.equal(f.recentReloads(), 1);
    assert.equal(f.nodes['modal-studylog-bulk-transfer'].classList.contains('hidden'), true);
    assert.equal(f.api.selected().length, 0);
    assert.equal(f.api.snapshot().length, 0);
    assert.equal(f.api.target(), null);
    assert.equal(f.feedback.length, 1);
    assert.equal(f.feedback[0].type, 'success');
    assert.match(f.feedback[0].message, /2건.*받는학생.*이동/);
});

test('학습 기록 재검색은 이동 선택을 초기화하고 늦은 이전 결과를 폐기한다', async () => {
    const requests = [];
    const f = fixture({ apiFetch: url => {
        if (url.startsWith('/api/user/picker/students?')) return { students };
        const d = deferred(); requests.push(d); return d.promise;
    }});
    await openReady(f);
    const older = f.api.load();
    const newer = f.api.load();
    assert.equal(f.api.snapshot().length, 0);
    assert.equal(f.api.selected().length, 0);
    assert.equal(f.api.target(), null);
    const response = (id, name) => ({ total_pages: 1, total_count: 1, studylogs: [
        { row_id: id, StudentName: name, BookTitle: '도서', StudiedDay: '2026-09-19', CanDelete: true }
    ] });
    requests[1].resolve(response(22, '최신')); await newer;
    requests[0].resolve(response(11, '이전')); await older;
    assert.match(f.nodes['studylog-cards-grid'].innerHTML, /#22/);
    assert.doesNotMatch(f.nodes['studylog-cards-grid'].innerHTML, /#11/);
});
