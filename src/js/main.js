import './core/polyfills.js';
import { h, svgIcon } from './core/dom.js';
import { initTheme } from './core/theme.js';
import { ICONS } from './core/icons.js';
import { config, APP_NAME } from './core/config.js';
import { getSettings, setSettings, addRecent } from './core/store.js';
import { recording } from './core/logger.js';
import { TOOLS, LIBRARY_ROUTE, LINKS_ROUTE, PROJECTS_ROUTE, HISTORY_ROUTE, HOME_ROUTE, SETTINGS_ROUTE, parseHash, findRoute, navigate } from './core/routes.js';
import { openPalette } from './core/palette.js';
import { backendConfigured } from './core/api.js';
import { loginRequired, validateSession, renderLogin, currentUser, signOut } from './core/auth.js';
import { setPendingFile, routeForFile } from './core/handoff.js';
import { toast } from './core/toast.js';

const app = document.getElementById('app');
let main;
let unmountCurrent = null;
let routeToken = 0;
const bar = h('div', { id: 'route-bar', 'aria-hidden': 'true' });
let barTimer = 0;
const barStart = () => { clearTimeout(barTimer); bar.className = 'run'; };
const barEnd = () => { bar.className = 'end'; barTimer = window.setTimeout(() => { bar.className = ''; }, 400); };
const skeleton = () => h('div', { class: 'page', role: 'status', 'aria-label': 'กำลังโหลด' },
  h('div', { class: 'skeleton', style: 'height:2rem;width:40%;margin-bottom:.75rem' }), h('div', { class: 'skeleton', style: 'height:1rem;width:62%;margin-bottom:1.5rem' }),
  h('div', { class: 'tool-grid' }, [1, 2, 3].map(() => h('div', { class: 'skeleton', style: 'height:120px' }))));

function wordmark() {
  return h('a', { class: 'wordmark', href: '#/', 'aria-label': `${APP_NAME} — หน้าแรก` },
    h('span', { class: 'wm-sand' }, 'SAND'), h('span', { class: 'wm-sub' }, 'Office Tools'));
}

function navLink(r, cls = 'nav-link') {
  return h('a', { class: cls, href: `#${r.path}`, dataset: { route: r.id } }, svgIcon(r.icon), h('span', { class: 'nav-label' }, r.title));
}

function buildShell() {
  const settings = getSettings();
  const user = currentUser();
  const themeBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'สลับโหมดมืด/สว่าง', title: 'สลับโหมดมืด/สว่าง',
    onclick: () => setSettings({ theme: document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark' }) }, svgIcon(ICONS.moon));
  const syncThemeIcon = () => { themeBtn.replaceChildren(svgIcon(document.documentElement.getAttribute('data-theme') === 'dark' ? ICONS.sun : ICONS.moon)); };
  window.addEventListener('sand:settings', syncThemeIcon); syncThemeIcon();

  const collapseBtn = h('button', { class: 'nav-link collapse-btn', type: 'button', 'aria-label': 'ย่อ/ขยายเมนู', 'aria-expanded': String(!settings.sidebarCollapsed),
    onclick: () => {
      const next = !getSettings().sidebarCollapsed;
      setSettings({ sidebarCollapsed: next });
      shell.dataset.collapsed = String(next);
      collapseBtn.setAttribute('aria-expanded', String(!next));
    } }, svgIcon(ICONS.chevronLeft), h('span', { class: 'nav-label' }, 'ย่อเมนู'));

  const userBox = user
    ? h('div', { class: 'user-box' }, h('span', { class: 'user-name', title: user.email }, user.name || user.email),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'ออกจากระบบ', title: 'ออกจากระบบ', onclick: () => { signOut(); location.reload(); } }, svgIcon(ICONS.logout)))
    : h('span', { class: 'badge', role: 'img', 'aria-label': 'ใช้งานในเครื่อง ไม่ได้ล็อกอิน', title: 'ไม่ได้ล็อกอิน — ข้อมูลทั้งหมดอยู่ในเบราว์เซอร์เครื่องนี้เท่านั้น' }, svgIcon(ICONS.user, 16), h('span', { class: 'badge-text' }, 'ใช้งานในเครื่อง'));

  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  const searchBtn = h('button', { class: 'search-btn', type: 'button', onclick: openPalette, 'aria-label': 'ค้นหาเครื่องมือ (Ctrl+K)' },
    svgIcon(ICONS.search, 18), h('span', { class: 'search-text' }, 'ค้นหาเครื่องมือ…'), h('kbd', null, isMac ? '⌘K' : 'Ctrl K'));

  const shell = h('div', { class: 'shell', dataset: { collapsed: String(settings.sidebarCollapsed) } },
    h('header', { class: 'topbar' }, wordmark(), searchBtn, h('div', { class: 'spacer' }), themeBtn,
      h('a', { class: 'icon-btn', href: `#${SETTINGS_ROUTE.path}`, 'aria-label': 'ตั้งค่า', title: 'ตั้งค่า' }, svgIcon(ICONS.settings)), userBox),
    h('nav', { class: 'sidebar', 'aria-label': 'เมนูหลัก' },
      h('div', { class: 'nav-group' }, navLink(HOME_ROUTE), h('div', { class: 'nav-title' }, 'เครื่องมือ'), ...TOOLS.map((t) => navLink(t)),
        ...((backendConfigured() && user) || recording() ? [h('div', { class: 'nav-title' }, 'ข้อมูลของฉัน')] : []),
        ...(backendConfigured() && user ? [navLink(LIBRARY_ROUTE), navLink(LINKS_ROUTE), navLink(PROJECTS_ROUTE)] : []), ...(recording() ? [navLink(HISTORY_ROUTE)] : [])),
      h('div', { class: 'nav-group nav-bottom' }, navLink(SETTINGS_ROUTE), collapseBtn)),
    (main = h('main', { id: 'main', class: 'main', tabindex: '-1' })),
    h('nav', { class: 'bottomnav', 'aria-label': 'เมนูหลัก (มือถือ)', style: `grid-template-columns:repeat(${TOOLS.length + 1},1fr)` }, navLink(HOME_ROUTE, 'bn-link'), ...TOOLS.map((t) => navLink(t, 'bn-link'))));
  app.replaceChildren(shell, bar);
  return shell;
}

function setActive(id) {
  document.querySelectorAll('[data-route]').forEach((el) => {
    if (/** @type {HTMLElement} */ (el).dataset.route === id) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
  });
}

async function route() {
  const token = ++routeToken;
  const { path, params } = parseHash();
  const r = findRoute(path) || HOME_ROUTE;
  if (unmountCurrent) { try { await unmountCurrent(); } catch { /* ignore */ } unmountCurrent = null; }
  setActive(r.id);
  document.title = r.id === 'home' ? `${APP_NAME} — เครื่องมือดิจิทัลสำหรับงานสำนักงาน` : `${r.fullTitle} · ${APP_NAME}`;
  barStart();
  main.replaceChildren(skeleton());
  try {
    const mod = await r.load();
    if (token !== routeToken) return;
    main.replaceChildren();
    if (TOOLS.includes(r)) addRecent({ kind: 'tool', id: r.id, label: r.title, path: r.path });
    const un = await mod.mount(main, { params, navigate });
    if (token !== routeToken) { if (typeof un === 'function') un(); return; }
    unmountCurrent = typeof un === 'function' ? un : null;
    barEnd();
    main.focus({ preventScroll: true });
    main.scrollTop = 0; window.scrollTo(0, 0);
  } catch (e) {
    console.error(e); barEnd();
    main.replaceChildren(h('div', { class: 'notice notice-error', role: 'alert' }, svgIcon(ICONS.alert),
      h('div', null, h('strong', null, 'ไม่สามารถเปิดหน้านี้ได้'), h('p', null, 'กรุณาลองโหลดหน้าใหม่ หากยังพบปัญหาให้แจ้งผู้ดูแลระบบ'),
        h('button', { class: 'btn', type: 'button', onclick: () => location.reload() }, 'โหลดหน้าใหม่'))));
  }
}

function installGlobalHandlers() {
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod || e.key.toLowerCase() !== 'k') return;
    const inEditor = e.target instanceof HTMLElement && e.target.closest('[data-owns-ctrl-k]');
    if (inEditor && !e.shiftKey) return; // Markdown editor uses Ctrl+K for "insert link"
    e.preventDefault(); openPalette();
  });

  // Global drag & drop routing: a dropped file opens in the right tool.
  let depth = 0;
  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  window.addEventListener('dragenter', (e) => { if (hasFiles(e)) { depth += 1; document.body.classList.add('dragging'); } });
  window.addEventListener('dragleave', (e) => { if (hasFiles(e)) { depth = Math.max(0, depth - 1); if (!depth) document.body.classList.remove('dragging'); } });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    depth = 0; document.body.classList.remove('dragging');
    if (!hasFiles(e)) return;
    e.preventDefault();
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;
    const dest = routeForFile(file.name);
    if (!dest) { toast('ไม่รองรับไฟล์ประเภทนี้', 'error'); return; }
    setPendingFile(file); navigate(dest);
    if (parseHash().path === dest) route(); // same route: re-mount so it picks the file up
  });
  window.addEventListener('hashchange', route);
}

async function boot() {
  initTheme();
  if (loginRequired()) {
    const ok = await validateSession();
    if (!ok) await renderLogin(app);
  }
  buildShell();
  installGlobalHandlers();
  await route();
  if ('serviceWorker' in navigator && location.protocol !== 'file:' && config.version !== 'dev') {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline mode unavailable */ });
  }
}
boot();
