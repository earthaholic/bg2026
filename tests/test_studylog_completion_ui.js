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
    const classes = new Set(['active']);
    const element = id => {
        if (!elements.has(id)) elements.set(id, {
            id, value: '', textContent: '', innerHTML: '', disabled: false, dataset: {}, handlers: {},
            classList: { contains: name => classes.has(name), toggle() {} },
            addEventListener(type, callback) { this.handlers[type] = callback; },
            querySelector(selector) { return element(`${id}:${selector}`); },
            querySelectorAll() { return []; },
            closest() { return element('view-studylog-completion'); },
            replaceChildren() { this.innerHTML = ''; },
            showModal() { this.open = true; }, close() { this.open = false; },
            focus() { this.focused = true; },
        });
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
