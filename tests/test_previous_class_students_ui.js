// 실행: node --test tests/test_previous_class_students_ui.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../static/js/app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../templates/index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../static/css/styles.css'), 'utf8');

const start = source.indexOf('    function batchStudentRowsHtml(');
const end = source.indexOf('    function bindBatchStudentRowEvents(', start);
assert.ok(start > 0 && end > start, 'batchStudentRowsHtml을 찾을 수 없습니다.');

const context = vm.createContext({
    escapeHtml: value => String(value ?? '')
        .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;').replaceAll("'", '&#039;'),
    formatSex: value => value || '-',
    formatReferrer: value => value,
});
vm.runInContext(source.slice(start, end), context);
const run = code => vm.runInContext(code, context);

// 현재 소속 학생은 참석 체크를 해제해 결석으로 등록할 수 있어야 한다.
const current = run("batchStudentRowsHtml({ row_id: 7, Name: '현재 학생', Sex: '여' }, false)");
assert.match(current, /class="batch-attend" data-student-id="7" checked style=/);
assert.ok(!current.match(/<input type="checkbox" class="batch-attend"[^>]*>/)[0].includes('disabled'));
assert.ok(!current.includes('이전 반</span>'));
assert.ok(!current.includes('btn-remove-batch-previous'));

// 이전 반 학생은 참석 고정·배지·제외 버튼을 함께 표시한다.
const previous = run("batchStudentRowsHtml({ row_id: 9, Name: '옮긴 <학생>', Sex: '남', IsSpecial: true }, true)");
assert.ok(previous.includes('data-batch-row="9"'));
assert.match(previous, /class="batch-attend" data-student-id="9" data-previous-student="1" checked/);
assert.ok(previous.includes('이전 반</span>'));
assert.ok(previous.includes('btn-remove-batch-previous'));
assert.match(previous, /class="batch-special" data-student-id="9" checked/);
assert.ok(previous.includes('옮긴 &lt;학생&gt;'), '학생 이름은 이스케이프되어야 합니다.');
// 이전 반 학생의 참석 해제는 되돌리고 안내한다.
assert.ok(source.includes("checkbox.dataset.previousStudent === '1' && !checkbox.checked"));
assert.ok(source.includes('showBatchNotice('));

// 일괄 등록 화면에 이전 반 학생 검색 영역이 있어야 하고, staff 전용이어야 한다.
assert.match(html, /id="batch-previous-student-tools" class="batch-previous-tools staff-only hidden"/);
assert.match(html, /id="batch-previous-student-q"/);
assert.match(html, /id="batch-previous-student-results"/);

// 저장 요청은 이전 반 학생에만 allow_not_assigned를 실어 보낸다.
assert.ok(source.includes('previousStudentIds.has(sid)'));
assert.match(source, /allow_not_assigned: isPrevious/);
assert.ok(source.includes("/previous-students?q="));

// 스타일은 수업 일괄 등록 화면으로 제한한다.
assert.match(css, /#view-class-studylog-reg \.batch-previous-tools \{/);
assert.match(css, /#view-class-studylog-reg \.batch-previous-result-main \{/);
