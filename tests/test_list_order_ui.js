// 실행: node --test tests/test_list_order_ui.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('static/js/app.js', 'utf8');
function setup() {
    const context = vm.createContext({ document: { addEventListener() {}, getElementById() { return null; } } });
    const start = source.indexOf('    const NON_SORTABLE_HEADER_PATTERN');
    const end = source.indexOf("    document.querySelectorAll('table.modern-table').forEach", start);
    vm.runInContext(source.slice(start, end), context);
    const body = { rows: [], appendChild(row) { this.rows = this.rows.filter(item => item !== row); this.rows.push(row); } };
    const table = { dataset: {}, tBodies: [body] };
    const render = data => { body.rows = data.map(([id, value]) => ({ dataset: { studentId: String(id) }, cells: [{ textContent: value, dataset: {}, colSpan: 1 }], querySelector() { return null; } })); };
    return { context, table, body, render, order: () => body.rows.map(row => row.dataset.studentId), preserve: () => context.preserveTableOrder(table) };
}
test('수정으로 정렬 값이 바뀌어도 현재 행 순서를 유지한다', () => {
    const s = setup(); s.render([[1, '나'], [2, '가']]);
    Object.assign(s.table.dataset, { sortMode: 'client', sortColumn: '0', sortDirection: 'asc' });
    s.preserve(); assert.deepEqual(s.order(), ['2', '1']);
    s.render([[1, '나'], [2, '하']]); s.preserve();
    assert.deepEqual(s.order(), ['2', '1']);
});
test('기본 순서와 서버 정렬도 저장 후 유지하고 새 행만 끝에 추가한다', () => {
    const s = setup(); s.table.dataset.sortMode = 'server';
    s.render([[3, '다'], [1, '가'], [2, '나']]); s.preserve();
    s.render([[4, '라'], [2, '나'], [3, '다']]); s.preserve();
    assert.deepEqual(s.order(), ['3', '2', '4']);
});
test('로딩 안내 후에도 순서를 복원하며 반복 호출은 DOM을 변경하지 않는다', () => {
    const s = setup(); s.render([[2, '나'], [1, '가']]); s.preserve();
    s.body.rows = [{ cells: [{ colSpan: 4 }] }]; s.preserve();
    s.render([[1, '가'], [2, '나']]); s.preserve();
    assert.deepEqual(s.order(), ['2', '1']);
    s.body.appendChild = () => assert.fail('같은 순서에서 DOM을 변경하면 안 됩니다.'); s.preserve();
});
test('명시적 필터 변경은 새 결과를 정렬하고 이전 비동기 관찰은 무시한다', () => {
    const s = setup(); s.render([[2, '나'], [1, '가']]); s.preserve();
    Object.assign(s.table.dataset, { sortMode: 'client', sortColumn: '0', sortDirection: 'desc' });
    const view = { querySelectorAll() { return [s.body]; } };
    const target = { closest(selector) { return selector === '.workspace-view' ? view : selector === 'table, .modal, dialog' ? null : {}; } };
    s.context.resetViewRowOrder({ target, type: 'change' }); s.preserve();
    s.render([[2, '가'], [1, '하']]); s.preserve(); assert.deepEqual(s.order(), ['1', '2']);
});
test('숫자·날짜·빈칸 정렬 기준을 유지한다', () => {
    const s = setup(); s.render([[1, '-'], [2, '10회'], [3, '2회']]);
    s.context.applyTableSort(s.table, 0, 'asc'); assert.deepEqual(s.order(), ['3', '2', '1']);
    s.context.applyTableSort(s.table, 0, 'desc'); assert.deepEqual(s.order(), ['2', '3', '1']);
});

function headerFor(table) {
    const header = { dataset: {}, colSpan: 1, textContent: '이름', classList: { add() {}, remove() {}, contains() { return true; } }, setAttribute() {}, querySelector() { return null; }, closest() { return table; } };
    header.parentElement = { children: [header] };
    table.querySelectorAll = () => [header];
    return header;
}
test('이미 정렬된 열을 선택해도 이후 수정 시 행 위치를 기억한다', () => {
    const s = setup(); s.render([[1, '가'], [2, '나']]);
    s.body.rows.forEach(row => row.cells[0].querySelector = () => null);
    s.table.querySelector = () => null;
    s.context.sortTableByHeader(headerFor(s.table));
    s.render([[1, '하'], [2, '나']]); s.preserve();
    assert.deepEqual(s.order(), ['1', '2']);
});
test('서버 정렬 선택은 이전 순서를 되살리지 않는다', () => {
    const s = setup(); s.render([[1, '가'], [2, '나']]); s.preserve();
    const header = headerFor(s.table);
    header.parentElement.children = [{}, header];
    s.table.querySelector = selector => selector === '#studylog-cards-grid' ? {} : null;
    s.context.loadStudyLogSearchResults = () => {};
    s.context.sortTableByHeader(header); s.preserve();
    s.render([[2, '나'], [1, '가']]); s.preserve();
    assert.deepEqual(s.order(), ['2', '1']);
});
