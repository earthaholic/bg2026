// 실행: node tests/test_csv_class_links_ui.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../static/js/app.js'), 'utf8');
const start = source.indexOf('    let studyLogCsvClassLinksPreview = null;');
const end = source.indexOf('    async function loadStudyLogCsvRuns()', start);
assert.ok(start > 0 && end > start);
const elements = new Map();
const boxes = [];
const notices = [];
const calls = [];
function element(id) {
    if (!elements.has(id)) elements.set(id, { value: '', innerHTML: '', textContent: '', checked: false, disabled: false, indeterminate: false, dataset: {}, classList: { add() {}, remove() {} }, listeners: {}, addEventListener(event, fn) { this.listeners[event] = fn; } });
    return elements.get(id);
}
let response = {};
const context = vm.createContext({
    console, Date, clearTimeout() {}, setTimeout() { return 1; },
    document: { getElementById: element, querySelectorAll(selector) {
        if (selector === '.csv-class-link-checkbox:checked') return boxes.filter(box => box.checked);
        if (selector === '.csv-class-link-checkbox') return boxes;
        if (selector === '.csv-class-link-class') return [];
        throw Error(selector);
    } },
    userName: name => name,
    groupedClassOptions: (classes, renderOption) => classes.map(renderOption).join(''),
    escapeHtml: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    createActionFeedback: () => ({ show: (...args) => notices.push(args), confirm: async text => { notices.push(text); return true; } }),
    apiFetch: async (url, options) => { calls.push({ url, options }); return typeof response === 'function' ? response(url, options) : response; }
});
const groupStart = source.indexOf('    function groupedClassOptions(');
const groupEnd = source.indexOf('    async function loadUserDisplayNames()', groupStart);
assert.ok(groupStart > 0 && groupEnd > groupStart);
vm.runInContext(source.slice(groupStart, groupEnd), context);
vm.runInContext(source.slice(start, end), context);
const run = code => vm.runInContext(code, context);
const classes = [{ id: 1, name: '옛 수업', teacher_username: 't1', teacher_name: '김선생' }, { id: 2, name: '다른 수업', teacher_username: 't2', teacher_name: '박선생' }];
context.classes = classes;
assert.equal(run('csvClassLinkOptions({current_teacher: "t1"}, classes).length'), 1);
assert.equal(run('csvClassLinkOptions({current_teacher: ""}, classes).length'), 2);
assert.equal(run('csvClassLinkOptions({current_teacher: "unknown"}, classes).length'), 0);
const preview = { run_id: 7, source_file: '기록.csv', total_count: 3, classes, rows: [
    { studylog_id: 11, student_name: '<학생>', studied_day: '2025-01-01', book_title: '도서', token: 'ok', current_teacher: 't1', suggested_class_id: 1 },
    { studylog_id: 12, student_name: '학생2', studied_day: '2025-01-02', token: '', suggested_class_id: 2, reason: '이미 연결됨' },
    { studylog_id: 13, student_name: '학생3', studied_day: '2025-01-03', token: 'ok3' }
] };
context.preview = preview;
run('studyLogCsvClassLinksPreview = preview; renderStudyLogCsvClassLinks();');
const markup = element('studylog-csv-class-links-preview-body').innerHTML;
assert.ok(markup.includes('&lt;학생>'));
assert.ok(markup.includes('현재 소속 기준 추천'));
assert.ok(markup.includes('김선생'));
assert.ok(markup.includes('연결 불가'));
assert.ok(!markup.includes(' checked'));
assert.ok(markup.includes('수업 선택 안 함'));
for (let i = 0; i < 3; i++) {
    boxes.push({ dataset: { index: String(i) }, checked: false, disabled: true });
    element('csv-class-link-class-' + i).value = i === 0 ? '1' : i === 1 ? '2' : '';
}
run('updateStudyLogCsvClassLinksSelection();');
assert.deepEqual(boxes.map(box => box.disabled), [false, true, true]);
element('studylog-csv-class-links-select-all').listeners.change({ target: { checked: true } });
assert.deepEqual(boxes.map(box => box.checked), [true, false, false]);
element('csv-class-link-class-0').value = '';
run('updateStudyLogCsvClassLinksSelection();');
assert.equal(boxes[0].checked, false);
assert.equal(element('btn-apply-studylog-csv-class-links').disabled, true);
(async () => {
    boxes.length = 0;
    element('studylog-csv-class-links-run').value = '7';
    response = preview;
    await run('loadStudyLogCsvClassLinks()');
    assert.ok(calls.at(-1).url.endsWith('/runs/7/class-links'));
    assert.equal(run('studyLogCsvClassLinksPreview.run_id'), 7);
    assert.ok(run('studyLogCsvClassLinksExpiresAt > Date.now()'));
    // 갱신 중 파일·실행 이력이 바뀌면 이전 응답을 버린다.
    let resolve;
    response = () => new Promise(done => { resolve = done; });
    const loading = run('loadStudyLogCsvClassLinks()');
    run('resetStudyLogCsvClassLinks();');
    resolve(preview);
    await loading;
    assert.equal(run('studyLogCsvClassLinksPreview'), null);
    assert.equal(element('studylog-csv-class-links-preview-body').innerHTML, '');
    // 저장 후 같은 실행 이력을 다시 불러온다.
    response = preview;
    await run('loadStudyLogCsvClassLinks()');
    boxes.push({ dataset: { index: '0' }, checked: true, disabled: false });
    element('csv-class-link-class-0').value = '1';
    response = (url, options) => options ? { linked_count: 1, message: '연결 완료' } : preview;
    await element('btn-apply-studylog-csv-class-links').listeners.click();
    const posted = calls.find(call => call.options?.method === 'POST');
    assert.deepEqual(JSON.parse(posted.options.body), { links: [{ token: 'ok', class_id: 1 }] });
    assert.ok(calls.at(-1).url.endsWith('/runs/7/class-links'));
    assert.ok(notices.some(item => typeof item === 'string' && item.includes('정산에 반영')));
    // 만료된 미리보기는 서버에 보내지 않는다.
    run('studyLogCsvClassLinksExpiresAt = 1;');
    boxes[0].checked = true;
    boxes[0].disabled = false;
    const before = calls.length;
    await element('btn-apply-studylog-csv-class-links').listeners.click();
    assert.equal(calls.length, before);
    assert.equal(run('studyLogCsvClassLinksPreview'), null);
    console.log('CSV 수업 연결 UI 독립 테스트 통과');
})().catch(error => { console.error(error); process.exitCode = 1; });
