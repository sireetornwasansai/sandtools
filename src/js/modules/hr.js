import { h } from '../core/dom.js';
import { loadScript } from '../core/dom.js';
import { getSession } from '../core/auth.js';
import { sessionCall } from '../core/ops.js';
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

export async function mount(root) {
  const page = h('div', { class: 'page hr-page' });
  const body = h('div', { class: 'hr-body' });
  page.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'บันทึกการปฏิบัติงาน'), h('p', null, 'ปฏิทินการลา ประชุม อบรม ไปราชการ · รายงานรายเดือน · จัดการเจ้าหน้าที่และวันหยุด'))), body);
  root.append(page);

  const s = getSession();
  if (!s) { body.append(notice('warn', 'ต้องเข้าสู่ระบบก่อน', 'ใช้อีเมลหน่วยงานเพื่อเข้าใช้งานระบบบันทึกการปฏิบัติงาน')); return undefined; }

  const call = (op, args) => sessionCall('hr', op, { args }, op === 'saveData' ? 90000 : 45000);
  body.append(h('div', { class: 'skeleton', style: 'height:60vh', role: 'status', 'aria-label': 'กำลังโหลด' }));
  let boot;
  try { [boot] = await Promise.all([call('boot', []), loadLibs()]); } catch (e) {
    body.replaceChildren(notice('error', 'เปิดระบบบันทึกการปฏิบัติงานไม่ได้', `${errText(e)} — ถ้าเพิ่งติดตั้ง ให้ผู้ดูแลระบบเพิ่มไฟล์ Hr.gs ใน Apps Script, รัน setupHr() แล้ว Deploy เวอร์ชันใหม่`));
    return undefined;
  }
  const me = boot.me || {};

  const host = h('div', { class: 'hr-host' });
  body.replaceChildren(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const syncTheme = () => host.setAttribute('data-theme', document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
  syncTheme(); window.addEventListener('sand:settings', syncTheme);
  const mo = new MutationObserver(syncTheme); mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  shadow.innerHTML = `<link rel="stylesheet" href="css/hr.css"><link rel="stylesheet" href="css/flatpickr.min.css"><div class="hr-root">${HR_HTML}<div id="hrFpHost"></div></div>`;
  // FullCalendar puts its own stylesheet in <head>; copy it into the shadow root so the calendar is styled there too.
  document.head.querySelectorAll('style').forEach((st) => { if (/\.fc[\s{.-]/.test(st.textContent || '') && st.textContent.length > 2000) shadow.append(st.cloneNode(true)); });

  const seed = { getHolidayMap: boot.holidays || {}, getStaffList: boot.staff || [], getDashboard: boot.dashboard, getEvents: boot.events };
  const app = createHrApp(shadow, makeGoogle(call, seed), { print: (panel, title) => printPanel(shadow, panel, title) });

  // role gating — the server enforces it too, this only hides what a person may not use
  const hide = (el, on) => { if (el) el.hidden = on; };
  const g = (id) => shadow.getElementById(id);
  if (!me.admin) { hide(g('nav-staff'), true); hide(g('nav-holidays'), true); hide(g('setupBtn'), true); shadow.querySelectorAll('[data-hr-click^="exportCSV"]').forEach((b) => hide(b, true)); }
  if (!me.dev) { hide(g('nav-dailylog'), true); hide(g('nav-projects'), true); const sec = g('nav-dailylog') && g('nav-dailylog').closest('.sidebar-section'); hide(sec, true); }

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
  return () => { mo.disconnect(); window.removeEventListener('sand:settings', syncTheme); };
}
