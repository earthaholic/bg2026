// 실행: node --test tests/test_tuition_payment_progress_ui.js
// 실제 렌더러와 검색 함수를 실행하며 운영 데이터는 변경하지 않는다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../static/js/app.js'), 'utf8');
const start = source.indexOf('    function tuitionPaymentProgressDisplay(');
const end = source.indexOf('    function renderTuitionPaymentDetail(', start);
assert.ok(start >= 0 && end > start);
function fixture(fetcher = async () => ({ payments: [] })) {
    const body = { innerHTML: '', querySelectorAll: () => [] };
    const nodes = { 'tuition-search-body': body, 'tuition-search-q': { value: '  봄 & 결  ' }, 'tuition-search-class': { value: '독서반' } };
    const calls = [], errors = [];
    const context = vm.createContext({
        document: { getElementById: id => nodes[id] },
        apiFetch: url => { calls.push(url); return fetcher(url); },
        escapeHtml: value => String(value).replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
        formatWon: value => `${value}원`,
        createActionFeedback: () => ({ show: message => errors.push(message) })
    });
    vm.runInContext(source.slice(start, end) + '\nglobalThis.api = { render: tuitionPaymentProgressDisplay, load: loadTuitionPaymentSearch };', context);
    return { ...context.api, body, calls, errors };
}
function payment(remaining, state = 'current') {
    return { row_id: 1, StartDate: '2026-01-01', PaidDate: '2026-01-01', StudentName: '<학생>', ClassType: '독서반', PaidLessons: 10, ServiceLessons: 2, FeeAmount: 100000,
        ProgressState: state, TuitionProgress: { total_lessons: 12, used_lessons: 12 - remaining, remaining_lessons: remaining } };
}
for (const remaining of [1, 2, 3, 4]) {
    test(`잔여 ${remaining}회는 경고 색상과 명시적인 결제 확인 문구를 표시한다`, () => {
        const html = fixture().render(payment(remaining));
        assert.match(html, /is-low/);
        assert.ok(html.includes(`잔여 ${remaining}회 · 결제 확인 필요`));
        assert.match(html, /fa-triangle-exclamation/);
        assert.ok(html.includes(`현재 결제 총 12회 · ${12 - remaining}회 사용`));
    });
}
for (const remaining of [5, 6, 12]) {
    test(`잔여 ${remaining}회는 경고하지 않는다`, () => {
        const html = fixture().render(payment(remaining));
        assert.match(html, /is-normal/);
        assert.doesNotMatch(html, /is-low|is-exhausted|결제 확인 필요/);
    });
}
test('0회와 초과 사용은 소진 상태를 표시한다', () => {
    const { render } = fixture();
    assert.match(render(payment(0)), /is-exhausted/);
    assert.match(render(payment(0)), /차시 소진 · 잔여 0회/);
    assert.match(render(payment(-3)), /차시 소진 · 3회 초과/);
});
test('과거·예정·미확인 결제는 경고하지 않는다', () => {
    const { render } = fixture();
    for (const [state, label] of [['previous', '이전 결제'], ['upcoming', '시작 예정'], ['unknown', '잔여 차시 확인 불가']]) {
        const html = render(payment(0, state));
        assert.ok(html.includes(label));
        assert.doesNotMatch(html, /tuition-remaining-badge/);
    }
    assert.match(render({}), /확인 불가/);
    assert.match(render({ ProgressState: 'current', TuitionProgress: { remaining_lessons: null } }), /확인 불가/);
});
test('검색은 기존 필터와 집계를 요청하고 결제/서비스 표기에 경고를 추가한다', async () => {
    const f = fixture(async () => ({ payments: [payment(4)] }));
    await f.load();
    const params = new URL(f.calls[0], 'http://localhost').searchParams;
    assert.equal(params.get('q'), '봄 & 결');
    assert.equal(params.get('class_type'), '독서반');
    assert.equal(params.get('include_progress'), 'true');
    assert.match(f.body.innerHTML, /10회 \/ 2회/);
    assert.match(f.body.innerHTML, /잔여 4회 · 결제 확인 필요/);
    assert.match(f.body.innerHTML, /&lt;학생&gt;/);
    assert.match(f.body.innerHTML, /btn-tuition-detail/);
});
test('빈 결과 및 조회 실패를 정상 차시로 표시하지 않는다', async () => {
    const empty = fixture();
    await empty.load();
    assert.match(empty.body.innerHTML, /검색 결과가 없습니다/);
    const failure = fixture(async () => { throw new Error('조회 실패'); });
    await failure.load();
    assert.match(failure.body.innerHTML, /조회 실패/);
    assert.equal(failure.errors.length, 1);
});
test('늦게 도착한 이전 결과와 오류는 최신 검색 상태를 덮어쓰지 않는다', async () => {
    for (const fail of [false, true]) {
        const waiting = [];
        const f = fixture(() => new Promise((resolve, reject) => waiting.push({ resolve, reject })));
        const first = f.load(), second = f.load();
        waiting[1].resolve({ payments: [payment(5)] });
        await second;
        if (fail) waiting[0].reject(new Error('이전 실패'));
        else waiting[0].resolve({ payments: [payment(1)] });
        await first;
        assert.match(f.body.innerHTML, /잔여 5회/);
        assert.doesNotMatch(f.body.innerHTML, /결제 확인 필요|이전 실패/);
        assert.equal(f.errors.length, 0);
    }
});
