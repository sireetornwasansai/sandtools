import { h } from '../core/dom.js';
import { loadScript } from '../core/dom.js';
import { getSession } from '../core/auth.js';
import { sessionCall, cacheGet, cacheSet } from '../core/ops.js';
import { notice } from '../core/notices.js';
import { runHandler } from './hr-engine.js';
import { HR_HTML } from './hr-html.js';
import { createHrApp } from './hr-legacy.js';

/**
 * ระบบบันทึกการปฏิบัติงาน (HR) — calendar of leave / meetings / training / official trips, per-month report, staff + holiday management, personal daily log + projects.
 * Backend: gas/Hr.gs (action "hr").  The page is the original stand-alone app, rendered in a Shadow DOM root (css/hr.css) so it cannot clash with SAND's styles.
 */
// the locale files need their library to be loaded first
const loadLibs = () => Promise.all([
  loadScript('js/vendor/hr/fullcalendar.global.min.js').then(() => loadScript('js/vendor/hr/fullcalendar-th.global.min.js')),
  loadScript('js/vendor/hr/flatpickr.min.js').then(() => loadScript('js/vendor/hr/flatpickr-th.js'))
]);
const errText = (e) => (e && e.message) || 'ทำรายการไม่สำเร็จ';

/** `google.script.run` look-alike: .withSuccessHandler(f).withFailureHandler(g).<method>(...args) → backend action "hr", op = method name. */
function makeGoogle(call, seed) {
  const runner = () => {
    let ok = () => {}; let bad = () => {};
    const r = new Proxy({}, { get(_, name) {
      if (name === 'withSuccessHandler') return (f) => { ok = f; return r; };
      if (name === 'withFailureHandler') return (f) => { bad = f; return r; };
      if (typeof name !== 'string') return undefined;
      return (...args) => {
        if (Object.prototype.hasOwnProperty.call(seed, name)) { const v = seed[name]; delete seed[name]; Promise.resolve().then(() => ok(v)); return; }   // first answers come with boot()
        call(name, args).then((v) => ok(v), (e) => bad(e));
      };
    } });
    return r;
  };
  return { script: { get run() { return runner(); } } };
}

/** Print only the open panel: copy it with the stylesheet into a hidden frame (the page's own CSS cannot reach into a shadow root). */
function printPanel(shadow, panel, title) {
  if (!panel) return;
  const css = [...shadow.querySelectorAll('style')].map((s) => s.textContent).join('\n');
  const frame = h('iframe', { style: 'position:fixed;right:0;bottom:0;width:0;height:0;border:0', 'aria-hidden': 'true', tabindex: '-1' });
  const link = shadow.querySelector('link[href$="hr.css"]');
  frame.srcdoc = `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${(title || 'HR').replace(/[<&]/g, '')}</title>` +
    (link ? `<link rel="stylesheet" href="${link.href}">` : '') + `<style>${css}\nbody{background:#fff;overflow:visible}.panel{display:block!important;position:static!important;overflow:visible!important}.btn-topbar,button,.report-controls,.hol-toolbar{display:none!important}</style></head><body class="hr-root"><div class="hr-print">${panel.outerHTML}</div></body></html>`;
  frame.addEventListener('load', () => { setTimeout(() => { try { frame.contentWindow.focus(); frame.contentWindow.print(); } finally { setTimeout(() => frame.remove(), 60000); } }, 400); });
  document.body.append(frame);
}

const CACHE_KEY = 'hr:boot';
const CACHE_MAX_AGE = 3 * 86400000;      // a cached copy older than 3 days is not shown
const FRESH_MS = 20000;                  // cached copy younger than this → no background refresh needed (e.g. quickly switching pages)
// answers of these calls keep the cached boot copy up to date, so the next visit paints the newest data instantly
const CACHE_FIELD = { getEvents: 'events', getDashboard: 'dashboard', getStaffList: 'staff', getHolidayMap: 'holidays' };
const patchCache = (field, value) => { const c = cacheGet(CACHE_KEY, CACHE_MAX_AGE); if (c && c.d) cacheSet(CACHE_KEY, { ...c.d, [field]: value }); };

export async function mount(root) {
  const page = h('div', { class: 'page hr-page' });
  const body = h('div', { class: 'hr-body' });
  page.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'บันทึกการปฏิบัติงาน'), h('p', null, 'ปฏิทินการลา ประชุม อบรม ไปราชการ · รายงานรายเดือน · จัดการเจ้าหน้าที่และวันหยุด'))), body);
  root.append(page);

  // hand SAND's design tokens to the shadow root (custom properties resolve here, where SAND's :root / dark theme apply)
  ['bg','surface','surface-2','surface-3','border','border-strong','text','text-2','muted','primary','primary-hover','primary-soft','primary-contrast','primary-ring','focus','success','success-bg','warning','warning-bg','error','error-bg','info','info-bg','radius-sm','radius','radius-lg','shadow-xs','shadow','shadow-md','shadow-lg','font']
    .forEach((k) => body.style.setProperty('--sand-' + k, `var(--${k})`));
  const s = getSession();
  if (!s) { body.append(notice('warn', 'ต้องเข้าสู่ระบบก่อน', 'ใช้อีเมลหน่วยงานเพื่อเข้าใช้งานระบบบันทึกการปฏิบัติงาน')); return undefined; }

  // use the full width of the page while this screen is open (SAND pads .main by ~2.5rem on each side)
  const mainEl = root.classList && root.classList.contains('main') ? root : (root.closest && root.closest('.main'));
  const oldPad = mainEl ? mainEl.style.paddingInline : '';
  if (mainEl) mainEl.style.paddingInline = 'clamp(.5rem, 1.2vw, 1.25rem)';

  const call = async (op, args) => {
    const v = await sessionCall('hr', op, { args }, op === 'saveData' ? 90000 : 45000);
    if (CACHE_FIELD[op]) patchCache(CACHE_FIELD[op], v);
    else if (op === 'getAll' && v) { const c = cacheGet(CACHE_KEY, CACHE_MAX_AGE); if (c && c.d) cacheSet(CACHE_KEY, { ...c.d, dashboard: v.dashboard, events: v.events }); }
    return v;
  };

  // 1) start everything at once: the libraries (served by the service worker after the first visit) and the data
  const libsP = loadLibs();
  const cached = cacheGet(CACHE_KEY, CACHE_MAX_AGE);
  const needFresh = !cached || Date.now() - cached.t > FRESH_MS;
  const freshP = needFresh ? call('boot', []).then((b) => { cacheSet(CACHE_KEY, b); return b; }) : null;
  if (freshP) freshP.catch(() => {});    // handled below; avoids an "unhandled rejection" when the page is closed meanwhile

  body.append(h('div', { class: 'skeleton', style: 'height:60vh', role: 'status', 'aria-label': 'กำลังโหลด' }));
  let boot = cached ? cached.d : null;
  try {
    if (boot) await libsP;                                  // cached data → only the (cached) scripts are awaited
    else { [boot] = await Promise.all([freshP, libsP]); }   // first ever visit → wait for the server once
  } catch (e) {
    body.replaceChildren(notice('error', 'เปิดระบบบันทึกการปฏิบัติงานไม่ได้', `${errText(e)} — ถ้าเพิ่งติดตั้ง ให้ผู้ดูแลระบบเพิ่มไฟล์ Hr.gs ใน Apps Script, รัน setupHr() แล้ว Deploy เวอร์ชันใหม่`));
    if (mainEl) mainEl.style.paddingInline = oldPad;
    return undefined;
  }
  const showingCache = !!cached;

  const host = h('div', { class: 'hr-host' });
  body.replaceChildren(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const syncTheme = () => host.setAttribute('data-theme', document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
  syncTheme(); window.addEventListener('sand:settings', syncTheme);
  const mo = new MutationObserver(syncTheme); mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  // hide the unstyled page until hr.css arrives (no flash of raw HTML); a timer makes sure it is never left hidden
  host.style.visibility = 'hidden';
  const reveal = () => { host.style.visibility = ''; };
  shadow.innerHTML = `<link rel="stylesheet" href="css/hr.css"><link rel="stylesheet" href="css/flatpickr.min.css"><div class="hr-root">${HR_HTML}<div id="hrFpHost"></div></div>`;
  const cssLink = shadow.querySelector('link[href$="hr.css"]');
  if (cssLink) { cssLink.addEventListener('load', reveal); cssLink.addEventListener('error', reveal); }
  const revealTimer = setTimeout(reveal, 1500);
  // FullCalendar puts its own stylesheet in <head>; copy it into the shadow root so the calendar is styled there too.
  document.head.querySelectorAll('style').forEach((st) => { if (/\.fc[\s{.-]/.test(st.textContent || '') && st.textContent.length > 2000) shadow.append(st.cloneNode(true)); });

  const seed = { getHolidayMap: boot.holidays || {}, getStaffList: boot.staff || [], getAll: { dashboard: boot.dashboard, events: boot.events || [] } };   // first answers come from boot() — no extra round trips
  const app = createHrApp(shadow, makeGoogle(call, seed), { print: (panel, title) => printPanel(shadow, panel, title) });

  // role gating — the server enforces it too, this only hides what a person may not use
  const hide = (el, on) => { if (el) el.hidden = on; };
  const g = (id) => shadow.getElementById(id);
  const gate = (me) => {
    me = me || {};
    const admin = !!me.admin; const dev = !!me.dev;
    hide(g('nav-staff'), !admin); hide(g('nav-holidays'), !admin); hide(g('setupBtn'), !admin);
    shadow.querySelectorAll('[data-hr-click^="exportCSV"]').forEach((b) => hide(b, !admin));
    const sec = g('nav-dailylog') && g('nav-dailylog').closest('.sidebar-section');
    hide(g('nav-dailylog'), !dev); hide(g('nav-projects'), !dev); hide(sec, !dev);
  };
  gate(boot.me);
  g('loadingScreen')?.remove();   // the page is already painted from real data — the second "loading" overlay only added a delay

  // delegated "inline" handlers (the CSP forbids onclick="…")
  const onError = (e) => console.warn('hr handler', e);
  for (const type of ['click', 'change', 'input']) {
    shadow.addEventListener(type, (ev) => {
      const attr = `data-hr-${type}`;
      let el = ev.target instanceof Element ? ev.target : null;
      while (el && el !== host) {
        const src = el.getAttribute && el.getAttribute(attr);
        if (src) runHandler(src, app.handlers, { event: ev, el }, onError);
        if (ev.cancelBubble) break;
        el = el.parentNode instanceof ShadowRoot ? null : el.parentNode;
      }
    });
  }
  try { app.init(); } catch (e) { console.error(e); body.prepend(notice('error', 'เปิดหน้าไม่สมบูรณ์', errText(e))); }

  // 2) the screen is up — bring it up to date in the background when it was painted from the cached copy
  let alive = true;
  if (showingCache && freshP) {
    freshP.then((fresh) => {
      if (!alive || !fresh) return;
      if (JSON.stringify(fresh) !== JSON.stringify(boot)) { try { gate(fresh.me); app.hydrate(fresh); } catch (e) { console.warn('hr refresh', e); } }
    }, (e) => { if (alive) body.prepend(notice('warn', 'แสดงข้อมูลที่บันทึกไว้ในเครื่อง', `${errText(e)} — เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองกด 🔄 ภายหลัง`)); });
  }
  return () => { alive = false; clearTimeout(revealTimer); mo.disconnect(); window.removeEventListener('sand:settings', syncTheme); if (mainEl) mainEl.style.paddingInline = oldPad; };
}
