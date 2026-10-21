/**
 * Mobile shell (≤ 860 px — the desktop sidebar is hidden there).
 *
 * Why this file exists: on a phone the sidebar disappears and the old bottom bar only listed Home + the six public tools,
 * so สารบรรณ, หนังสือรับเข้า, HR, ลงลา, ลิงก์ย่อ, ประวัติ QR, โครงการ, คลังข้อมูล … could not be opened at all (only through the search button).
 *
 *  - buildBottomNav()  : 4 shortcuts + a "เมนู" button that opens a bottom sheet with EVERY page (grouped, searchable, big touch targets)
 *  - sync(routeId)     : keeps the highlighted item right (the "เมนู" button lights up when the open page is not one of the 4 shortcuts)
 *  - initMobileHelpers : hides the bottom bar while the on-screen keyboard is up · keeps the selected tab of a scrolling tab bar in view
 *
 * No innerHTML with data — everything is built with h()/svgIcon() like the rest of the app.
 */
import { h, svgIcon } from './dom.js';

const GRID = '<rect x="3.5" y="3.5" width="7" height="7" rx="1.8"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.8"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.8"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.8"/>';
const CLOSE = '<path d="M6 6l12 12M18 6L6 18"/>';
const SEARCH = '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>';

/** Short labels for the bottom bar (titles such as "ลงลา (มือถือ)" are too long for one fifth of a phone screen). */
const SHORT = { leave: 'ลงลา', converter: 'แปลงไฟล์', saraban: 'สารบรรณ', home: 'หน้าแรก', qr: 'QR Code' };
const label = (r) => SHORT[r.id] || r.title;

/**
 * @param {{ primary: any[], sections: {title:string, routes:any[]}[], extra?: () => Node|null }} cfg
 * @returns {{ nav: HTMLElement, sheet: HTMLElement, sync: (id:string)=>void, close: ()=>void }}
 */
export function buildBottomNav(cfg) {
  const primaryIds = new Set(cfg.primary.map((r) => r.id));
  let isOpen = false;
  let opener = /** @type {HTMLElement|null} */ (null);

  const link = (r, cls) => h('a', { class: cls, href: `#${r.path}`, dataset: { route: r.id } }, svgIcon(r.icon), h('span', { class: 'nav-label' }, label(r)));

  const moreBtn = h('button', { class: 'bn-link bn-more', type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-label': 'เมนูทั้งหมด',
    onclick: () => (isOpen ? close() : open()) }, svgIcon(GRID), h('span', { class: 'nav-label' }, 'เมนู'));
  const nav = h('nav', { class: 'bottomnav', 'aria-label': 'เมนูหลัก (มือถือ)' }, ...cfg.primary.map((r) => link(r, 'bn-link')), moreBtn);

  /* ------------------------------- the sheet ------------------------------- */
  const search = h('input', { type: 'search', class: 'ms-search', placeholder: 'ค้นหาเมนู…', autocomplete: 'off', 'aria-label': 'ค้นหาเมนู', enterkeyhint: 'search' });
  const closeBtn = h('button', { class: 'icon-btn ms-close', type: 'button', 'aria-label': 'ปิดเมนู', onclick: () => close() }, svgIcon(CLOSE));
  const body = h('div', { class: 'ms-body' });
  const empty = h('p', { class: 'ms-empty muted', hidden: true }, 'ไม่พบเมนูที่ตรงกับคำค้นหา');
  const grab = h('div', { class: 'ms-grab', 'aria-hidden': 'true' }, h('i'));
  const sheet = h('div', { class: 'ms', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'เมนูทั้งหมด', tabindex: '-1' },
    grab,
    h('div', { class: 'ms-head' }, h('div', { class: 'ms-searchbox' }, svgIcon(SEARCH, 18), search), closeBtn),
    body);
  const wrap = h('div', { class: 'ms-wrap', hidden: true, onclick: (e) => { if (e.target === wrap) close(); } }, sheet);

  /** @type {{el:HTMLElement, hay:string}[]} */
  let items = [];
  /** @type {{box:HTMLElement, tiles:HTMLElement[]}[]} */
  let groups = [];
  function fill() {
    body.replaceChildren(); items = []; groups = [];
    for (const sec of cfg.sections) {
      if (!sec.routes.length) continue;
      const tiles = sec.routes.map((r) => {
        const a = h('a', { class: 'ms-item', href: `#${r.path}`, dataset: { route: r.id }, onclick: () => close(false) },
          h('span', { class: 'ms-ic' }, svgIcon(r.icon, 24)), h('span', { class: 'ms-label' }, label(r)));
        items.push({ el: a, hay: `${r.title} ${r.fullTitle || ''} ${r.id} ${r.keywords || ''}`.toLowerCase() });
        return a;
      });
      const box = h('section', { class: 'ms-sec' }, h('h2', { class: 'ms-title' }, sec.title), h('div', { class: 'ms-grid' }, tiles));
      groups.push({ box, tiles }); body.append(box);
    }
    const x = cfg.extra && cfg.extra(); if (x) body.append(x);
    body.append(empty);
  }
  function filter() {
    const q = search.value.trim().toLowerCase(); let any = false;
    items.forEach((it) => { const ok = !q || it.hay.includes(q); it.el.hidden = !ok; if (ok) any = true; });
    groups.forEach((g) => { g.box.hidden = g.tiles.every((t) => t.hidden); });
    empty.hidden = any;
  }
  search.addEventListener('input', filter);

  function open() {
    if (isOpen) return; isOpen = true; opener = /** @type {HTMLElement|null} */ (document.activeElement);
    fill(); search.value = ''; wrap.hidden = false; document.body.classList.add('ms-open'); moreBtn.setAttribute('aria-expanded', 'true');
    sheet.scrollTop = 0; body.scrollTop = 0; sync(currentId);
    sheet.focus({ preventScroll: true });             // not the search box: focusing it would pop the keyboard up straight away
  }
  function close(restore = true) {
    if (!isOpen) return; isOpen = false; wrap.hidden = true; document.body.classList.remove('ms-open'); moreBtn.setAttribute('aria-expanded', 'false');
    if (restore && opener && opener.focus) opener.focus();
  }
  document.addEventListener('keydown', (e) => { if (isOpen && e.key === 'Escape') { e.preventDefault(); close(); } });
  window.addEventListener('hashchange', () => close(false));

  /* swipe the header down to dismiss */
  let y0 = 0; let dy = 0; let drag = false;
  [grab, sheet.children[1]].forEach((el) => {
    el.addEventListener('touchstart', (e) => { y0 = e.touches[0].clientY; dy = 0; drag = true; }, { passive: true });
    el.addEventListener('touchmove', (e) => { if (!drag) return; dy = Math.max(0, e.touches[0].clientY - y0); sheet.style.transform = `translateY(${dy}px)`; }, { passive: true });
    el.addEventListener('touchend', () => { if (!drag) return; drag = false; sheet.style.transform = ''; if (dy > 70) close(); dy = 0; });
  });

  let currentId = '';
  function sync(id) {
    currentId = id || currentId;
    if (primaryIds.has(currentId) || currentId === 'home') moreBtn.removeAttribute('aria-current'); else moreBtn.setAttribute('aria-current', 'page');
    wrap.querySelectorAll('[data-route]').forEach((el) => { if (/** @type {HTMLElement} */ (el).dataset.route === currentId) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current'); });
  }

  return { nav, sheet: wrap, sync, close: () => close(false) };
}

/**
 * Small behaviours that make forms and tab bars comfortable on a phone.
 * @param {HTMLElement} main the scrolling <main>
 */
export function initMobileHelpers(main) {
  /* 1) On-screen keyboard: the bottom bar would sit on top of it (Android) and steal a third of the visible height → hide it while a text field has focus. */
  const typing = (el) => el instanceof HTMLElement && (el.matches('textarea, select') || (el.matches('input') && !/^(checkbox|radio|button|submit|reset|file|range|color|image)$/i.test(/** @type {HTMLInputElement} */ (el).type)));
  let t = 0;
  document.addEventListener('focusin', (e) => { clearTimeout(t); if (typing(e.target)) document.body.classList.add('kb'); });
  document.addEventListener('focusout', () => { clearTimeout(t); t = window.setTimeout(() => { if (!typing(document.activeElement)) document.body.classList.remove('kb'); }, 120); });

  /* 2) A horizontally scrolling tab bar (สารบรรณ has 9 tabs): when a tab becomes selected, scroll it to the middle so it is never off-screen. */
  const reveal = (el) => {
    const p = el.parentElement; if (!p || p.scrollWidth <= p.clientWidth + 2) return;
    const er = el.getBoundingClientRect(); const pr = p.getBoundingClientRect();
    p.scrollTo({ left: p.scrollLeft + (er.left - pr.left) - (pr.width - er.width) / 2, behavior: 'smooth' });
  };
  new MutationObserver((list) => {
    for (const m of list) { const el = /** @type {HTMLElement} */ (m.target); if (el.getAttribute && el.getAttribute('aria-selected') === 'true' && el.matches('[role="tab"]')) reveal(el); }
  }).observe(main, { subtree: true, attributes: true, attributeFilter: ['aria-selected'] });
  /* tabs that are already selected when the page opens (e.g. #/saraban?tab=register) */
  new MutationObserver(() => { const el = main.querySelector('[role="tab"][aria-selected="true"]'); if (el) requestAnimationFrame(() => reveal(/** @type {HTMLElement} */ (el))); })
    .observe(main, { childList: true });
}
