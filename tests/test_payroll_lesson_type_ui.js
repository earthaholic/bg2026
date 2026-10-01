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

test('같은 날짜의 정산 차시만큼 학생별 체크를 표시한다', () => {
    const line = { ClassId: 1, ClassName: '검증반', StudentRowId: 1, StudentName: '두 번 학생', CurrentGrade: '초3', StudiedDay: '2026-09-01', Amount: 10000, IsSpecial: 0 };
    context.renderPayrollTeamCards([
        line, { ...line, Amount: 5000, IsSpecial: 1 },
        { ...line, StudiedDay: '2026-09-08' },
        { ...line, StudentRowId: 2, StudentName: '한 번 학생' },
    ], false, [{ ClassId: 1, StudentRowId: 3, StudentName: '결석 학생', CurrentGrade: '초3' }]);
    const rows = container.innerHTML.match(/<tbody>(.*?)<\/tbody>/s)[1].match(/<tr>.*?<\/tr>/gs);
    const twice = rows.find(row => row.includes('두 번 학생'));
    const once = rows.find(row => row.includes('한 번 학생'));
    const absent = rows.find(row => row.includes('결석 학생'));
    const cells = twice.match(/<td class="is-attended".*?<\/td>/gs);
    assert.equal((cells[0].match(/fa-check/g) || []).length, 2);
    assert.equal((cells[1].match(/fa-check/g) || []).length, 1);
    assert.match(cells[0], /aria-label="수업 2회"/);
    assert.equal((once.match(/fa-check/g) || []).length, 1);
    assert.doesNotMatch(absent, /fa-check|is-attended/);
    assert.match(twice, /<b>3회<\/b>/);
    assert.match(twice, /25,000원/);
    assert.match(container.innerHTML, /35,000원/);
});

test('제외 버튼은 학생·날짜 칸의 모든 기록을 대상으로 하고 마감 상태에서는 숨긴다', () => {
    const line = { StudyLogId: 11, ClassId: 1, ClassName: '검증반', StudentRowId: 1, StudentName: '학생', CurrentGrade: '초3', StudiedDay: '2026-09-01', Amount: 10000 };
    const lines = [line, { ...line, StudyLogId: 12 }, { ...line, StudyLogId: 13, StudiedDay: '2026-09-08' }];
    context.renderPayrollTeamCards(lines, false, [], true);
    assert.match(container.innerHTML, /data-log-ids="11,12"/);
    assert.match(container.innerHTML, /data-log-ids="13"/);
    assert.equal((container.innerHTML.match(/class="btn btn-xs btn-outline payroll-exclude-button"/g) || []).length, 2);
    context.renderPayrollTeamCards(lines, false, [], false);
    assert.doesNotMatch(container.innerHTML, /payroll-exclude-button/);
    context.renderPayrollTeamCards(lines.map(line => ({ ...line, IsPayrollClosed: true })), false, [], true);
    assert.doesNotMatch(container.innerHTML, /payroll-exclude-button/);
});

test('제외 목록은 마감 상태와 권한에 따라 복원 버튼을 숨긴다', () => {
    const nodes = new Map();
    context.document.getElementById = id => {
        if (!nodes.has(id)) nodes.set(id, { innerHTML: '', classList: { toggle() {} } });
        return nodes.get(id);
    };
    context.isStaff = () => true;
    context.userName = value => value;
    const line = { StudyLogId: 11, StudentName: '<학생>', TeacherUsername: 'teacher_a', StudiedDay: '2026-09-01', ExclusionReason: '<사유>' };
    context.renderPayrollExcludedLines([line], true);
    const body = nodes.get('payroll-excluded-body');
    assert.match(body.innerHTML, /정산에 다시 포함/);
    assert.match(body.innerHTML, /&lt;학생&gt;/);
    assert.match(body.innerHTML, /&lt;사유&gt;/);
    context.renderPayrollExcludedLines([{ ...line, IsPayrollClosed: true }], true);
    assert.doesNotMatch(body.innerHTML, /payroll-restore-button/);
    assert.match(body.innerHTML, /마감 완료/);
    context.renderPayrollExcludedLines([line], false);
    assert.doesNotMatch(body.innerHTML, /payroll-restore-button/);
});
