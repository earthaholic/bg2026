const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('static/js/app.js', 'utf8');
const template = fs.readFileSync('templates/index.html', 'utf8');

const start = source.indexOf('let monthlyTuitionRequestSeq = 0;');
const end = source.indexOf('    async function setMonthlyReportDefaultLogPeriod', start);
const summarySource = source.slice(start, end);

function buildContext({ studentId = '', staff = true, payments = [], onFetch } = {}) {
    const panel = { hidden: true, classList: { add() { this.owner.hidden = true; }, remove() { this.owner.hidden = false; } } };
    panel.classList.owner = panel;
    const body = { innerHTML: '' };
    const select = { value: studentId };
    const elements = {
        'monthly-report-tuition-summary': panel,
        'monthly-report-tuition-body': body,
        'monthly-report-student-select': select,
    };
    const calls = [];
    const context = vm.createContext({
        document: { getElementById: id => elements[id] || null },
        isStaff: () => staff,
        escapeHtml: value => String(value == null ? '' : value),
        formatWon: value => `${Number(value || 0).toLocaleString('ko-KR')}원`,
        tuitionPaymentProgressDisplay: payment => `[${payment.ProgressState}]`,
        apiFetch: async url => {
            calls.push(url);
            if (onFetch) return onFetch(url);
            return { payments };
        },
    });
    vm.runInContext(summarySource, context);
    return { context, panel, body, select, calls };
}

test('학생을 선택하지 않았거나 staff가 아니면 결제 이력 패널을 숨긴다', async () => {
    const empty = buildContext({ studentId: '', staff: true });
    await empty.context.loadMonthlyReportTuitionSummary();
    assert.equal(empty.panel.hidden, true);
    assert.equal(empty.calls.length, 0);

    const teacher = buildContext({ studentId: '7', staff: false });
    await teacher.context.loadMonthlyReportTuitionSummary();
    assert.equal(teacher.panel.hidden, true);
    assert.equal(teacher.calls.length, 0);
});

test('선택 학생의 결제 이력을 요약해 보여 주고 수업료 열은 싣지 않는다', async () => {
    const payments = [{
        StartDate: '2026-10-01', PaidDate: '2026-09-28', ClassType: '독서반',
        PaidLessons: 8, ServiceLessons: 0, FeeAmount: 340000,
        ProgressState: 'current', TuitionProgress: { total_lessons: 8, used_lessons: 3, remaining_lessons: 5 },
    }];
    const built = buildContext({ studentId: '7', payments });
    await built.context.loadMonthlyReportTuitionSummary();

    assert.equal(built.panel.hidden, false);
    assert.equal(built.calls[0], '/api/user/tuition-payments?student_id=7&include_progress=true&include_ended=true');
    ['차시 시작일', '결제일', '반', '결제 / 서비스'].forEach(label => {
        assert.ok(built.body.innerHTML.includes(label), `${label} 열이 있어야 한다`);
    });
    assert.ok(built.body.innerHTML.includes('2026-10-01'));
    assert.ok(built.body.innerHTML.includes('2026-09-28'));
    assert.ok(built.body.innerHTML.includes('독서반'));
    assert.ok(built.body.innerHTML.includes('8회 / 0회'));
    assert.ok(built.body.innerHTML.includes('[current]'));
    assert.ok(!built.body.innerHTML.includes('수업료'), '수업료 열은 요약에서 빼고 결제 이력 조회에서 본다');
});

test('결제 이력이 없으면 안내 문구만 보여 준다', async () => {
    const built = buildContext({ studentId: '9', payments: [] });
    await built.context.loadMonthlyReportTuitionSummary();
    assert.equal(built.panel.hidden, false);
    assert.match(built.body.innerHTML, /등록된 결제 이력이 없습니다/);
    assert.ok(!built.body.innerHTML.includes('<table'));
});

test('학생을 빠르게 바꾸면 늦게 도착한 이전 응답은 무시한다', async () => {
    const pending = [];
    const built = buildContext({
        studentId: '1',
        onFetch: url => new Promise(resolve => { pending.push({ url, resolve }); }),
    });
    const first = built.context.loadMonthlyReportTuitionSummary();
    built.select.value = '2';
    const second = built.context.loadMonthlyReportTuitionSummary();

    pending[1].resolve({ payments: [{ StartDate: '2026-10-01', PaidDate: '2026-09-30', ClassType: '논술반', PaidLessons: 4, ServiceLessons: 1, FeeAmount: 200000, ProgressState: 'current' }] });
    await second;
    pending[0].resolve({ payments: [{ StartDate: '2020-01-01', PaidDate: '2020-01-01', ClassType: '예전반', PaidLessons: 1, ServiceLessons: 0, FeeAmount: 100000 }] });
    await first;

    assert.ok(built.body.innerHTML.includes('논술반'));
    assert.ok(!built.body.innerHTML.includes('예전반'));
});

test('결제가 많으면 최근 5건까지만 표시하고 안내한다', async () => {
    const payments = Array.from({ length: 7 }, (_, index) => ({
        StartDate: `2026-0${index + 1}-01`, PaidDate: `2026-0${index + 1}-01`,
        ClassType: `반${index + 1}`, PaidLessons: 10, ServiceLessons: 0, FeeAmount: 100000,
        ProgressState: 'previous',
    }));
    const built = buildContext({ studentId: '5', payments });
    await built.context.loadMonthlyReportTuitionSummary();

    assert.ok(built.body.innerHTML.includes('반5'));
    assert.ok(!built.body.innerHTML.includes('반6'));
    assert.equal((built.body.innerHTML.match(/<tr>/g) || []).length, 6); // 헤더 1 + 본문 5
    assert.match(built.body.innerHTML, /최근 5건만/);
});

test('결제 이력 패널은 학생 선택과 2. 문구 세부 설정 사이에 있다', () => {
    const studentIndex = template.indexOf('id="monthly-report-student-select"');
    const panelIndex = template.indexOf('id="monthly-report-tuition-summary"');
    const sectionIndex = template.indexOf('2. 문구 세부 설정');
    assert.ok(studentIndex >= 0 && panelIndex >= 0 && sectionIndex >= 0);
    assert.ok(studentIndex < panelIndex, '학생 선택 다음에 있어야 한다');
    assert.ok(panelIndex < sectionIndex, '2. 문구 세부 설정보다 위에 있어야 한다');
});
