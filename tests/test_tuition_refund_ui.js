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
const collSource = fs.readFileSync(path.join(__dirname, '../static/js/tuition_collection.js'), 'utf8');

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

    assert.match(context.__note({ RefundAmount: 50000, RefundLessons: 2 }), /50,000원/);
    assert.match(context.__note({ RefundAmount: 30000, RefundLessons: 0 }), /30,000원/);
    assert.equal(context.__note({ RefundAmount: 0, RefundLessons: 3 }), '', '차시만 환불하면 수업료 칸에는 금액이 없어 표시하지 않는다');
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

test('잔여 차시 표시와 월말보고 요약에 환불이 함께 나온다', () => {
    const start = source.indexOf('    function tuitionRefundChip(payment) {');
    const end = source.indexOf('    let tuitionPaymentSearchVersion = 0;', start);
    assert.ok(start > 0 && end > start);
    const context = vm.createContext({
        formatWon: value => `${Number(value || 0).toLocaleString('ko-KR')}원`,
        tuitionCycleStatus: progress => ({ exhausted: false, overage: 0, nextCycleLesson: (progress.used_lessons || 0) + 1 }),
    });
    vm.runInContext(source.slice(start, end) + '\nglobalThis.__display = tuitionPaymentProgressDisplay;', context);

    const current = context.__display({
        ProgressState: 'current', RefundLessons: 2, RefundAmount: 100000,
        TuitionProgress: { total_lessons: 34, used_lessons: 10, remaining_lessons: 24 },
    });
    assert.match(current, /잔여 24회/);
    assert.match(current, /환불 2차시/);

    const previous = context.__display({ ProgressState: 'previous', RefundLessons: 1, RefundAmount: 0 });
    assert.match(previous, /이전 결제/);
    assert.match(previous, /환불 1차시/);

    const plain = context.__display({ ProgressState: 'current', TuitionProgress: { total_lessons: 10, used_lessons: 1, remaining_lessons: 9 } });
    assert.ok(!plain.includes('환불'));
});

test('납입 관리 목록은 환불로 줄어든 잔여 차시를 안내한다', () => {
    assert.ok(collSource.includes('refunded_lessons'), '납입 관리가 환불 차시를 읽어야 합니다.');
    assert.match(collSource, /환불 \$\{Number\(p\.refunded_lessons\)}차시 반영/);
    assert.ok(css.includes('.tuition-refund-chip'));
});
