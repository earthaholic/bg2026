/* 문서 내용은 자바스크립트 없이도 읽을 수 있다. */
(() => {
    'use strict';
    document.documentElement.classList.add('js-ready');
    const input = document.getElementById('manual-search');
    const clear = document.getElementById('manual-search-clear');
    const status = document.getElementById('manual-search-status');
    const chapters = [...document.querySelectorAll('.manual-chapter')];
    const links = [...document.querySelectorAll('.manual-toc a')];
    const hero = document.getElementById('manual-home');
    const empty = document.getElementById('manual-empty');
    const normalize = value => value.toLocaleLowerCase('ko').replace(/\s+/g, ' ').trim();
    const texts = new Map(chapters.map(section => [section.id, normalize(section.textContent)]));
    function search() {
        const words = normalize(input.value).split(' ').filter(Boolean);
        let count = 0;
        chapters.forEach(section => {
            const matches = words.every(word => texts.get(section.id).includes(word));
            section.hidden = !matches;
            if (matches) count += 1;
        });
        hero.hidden = words.length > 0;
        empty.hidden = count > 0;
        clear.hidden = words.length === 0;
        status.textContent = words.length ? `관련 도움말 ${count}개 / 전체 ${chapters.length}개` : '메뉴 이름이나 궁금한 내용을 검색하세요.';
    }
    function locate() {
        let id;
        try { id = decodeURIComponent(location.hash.slice(1)); } catch (_) { return; }
        const target = document.getElementById(id);
        if (!target) return;
        if (input.value) { input.value = ''; search(); }
        links.forEach(link => {
            if (link.hash === location.hash) link.setAttribute('aria-current', 'location');
            else link.removeAttribute('aria-current');
        });
        const detail = target.closest('details');
        if (detail) detail.open = true;
        target.scrollIntoView({ block:'start' });
    }
    input.addEventListener('input', search);
    clear.addEventListener('click', () => { input.value = ''; search(); input.focus(); });
    document.addEventListener('click', event => {
        const link = event.target.closest('a[href^="#"]');
        if (!link) return;
        if (input.value) { input.value = ''; search(); }
        // 현재 주소와 같은 바로가기도 검색 해제 후 정상 이동한다.
        if (link.hash === location.hash) locate();
    });
    window.addEventListener('hashchange', locate);
    const printDetails = new Map();
    window.addEventListener('beforeprint', () => {
        document.querySelectorAll('details').forEach(detail => { printDetails.set(detail, detail.open); detail.open = true; });
    });
    window.addEventListener('afterprint', () => { printDetails.forEach((open, detail) => { detail.open = open; }); printDetails.clear(); });
    document.getElementById('manual-print').addEventListener('click', () => window.print());
    search();
    if (location.hash) locate();
})();
