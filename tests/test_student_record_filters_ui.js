// 실행: node --test tests/test_student_record_filters_ui.js
// 실제 검색 함수와 이벤트를 추출한다. DOM과 통신을 대체하며 운영 DB에는 접근하지 않는다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../static/js/app.js'), 'utf8');
const template = fs.readFileSync(path.join(__dirname, '../templates/index.html'), 'utf8');
function between(start, end) {
    const first = source.indexOf(start);
    const last = source.indexOf(end, first);
    assert.ok(first >= 0 && last > first, `검증할 코드 범위를 찾을 수 있어야 한다: ${start}`);
    return source.slice(first, last);
}
const elementCode = between('    // Student Search & Filter Elements', '    // Book Detail Modal Elements');
const code = [
    between('    // Student Search State', '    // 도서 검색의 "미학습 학생" 필터'),
    elementCode,
    between('    function buildStudentSearchParams()', '    // Open Book Detail Modal (View Mode)'),
    between('        // Student Search & Filter Events', "        btnCloseDetailModal.addEventListener"),
    `globalThis.__studentTest = {
        params: buildStudentSearchParams, reset: resetStudentSearchFilters,
        load: loadStudentSearchResults, page: () => studentSearchPage,
        totalPages: () => studentSearchTotalPages,
        setPage: value => { studentSearchPage = value; }
    };`
].join('\n');
const states = ['empty', 'none', 'low', 'partial', 'complete'];
const fields = [
    ['student-filter-teacher-record', 'teacher_record_state', '실제 진행 선생님'],
    ['student-filter-content-record', 'content_record_state', '수업 내용']
];
const flush = () => new Promise(resolve => setImmediate(resolve));
function element() {
    const listeners = new Map();
    return {
        value: '', checked: false, disabled: false, textContent: '', innerHTML: '',
        addEventListener(type, listener) {
            if (!listeners.has(type)) listeners.set(type, []);
            listeners.get(type).push(listener);
        },
        async emit(type, event = {}) {
            assert.ok(listeners.has(type), `실제 ${type} 이벤트가 연결되어야 한다`);
            for (const listener of listeners.get(type)) await listener(event);
            // 운영 핸들러는 재조회 Promise를 반환하지 않으므로 후속 작업까지 기다린다.
            await flush();
        }
    };
}
function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
function result(name = '최신학생', total = 61, pages = 3) {
    return { total_count: total, total_pages: pages, students: [{ row_id: 7, Name: name }] };
}
function fixture(apiFetch = async () => result()) {
    const ids = Array.from(elementCode.matchAll(/getElementById\('([^']+)'\)/g), match => match[1]);
    const nodes = Object.fromEntries(ids.map(id => [id, element()]));
    const calls = [], feedback = [];
    const context = vm.createContext({
        token: '테스트', URLSearchParams,
        document: {
            getElementById: id => nodes[id] || null,
            querySelectorAll: () => []
        },
        // 표시용 보조 함수만 대체하고 검색 결과 표 렌더러는 실제 코드를 실행한다.
        escapeHtml: value => String(value), formatSex: value => value || '-',
        formatGrade: value => value || '-', formatReferrer: value => value,
        renderStudentSearchName: student => student.Name,
        hideRecordCoverageTooltip() {}, bindRecordCoverageTooltips() {},
        createActionFeedback: () => ({ show: (message, type) => feedback.push({ message, type }) }),
        apiFetch: (url, options) => {
            calls.push({ url, options });
            return apiFetch(url, options);
        }
    });
    vm.runInContext(code, context);
    return { nodes, calls, feedback, api: context.__studentTest };
}
function requestParams(call) {
    assert.match(call.url, /^\/api\/user\/students\/search\?/);
    return Object.fromEntries(new URLSearchParams(call.url.split('?')[1]));
}
function setFilters(f) {
    f.nodes['student-search-q'].value = '  가람 & 봄  ';
    f.nodes['student-filter-sex'].value = '여';
    f.nodes['student-filter-include-ended'].checked = true;
    f.nodes['student-filter-teacher-record'].value = 'low';
    f.nodes['student-filter-content-record'].value = 'complete';
}
const filtered = {
    page: '1', limit: '30', q: '가람 & 봄', sex: '여', include_ended: 'true',
    teacher_record_state: 'low', content_record_state: 'complete'
};
function screen(f) {
    return {
        html: f.nodes['student-cards-grid'].innerHTML,
        count: f.nodes['student-search-total-count'].textContent,
        pagination: f.nodes['student-search-pagination-info'].textContent,
        current: f.nodes['student-search-current-page'].textContent,
        prev: f.nodes['btn-student-search-prev'].disabled,
        next: f.nodes['btn-student-search-next'].disabled,
        totalPages: f.api.totalPages(), feedback: [...f.feedback]
    };
}

test('기본 상태는 두 입력 상태와 빈 기존 필터를 전송하지 않는다', async () => {
    const f = fixture();
    f.nodes['student-search-q'].value = '   ';
    assert.deepEqual(Object.fromEntries(f.api.params()), { page: '1', limit: '30' });
    await f.api.load();
    assert.deepEqual(requestParams(f.calls[0]), { page: '1', limit: '30' });
});

for (const [id, param, label] of fields) {
    test(`${label} 상태 다섯 가지를 다른 상태와 독립적으로 전달한다`, async () => {
        const f = fixture();
        for (const state of states) {
            f.nodes[id].value = state;
            await f.api.load();
            assert.deepEqual(requestParams(f.calls.at(-1)), { page: '1', limit: '30', [param]: state });
        }
        f.nodes[id].value = '';
        await f.api.load();
        assert.deepEqual(requestParams(f.calls.at(-1)), { page: '1', limit: '30' });
    });
}

test('두 입력 상태의 모든 조합을 동시에 전달한다', async () => {
    const f = fixture();
    for (const teacher of states) for (const content of states) {
        f.nodes[fields[0][0]].value = teacher;
        f.nodes[fields[1][0]].value = content;
        await f.api.load();
        assert.deepEqual(requestParams(f.calls.at(-1)), {
            page: '1', limit: '30', teacher_record_state: teacher, content_record_state: content
        });
    }
});

test('검색어 정리와 성별 및 수업 종료 학생 포함 조건을 함께 유지한다', async () => {
    const f = fixture();
    setFilters(f);
    await f.api.load(true);
    assert.deepEqual(requestParams(f.calls[0]), filtered);
    assert.equal(f.calls[0].options.headers['X-Activity-Intent'], 'search');
    f.nodes['student-filter-include-ended'].checked = false;
    await f.api.load();
    const { include_ended, ...withoutEnded } = filtered;
    assert.deepEqual(requestParams(f.calls[1]), withoutEnded);
});

test('실제 다음과 이전 페이지 버튼으로 이동해도 모든 검색 조건이 유지된다', async () => {
    const f = fixture();
    setFilters(f);
    await f.api.load();
    await f.nodes['btn-student-search-next'].emit('click');
    assert.equal(f.api.page(), 2);
    assert.deepEqual(requestParams(f.calls.at(-1)), { ...filtered, page: '2' });
    assert.equal(f.nodes['student-search-pagination-info'].textContent, '2 / 3 페이지 (총 61명)');
    await f.nodes['btn-student-search-prev'].emit('click');
    assert.equal(f.api.page(), 1);
    assert.deepEqual(requestParams(f.calls.at(-1)), filtered);
});

test('초기화 함수는 두 상태와 기존 검색 조건 및 페이지를 모두 초기화한다', () => {
    const f = fixture();
    setFilters(f);
    f.api.setPage(5);
    f.api.reset();
    for (const id of ['student-search-q', 'student-filter-sex', ...fields.map(field => field[0])]) {
        assert.equal(f.nodes[id].value, '');
    }
    assert.equal(f.nodes['student-filter-include-ended'].checked, false);
    assert.equal(f.api.page(), 1);
    assert.deepEqual(Object.fromEntries(f.api.params()), { page: '1', limit: '30' });
});

test('실제 초기화 버튼은 모든 조건을 지우고 첫 페이지를 재조회한다', async () => {
    const f = fixture();
    setFilters(f);
    f.api.setPage(4);
    await f.nodes['btn-reset-student-filters'].emit('click');
    assert.equal(f.calls.length, 1);
    assert.equal(f.api.page(), 1);
    assert.deepEqual(requestParams(f.calls[0]), { page: '1', limit: '30' });
    assert.match(f.nodes['student-cards-grid'].innerHTML, /최신학생/);
});

for (const [id, param, label] of fields) {
    test(`${label} 필터의 실제 변경 핸들러는 첫 페이지에서 변경한 조건으로 재조회한다`, async () => {
        const f = fixture();
        setFilters(f);
        f.api.setPage(4);
        f.nodes[id].value = 'none';
        await f.nodes[id].emit('change');
        assert.equal(f.api.page(), 1);
        assert.equal(f.calls.length, 1);
        assert.deepEqual(requestParams(f.calls[0]), { ...filtered, [param]: 'none' });
        assert.equal(f.calls[0].options.headers['X-Activity-Intent'], 'search');
        assert.match(f.nodes['student-cards-grid'].innerHTML, /최신학생/);
    });
}

for (const oldFails of [false, true]) {
    test(`늦은 이전 ${oldFails ? '실패' : '성공'} 응답은 최신 학생 검색 결과와 페이지 정보를 덮지 않는다`, async () => {
        const old = deferred(), latest = deferred();
        let count = 0;
        const f = fixture(() => ++count === 1 ? old.promise : latest.promise);
        f.nodes[fields[0][0]].value = 'none';
        const oldLoad = f.api.load(true);
        f.nodes[fields[0][0]].value = 'complete';
        f.api.setPage(2);
        const latestLoad = f.api.load(true);
        assert.equal(f.calls.length, 2);
        assert.equal(requestParams(f.calls[0]).teacher_record_state, 'none');
        assert.equal(requestParams(f.calls[1]).teacher_record_state, 'complete');
        latest.resolve(result('최신학생', 31, 2));
        await latestLoad;
        const expected = screen(f);
        assert.match(expected.html, /최신학생/);
        assert.equal(expected.count, '총 31 명의 학생');
        assert.equal(expected.pagination, '2 / 2 페이지 (총 31명)');
        assert.equal(expected.prev, false);
        assert.equal(expected.next, true);
        assert.deepEqual(expected.feedback, []);
        if (oldFails) old.reject(new Error('이전 검색 실패'));
        else old.resolve(result('이전학생', 999, 34));
        await oldLoad;
        assert.deepEqual(screen(f), expected);
        assert.doesNotMatch(f.nodes['student-cards-grid'].innerHTML, /이전학생|이전 검색 실패/);
    });
}

test('최신 검색의 실패는 오류 화면과 알림에 정상 반영한다', async () => {
    const f = fixture(async () => { throw new Error('최신 검색 실패'); });
    await f.api.load();
    assert.match(f.nodes['student-cards-grid'].innerHTML, /최신 검색 실패/);
    assert.deepEqual(f.feedback, [{ message: '최신 검색 실패', type: 'error' }]);
});

for (const [id, , label] of fields) {
    test(`${label} 필터는 전체 상태와 다섯 API 상태 옵션 및 연결된 레이블을 제공한다`, () => {
        const selects = Array.from(template.matchAll(new RegExp(`<select\\b[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)<\\/select>`, 'g')));
        assert.equal(selects.length, 1);
        const options = Array.from(selects[0][1].matchAll(/<option\b[^>]*value="([^"]*)"[^>]*>([^<]+)<\/option>/g));
        assert.deepEqual(options.map(option => option[1]), ['', ...states]);
        assert.equal(options[0][2], '전체 상태');
        for (const option of options) assert.match(option[2], /[가-힣]/);
        const labels = Array.from(template.matchAll(new RegExp(`<label\\b[^>]*\\bfor="${id}"[^>]*>([^<]+)<\\/label>`, 'g')));
        assert.equal(labels.length, 1);
        assert.ok(labels[0][1].includes(label));
    });
}
