/* 전용 토큰은 발급 응답에서 한 번만 받아 메모리에 보관한다. 웹 로그인 토큰을 표시·복사하지 않는다. */
(function (root) {
    'use strict';
    root.initMcpConnection = function ({ apiFetch }) {
        const panel = document.getElementById('mcp-connection');
        if (!panel) return { refresh() {}, reset() {} };
        const el = id => document.getElementById('mcp-connection-' + id);
        const address = el('address'), state = el('state'), message = el('message');
        const issue = el('issue'), revoke = el('revoke');
        const buttons = [...panel.querySelectorAll('button[data-mcp-copy]')];
        const endpoint = new URL('/mcp', location.origin).href;
        const api = '/api/user/mcp-token';
        let secret = '', metadata = null, timer = null, revision = 0, busy = false;
        address.textContent = endpoint;
        function valid() {
            return Boolean(metadata?.active) && Date.parse(metadata.expires_at) > Date.now();
        }
        function render() {
            clearTimeout(timer);
            const active = valid();
            if (!active) secret = '';
            issue.disabled = busy || !metadata || metadata.enabled === false;
            issue.textContent = active ? '토큰 재발급' : '전용 토큰 발급';
            revoke.disabled = busy || !active;
            buttons.forEach(button => {
                button.disabled = busy || !metadata || metadata.enabled === false || (button.dataset.mcpCopy !== 'address' && (!active || !secret));
            });
            if (!metadata) return;
            if (metadata.enabled === false) state.textContent = '서버에서 MCP 연결이 비활성화되어 있습니다.';
            else if (active) {
                const expiry = new Date(metadata.expires_at).toLocaleString('ko-KR');
                state.textContent = '만료: ' + expiry + (secret ? '\n지금 토큰을 복사해 보관하세요. 이 화면을 새로고침하면 다시 확인할 수 없습니다.' : '\n이미 발급된 토큰은 다시 표시하지 않습니다. 분실했다면 재발급하세요.');
                timer = setTimeout(render, Math.min(Date.parse(metadata.expires_at) - Date.now() + 50, 2147483647));
            } else state.textContent = '사용 가능한 전용 토큰이 없습니다. 발급 후 복사해 주세요.';
        }
        function reset() {
            revision++;
            clearTimeout(timer);
            secret = ''; metadata = null; busy = false;
            panel.hidden = true; panel.open = false;
            message.textContent = ''; state.textContent = '';
            render();
        }
        async function refresh() {
            const version = ++revision;
            secret = ''; metadata = null; busy = true;
            panel.hidden = false;
            state.textContent = '전용 토큰 상태를 확인하고 있습니다.';
            message.textContent = '';
            render();
            try {
                const data = await apiFetch(api);
                if (version !== revision) return;
                metadata = data;
            } catch (_) {
                if (version !== revision) return;
                state.textContent = '토큰 상태를 확인하지 못했습니다.';
                message.textContent = '연결을 확인하고 다시 조회해 주세요.';
            } finally {
                if (version === revision) { busy = false; render(); }
            }
        }
        async function mutate(kind) {
            if (busy || !metadata || (kind === 'issue' ? issue.disabled : revoke.disabled)) return;
            const question = kind === 'issue' ? (valid() ? '재발급하면 이전 토큰은 즉시 사용할 수 없습니다. 새 토큰을 발급할까요?' : '30일 동안 유효한 MCP 읽기 전용 토큰을 발급할까요?') : '토큰을 폐기하면 연결된 MCP 프로그램의 접근이 즉시 차단됩니다. 폐기할까요?';
            if (!window.confirm(question)) return;
            const version = ++revision;
            busy = true; message.textContent = ''; render();
            try {
                const data = await apiFetch(api, { method: kind === 'issue' ? 'POST' : 'DELETE', body: JSON.stringify({ confirmation: kind === 'issue' ? 'MCP 토큰 발급' : 'MCP 토큰 폐기' }) });
                if (version !== revision) return;
                if (kind === 'issue' && (typeof data.token !== 'string' || !data.token.startsWith('bgmcp_'))) throw new Error('토큰 응답 오류');
                metadata = data;
                secret = kind === 'issue' ? data.token : '';
                // 응답 객체에도 원문을 중복 보관하지 않는다.
                metadata = { enabled: data.enabled, active: data.active, expires_at: data.expires_at, created_at: data.created_at };
                message.textContent = kind === 'issue' ? '전용 토큰을 발급했습니다. 아래 복사 버튼을 사용하세요.' : '전용 토큰을 폐기했습니다.';
            } catch (_) {
                if (version !== revision) return;
                secret = ''; metadata = null;
                state.textContent = '처리 결과를 확인하지 못했습니다.';
                message.textContent = '서버에서 이미 처리되었을 수 있습니다. 다시 조회하여 상태를 확인해 주세요.';
            } finally {
                if (version === revision) { busy = false; render(); }
            }
        }
        issue.addEventListener('click', () => mutate('issue'));
        revoke.addEventListener('click', () => mutate('revoke'));
        el('reload').addEventListener('click', () => { if (!busy) refresh(); });
        buttons.forEach(button => button.addEventListener('click', async () => {
            if (button.disabled || busy) return;
            const kind = button.dataset.mcpCopy;
            if (kind !== 'address' && (!valid() || !secret)) { render(); return; }
            const version = revision;
            const text = kind === 'address' ? endpoint : kind === 'header' ? 'Bearer ' + secret : secret;
            message.textContent = '';
            try {
                if (!navigator.clipboard?.writeText) throw new Error('복사 기능 없음');
                await navigator.clipboard.writeText(text);
                if (version !== revision) return;
                message.textContent = kind === 'address' ? '연결 주소를 복사했습니다.' : '전용 토큰을 복사했습니다. 신뢰하는 프로그램에만 입력하세요.';
            } catch (_) {
                if (version === revision) message.textContent = '복사하지 못했습니다. HTTPS 접속과 브라우저 클립보드 권한을 확인해 주세요.';
            }
        }));
        panel.addEventListener('toggle', () => { if (!panel.open) message.textContent = ''; });
        window.addEventListener('storage', event => { if (event.key === 'token' || event.key === null) reset(); });
        return { refresh, reset };
    };
})(globalThis);
