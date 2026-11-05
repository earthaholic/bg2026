const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('static/js/app.js', 'utf8');
const helpers = source.slice(source.indexOf('    function updateMaterialFilterSummary('), source.indexOf('    // Book Search Handler'));

function setup({ set = [], have = [], pdf = null, mode = false } = {}) {
    const state = { 'material-set-state': { textContent: '' }, 'material-have-state': { textContent: '' } };
    const checkbox = label => ({ checked: true, dataset: { materialLabel: label } });
    const pdfButton = pdf === null ? null : { dataset: { value: pdf.value }, textContent: pdf.text };
    const context = {
        materialSetState: state['material-set-state'],
        materialHaveState: state['material-have-state'],
        filterMaterialMode: { checked: mode },
        filterChkPdf: { querySelector: () => pdfButton },
        document: {
            querySelectorAll: selector => selector === '.material-set-chk' ? set.map(checkbox) : have.map(checkbox)
        }
    };
    vm.createContext(context);
    vm.runInContext(helpers, context);
    context.updateMaterialFilterSummary();
    return state;
}

test('자료 구성 조건을 켜지 않으면 전체 도서 검색으로 안내한다', () => {
    const state = setup();
    assert.equal(state['material-set-state'].textContent, '사용 안 함 · 자료 유무와 관계없이 전체 도서를 검색합니다');
    assert.match(state['material-have-state'].textContent, /자료 보유 조건 없음/);
});

test('조건을 켜고 아무것도 고르지 않으면 자료 없는 도서만 안내한다', () => {
    const state = setup({ mode: true });
    assert.equal(state['material-set-state'].textContent, '선택 없음 · 위 다섯 자료가 하나도 없는 도서만 표시');
});

test('선택한 자료 구성과 보유 조건을 각각 요약한다', () => {
    const state = setup({ mode: true, set: ['퀴즈', '토론 자료'], have: ['종이책 보유'], pdf: { value: 'owned', text: '보유 전체' } });
    assert.equal(state['material-set-state'].textContent, '선택: 퀴즈, 토론 자료 · 선택하지 않은 자료가 없는 도서');
    assert.equal(state['material-have-state'].textContent, '선택: PDF 보유 전체, 종이책 보유 · 반드시 보유한 도서');
});

test('PDF 전체는 보유 조건으로 요약하지 않는다', () => {
    const state = setup({ have: ['YES24 보유'], pdf: { value: '', text: '전체' } });
    assert.equal(state['material-have-state'].textContent, '선택: YES24 보유 · 반드시 보유한 도서');
});
