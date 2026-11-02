// 실행: node --test tests/test_mobile_layout_ui.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const template = fs.readFileSync(path.join(__dirname, '../templates/index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../static/css/mobile.css'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '../static/js/mobile.js'), 'utf8');

test('모바일 화면은 뷰포트 설정과 전용 CSS·JS를 사용한다', () => {
    assert.match(template, /<meta name="viewport" content="width=device-width, initial-scale=1\.0">/);

    const stylesIndex = template.indexOf('/static/css/styles.css?v=');
    const mobileIndex = template.indexOf('/static/css/mobile.css?v=');
    assert.ok(stylesIndex > 0, 'styles.css를 먼저 불러와야 합니다.');
    assert.ok(mobileIndex > stylesIndex, 'mobile.css는 styles.css 뒤에 와야 합니다.');
    assert.match(template, /<script src="\/static\/js\/mobile\.js\?v=[^"]+"><\/script>/);
});

test('데스크톱 화면은 기존 레이아웃을 그대로 쓰고 메뉴 버튼만 숨긴다', () => {
    // 서랍 버튼은 기본적으로 숨겨 두고, 900px 이하에서만 보이게 한다.
    assert.match(css, /\.nav-mobile-toggle\s*\{\s*display:\s*none;\s*\}/);
    assert.match(css, /@media \(max-width: 900px\) \{/);
    assert.doesNotMatch(css.replace(/@media[^{]+\{[\s\S]*$/, ''), /\.sidebar\s*\{[^}]*position:\s*fixed/);

    // 서랍 전환 규칙은 미디어 쿼리 안에서만 적용한다.
    const mobileBlock = css.slice(css.indexOf('@media (max-width: 900px) {'));
    assert.match(mobileBlock, /\.sidebar\s*\{[^}]*position:\s*fixed/);
    assert.match(mobileBlock, /body\.mobile-nav-open \.sidebar\s*\{\s*transform:\s*none;/);
    assert.match(css, /body\.mobile-nav-open\s*\{\s*overflow:\s*hidden;/);
});

test('좁은 화면에서는 표를 가로 스크롤하고 입력 요소를 키운다', () => {
    const mobileBlock = css.slice(css.indexOf('@media (max-width: 900px) {'));
    assert.match(mobileBlock, /\.table-responsive\s*\{[^}]*overflow-x:\s*auto/);
    assert.match(mobileBlock, /\.modern-table\s*\{\s*min-width:\s*\d+px;/, '표가 뭉개지지 않도록 최소 폭을 둡니다.');

    const phoneBlock = css.slice(css.indexOf('@media (max-width: 600px) {'));
    assert.match(phoneBlock, /input,\s*select,\s*textarea,\s*\.form-control\s*\{\s*font-size:\s*16px;/, 'iOS 자동 확대를 막습니다.');
    assert.match(phoneBlock, /\.modal-card,[\s\S]*?height:\s*100dvh;/, '모달은 화면을 가득 채웁니다.');
});

test('메뉴 서랍은 키보드·배경 클릭으로 닫히고 접근성 상태를 함께 갱신한다', () => {
    assert.match(js, /aria-expanded/);
    assert.match(js, /aria-controls', 'sidebar-main-menu'/);
    assert.match(js, /event\.key === 'Escape'/);
    assert.match(js, /backdrop\.addEventListener\('click'/);
    assert.match(js, /closest\('\.menu-nav-item'\)/, '메뉴 선택 시 서랍을 닫아야 합니다.');
    assert.match(js, /setAttribute\('inert'/, '닫힌 서랍은 탭 이동에서 제외합니다.');
    assert.match(js, /'\(max-width: 900px\)'/);
});

test('가로로 넘치는 표에만 스크롤 힌트를 붙인다', () => {
    assert.match(js, /is-h-scrollable/);
    assert.match(js, /is-h-scroll-end/);
    assert.match(css, /\.table-card\.is-h-scrollable::after/);
});
