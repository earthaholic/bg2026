// 실행: node --test tests/test_book_request_ui.js
// 실제 요청 처리 함수를 격리 실행하며 운영 DB에는 접근하지 않는다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../static/js/app.js'), 'utf8');
function between(start, end) {
    const first = source.indexOf(start);
    const last = source.indexOf(end, first);
    assert.ok(first >= 0 && last > first, '검증할 함수 범위를 찾을 수 있어야 한다.');
    return source.slice(first, last);
}
const code = [
    between('    function collectBookFormData(form)', '    // 새 도서 등록 처리'),
    between('    const MATERIAL_FIELD_LABELS', '    function toggleMaterialRequestType'),
    between('    async function submitBookMaterialRequest', '    async function loadBookMaterialRequests'),
].join('\n');

function fixture(type, values = {}, materials = [], pdf = 0) {
    const messages = { classList: { add() {}, remove() {} }, className: '', textContent: '' };
    const nodes = {
        'book-material-request-msg': messages,
        'material-request-type': { value: type },
        'material-book-category': { value: 'general' },
        'material-pdf-status': { value: String(pdf) },
        'material-book-id': { value: '7' },
    };
    const calls = [];
    let resetCount = 0;
    const form = {
        values,
        querySelectorAll: () => materials.map(value => ({ value })),
        reset: () => { resetCount++; },
    };
    const context = vm.createContext({
        FormData: class { constructor(form) { this.values = form.values; } get(key) { return this.values[key] ?? null; } },
        document: { getElementById: id => nodes[id] },
        apiFetch: async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return { message: '요청 완료' }; },
        toggleMaterialRequestType() {},
        loadBookMaterialRequests: async () => {},
    });
    vm.runInContext(code, context);
    return { context, calls, messages, resetCount: () => resetCount, submit: () => context.submitBookMaterialRequest({ preventDefault() {}, target: form }), form };
}

const basics = { Title: '  검증 도서  ', Author: '  저자  ', Publisher: '  출판사  ', Subject: '과학', Target: '중등부', BookLength: '3', Voca: '4', Metaphor: '5', Desc: '메모' };

test('새 도서 요청은 공통 입력값과 PDF 저작권 상태 2를 보존한다', async () => {
    const f = fixture('new_book', { ...basics, HasQuiz: '1', HasDebateMaterial: '1', IsPdfExist: '2', IsPaperbookExist: '1', IsYes24Exist: '1', IsMillieExist: '1' });
    await f.submit();
    const payload = f.calls[0].body;
    assert.equal(payload.BookData.Title, '검증 도서');
    assert.equal(payload.BookData.Author, '저자');
    assert.equal(payload.BookData.Publisher, '출판사');
    for (const [key, value] of Object.entries({ Subject: '과학', Target: '중등부', BookLength: 3, Voca: 4, Metaphor: 5, Desc: '메모', IsPdfExist: 2, IsPaperbookExist: 1, IsYes24Exist: 1, IsMillieExist: 1 })) {
        assert.equal(payload.BookData[key], value);
    }
    assert.deepEqual(payload.MaterialFields, ['HasQuiz', 'HasDebateMaterial', 'IsPdfExist']);
    assert.equal(payload.PdfStatus, 2);
    assert.equal(payload.BookId, undefined);
    assert.equal(f.resetCount(), 1);
});

test('자료 없는 새 도서 요청에는 이전 자료 추가 선택값이 섞이지 않는다', async () => {
    const f = fixture('new_book', basics, ['HasReadingAnswer'], 2);
    await f.submit();
    assert.deepEqual(f.calls[0].body.MaterialFields, []);
    assert.equal(f.calls[0].body.PdfStatus, undefined);
    assert.equal(f.calls[0].body.BookData.IsPdfExist, 0);
});

test('기존 도서 자료 추가에는 새 도서 입력값이 섞이지 않는다', async () => {
    const f = fixture('material_add', { ...basics, HasQuiz: '1', IsPdfExist: '1' }, ['HasReadingAnswer'], 2);
    await f.submit();
    assert.deepEqual(f.calls[0].body, { RequestType: 'material_add', BookCategory: 'general', MaterialFields: ['HasReadingAnswer', 'IsPdfExist'], PdfStatus: 2, BookId: 7 });
});

test('새 도서 요청은 공백뿐인 필수 항목을 전송하지 않는다', async () => {
    for (const key of ['Title', 'Author', 'Publisher']) {
        const f = fixture('new_book', { ...basics, [key]: '   ' });
        await f.submit();
        assert.equal(f.calls.length, 0);
        assert.match(f.messages.textContent, /필수 입력/);
    }
});

test('기존 도서 자료 추가는 자료가 하나 이상 필요하다', async () => {
    const f = fixture('material_add');
    await f.submit();
    assert.equal(f.calls.length, 0);
    assert.match(f.messages.textContent, /한 개 이상/);
});
