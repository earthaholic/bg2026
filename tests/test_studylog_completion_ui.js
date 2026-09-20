// 실행: node --test tests/test_studylog_completion_ui.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../static/js/app.js'), 'utf8');
const template = fs.readFileSync(path.join(__dirname, '../templates/index.html'), 'utf8');
const start = source.indexOf('    const completionState =');
assert.ok(start > 0);
const snippet = source.slice(start, source.lastIndexOf('});'));
const escapeHtml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

function harness({ staff = true } = {}) {
    const elements = new Map();
    const element = id => {
        if (!elements.has(id)) {
            const classes = new Set(id === 'view-studylog-completion' ? ['active'] : []);
            const listeners = {};
            elements.set(id, {
                id, value: '', textContent: '', innerHTML: '', disabled: false, checked: false,
                indeterminate: false, hidden: false, dataset: {}, handlers: {},
                classList: {
                    contains: name => classes.has(name),
                    toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
                },
                addEventListener(type, callback) {
                    (listeners[type] ||= []).push(callback);
                    this.handlers[type] = event => {
                        let result;
                        for (const listener of listeners[type]) result = listener(event);
                        return result;
                    };
                },
                querySelector(selector) { return element(`${id}:${selector}`); },
                querySelectorAll(selector) {
                    if (id !== 'completion-body' || selector !== '.completion-row-select') return [];
                    return [...this.innerHTML.matchAll(/<input\b[^>]*class="completion-row-select"[^>]*data-row-id="(\d+)"[^>]*>/g)].map(match => {
                        const box = element(`completion-row-select-${match[1]}`);
                        box.dataset.rowId = match[1];
                        box.closest = selector => selector === 'tr' ? element(`completion-row-${match[1]}`) : box;
                        return box;
                    });
                },
                closest() { return element('view-studylog-completion'); },
                replaceChildren() { this.innerHTML = ''; },
                showModal() { this.open = true; },
                close() { this.open = false; this.handlers.close?.(); },
                focus() { this.focused = true; },
            });
        }
        return elements.get(id);
    };
    const location = { href: 'http://127.0.0.1:8000/?view=studylog-completion', search: '?view=studylog-completion' };
    const history = {
        replaceState(_state, _title, url) { location.href = String(url); location.search = new URL(url).search; },
        pushState(_state, _title, url) { location.href = String(url); location.search = new URL(url).search; },
    };
    const document = { getElementById: element, addEventListener() {}, querySelector: () => element('view-studylog-completion') };
    const window = { confirm: () => false, handlers: {}, addEventListener(type, callback) { this.handlers[type] = callback; } };
    const calls = [];
    const context = vm.createContext({
        URL, URLSearchParams, document, window, location, history, escapeHtml,
        isStaff: () => staff, userName: value => value || '', formatGrade: value => value || '',
        hideRecordCoverageTooltip() {}, switchView() {}, openClassDetailModal() {},
        modalClassDetail: element('modal-class-detail'), modalClassDetailBody: element('modal-class-detail-body'), currentDetailClass: null,
        apiFetch: async (url, options) => { calls.push({ url, options }); return response(); },
    });
    vm.runInContext(snippet + '\n;globalThis.state = completionState;', context);
    return { context, state: context.state, element, elements, window, location, calls };
}

function response(rows = []) {
    return { student: { row_id: 7, Name: '가람' }, coverage: { total: 3, teacher_filled: 1, content_filled: 0 }, page: 1, total_pages: 1, total_count: rows.length, rows, teachers: [{ username: 'teacher', name: '선생님' }] };
}
function row(overrides = {}) {
    return { row_id: 10, StudiedDay: '2026-09-20', ClassName: '독서반', BookTitle: '책', ActualTeacherUsername: 'teacher', LessonContent: '', CanEdit: true, MutationBlockedReason: '', token: '서명된-조회값', ...overrides };
}
function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

test('수정 불가 행은 서버 권한과 사유에 따라 입력 및 저장을 비활성화한다', () => {
    const h = harness();
    h.state.drafts.set(10, '입력 중');
    h.context.renderCompletionRows(response([row({ CanEdit: false, MutationBlockedReason: '정산 마감 <확인>' })]));
    const html = h.element('completion-body').innerHTML;
    assert.match(html, /<textarea[^>]*disabled/);
    assert.match(html, /<button[^>]*completion-save[^>]*disabled/);
    assert.match(html, /정산 마감 &lt;확인&gt;/);
    assert.doesNotMatch(html, /<확인>/);
});

test('행의 내용과 초안 및 선생님 이름을 이스케이프한다', () => {
    const h = harness();
    h.state.drafts.set(10, '</textarea><img src=x>');
    h.context.renderCompletionRows(response([row({ ClassName: '<수업>', BookTitle: '<책>' })]));
    let html = h.element('completion-body').innerHTML;
    assert.doesNotMatch(html, /<img|<수업>|<책>/);
    assert.match(html, /&lt;\/textarea&gt;&lt;img src=x&gt;/);
    h.state.field = 'teacher';
    const data = response([row({ LessonContent: '<script>내용</script>' })]);
    data.teachers = [{ username: '"<계정>', name: '<선생님>' }];
    h.context.renderCompletionRows(data);
    html = h.element('completion-body').innerHTML;
    assert.doesNotMatch(html, /<script>|<선생님>|<계정>/);
    assert.match(html, /value="&quot;&lt;계정&gt;"/);
});

test('빈 입력은 저장할 수 없고 재조회 뒤에도 다른 행 초안이 유지된다', () => {
    const h = harness();
    h.state.drafts.set(11, '다른 기록 입력');
    h.context.renderCompletionRows(response([row(), row({ row_id: 11 })]));
    const html = h.element('completion-body').innerHTML;
    assert.match(html, /completion-save" data-row-id="10" disabled/);
    assert.match(html, /completion-dirty/);
    assert.match(html, /다른 기록 입력/);
    assert.equal(h.state.drafts.get(11), '다른 기록 입력');
});

test('일반 선생님은 주소로 진입해도 선생님 지정 대신 수업 내용만 선택된다', () => {
    const h = harness({ staff: false });
    h.location.search = '?view=studylog-completion&student_id=7&field=teacher&page=2';
    h.context.loadCompletionRows = () => {};
    h.context.initCompletionView();
    assert.equal(h.state.field, 'content');
    assert.equal(h.element('completion-field:[value="teacher"]').disabled, true);
    assert.equal(h.element('completion-field').value, 'content');
    assert.equal(h.state.studentId, 7);
});

test('학생·항목·페이지를 주소에 유지하고 다른 화면 검색 조건은 섞지 않는다', () => {
    const h = harness();
    h.location.href = 'http://127.0.0.1:8000/?view=class-list&q=예전조건';
    h.state.studentId = 7;
    h.state.field = 'teacher';
    h.state.page = 3;
    h.context.completionUrl();
    const params = new URL(h.location.href).searchParams;
    assert.equal(params.get('view'), 'studylog-completion');
    assert.equal(params.get('student_id'), '7');
    assert.equal(params.get('field'), 'teacher');
    assert.equal(params.get('page'), '3');
    assert.equal(params.has('q'), false);
    assert.equal(h.state.url, h.location.href);
});

test('미저장 이탈 취소는 초안을 유지하고 저장 중에는 이탈을 막는다', () => {
    const h = harness();
    h.state.drafts.set(10, '초안');
    assert.equal(h.context.confirmCompletionLeave(), false);
    assert.equal(h.state.drafts.get(10), '초안');
    h.window.confirm = () => true;
    h.state.busy = true;
    assert.equal(h.context.confirmCompletionLeave(), false);
    assert.match(h.element('completion-status').textContent, /저장 중/);
    h.state.busy = false;
    assert.equal(h.context.confirmCompletionLeave(), true);
    assert.equal(h.state.drafts.size, 0);
    assert.match(source, /targetView !== 'studylog-completion'[\s\S]*?!confirmCompletionLeave\(\)/);
});

test('페이지·항목 전환 취소와 브라우저 종료에서도 미저장 입력을 보호한다', () => {
    const h = harness();
    h.state.drafts.set(10, '초안');
    h.element('completion-field').value = 'teacher';
    h.element('completion-field').handlers.change();
    assert.equal(h.state.field, 'content');
    assert.equal(h.element('completion-field').value, 'content');
    h.element('completion-next').handlers.click();
    assert.equal(h.state.page, 1);
    const event = { prevented: false, preventDefault() { this.prevented = true; } };
    h.window.handlers.beforeunload(event);
    assert.equal(event.prevented, true);
});

test('늦게 도착한 이전 학생 조회는 현재 결과를 덮어쓰지 않는다', async () => {
    const h = harness();
    const old = deferred();
    const current = deferred();
    let request = 0;
    h.context.apiFetch = () => ++request === 1 ? old.promise : current.promise;
    h.state.studentId = 7;
    const first = h.context.loadCompletionRows();
    h.state.studentId = 8;
    const second = h.context.loadCompletionRows();
    const newData = response([row({ BookTitle: '최신 결과' })]);
    newData.student = { row_id: 8, Name: '새 학생' };
    current.resolve(newData);
    await second;
    old.resolve(response([row({ BookTitle: '오래된 결과' })]));
    await first;
    assert.equal(h.element('completion-student-name').textContent, '새 학생 · #8');
    assert.match(h.element('completion-body').innerHTML, /최신 결과/);
    assert.doesNotMatch(h.element('completion-body').innerHTML, /오래된 결과/);
});

test('행 저장 버튼은 즉시 쓰지 않고 대상·변경 내용 확인창을 연다', () => {
    const h = harness();
    h.state.rows = [row()];
    h.state.drafts.set(10, '<새 내용>');
    h.element('completion-student-name').textContent = '가람 · #7';
    h.element('completion-body').handlers.click({ target: { closest: () => ({ dataset: { rowId: '10' } }) } });
    assert.equal(h.element('completion-confirm-dialog').open, true);
    assert.equal(h.calls.length, 0);
    assert.match(h.element('completion-confirm-body').innerHTML, /기록 #10/);
    assert.match(h.element('completion-confirm-body').innerHTML, /&lt;새 내용&gt;/);
    assert.match(h.element('completion-confirm-body').innerHTML, /미입력/);
    assert.match(template, /id="completion-confirm-save"[^>]*>확인 후 저장/);
});

test('확인 후 저장은 항목·값·토큰만 전송하고 저장한 초안만 지운다', async () => {
    const h = harness();
    h.state.studentId = 7;
    h.state.pending = { row: row(), value: '수업 내용', field: 'content' };
    h.state.drafts.set(10, '수업 내용');
    h.state.drafts.set(11, '다른 행의 초안');
    await h.element('completion-confirm-save').handlers.click();
    const save = h.calls.find(call => call.options?.method === 'POST');
    assert.equal(save.url, '/api/user/studylog-completion/10');
    assert.deepEqual(JSON.parse(save.options.body), { field: 'content', value: '수업 내용', token: '서명된-조회값' });
    assert.equal(h.state.drafts.has(10), false);
    assert.equal(h.state.drafts.get(11), '다른 행의 초안');
    assert.equal(h.state.busy, false);
    assert.equal(h.state.pending, null);
    assert.match(h.element('completion-status').textContent, /저장했습니다/);
});

test('저장 실패는 초안을 지우지 않고 재시도 안내를 표시한다', async () => {
    const h = harness();
    h.state.pending = { row: row(), value: '보존할 내용', field: 'content' };
    h.state.drafts.set(10, '보존할 내용');
    h.context.apiFetch = async () => { throw new Error('다른 사용자가 수정했습니다.'); };
    await h.element('completion-confirm-save').handlers.click();
    assert.equal(h.state.drafts.get(10), '보존할 내용');
    assert.match(h.element('completion-status').textContent, /다른 사용자가 수정/);
    assert.match(h.element('completion-status').textContent, /입력한 내용은 유지/);
    assert.equal(h.element('completion-confirm-save').disabled, false);
});

test('저장 중 중복 제출 및 확인창 취소를 방지한다', async () => {
    const h = harness();
    const pending = deferred();
    let saves = 0;
    h.context.apiFetch = async () => { saves++; return pending.promise; };
    h.context.loadCompletionRows = async () => {};
    h.state.pending = { row: row(), value: '내용', field: 'content' };
    const first = h.element('completion-confirm-save').handlers.click();
    await h.element('completion-confirm-save').handlers.click();
    assert.equal(saves, 1);
    assert.equal(h.element('completion-confirm-save').disabled, true);
    const event = { prevented: false, preventDefault() { this.prevented = true; } };
    h.element('completion-confirm-dialog').handlers.cancel(event);
    assert.equal(event.prevented, true);
    pending.resolve({ status: 'success' });
    await first;
    assert.equal(h.state.busy, false);
});


test('같은 보완 화면의 다른 학생으로 뒤로가기해도 초안을 버리기 전에 확인한다', () => {
    const h = harness();
    const restoreStart = source.indexOf('    function restoreViewFromUrl()');
    const restoreEnd = source.indexOf("    window.addEventListener('popstate'", restoreStart);
    h.context.currentUser = { role: 'admin' };
    vm.runInContext(source.slice(restoreStart, restoreEnd), h.context);
    h.state.url = 'http://127.0.0.1:8000/?view=studylog-completion&student_id=7';
    h.state.studentId = 7;
    h.state.drafts.set(10, '계속 입력할 내용');
    h.location.href = 'http://127.0.0.1:8000/?view=studylog-completion&student_id=8';
    h.location.search = '?view=studylog-completion&student_id=8';
    let switched = false;
    h.context.history.replaceState = () => { throw new Error('이전 방문 기록을 덮어쓰면 안 됩니다.'); };
    h.context.switchView = () => { switched = true; };
    h.context.restoreViewFromUrl();
    assert.equal(switched, false);
    assert.equal(h.location.href, h.state.url);
    assert.equal(h.state.drafts.get(10), '계속 입력할 내용');
    h.window.confirm = () => true;
    h.location.href = 'http://127.0.0.1:8000/?view=studylog-completion&student_id=8';
    h.location.search = '?view=studylog-completion&student_id=8';
    h.context.restoreViewFromUrl();
    assert.equal(switched, true);
    assert.equal(h.state.drafts.size, 0);
});


function bulkHarness(rows = [row({ ActualTeacherUsername: '' }), row({ row_id: 11, ActualTeacherUsername: '' })], options = {}) {
    const h = harness(options);
    h.state.field = 'teacher';
    h.state.studentId = 7;
    h.context.renderCompletionRows(response(rows));
    return h;
}
function selectAll(h, checked = true) {
    const all = h.element('completion-select-all');
    all.checked = checked;
    h.element('completion-select-all').handlers.change({ target: all });
}
function chooseBulkTeacher(h, username = 'teacher') {
    h.element('completion-bulk-teacher').value = username;
    h.element('completion-bulk-teacher').handlers.change();
}
function selectRow(h, id, checked = true) {
    const box = h.element('completion-body').querySelectorAll('.completion-row-select').find(box => Number(box.dataset.rowId) === id);
    assert.ok(box, `기록 ${id}의 선택 상자`);
    box.checked = checked;
    h.element('completion-body').handlers.change({ target: { closest: selector => selector === '.completion-row-select' ? box : null } });
    return box;
}

test('일괄 선택 도구는 직원의 선생님 미입력 화면에서만 표시한다', () => {
    const h = bulkHarness();
    assert.equal(h.element('completion-bulk-toolbar').hidden, false);
    assert.equal(h.element('completion-select-heading').hidden, false);
    assert.match(h.element('completion-body').innerHTML, /class="completion-select-cell" >/);
    h.state.field = 'content';
    h.context.renderCompletionRows(response([row()]));
    assert.equal(h.element('completion-bulk-toolbar').hidden, true);
    assert.equal(h.element('completion-select-heading').hidden, true);
    assert.match(h.element('completion-body').innerHTML, /class="completion-select-cell" hidden/);
    const teacher = bulkHarness(undefined, { staff: false });
    assert.equal(teacher.element('completion-bulk-toolbar').hidden, true);
    assert.equal(teacher.element('completion-select-heading').hidden, true);
    selectAll(teacher);
    assert.equal(teacher.state.selected.size, 0);
    assert.match(template, /id="completion-select-all"[^>]*aria-label="현재 페이지의 지정 가능한 기록 전체 선택"/);
});

test('전체 선택은 권한·토큰·미입력 조건을 만족하는 현재 페이지 기록만 포함한다', () => {
    const h = bulkHarness([
        row({ row_id: 10, ActualTeacherUsername: '' }),
        row({ row_id: 11, ActualTeacherUsername: ' \t' }),
        row({ row_id: 12, ActualTeacherUsername: '', CanEdit: false }),
        row({ row_id: 13, ActualTeacherUsername: '', token: '' }),
        row({ row_id: 14, ActualTeacherUsername: '기존교사' }),
    ]);
    selectAll(h);
    assert.deepEqual([...h.state.selected], [10, 11]);
    assert.equal(h.element('completion-select-all').checked, true);
    assert.equal(h.element('completion-select-all').indeterminate, false);
    assert.equal(h.element('completion-selected-count').textContent, '현재 페이지에서 2건 선택');
    for (const id of [12, 13, 14]) assert.equal(h.element(`completion-row-select-${id}`).disabled, true);
    selectRow(h, 12);
    assert.equal(h.state.selected.has(12), false);
    selectAll(h, false);
    assert.equal(h.state.selected.size, 0);
    assert.equal(h.element('completion-select-all').checked, false);
});

test('개별 선택은 전체 선택의 부분 상태와 선택 행 강조를 갱신한다', () => {
    const h = bulkHarness();
    selectRow(h, 10);
    assert.equal(h.element('completion-select-all').checked, false);
    assert.equal(h.element('completion-select-all').indeterminate, true);
    assert.equal(h.element('completion-row-10').classList.contains('completion-selected'), true);
    selectRow(h, 11);
    assert.equal(h.element('completion-select-all').checked, true);
    assert.equal(h.element('completion-select-all').indeterminate, false);
    selectRow(h, 10, false);
    assert.equal(h.element('completion-row-10').classList.contains('completion-selected'), false);
    assert.equal(h.element('completion-select-all').indeterminate, true);
    h.element('completion-bulk-clear').handlers.click();
    assert.equal(h.state.selected.size, 0);
    assert.equal(h.element('completion-bulk-clear').disabled, true);
});

test('유효한 선생님과 한 건 이상의 선택이 있어야 일괄 확인창을 열 수 있다', () => {
    const h = bulkHarness();
    chooseBulkTeacher(h);
    assert.equal(h.element('completion-bulk-preview').disabled, true);
    selectAll(h);
    chooseBulkTeacher(h, '');
    assert.equal(h.element('completion-bulk-preview').disabled, true);
    h.element('completion-bulk-preview').handlers.click();
    assert.equal(h.state.pending, null);
    chooseBulkTeacher(h, '존재하지않는계정');
    assert.equal(h.element('completion-bulk-preview').disabled, true);
    chooseBulkTeacher(h);
    assert.equal(h.element('completion-bulk-preview').disabled, false);
    h.element('completion-bulk-preview').handlers.click();
    assert.equal(h.element('completion-confirm-dialog').open, true);
    assert.equal(h.calls.length, 0);
    assert.equal(h.element('completion-confirm-save').textContent, '2건 확인 후 저장');
});

test('일괄 확인창은 선택 당시 대상과 교사를 복사하고 표시값을 이스케이프한다', () => {
    const h = bulkHarness([row({ ActualTeacherUsername: '', BookTitle: '<책>', ClassName: '<수업>' })]);
    h.state.teachers = [{ username: '<교사계정>', name: '<교사이름>' }];
    h.element('completion-student-name').textContent = '<학생> · #7';
    h.state.drafts.set(10, '개별교사');
    selectAll(h);
    chooseBulkTeacher(h, '<교사계정>');
    h.context.openCompletionBulkPreview();
    const preview = h.element('completion-confirm-body').innerHTML;
    assert.doesNotMatch(preview, /<책>|<수업>|<학생>|<교사이름>|<교사계정>/);
    for (const value of ['책', '수업', '학생', '교사이름', '교사계정']) assert.ok(preview.includes(`&lt;${value}&gt;`));
    assert.match(preview, /개별 입력 중인 선생님 대신/);
    assert.match(preview, /전체 저장을 취소/);
    assert.match(preview, /#10/);
    h.state.rows[0].BookTitle = '나중에 바뀐 제목';
    h.state.rows[0].token = '바뀐 토큰';
    h.state.selected.clear();
    h.element('completion-bulk-teacher').value = '다른선생님';
    assert.equal(h.state.pending.teacher, '<교사계정>');
    assert.equal(h.state.pending.rows[0].BookTitle, '<책>');
    assert.equal(h.state.pending.rows[0].token, '서명된-조회값');
});

test('일괄 저장은 확인한 기록 번호·토큰과 교사만 전송하고 선택한 초안만 지운다', async () => {
    const h = bulkHarness();
    h.state.drafts.set(10, '개별교사1');
    h.state.drafts.set(11, '개별교사2');
    h.state.drafts.set(12, '선택하지않은초안');
    selectAll(h);
    chooseBulkTeacher(h);
    h.context.openCompletionBulkPreview();
    h.context.apiFetch = async (url, options) => {
        h.calls.push({ url, options });
        return options?.method === 'POST' ? { status: 'success', updated_count: 2 } : response();
    };
    await h.element('completion-confirm-save').handlers.click();
    const save = h.calls.find(call => call.options?.method === 'POST');
    assert.equal(save.url, '/api/user/studylog-completion/bulk-teacher');
    assert.deepEqual(JSON.parse(save.options.body), {
        teacher_username: 'teacher', records: [{ row_id: 10, token: '서명된-조회값' }, { row_id: 11, token: '서명된-조회값' }],
    });
    assert.equal(h.state.drafts.has(10), false);
    assert.equal(h.state.drafts.has(11), false);
    assert.equal(h.state.drafts.get(12), '선택하지않은초안');
    assert.ok(h.calls.some(call => !call.options?.method && call.url.startsWith('/api/user/studylog-completion?')));
    assert.equal(h.state.selected.size, 0);
    assert.equal(h.state.busy, false);
    assert.equal(h.state.pending, null);
    assert.match(h.element('completion-status').textContent, /2건의 실제 진행 선생님/);
});

test('일괄 저장 실패는 선택만 비우고 새로고침 전 재전송을 막으며 개별 초안은 보존한다', async () => {
    const h = bulkHarness();
    h.state.drafts.set(10, '유지할개별교사');
    selectAll(h);
    chooseBulkTeacher(h);
    h.context.openCompletionBulkPreview();
    h.context.apiFetch = async () => { throw new Error('선택한 기록의 정산이 마감되었습니다.'); };
    await h.element('completion-confirm-save').handlers.click();
    assert.equal(h.state.selected.size, 0);
    assert.equal(h.state.bulkNeedsRefresh, true);
    assert.equal(h.state.drafts.get(10), '유지할개별교사');
    assert.equal(h.element('completion-select-all').disabled, true);
    assert.equal(h.element('completion-bulk-preview').disabled, true);
    assert.match(h.element('completion-status').textContent, /새로고침/);
    selectAll(h);
    h.context.openCompletionBulkPreview();
    assert.equal(h.state.pending, null);
    assert.equal(h.state.selected.size, 0);
    h.context.apiFetch = async () => response([row({ ActualTeacherUsername: '' })]);
    await h.context.loadCompletionRows();
    assert.equal(h.state.bulkNeedsRefresh, false);
    assert.equal(h.element('completion-select-all').disabled, false);
    assert.equal(h.state.drafts.get(10), '유지할개별교사');
});

test('일괄 저장 중에는 중복 제출·취소·선택 변경을 막는다', async () => {
    const h = bulkHarness();
    selectAll(h);
    chooseBulkTeacher(h);
    h.context.openCompletionBulkPreview();
    const request = deferred();
    let saves = 0;
    h.context.apiFetch = () => { saves++; return request.promise; };
    h.context.loadCompletionRows = async () => {};
    const first = h.element('completion-confirm-save').handlers.click();
    await h.element('completion-confirm-save').handlers.click();
    selectAll(h, false);
    h.element('completion-bulk-clear').handlers.click();
    selectRow(h, 10, false);
    assert.deepEqual([...h.state.selected], [10, 11]);
    assert.equal(h.element('completion-select-all').disabled, true);
    assert.equal(h.element('completion-bulk-teacher').disabled, true);
    assert.equal(h.element('completion-confirm-save').disabled, true);
    h.element('completion-confirm-cancel').handlers.click();
    assert.equal(h.element('completion-confirm-dialog').open, true);
    const event = { prevented: false, preventDefault() { this.prevented = true; } };
    h.element('completion-confirm-dialog').handlers.cancel(event);
    assert.equal(event.prevented, true);
    assert.equal(saves, 1);
    request.resolve({ status: 'success', updated_count: 2 });
    await first;
    assert.equal(h.state.busy, false);
});

test('항목·페이지·학생 재조회는 이전 선택과 일괄 선생님을 즉시 초기화한다', async () => {
    const h = bulkHarness();
    for (const change of [() => { h.state.field = 'content'; }, () => { h.state.page = 2; }, () => { h.state.studentId = 8; }]) {
        h.state.field = 'teacher';
        h.state.rows = [row({ ActualTeacherUsername: '' })];
        h.state.selected.add(10);
        h.element('completion-bulk-teacher').value = 'teacher';
        h.state.bulkNeedsRefresh = true;
        change();
        const deferredResult = deferred();
        h.context.apiFetch = () => deferredResult.promise;
        const loading = h.context.loadCompletionRows();
        assert.equal(h.state.selected.size, 0);
        assert.equal(h.element('completion-bulk-teacher').value, '');
        assert.equal(h.state.bulkNeedsRefresh, false);
        assert.equal(h.element('completion-select-all').disabled, true);
        deferredResult.resolve(response());
        await loading;
    }
});

test('확인창을 연 뒤 권한이나 항목이 바뀌면 일괄 저장을 보내지 않는다', async () => {
    for (const revoke of [h => { h.context.isStaff = () => false; }, h => { h.state.field = 'content'; }]) {
        const h = bulkHarness();
        selectAll(h);
        chooseBulkTeacher(h);
        h.context.openCompletionBulkPreview();
        revoke(h);
        await h.element('completion-confirm-save').handlers.click();
        assert.equal(h.calls.length, 0);
        assert.equal(h.state.busy, false);
    }
});

test('확인창 취소는 저장하지 않고 선택을 유지하며 다음 확인은 최신 대상을 사용한다', () => {
    const h = bulkHarness();
    selectAll(h);
    chooseBulkTeacher(h);
    h.context.openCompletionBulkPreview();
    h.element('completion-confirm-cancel').handlers.click();
    assert.equal(h.state.pending, null);
    assert.equal(h.state.selected.size, 2);
    assert.equal(h.calls.length, 0);
    selectRow(h, 11, false);
    h.context.openCompletionBulkPreview();
    assert.deepEqual([...h.state.pending.rows].map(row => row.row_id), [10]);
    assert.equal(h.element('completion-confirm-save').textContent, '1건 확인 후 저장');
});
