// 실행: node --test tests/test_mcp_connection_ui.js
// 네트워크·실제 계정·클립보드 없이 가짜 토큰과 DOM 대역으로 검증한다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'static/js/mcp_connection.js'), 'utf8');
const template = fs.readFileSync(path.join(root, 'templates/index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'static/js/app.js'), 'utf8');
const NOW = 1800000000000;
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const fakeToken = (payload = { exp: NOW / 1000 + 60, sub: '가짜계정' }) =>
    `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.${encode('가짜서명')}`;

class Element {
    constructor() {
        this.textContent = ''; this.innerHTML = ''; this.value = '';
        this.dataset = {}; this.attributes = {}; this.hidden = false;
        this.open = false; this.disabled = false; this.listeners = new Map();
    }
    addEventListener(type, listener) {
        const listeners = this.listeners.get(type) || [];
        listeners.push(listener); this.listeners.set(type, listeners);
    }
    async emit(type, event = {}) {
        for (const listener of this.listeners.get(type) || []) await listener(event);
    }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] ?? null; }
}
function harness(options = {}) {
    let token = options.token ?? null;
    let now = NOW;
    let nextTimer = 0;
    const timers = new Map(), calls = [], logs = [];
    const panel = new Element(), address = new Element(), state = new Element(), message = new Element();
    // 실제 템플릿의 초기 hidden 상태를 반영한다.
    panel.hidden = /<details\b[^>]*id="mcp-connection"[^>]*\bhidden/.test(template);
    const buttons = Object.fromEntries(['address', 'token', 'header'].map(kind => {
        const button = new Element(); button.dataset.mcpCopy = kind; return [kind, button];
    }));
    panel.querySelectorAll = selector => {
        assert.equal(selector, 'button[data-mcp-copy]'); return Object.values(buttons);
    };
    const nodes = { 'mcp-connection': panel, 'mcp-connection-address': address,
        'mcp-connection-state': state, 'mcp-connection-message': message };
    const window = new Element();
    const clipboard = { writeText: text => {
        calls.push(text); return options.writeText ? options.writeText(text) : Promise.resolve();
    } };
    const context = vm.createContext({
        document: { getElementById: id => options.missingPanel && id === 'mcp-connection' ? null : nodes[id] },
        window, navigator: options.noClipboard ? {} : { clipboard },
        location: { origin: 'https://example.invalid:8443' }, URL, atob,
        Date: class extends Date { static now() { return now; } },
        setTimeout: (fn, delay) => { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; },
        clearTimeout: id => timers.delete(id),
        console: { log: (...args) => logs.push(args), warn: (...args) => logs.push(args), error: (...args) => logs.push(args) }
    });
    vm.runInContext(source, context, { filename: 'mcp_connection.js' });
    const connection = context.initMcpConnection({ getToken: () => token });
    return { connection, panel, address, state, message, buttons, timers, calls, logs, window,
        setToken: value => { token = value; }, setNow: value => { now = value; },
        click: kind => buttons[kind].emit('click'),
        exposed: () => JSON.stringify([...Object.values(nodes), ...Object.values(buttons)].map(node => ({
            text: node.textContent, html: node.innerHTML, value: node.value,
            attributes: node.attributes, dataset: node.dataset
        })))
    };
}
function assertReset(h) {
    assert.equal(h.panel.hidden, true); assert.equal(h.panel.open, false);
    assert.equal(h.message.textContent, ''); assert.equal(h.state.textContent, '');
    assert.equal(h.timers.size, 0);
    for (const button of Object.values(h.buttons)) assert.equal(button.disabled, true);
}
function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

test('템플릿은 로그인 전 패널을 숨기고 연결 스크립트를 app보다 먼저 로드한다', () => {
    assert.match(template, /<details\b[^>]*id="mcp-connection"[^>]*\bhidden/);
    const scripts = [...template.matchAll(/<script\b([^>]*\bsrc="([^"]+)"[^>]*)>/g)];
    const connectionIndex = scripts.findIndex(match => /^\/static\/js\/mcp_connection\.js(?:\?|$)/.test(match[2]));
    const appIndex = scripts.findIndex(match => /^\/static\/js\/app\.js(?:\?|$)/.test(match[2]));
    assert.ok(connectionIndex >= 0 && appIndex > connectionIndex);
    assert.doesNotMatch(scripts[connectionIndex][1], /\basync\b/);
    assert.doesNotMatch(scripts[appIndex][1], /\basync\b/);
    for (const kind of ['address', 'token', 'header']) assert.ok(template.includes(`data-mcp-copy="${kind}"`));
});

test('app 연결은 인증 완료·같은 저장 토큰만 허용하고 로그인 갱신 및 로그아웃 초기화를 연결한다', () => {
    const initLine = app.match(/const mcpConnection = initMcpConnection\(([^\n]+)\);/);
    assert.ok(initLine);
    let getter;
    const ctx = vm.createContext({ currentUser: null, token: '가짜토큰A', stored: '가짜토큰A',
        initMcpConnection: options => { getter = options.getToken; },
        localStorage: { getItem: key => { assert.equal(key, 'token'); return ctx.stored; } } });
    vm.runInContext(`initMcpConnection(${initLine[1]});`, ctx);
    assert.equal(getter(), null);
    ctx.currentUser = { username: '가짜계정' }; assert.equal(getter(), '가짜토큰A');
    ctx.stored = '가짜토큰B'; assert.equal(getter(), null);
    ctx.stored = null; assert.equal(getter(), null);
    assert.match(app, /function updateUserUI\(\)\s*\{\s*if \(!currentUser\) return;\s*mcpConnection\.refresh\(\);/);
    assert.match(app, /function handleLogout\(\)\s*\{\s*mcpConnection\.reset\(\);/);
    assert.match(app, /currentUser = await apiFetch\('\/api\/auth\/me'\);\s*await loadUserDisplayNames\(\);\s*updateUserUI\(\);/);
    assert.match(app, /token = data\.access_token;\s*localStorage\.setItem\('token', token\);\s*currentUser = \{[^}]+\};\s*await loadUserDisplayNames\(\);\s*updateUserUI\(\);/);
});

test('로그인 전 숨김과 빈 토큰 refresh 초기화', () => {
    const h = harness(); assert.equal(h.panel.hidden, true);
    h.connection.refresh(); assertReset(h); assert.deepEqual(h.calls, []);
});

test('refresh는 유효 토큰 패널과 버튼만 활성화하고 토큰을 DOM·로그에 노출하지 않는다', async () => {
    const token = fakeToken(), h = harness({ token });
    assert.equal(h.panel.hidden, true);
    h.connection.refresh(); assert.equal(h.panel.hidden, false);
    assert.equal(h.address.textContent, 'https://example.invalid:8443/mcp');
    assert.match(h.state.textContent, /화면에 표시하지 않습니다/);
    for (const button of Object.values(h.buttons)) assert.equal(button.disabled, false);
    for (const kind of ['address', 'token', 'header']) await h.click(kind);
    assert.equal(h.exposed().includes(token), false);
    assert.equal(JSON.stringify(h.logs).includes(token), false);
    assert.equal(h.timers.size, 1);
});

for (const kind of ['address', 'token', 'header']) {
    test(`${kind} 복사는 실제 클립보드 인수와 완료 안내를 검증한다`, async () => {
        const token = fakeToken(), h = harness({ token }); h.connection.refresh();
        await h.click(kind);
        const expected = kind === 'address' ? 'https://example.invalid:8443/mcp' : kind === 'header' ? `Bearer ${token}` : token;
        assert.deepEqual(h.calls, [expected]);
        assert.match(h.message.textContent, /복사했습니다/);
        if (kind !== 'address') assert.match(h.message.textContent, /채팅이나 문서에 붙여넣지 마세요/);
    });
}

const invalidTokens = [
    ['만료', fakeToken({ exp: NOW / 1000 - 1 })],
    ['만료 경계', fakeToken({ exp: NOW / 1000 })],
    ['문자열 exp', fakeToken({ exp: String(NOW / 1000 + 60) })],
    ['exp 없음', fakeToken({ sub: '가짜계정' })],
    ['잘못된 base64', 'fake.%%%.fake'],
    ['잘못된 JSON', `fake.${Buffer.from('잘못된 JSON').toString('base64url')}.fake`],
    ['임의 문자열', '가짜-잘못된-토큰'], ['빈 토큰', null]
];
for (const [label, token] of invalidTokens) {
    test(`${label}은 표시 갱신 및 직접 이벤트 호출 모두 복사를 차단한다`, async () => {
        const h = harness({ token }); h.connection.refresh();
        for (const button of Object.values(h.buttons)) assert.equal(button.disabled, true);
        for (const kind of ['address', 'token', 'header']) await h.click(kind);
        assert.deepEqual(h.calls, []); assert.equal(h.timers.size, 0);
        if (token) assert.match(h.state.textContent, /만료/);
    });
}

test('버튼 활성화 뒤 만료되어도 클릭 시점에 재검사한다', async () => {
    const h = harness({ token: fakeToken() }); h.connection.refresh();
    h.setNow(NOW + 60000);
    for (const kind of ['address', 'token', 'header']) await h.click(kind);
    assert.deepEqual(h.calls, []);
    for (const button of Object.values(h.buttons)) assert.equal(button.disabled, true);
});

test('만료 타이머는 중복되지 않으며 만료 시 버튼을 잠근다', () => {
    const h = harness({ token: fakeToken() }); h.connection.refresh(); h.connection.refresh();
    assert.equal(h.timers.size, 1);
    const [id, timer] = [...h.timers][0]; assert.equal(timer.delay, 60050);
    h.timers.delete(id); h.setNow(NOW + timer.delay); timer.fn();
    assert.equal(h.timers.size, 0);
    for (const button of Object.values(h.buttons)) assert.equal(button.disabled, true);
});

test('로그아웃 reset은 패널·안내·버튼·타이머를 정리하고 재로그인할 수 있다', async () => {
    const h = harness({ token: fakeToken() }); h.connection.refresh(); h.panel.open = true;
    await h.click('token'); h.setToken(null); h.connection.reset(); assertReset(h);
    h.setToken(fakeToken()); h.connection.refresh(); assert.equal(h.panel.hidden, false);
});

for (const key of ['token', null]) {
    test(`다른 탭 storage ${String(key)} 변경은 초기화한다`, async () => {
        const h = harness({ token: fakeToken() }); h.connection.refresh(); h.panel.open = true;
        await h.click('header'); await h.window.emit('storage', { key }); assertReset(h);
    });
}
test('다른 저장 항목은 연결 상태를 초기화하지 않는다', async () => {
    const h = harness({ token: fakeToken() }); h.connection.refresh();
    await h.window.emit('storage', { key: 'theme' });
    assert.equal(h.panel.hidden, false); assert.equal(h.timers.size, 1);
});

for (const mode of ['권한 거부', 'API 없음']) {
    test(`클립보드 ${mode} 시 안전한 실패 안내를 표시한다`, async () => {
        const token = fakeToken(), h = harness({ token, noClipboard: mode === 'API 없음',
            writeText: () => Promise.reject(new Error('가짜 권한 거부')) });
        h.connection.refresh(); await h.click('token');
        assert.match(h.message.textContent, /복사하지 못했습니다.*HTTPS.*권한/);
        assert.equal(h.exposed().includes(token), false);
    });
}

for (const action of ['reset', 'storage', 'token-change']) {
    for (const result of ['resolve', 'reject']) {
        test(`${action} 이후 늦은 복사 ${result} 응답은 새 안내를 덮어쓰지 않는다`, async () => {
            const pending = deferred(), h = harness({ token: fakeToken(), writeText: () => pending.promise });
            h.connection.refresh(); const click = h.click('token');
            assert.equal(h.calls.length, 1);
            if (action === 'reset') h.connection.reset();
            else if (action === 'storage') await h.window.emit('storage', { key: 'token' });
            else h.setToken(fakeToken({ exp: NOW / 1000 + 120, sub: '다른가짜계정' }));
            h.message.textContent = '새 상태 안내';
            pending[result](result === 'reject' ? new Error('가짜 지연 실패') : undefined);
            await click; assert.equal(h.message.textContent, '새 상태 안내');
        });
    }
}

test('패널 접기 시 복사 안내를 지운다', async () => {
    const h = harness({ token: fakeToken() }); h.connection.refresh(); await h.click('address');
    h.panel.open = false; await h.panel.emit('toggle'); assert.equal(h.message.textContent, '');
});

test('패널이 없는 화면도 안전하게 초기화한다', () => {
    const h = harness({ missingPanel: true });
    assert.doesNotThrow(() => { h.connection.refresh(); h.connection.reset(); });
});

// JWT 서명·전체 구조의 인증은 서버 책임이다. 여기서는 파싱 불가·만료 입력을 검사한다.
