// 실행: node tests/test_utility_tabs_ui.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../static/js/app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../templates/index.html'), 'utf8');
const keys = ['teacher', 'csv-import', 'csv-links', 'backfill', 'duplicates'];
const panels = new Map(keys.map(key => ['utility-panel-' + key, { hidden: key !== 'teacher', value: '입력 유지', preview: { selected: true } }]));
let focused;
const tabs = keys.map(key => ({
    dataset: { utilityTab: key }, listeners: {}, attrs: { 'aria-controls': 'utility-panel-' + key },
    classList: { toggle(name, value) { this[name] = value; } },
    setAttribute(name, value) { this.attrs[name] = value; },
    getAttribute(name) { return this.attrs[name]; },
    addEventListener(name, fn) { this.listeners[name] = fn; },
    focus() { focused = key; }
}));
const context = vm.createContext({ document: {
    querySelectorAll: () => tabs,
    getElementById: id => panels.get(id)
} });
const start = source.indexOf('    function switchUtilityTab(');
const end = source.indexOf('    async function initUtilitiesView()', start);
assert.ok(start > 0 && end > start);
vm.runInContext(source.slice(start, end), context);
function selected(key) {
    assert.deepEqual(tabs.filter(tab => tab.attrs['aria-selected'] === 'true').map(tab => tab.dataset.utilityTab), [key]);
    assert.deepEqual([...panels].filter(([, panel]) => !panel.hidden).map(([id]) => id), ['utility-panel-' + key]);
    assert.equal(tabs.filter(tab => tab.tabIndex === 0).length, 1);
}
for (const tab of tabs) {
    tab.listeners.click();
    selected(tab.dataset.utilityTab);
}
function press(index, key) {
    let prevented = false;
    tabs[index].listeners.keydown({ key, preventDefault() { prevented = true; } });
    return prevented;
}
assert.ok(press(4, 'ArrowRight')); selected('teacher'); assert.equal(focused, 'teacher');
assert.ok(press(0, 'ArrowLeft')); selected('duplicates');
assert.ok(press(4, 'Home')); selected('teacher');
assert.ok(press(0, 'End')); selected('duplicates');
assert.equal(press(4, 'Tab'), false); selected('duplicates');
vm.runInContext('switchUtilityTab("없는 탭")', context); selected('duplicates');
for (const panel of panels.values()) {
    assert.equal(panel.value, '입력 유지');
    assert.equal(panel.preview.selected, true);
}
const section = html.slice(html.indexOf('<section id="view-utilities"'), html.indexOf('<section id="view-monthly-report"'));
const ids = [...section.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
assert.equal(new Set(ids).size, ids.length, '기존 요소 ID가 중복되면 안 됩니다.');
const expected = {
    teacher: ['teacher-assignment-file', 'teacher-assignment-preview-card'],
    'csv-import': ['studylog-csv-file', 'studylog-csv-preview-card', 'studylog-csv-runs-body', 'studylog-csv-run-detail-card'],
    'csv-links': ['studylog-csv-class-links-run', 'studylog-csv-class-links-preview-card'],
    backfill: ['utility-backfill-month', 'btn-backfill-payroll-class-links'],
    duplicates: ['btn-merge-duplicate-books', 'duplicate-books-preview-card']
};
keys.forEach((key, index) => {
    const begin = section.indexOf('<div id="utility-panel-' + key + '"');
    const finish = index < keys.length - 1 ? section.indexOf('<div id="utility-panel-' + keys[index + 1] + '"') : section.length;
    const markup = section.slice(begin, finish);
    assert.ok(markup.includes('role="tabpanel" aria-labelledby="utility-tab-' + key + '"'));
    assert.equal(markup.slice(0, markup.indexOf('>')).includes(' hidden'), index !== 0);
    for (const id of expected[key]) assert.ok(markup.includes('id="' + id + '"'), id + '가 해당 탭 안에 있어야 합니다.');
});
console.log('유틸리티 탭 전환·키보드·입력 유지·기능 배치 검사 통과');
