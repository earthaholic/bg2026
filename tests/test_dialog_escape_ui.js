// 실행: node --test tests/test_dialog_escape_ui.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('static/js/dialog_escape.js', 'utf8');
const template = fs.readFileSync('templates/index.html', 'utf8');
function run(dialogs, overrides = {}) {
    const event = { key: 'Escape', preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...overrides };
    const context = vm.createContext({ Event, document: { querySelectorAll: () => dialogs, addEventListener() {} }, getComputedStyle: dialog => ({ display: 'flex', visibility: 'visible', zIndex: '1000', ...dialog.style }) });
    vm.runInContext(source, context); context.handleDialogEscape(event); return event;
}
function dialog(options = {}) {
    const button = { disabled: false, clicks: 0, getAttribute() { return null; }, click() { this.clicks++; } };
    return { tagName: 'DIV', button, getClientRects: () => [1], querySelector: () => button, ...options };
}
test('모든 사용자 정의 대화상자에 닫기 버튼이 있으며 로그인만 예외다', () => {
    const parts = template.split(/(?=<div id="modal-[^"]+" class="modal-backdrop)/).slice(1);
    assert.ok(parts.length >= 20);
    for (const part of parts) {
        if (part.startsWith('<div id="modal-login"')) continue;
        assert.match(part, /class="btn-close"/);
    }
    assert.match(template, /src="\/static\/js\/dialog_escape\.js\?v=/);
});
test('같은 높이로 겹친 창은 마지막 창 하나만 기존 버튼으로 닫는다', () => {
    const a = dialog(), b = dialog(); const event = run([a, b]);
    assert.equal(a.button.clicks, 0); assert.equal(b.button.clicks, 1); assert.equal(event.prevented, true);
});
test('높은 z-index의 창을 우선하며 가려진 창은 무시한다', () => {
    const a = dialog({ style: { zIndex: '2000' } }), b = dialog(), hidden = dialog({ style: { display: 'none' } });
    run([a, b, hidden]); assert.equal(a.button.clicks, 1); assert.equal(b.button.clicks, 0); assert.equal(hidden.button.clicks, 0);
});
test('기본 모달은 브라우저 cancel과 기존 미저장/저장 중 보호를 유지한다', () => {
    const a = dialog(), native = dialog({ tagName: 'DIALOG', matches: () => true });
    const event = run([a, native]); assert.equal(event.prevented, undefined); assert.equal(a.button.clicks, 0);
});
test('모달 아닌 기본 대화상자도 취소 거부를 존중한다', () => {
    let closed = false;
    const native = dialog({ tagName: 'DIALOG', open: true, matches: () => false, dispatchEvent(event) { assert.equal(event.type, 'cancel'); assert.equal(event.cancelable, true); return false; }, close() { closed = true; } });
    run([native]); assert.equal(closed, false);
    native.dispatchEvent = () => true; run([native]); assert.equal(closed, true);
});
test('비활성 닫기 버튼과 닫을 수 없는 로그인 창은 우회하지 않는다', () => {
    const a = dialog(); a.button.disabled = true; run([a]); assert.equal(a.button.clicks, 0);
    assert.doesNotThrow(() => run([dialog({ querySelector: () => null })]));
});
test('길게 누르기·한글 조합·이미 처리한 키 및 다른 키는 창을 닫지 않는다', () => {
    for (const event of [{ repeat: true }, { isComposing: true }, { defaultPrevented: true }, { keyCode: 229 }, { key: 'Enter' }]) {
        const a = dialog(); run([a], event); assert.equal(a.button.clicks, 0);
    }
});
