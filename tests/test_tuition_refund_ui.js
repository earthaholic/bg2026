// 실행: node --test tests/test_tuition_refund_ui.js
// 결제 이력의 환불 표시와 환불 관리 진입점이 앱 코드에 연결되어 있는지 검증한다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../static/js/app.js'), 'utf8');
const template = fs.readFileSync(path.join(__dirname, '../templates/index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../static/css/styles.css'), 'utf8');

test('결제 이력 표와 조회 표에 환불 버튼과 환불 표시가 있다', () => {
    assert.ok(source.includes("btn-refund-tuition"), '환불 버튼이 필요합니다.');
    assert.equal((source.match(/\$\{tuitionRefundNote\(p\)\}/g) || []).length, 2, '두 결제 표 모두에 환불 누계를 표시합니다.');
});

test('환불 관리 패널과 API 경로가 연결되어 있다', () => {
    assert.ok(source.includes('function showTuitionRefundPanel('));
    assert.ok(source.includes('function renderTuitionRefundPanel('));
    assert.ok(source.includes("apiFetch('/api/user/tuition-refunds'"));
    assert.ok(source.includes('/api/user/tuition-refunds?payment_id='));
    assert.ok(source.includes("`/api/user/tuition-refunds/${btn.dataset.id}`"));
    assert.ok(source.includes("btn-modal-refund-tuition"), '상세 모달에 환불 관리 버튼이 필요합니다.');
});

test('환불 누계는 금액과 차시를 함께 표시한다', () => {
    const start = source.indexOf('    function tuitionRefundNote(payment) {');
    const end = source.indexOf('    async function refreshTuitionViewsAfterRefund', start);
    assert.ok(start > 0 && end > start);
    const context = vm.createContext({
        formatWon: value => `${Number(value || 0).toLocaleString('ko-KR')}원`,
    });
    vm.runInContext(source.slice(start, end) + '\nglobalThis.__note = tuitionRefundNote;', context);

    assert.match(context.__note({ RefundAmount: 50000, RefundLessons: 2 }), /50,000원 · 2차시/);
    assert.match(context.__note({ RefundAmount: 30000, RefundLessons: 0 }), /30,000원/);
    assert.match(context.__note({ RefundAmount: 0, RefundLessons: 3 }), /3차시/);
    assert.equal(context.__note({ RefundAmount: 0, RefundLessons: 0 }), '');
});

test('환불 관련 스타일이 정의되어 있다', () => {
    assert.match(css, /\.tuition-refund-note\s*\{/);
    assert.match(css, /\.tuition-refund-history\s*\{/);
    assert.match(css, /\.tuition-refund-row\s*\{/);
});

test('결제 화면 표는 환불 열을 따로 만들지 않고 수업료 칸에 덧붙인다', () => {
    assert.ok(!template.includes('<th>환불</th>'), '환불 전용 열은 두지 않습니다.');
});
