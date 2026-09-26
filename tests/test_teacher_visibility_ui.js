// 실행: node --test tests/test_teacher_visibility_ui.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../static/js/app.js'), 'utf8');
const template = fs.readFileSync(path.join(__dirname, '../templates/index.html'), 'utf8');
const escapeHtml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
function fn(name) {
    const match = source.match(new RegExp('    (?:async )?function ' + name + '\\('));
    assert.ok(match, name);
    const end = source.indexOf('\n    }', match.index) + 6;
    return source.slice(match.index, end);
}
function context(extra = {}) {
    return vm.createContext({ escapeHtml, userName: value => value, ROLE_LABELS: { teacher: '선생님' }, ...extra });
}
test('현재값과 수업 담당만 보존하고 다른 숨김 선택은 복원하지 않는다', () => {
    const c = context();
    vm.runInContext(fn('teacherOptionsHtml'), c);
    const visible = [{ username: '표시', role: 'teacher' }];
    let html = c.teacherOptionsHtml(visible, { currentUsername: '숨김', selectedUsername: '숨김' });
    assert.match(html, /value="숨김" selected/);
    assert.match(html, /기존 값 보존/);
    html = c.teacherOptionsHtml(visible, { assignedUsername: '담당숨김', selectedUsername: '담당숨김' });
    assert.match(html, /value="담당숨김" selected/);
    assert.match(html, /수업 담당 · 선택 목록 제외/);
    html = c.teacherOptionsHtml(visible, { selectedUsername: '임의숨김' });
    assert.doesNotMatch(html, /임의숨김/);
    assert.equal(visible.length, 1);
});
test('보존 선택의 중복 제거와 HTML 이스케이프', () => {
    const c = context(); vm.runInContext(fn('teacherOptionsHtml'), c);
    const html = c.teacherOptionsHtml([], { currentUsername: '"<숨김>', assignedUsername: '"<숨김>' });
    assert.equal((html.match(/<option/g) || []).length, 1);
    assert.match(html, /&quot;&lt;숨김&gt;/);
    assert.doesNotMatch(html, /<숨김>/);
});
function visibilityHarness(api) {
    const calls = [], feedback = [], status = { textContent: '' };
    const input = { checked: true, disabled: false, closest: () => ({ querySelector: () => status }) };
    const c = context({ apiFetch: async (...args) => { calls.push(args); return api(...args); }, createActionFeedback: () => ({ show: (...args) => feedback.push(args) }) });
    vm.runInContext(fn('saveTeacherVisibility'), c);
    return { c, input, status, calls, feedback };
}
test('숨김 즉시 저장 중 잠금과 성공 상태 갱신 및 해제', async () => {
    let done; const pending = new Promise(resolve => { done = resolve; });
    const h = visibilityHarness(() => pending);
    const user = { id: 7, role: 'teacher', hidden_from_teacher_options: 0 };
    const save = h.c.saveTeacherVisibility(h.input, user);
    assert.equal(h.input.disabled, true);
    assert.equal(h.status.textContent, '저장 중…');
    await h.c.saveTeacherVisibility(h.input, user);
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0][0], '/api/admin/users/7/teacher-visibility');
    assert.deepEqual(JSON.parse(h.calls[0][1].body), { hidden_from_teacher_options: true });
    done({ message: '저장 완료' }); await save;
    assert.equal(user.hidden_from_teacher_options, 1);
    assert.equal(h.input.disabled, false);
    assert.equal(h.status.textContent, '선택 목록에서 숨김');
    h.input.checked = false; await h.c.saveTeacherVisibility(h.input, user);
    assert.deepEqual(JSON.parse(h.calls[1][1].body), { hidden_from_teacher_options: false });
    assert.equal(user.hidden_from_teacher_options, 0);
});
test('실패하면 체크와 기존 상태를 복원하고 관리자 대상 요청은 보내지 않는다', async () => {
    const h = visibilityHarness(() => { throw new Error('저장 실패'); });
    const user = { id: 7, role: 'teacher', hidden_from_teacher_options: 0 };
    await h.c.saveTeacherVisibility(h.input, user);
    assert.equal(h.input.checked, false);
    assert.equal(h.input.disabled, false);
    assert.equal(user.hidden_from_teacher_options, 0);
    assert.match(h.status.textContent, /표시 유지/);
    await h.c.saveTeacherVisibility(h.input, { id: 1, role: 'admin' });
    assert.equal(h.calls.length, 1);
});
test('계정 표는 관리자 행에 체크박스를 제공하지 않고 안내와 여섯 열을 표시한다', () => {
    const body = { innerHTML: '', querySelectorAll: () => [] }, head = { innerHTML: '' };
    const c = context({ userManageBody: body, userManageHead: head, userManageStats: {} });
    vm.runInContext(fn('renderUserAccounts'), c);
    c.renderUserAccounts([{ id: 1, username: '관리자', role: 'admin' }]);
    assert.match(head.innerHTML, /선택 목록/);
    assert.match(body.innerHTML, /선택 대상 아님/);
    assert.doesNotMatch(body.innerHTML, /input-teacher-visibility/);
    c.renderUserAccounts([{ id: 2, username: '교사', role: 'teacher', hidden_from_teacher_options: 1 }]);
    assert.match(body.innerHTML, /input-teacher-visibility[^>]*checked/);
    c.renderUserAccounts([]); assert.match(body.innerHTML, /colspan="6"/);
    assert.match(template, /로그인 권한과 기존 수업·학습 기록 연결은 유지/);
});
test('수정과 등록의 모든 담당자 보존 경로가 공통 함수를 사용한다', () => {
    assert.match(source, /teacherOptionsHtml\(teachers, \{ currentUsername: log.ActualTeacherUsername/);
    assert.match(source, /currentUsername: log.ActualTeacherUsername \|\| '', assignedUsername: assignedTeacher/);
    assert.match(source, /currentUsername: cls.TeacherUsername \|\| '', includeRoles: true/);
    assert.match(fn('updateStudyLogActualTeacherOptions'), /assignedUsername: classId \? assignedTeacher : ''/);
    assert.match(fn('updateStudyLogActualTeacherOptions'), /teacherSelect.disabled = currentUser\?\.role === 'teacher'/);
    assert.match(fn('loadActualTeacherOptions'), /teacherOptionsHtml/);
    assert.match(fn('loadPayrollTeacherOptions'), /some\(t => t.username === selectedTeacher\) \? selectedTeacher : ''/);
    assert.match(fn('initUtilitiesView'), /some\(t => t.username === previousTeacher\) \? previousTeacher : ''/);
});
test('목록에서 제외된 보완 초안은 유지하되 저장을 비활성화하고 재선택을 안내한다', () => {
    const elements = new Map();
    const el = key => { if (!elements.has(key)) elements.set(key, {}); return elements.get(key); };
    const state = { field: 'teacher', drafts: new Map([[10, '숨김']]) };
    const c = context({ completionState: state, completionEl: el, completionBulkMode: () => false, updateCompletionSelection() {} });
    vm.runInContext(fn('renderCompletionRows'), c);
    c.renderCompletionRows({ teachers: [{ username: '표시' }], total_pages: 1, student: { Name: '학생', row_id: 1 }, coverage: { total: 1, teacher_filled: 0, content_filled: 0 }, page: 1, total_count: 1, rows: [{ row_id: 10, CanEdit: true, ActualTeacherUsername: '', token: '토큰' }] });
    assert.equal(state.drafts.get(10), '숨김');
    assert.match(el('body').innerHTML, /completion-save" data-row-id="10" disabled/);
    assert.match(el('body').innerHTML, /다시 선택해 주세요/);
    assert.doesNotMatch(el('body').innerHTML, /value="숨김"/);
});
