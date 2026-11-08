const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('static/js/app.js', 'utf8');
const start = source.indexOf('    const MONTHLY_REPORT_LOCKABLE_IDS');
const end = source.indexOf('    function setMonthlyReportSaveState(', start);
const lockSource = source.slice(start, end);

const LOCKABLE_IDS = [
    'monthly-report-period-label', 'monthly-report-year-month', 'monthly-report-month-label',
    'monthly-report-start-lecture', 'monthly-report-special-teacher', 'monthly-report-log-date-from',
    'monthly-report-log-date-to', 'btn-apply-monthly-log-period', 'btn-monthly-select-all',
    'btn-monthly-deselect-all', 'btn-fetch-monthly-logs', 'btn-save-monthly-draft', 'btn-save-monthly-completed'
];

function makeElement(extra = {}) {
    return Object.assign({
        disabled: false,
        readOnly: false,
        title: '',
        dataset: {},
        hidden: true,
        classList: {
            toggle(name, value) {
                if (name === 'hidden') this.owner.hidden = !!value;
            },
            add() {},
            remove() {},
        },
        removeAttribute(name) { this[name] = ''; },
    }, extra);
}

function buildContext(role, logControls = []) {
    const elements = {};
    LOCKABLE_IDS.forEach(id => { elements[id] = makeElement(); });
    elements['monthly-report-result-text'] = makeElement({
        classList: {
            owner: null,
            toggle(name, value) { if (name === 'is-locked') this.owner.locked = !!value; },
        },
    });
    elements['monthly-report-result-text'].locked = false;
    elements['monthly-report-lock-notice'] = makeElement();
    Object.values(elements).forEach(el => { if (el.classList) el.classList.owner = el; });
    const context = vm.createContext({
        document: {
            getElementById: id => elements[id] || null,
            querySelectorAll: () => logControls,
        },
        isAdmin: () => role === 'admin' || role === 'subadmin',
        isSiteAdmin: () => role === 'admin',
        currentUser: { role },
    });
    vm.runInContext(lockSource, context);
    return { context, elements };
}

test('완료 문서는 관리자를 제외하면 잠긴다', () => {
    const { context, elements } = buildContext('teacher');
    const locked = context.applyMonthlyReportLock({ Status: 'completed' });

    assert.equal(locked, true);
    assert.equal(context.monthlyReportLocked, true);
    assert.equal(elements['monthly-report-year-month'].disabled, true);
    assert.equal(elements['monthly-report-special-teacher'].disabled, true);
    assert.equal(elements['btn-fetch-monthly-logs'].disabled, true);
    assert.equal(elements['btn-monthly-select-all'].disabled, true);
    assert.equal(elements['btn-apply-monthly-log-period'].disabled, true);
    assert.equal(elements['btn-save-monthly-completed'].disabled, true);
    assert.equal(elements['btn-save-monthly-draft'].disabled, true);
    assert.equal(elements['btn-save-monthly-completed'].title, '완료로 저장한 월말보고는 사이트 관리자만 수정할 수 있습니다.');
    assert.equal(elements['monthly-report-result-text'].readOnly, true);
    assert.equal(elements['monthly-report-result-text'].locked, true);
    assert.equal(elements['monthly-report-lock-notice'].hidden, false);
});

test('관리자와 임시 저장 문서는 잠그지 않는다', () => {
    const admin = buildContext('admin');
    assert.equal(admin.context.applyMonthlyReportLock({ Status: 'completed' }), false);
    assert.equal(admin.elements['btn-save-monthly-completed'].disabled, false);
    assert.equal(admin.elements['monthly-report-result-text'].readOnly, false);
    assert.equal(admin.elements['monthly-report-lock-notice'].hidden, true);

    const draft = buildContext('teacher');
    assert.equal(draft.context.applyMonthlyReportLock({ Status: 'draft' }), false);
    assert.equal(draft.elements['monthly-report-result-text'].readOnly, false);
    assert.equal(draft.elements['monthly-report-lock-notice'].hidden, true);
});

test('부관리자도 완료 문서는 잠긴다', () => {
    const subadmin = buildContext('subadmin');
    assert.equal(subadmin.context.applyMonthlyReportLock({ Status: 'completed' }), true);
    assert.equal(subadmin.elements['btn-save-monthly-completed'].disabled, true);
    assert.equal(subadmin.elements['monthly-report-result-text'].readOnly, true);
    assert.equal(subadmin.elements['monthly-report-lock-notice'].hidden, false);
});

test('수업 구분 잠금은 원래 권한 때문에 비활성이던 선택을 되살리지 않는다', () => {
    const editable = makeElement();
    const restricted = makeElement({ disabled: true });
    const { context } = buildContext('teacher', [editable, restricted]);

    context.applyMonthlyReportLock({ Status: 'completed' });
    assert.equal(editable.disabled, true);
    assert.equal(restricted.disabled, true);

    context.applyMonthlyReportLock(null);
    assert.equal(editable.disabled, false);
    assert.equal(restricted.disabled, true);
});

test('저장은 잠금 상태를 먼저 확인하고 저장 중 버튼도 잠금을 유지한다', () => {
    const save = source.slice(source.indexOf('    async function saveMonthlyReport(status)'),
        source.indexOf('    async function loadSavedMonthlyReports()'));
    assert.match(save, /if \(monthlyReportLocked\) return feedback\.show\(MONTHLY_REPORT_LOCK_HINT, 'warning'\);/);
    assert.match(save, /buttons\.forEach\(button => \{ if \(button\) button\.disabled = monthlyReportLocked; \}\);/);

    const render = source.slice(source.indexOf('    function renderMonthlyReportLogItems(logs, selectAll = false)'),
        source.indexOf('    async function updateMonthlyReportLogType('));
    assert.match(render, /monthlyReportLocked \? ' disabled' : ''/);
    assert.match(render, /완료로 저장한 월말보고는 수업 구분을 바꿀 수 없습니다\./);

    const saveState = source.slice(source.indexOf('    function setMonthlyReportSaveState(report)'),
        source.indexOf('    function renderMonthlyReportLogItems(logs, selectAll = false)'));
    assert.match(saveState, /applyMonthlyReportLock\(report\)/);
    assert.match(saveState, /applyMonthlyReportLock\(null\)/);
});
