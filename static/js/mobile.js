/* 모바일 화면 지원: 사이드바를 밀어서 여는 서랍으로 전환한다.
   - 상단 바에 메뉴 버튼을 만들어 넣고(마크업 수정 없이), 배경을 눌러 닫는다.
   - 메뉴를 선택하면 자동으로 닫히고, 좁은 화면을 벗어나면 원래 레이아웃으로 돌아간다.
*/
(function () {
    'use strict';

    var MOBILE_QUERY = '(max-width: 900px)';
    var OPEN_CLASS = 'mobile-nav-open';
    var media = window.matchMedia(MOBILE_QUERY);
    var toggle = null;
    var backdrop = null;
    var sidebar = null;

    function isOpen() {
        return document.body.classList.contains(OPEN_CLASS);
    }

    function setInert() {
        if (!sidebar) return;
        var hide = media.matches && !isOpen();
        if (hide) {
            sidebar.setAttribute('inert', '');
            sidebar.setAttribute('aria-hidden', 'true');
        } else {
            sidebar.removeAttribute('inert');
            sidebar.removeAttribute('aria-hidden');
        }
    }

    function open() {
        if (!ensure()) return;
        document.body.classList.add(OPEN_CLASS);
        if (toggle) toggle.setAttribute('aria-expanded', 'true');
        setInert();
        var first = sidebar.querySelector('.menu-nav-item');
        if (first && first.focus) first.focus({ preventScroll: true });
    }

    function close(restoreFocus) {
        if (!isOpen()) {
            setInert();
            return;
        }
        document.body.classList.remove(OPEN_CLASS);
        if (toggle) {
            toggle.setAttribute('aria-expanded', 'false');
            if (restoreFocus) toggle.focus({ preventScroll: true });
        }
        setInert();
    }

    function ensure() {
        sidebar = document.querySelector('.sidebar');
        var navbar = document.querySelector('.navbar');
        if (!sidebar || !navbar) return false;

        if (!backdrop) {
            backdrop = document.createElement('div');
            backdrop.className = 'mobile-nav-backdrop';
            backdrop.setAttribute('aria-hidden', 'true');
            document.body.appendChild(backdrop);
            backdrop.addEventListener('click', function () { close(true); });
        }

        if (!toggle) {
            toggle = document.querySelector('.nav-mobile-toggle');
        }

        if (!toggle) {
            toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'nav-mobile-toggle';
            toggle.setAttribute('aria-label', '메뉴 열기');
            toggle.setAttribute('aria-expanded', 'false');
            toggle.setAttribute('aria-controls', 'sidebar-main-menu');
            toggle.innerHTML = '<i class="fa-solid fa-bars" aria-hidden="true"></i>';
            navbar.insertBefore(toggle, navbar.firstChild);
        }

        if (toggle && !toggle.dataset.mobileBound) {
            toggle.dataset.mobileBound = '1';
            toggle.addEventListener('click', function () {
                if (isOpen()) close(true); else open();
            });
        }

        if (!sidebar.dataset.mobileBound) {
            sidebar.dataset.mobileBound = '1';
            sidebar.addEventListener('click', function (event) {
                if (event.target.closest('.menu-nav-item')) close();
            });
        }

        setInert();
        return true;
    }

    document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && isOpen()) close(true);
    });

    /* 가로로 넘겨야 하는 표에만 오른쪽 페이드 힌트를 켠다. */
    var hintTimer = null;

    function markScrollableTables() {
        if (!media.matches) return;
        document.querySelectorAll('.table-card').forEach(function (card) {
            var box = card.querySelector('.table-responsive');
            if (!box) {
                card.classList.remove('is-h-scrollable', 'is-h-scroll-end');
                return;
            }
            var more = box.scrollWidth - box.clientWidth > 4;
            card.classList.toggle('is-h-scrollable', more);
            var atEnd = box.scrollLeft + box.clientWidth >= box.scrollWidth - 4;
            card.classList.toggle('is-h-scroll-end', atEnd);
            if (!box.dataset.hintBound) {
                box.dataset.hintBound = '1';
                box.addEventListener('scroll', function () {
                    card.classList.toggle(
                        'is-h-scroll-end',
                        box.scrollLeft + box.clientWidth >= box.scrollWidth - 4
                    );
                }, { passive: true });
            }
        });
    }

    function scheduleTableHint() {
        window.clearTimeout(hintTimer);
        hintTimer = window.setTimeout(markScrollableTables, 150);
    }

    var workspace = document.querySelector('.workspace');
    if (workspace && window.MutationObserver) {
        new MutationObserver(scheduleTableHint).observe(workspace, {
            childList: true,
            subtree: true
        });
    }

    window.addEventListener('resize', scheduleTableHint);
    window.addEventListener('load', scheduleTableHint);
    document.addEventListener('click', scheduleTableHint, true);
    scheduleTableHint();

    media.addEventListener('change', function (event) {
        if (!event.matches) close();
        setInert();
        scheduleTableHint();
    });

    window.addEventListener('resize', ensure);

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', ensure);
    } else {
        ensure();
    }
})();
