/* 조회 전용 최신 요청 제어. 저장 요청은 취소·자동 재시도하지 않는다. */
(function (root) {
    'use strict';
    const tasks = new Map(), records = [];
    const routes = new Set(['/api/user/books/search', '/api/user/students/search', '/api/user/studylogs/search', '/api/user/classes', '/api/user/tuition-payments', '/api/user/tuition-collection', '/api/admin/audit-logs', '/api/admin/activity-logs']);
    function record(url, started, result, status, requestId) {
        const pathname = new URL(url, 'http://local').pathname;
        const item = { 발생시각: new Date().toISOString(), 경로: routes.has(pathname) ? pathname : '/api/기타', 소요시간밀리초: Math.round(performance.now() - started), 결과: result, 상태: status || 0 };
        if (/^[a-f0-9]{32}$/.test(requestId || '')) item.요청번호 = requestId;
        records.push(item); if (records.length > 100) records.shift();
        if (result !== '성공') console.warn('조회 통신 진단', item);
    }
    async function request(url, options) {
        const started = performance.now();
        try {
            const response = await fetch(url, options);
            record(url, started, response.ok ? (performance.now() - started > 3000 ? '지연' : '성공') : '서버 오류', response.status, response.headers.get('X-Request-ID'));
            return response;
        } catch (error) {
            if (options.signal?.aborted || error.name === 'AbortError') throw error;
            record(url, started, '연결 실패');
            throw new Error(['GET', 'HEAD'].includes((options.method || 'GET').toUpperCase())
                ? '조회 연결에 실패했습니다. 네트워크 연결을 확인하고 다시 조회해 주세요.'
                : '서버 연결이 끊겼습니다. 처리되었을 수 있으니 결과를 확인한 뒤 다시 시도해 주세요.');
        }
    }
    function begin(key, retry) {
        tasks.get(key)?.cancel();
        const controller = new AbortController();
        const view = document.getElementById('view-' + key);
        const results = [...(view?.querySelectorAll('.table-card, .book-cards-grid') || [])];
        const release = () => { view?.removeAttribute('aria-busy'); for (const node of results) node.inert = false; };
        view?.setAttribute('aria-busy', 'true'); for (const node of results) node.inert = true;
        let resolve, timer;
        const task = { signal: controller.signal, current: () => tasks.get(key) === task && !controller.signal.aborted };
        task.ready = new Promise(done => { resolve = done; timer = setTimeout(() => done(task.current()), 300); });
        task.cancel = () => { clearTimeout(timer); controller.abort(); resolve(false); task.notice?.remove(); release(); };
        task.success = () => { if (task.current()) { task.notice?.remove(); release(); } };
        task.fail = error => {
            if (!task.current() || error.name === 'AbortError') return;
            release();
            if (!view) return;
            task.notice?.remove();
            const notice = document.createElement('div'); notice.className = 'search-request-notice alert alert-danger'; notice.setAttribute('role', 'status');
            const text = document.createElement('span'); text.textContent = (error.message || '조회하지 못했습니다.') + ' 기존 목록은 이전 조회 결과입니다. ';
            const button = document.createElement('button'); button.type = 'button'; button.className = 'btn btn-outline'; button.textContent = '다시 조회';
            button.addEventListener('click', () => { button.disabled = true; retry(); });
            notice.append(text, button); (view.querySelector('.book-search-layout') || view).prepend(notice); task.notice = notice;
        };
        tasks.set(key, task);
        return task;
    }
    root.BgSearch = { begin, fetch: request, cancelAll() { for (const task of tasks.values()) task.cancel(); tasks.clear(); }, diagnostics: () => records.map(item => ({ ...item })) };
})(globalThis);
