// 실행: node --test tests/test_consultation_ui.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const appSource = fs.readFileSync(path.join(__dirname, '../static/js/app.js'), 'utf8');
const templateSource = fs.readFileSync(path.join(__dirname, '../templates/index.html'), 'utf8');

function escapeHtml(value) {
    return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function makeElement() {
    return {
        innerHTML: '', textContent: '', value: '', disabled: false, className: '', open: false,
        classList: { contains() { return false; }, add() {}, remove() {}, toggle() {} },
        addEventListener(event, handler) { this[event] = handler; },
        querySelector() { return this.submitButton; },
        querySelectorAll() { return []; },
        showModal() { this.open = true; },
        close() { this.open = false; },
        reset() {}, focus() {},
    };
}

function payrollContext(staff = true) {
    const elements = new Map();
    const get = id => {
        if (!elements.has(id)) elements.set(id, makeElement());
        return elements.get(id);
    };
    const calls = [];
    const start = appSource.indexOf('    const payrollConsultationRows = new Map();');
    const end = appSource.indexOf('    document.getElementById(\'payroll-consultation-body\')?.addEventListener', start);
    assert.ok(start > 0 && end > start, '상담 정산 렌더링 코드를 찾을 수 있어야 합니다.');
    const context = vm.createContext({
        document: { getElementById: get },
        escapeHtml,
        userName: value => `선생님:${value}`,
        isStaff: () => staff,
        apiFetch: async (url, options) => {
            calls.push({ url, options, payload: JSON.parse(options.body) });
            return {};
        },
        loadTeacherPayroll: async () => {},
    });
    vm.runInContext(appSource.slice(start, end), context);
    return { context, get, calls };
}

test('상담 정산 표는 포함·제외 건수와 포함 금액만 표시하고 안전하게 이스케이프한다', () => {
    const { context, get } = payrollContext();
    const included = [
        { ConsultationId: 1, TeacherUsername: '<teacher>', ConsultationDate: '2026-10-01', StudentName: '<학생>', DurationMinutes: 30, Amount: 12000, UnitAmount: 12000, IsRateConfigured: true },
        { ConsultationId: 2, TeacherUsername: 'zero', ConsultationDate: '2026-10-02', StudentName: '0원 학생', DurationMinutes: 10, Amount: 0, UnitAmount: 0, IsRateConfigured: true, IsPayrollClosed: true },
    ];
    const excluded = [{ ConsultationId: 3, TeacherUsername: 'missing', ConsultationDate: '2026-10-03', StudentName: '미설정 학생', DurationMinutes: 20, Amount: 99999, IsRateConfigured: false, IsExcluded: true }];
    context.renderPayrollConsultations(included, excluded);

    assert.equal(get('payroll-consultation-count').textContent, '포함 2건 · 제외 1건');
    assert.equal(get('payroll-consultation-total').textContent, '12,000원');
    const html = get('payroll-consultation-body').innerHTML;
    assert.match(html, /&lt;학생&gt;/);
    assert.match(html, /선생님:&lt;teacher&gt;/);
    assert.match(html, /단가 미설정/);
    assert.match(html, />0원</);
    assert.match(html, /정산 포함 · 마감/);
    assert.match(html, /정산 제외/);
    assert.doesNotMatch(html, /<학생>|<teacher>/);
});

test('마감된 상담 상세에는 상담 내용은 보이되 정산 제외·복원 입력은 숨긴다', () => {
    const { context, get } = payrollContext(true);
    context.openPayrollConsultationDetail({
        ConsultationId: 9, StudentName: '<학생>', ConsultationDate: '2026-10-04', DurationMinutes: 40,
        TeacherUsername: '<teacher>', Content: '<상담 내용>', UnitAmount: 0, IsRateConfigured: true,
        IsPayrollClosed: true, IsExcluded: true, ExclusionReason: '<사유>',
    });
    const html = get('payroll-consultation-detail').innerHTML;
    assert.match(html, /&lt;상담 내용&gt;/);
    assert.match(html, /&lt;사유&gt;/);
    assert.match(html, /마감된 정산은 변경할 수 없습니다/);
    assert.doesNotMatch(html, /payroll-consultation-exclusion-form|정산에 다시 포함|정산에서 제외/);
    assert.equal(get('payroll-consultation-dialog').open, true);
});

test('staff는 제외된 미마감 상담을 상세에서 복원하고 정확한 정산 제외 요청을 보낸다', async () => {
    const { context, get, calls } = payrollContext(true);
    const row = {
        ConsultationId: 17, StudentName: '학생', ConsultationDate: '2026-10-15', DurationMinutes: 30,
        TeacherUsername: 'teacher_a', Content: '복원 대상', UnitAmount: 10000, IsRateConfigured: true,
        IsExcluded: true, ExclusionReason: '기존 사유',
    };
    context.renderPayrollConsultations([], [row]);
    context.openPayrollConsultationDetail(row);
    assert.match(get('payroll-consultation-detail').innerHTML, /id="consultation-exclusion-reason" type="hidden"/);
    assert.match(get('payroll-consultation-detail').innerHTML, /정산에 다시 포함/);

    get('consultation-exclusion-reason').value = '';
    get('payroll-consultation-exclusion-form').submitButton = makeElement();
    const form = get('payroll-consultation-exclusion-form');
    await form.submit({ preventDefault() {}, target: form });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/api/user/payroll/consultations/17/exclusion');
    assert.equal(calls[0].options.method, 'POST');
    assert.deepEqual(calls[0].payload, {
        Excluded: false,
        Reason: '',
        PayrollMonth: '2026-10',
        TeacherUsername: 'teacher_a',
    });
});

test('상담 입력 폼은 날짜·소요 시간·상담 선생님을 필수로 요구하고 실제 렌더러를 연결한다', () => {
    assert.match(appSource, /async function renderStudentConsultations\(studentId, studentName, consultations\)/);
    assert.match(appSource, /id="student-consultation-date" type="date"[^>]*required/);
    assert.match(appSource, /id="student-consultation-duration" type="number" min="1" max="1440"[^>]*required/);
    assert.match(appSource, /id="student-consultation-teacher" class="form-control" required/);
    assert.match(appSource, /await renderStudentConsultations\(studentId, studentName, data\.consultations \|\| \[\]\)/);
    assert.match(appSource, /getElementById\('btn-modal-student-consultations'\)\.addEventListener\('click', \(\) => \{\s*openStudentConsultationsModal\(studentId, s\.Name \|\| '학생'\)/);
});

test('상담 단가 전용 화면은 staff 전용 메뉴와 뷰 가드로 보호한다', () => {
    assert.match(templateSource, /class="menu-nav-item staff-only hidden" data-view="consultation-rate-settings"/);
    assert.match(appSource, /STAFF_ONLY_VIEWS\s*=\s*\[[^\]]*'consultation-rate-settings'/);
    assert.match(appSource, /targetView === 'consultation-rate-settings'[\s\S]*?loadConsultationRates\(\)/);
});

test('staff는 상담 내용을 확인한 뒤 사유와 함께 정산에서 제외한다', async () => {
    const { context, get, calls } = payrollContext(true);
    const row = { ConsultationId: 19, StudentName: '학생', ConsultationDate: '2026-10-15', DurationMinutes: 20,
        TeacherUsername: 'teacher_a', Content: '상담 내용', UnitAmount: 7000, IsRateConfigured: true, IsExcluded: false };
    context.renderPayrollConsultations([row], []);
    context.openPayrollConsultationDetail(row);
    assert.match(get('payroll-consultation-detail').innerHTML, /제외 사유 \(선택\)/);
    get('consultation-exclusion-reason').value = '중복 등록';
    const form = get('payroll-consultation-exclusion-form');
    form.submitButton = makeElement();
    await form.submit({ preventDefault() {}, target: form });
    assert.equal(calls[0].payload.Excluded, true);
    assert.equal(calls[0].payload.Reason, '중복 등록');
});

test('일반 선생님의 상담 정산 상세에는 제외 도구가 없다', () => {
    const { context, get } = payrollContext(false);
    context.openPayrollConsultationDetail({ ConsultationId: 20, ConsultationDate: '2026-10-15', DurationMinutes: 30,
        TeacherUsername: 'teacher_a', Content: '조회만 허용', IsRateConfigured: true, UnitAmount: 0, IsExcluded: false });
    assert.match(get('payroll-consultation-detail').innerHTML, /조회만 허용/);
    assert.doesNotMatch(get('payroll-consultation-detail').innerHTML, /payroll-consultation-exclusion-form/);
});
