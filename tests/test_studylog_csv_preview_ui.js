// 실행: node tests/test_studylog_csv_preview_ui.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('static/js/app.js', 'utf8');
const elements = new Map();
function element(id) {
    if (!elements.has(id)) elements.set(id, { innerHTML: '', textContent: '', disabled: false, classList: { remove() {} }, addEventListener(type, fn) { this[type] = fn; } });
    return elements.get(id);
}
const context = vm.createContext({ document: { getElementById: element }, escapeHtml: value => String(value).replaceAll('<', '&lt;') });
vm.runInContext(source.slice(source.indexOf('    let studyLogCsvPreview = null;'), source.indexOf('    let studyLogCsvClassLinksPreview = null;')), context);
const start = source.indexOf("    document.getElementById('studylog-csv-preview-body')?.addEventListener('change'");
vm.runInContext(source.slice(start, source.indexOf("    document.getElementById('btn-import-studylog-csv')?.addEventListener", start)), context);
const rows = [2, 3, 4].map(row_number => ({ row_number, student_id: 1, book_id: null, errors: ['도서 후보가 불확실합니다.'], warnings: ['<안내>'], ready: false }));
context.rows = rows;
vm.runInContext('studyLogCsvPreview = { rows }; renderStudyLogCsvPreview();', context);
const body = element('studylog-csv-preview-body');
// 실제 정렬 후의 행 순서를 모사하고 표 전체 재생성을 즉시 실패 처리한다.
body.rows = [4, 2, 3].map(number => ({ number, cells: Array.from({ length: 6 }, () => ({ innerHTML: '' })) }));
Object.defineProperty(body, 'innerHTML', { set() { throw Error('도서 선택 시 표 전체를 재생성하면 안 됩니다.'); } });
const originalRows = [...body.rows];
const selectedRow = body.rows[0];
const select = { dataset: { rowNumber: '4' }, value: '20', closest: () => selectedRow };
const change = () => body.change({ target: { closest: () => select } });
change();
assert.equal(rows[2].book_id, 20);
assert.equal(rows[0].book_id, null);
assert.equal(rows[2].ready, true);
assert.match(selectedRow.cells[5].innerHTML, /등록 가능/);
assert.match(selectedRow.cells[5].innerHTML, /&lt;안내>/);
assert.match(element('studylog-csv-summary').textContent, /등록 가능 1건 · 확인 필요 2건/);
assert.equal(element('btn-import-studylog-csv').disabled, false);
select.value = '';
change();
assert.equal(rows[2].ready, false);
assert.match(selectedRow.cells[5].innerHTML, /도서를 선택해 주세요/);
assert.equal(element('btn-import-studylog-csv').disabled, true);
rows[2].errors.push('학생을 확인해 주세요.');
select.value = '30';
change();
assert.equal(rows[2].ready, false);
assert.match(selectedRow.cells[5].innerHTML, /학생을 확인해 주세요/);
assert.deepEqual(body.rows, originalRows);
body.rows.forEach((row, index) => assert.equal(row, originalRows[index]));
select.dataset.rowNumber = '999';
assert.doesNotThrow(change);
console.log('CSV 도서 선택·해제·오류 유지·정렬 순서 보존 검증 통과');
