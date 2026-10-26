/* 로그인 토큰은 화면·속성·로그에 넣지 않고 명시적인 복사 요청에만 사용한다. */
(function (root) {
    'use strict';
    root.initMcpConnection = function ({ getToken }) {
        const panel = document.getElementById('mcp-connection');
        if (!panel) return { refresh() {}, reset() {} };
        const address = document.getElementById('mcp-connection-address');
        const state = document.getElementById('mcp-connection-state');
        const message = document.getElementById('mcp-connection-message');
        const buttons = [...panel.querySelectorAll('button[data-mcp-copy]')];
        let timer = null;
        let revision = 0;
        const endpoint = new URL('/mcp', location.origin).href;
        address.textContent = endpoint;

        function expiry(value) {
            try {
                const part = value.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
                const data = JSON.parse(atob(part.padEnd(Math.ceil(part.length / 4) * 4, '=')));
                return typeof data.exp === 'number' ? data.exp * 1000 : NaN;
            } catch (_) { return NaN; }
        }
        function usable(value) {
            return Boolean(value) && Number.isFinite(expiry(value)) && expiry(value) > Date.now();
        }
        function reset() {
            revision++;
            clearTimeout(timer);
            timer = null;
            panel.hidden = true;
            panel.open = false;
            message.textContent = '';
            state.textContent = '';
            buttons.forEach(button => { button.disabled = true; });
        }
        function refresh() {
            clearTimeout(timer);
            const value = getToken();
            if (!value) { reset(); return; }
            panel.hidden = false;
            const valid = usable(value);
            state.textContent = valid ? '토큰은 안전을 위해 화면에 표시하지 않습니다.' : '로그인 정보가 만료되었습니다. 다시 로그인해 주세요.';
            buttons.forEach(button => { button.disabled = !valid; });
            if (valid) timer = setTimeout(refresh, Math.min(expiry(value) - Date.now() + 50, 2147483647));
        }
        buttons.forEach(button => button.addEventListener('click', async () => {
            const value = getToken();
            if (!usable(value)) { refresh(); return; }
            const version = revision;
            const kind = button.dataset.mcpCopy;
            const text = kind === 'address' ? endpoint : kind === 'header' ? 'Bearer ' + value : value;
            message.textContent = '';
            try {
                if (!navigator.clipboard?.writeText) throw new Error('복사 기능을 사용할 수 없습니다.');
                await navigator.clipboard.writeText(text);
                if (version !== revision || getToken() !== value) return;
                message.textContent = kind === 'address' ? '연결 주소를 복사했습니다.' : kind === 'header' ? '인증 헤더 값을 복사했습니다. 채팅이나 문서에 붙여넣지 마세요.' : '토큰을 복사했습니다. 채팅이나 문서에 붙여넣지 마세요.';
            } catch (_) {
                if (version === revision && getToken() === value) message.textContent = '복사하지 못했습니다. HTTPS 접속과 브라우저 클립보드 권한을 확인해 주세요.';
            }
        }));
        panel.addEventListener('toggle', () => { if (!panel.open) message.textContent = ''; });
        window.addEventListener('storage', event => { if (event.key === 'token' || event.key === null) reset(); });
        return { refresh, reset };
    };
})(globalThis);
