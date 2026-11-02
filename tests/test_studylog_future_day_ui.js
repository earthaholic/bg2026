// 실행: node --test tests/test_studylog_future_day_ui.js
// app.js의 미래 날짜 차단 도우미를 VM에서 실행하고, 등록·달력 경로의 사용 여부를 확인한다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../static/js/app.js'), 'utf8');
function between(start, end) {
    const first = source.indexOf(start);
    const last = source.indexOf(end, first);
    assert.ok(first >= 0 && last > first, `검증할 app.js 범위를 찾을 수 있어야 한다: ${start}`);
    return source.slice(first, last);
}

const helpers = between('    // 학습 이력은 한국 시간 기준 오늘까지만 등록할 수 있다.', '    function switchView(targetView');
const individualSubmit = between('    async function handleUserStudyLogSubmit', '    async function loadRecentStudyLogs');
const batchSubmit = between('    async function handleBatchStudyLogSubmit', '    function escapeHtml(str)');
const calendar = between('    function renderBatchStudylogCalendar', '    function selectBatchCalendarDate');

const sandbox = {
    document: { addEventListener() {}, querySelectorAll() { return []; } }
};
vm.createContext(sandbox);
vm.runInContext(
    helpers + '\nglobalThis.__studiedDay = { kstToday, studiedDayFutureWarning, applyStudiedDayLimits, STUDIED_DAY_INPUT_SELECTOR };',
    sandbox
);
const api = sandbox.__studiedDay;

function dateInput(id) {
    return {
        id,
        max: '',
        title: '',
        matches: selector => selector === api.STUDIED_DAY_INPUT_SELECTOR,
        querySelectorAll: () => []
    };
}

test('한국 시간 오늘을 기준으로 미래 날짜만 경고한다', () => {
    const today = api.kstToday();
    const expected = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
    assert.equal(today, expected);
    assert.match(today, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(api.studiedDayFutureWarning(today), '');
    assert.equal(api.studiedDayFutureWarning('2000-01-01'), '');
    assert.equal(api.studiedDayFutureWarning(''), '');
    assert.equal(api.studiedDayFutureWarning(null), '');
    const warning = api.studiedDayFutureWarning('2999-12-31');
    assert.match(warning, /2999-12-31/);
    assert.match(warning, /등록할 수 없습니다/);
    assert.match(warning, new RegExp(today));
});

test('학습 일자 입력의 최대 선택일을 오늘로 제한한다', () => {
    const input = dateInput('studylog-date');    api.applyStudiedDayLimits(input);
    assert.equal(input.max, api.kstToday());
    assert.match(input.title, /까지 선택할 수 있습니다/);
});

test('개별·일괄 등록 제출이 미래 날짜를 막는다', () => {
    assert.match(individualSubmit, /studiedDayFutureWarning\(dateVal\)/);
    assert.match(batchSubmit, /studiedDayFutureWarning\(dateVal\)/);
    // 일괄 등록은 휴강 분기 뒤에서 검사해야 미래 휴강 일정을 막지 않는다.
    assert.ok(batchSubmit.indexOf('if (isCancelled)') < batchSubmit.indexOf('studiedDayFutureWarning(dateVal)'));
    // 등록 기본 날짜도 브라우저 시간대가 아닌 한국 시간 기준 오늘을 사용한다.
    assert.doesNotMatch(source, /new Date\(\)\.toISOString\(\)\.split\('T'\)\[0\]/);
});

test('달력에서 미래 날짜는 선택할 수 없다', () => {
    assert.match(calendar, /const isFuture = date > kstToday\(\);/);
    assert.match(calendar, /isFuture \? ' disabled' : ''/);
    assert.match(source, /if \(studiedDayFutureWarning\(date\)\) return;/);
});
