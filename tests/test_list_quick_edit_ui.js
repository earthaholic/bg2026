const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('static/js/app.js', 'utf8');
const helpers = source.slice(source.indexOf('    function listQuickEditEnabled('), source.indexOf('    function renderBookCards('));
function setup({staff = true, enabled = true, fail = false} = {}) {
    const calls = [];
    const toggle = {checked: enabled};
    const context = {isStaff: () => staff, document: {getElementById: () => toggle},
        escapeHtml: value => String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;'),
        createActionFeedback: () => ({show: (...args) => calls.push(args)}),
        apiFetch: async (url, options) => { calls.push([url, JSON.parse(options.body)]); if (fail) throw new Error('오류'); },
        loadStudentSearchResults: async () => calls.push('학생 재조회'),
        loadBookSearchResults: async () => calls.push('도서 재조회')};
    vm.createContext(context); vm.runInContext(helpers, context);
    context.showListQuickUndo = () => calls.push('되돌리기 제공');
    return {context, calls, toggle};
}
function input(kind = 'student', field = 'Grade', value = '초2') {
    return {dataset: {kind, field, id: '7', saved: '초1', options: JSON.stringify([['초1','초1'],['초2','초2']])}, value, setAttribute() {}, removeAttribute() {}};
}
test('꺼짐 또는 일반 선생님은 저장하지 않는다', async () => {
    for (const settings of [{enabled:false}, {staff:false}]) {
        const {context, calls} = setup(settings); const item = input();
        await context.saveListQuickChoice(item, item.value);
        assert.equal(calls.length, 0); assert.equal(item.dataset.saved, '초1');
        assert.match(context.quickChoice('student', 7, 'Grade', '초1', [['초1','초1']], '학년'), /disabled/);
    }
});
test('학년은 한 필드만 저장하고 목록을 갱신한다', async () => {
    const {context,calls} = setup(); const item = input();
    await context.saveListQuickChoice(item, item.value);
    assert.deepEqual(calls[0], ['/api/user/students/7', {data: {Grade:'초2'}}]);
    assert.equal(item.dataset.saved, '초2'); assert.ok(calls.includes('학생 재조회'));
});
test('PDF 저작권 없음 상태 2를 숫자로 보존한다', async () => {
    const {context,calls} = setup(); const item = input('book','IsPdfExist','2');
    await context.saveListQuickChoice(item, item.value);
    assert.deepEqual(calls[0], ['/api/user/books/7', {data: {IsPdfExist:2}}]);
});
test('저장 실패는 기존 값으로 복원하고 재시도 가능하다', async () => {
    const {context} = setup({fail:true}); const item = input();
    await context.saveListQuickChoice(item, item.value);
    assert.equal(item.dataset.saved, '초1');
    assert.equal(item.disabled, false); assert.equal(item.dataset.saving, undefined);
});
test('텍스트 필드 및 저장 중 중복 요청은 차단한다', async () => {
    const {context,calls} = setup();
    await context.saveListQuickChoice(input('book','Title','변경'));
    const item = input(); item.dataset.saving = 'true'; await context.saveListQuickChoice(item, item.value);
    assert.equal(calls.length, 0);
});
test('기존 자유 입력 학년은 선택지에 보존하고 안전하게 출력한다', () => {
    const {context} = setup();
    const html = context.quickChoice('student',7,'Grade','기타<학년>', [['초1','초1']], '학년');
    assert.match(html, /기타&lt;학년>/); assert.match(html, /<button/); assert.ok(!html.includes('<select'));
});
test('클릭은 다음 값, Shift 클릭은 이전 값으로 순환한다', async () => {
    const {context} = setup(); const item = input();
    await context.cycleListQuickChoice(item, false);
    assert.equal(item.dataset.saved, '초2');
    await context.cycleListQuickChoice(item, true);
    assert.equal(item.dataset.saved, '초1');
});
test('화면 이동 시 스위치를 끄고 학년 선택지는 고3까지 제공한다', () => {
    assert.ok(source.includes("targetView !== kind + '-search'"));
    assert.ok(source.includes('toggle.checked = false; syncListQuickEdit(kind)'));
    assert.ok(source.includes("'초1','초2','초3','초4','초5','초6','중1','중2','중3','고1','고2','고3'"));
    assert.ok(!source.includes('btn-edit-student-from-list'));
});
