// 실행: node --test tests/test_monthly_report_lecture_cycle_ui.js
// 결제 차시를 넘긴 수업의 강의 번호가 새 주기 1강부터 다시 시작하는지 앱 코드 그대로 검증한다.
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

const code = [
    'let currentMonthlyLogs = []; let monthlyLectureRequestSeq = 0; let monthlyReportLocked = false; let monthlyReportManualEdit = false;',
    'let monthlyLectureCycleLength = 0; let monthlyLectureStartIsAuto = false;',
    between('    function formatDateKorean', '    function generateMonthlyReportText'),
    between('    function generateMonthlyReportText', '    function formatMonthlyAbsenceReason'),
    between('    function formatMonthlyAbsenceReason', '    function isMonthlyReportBreak'),
    between('    function isMonthlyReportBreak', '    async function updateMonthlyStartLecture'),
    between('    async function updateMonthlyStartLecture', '    function setMonthlyReportSaveState'),
    `globalThis.__monthlyTest = {
        generate: () => generateMonthlyReportText(true),
        updateStartLecture: logs => updateMonthlyStartLecture(logs),
        setLogs: logs => { currentMonthlyLogs = logs; },
        setCycle: (length, auto) => { monthlyLectureCycleLength = length; monthlyLectureStartIsAuto = auto; },
        state: () => ({ cycle: monthlyLectureCycleLength, auto: monthlyLectureStartIsAuto })
    };`,
].join('\n');

function element(value = '') {
    return { value, textContent: '', className: '', selectedIndex: 0, options: [], classList: { add() {}, remove() {} } };
}

function reportRow(index, checked = true) {
    return {
        querySelector: selector => selector === '.chk-log-include' ? { checked } : null,
        getAttribute: name => name === 'data-index' ? String(index) : null,
    };
}

function log(day, title, content) {
    return { StudiedDay: day, BookTitle: title, LessonContent: content };
}

function fixture(logs, { startLecture = '1', apiFetch = async () => ({ has_payment: false }) } = {}) {
    const rows = logs.map((_, index) => reportRow(index));
    const nodes = {
        'monthly-report-student-select': Object.assign(element('17'), { options: [{ value: '17', dataset: { studentName: '김하나' } }] }),
        'monthly-report-period-label': element('9월'),
        'monthly-report-month-label': element('9월'),
        'monthly-report-start-lecture': element(startLecture),
        'monthly-report-special-teacher': element(''),
        'monthly-report-result-text': element(),
        'monthly-report-lecture-guide': element(),
        'monthly-report-logs-container': { querySelectorAll: selector => selector === '.report-log-item' ? rows : [] },
    };
    const context = vm.createContext({
        document: { getElementById: id => nodes[id] || null },
        URLSearchParams, Map, JSON, String, Number, Array, Date, parseInt, isNaN,
        getKoreanNameWithYi: name => name,
        setMonthlyReportSaveState() {},
        updateMonthlyReportSaveAvailability() {},
        showMonthlyReportRegenerateNotice() {},
        hideMonthlyReportRegenerateNotice() {},
        apiFetch,
        generateMonthlyReportText() {},
    });
    vm.runInContext(code, context);
    context.__monthlyTest.setLogs(logs);
    return { nodes, api: context.__monthlyTest };
}

const fourLogs = [
    log('2026-09-07', '꼴뚜기', '첫 수업'),
    log('2026-09-14', '내가 그린 히말라야시다 그림', '둘째 수업'),
    log('2026-09-21', '딥페이크 사진이 도착했습니다', '셋째 수업'),
    log('2026-09-28', '그래서 이런 나라가 생겼대요', '넷째 수업'),
];

function lectureNumbers(text) {
    return [...text.matchAll(/<(\d+)강>/g)].map(match => Number(match[1]));
}

test('결제 2회 학생이 4번 수업하면 1·2강 뒤에 1·2강으로 다시 센다', () => {
    const f = fixture(fourLogs);
    f.api.setCycle(2, true);
    f.api.generate();
    assert.deepEqual(lectureNumbers(f.nodes['monthly-report-result-text'].value), [1, 2, 1, 2]);
});

test('이미 결제 차시를 다 쓴 상태에서 시작하면 1강부터 시작한다', () => {
    const f = fixture(fourLogs.slice(0, 3), { startLecture: '3' });
    f.api.setCycle(2, true);
    f.api.generate();
    assert.deepEqual(lectureNumbers(f.nodes['monthly-report-result-text'].value), [1, 2, 1]);
});

test('강의 번호를 직접 입력하면 새 주기로 되돌리지 않는다', () => {
    const f = fixture(fourLogs);
    f.api.setCycle(2, false);
    f.api.generate();
    assert.deepEqual(lectureNumbers(f.nodes['monthly-report-result-text'].value), [1, 2, 3, 4]);
});

test('결제 차시를 모르면 기존처럼 이어서 센다', () => {
    const f = fixture(fourLogs);
    f.api.setCycle(0, true);
    f.api.generate();
    assert.deepEqual(lectureNumbers(f.nodes['monthly-report-result-text'].value), [1, 2, 3, 4]);
});

test('특강은 강의 번호를 소비하지 않고 새 주기 계산도 유지한다', () => {
    const logs = [
        log('2026-09-07', '꼴뚜기', '첫 수업'),
        { StudiedDay: '2026-09-09', BookTitle: '특강 도서', LessonContent: '특강 수업', IsSpecial: 1 },
        log('2026-09-14', '내가 그린 히말라야시다 그림', '둘째 수업'),
        log('2026-09-21', '딥페이크 사진이 도착했습니다', '셋째 수업'),
    ];
    const f = fixture(logs);
    f.api.setCycle(2, true);
    f.api.generate();
    assert.deepEqual(lectureNumbers(f.nodes['monthly-report-result-text'].value), [1, 2, 1]);
});

test('자동 계산은 결제 차시를 기준으로 새 주기 안내를 표시한다', async () => {
    const f = fixture(fourLogs, {
        apiFetch: async () => ({ has_payment: true, start_lecture_num: 1, payment_start: '2026-09-01', used_before: 0, total_lessons: 2 }),
    });
    await f.api.updateStartLecture(fourLogs);
    const state = f.api.state();
    assert.equal(state.cycle, 2);
    assert.equal(state.auto, true);
    assert.match(f.nodes['monthly-report-lecture-guide'].textContent, /결제 2회 기준이라 2강 다음은 1강으로 다시 셈/);
});
