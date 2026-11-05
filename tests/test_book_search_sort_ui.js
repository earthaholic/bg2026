// 실행: node --test tests/test_book_search_sort_ui.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('static/js/app.js', 'utf8');

function setup() {
    const context = vm.createContext({
        document: { addEventListener() {}, getElementById() { return null; } },
        reloads: 0,
        deaths: 0
    });
    vm.runInContext(`
        var bookSortBy = 'row_id';
        var bookSortDirection = 'desc';
        var searchPage = 3;
        var loadBookSearchResults = function () { globalThis.reloads += 1; };
    `, context);
    const start = source.indexOf('    const NON_SORTABLE_HEADER_PATTERN');
    const end = source.indexOf("    document.querySelectorAll('table.modern-table').forEach", start);
    vm.runInContext(source.slice(start, end), context);
    return context;
}

// 도서 표 헤더: 0 선택, 1 ID, 2 도서명, 3 저자, 7 수업한 학생 수
function bookTable(labels) {
    const headers = labels.map(label => {
        const header = {
            dataset: {}, colSpan: 1, textContent: label, cellIndex: 0,
            classList: { add() {}, remove() {}, toggle() {}, contains() { return true; } },
            setAttribute() {}, querySelector() { return null; }
        };
        return header;
    });
    headers.forEach((header, index) => { header.cellIndex = index; });
    const body = {
        rows: labels.map(() => ({ dataset: {}, querySelector() { return null; }, cells: labels.map(() => ({ textContent: '', dataset: {}, colSpan: 1, querySelector() { return null; } })) }))
    };
    const table = {
        dataset: {}, tBodies: [body],
        querySelector(selector) { return selector === '#book-cards-grid' ? body : null; },
        querySelectorAll() { return headers; }
    };
    headers.forEach((header, index) => {
        header.parentElement = { children: headers };
        header.closest = () => table;
        header.cellIndex = index;
    });
    return { table, headers };
}

test('도서명 헤더는 전체 검색 결과 정렬로 서버에 요청한다', () => {
    const context = setup();
    const { headers } = bookTable(['', 'ID', '도서명', '저자', '출판사', '대상/난이도', '분량 단계', '수업한 학생 수']);
    context.sortTableByHeader(headers[2]);
    assert.equal(context.bookSortBy, 'Title');
    assert.equal(context.bookSortDirection, 'asc');
    assert.equal(context.searchPage, 1);
    assert.equal(context.reloads, 1);
});

test('같은 도서명 헤더를 다시 누르면 방향만 바뀐다', () => {
    const context = setup();
    const { headers } = bookTable(['', 'ID', '도서명', '저자', '출판사', '대상/난이도', '분량 단계', '수업한 학생 수']);
    context.sortTableByHeader(headers[2]);
    context.sortTableByHeader(headers[2]);
    assert.equal(context.bookSortBy, 'Title');
    assert.equal(context.bookSortDirection, 'desc');
    assert.equal(context.reloads, 2);
});

test('ID와 수업한 학생 수 헤더의 기존 전체 정렬을 유지한다', () => {
    const context = setup();
    const { headers } = bookTable(['', 'ID', '도서명', '저자', '출판사', '대상/난이도', '분량 단계', '수업한 학생 수']);
    context.sortTableByHeader(headers[1]);
    assert.equal(context.bookSortBy, 'row_id');
    context.sortTableByHeader(headers[7]);
    assert.equal(context.bookSortBy, 'StudyStudentCount');
    assert.equal(context.reloads, 2);
});

test('저자 열은 기존처럼 현재 페이지만 정렬한다', () => {
    const context = setup();
    const { headers, table } = bookTable(['', 'ID', '도서명', '저자', '출판사', '대상/난이도', '분량 단계', '수업한 학생 수']);
    context.sortTableByHeader(headers[3]);
    assert.equal(context.bookSortBy, 'row_id');
    assert.equal(context.reloads, 0);
    assert.equal(table.dataset.sortMode, 'client');
});
