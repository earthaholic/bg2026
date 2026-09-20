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
    const listeners = {};
    const nodes = { 'tuition-search-body': body, 'tuition-search-q': { value: '  봄 & 결  ' }, 'tuition-search-class': { value: '독서반' },
        'tuition-search-progress': { value: '', addEventListener: (event, handler) => { listeners[event] = handler; } },
        'tuition-search-include-ended': { checked: false, addEventListener: (event, handler) => { listeners[`ended-${event}`] = handler; } } };
    const calls = [], errors = [];
    const context = vm.createContext({
        document: { getElementById: id => nodes[id] },
        apiFetch: url => { calls.push(url); return fetcher(url); },
        escapeHtml: value => String(value).replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
        formatWon: value => `${value}원`,
        createActionFeedback: () => ({ show: message => errors.push(message) })
    });
    vm.runInContext(source.slice(start, end) + '\nglobalThis.api = { render: tuitionPaymentProgressDisplay, load: loadTuitionPaymentSearch };', context);
    const binding = source.split('\n').find(line => line.includes("getElementById('tuition-search-progress')?.addEventListener"));
    assert.ok(binding, '차시 상태 변경 이벤트가 연결되어야 한다');
    vm.runInContext(binding, context);
    const endedBinding = source.split('\n').find(line => line.includes("getElementById('tuition-search-include-ended')?.addEventListener"));
    assert.ok(endedBinding, '종료 학생 포함 변경 이벤트가 연결되어야 한다');
    vm.runInContext(endedBinding, context);
    return { ...context.api, body, calls, errors, nodes, listeners };
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

for (const state of ['normal', 'low', 'exhausted', 'previous', 'upcoming', 'unknown']) {
    test(`차시 상태 ${state} 선택 시 기존 검색 조건과 함께 즉시 조회한다`, async () => {
        const f = fixture();
        f.nodes['tuition-search-progress'].value = state;
        await f.listeners.change();
        const params = new URL(f.calls[0], 'http://localhost').searchParams;
        assert.equal(params.get('progress_state'), state);
        assert.equal(params.get('q'), '봄 & 결');
        assert.equal(params.get('class_type'), '독서반');
        assert.equal(params.get('include_progress'), 'true');
    });
}
test('전체 상태로 되돌리면 차시 필터만 해제한다', async () => {
    const f = fixture();
    f.nodes['tuition-search-progress'].value = 'low';
    await f.listeners.change();
    f.nodes['tuition-search-progress'].value = '';
    await f.listeners.change();
    const params = new URL(f.calls[1], 'http://localhost').searchParams;
    assert.equal(params.has('progress_state'), false);
    assert.equal(params.get('q'), '봄 & 결');
    assert.equal(params.get('class_type'), '독서반');
});
test('차시 상태 변경 중 늦은 이전 응답은 최신 상태를 덮지 않는다', async () => {
    const waiting = [];
    const f = fixture(() => new Promise(resolve => waiting.push(resolve)));
    f.nodes['tuition-search-progress'].value = 'low';
    const first = f.listeners.change();
    f.nodes['tuition-search-progress'].value = 'exhausted';
    const second = f.listeners.change();
    waiting[1]({ payments: [payment(0)] });
    await second;
    waiting[0]({ payments: [payment(4)] });
    await first;
    assert.match(f.body.innerHTML, /차시 소진 · 잔여 0회/);
    assert.doesNotMatch(f.body.innerHTML, /결제 확인 필요/);
});
test('선택 메뉴는 단계별 경계와 이전·예정·미확인 상태를 제공한다', () => {
    const html = fs.readFileSync(require('node:path').join(__dirname, '../templates/index.html'), 'utf8');
    assert.match(html, /<label for="tuition-search-progress">차시 상태<\/label>/);
    const select = html.match(/<select id="tuition-search-progress"[^>]*>([\s\S]*?)<\/select>/)[1];
    const options = Array.from(select.matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g), m => [m[1], m[2]]);
    assert.deepEqual(options, [
        ['', '전체 상태'], ['normal', '5회 이상'], ['low', '결제 확인 필요 (1~4회)'],
        ['exhausted', '차시 소진 (0회 이하)'], ['previous', '이전 결제'],
        ['upcoming', '시작 예정'], ['unknown', '잔여 차시 확인 불가']
    ]);
});

test('기본 조회는 종료 학생을 제외하도록 명시한다', async () => {
    const f = fixture();
    await f.load();
    assert.equal(new URL(f.calls[0], 'http://localhost').searchParams.get('include_ended'), 'false');
});
test('종료 학생 포함 체크와 해제는 기존 검색 조건을 유지하며 즉시 조회한다', async () => {
    const f = fixture();
    f.nodes['tuition-search-progress'].value = 'exhausted';
    for (const checked of [true, false]) {
        f.nodes['tuition-search-include-ended'].checked = checked;
        await f.listeners['ended-change']();
        const params = new URL(f.calls.at(-1), 'http://localhost').searchParams;
        assert.equal(params.get('include_ended'), String(checked));
        assert.equal(params.get('progress_state'), 'exhausted');
        assert.equal(params.get('q'), '봄 & 결');
        assert.equal(params.get('class_type'), '독서반');
    }
});
test('종료 학생 포함 중 다른 차시 상태로 바꾸어도 체크 상태를 유지한다', async () => {
    const f = fixture();
    f.nodes['tuition-search-include-ended'].checked = true;
    for (const state of ['normal', 'low', 'exhausted', 'previous', 'upcoming', 'unknown', '']) {
        f.nodes['tuition-search-progress'].value = state;
        await f.listeners.change();
        const params = new URL(f.calls.at(-1), 'http://localhost').searchParams;
        assert.equal(params.get('include_ended'), 'true');
        assert.equal(params.get('progress_state'), state || null);
    }
});
test('체크를 해제한 뒤 늦은 포함 결과가 도착해도 종료 학생을 다시 표시하지 않는다', async () => {
    const waiting = [];
    const f = fixture(() => new Promise(resolve => waiting.push(resolve)));
    f.nodes['tuition-search-include-ended'].checked = true;
    const first = f.listeners['ended-change']();
    f.nodes['tuition-search-include-ended'].checked = false;
    const second = f.listeners['ended-change']();
    waiting[1]({ payments: [] });
    await second;
    waiting[0]({ payments: [{ ...payment(0), StudentName: '종료 학생' }] });
    await first;
    assert.match(f.body.innerHTML, /검색 결과가 없습니다/);
    assert.doesNotMatch(f.body.innerHTML, /종료 학생/);
});
test('종료 학생 포함 체크박스는 기본 해제이며 읽을 수 있는 레이블이 있다', () => {
    const html = fs.readFileSync(require('node:path').join(__dirname, '../templates/index.html'), 'utf8');
    const input = html.match(/<input[^>]*id="tuition-search-include-ended"[^>]*>/)[0];
    assert.match(input, /type="checkbox"/);
    assert.doesNotMatch(input, /\bchecked\b/);
    assert.match(html, /<label[^>]*><input[^>]*id="tuition-search-include-ended"[^>]*>[\s\S]*?수업 종료 학생 포함<\/span><\/label>/);
});
test('별도 결제 관리 화면은 종료 학생까지 포함한 기존 전체 이력을 유지한다', () => {
    const management = source.slice(source.indexOf('    async function loadTuitionPayments()'), source.indexOf('    async function editTuitionPayment('));
    assert.ok(management.includes("apiFetch('/api/user/tuition-payments?include_ended=true')"));
});

test('결제 필터는 주요 조건과 보조 옵션을 분리하고 안내는 기본 접힘 상태다', () => {
    const html = fs.readFileSync(require('node:path').join(__dirname, '../templates/index.html'), 'utf8');
    const view = html.match(/<section id="view-tuition-payment-search"[^>]*>([\s\S]*?)<\/section>/)[1];
    assert.match(view, /class="book-search-layout"/);
    assert.match(view, /class="card search-filter-card"/);
    assert.match(view, /class="card table-card"/);
    assert.match(view, /class="tuition-filter-fields"/);
    assert.match(view, /class="tuition-filter-footer"/);
    assert.doesNotMatch(view, /filter-options-grid|&nbsp;|style=/);
    const footer = view.indexOf('class="tuition-filter-footer"');
    for (const id of ['tuition-search-q', 'tuition-search-class', 'tuition-search-progress', 'btn-tuition-search']) {
        assert.ok(view.indexOf(`id="${id}"`) < footer);
    }
    assert.ok(view.indexOf('id="tuition-search-include-ended"') > footer);
    const details = view.match(/<details class="tuition-filter-help"([^>]*)>([\s\S]*?)<\/details>/);
    assert.doesNotMatch(details[1], /\bopen\b/);
    assert.match(details[2], /<summary>[\s\S]*?차시 계산 기준<\/summary>/);
    assert.match(details[2], /특강·휴강은 차감하지 않습니다/);
});
test('결제 필터의 레이아웃은 화면 범위를 한정하고 좁은 화면에서 줄바꿈한다', () => {
    const css = fs.readFileSync(require('node:path').join(__dirname, '../static/css/styles.css'), 'utf8');
    assert.match(css, /#view-tuition-payment-search \.tuition-filter-fields\s*\{[^}]*grid-template-columns:[^;]*auto;/);
    assert.match(css, /@media \(max-width: 1100px\)\s*\{\s*#view-tuition-payment-search \.tuition-filter-fields\s*\{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
    assert.match(css, /@media \(max-width: 600px\)\s*\{\s*#view-tuition-payment-search \.tuition-filter-fields\s*\{\s*grid-template-columns: minmax\(0, 1fr\);/);
    assert.match(css, /\.tuition-filter-help summary:focus-visible/);
});
