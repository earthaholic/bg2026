// 실행: node --test tests/test_student_description_ui.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('static/js/app.js', 'utf8');
const code = source.slice(source.indexOf('    function bindStudentDescriptionEditor('), source.indexOf('    async function openStudentConsultationsModal('));
function setup(fail = false) {
    const elements = {};
    function element(id) {
        return elements[id] ||= { value: '', disabled: false, textContent: '', className: '',
            classList: { add() {}, toggle() {} }, focus() {},
            addEventListener(event, fn) { this[event] = fn; },
            querySelector() { return element('save'); } };
    }
    const calls = [];
    const context = { document: { getElementById: element }, apiFetch: async (url, options) => {
        calls.push({ url, payload: JSON.parse(options.body) });
        if (fail) throw new Error('동시 수정 충돌');
    }};
    vm.createContext(context);
    vm.runInContext(code, context);
    const student = { row_id: 7, Description: '기존 내용' };
    context.bindStudentDescriptionEditor(student);
    return { elements, student, calls };
}
test('상세 렌더링에서 일반 선생님에게도 편집기를 연결한다', () => {
    assert.match(source, /bindStudentDescriptionEditor\(s\);\s*if \(isStaff\(\)\) loadStudentClassAssignment/);
});
test('전용 경로로 특이사항만 저장하며 취소는 통신하지 않는다', async () => {
    const { elements: e, student, calls } = setup();
    e['btn-edit-student-description'].click();
    assert.equal(e['student-description-input'].value, '기존 내용');
    e['student-description-input'].value = '변경 내용';
    e['btn-cancel-student-description'].click();
    assert.equal(calls.length, 0);
    assert.equal(e['student-description-input'].value, '기존 내용');
    e['student-description-input'].value = '저장 내용';
    await e['student-description-form'].submit({ preventDefault() {} });
    assert.equal(calls[0].url, '/api/user/students/7/description');
    assert.deepEqual(calls[0].payload, { Description: '저장 내용', original_description: '기존 내용' });
    assert.equal(student.Description, '저장 내용');
    assert.equal(e['student-description-display'].textContent, '저장 내용');
});
test('저장 실패 시 입력을 유지하고 재편집할 수 있다', async () => {
    const { elements: e, student } = setup(true);
    e['student-description-input'].value = '작성 중';
    await e['student-description-form'].submit({ preventDefault() {} });
    assert.equal(student.Description, '기존 내용');
    assert.equal(e['student-description-input'].value, '작성 중');
    assert.equal(e['student-description-input'].disabled, false);
    assert.equal(e['student-description-message'].textContent, '동시 수정 충돌');
});
