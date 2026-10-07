import { h, svgIcon } from '../core/dom.js';
import { ICONS } from '../core/icons.js';
import { TOOLS } from '../core/routes.js';
import { privacyNotice, notice } from '../core/notices.js';
import { recording, recordingNote } from '../core/logger.js';
import { openPalette } from '../core/palette.js';
import { getSession } from '../core/auth.js';
import { backendConfigured } from '../core/api.js';
import { sessionCall, cacheGet, cacheSet } from '../core/ops.js';
import { loadCss } from '../core/css.js';
import { toast } from '../core/toast.js';
import { downloadBlob } from '../core/download.js';
import { fmt, deltaChip, countUp, sparkline, areaChart, donut, hourStrip, hBars, ago, countryName, DEVICE } from '../core/charts.js';
import { mountProjectsPanel } from './projects.js';

/**
 * Home = dashboard. Order of work (fast first):
 *  1. paint the shell + tool tiles immediately (no network)
 *  2. paint the last known numbers from this browser's cache (if any) — or skeletons
 *  3. ask the backend for ONE aggregated answer (projects/overview, cached 60 s server side) and update in place
 * Older Apps Script without the `overview` op still works: KPIs are built from the project list and charts explain what to update.
 */

const RANGES = [[7, '7 วัน'], [30, '30 วัน'], [90, '90 วัน']];
const RANGE_KEY = 'sand:dash:days';
const IC = {
  site: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18"/>',
  pages: '<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>', chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  link: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>'
};
const KIND = { qr: 'QR ติดตามสถิติ', qrs: 'QR เก็บประวัติ', qrx: 'QR เดิม (แนบ)', link: 'ลิงก์ย่อ' };

function greeting(user) {
  const hr = new Date().getHours(); const part = hr < 11 ? 'สวัสดีตอนเช้า' : hr < 13 ? 'สวัสดีตอนเที่ยง' : hr < 17 ? 'สวัสดีตอนบ่าย' : 'สวัสดีตอนเย็น';
  const first = user && (user.name || '').trim().split(/\s+/)[0];
  return first ? `${part} คุณ${first.replace(/^(นางสาว|นาย|นาง|น\.ส\.)/, '')}` : part;
}
const clock = (t) => new Date(t).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });

export async function mount(root) {
  const sess = getSession();
  const logged = backendConfigured() && !!sess;
  await Promise.all([loadCss('dashboard'), ...(logged ? [loadCss('links'), loadCss('projects')] : [])]);

  /* ---------------------------------- hero + tools (no network) ---------------------------------- */
  const today = new Date().toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const hero = h('section', { class: 'dsh-hero' },
    h('div', null, h('p', { class: 'dsh-eyebrow' }, today), h('h1', null, greeting(sess && sess.user)),
      h('p', { class: 'dsh-sub' }, logged ? 'ภาพรวมการใช้งานเว็บไซต์ ลิงก์ย่อ และ QR Code ของหน่วยงาน — ไม่เก็บ IP และไม่ใช้คุกกี้' : 'เครื่องมือดิจิทัลสำหรับงานสำนักงาน — แปลงไฟล์ จัดการ PDF ย่อรูป สร้าง QR ทำงานในเบราว์เซอร์ของคุณ')),
    h('div', { class: 'dsh-hero-actions' },
      h('button', { class: 'btn', type: 'button', onclick: openPalette }, svgIcon(ICONS.search, 18), 'ค้นหาเครื่องมือ'),
      h('a', { class: 'btn btn-primary', href: '#/qr' }, svgIcon(ICONS.qr, 18), 'สร้าง QR Code')));
  const toolStrip = h('nav', { class: 'dsh-tools', 'aria-label': 'เครื่องมือ' }, TOOLS.map((t) =>
    h('a', { class: 'dsh-tool', href: `#${t.path}`, title: t.desc }, svgIcon(t.icon, 22), h('span', null, h('b', null, t.title), h('small', null, t.desc)))));
  const page = h('div', { class: 'page dash' }, hero, toolStrip);
  root.append(page);

  if (!logged) {
    page.append(notice('info', 'เข้าสู่ระบบเพื่อดูแดชบอร์ดสถิติ', backendConfigured() ? 'เมื่อล็อกอินแล้ว หน้านี้จะแสดงสถิติผู้เข้าชมเว็บไซต์ของหน่วยงาน การสแกน QR และการคลิกลิงก์ย่อ' : 'ยังไม่ได้ตั้งค่า Backend (GAS) จึงยังไม่มีแดชบอร์ดสถิติ — เครื่องมือด้านบนใช้งานได้ตามปกติ'),
      privacyNotice({ detail: recording() ? `เครื่องมือทำงานในเบราว์เซอร์ของคุณ · ${recordingNote()}` : 'เครื่องมือทำงานในเบราว์เซอร์ของคุณ ไฟล์ไม่ถูกอัปโหลดไปยังเซิร์ฟเวอร์ใด ๆ' }));
    return () => {};
  }

  /* ----------------------------------------- state ----------------------------------------- */
  const saved = Number(localStorage.getItem(RANGE_KEY));
  const S = { days: RANGES.some(([n]) => n === saved) ? saved : 30, ov: null, legacy: false, err: null, busy: false, at: 0, fromCache: false, shown: {} };
  let seq = 0; let timer = 0; let tick = 0; let panel = null;
  const ckey = (d) => `ov:${d}`;

  /* ---------------------------------------- skeleton bits ---------------------------------------- */
  const sk = (hgt, w = '100%', extra = '') => h('span', { class: 'skeleton', style: `display:block;height:${hgt};width:${w};${extra}` });
  const skelCard = (hgt) => h('div', { class: 'dsh-skel-body', 'aria-hidden': 'true' }, sk(hgt, '100%'));

  /* --------------------------------------------- UI --------------------------------------------- */
  const status = h('span', { class: 'dsh-status', role: 'status', 'aria-live': 'polite' });
  const refreshBtn = h('button', { class: 'btn btn-sm', type: 'button', 'aria-label': 'รีเฟรชข้อมูลแดชบอร์ด', onclick: () => load(true) }, svgIcon(ICONS.rotate, 16), 'รีเฟรช');
  const exportBtn = h('button', { class: 'btn btn-sm', type: 'button', disabled: true, onclick: exportCsv }, svgIcon(ICONS.download, 16), 'ส่งออก CSV');
  const rangeEl = h('div', { class: 'tabs dsh-range', role: 'tablist', 'aria-label': 'ช่วงเวลา' });
  const kpiEl = h('div', { class: 'dsh-kpis', 'aria-busy': 'true' });
  const notes = h('div', { class: 'dsh-notes' });
  const trendBody = h('div', { class: 'dsh-card-body' });
  const topBody = h('div', { class: 'dsh-card-body' });
  const devBody = h('div', { class: 'dsh-card-body' });
  const refBody = h('div', { class: 'dsh-card-body' });
  const ctyBody = h('div', { class: 'dsh-card-body' });
  const hrBody = h('div', { class: 'dsh-card-body' });
  const pageBody = h('div', { class: 'dsh-card-body' });
  const linkBody = h('div', { class: 'dsh-card-body' });
  const card = (title, sub, body, cls = '') => h('section', { class: `dsh-card ${cls}` }, h('header', null, h('h3', null, title), sub ? h('small', null, sub) : null), body);

  const stats = h('section', { class: 'dsh-sec', 'aria-labelledby': 'dsh-t1' },
    h('div', { class: 'dsh-sec-head' },
      h('div', null, h('h2', { id: 'dsh-t1' }, 'ภาพรวมการใช้งาน'), status),
      h('div', { class: 'dsh-sec-tools' }, rangeEl, refreshBtn, exportBtn)),
    notes, kpiEl,
    h('div', { class: 'dsh-grid g-main' }, card('แนวโน้มรายวัน', 'ผู้เข้าชม · การเปิดหน้า · สแกน/คลิกลิงก์', trendBody, 'span-2'), card('โครงการยอดนิยม', 'เรียงตามการเปิดหน้า · กดเพื่อดูรายละเอียด', topBody)),
    h('div', { class: 'dsh-grid g-4' }, card('อุปกรณ์', null, devBody), card('มาจากช่องทางใด', null, refBody), card('ประเทศ', null, ctyBody), card('ช่วงเวลาที่คนเข้า', 'ชั่วโมงของวัน (เวลาไทย)', hrBody)),
    h('div', { class: 'dsh-grid g-2' }, card('หน้ายอดนิยม', 'จากทุกโครงการ', pageBody), card('ลิงก์ย่อและ QR ยอดนิยม', 'ตามจำนวนการสแกน/คลิกในช่วงที่เลือก', linkBody)));

  const prjHost = h('div', { class: 'dsh-prj' });
  const projects = h('section', { class: 'dsh-sec', id: 'dsh-projects', 'aria-labelledby': 'dsh-t2' },
    h('div', { class: 'dsh-sec-head' }, h('div', null, h('h2', { id: 'dsh-t2' }, 'โครงการและเว็บไซต์'), h('p', { class: 'dsh-sub' }, 'แนบเว็บไซต์หรือระบบของหน่วยงาน แล้วดูว่ามีคนเข้าใช้กี่ครั้ง หน้าไหนยอดนิยม และมาจากช่องทางใด'))),
    prjHost);
  page.append(stats, projects, privacyNotice({ detail: 'สถิติไม่ใช้คุกกี้ ไม่เก็บ IP ไม่นับบอท และไม่นับผู้ที่เปิด Do-Not-Track' }));

  /* ------------------------------------------- drawing ------------------------------------------- */
  function drawRange() {
    rangeEl.replaceChildren(...RANGES.map(([n, label]) => h('button', { class: 'tab', type: 'button', role: 'tab', 'aria-selected': String(S.days === n), disabled: S.legacy,
      onclick: () => setDays(n) }, label)));
  }
  function drawStatus() {
    refreshBtn.classList.toggle('is-loading', S.busy); refreshBtn.disabled = S.busy;
    if (S.busy) { status.className = 'dsh-status is-busy'; status.replaceChildren(h('span', { class: 'spinner', 'aria-hidden': 'true' }), S.ov ? 'กำลังอัปเดตข้อมูล…' : 'กำลังโหลดข้อมูล…'); return; }
    if (S.err && !S.ov) { status.className = 'dsh-status is-err'; status.replaceChildren(h('i'), 'โหลดไม่สำเร็จ'); return; }
    if (S.err) { status.className = 'dsh-status is-err'; status.replaceChildren(h('i'), `อัปเดตล่าสุดไม่สำเร็จ · แสดงข้อมูลเมื่อ ${clock(S.at)}`); return; }
    if (S.at) { status.className = 'dsh-status is-ok'; status.replaceChildren(h('i'), `อัปเดต ${ago(S.at)}${S.fromCache ? ' · จากข้อมูลที่จำไว้' : ''}${S.legacy ? ' · 7 วัน' : ` · ย้อนหลัง ${S.days} วัน`}`); return; }
    status.className = 'dsh-status'; status.replaceChildren();
  }

  function kpiItems(o) {
    const sp = (k) => (o.byDay && o.byDay.length ? o.byDay.map((x) => x[k]) : null);
    return [
      { id: 'uv', label: 'ผู้เข้าชม', val: o.uv, prev: o.prevUv, spark: sp('uv'), icon: ICONS.user, sub: S.legacy ? 'ใน 7 วัน · นับรายวัน' : `ใน ${o.days} วัน · นับรายวัน`, tone: 'a' },
      { id: 'pv', label: 'การเปิดหน้า', val: o.pv, prev: o.prevPv, spark: sp('pv'), icon: ICONS.eye, sub: o.avgPages ? `เฉลี่ย ${fmt(o.avgPages)} หน้า/ผู้เข้าชม` : 'ไม่นับบอท', tone: 'b' },
      { id: 'sc', label: 'สแกน QR / คลิกลิงก์', val: o.links.scans, prev: o.links.prevScans, spark: sp('sc'), icon: ICONS.qr, sub: `${fmt((o.links.qr || 0) + (o.links.links || 0))} รายการที่นับสถิติ`, tone: 'c' },
      { id: 'rt', label: 'ออนไลน์ตอนนี้', val: o.realtime, live: true, icon: IC.bolt, sub: 'ผู้เข้าชมใน 5 นาทีล่าสุด', tone: 'd' },
      { id: 'pj', label: 'โครงการ', val: o.projects.total, icon: IC.site, sub: `${fmt(o.projects.tracking)} กำลังเก็บสถิติ`, tone: 'e' },
      { id: 'ql', label: 'QR และลิงก์ที่บันทึก', val: (o.links.qr || 0) + (o.links.qrs || 0) + (o.links.qrx || 0) + (o.links.links || 0), icon: IC.link, sub: `QR ${fmt((o.links.qr || 0) + (o.links.qrs || 0) + (o.links.qrx || 0))} · ลิงก์ย่อ ${fmt(o.links.links || 0)}`, tone: 'f' }
    ];
  }
  function drawKpi() {
    kpiEl.setAttribute('aria-busy', String(!S.ov));
    if (!S.ov) { kpiEl.replaceChildren(...Array.from({ length: 6 }, () => h('div', { class: 'dsh-kpi is-skel', 'aria-hidden': 'true' }, sk('2.75rem', '2.75rem', 'border-radius:12px;flex:none'), h('div', { style: 'flex:1' }, sk('.8rem', '55%'), sk('1.7rem', '40%', 'margin-top:.45rem'), sk('.7rem', '70%', 'margin-top:.45rem'))))); return; }
    const o = S.ov;
    kpiEl.replaceChildren(...kpiItems(o).map((k) => {
      const val = h('b', { class: 'dsh-kpi-val' }, k.val == null ? '–' : '0');
      if (k.val != null) countUp(val, k.val, S.shown[k.id] || 0);
      S.shown[k.id] = k.val == null ? 0 : k.val;
      return h('article', { class: `dsh-kpi tone-${k.tone}`, 'aria-label': `${k.label} ${k.val == null ? 'ยังไม่มีข้อมูล' : fmt(k.val)}` },
        h('span', { class: 'dsh-kpi-ico' }, svgIcon(k.icon, 20)),
        h('div', { class: 'dsh-kpi-main' },
          h('div', { class: 'dsh-kpi-top' }, h('small', null, k.label), k.live ? h('span', { class: 'dsh-live', title: 'กำลังออนไลน์' }, h('i')) : (k.prev !== undefined && !S.legacy ? deltaChip(k.val, k.prev) : null)),
          val, h('div', { class: 'dsh-kpi-foot' }, h('span', { class: 'muted' }, k.sub), k.spark ? sparkline(k.spark) : null)));
    }));
  }

  const emptyCard = (icon, text, action) => h('div', { class: 'empty dsh-empty' }, svgIcon(icon, 26), h('p', null, text), action || null);
  const needUpdate = () => emptyCard(IC.chart, 'ส่วนนี้ต้องใช้ Analytics.gs เวอร์ชันล่าสุด — วางไฟล์ใหม่ใน Apps Script แล้ว Deploy เวอร์ชันใหม่ ก็จะแสดงกราฟและการเปรียบเทียบช่วงเวลา');
  function drawCards() {
    const o = S.ov;
    if (!o) { [trendBody, topBody, devBody, refBody, ctyBody, hrBody, pageBody, linkBody].forEach((b, i) => b.replaceChildren(skelCard(i === 0 ? '250px' : i === 1 ? '250px' : '130px'))); return; }
    if (S.legacy) { [trendBody, devBody, refBody, ctyBody, hrBody, pageBody, linkBody].forEach((b) => b.replaceChildren(needUpdate())); }
    else {
      const any = o.pv > 0 || o.links.scans > 0;
      trendBody.replaceChildren(any ? areaChart(o.byDay, [{ key: 'pv', label: 'การเปิดหน้า', cls: 's1' }, { key: 'uv', label: 'ผู้เข้าชม', cls: 's2' }, { key: 'sc', label: 'สแกน/คลิก', cls: 's3', off: !o.links.scans }], { height: 250, label: 'แนวโน้มรายวัน' })
        : emptyCard(IC.chart, o.projects.total ? 'ยังไม่มีข้อมูลในช่วงนี้ — วางโค้ดติดตามในเว็บไซต์ของโครงการ แล้วเปิดเว็บสักหน้า ข้อมูลจะปรากฏภายใน 1–2 นาที' : 'ยังไม่มีโครงการ — เพิ่มเว็บไซต์หรือระบบที่ต้องการดูสถิติด้านล่าง'));
      devBody.replaceChildren(donut(o.devices, (n) => DEVICE[n] || n, { sub: 'ครั้ง' }));
      refBody.replaceChildren(hBars('', o.referrers, (n) => n || 'เข้าโดยตรง / แอปแชต'));
      ctyBody.replaceChildren(hBars('', o.countries, countryName));
      hrBody.replaceChildren(hourStrip(o.byHour));
      pageBody.replaceChildren(o.pages.length ? h('div', { class: 'lnk-table-wrap' }, h('table', { class: 'lnk-table' }, h('thead', null, h('tr', null, ['หน้า', 'โครงการ', 'เปิดหน้า', 'สัดส่วน'].map((x) => h('th', null, x)))),
        h('tbody', null, o.pages.map((p) => h('tr', null, h('td', { class: 'prj-path', title: p.name }, p.name), h('td', { class: 'dsh-cut', title: p.site }, p.site), h('td', null, fmt(p.n)), h('td', null, `${Math.round((p.n / Math.max(1, o.pv)) * 100)}%`)))))) : emptyCard(IC.pages, 'ยังไม่มีข้อมูลหน้าเว็บ'));
      const L = o.links;
      linkBody.replaceChildren(L.top.length ? h('ul', { class: 'dsh-rank' }, L.top.map((x, i) => h('li', null, h('span', { class: 'rk' }, String(i + 1)), h('span', { class: 'nm' }, h('b', { title: x.title }, x.title), h('small', { class: 'muted' }, KIND[x.kind] || 'ลิงก์')),
        h('span', { class: 'bar' }, h('i', { style: `width:${Math.max(4, Math.round((x.n / Math.max(1, L.top[0].n)) * 100))}%` })), h('b', { class: 'n' }, fmt(x.n)))))
        : emptyCard(IC.link, (L.qr + L.links) ? 'ยังไม่มีคนสแกนหรือคลิกในช่วงนี้' : 'ยังไม่มี QR หรือลิงก์ย่อที่นับสถิติ — สร้างได้ที่เครื่องมือ QR Code และ ลิงก์ย่อ'),
        h('div', { class: 'btn-row dsh-card-actions' }, h('a', { class: 'btn btn-sm', href: '#/qrs' }, 'ประวัติ QR'), h('a', { class: 'btn btn-sm', href: '#/links' }, 'ลิงก์ย่อ')));
    }
    const tp = o.topProjects || [];
    topBody.replaceChildren(tp.length ? h('ul', { class: 'dsh-rank is-click' }, tp.map((x, i) => h('li', null, h('button', { type: 'button', class: 'rowbtn', title: `เปิดรายละเอียด ${x.name}`, onclick: () => panel && panel.open(x.key) },
      h('span', { class: 'rk' }, String(i + 1)), h('span', { class: 'nm' }, h('b', { title: x.name }, x.name), h('small', { class: 'muted' }, `${fmt(x.uv)} ผู้เข้าชม`)),
      h('span', { class: 'bar' }, h('i', { style: `width:${Math.max(4, Math.round((x.pv / Math.max(1, tp[0].pv)) * 100))}%` })), h('b', { class: 'n' }, fmt(x.pv)), S.legacy ? null : deltaChip(x.pv, x.prev)))))
      : emptyCard(IC.site, 'ยังไม่มีข้อมูลโครงการในช่วงนี้'));
  }
  function drawNotes() {
    notes.replaceChildren();
    if (S.legacy) notes.append(notice('warn', 'แสดงตัวเลขสรุป 7 วันเท่านั้น', 'Apps Script ของคุณยังเป็น Analytics.gs เวอร์ชันเก่า (ไม่มีคำสั่ง overview) — อัปเดตไฟล์ Analytics.gs แล้ว Deploy เวอร์ชันใหม่ เพื่อเปิดกราฟแนวโน้ม การเปรียบเทียบช่วงเวลา และตัวเลขที่โหลดเร็วขึ้น'));
    if (S.err && !S.ov) {
      notes.append(h('div', { class: 'notice notice-error', role: 'alert' }, svgIcon(ICONS.alert), h('div', null, h('strong', null, 'โหลดแดชบอร์ดไม่ได้'), h('p', null, S.err.message || 'เกิดข้อผิดพลาด'),
        h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => load(true) }, svgIcon(ICONS.rotate, 16), 'ลองใหม่'),
          S.err.code === 'INVALID_SESSION' ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => location.reload() }, 'เข้าสู่ระบบใหม่') : null))));
    }
    if (S.ov && !S.legacy && S.ov.projects && S.ov.projects.total > 0 && !S.ov.last) notes.append(notice('info', 'ยังไม่มีข้อมูลเข้ามา', 'วางโค้ดติดตามจากหน้ารายละเอียดโครงการ (แท็บ “ติดตั้ง”) ในเว็บไซต์ แล้วเปิดเว็บนั้นสักครั้ง'));
  }
  function drawAll() {
    for (const [name, fn] of [['range', drawRange], ['status', drawStatus], ['notes', drawNotes], ['kpi', drawKpi], ['cards', drawCards]]) {
      try { fn(); } catch (e) { console.error(`dashboard: ${name} failed`, e); if (name === 'cards' || name === 'kpi') { S.ov = null; try { localStorage.removeItem(`sand:c:${ckey(S.days)}`); } catch { /* ignore */ } } }   // bad data → drop the cached copy so the next refresh starts clean
    }
    exportBtn.disabled = !S.ov || S.legacy;
  }

  /* -------------------------------------------- data -------------------------------------------- */
  /** Makes any overview safe to draw: returns null when the shape is not an overview at all (old cache / old backend), otherwise fills every missing field. */
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const arr = (v) => (Array.isArray(v) ? v : []);
  function normalizeOv(d) {
    if (!d || typeof d !== 'object' || !d.projects || typeof d.projects !== 'object') return null;
    const L = d.links && typeof d.links === 'object' ? d.links : {};
    return { ...d, days: num(d.days) || 7, pv: num(d.pv), uv: num(d.uv), avgPages: num(d.avgPages), bots: num(d.bots), last: d.last || '',
      realtime: d.realtime === null || d.realtime === undefined ? null : num(d.realtime),
      projects: { total: num(d.projects.total), tracking: num(d.projects.tracking) },
      byDay: arr(d.byDay), byHour: arr(d.byHour).length === 24 ? d.byHour.map(num) : Array(24).fill(0),
      topProjects: arr(d.topProjects), pages: arr(d.pages), referrers: arr(d.referrers), countries: arr(d.countries), devices: arr(d.devices), browsers: arr(d.browsers),
      links: { ...L, links: num(L.links), qr: num(L.qr), qrs: num(L.qrs), qrx: num(L.qrx), scans: num(L.scans), top: arr(L.top) } };
  }
  /** Overview built from the old per-project list (backends without the `overview` op). */
  function fromList(d) {
    const a = arr(d && d.items); const sum = (k) => a.reduce((x, p) => x + (p[k] || 0), 0);
    return { days: 7, legacy: true, generated: Date.now(), projects: { total: a.length, tracking: a.filter((p) => p.status !== 'paused' && p.track).length }, pv: sum('pv7'), uv: sum('uv7'), prevPv: undefined, prevUv: undefined, avgPages: 0, realtime: null, bots: 0, last: a.some((p) => p.last) ? 'x' : '',
      byDay: [], byHour: Array(24).fill(0), topProjects: a.slice().sort((x, y) => y.pv7 - x.pv7).slice(0, 8).map((p) => ({ key: p.key, name: p.name, pv: p.pv7, prev: undefined, uv: p.uv7 })), pages: [], referrers: [], countries: [], devices: [], browsers: [],
      links: { links: sum('links'), qr: 0, qrs: 0, scans: sum('linkClicks'), prevScans: undefined, top: [] } };
  }
  async function load(force = false) {
    const my = ++seq; const days = S.days;
    if (!S.ov) { const c = cacheGet(ckey(days)); const cd = c && normalizeOv(c.d); if (cd) { S.ov = cd; S.at = c.t; S.fromCache = true; S.legacy = !!cd.legacy; } }
    S.busy = true; S.err = null; drawAll();
    try {
      let d;
      try {
        d = normalizeOv(await sessionCall('projects', 'overview', { days }));
        if (!d) { const bad = new Error('รูปแบบข้อมูลจาก Apps Script ไม่ตรงกับเวอร์ชันล่าสุด'); /** @type {any} */ (bad).code = 'UNKNOWN_ACTION'; throw bad; }   // → fall back to the per-project list
        S.legacy = false;
      } catch (e) {
        if (!e || e.code !== 'UNKNOWN_ACTION') throw e;
        d = normalizeOv(fromList(await sessionCall('projects', 'list'))); S.legacy = true;
      }
      if (my !== seq) return;
      S.ov = d; S.at = Date.now(); S.fromCache = false; if (!S.legacy) cacheSet(ckey(days), d);
    } catch (e) {
      if (my !== seq) return;
      S.err = e;
      if (S.ov && force) toast(`อัปเดตข้อมูลไม่สำเร็จ — ${e.message}`, 'error', 5000);
    } finally { if (my === seq) { S.busy = false; drawAll(); } }
  }
  function setDays(n) {
    if (n === S.days) return;
    S.days = n; try { localStorage.setItem(RANGE_KEY, String(n)); } catch { /* ignore */ }
    const c = cacheGet(ckey(n)); const cd = c && normalizeOv(c.d); S.ov = cd || null; S.shown = {}; if (cd) { S.at = c.t; S.fromCache = true; }
    load();
  }

  function exportCsv() {
    const o = S.ov; if (!o) return;
    const esc = (v) => { let t = String(v ?? ''); if (/^[=+\-@]/.test(t)) t = `'${t}`; return `"${t.replace(/"/g, '""')}"`; };
    const row = (...c) => c.map(esc).join(',');
    const L = [row('รายงานสถิติ SAND Office Tools'), row('ช่วงเวลา', `${o.days} วันล่าสุด`), row('สร้างเมื่อ', new Date().toLocaleString('th-TH')), '',
      row('ตัวชี้วัด', 'ช่วงนี้', 'ช่วงก่อนหน้า'), row('ผู้เข้าชม', o.uv, o.prevUv), row('การเปิดหน้า', o.pv, o.prevPv), row('สแกน QR / คลิกลิงก์', o.links.scans, o.links.prevScans), row('โครงการ', o.projects.total), '',
      row('วันที่', 'เปิดหน้า', 'ผู้เข้าชม', 'สแกน/คลิก'), ...o.byDay.map((d) => row(d.d, d.pv, d.uv, d.sc)), '', row('โครงการ', 'เปิดหน้า', 'ผู้เข้าชม'), ...o.topProjects.map((p) => row(p.name, p.pv, p.uv)), '',
      row('หน้า', 'โครงการ', 'เปิดหน้า'), ...o.pages.map((p) => row(p.name, p.site, p.n)), '', row('ช่องทาง', 'จำนวน'), ...o.referrers.map((r) => row(r.name || 'เข้าโดยตรง', r.n)), '', row('ลิงก์/QR', 'ชนิด', 'สแกน/คลิก'), ...o.links.top.map((x) => row(x.title, KIND[x.kind] || x.kind, x.n))];
    downloadBlob(new Blob([`\ufeff${L.join('\r\n')}`], { type: 'text/csv;charset=utf-8' }), `รายงานสถิติ_${o.days}วัน_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.csv`);
    toast('ส่งออกรายงานแล้ว', 'success');
  }

  /* ------------------------------------------- start ------------------------------------------- */
  drawAll();
  panel = mountProjectsPanel(prjHost);
  load();
  tick = window.setInterval(() => { if (S.at && !S.busy) drawStatus(); }, 30000);                                              // keeps "อัปเดต 2 นาทีที่แล้ว" honest
  timer = window.setInterval(() => { if (!document.hidden && !S.busy && S.at && Date.now() - S.at > 120000) load(); }, 60000);   // quiet refresh while the tab is open
  const onVisible = () => { if (!document.hidden && !S.busy && S.at && Date.now() - S.at > 120000) load(); };
  document.addEventListener('visibilitychange', onVisible);
  return () => { seq += 1; clearInterval(tick); clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); if (panel) panel(); };
}
