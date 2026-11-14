// 실행: node --test tests/test_monthly_report_reference_ui.js
// 지난 보고 참고 영역과 "이번 달 보고 작성" 흐름을 앱 코드 그대로 검증한다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../static/js/app.js'), 'utf8');
const template = fs.readFileSync(path.join(__dirname, '../templates/index.html'), 'utf8');

function between(start, end) {
    const first = source.indexOf(start);
    const last = source.indexOf(end, first);
    assert.ok(first >= 0 && last > first, `검증할 app.js 범위를 찾을 수 있어야 한다: ${start}`);
    return source.slice(first, last);
}

const element = (value = '') => ({ value, disabled: false, textContent: '' });

function buildStartFixture({ reference = null, reports = [], studentId = '757', yearMonth = '2026-10', siteAdmin = false } = {}) {
    const nodes = {
        'monthly-report-student-select': element(studentId),
        'monthly-report-year-month': element(yearMonth),
        'monthly-report-period-label': element(''),
        'monthly-report-month-label': element(''),
        'monthly-report-special-teacher': element(''),
        'monthly-report-log-date-from': element(''),
        'monthly-report-log-date-to': element(''),
        'monthly-report-start-lecture': element('5'),
        'monthly-report-result-text': element('이전에 쓰던 문구'),
    };
    const calls = { logs: [], loaded: [], messages: [], saveStates: 0 };
    const code = [
        'let currentMonthlyReportId = 7;',
        'let monthlyReportManualEdit = true;',
        'let monthlyLectureStartIsAuto = true;',
        'let monthlyLectureCycleLength = 4;',
        'let monthlyReportReference = null;',
        'let monthlyReportReferenceList = [];',
        between('    function formatMonthlyReportMonth', '    // 미리보기 패널에'),
        between('    // 지난 보고를 참고한 뒤', '    function copyMonthlyReportReference'),
        `globalThis.__ref = {
            start: startNewMonthlyReport,
            setReference: (value, list) => { monthlyReportReference = value; monthlyReportReferenceList = list; },
            state: () => ({ reportId: currentMonthlyReportId, manual: monthlyReportManualEdit, auto: monthlyLectureStartIsAuto, cycle: monthlyLectureCycleLength })
        };`,
    ].join('\n');
    const context = vm.createContext({
        document: { getElementById: id => nodes[id] || null },
        Date, Number, String, JSON, Map, Array,
        createActionFeedback: () => ({ show: (...args) => calls.messages.push(args) }),
        loadMonthlyReportLogs: async options => { calls.logs.push(options); },
        loadSavedMonthlyReport: async id => { calls.loaded.push(id); },
        setMonthlyReportSaveState: () => { calls.saveStates++; },
        hideMonthlyReportRegenerateNotice() {},
        renderMonthlyReportReference() {},
        isSiteAdmin: () => siteAdmin,
    });
    vm.runInContext(code, context);
    context.__ref.setReference(reference, reports);
    return { nodes, calls, api: context.__ref };
}

test('지난 보고를 참고한 뒤 다음 달 보고서를 새로 시작한다', async () => {
    const reference = {
        Id: 3, ReportYearMonth: '2026-05', Status: 'completed',
        PeriodLabel: '1학기(3,4,5월)', SpecialTeacherName: '지윤주',
    };
    const f = buildStartFixture({ reference, reports: [reference] });

    await f.api.start();

    assert.equal(f.nodes['monthly-report-year-month'].value, '2026-06');
    assert.equal(f.nodes['monthly-report-month-label'].value, '6월');
    assert.equal(f.nodes['monthly-report-log-date-from'].value, '2026-06-01');
    assert.equal(f.nodes['monthly-report-log-date-to'].value, '2026-06-30');
    assert.equal(f.nodes['monthly-report-period-label'].value, '1학기(3,4,5월)');
    assert.equal(f.nodes['monthly-report-special-teacher'].value, '지윤주');
    assert.equal(f.nodes['monthly-report-start-lecture'].value, '1');
    assert.equal(f.nodes['monthly-report-result-text'].value, '');

    const state = f.api.state();
    assert.equal(state.reportId, null, '새 보고서는 기존 문서를 덮어쓰지 않는다');
    assert.equal(state.manual, false);
    assert.equal(state.auto, false);
    assert.equal(state.cycle, 0);
    assert.equal(f.calls.logs.length, 1);
    assert.equal(f.calls.logs[0].selectAll, true, '새 보고서는 기록을 전체 포함으로 불러온다');
    assert.deepEqual(f.calls.loaded, []);
});

test('지난 보고가 없으면 현재 보고 월 그대로 새 보고서를 시작한다', async () => {
    const f = buildStartFixture({ reference: null, reports: [] });

    await f.api.start();

    assert.equal(f.nodes['monthly-report-year-month'].value, '2026-10');
    assert.equal(f.nodes['monthly-report-log-date-from'].value, '2026-10-01');
    assert.equal(f.nodes['monthly-report-log-date-to'].value, '2026-10-31');
    assert.equal(f.calls.logs.length, 1);
    assert.equal(f.calls.logs[0].selectAll, true);
});

test('다음 달 문서가 이미 있으면 덮어쓰지 않고 그 문서를 불러온다', async () => {
    const reference = { Id: 3, ReportYearMonth: '2026-05', Status: 'draft' };
    const draft = { Id: 4, ReportYearMonth: '2026-06', Status: 'draft' };
    const f = buildStartFixture({ reference, reports: [draft, reference] });

    await f.api.start();

    assert.deepEqual(f.calls.loaded, [4]);
    assert.deepEqual(f.calls.logs, []);
    assert.equal(f.nodes['monthly-report-year-month'].value, '2026-10', '불러오기에 맡기고 새 문서 필드를 바꾸지 않는다');
});

test('학생이 없으면 새 보고서를 시작하지 않는다', async () => {
    const f = buildStartFixture({ studentId: '' });

    await f.api.start();

    assert.equal(f.calls.messages[0][0], '학생을 선택해 주세요.');
    assert.deepEqual(f.calls.logs, []);
});

test('화면에는 참고 영역과 새 보고서 시작 버튼이 있고 이전 기록 불러오기 문구는 없다', () => {
    assert.match(template, /id="monthly-report-reference"/);
    assert.match(template, /id="btn-new-monthly-report"/);
    assert.match(template, /id="btn-edit-monthly-report"/);
    assert.match(template, /id="monthly-report-document-label"/);
    assert.match(template, /id="monthly-report-regenerate-notice"/);
    assert.ok(!template.includes('이전 기록 불러오기'), '참고와 편집이 섞이던 문구는 없어야 한다');
});

test('선택한 차시가 없으면 저장하지 않고 먼저 알린다', () => {
    const save = source.slice(source.indexOf('    async function saveMonthlyReport(status)'),
        source.indexOf('    async function loadSavedMonthlyReports()'));
    assert.match(save, /if \(!getSelectedMonthlyLogs\(\)\.length && !currentMonthlyReportId\) return feedback\.show\('포함할 학습 기록이나 결석 내역을 선택해 주세요\.', 'warning'\);/);
});

// --- 문구 자동 생성 보호 ---
const generateCode = [
    'let currentMonthlyLogs = [];',
    'let monthlyLectureRequestSeq = 0;',
    'let monthlyReportLocked = false;',
    'let monthlyReportManualEdit = false;',
    'let monthlyLectureCycleLength = 0;',
    'let monthlyLectureStartIsAuto = false;',
    between('    function formatDateKorean', '    function generateMonthlyReportText'),
    between('    function generateMonthlyReportText', '    function formatMonthlyAbsenceReason'),
    between('    function formatMonthlyAbsenceReason', '    function isMonthlyReportBreak'),
    between('    function isMonthlyReportBreak', '    async function updateMonthlyStartLecture'),
    `globalThis.__gen = {
        generate: generateMonthlyReportText,
        setLogs: logs => { currentMonthlyLogs = logs; },
        setManual: value => { monthlyReportManualEdit = value; },
        manual: () => monthlyReportManualEdit
    };`,
].join('\n');

function buildGenerateFixture({ checked = true, manual = false, text = '직접 쓴 문구' } = {}) {
    const logs = [{ StudiedDay: '2026-09-07', BookTitle: '꼴뚜기', LessonContent: '첫 수업' }];
    const rows = logs.map((_, index) => ({
        querySelector: selector => selector === '.chk-log-include' ? { checked } : null,
        getAttribute: name => name === 'data-index' ? String(index) : null,
    }));
    const nodes = {
        'monthly-report-student-select': Object.assign(element('17'), { options: [{ value: '17', dataset: { studentName: '김하나' } }] }),
        'monthly-report-period-label': element('9월'),
        'monthly-report-month-label': element('9월'),
        'monthly-report-start-lecture': element('1'),
        'monthly-report-special-teacher': element(''),
        'monthly-report-result-text': element(text),
        'monthly-report-lecture-guide': element(),
        'monthly-report-regenerate-notice': { classList: { hidden: true, add() { this.hidden = true; }, remove() { this.hidden = false; } } },
        'monthly-report-logs-container': { querySelectorAll: selector => selector === '.report-log-item' ? rows : [] },
    };
    const context = vm.createContext({
        document: { getElementById: id => nodes[id] || null },
        URLSearchParams, Map, JSON, String, Number, Array, Date, parseInt, isNaN,
        getKoreanNameWithYi: name => name,
        setMonthlyReportSaveState() {},
        updateMonthlyReportSaveAvailability() {},
        showMonthlyReportRegenerateNotice() { nodes['monthly-report-regenerate-notice'].classList.remove('hidden'); },
        hideMonthlyReportRegenerateNotice() { nodes['monthly-report-regenerate-notice'].classList.add('hidden'); },
        apiFetch: async () => ({ has_payment: false }),
        updateMonthlyStartLecture() {},
        generateMonthlyReportText() {},
    });
    vm.runInContext(generateCode, context);
    context.__gen.setLogs(logs);
    context.__gen.setManual(manual);
    return { nodes, api: context.__gen };
}

test('직접 수정한 문구는 기록 선택이 바뀌어도 자동 생성이 덮어쓰지 않는다', () => {
    const f = buildGenerateFixture({ manual: true });

    f.api.generate();

    assert.equal(f.nodes['monthly-report-result-text'].value, '직접 쓴 문구');
    assert.equal(f.nodes['monthly-report-regenerate-notice'].classList.hidden, false, '다시 생성 안내를 보여 준다');
    assert.equal(f.api.manual(), true);
});

test('다시 생성을 선택하면 자동 문구로 갱신하고 수정 상태를 푼다', () => {
    const f = buildGenerateFixture({ manual: true });

    f.api.generate(false, true);

    assert.match(f.nodes['monthly-report-result-text'].value, /<1강>/);
    assert.equal(f.api.manual(), false);
    assert.equal(f.nodes['monthly-report-regenerate-notice'].classList.hidden, true);
});

test('포함할 기록이 없으면 머리말만 있는 문구를 만들지 않는다', () => {
    const f = buildGenerateFixture({ checked: false, manual: false, text: '이전 문구' });

    f.api.generate();

    assert.equal(f.nodes['monthly-report-result-text'].value, '');
});


test('완료된 문서가 있는 달은 사이트 관리자가 아니면 편집기로 열지 않는다', async () => {
    const reference = { Id: 3, ReportYearMonth: '2026-05', Status: 'draft' };
    const completed = { Id: 4, ReportYearMonth: '2026-06', Status: 'completed' };
    const f = buildStartFixture({ reference, reports: [completed, reference] });

    await f.api.start();

    assert.deepEqual(f.calls.loaded, [], '완료 문서를 편집 대상으로 열지 않는다');
    assert.equal(f.calls.logs.length, 0);
    assert.match(f.calls.messages[0][0], /사이트 관리자만 수정할 수 있습니다/);
});

test('사이트 관리자는 완료 문서도 열어 수정할 수 있다', async () => {
    const reference = { Id: 3, ReportYearMonth: '2026-05', Status: 'draft' };
    const completed = { Id: 4, ReportYearMonth: '2026-06', Status: 'completed' };
    const f = buildStartFixture({ reference, reports: [completed, reference], siteAdmin: true });

    await f.api.start();

    assert.deepEqual(f.calls.loaded, [4]);
});

// --- 참고 영역의 수정 버튼 권한 ---
const referenceCode = [
    'const MONTHLY_REPORT_LOCK_HINT = "완료로 저장한 월말보고는 사이트 관리자만 수정할 수 있습니다.";',
    between('    function formatMonthlyReportMonth', '    // 지난 보고를 참고한 뒤'),
    'globalThis.__view = { render: renderMonthlyReportReference };',
].join('\n');

function buildReferenceFixture({ siteAdmin = false } = {}) {
    const nodes = {
        'monthly-report-student-select': element('757'),
        'monthly-report-reference-body': { innerHTML: '' },
        'btn-copy-monthly-reference': element(),
        'btn-edit-monthly-report': Object.assign(element(), { title: '', removeAttribute(name) { this[name] = ''; } }),
        'btn-new-monthly-report': element(),
    };
    const context = vm.createContext({
        document: { getElementById: id => nodes[id] || null },
        Date, Number, String, JSON,
        escapeHtml: value => String(value || ''),
        userName: name => name || '',
        isSiteAdmin: () => siteAdmin,
    });
    vm.runInContext(referenceCode, context);
    return { nodes, view: context.__view };
}

test('완료 문서의 수정 버튼은 사이트 관리자에게만 열린다', () => {
    const manager = buildReferenceFixture({ siteAdmin: false });
    manager.view.render({ Id: 1, ReportYearMonth: '2026-06', Status: 'completed', Content: '문구', UpdatedBy: 'x', UpdatedAt: '2026-11-14' });
    assert.equal(manager.nodes['btn-edit-monthly-report'].disabled, true);
    assert.match(manager.nodes['btn-edit-monthly-report'].title, /사이트 관리자만 수정할 수 있습니다/);

    const admin = buildReferenceFixture({ siteAdmin: true });
    admin.view.render({ Id: 1, ReportYearMonth: '2026-06', Status: 'completed', Content: '문구', UpdatedBy: 'x', UpdatedAt: '2026-11-14' });
    assert.equal(admin.nodes['btn-edit-monthly-report'].disabled, false);
});

test('임시 저장 문서는 완료가 아니므로 수정 버튼을 막지 않는다', () => {
    const draft = buildReferenceFixture({ siteAdmin: false });
    draft.view.render({ Id: 2, ReportYearMonth: '2026-05', Status: 'draft', Content: '문구', UpdatedBy: 'x', UpdatedAt: '2026-11-14' });
    assert.equal(draft.nodes['btn-edit-monthly-report'].disabled, false);
});

// --- 임시 저장 문서 이어쓰기 ---
const draftHelperCode = between('    function pickLatestMonthlyDraft', '    function updateMonthlyReportDraftButton');
const draftContext = vm.createContext({});
vm.runInContext(draftHelperCode + '\nglobalThis.__pick = pickLatestMonthlyDraft;', draftContext);

test('가장 최근 임시 저장 문서를 이어쓸 대상으로 찾는다', () => {
    const reports = [
        { Id: 3, ReportYearMonth: '2026-07', Status: 'completed' },
        { Id: 2, ReportYearMonth: '2026-06', Status: 'draft' },
        { Id: 1, ReportYearMonth: '2026-05', Status: 'draft' },
    ];
    assert.equal(draftContext.__pick(reports).Id, 2);
    assert.equal(draftContext.__pick([{ Id: 1, Status: 'completed' }]), null);
    assert.equal(draftContext.__pick([]), null);
});

test('임시 저장 문서는 이어서 수정할 수 있다고 안내한다', () => {
    const draft = buildReferenceFixture({ siteAdmin: false });
    draft.view.render({ Id: 2, ReportYearMonth: '2026-05', Status: 'draft', Content: '문구', UpdatedBy: 'x', UpdatedAt: '2026-11-14' });
    assert.match(draft.nodes['monthly-report-reference-body'].innerHTML, /누구나 이어서 수정하고 다시 저장할 수 있습니다/);
    assert.equal(draft.nodes['btn-edit-monthly-report'].disabled, false);
});

test('화면에 임시 저장 이어쓰기 버튼이 있다', () => {
    assert.match(template, /id="btn-resume-monthly-draft"/);
});

// --- 참고 목록 새로고침이 학생·작성 내용을 지키는지 ---
const refreshCode = between('    // 지난 보고 목록만 다시 불러온다', '    function formatMonthlyReportMonth');
function buildRefreshFixture({ clearStudent = true, clearPreview = true } = {}) {
    const select = { value: '757', options: [{ value: '757' }, { value: '' }] };
    const textarea = { value: '작성 중인 문구' };
    const messages = [];
    let loads = 0;
    const context = vm.createContext({
        document: {
            getElementById: id => (id === 'monthly-report-student-select' ? select
                : id === 'monthly-report-result-text' ? textarea : null),
        },
        createActionFeedback: () => ({ show: (...args) => messages.push(args) }),
        loadSavedMonthlyReports: async () => {
            loads += 1;
            // 첫 호출에서만 선택이 풀리는 상황을 재현한다.
            if (clearStudent && loads === 1) select.value = '';
            if (clearPreview && loads === 1) textarea.value = '';
        },
    });
    vm.runInContext(refreshCode + '\nglobalThis.__refresh = refreshMonthlyReportReference;', context);
    return { select, textarea, messages, loads: () => loads, context };
}

test('참고 목록 새로고침은 선택한 학생과 작성 중인 문구를 되돌린다', async () => {
    const f = buildRefreshFixture();
    await f.context.__refresh();

    assert.equal(f.select.value, '757', '학생 선택이 비워지면 원래 학생으로 되돌린다');
    assert.equal(f.textarea.value, '작성 중인 문구', '작성 중인 문구를 되살린다');
    assert.equal(f.loads(), 2, '학생을 되돌린 뒤 목록을 다시 읽는다');
    assert.match(f.messages[0][0], /그대로 두었습니다/);
});

test('학생 선택이 그대로면 목록만 한 번 다시 읽는다', async () => {
    const f = buildRefreshFixture({ clearStudent: false, clearPreview: false });
    await f.context.__refresh();

    assert.equal(f.select.value, '757');
    assert.equal(f.textarea.value, '작성 중인 문구');
    assert.equal(f.loads(), 1);
});
