// 실행: node --test tests/test_student_record_coverage_ui.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../static/js/app.js'), 'utf8');
const start = source.indexOf('    function recordCoverageLevel(');
const end = source.indexOf('    let recordCoverageTooltip', start);
assert.ok(start > 0 && end > start);
const context = vm.createContext({
    escapeHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'),
});
vm.runInContext(source.slice(start, end), context);
const student = (total, teacher, content) => ({
    row_id: 7, Name: '가람', IsSpecial: 0,
    RecordCoverage: { total, teacher_filled: teacher, content_filled: content },
});

test('기록 없음과 0%, 50%, 100% 경계를 구분한다', () => {
    for (const [filled, total, expected] of [
        [0, 0, 'empty'], [0, 10, 'none'], [1, 10, 'low'],
        [49, 100, 'low'], [50, 100, 'partial'], [99, 100, 'partial'],
        [100, 100, 'complete'], [9999, 10000, 'partial'],
    ]) assert.equal(context.recordCoverageLevel(filled, total), expected);
});

test('한 표시등을 좌우로 나누고 두 항목을 독립적으로 표시한다', () => {
    const html = context.renderClassStudentBadge(student(10, 10, 3));
    assert.equal((html.match(/class="student-record-lamp"/g) || []).length, 1);
    assert.equal((html.match(/class="record-lamp-half /g) || []).length, 2);
    assert.ok(html.indexOf('record-lamp-complete') < html.indexOf('record-lamp-low'));
    assert.match(html, /왼쪽 · 실제 진행 선생님: 10\/10건 \(100%\)/);
    assert.match(html, /오른쪽 · 수업 내용: 3\/10건 \(30%\)/);
    assert.match(html, /학생 전체 학습 기록 · 전체 기간/);
});

test('목록의 기존 학생 상세 버튼과 상세의 안내 전용 배지를 유지한다', () => {
    const data = { ...student(2, 1, 2), IsSpecial: 1 };
    const list = context.renderClassStudentBadge(data);
    const detail = context.renderClassStudentBadge(data, false);
    assert.match(list, /<button type="button" data-student-id="7"/);
    assert.match(list, /class="tag-badge warning class-student-badge"/);
    assert.match(detail, /<span tabindex="0" role="group"/);
    assert.doesNotMatch(detail, /<button|data-student-id/);
    assert.match(list, /aria-label=/);
    assert.match(detail, /data-record-tooltip=/);
});

test('기록 없음은 회색이며 미완료 비율을 100%로 반올림하지 않는다', () => {
    const empty = context.renderClassStudentBadge(student(0, 0, 0));
    assert.equal((empty.match(/record-lamp-empty/g) || []).length, 2);
    assert.match(empty, /0\/0건 \(학습 기록 없음\)/);
    const incomplete = context.renderClassStudentBadge(student(10000, 9999, 1));
    assert.match(incomplete, /9999\/10000건 \(99.9%\)/);
    assert.doesNotMatch(incomplete, /record-lamp-complete/);
    assert.match(incomplete, /1\/10000건 \(0.1% 미만\)/);
});

test('학생 이름은 속성과 표시 텍스트 모두 이스케이프한다', () => {
    const html = context.renderClassStudentBadge({ ...student(0, 0, 0), Name: '<img src=x>"' });
    assert.doesNotMatch(html, /<img/);
    assert.match(html, /&lt;img src=x&gt;&quot;/);
});

test('수업 목록과 상세에서 공통 렌더러와 도움말을 사용한다', () => {
    assert.ok(source.includes('.map(student => renderClassStudentBadge(student))'));
    assert.ok(source.includes('${renderClassStudentBadge(s, false)}'));
    assert.ok(source.includes('bindRecordCoverageTooltips(classCardsGrid)'));
    assert.ok(source.includes('bindRecordCoverageTooltips(modalClassDetailBody)'));
    assert.ok(source.includes("badge.addEventListener('focus', show)"));
    assert.ok(source.includes("badge.addEventListener('mouseenter', show)"));
});


test('학생 검색의 이름 옆에 공통 표시등을 표시하고 상세 열기 대상을 유지한다', () => {
    const html = context.renderStudentSearchName(student(10, 10, 3));
    assert.match(html, /<button type="button" class="student-search-name cell-clickable btn-open-student-detail"/);
    assert.match(html, /data-student-id="7"/);
    assert.match(html, /가람<span class="student-record-lamp"/);
    assert.equal((html.match(/class="student-record-lamp"/g) || []).length, 1);
    assert.equal((html.match(/class="record-lamp-half /g) || []).length, 2);
    assert.match(html, /record-lamp-complete/);
    assert.match(html, /record-lamp-low/);
    assert.match(html, /data-record-tooltip=/);
    assert.match(html, /aria-label=/);
    assert.match(html, /10\/10건 \(100%\)/);
    assert.ok(source.includes('<td>${renderStudentSearchName(s)}</td>'));
    assert.ok(source.includes('bindRecordCoverageTooltips(studentCardsGrid)'));
});

test('학생 검색의 빈 기록과 이름 이스케이프를 처리한다', () => {
    const html = context.renderStudentSearchName({ ...student(0, 0, 0), Name: '<img src=x>"' });
    assert.doesNotMatch(html, /<img/);
    assert.match(html, /&lt;img src=x&gt;&quot;/);
    assert.equal((html.match(/record-lamp-empty/g) || []).length, 2);
    assert.match(html, /학습 기록 없음/);
});
