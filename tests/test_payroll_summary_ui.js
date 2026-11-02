// 실행: node --test tests/test_payroll_summary_ui.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../static/js/app.js'), 'utf8');

function setup() {
    const elements = {};
    const document = {
        getElementById(id) {
            if (!elements[id]) elements[id] = { innerHTML: '', textContent: '', value: '', addEventListener() {} };
            return elements[id];
        },
    };
    const context = vm.createContext({
        document,
        ROLE_LABELS: { admin: '사이트 관리자', subadmin: '부관리자', manager: '관리 선생님', teacher: '선생님' },
        userName: username => ({ teacher_a: '김하나', teacher_b: '이두리' }[username] || '이름 미등록'),
        escapeHtml: value => String(value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;'),
    });
    const start = source.indexOf('    // --- 정산 종합 조회');
    const end = source.indexOf('    async function initTeacherPayrollView(', start);
    assert.ok(start > 0 && end > start);
    vm.runInContext(source.slice(start, end), context);
    vm.runInContext('globalThis.__summaryTarget = () => payrollSummaryTarget;', context);
    return { context, elements };
}

function cell(month, values = {}) {
    const base = { month, lessons: 0, lesson_sessions: 0, unconfigured: 0, consultations: 0,
        consultation_count: 0, claims: 0, claim_count: 0, materials: 0, material_count: 0,
        total: 0, closed: false, has_activity: false };
    const merged = { ...base, ...values };
    merged.total = merged.lessons + merged.consultations + merged.claims + merged.materials;
    merged.has_activity = Boolean(merged.lesson_sessions || merged.consultation_count || merged.claim_count
        || merged.material_count || merged.unconfigured);
    return merged;
}

function months(values = {}) {
    return Array.from({ length: 12 }, (_, index) => {
        const month = `2026-${String(index + 1).padStart(2, '0')}`;
        return values[month] || cell(month);
    });
}

const teachers = [
    { username: 'teacher_b', role: 'teacher', is_payroll_excluded: false,
        cells: months({ '2026-02': cell('2026-02', { lessons: 10000, lesson_sessions: 1 }) }),
        totals: { lessons: 10000, consultations: 0, claims: 0, materials: 0 },
        total: 10000, closed_count: 0, open_count: 1, unconfigured_count: 0 },
    { username: 'teacher_a', role: 'manager', is_payroll_excluded: true,
        cells: months({
            '2026-01': cell('2026-01', { lessons: 20000, lesson_sessions: 2, closed: true }),
            '2026-03': cell('2026-03', { lessons: 15000, lesson_sessions: 1, consultations: 20000,
                consultation_count: 1, claims: 5000, claim_count: 1, materials: 7000, material_count: 1,
                unconfigured: 1 }),
        }),
        totals: { lessons: 35000, consultations: 20000, claims: 5000, materials: 7000 },
        total: 67000, closed_count: 1, open_count: 1, unconfigured_count: 1 },
];

const data = {
    year: 2026, years: [2026, 2025], months: months().map(item => item.month),
    teachers,
    month_totals: months().map((item, index) => ({ month: item.month,
        total: index === 0 ? 20000 : index === 1 ? 10000 : index === 2 ? 47000 : 0 })),
    totals: { lessons: 45000, consultations: 20000, claims: 5000, materials: 7000 },
    grand_total: 77000, closed_count: 1, open_count: 2, unconfigured_count: 1,
};

test('선생님별 12개월 금액과 연간 합계를 순서대로 그린다', () => {
    const { context, elements } = setup();
    context.renderPayrollSummary(data);
    const body = elements['payroll-summary-body'].innerHTML;
    const rows = body.split('</tr>').filter(row => row.includes('payroll-summary-teacher'));
    assert.equal(rows.length, 2);
    assert.ok(rows[0].includes('김하나') && rows[1].includes('이두리'));
    assert.match(rows[0], /1월 정산 20,000원 마감 완료/);
    assert.match(rows[0], /data-teacher="teacher_a" data-month="2026-03"/);
    assert.match(rows[0], /class="fa-solid fa-lock"/);
    assert.equal((rows[0].match(/payroll-summary-empty/g) || []).length, 10);
    assert.match(rows[0], /<td class="payroll-summary-total-cell">67,000원<\/td>/);
    assert.match(rows[0], /관리 선생님 · 마감 1개월 · 미마감 1개월/);
    assert.match(rows[0], /정산 제외/);
    assert.match(elements['payroll-summary-foot'].innerHTML, /<td>월 합계<\/td>/);
    assert.match(elements['payroll-summary-foot'].innerHTML, /77,000원/);
    assert.match(elements['payroll-summary-total'].innerHTML, /2026년 정산 합계<\/span><strong>77,000원/);
    assert.match(elements['payroll-summary-total'].innerHTML, /미마감 2월/);
    assert.match(elements['payroll-summary-caption'].textContent, /수업 45,000원 · 상담 20,000원/);
    assert.match(elements['payroll-summary-count'].innerHTML, /단가 미설정 1건 합계 제외/);
});

test('칸 안내는 수업·상담·추가 청구·자료 제작비와 마감 상태를 보여 준다', () => {
    const { context } = setup();
    const title = context.payrollSummaryCellTitle(teachers[1].cells[2]);
    assert.match(title, /수업 1차시 · 15,000원/);
    assert.match(title, /상담 1건 · 20,000원/);
    assert.match(title, /추가 청구 1건 · 5,000원/);
    assert.match(title, /자료 제작비 1건 · 7,000원/);
    assert.match(title, /단가 미설정 1건 · 합계 제외/);
    assert.match(title, /정산 진행 중/);
    assert.match(context.payrollSummaryCellTitle(teachers[1].cells[0]), /정산 마감 완료/);
});

test('내역이 없는 연도는 안내 행만 남기고 합계 행을 비운다', () => {
    const { context, elements } = setup();
    context.renderPayrollSummary({ ...data, teachers: [], grand_total: 0, month_totals: [] });
    assert.match(elements['payroll-summary-body'].innerHTML, /2026년에 정산할 내역이 없습니다/);
    assert.equal(elements['payroll-summary-foot'].innerHTML, '');
    assert.match(elements['payroll-summary-total'].innerHTML, /선생님 0명/);
});

test('연도 목록은 응답의 연도를 쓰고 현재 연도를 선택한다', () => {
    const { context, elements } = setup();
    context.renderPayrollSummaryYears({ year: 2025, years: [2026, 2025] });
    const select = elements['payroll-summary-year'];
    assert.match(select.innerHTML, /<option value="2026">2026년<\/option>/);
    assert.equal(select.value, '2025');
    context.renderPayrollSummaryYears({ year: 2024, years: [] });
    assert.match(select.innerHTML, /<option value="2024">2024년<\/option>/);
    assert.equal(select.value, '2024');
});

test('칸을 선택하면 해당 선생님·월로 월급 정산 화면을 연다', async () => {
    const { context, elements } = setup();
    const handlers = {};
    elements['payroll-summary-body'] = {
        innerHTML: '', textContent: '', value: '',
        addEventListener(type, handler) { handlers[type] = handler; },
    };
    context.apiFetch = async () => data;
    context.isStaff = () => true;
    context.switchView = view => { context.__switched = view; };
    await context.initPayrollSummaryView();
    assert.equal(typeof handlers.click, 'function');
    handlers.click({ target: { closest: () => ({ dataset: { teacher: 'teacher_a', month: '2026-03' } }) } });
    assert.equal(context.__switched, 'teacher-payroll');
    assert.equal(context.__summaryTarget().teacher, 'teacher_a');
    assert.equal(context.__summaryTarget().month, '2026-03');
    context.isStaff = () => false;
    context.__switched = null;
    handlers.click({ target: { closest: () => ({ dataset: { teacher: 'teacher_a', month: '2026-03' } }) } });
    assert.equal(context.__switched, null);
});


