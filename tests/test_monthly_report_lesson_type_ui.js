// 실행: node --test tests/test_monthly_report_lesson_type_ui.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../static/js/app.js'), 'utf8');
const start = source.indexOf('    async function updateMonthlyReportLogType');
const end = source.indexOf('    async function loadMonthlyReportLogs', start);

function fixture(apiFetch) {
    const logs = [{row_id: 7, IsSpecial: 1, is_special: true}];
    const row = {dataset: {index: '0'}};
    const select = {value: 'general', disabled: false, closest: () => row};
    const messages = [];
    let generated = 0;
    const context = vm.createContext({
        currentMonthlyLogs: logs, monthlyLogTypeSavingCount: 0,
        document: {querySelectorAll: () => [select]}, apiFetch,
        createActionFeedback: () => ({show: (...args) => messages.push(args)}),
        generateMonthlyReportText: () => generated++,
    });
    vm.runInContext(source.slice(start, end), context);
    return {logs, select, context, messages, generated: () => generated};
}

test('원본 저장 성공 후에만 특강→일반 구분과 보고서를 갱신한다', async () => {
    let finish;
    const calls = [];
    const f = fixture((url, payload) => {
        calls.push({url, body: JSON.parse(payload.body), method: payload.method});
        return new Promise(resolve => { finish = resolve; });
    });
    const pending = f.context.updateMonthlyReportLogType(f.select);
    assert.equal(f.select.disabled, true);
    assert.equal(f.context.monthlyLogTypeSavingCount, 1);
    assert.equal(f.logs[0].IsSpecial, 1);
    assert.equal(f.generated(), 0);
    assert.deepEqual(calls, [{url: '/api/user/studylogs/7', body: {data: {IsSpecial: 0}}, method: 'PUT'}]);
    finish({status: 'success'});
    await pending;
    assert.equal(f.logs[0].IsSpecial, false);
    assert.equal(f.logs[0].is_special, false);
    assert.equal(f.generated(), 1);
    assert.equal(f.select.disabled, false);
    assert.equal(f.context.monthlyLogTypeSavingCount, 0);
});

test('저장 실패는 선택을 복원하고 원본 스냅샷과 문자를 유지한다', async () => {
    const f = fixture(async () => { throw Error('정산 마감'); });
    await f.context.updateMonthlyReportLogType(f.select);
    assert.equal(f.select.value, 'special');
    assert.equal(f.logs[0].IsSpecial, 1);
    assert.equal(f.generated(), 0);
    assert.match(f.messages[0][0], /정산 마감/);
    assert.equal(f.context.monthlyLogTypeSavingCount, 0);
});

test('일반→특강 저장 중 학생을 바꾸면 이전 응답이 새 보고서를 덮어쓰지 않는다', async () => {
    let finish;
    let saved;
    const f = fixture((url, payload) => {
        saved = JSON.parse(payload.body);
        return new Promise(resolve => { finish = resolve; });
    });
    f.logs[0].IsSpecial = false;
    f.logs[0].is_special = false;
    f.select.value = 'special';
    const pending = f.context.updateMonthlyReportLogType(f.select);
    f.context.currentMonthlyLogs = [];
    finish({status: 'success'});
    await pending;
    assert.equal(saved.data.IsSpecial, 1);
    assert.equal(f.logs[0].IsSpecial, true);
    assert.equal(f.generated(), 0);
});
