// 실행: node --test tests/test_payroll_lesson_type_ui.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../static/js/app.js'), 'utf8');
const container = { innerHTML: '' };
const context = vm.createContext({
    document: { getElementById: () => container },
    escapeHtml: value => String(value).replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
    payrollTransferCheckbox: () => '',
});
const start = source.indexOf('    function payrollLessonTypeBadge(');
const end = source.indexOf('    function renderPayrollMaterials(', start);
assert.ok(start > 0 && end > start);
vm.runInContext(source.slice(start, end), context);

test('일반·특강·혼합을 문자와 서로 다른 배지로 표시한다', () => {
    for (const [values, type, label] of [
        [[0, '0', null], 'regular', '일반'],
        [[1, '1', true], 'special', '특강'],
        [[0, 1], 'mixed', '일반·특강'],
    ]) {
        const html = context.payrollLessonTypeBadge({ lines: values.map(IsSpecial => ({ IsSpecial })) });
        assert.ok(html.includes(`is-${type}`));
        assert.ok(html.includes(`>${label}</span>`));
        assert.match(html, /해당 월 정산 기록 기준/);
        assert.match(html, /tabindex="0"/);
        assert.doesNotMatch(html, /현재 반 기준/);
    }
});

test('기록이 없을 때만 현재 반 설정을 사용하고 출처를 표시한다', () => {
    const absent = context.payrollLessonTypeBadge({ lines: [], IsSpecial: '1' });
    assert.match(absent, /is-special/);
    assert.match(absent, /현재 반 기준/);
    assert.match(context.payrollLessonTypeBadge({ lines: [], IsSpecial: 0 }), /is-regular/);
    const historical = context.payrollLessonTypeBadge({ lines: [{ IsSpecial: 0 }], IsSpecial: 1 });
    assert.match(historical, /is-regular/);
    assert.doesNotMatch(historical, /현재 반 기준/);
});

test('학생별 구분 열을 추가하되 학생 행·차시·정산 금액은 유지한다', () => {
    const line = { ClassId: 1, ClassName: '검증반', StudentRowId: 1, StudentName: '<학생>', CurrentGrade: '초등3', StudiedDay: '2026-09-01', Amount: 10000, IsSpecial: 0 };
    context.renderPayrollTeamCards([line, { ...line, StudiedDay: '2026-09-08', Amount: 5000, IsSpecial: 1 }], false, [
        { ClassId: 1, StudentRowId: 1, StudentName: '중복 학생', IsSpecial: 1 },
        { ClassId: 1, StudentRowId: 2, StudentName: '결석 학생', IsSpecial: 1 },
    ]);
    assert.match(container.innerHTML, /<th>수업 구분<\/th>/);
    assert.equal((container.innerHTML.match(/payroll-student-name/g) || []).length, 2);
    assert.match(container.innerHTML, /&lt;학생&gt;/);
    assert.match(container.innerHTML, /is-mixed/);
    assert.match(container.innerHTML, /is-special/);
    assert.match(container.innerHTML, /일반 1건 · 특강 1건/);
    assert.match(container.innerHTML, /<b>2회<\/b>/);
    assert.match(container.innerHTML, /15,000원/);
    assert.match(container.innerHTML, /<b>0회<\/b>/);
    assert.equal((container.innerHTML.match(/차시<\/span>/g) || []).length, 5);
});
