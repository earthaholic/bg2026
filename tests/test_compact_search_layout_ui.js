// 실행: node --test tests/test_compact_search_layout_ui.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const template = fs.readFileSync(path.join(__dirname, '../templates/index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../static/css/styles.css'), 'utf8');

function section(id) {
    const start = template.indexOf(`<section id="view-${id}"`);
    assert.ok(start >= 0, `${id} 화면이 있어야 합니다.`);
    const end = template.indexOf('</section>', start);
    assert.ok(end > start);
    return template.slice(start, end);
}
function rule(selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const blocks = [...css.matchAll(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]+)\\}`, 'g'))];
    assert.ok(blocks.length, `${selector} 스타일이 있어야 합니다.`);
    return blocks.map(match => match[1]).join('\n');
}

const compactViews = ['book-search', 'student-search', 'studylog-search', 'class-list',
    'activity-log', 'audit-log', 'tuition-payment-search', 'teacher-payroll'];

test('압축 스타일은 지정된 조회 화면 8곳에만 적용하고 등록·설정 폼은 제외한다', () => {
    const actual = [...template.matchAll(/<section\b[^>]*id="view-([^"]+)"[^>]*class="([^"]+)"[^>]*>/g)]
        .filter(match => match[2].split(/\s+/).includes('compact-search-view'))
        .map(match => match[1]).sort();
    assert.deepEqual(actual, [...compactViews].sort());
    for (const id of ['book-reg', 'student-reg', 'class-reg', 'studylog-reg', 'class-studylog-reg',
        'tuition-payment', 'tuition-fee-settings', 'class-rate-settings']) {
        assert.doesNotMatch(section(id).split('>')[0], /compact-search-view/);
    }
});

test('보완 화면의 검색·안내는 기본 접힘이며 기존 검색 폼과 조건은 보존한다', () => {
    const html = section('studylog-completion');
    const picker = html.match(/<details\b[^>]*id="completion-student-picker"[^>]*>([\s\S]*?)<\/details>/);
    const guide = html.match(/<details\b[^>]*class="[^"]*completion-guide[^"]*"[^>]*>([\s\S]*?)<\/details>/);
    assert.ok(picker && guide);
    assert.doesNotMatch(picker[0].split('>')[0], /\sopen(?:\s|=|$)/);
    assert.doesNotMatch(guide[0].split('>')[0], /\sopen(?:\s|=|$)/);
    assert.match(picker[1], /<summary>학생 찾기·변경<\/summary>/);
    assert.match(picker[1], /id="completion-student-form"/);
    assert.match(picker[1], /id="completion-student-q"/);
    assert.match(picker[1], /id="completion-student-results"/);
    assert.match(guide[1], /<summary>입력·일괄 지정 안내<\/summary>/);
    assert.match(guide[1], /전체 기간/);
    assert.match(guide[1], /한 건이라도 적용할 수 없으면 전체 저장이 취소/);
    for (const id of ['completion-back', 'completion-student-name', 'completion-field',
        'completion-refresh', 'completion-bulk-teacher', 'completion-bulk-preview',
        'completion-select-all', 'completion-body', 'completion-prev', 'completion-next']) {
        assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, `${id}가 유일하게 유지되어야 합니다.`);
        assert.doesNotMatch(picker[1], new RegExp(`id="${id}"`));
        assert.doesNotMatch(guide[1], new RegExp(`id="${id}"`));
    }
});

test('일괄 지정 안내를 접이식 도움말로 옮겨 도구 모음의 상시 설명 행을 없앤다', () => {
    const html = section('studylog-completion');
    const start = html.indexOf('id="completion-bulk-toolbar"');
    const end = html.indexOf('id="completion-status"', start);
    assert.ok(start > 0 && end > start);
    const toolbar = html.slice(start, end);
    assert.doesNotMatch(toolbar, /<p[\s>]/);
    assert.match(toolbar, /일괄 지정할 선생님/);
    assert.match(toolbar, /선택한 기록에 지정/);
    assert.match(toolbar, /선택 해제/);
});

test('수업 검색 초기화 버튼은 검색창 옆 같은 행에 두고 빈 필터 그리드는 없앤다', () => {
    const html = section('class-list');
    const row = html.match(/<div class="search-input-wrapper">([\s\S]*?)<\/div>/);
    assert.ok(row);
    for (const id of ['class-search-q', 'btn-do-class-search', 'btn-reset-class-filter']) {
        assert.match(row[1], new RegExp(`id="${id}"`));
        assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1);
    }
    assert.doesNotMatch(html, /class="filter-options-grid"/);
});

test('압축 간격은 조회 화면 스코프로 한정하며 기존 공용 카드 여백을 유지한다', () => {
    assert.match(rule('.search-filter-card'), /padding:\s*1\.25rem/);
    assert.match(rule('.search-filter-card'), /gap:\s*1rem/);
    assert.match(rule('.compact-search-view .search-filter-card'), /padding:\s*0\.8rem/);
    assert.match(rule('.compact-search-view .search-filter-card'), /gap:\s*0\.55rem/);
    assert.match(rule('.compact-search-view .search-filter-card .form-control'), /min-height:\s*36px/);
    assert.match(css, /\.compact-search-view \.search-filter-card \.search-input-wrapper \.form-control\s*\{[^}]*padding-left:/);
    assert.match(rule('#view-tuition-payment-search .search-filter-card'), /padding:\s*0\.8rem/);
});

test('보완 목록은 최소 높이를 확보하고 공간 부족 시 화면 전체를 스크롤한다', () => {
    assert.match(rule('#view-studylog-completion'), /min-height:\s*0/);
    assert.match(rule('#view-studylog-completion'), /overflow-y:\s*auto/);
    assert.match(rule('#view-studylog-completion .book-search-layout'), /flex:\s*1\s+0\s+auto/);
    assert.match(rule('#view-studylog-completion .book-search-layout'), /overflow:\s*visible/);
    assert.match(rule('#view-studylog-completion .table-card'), /min-height:\s*260px/);
    assert.match(rule('#view-studylog-completion .table-card'), /flex:\s*1\s+0\s+260px/);
    assert.match(rule('#view-studylog-completion .search-pagination-bar'), /flex:\s*0\s+0\s+auto/);
});

test('다른 조회 화면도 표가 사라지지 않도록 최소 높이와 바깥 스크롤을 유지한다', () => {
    assert.match(rule('.compact-search-view'), /overflow-y:\s*auto/);
    assert.match(rule('.compact-search-view'), /min-height:\s*0/);
    assert.match(rule('.compact-search-view .book-search-layout'), /overflow:\s*visible/);
    assert.match(rule('.compact-search-view .book-search-layout'), /flex:\s*1\s+0\s+auto/);
    assert.match(rule('.compact-search-view .table-card'), /min-height:\s*230px/);
    assert.match(rule('.compact-search-view .table-card'), /flex:\s*1\s+0\s+230px/);
    assert.match(rule('#view-audit-log .table-responsive'), /max-height:\s*none/);
});

test('좁은 화면의 입력·버튼 크기와 줄바꿈은 유지하고 설명과 검색을 다시 펼칠 수 있다', () => {
    assert.match(css, /@media\s*\(max-width:\s*700px\)\s*\{[\s\S]*?\.compact-search-view \.search-filter-card \.btn,[^{]*\.compact-search-view \.search-filter-card \.form-control\s*\{[^}]*min-height:\s*40px/);
    assert.match(css, /#view-class-list \.search-input-wrapper\s*\{[^}]*flex-wrap:\s*wrap/);
    assert.match(rule('#view-studylog-completion .completion-disclosure[open]'), /grid-column:\s*1\s*\/\s*-1/);
    assert.match(rule('#view-studylog-completion .completion-student-results'), /max-height:\s*160px/);
    assert.match(rule('#view-studylog-completion .completion-student-results'), /overflow-y:\s*auto/);
});
