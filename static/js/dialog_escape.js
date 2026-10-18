/* Esc는 화면 맨 위 대화상자 하나만 닫는다. 기존 닫기/취소 보호를 우회하지 않는다. */
function handleDialogEscape(event) {
    if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
    const dialogs = Array.from(document.querySelectorAll('.modal-backdrop:not(.hidden), dialog[open]'))
        .filter(dialog => {
            const style = getComputedStyle(dialog);
            return !dialog.hidden && style.display !== 'none' && style.visibility !== 'hidden' && dialog.getClientRects().length;
        });
    if (!dialogs.length) return;
    // 길게 누른 Esc로 뒤쪽 창까지 연속으로 닫히지 않게 한다.
    if (event.repeat) { event.preventDefault(); return; }

    // showModal() 창은 브라우저의 최상위 계층 순서와 기본 cancel 이벤트를 사용한다.
    // 납입 관리의 미저장 확인 및 보완 저장 중 닫기 차단도 그대로 실행된다.
    if (dialogs.some(dialog => dialog.tagName === 'DIALOG' && dialog.matches(':modal'))) return;

    const top = dialogs.map((dialog, index) => ({ dialog, index, z: Number.parseFloat(getComputedStyle(dialog).zIndex) || 0 }))
        .sort((a, b) => a.z - b.z || a.index - b.index).pop().dialog;
    event.preventDefault();
    event.stopPropagation();
    if (top.tagName === 'DIALOG') {
        if (typeof top.requestClose === 'function') top.requestClose();
        else if (top.dispatchEvent(new Event('cancel', { cancelable: true })) && top.open) top.close();
        return;
    }
    // 로그인처럼 원래 닫을 수 없는 창에는 임의의 숨김 동작을 추가하지 않는다.
    const closeButton = top.querySelector('.modal-header .btn-close');
    if (closeButton && !closeButton.disabled && closeButton.getAttribute('aria-disabled') !== 'true') closeButton.click();
}

document.addEventListener('keydown', handleDialogEscape);
