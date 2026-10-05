const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const js = fs.readFileSync(path.join(root, 'static/js/tuition_collection.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'static/js/app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'templates/index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'static/css/styles.css'), 'utf8');
new Function(js);
assert.match(html, /data-view="tuition-collection"/);
assert.match(app, /STAFF_ONLY_VIEWS = \[[^\n]*'tuition-collection'/);
assert.match(app, /tuitionCollection\.canLeave\(\)/);
assert.match(app, /tuitionCollection\.reset\(\)/);
assert.match(html, /view-tuition-collection" class="workspace-view compact-search-view"/);
assert.match(js, /version !== listVersion/);
assert.match(js, /version !== detailVersion/);
assert.match(js, /if \(saving\) return/);
assert.match(js, /request_id:requestId/);
assert.match(js, /version:c\.version/);
assert.match(js, /counts_as_reminder/);
assert.match(js, /esc\(event\.memo/);
assert.match(js, /실제 메시지 발송이나 자동 입금 확인 기능이 아닙니다/);
assert.match(js, /\/cases\/\$\{c\.id\}\/complete/);
assert.match(js, /payload\.payment_id = Number/);
assert.match(css, /#view-tuition-collection \.table-card \{ min-height:280px/);
assert.match(css, /@media\(max-width:600px\)/);
console.log('납입 관리 UI 구조·권한·오래된 응답·안전 출력 검사 통과');

assert.match(js, /c\.status === 'confirmed'/);
assert.match(js, /\['notice', 'link_sent', 'reminder'\]\.includes\(option\.value\)/);
assert.match(js, /el\('kind'\)\.value = 'note'/);
assert.match(js, /counts_as_reminder: values\.kind === 'link_sent'/);
assert.match(js, /count\.disabled = kind !== 'link_sent'/);
assert.match(js, /저장하지 않은 입력을 버리고 이 기록을 취소할까요/);
assert.match(js, /id="tc-payment-class" name="ClassType" class="form-control" required/);

assert.doesNotMatch(js, /promise_date|납부 약속/);
assert.match(js, /input\('next_followup','다음 확인일'/);

// 화면 정렬은 처리일, 기록 시각, 번호 내림차순이며 집계용 원본 순서는 유지한다.
const vm = require('node:vm');
const sortContext = vm.createContext({});
vm.runInContext(js, sortContext);
const historyEvents = [
    { id: 1, occurred_on: '2026-10-01', created_at: '2026-10-05T12:00:00' },
    { id: 2, occurred_on: '2026-10-04', created_at: '2026-10-04T09:00:00' },
    { id: 3, occurred_on: '2026-10-04', created_at: '2026-10-04T10:00:00' },
    { id: 4, occurred_on: '2026-10-04', created_at: '2026-10-04T10:00:00', cancelled_at: '2026-10-05' },
];
assert.deepEqual(Array.from(sortContext.tuitionCollectionRecentEvents(historyEvents), e => e.id), [4, 3, 2, 1]);
assert.deepEqual(historyEvents.map(e => e.id), [1, 2, 3, 4]);
assert.equal(sortContext.tuitionCollectionRecentEvents(null).length, 0);
assert.match(js, /tuitionCollectionRecentEvents\(item\.events\)\.map/);

const dialogStyle = css.match(/#view-tuition-collection \.tc-dialog\s*\{([^}]+)\}/)[1];
assert.match(dialogStyle, /position:\s*fixed/);
assert.match(dialogStyle, /inset:\s*0/);
assert.match(dialogStyle, /margin:\s*auto/);
assert.match(dialogStyle, /max-height:\s*90vh/);
assert.match(dialogStyle, /overflow:\s*auto/);

const { test } = require('node:test');
test('완전 삭제는 대상 정보·확인 문구·학생·버전을 검증하여 전송한다', async () => {
    const start = js.indexOf("    el('detail').addEventListener('click', event => {\n        const button = event.target.closest('[data-delete-event]');");
    const end = js.indexOf('    function close(event)', start);
    assert.ok(start > 0 && end > start);
    let handler, pending, promptText = '';
    const calls = [], messages = [];
    const context = vm.createContext({
        el: () => ({ addEventListener: (_type, fn) => { handler = fn; } }),
        saving: false, dirty: false, base: '/api/user/tuition-collection', kinds: { reminder: '독촉' },
        deleteTargets: new Map([['7', { event: { id: 7, kind: 'reminder', occurred_on: '2026-10-05', memo: '확인 대상' }, version: 4, studentId: 9, studentName: '검증 학생' }]]),
        confirm: () => true,
        prompt: text => { promptText = text; return '처리 이력 삭제'; },
        detailMessage: text => messages.push(text),
        apiFetch: async (url, options) => { calls.push({ url, method: options.method, payload: JSON.parse(options.body) }); },
        save: (_form, callback) => { pending = callback(); },
    });
    vm.runInContext(js.slice(start, end), context);
    const click = { target: { closest: () => ({ dataset: { deleteEvent: '7' } }) } };
    handler(click); await pending;
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'DELETE');
    assert.equal(calls[0].url, '/api/user/tuition-collection/events/7');
    assert.deepEqual(calls[0].payload, { confirmation: '처리 이력 삭제', version: 4, student_id: 9 });
    assert.match(promptText, /검증 학생[\s\S]*기록 번호: 7[\s\S]*복구할 수 없습니다[\s\S]*결제 내역[\s\S]*감사 이력/);
    context.prompt = () => '삭제'; handler(click);
    context.prompt = () => null; handler(click);
    context.saving = true; handler(click);
    assert.equal(calls.length, 1);
    assert.equal(messages.length, 1);
});
assert.match(js, /data-delete-event="\$\{esc\(event.id\)\}"/);
