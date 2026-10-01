// 날짜 저장의 확인·검증·재조회 흐름을 운영 DB 없이 검증한다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../static/js/app.js'), 'utf8');
const code = source.slice(source.indexOf('    async function updateBookMaterialReviewDate'), source.indexOf('    async function deleteBookMaterialRequest'));

function fixture({ valid = true, confirmed = true, fail = false, date = '2026-10-02' } = {}) {
    const calls = [];
    const button = { disabled: false };
    const context = vm.createContext({
        document: { getElementById: () => ({ value: date, reportValidity: () => valid }) },
        createActionFeedback: () => ({ confirm: async message => { calls.push(['확인', message]); return confirmed; }, show: (message, type) => calls.push(['메시지', type]) }),
        apiFetch: async (url, options) => { calls.push(['저장', url, JSON.parse(options.body)]); assert.equal(button.disabled, true); if (fail) throw new Error('저장 실패'); return { message: '변경 완료' }; },
        loadBookMaterialRequests: async review => calls.push(['재조회', review]),
    });
    vm.runInContext(code, context);
    return { calls, button, run: () => context.updateBookMaterialReviewDate({ Id: 7, ReviewedAt: '2026-09-20 12:34:56' }, button) };
}

test('확인 후 날짜와 동시 변경 확인값을 저장하고 승인 목록을 재조회한다', async () => {
    const f = fixture(); await f.run();
    assert.deepEqual(f.calls[1], ['저장', '/api/user/book-material-requests/7/review-date', { ReviewedDate: '2026-10-02', ExpectedReviewedAt: '2026-09-20 12:34:56' }]);
    assert.deepEqual(f.calls[3], ['재조회', true]);
    assert.equal(f.button.disabled, false);
});

test('빈 날짜·같은 날짜·확인 취소는 저장하지 않는다', async () => {
    for (const options of [{ valid: false }, { date: '2026-09-20' }, { confirmed: false }]) {
        const f = fixture(options); await f.run();
        assert.ok(!f.calls.some(call => call[0] === '저장'));
    }
});

test('저장 실패는 오류를 알리고 입력과 재시도 버튼을 유지한다', async () => {
    const f = fixture({ fail: true }); await f.run();
    assert.deepEqual(f.calls[2], ['메시지', 'error']);
    assert.ok(!f.calls.some(call => call[0] === '재조회'));
    assert.equal(f.button.disabled, false);
});
