// 비동기 요청을 시작할 때 실행한 버튼을 보관하여 다른 버튼의 결과와 섞이지 않게 한다.
(() => {
    let currentTrigger = null;
    const panels = new Set();
    const byTrigger = new WeakMap();
    const visible = element => element?.isConnected && element.getClientRects().length > 0;

    for (const type of ['click', 'submit', 'change', 'keydown', 'pointerup']) {
        document.addEventListener(type, event => {
            const trigger = event.submitter || event.target.closest?.('button, input, select, textarea, [role="button"]');
            currentTrigger = trigger || null;
            setTimeout(() => { if (currentTrigger === trigger) currentTrigger = null; }, 0);
        }, true);
    }

    window.createActionFeedback = source => {
        const eventTrigger = source?.submitter || (source?.target?.tagName === 'FORM' ? source.target.querySelector('[type="submit"]') : source?.target?.closest?.('button, input, select, textarea'));
        const element = typeof source === 'string' ? document.querySelector(source) : source;
        let anchor = eventTrigger || (element instanceof Element ? element : null) || currentTrigger;
        if (anchor?.tagName === 'FORM') anchor = anchor.querySelector('[type="submit"]');
        if (!visible(anchor)) anchor = null;
        const workspace = document.querySelector('.workspace-view.active');
        const scope = anchor?.closest('dialog, .modal-backdrop, .workspace-view') || workspace;
        const origin = anchor?.getBoundingClientRect();
        let activePanel;

        function mount(type, message, confirm = false) {
            activePanel?.close(false);
            if (anchor) byTrigger.get(anchor)?.close(false);
            if (!visible(scope) && !visible(workspace)) return null;
            const panel = document.createElement(confirm ? 'dialog' : 'div');
            panel.className = `action-feedback action-feedback-${type}`;
            panel.setAttribute('role', confirm ? 'alertdialog' : (type === 'error' ? 'alert' : 'status'));
            panel.setAttribute('aria-label', confirm ? '작업 확인' : '작업 결과');
            const content = document.createElement('div');
            content.className = 'action-feedback-text';
            content.textContent = String(message ?? '');
            panel.append(content);
            const actions = document.createElement('div');
            actions.className = 'action-feedback-actions';
            panel.append(actions);
            const close = document.createElement('button');
            close.type = 'button';
            close.className = 'btn btn-sm btn-outline';
            close.textContent = confirm ? '취소' : '닫기';
            close.setAttribute('aria-label', confirm ? '작업 취소' : '메시지 닫기');
            actions.append(close);
            (anchor?.closest('dialog[open]') || document.body).append(panel);
            if (confirm) {
                panel.setAttribute('aria-modal', 'true');
                panel.showModal();
            } else if (panel.showPopover) {
                panel.setAttribute('popover', 'manual');
                panel.showPopover();
            }
            const state = {
                panel, confirm, resolve: null,
                close(result = false) {
                    if (confirm && panel.open) panel.close();
                    panel.remove();
                    panels.delete(state);
                    if (anchor && byTrigger.get(anchor) === state) byTrigger.delete(anchor);
                    state.resolve?.(result);
                },
                position() {
                    // 화면 이동 시 이전 화면의 결과를 새 화면 위에 표시하지 않는다.
                    if (!visible(scope) && (confirm || !visible(workspace))) { state.close(); return; }
                    if (!confirm && panel.parentElement instanceof HTMLDialogElement && !panel.parentElement.open) {
                        document.body.append(panel);
                        if (panel.showPopover && !panel.matches(':popover-open')) panel.showPopover();
                    }
                    const live = visible(anchor);
                    if (confirm && !live) { state.close(); return; }
                    const rect = live ? anchor.getBoundingClientRect() : origin;
                    const fallback = (visible(scope) ? scope : workspace)?.getBoundingClientRect();
                    if (!rect && !fallback) { state.close(); return; }
                    const left = rect?.left ?? fallback.left + 16;
                    const bottom = rect?.bottom ?? fallback.top + 16;
                    const top = rect?.top ?? bottom;
                    const width = panel.offsetWidth;
                    const height = panel.offsetHeight;
                    panel.style.left = `${Math.max(8, Math.min(left, window.innerWidth - width - 8))}px`;
                    panel.style.top = `${Math.max(8, Math.min(bottom + 8 + height <= window.innerHeight - 8 ? bottom + 8 : top - height - 8, window.innerHeight - height - 8))}px`;
                    // 스크롤로 버튼이 화면 밖으로 나가면 결과도 함께 숨긴다.
                    panel.classList.toggle('action-feedback-offscreen', live && (rect.bottom < 0 || rect.top > window.innerHeight));
                }
            };
            close.addEventListener('click', () => { state.close(); if (confirm && visible(anchor)) anchor.focus(); });
            panels.add(state);
            if (anchor) byTrigger.set(anchor, state);
            activePanel = state;
            state.position();
            return state;
        }

        return {
            show(message, type = 'info') {
                mount(type === 'danger' ? 'error' : type, message);
            },
            confirm(message) {
                const state = mount('warning', message, true);
                if (!state || !state.panel.isConnected) return Promise.resolve(false);
                return new Promise(resolve => {
                    state.resolve = resolve;
                    const accept = document.createElement('button');
                    accept.type = 'button';
                    accept.className = 'btn btn-sm btn-primary';
                    accept.textContent = '확인';
                    accept.addEventListener('click', () => { state.close(true); if (visible(anchor)) anchor.focus(); });
                    state.panel.querySelector('.action-feedback-actions').append(accept);
                    state.panel.addEventListener('keydown', event => {
                        if (event.key === 'Escape') { event.preventDefault(); state.close(false); anchor?.focus(); }
                        if (event.key === 'Tab') {
                            event.preventDefault();
                            const cancel = state.panel.querySelector('button');
                            (document.activeElement === cancel ? accept : cancel).focus();
                        }
                    });
                    state.position();
                    state.panel.querySelector('button').focus();
                });
            }
        };
    };

    let scheduled = false;
    function reposition() {
        if (scheduled || !panels.size) return;
        scheduled = true;
        requestAnimationFrame(() => { scheduled = false; panels.forEach(state => state.position()); });
    }
    window.addEventListener('resize', reposition);
    document.addEventListener('scroll', reposition, true);
    new MutationObserver(records => {
        const messages = new Set(records.map(record => record.target.closest?.('[data-action-message]')).filter(Boolean));
        messages.forEach(message => {
            if (!visible(message) || !message.textContent.trim()) return;
            // 폼 맨 아래의 메시지가 스크롤 영역 밖에 잘리지 않도록 첫 부분까지 보여 준다.
            for (let parent = message.parentElement; parent; parent = parent.parentElement) {
                if (!/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) continue;
                const rect = message.getBoundingClientRect();
                const bounds = parent.getBoundingClientRect();
                const bottom = Math.min(bounds.bottom, window.innerHeight) - 12;
                const needed = rect.top + Math.min(rect.height, 120);
                if (needed > bottom) parent.scrollTop += needed - bottom;
            }
        });
        if (records.some(record => !record.target.closest?.('.action-feedback'))) reposition();
    }).observe(document.body, {subtree: true, childList: true, attributes: true, attributeFilter: ['class']});
})();
