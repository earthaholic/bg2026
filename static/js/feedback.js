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

    // 입력 결과는 놓치지 않도록 화면 가운데에서 크게 알린다. 성공은 잠깐 뒤 스스로 닫히고,
    // 확인이 필요한 경고·오류는 사용자가 확인을 눌러야 닫힌다.
    let centeredState = null;
    const CENTERED_TYPES = new Set(['success', 'warning', 'error']);
    const ICON_CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20 6.5 9.2 17.3l-5.2-5.2" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const ICON_ALERT = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 7.6v6.1" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><circle cx="12" cy="17.4" r="1.45" fill="currentColor"/></svg>';

    function closeCenteredFeedback() {
        if (centeredState) centeredState.close();
    }

    function showCenteredFeedback(type, message) {
        closeCenteredFeedback();
        // 화면 전체를 가리는 충은 dialog가 직접 그리고, 카드는 그 안에서 가운데 정렬한다.
        const panel = document.createElement('dialog');
        panel.className = 'action-feedback-overlay';
        panel.setAttribute('role', 'alertdialog');
        panel.setAttribute('aria-label', type === 'success' ? '입력 결과' : '확인 필요');
        const card = document.createElement('div');
        card.className = `action-feedback-card action-feedback-${type}`;
        const icon = document.createElement('div');
        icon.className = 'action-feedback-icon';
        icon.innerHTML = type === 'success' ? ICON_CHECK : ICON_ALERT;
        const text = document.createElement('div');
        text.className = 'action-feedback-text';
        text.textContent = String(message ?? '');
        card.append(icon, text);
        panel.append(card);

        const autoClose = type === 'success';
        let timer = null;
        const state = {
            panel,
            close() {
                if (timer !== null) { clearTimeout(timer); timer = null; }
                document.removeEventListener('keydown', onKey, true);
                if (panel.open) panel.close();
                panel.remove();
                if (centeredState === state) centeredState = null;
            }
        };

        function schedule(delay) {
            if (timer !== null) clearTimeout(timer);
            timer = setTimeout(() => state.close(), delay);
        }
        // 성공 안내는 아무 키나 눌러도 바로 닫는다. 경고·오류는 Esc만 허용한다.
        function onKey(event) {
            if (!autoClose && event.key !== 'Escape') return;
            if (autoClose && ['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return;
            event.preventDefault();
            state.close();
        }

        if (autoClose) {
            const hint = document.createElement('p');
            hint.className = 'action-feedback-hint';
            hint.textContent = '잠시 뒤 자동으로 닫힙니다';
            card.append(hint);
            // 어디를 눌러도 바로 닫히며, 마우스 위치와 관계없이 시간이 지나면 닫힌다.
            panel.addEventListener('click', () => state.close());
        } else {
            const actions = document.createElement('div');
            actions.className = 'action-feedback-actions';
            const accept = document.createElement('button');
            accept.type = 'button';
            accept.className = 'btn btn-primary';
            accept.textContent = '확인';
            accept.addEventListener('click', () => state.close());
            actions.append(accept);
            card.append(actions);
            // 창 바깥(배경)을 눌러도 닫는다.
            panel.addEventListener('click', event => { if (event.target === panel) state.close(); });
        }

        panel.addEventListener('close', () => state.close());
        document.body.append(panel);
        try { panel.showModal(); } catch (error) { panel.setAttribute('open', ''); }
        document.addEventListener('keydown', onKey, true);
        if (autoClose) {
            const length = String(message ?? '').length;
            schedule(Math.min(2400, Math.max(1500, 1200 + length * 30)));
        } else {
            card.querySelector('button')?.focus();
        }
        centeredState = state;
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
                const kind = type === 'danger' ? 'error' : type;
                if (CENTERED_TYPES.has(kind)) {
                    // 진행 안내 등 이 버튼에 붙어 있던 이전 메시지는 닫는다.
                    activePanel?.close(false);
                    showCenteredFeedback(kind, message);
                    return;
                }
                closeCenteredFeedback();
                mount(kind, message);
            },
            confirm(message) {
                closeCenteredFeedback();
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
