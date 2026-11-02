// 실행: node --test tests/test_payroll_record_delete_ui.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../static/js/app.js'), 'utf8');

function createNode(id) {
    return {
        id, innerHTML: '', textContent: '', value: '', disabled: false, focused: false,
        classList: {
            values: new Set(),
            add(name) { this.values.add(name); },
            remove(name) { this.values.delete(name); },
            contains(name) { return this.values.has(name); },
            toggle(name, force) { force === undefined ? (this.values.has(name) ? this.values.delete(name) : this.values.add(name)) : (force ? this.values.add(name) : this.values.delete(name)); },
        },
        focus() { this.focused = true; },
    };
}

function buildContext() {
    const nodes = new Map();
    const requests = [];
    const feedback = [];
    const context = vm.createContext({
        document: { getElementById: id => { if (!nodes.has(id)) nodes.set(id, createNode(id)); return nodes.get(id); } },
        escapeHtml: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'),
        userName: value => `이름:${value}`,
        payrollTransferCheckbox: () => '',
        createActionFeedback: () => ({ show: message => feedback.push(message) }),
        apiFetch: async (url, options) => { requests.push({ url, options }); return { message: '학습 기록 2건을 삭제했습니다.' }; },
        loadTeacherPayroll: async () => {},
    });
    const start = source.indexOf('    function payrollRecordDeleteButton(');
    const end = source.indexOf('    function renderPayrollMaterials(', start);
    assert.ok(start > 0 && end > start);
    vm.runInContext(source.slice(start, end), context);
    return { context, nodes, requests, feedback };
}

test('기록 삭제 버튼은 CanDelete일 때만 학생 이름을 포함해 표시한다', () => {
    const { context } = buildContext();
    assert.equal(context.payrollRecordDeleteButton({ StudentName: '학생', StudiedDay: '2026-09-01', StudyLogId: 7 }), '');
    const html = context.payrollRecordDeleteButton({ StudentName: '학생', StudiedDay: '2026-09-01', StudyLogIds: [7, 8], CanDelete: true });
    assert.match(html, /class="btn btn-xs btn-outline payroll-record-delete-button"/);
    assert.match(html, /data-log-ids="7,8"/);
    assert.match(html, /aria-label="학생 2026-09-01 학습 기록 삭제"/);
    assert.match(html, />기록 삭제</);
});

test('정산 기준 미설정 목록도 서버 권한만큼 기록 삭제 버튼을 제공한다', () => {
    const { context, nodes } = buildContext();
    const line = { StudyLogId: 21, ClassName: '검증반', StudentName: '학생', StudiedDay: '2026-09-02', Reason: '단가 미설정', CanDelete: true };
    context.renderPayrollUnconfiguredLines([line]);
    const body = nodes.get('payroll-unconfigured-body');
    assert.match(body.innerHTML, /payroll-record-delete-button" data-log-ids="21"/);
    assert.doesNotMatch(body.innerHTML, /정산 제외/);
    context.renderPayrollUnconfiguredLines([{ ...line, CanDelete: false }]);
    assert.doesNotMatch(body.innerHTML, /payroll-record-delete-button/);
});

test('정산 제외 내역은 복원 버튼 옆에 기록 삭제 버튼을 함께 둔다', () => {
    const { context, nodes } = buildContext();
    const line = { StudyLogId: 31, TeacherUsername: 'teacher_a', StudentName: '학생', StudiedDay: '2026-09-03', IsSpecial: 0, CanDelete: true };
    context.renderPayrollExcludedLines([line], true);
    const body = nodes.get('payroll-excluded-body');
    assert.match(body.innerHTML, /payroll-restore-button/);
    assert.match(body.innerHTML, /payroll-record-delete-button/);
    assert.match(body.innerHTML, /payroll-excluded-actions/);
    context.renderPayrollExcludedLines([{ ...line, IsPayrollClosed: true, CanDelete: false }], true);
    assert.doesNotMatch(body.innerHTML, /payroll-record-delete-button|payroll-restore-button/);
    assert.match(body.innerHTML, /마감 완료/);
});

test('삭제 확인 창은 학생·날짜·도서·기록 번호를 보여 주고 정확한 요청을 보낸다', async () => {
    const { context, nodes, requests, feedback } = buildContext();
    context.document.getElementById('payroll-month').value = '2026-09';
    context.openPayrollRecordDeleteModal([
        { StudyLogId: 11, TeacherUsername: 'teacher_a', StudentName: '학생', StudiedDay: '2026-09-01', BookTitle: '도서 A', ClassName: '검증반' },
        { StudyLogId: 12, TeacherUsername: 'teacher_a', StudentName: '학생', StudiedDay: '2026-09-01', BookTitle: '도서 B', ClassName: '검증반' },
    ]);
    assert.equal(nodes.get('payroll-record-delete-count').textContent, '학생 · 2026-09-01 학습 기록 2건을 삭제합니다.');
    const list = nodes.get('payroll-record-delete-list').innerHTML;
    assert.match(list, /#11/);
    assert.match(list, /도서 A/);
    assert.match(list, /#12/);
    assert.match(list, /도서 B/);
    assert.equal(nodes.get('modal-payroll-record-delete').classList.contains('hidden'), false);

    await context.submitPayrollRecordDelete();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/api/user/payroll/records/delete');
    assert.deepEqual(JSON.parse(requests[0].options.body), {
        PayrollMonth: '2026-09', TeacherUsername: 'teacher_a', LogIds: [11, 12], Confirmation: '학습 기록 삭제',
    });
    assert.equal(nodes.get('modal-payroll-record-delete').classList.contains('hidden'), true);
    assert.match(feedback[0], /삭제했습니다/);
});

test('삭제 실패 시 확인 창을 닫지 않고 다시 시도할 수 있게 안내한다', async () => {
    const { context, nodes } = buildContext();
    context.apiFetch = async () => { throw new Error('이미 마감된 정산입니다.'); };
    context.openPayrollRecordDeleteModal([{ StudyLogId: 11, TeacherUsername: 'teacher_a', StudentName: '학생', StudiedDay: '2026-09-01' }]);
    await context.submitPayrollRecordDelete();
    assert.equal(nodes.get('modal-payroll-record-delete').classList.contains('hidden'), false);
    assert.match(nodes.get('payroll-record-delete-error').textContent, /이미 마감된 정산입니다\./);
    assert.equal(nodes.get('btn-submit-payroll-record-delete').disabled, false);
});
