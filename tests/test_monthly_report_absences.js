// 실행: node --test tests/test_monthly_report_absences.js
// 실제 app.js의 월간 보고서 함수를 VM에서 격리 실행하며 브라우저와 DB에는 접근하지 않는다.
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
    'let currentMonthlyLogs = []; let monthlyLectureRequestSeq = 0;',
    between('    function formatDateKorean', '    function generateMonthlyReportText'),
    between('    function generateMonthlyReportText', '    function formatMonthlyAbsenceReason'),
    between('    function formatMonthlyAbsenceReason', '    function isMonthlyReportBreak'),
    between('    function isMonthlyReportBreak', '    async function updateMonthlyStartLecture'),
    between('    async function updateMonthlyStartLecture', '    function setMonthlyReportSaveState'),
    `globalThis.__monthlyTest = {
        generate: generateMonthlyReportText,
        formatAbsence: formatMonthlyAbsenceReason,
        updateStartLecture: updateMonthlyStartLecture,
        setLogs: logs => { currentMonthlyLogs = logs; }
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

function fixture(logs, { startLecture = '1', apiFetch = async () => ({ has_payment: true, start_lecture_num: 1, payment_start: '2026-09-01', used_before: 0 }) } = {}) {
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
        apiFetch,
        generateMonthlyReportText() {},
    });
    vm.runInContext(code, context);
    context.__monthlyTest.setLogs(logs);
    return { nodes, testApi: context.__monthlyTest };
}

test('결석 사유는 공백을 정리하고 수업 불참 문구를 한 번만 붙인다', () => {
    const f = fixture([]);
    assert.equal(f.testApi.formatAbsence('  수업 전   사정으로  '), '수업 전 사정으로 수업 불참');
    assert.equal(f.testApi.formatAbsence('수업 전 사정으로 수업 불참'), '수업 전 사정으로 수업 불참');
    assert.equal(f.testApi.formatAbsence('   '), '수업 불참');
});

test('결석은 날짜순으로 출력되고 강의 번호와 도서 항목을 소비하지 않는다', () => {
    const logs = [
        { Id: 3, StudiedDay: '2026-09-20', BookTitle: '세 번째 도서', LessonContent: '세 번째 수업' },
        { Id: 1, StudiedDay: '2026-09-18', IsAbsence: true, AbsenceReason: '수업 전 사정으로' },
        { Id: 2, StudiedDay: '2026-09-19', BookTitle: '두 번째 도서', LessonContent: '두 번째 수업' },
    ];
    const f = fixture(logs, { startLecture: '4' });
    f.testApi.generate(true);
    const text = f.nodes['monthly-report-result-text'].value;

    assert.match(text, /9\/18\(금\) 수업 전 사정으로 수업 불참/);
    assert.ok(text.indexOf('9/18(금)') < text.indexOf('9/19(토)'));
    assert.ok(text.indexOf('9/19(토)') < text.indexOf('9/20(일)'));
    assert.match(text, /<4강>[\s\S]*도서 : 두 번째 도서[\s\S]*<5강>[\s\S]*도서 : 세 번째 도서/);
    assert.doesNotMatch(text, /<6강>/);
});

test('결석만 선택해도 도서와 강의 번호를 출력하지 않으며 빈 사유를 처리한다', () => {
    const f = fixture([{ Id: 1, StudiedDay: '2026-09-18', IsAbsence: true, AbsenceReason: '   ' }]);
    f.testApi.generate(true);
    const text = f.nodes['monthly-report-result-text'].value;

    assert.match(text, /9\/18\(금\) 수업 불참/);
    assert.doesNotMatch(text, /도서 :|<\d+강>|<특강>/);
});

test('같은 날짜의 정규 수업과 결석은 하나로 합쳐지지 않는다', () => {
    const f = fixture([
        { Id: 1, StudiedDay: '2026-09-18', BookTitle: '정규 도서', LessonContent: '같은 내용' },
        { Id: 2, StudiedDay: '2026-09-18', IsAbsence: true, AbsenceReason: '개인 사정' },
    ], { startLecture: '7' });
    f.testApi.generate(true);
    const text = f.nodes['monthly-report-result-text'].value;

    assert.match(text, /<7강>[\s\S]*도서 : 정규 도서[\s\S]*9\/18\(금\) 같은 내용/);
    assert.match(text, /9\/18\(금\) 개인 사정 수업 불참/);
    assert.equal((text.match(/9\/18\(금\)/g) || []).length, 2);
});

test('시작 강의 자동계산은 결석을 제외하고 가장 이른 일반 수업일을 사용한다', async () => {
    const requests = [];
    const f = fixture([
        { StudiedDay: '2026-09-01', IsAbsence: true, AbsenceReason: '개인 사정' },
        { StudiedDay: '2026-09-03', IsSpecial: true },
        { StudiedDay: '2026-09-05', BookTitle: '휴강', LessonContent: '휴강' },
        { StudiedDay: '2026-09-10', BookTitle: '정규 도서', LessonContent: '정규 수업' },
    ], {
        startLecture: '1',
        apiFetch: async url => {
            requests.push(url);
            return { has_payment: true, start_lecture_num: 8, payment_start: '2026-09-01', used_before: 7 };
        },
    });

    await f.testApi.updateStartLecture([
        { StudiedDay: '2026-09-01', IsAbsence: true },
        { StudiedDay: '2026-09-03', IsSpecial: true },
        { StudiedDay: '2026-09-05', BookTitle: '휴강' },
        { StudiedDay: '2026-09-10', BookTitle: '정규 도서' },
    ]);

    assert.equal(requests.length, 1);
    assert.match(requests[0], /student_id=17/);
    assert.match(requests[0], /first_studied_day=2026-09-10/);
    assert.equal(f.nodes['monthly-report-start-lecture'].value, '8');
});
