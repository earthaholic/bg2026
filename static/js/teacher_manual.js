/* 사진 매뉴얼: 한 번에 한 업무, 검색, 사진 확대, 전체 인쇄. */
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
    const searchOpenedDetails = new Set();
    function hashId() {
        try { return decodeURIComponent(location.hash.slice(1)); } catch (_) { return ''; }
    }
    function currentChapter() {
        const target = document.getElementById(hashId());
        return target?.closest('.manual-chapter') || document.getElementById('quick-start');
    }
    function search() {
        const words = normalize(input.value).split(' ').filter(Boolean);
        const active = currentChapter();
        let count = 0;
        searchOpenedDetails.forEach(detail => { detail.open = false; });
        searchOpenedDetails.clear();
        chapters.forEach(section => {
            const matches = words.length ? words.every(word => texts.get(section.id).includes(word)) : section === active;
            section.hidden = !matches;
            if (matches) count += 1;
            if (matches && words.length) {
                section.querySelectorAll('details').forEach(detail => {
                    if (!detail.open && words.some(word => normalize(detail.textContent).includes(word))) {
                        detail.open = true;
                        searchOpenedDetails.add(detail);
                    }
                });
            }
        });
        hero.hidden = words.length > 0 || active.id !== 'quick-start';
        empty.hidden = count > 0;
        clear.hidden = words.length === 0;
        status.textContent = words.length ? `관련 도움말 ${count}개 / 전체 ${chapters.length}개` : '할 일을 고르거나 궁금한 내용을 검색하세요.';
        links.forEach(link => {
            if (!words.length && link.hash === '#' + active.id) link.setAttribute('aria-current', 'location');
            else link.removeAttribute('aria-current');
        });
    }
    function locate() {
        const target = document.getElementById(hashId());
        input.value = '';
        search();
        if (!target) return;
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
        if (link.hash === location.hash) locate();
    });
    window.addEventListener('hashchange', locate);

    const dialog = document.getElementById('manual-image-dialog');
    const expanded = document.getElementById('manual-image-expanded');
    const canvas = dialog.querySelector('.image-dialog-canvas');
    let imageOpener = null;
    document.querySelectorAll('[data-manual-image]').forEach(link => {
        link.addEventListener('click', event => {
            if (typeof dialog.showModal !== 'function') return;
            event.preventDefault();
            imageOpener = link;
            const image = link.querySelector('img');
            expanded.src = image.src;
            expanded.alt = image.alt;
            document.getElementById('manual-image-title').textContent = link.closest('.visual-step').querySelector('h3').textContent;
            canvas.classList.remove('original-size');
            canvas.scrollTop = 0;
            canvas.scrollLeft = 0;
            dialog.showModal();
            document.getElementById('manual-image-close').focus();
        });
    });
    document.getElementById('manual-image-close').addEventListener('click', () => dialog.close());
    document.getElementById('manual-image-original').addEventListener('click', () => canvas.classList.add('original-size'));
    document.getElementById('manual-image-fit').addEventListener('click', () => canvas.classList.remove('original-size'));
    dialog.addEventListener('close', () => imageOpener?.focus());

    const printDetails = new Map();
    window.addEventListener('beforeprint', () => {
        document.querySelectorAll('.manual-chapter details').forEach(detail => {
            printDetails.set(detail, detail.open);
            detail.open = true;
        });
        document.querySelectorAll('.manual-image img').forEach(image => { image.loading = 'eager'; });
    });
    window.addEventListener('afterprint', () => {
        printDetails.forEach((open, detail) => { detail.open = open; });
        printDetails.clear();
    });
    const printButton = document.getElementById('manual-print');
    printButton.addEventListener('click', async () => {
        printButton.disabled = true;
        printButton.textContent = '사진 준비 중';
        const images = [...document.querySelectorAll('.manual-image img')];
        images.forEach(image => { image.loading = 'eager'; });
        await Promise.allSettled(images.map(image => image.decode()));
        printButton.disabled = false;
        printButton.textContent = '전체 인쇄';
        window.print();
    });
    search();
    if (location.hash) locate();
})();
