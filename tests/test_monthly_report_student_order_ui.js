const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('static/js/app.js', 'utf8');
const start = source.indexOf('    async function loadMonthlyReportStudentOptions(');
const end = source.indexOf('    async function setMonthlyReportDefaultLogPeriod', start);

test('월말보고 전용 정렬을 요청하고 서버 순서와 선택 학생을 유지한다', async () => {
    const select = { options: [], innerHTML: '', value: '' };
    const context = vm.createContext({
        document: { getElementById: () => select },
        apiFetch: async url => {
            assert.equal(url, '/api/user/students-options?monthly_report_order=true');
            return { students: [{ row_id: 2, Name: '나학생' }, { row_id: 1, Name: '가학생' }] };
        },
        escapeHtml: x => x, formatSex: () => '', formatGrade: () => '', formatReferrer: () => '',
    });
    vm.runInContext(source.slice(start, end), context);
    await context.loadMonthlyReportStudentOptions('1');
    assert.ok(select.innerHTML.indexOf('나학생') < select.innerHTML.indexOf('가학생'));
    assert.equal(select.value, '1');
});

test('저장 성공 후 선택한 학생을 유지하며 정렬을 재조회한다', () => {
    const save = source.slice(source.indexOf('    async function saveMonthlyReport(status)'), source.indexOf('    async function loadSavedMonthlyReports()'));
    assert.match(save, /await loadSavedMonthlyReports\(\);\s*await loadMonthlyReportStudentOptions\(studentId\);/);
});
