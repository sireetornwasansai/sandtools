import { h, field, svgIcon, debounce } from '../core/dom.js';
import { ICONS } from '../core/icons.js';
import { getSession } from '../core/auth.js';
import { sessionCall, cacheGet, cacheSet } from '../core/ops.js';
import { notice } from '../core/notices.js';
import { toast } from '../core/toast.js';
import { copyText, downloadBlob } from '../core/download.js';
import { addLayer, modal, confirmBox, closeAllLayers } from '../core/layers.js';
import { showQr } from '../core/qrdialog.js';
import { loadCss } from '../core/css.js';
import { fmt, hostOf, when, ago, barChart, areaChart, hBars, dayLabel, countryName, DEVICE } from '../core/charts.js';

/* ------------------------------- helpers ------------------------------- */

const I = {
  site: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>', close: '<path d="M6 6l12 12M18 6L6 18"/>', copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 012-2h9"/>',
  link: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>', user: ICONS.user, eye: ICONS.eye,
  qr: ICONS.qr, code: '<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M14 5l-4 14"/>'
};
const call = (action, op, params = {}, timeout = 60000) => sessionCall(action, op, params, timeout);

const shortUrl = (base, code) => `${String(base || location.origin).replace(/\/+$/, '')}/s/${code}`;
async function copy(text, msg = 'คัดลอกแล้ว') { if (await copyText(text)) toast(msg, 'success'); else toast('คัดลอกไม่ได้ — เลือกข้อความแล้วกด Ctrl+C', 'error'); }
const stateOf = (p) => (p.status === 'paused' || !p.track ? ['off', 'หยุดเก็บสถิติ'] : !p.last ? ['wait', 'รอข้อมูลแรก'] : ['on', 'กำลังเก็บสถิติ']);

/* ---------------------------------- page ---------------------------------- */

/** The dedicated "โครงการ" page (also embedded on the home dashboard through mountProjectsPanel). */
export async function mount(root) {
  await Promise.all([loadCss('links'), loadCss('projects')]);
  const host = h('div');
  root.append(h('div', { class: 'page' }, h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'โครงการและสถิติเว็บไซต์'),
    h('p', null, 'แนบเว็บไซต์หรือระบบของหน่วยงาน แล้วดูว่ามีคนเข้าใช้กี่ครั้ง หน้าไหนยอดนิยม และมาจากช่องทางใด — ไม่ใช้คุกกี้ ไม่เก็บ IP')), h('a', { class: 'btn', href: '#/' }, svgIcon(ICONS.home, 18), 'ดูแดชบอร์ดหน้าแรก')), host));
  return mountProjectsPanel(host, { kpi: true });
}

/**
 * The projects panel (search · cards · create · detail drawer), embedded in the home dashboard.
 * @param {HTMLElement} host where to draw · @param {{kpi?: boolean, onData?: (items: any[]) => void}} [opts]
 * @returns {(() => void) & {open: (key: string, tab?: string) => void}}
 */
export function mountProjectsPanel(host, opts = {}) {
  const sess = getSession();
  const addBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => createDialog() }, svgIcon(ICONS.plus, 18), 'เพิ่มโครงการ');
  if (!sess) { host.append(notice('warn', 'ต้องเข้าสู่ระบบก่อน', 'ระบบโครงการใช้ได้เฉพาะผู้ที่ล็อกอินแล้ว')); return Object.assign(() => {}, { open: () => {} }); }
  const st = { items: [], base: '', admin: false, q: '', loaded: false };
  const me = ((sess.user && sess.user.email) || '').toLowerCase();
  let seq = 0; let closeDrawer = null; let pollTimer = null;
  const kpi = h('div', { class: 'lnk-kpis' });
  const search = h('input', { type: 'search', placeholder: 'ค้นหาโครงการหรือโดเมน…', 'aria-label': 'ค้นหาโครงการ' });
  search.addEventListener('input', debounce(() => { st.q = search.value.trim().toLowerCase(); draw(); }, 150));
  const refreshBtn = h('button', { class: 'btn', type: 'button', onclick: () => load(true) }, svgIcon(ICONS.rotate, 18), 'รีเฟรช');
  const grid = h('div', { class: 'prj-grid' });
  host.append(...(opts.kpi ? [kpi] : []), h('div', { class: 'hist-tools prj-tools' }, search, refreshBtn, addBtn), grid);

  async function load(skeleton = true) {
    const my = ++seq;
    const apply = (d) => { st.items = d.items; st.base = d.base || ''; st.admin = d.admin; st.loaded = true; draw(); if (opts.onData) opts.onData(st.items); };
    const cached = skeleton && !st.loaded ? cacheGet('prj:list') : null;
    if (cached) apply(cached.d);   // last known list first, refreshed below
    else if (skeleton && !st.loaded) grid.replaceChildren(...[1, 2, 3].map(() => h('div', { class: 'skeleton', style: 'height:170px' })));
    refreshBtn.classList.add('is-loading');
    try { const d = await call('projects', 'list'); if (my !== seq) return; cacheSet('prj:list', d); apply(d); } catch (e) {
      if (my !== seq) return;
      if (st.loaded) { toast(`อัปเดตรายการโครงการไม่สำเร็จ — ${e.message}`, 'error', 5000); return; }
      grid.replaceChildren(...[notice('error', 'โหลดโครงการไม่ได้', e.code === 'UNKNOWN_ACTION' ? 'ฝั่ง Apps Script ยังไม่มีไฟล์ Analytics.gs หรือยังไม่ได้ Deploy เวอร์ชันใหม่' : e.message), e.code === 'INVALID_SESSION' ? h('button', { class: 'btn btn-primary', type: 'button', onclick: () => location.reload() }, 'เข้าสู่ระบบใหม่') : null].filter(Boolean));
    } finally { if (my === seq) refreshBtn.classList.remove('is-loading'); }
  }

  function draw() {
    if (!st.loaded) return;
    const a = st.items; const sum = (k) => a.reduce((x, p) => x + (p[k] || 0), 0);
    const card = (label, value, sub, icon) => h('div', { class: 'lnk-kpi' }, h('span', { class: 'lnk-kpi-ico' }, svgIcon(icon, 20)), h('div', null, h('small', null, label), h('b', null, value), sub ? h('span', { class: 'muted' }, sub) : null));
    kpi.replaceChildren(card('โครงการทั้งหมด', fmt(a.length), `${fmt(a.filter((p) => stateOf(p)[0] === 'on').length)} กำลังเก็บสถิติ`, I.site), card('ผู้เข้าชม 7 วัน', fmt(sum('uv7')), 'นับรายวัน ไม่นับบอท', I.user),
      card('การเปิดหน้า 7 วัน', fmt(sum('pv7')), null, I.eye), card('คลิกลิงก์ย่อ', fmt(sum('linkClicks')), `จาก ${fmt(sum('links'))} ลิงก์ที่แนบ`, I.link));
    const shown = a.filter((p) => !st.q || `${p.name} ${p.url} ${p.domains.join(' ')} ${p.note} ${p.tags.join(' ')} ${p.owner}`.toLowerCase().includes(st.q));
    if (!shown.length) {
      grid.replaceChildren(h('div', { class: 'empty prj-empty' }, svgIcon(I.site, 28), h('p', null, a.length ? 'ไม่พบโครงการที่ตรงกับคำค้น' : 'ยังไม่มีโครงการ — เพิ่มเว็บไซต์หรือระบบที่ต้องการดูสถิติ แล้วนำโค้ดสั้น ๆ ไปวางในเว็บนั้น'),
        a.length ? null : h('button', { class: 'btn btn-primary', type: 'button', onclick: () => createDialog() }, svgIcon(ICONS.plus, 18), 'เพิ่มโครงการแรก')));
      return;
    }
    grid.replaceChildren(...shown.map(projectCard));
  }

  function projectCard(p) {
    const [cls, label] = stateOf(p);
    return h('button', { class: 'prj-card', type: 'button', onclick: () => openDrawer(p, 'overview') },
      h('span', { class: 'prj-head' }, h('span', { class: 'hist-ico' }, svgIcon(I.site, 20)), h('span', { class: 'hist-main' }, h('b', { title: p.name }, p.name), h('small', { class: 'muted' }, p.domains[0] || 'ยังไม่ระบุเว็บไซต์')),
        h('span', { class: `pill prj-state prj-${cls}` }, label)),
      h('span', { class: 'prj-nums' }, h('span', null, h('b', null, fmt(p.uv7)), h('small', null, 'ผู้เข้าชม 7 วัน')), h('span', null, h('b', null, fmt(p.pv7)), h('small', null, 'เปิดหน้า')), h('span', null, h('b', null, fmt(p.linkClicks)), h('small', null, `คลิก ${fmt(p.links)} ลิงก์`))),
      h('span', { class: 'prj-foot muted' }, p.last ? `ข้อมูลล่าสุด ${ago(p.last)}` : 'ยังไม่มีข้อมูล', st.admin && p.owner !== me ? ` · ${p.owner.split('@')[0]}` : ''));
  }

  /* ---- create ---- */
  function createDialog() {
    const name = h('input', { type: 'text', maxlength: 120, placeholder: 'เช่น ระบบนัดหมายผู้ป่วยนอก' }); const url = h('input', { type: 'text', inputmode: 'url', placeholder: 'https://… (ไม่บังคับ)' });
    const dom = h('input', { type: 'text', placeholder: 'เช่น app.example.go.th, www.example.go.th' }); const note = h('input', { type: 'text', maxlength: 300, placeholder: 'บันทึกช่วยจำ (ไม่บังคับ)' });
    let mm = null;
    const go = h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
      if (!name.value.trim()) { name.focus(); toast('ใส่ชื่อโครงการก่อน', 'error'); return; }
      go.disabled = true;
      try {
        const d = await call('projects', 'create', { name: name.value.trim(), url: url.value.trim(), domains: dom.value.trim(), note: note.value.trim(), track: true });
        st.base = d.base || st.base; mm.close(); toast('สร้างโครงการแล้ว — นำโค้ดติดตั้งไปวางในเว็บไซต์', 'success', 5000); await load(false); openDrawer(d.site, 'install');
      } catch (e) { toast(e.message, 'error', 6000); go.disabled = false; }
    } }, 'สร้างโครงการ');
    mm = modal('เพิ่มโครงการ / เว็บไซต์', [field('ชื่อโครงการ', name).root, field('ที่อยู่เว็บไซต์', url, 'ใช้กำหนดโดเมนที่อนุญาตให้ส่งสถิติ').root, field('โดเมนเพิ่มเติม', dom, 'ถ้าเว็บมีหลายโดเมน คั่นด้วย comma (โดเมนย่อยรวมให้อัตโนมัติ)').root, field('หมายเหตุ', note).root],
      [go, h('button', { class: 'btn', type: 'button', onclick: () => mm.close() }, 'ยกเลิก')], { wide: true });
    name.focus();
  }

  /* ---- drawer ---- */
  function stopPoll() { if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; } }
  function openDrawer(site, tab = 'overview') {
    if (closeDrawer) closeDrawer();
    const S = { site, tab, days: 30, stats: null, links: null };
    const title = h('h2', null, site.name); const tabsEl = h('div', { class: 'tabs prj-tabs', role: 'tablist', 'aria-label': 'ส่วนของโครงการ' });
    const body = h('div', { class: 'lnk-body' });
    const aside = h('aside', { class: 'drawer lnk-drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'รายละเอียดโครงการ' },
      h('div', { class: 'drawer-head' }, title, h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'ปิด', onclick: () => closeDrawer && closeDrawer() }, svgIcon(I.close))), tabsEl, body);
    closeDrawer = addLayer(h('div', { class: 'drawer-wrap' }, aside), { onClose: () => { closeDrawer = null; stopPoll(); } });
    const skel = () => body.replaceChildren(h('div', { class: 'skeleton', style: 'height:220px' }));
    const TABS = [['overview', 'ภาพรวม'], ['install', 'ติดตั้ง'], ['links', 'ลิงก์ย่อ'], ['settings', 'ตั้งค่า']];
    function setTab(t) { stopPoll(); S.tab = t; tabsEl.replaceChildren(...TABS.map(([k, label]) => h('button', { class: 'tab', type: 'button', role: 'tab', 'aria-selected': String(k === t), onclick: () => setTab(k) }, label))); title.textContent = S.site.name; ({ overview, install: installTab, links: linksTab, settings: settingsTab })[t](); }

    /* overview */
    async function overview(days = S.days) {
      S.days = days; skel();
      try { S.stats = await call('projects', 'stats', { key: S.site.key, days }); } catch (e) { body.replaceChildren(notice('error', 'โหลดสถิติไม่ได้', e.message), h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: () => overview(days) }, svgIcon(ICONS.rotate, 16), 'ลองใหม่'))); return; }
      if (S.tab !== 'overview') return;
      const d = S.stats; const empty = !d.lastAny;
      const range = h('div', { class: 'tabs lnk-range', role: 'tablist', 'aria-label': 'ช่วงเวลา' }, [[7, '7 วัน'], [30, '30 วัน'], [90, '90 วัน'], [365, '1 ปี']].map(([n, label]) => h('button', { class: 'tab', type: 'button', role: 'tab', 'aria-selected': String(d.days === n), onclick: () => overview(n) }, label)));
      const stat = (label, value, sub) => h('div', { class: 'lnk-stat' }, h('small', null, label), h('b', null, typeof value === 'number' ? fmt(value) : value), sub ? h('span', { class: 'muted' }, sub) : null);
      const pages = d.pages.length ? h('div', { class: 'lnk-table-wrap' }, h('table', { class: 'lnk-table' }, h('thead', null, h('tr', null, ['หน้า', 'เปิดหน้า', 'ผู้เข้าชม'].map((x) => h('th', null, x)))),
        h('tbody', null, d.pages.map((p) => h('tr', null, h('td', { class: 'prj-path', title: p.name }, p.name), h('td', null, fmt(p.n)), h('td', null, fmt(p.u))))))) : h('p', { class: 'muted' }, 'ยังไม่มีข้อมูล');
      body.replaceChildren(...[
        h('div', { class: 'prj-meta' }, S.site.url ? h('a', { href: S.site.url, target: '_blank', rel: 'noopener noreferrer' }, S.site.url) : h('span', { class: 'muted' }, 'ยังไม่ระบุเว็บไซต์'),
          h('span', { class: `pill prj-state prj-${stateOf({ ...S.site, last: d.last ? 1 : 0 })[0]}` }, stateOf({ ...S.site, last: d.last ? 1 : 0 })[1]), h('span', { class: 'prj-live', title: 'ผู้เข้าชมใน 5 นาทีล่าสุด' }, h('i'), `ออนไลน์ ${fmt(d.realtime)}`)),
        h('div', { class: 'btn-row lnk-actions' }, h('button', { class: 'btn btn-sm', type: 'button', onclick: () => exportCsv(d) }, svgIcon(ICONS.download, 16), 'ส่งออก CSV'), h('button', { class: 'btn btn-sm', type: 'button', onclick: () => setTab('install') }, svgIcon(I.code, 16), 'โค้ดติดตั้ง')),
        empty ? notice('info', 'ยังไม่มีข้อมูลเข้ามา', 'นำโค้ดจากแท็บ "ติดตั้ง" ไปวางในเว็บไซต์ แล้วเปิดเว็บนั้นสักครั้ง ข้อมูลจะปรากฏที่นี่ภายใน 1–2 นาที') : null,
        h('div', { class: 'lnk-stats' }, stat('การเปิดหน้า', d.pv, `ใน ${d.days} วัน`), stat('ผู้เข้าชม', d.uv, 'นับรายวัน ไม่ซ้ำกันในแต่ละวัน'), stat('หน้าต่อผู้เข้าชม', d.avgPages), stat('เหตุการณ์ที่กำหนดเอง', d.events), stat('บอทที่ไม่นับ', d.bots)),
        range,
        h('section', { class: 'lnk-sec' }, h('h3', null, 'การเปิดหน้าและผู้เข้าชมต่อวัน'), areaChart(d.byDay, [{ key: 'pv', label: 'เปิดหน้า', cls: 's1' }, { key: 'uv', label: 'ผู้เข้าชม', cls: 's2' }], { height: 210, label: 'สถิติต่อวัน' })),
        h('section', { class: 'lnk-sec' }, h('h3', null, 'หน้ายอดนิยม'), pages),
        h('div', { class: 'lnk-breaks' }, hBars('มาจาก', d.referrers, (n) => n || 'เข้าโดยตรง / แอปแชต'), hBars('ประเทศ', d.countries, countryName), hBars('อุปกรณ์', d.devices, (n) => DEVICE[n] || n),
          hBars('เบราว์เซอร์/แอป', d.browsers, (n) => n || 'ไม่ทราบ'), hBars('ระบบปฏิบัติการ', d.systems, (n) => n || 'ไม่ทราบ'), d.utms.length ? hBars('แคมเปญ (utm_source)', d.utms, (n) => n) : null, d.eventNames.length ? hBars('เหตุการณ์ที่กำหนดเอง', d.eventNames, (n) => n) : null),
        h('section', { class: 'lnk-sec' }, h('h3', null, 'ช่วงเวลาที่คนเข้า (ชั่วโมงของวัน)'), barChart(d.byHour.map((n, i) => ({ n, label: `${String(i).padStart(2, '0')}:00` })), 'การเปิดหน้าตามชั่วโมง')),
        h('dl', { class: 'meta' }, h('dt', null, 'ข้อมูลแรก'), h('dd', null, d.first ? when(d.first) : '-'), h('dt', null, 'ข้อมูลล่าสุด'), h('dd', null, d.last ? when(d.last) : '-'), h('dt', null, 'สร้างเมื่อ'), h('dd', null, S.site.created), st.admin ? h('dt', null, 'เจ้าของ') : null, st.admin ? h('dd', null, S.site.owner) : null),
        d.scanned ? h('p', { class: 'hint' }, 'สถิติคำนวณจากข้อมูลล่าสุด 80,000 รายการ') : null].filter(Boolean));
    }
    function exportCsv(d) {
      const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const lines = [`${esc('โครงการ')},${esc(S.site.name)}`, `${esc('ช่วง')},${esc(`${d.days} วัน`)}`, '', ['วันที่', 'เปิดหน้า', 'ผู้เข้าชม'].map(esc).join(',')];
      d.byDay.forEach((p) => lines.push([p.d, p.pv, p.uv].map(esc).join(',')));
      lines.push('', ['หน้า', 'เปิดหน้า', 'ผู้เข้าชม'].map(esc).join(',')); d.pages.forEach((p) => lines.push([p.name, p.n, p.u].map(esc).join(',')));
      lines.push('', ['มาจาก', 'จำนวน'].map(esc).join(',')); d.referrers.forEach((r) => lines.push([r.name || 'เข้าโดยตรง', r.n].map(esc).join(',')));
      downloadBlob(new Blob([`\ufeff${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' }), `สถิติเว็บไซต์_${S.site.key}_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.csv`); toast('ส่งออกแล้ว', 'success');
    }

    /* install */
    function installTab() {
      const origin = String(st.base || location.origin).replace(/\/+$/, ''); const key = S.site.key;
      const script = `<script defer src="${origin}/t.js" data-site="${key}"></script>`;
      const pixel = `<img src="${origin}/api/collect?k=${key}&p=/" width="1" height="1" alt="" style="position:absolute;opacity:0;pointer-events:none">`;
      const codeBox = (text, label) => h('div', { class: 'prj-code' }, h('pre', null, h('code', null, text)), h('button', { class: 'btn btn-sm', type: 'button', onclick: () => copy(text, `คัดลอก${label}แล้ว`) }, svgIcon(I.copy, 16), 'คัดลอก'));
      const status = h('div', { class: 'prj-verify-state', 'aria-live': 'polite' }, h('span', { class: 'muted' }, 'ยังไม่ได้ตรวจสอบ'));
      const verifyBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => verify() }, svgIcon(ICONS.check, 18), 'ตรวจสอบการติดตั้ง');
      async function verify() {
        stopPoll(); verifyBtn.disabled = true; const t0 = Date.now(); let n = 0;
        status.replaceChildren(h('span', { class: 'prj-live' }, h('i'), 'กำลังรอข้อมูล… เปิดเว็บไซต์ของคุณสักหน้าหนึ่ง (รอได้ถึง 3 นาที)'));
        const tick = async () => {
          if (S.tab !== 'install') return;
          try { const d = await call('projects', 'stats', { key: S.site.key, days: 7 }); if (d.lastAny && new Date(d.lastAny).getTime() >= t0 - 1000) { verifyBtn.disabled = false; status.replaceChildren(h('span', { class: 'status-ok' }, `✓ ได้รับข้อมูลแล้ว (${when(d.lastAny)}) — การติดตั้งสมบูรณ์`)); S.site.last = Date.now(); return; } } catch (e) { status.replaceChildren(h('span', { class: 'status-err' }, e.message)); verifyBtn.disabled = false; return; }
          if (++n > 36) { verifyBtn.disabled = false; status.replaceChildren(h('span', { class: 'status-err' }, 'ยังไม่ได้รับข้อมูล — ตรวจสอบว่าวางโค้ดแล้ว โดเมนตรงกับที่ระบุในแท็บ ตั้งค่า และเบราว์เซอร์ไม่ได้เปิด Do-Not-Track')); return; }
          pollTimer = setTimeout(tick, 5000);
        };
        pollTimer = setTimeout(tick, 2500);
      }
      body.replaceChildren(
        h('p', null, 'วางโค้ดนี้ในทุกหน้าของเว็บไซต์ (ก่อนปิดแท็ก ', h('code', null, '</head>'), ' หรือ ', h('code', null, '</body>'), ') ตัวติดตามมีขนาดไม่ถึง 2 KB และรองรับเว็บแบบ SPA'),
        codeBox(script, 'โค้ด'),
        h('div', { class: 'prj-verify' }, verifyBtn, status),
        notice('info', `โดเมนที่อนุญาต: ${S.site.domains.length ? S.site.domains.join(', ') : 'ยังไม่ได้ระบุ'}`, 'สถิติจากโดเมนอื่นจะถูกปฏิเสธ — เพิ่มโดเมนได้ในแท็บ "ตั้งค่า"'),
        h('details', { class: 'prj-det' }, h('summary', null, 'วางโค้ดอย่างไร (ตามชนิดเว็บไซต์)'),
          h('ul', null, h('li', null, h('b', null, 'เว็บ HTML ทั่วไป / ระบบที่พัฒนาเอง: '), 'วางในไฟล์เทมเพลตหลักที่ทุกหน้าใช้ร่วมกัน (header/layout)'),
            h('li', null, h('b', null, 'WordPress: '), 'ปลั๊กอิน “Insert Headers and Footers” หรือไฟล์ header.php ของธีม'),
            h('li', null, h('b', null, 'Google Sites: '), 'ไม่รองรับสคริปต์ตรง ๆ — ใช้โค้ดภาพ 1×1 (ด้านล่าง) ผ่านเมนู แทรก → ฝังโค้ด (นับเฉพาะหน้าที่ฝัง)'),
            h('li', null, h('b', null, 'ระบบที่ตั้งนโยบาย CSP: '), `ต้องอนุญาต script-src และ connect-src สำหรับ ${origin}`))),
        h('details', { class: 'prj-det' }, h('summary', null, 'ทางเลือก: ภาพ 1×1 (ใช้เมื่อวางสคริปต์ไม่ได้)'), h('p', { class: 'hint' }, 'นับการเปิดหน้าที่ฝังภาพนี้ได้อย่างเดียว ไม่รองรับ SPA และเหตุการณ์'), codeBox(pixel, 'โค้ดภาพ')),
        h('details', { class: 'prj-det' }, h('summary', null, 'นับเหตุการณ์ที่กำหนดเอง (เช่น กดดาวน์โหลด)'), codeBox("<button onclick=\"sandTrack('ดาวน์โหลดแบบฟอร์ม')\">ดาวน์โหลด</button>", 'ตัวอย่าง'), h('p', { class: 'hint' }, 'หรือเรียก sandTrack("ชื่อเหตุการณ์") จากสคริปต์ของคุณ')),
        h('section', { class: 'prj-privacy' }, h('h3', null, 'ความเป็นส่วนตัวของผู้เข้าชม (PDPA)'),
          h('ul', null, h('li', null, 'ไม่ใช้คุกกี้ ไม่เก็บ IP ไม่เก็บ query string และไม่ใช้พิกเซลของบุคคลที่สาม'), h('li', null, 'ใช้รหัสแบบแฮชทางเดียวที่เปลี่ยนทุกวัน จึงติดตามตัวบุคคลข้ามวันหรือข้ามเว็บไม่ได้'),
            h('li', null, 'ไม่นับผู้ที่เปิด Do-Not-Track/Global Privacy Control และไม่นับบอท'), h('li', null, 'ข้อมูลเก่ากว่า 400 วันถูกลบอัตโนมัติ'), h('li', null, 'ควรระบุการเก็บสถิติไว้ในนโยบายความเป็นส่วนตัวของเว็บไซต์'))));
    }

    /* links */
    async function linksTab() {
      skel();
      let d; try { d = await call('links', 'list'); } catch (e) { body.replaceChildren(notice('error', 'โหลดลิงก์ไม่ได้', e.message)); return; }
      if (S.tab !== 'links') return;
      const mine = d.items.filter((l) => l.project === S.site.key); const base = d.base || st.base;
      const clicks = mine.reduce((a, l) => a + l.clicks, 0);
      const newBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => newLink(base) }, svgIcon(I.link, 18), 'สร้างลิงก์ย่อสำหรับโครงการนี้');
      body.replaceChildren(
        h('p', { class: 'muted' }, 'ลิงก์ย่อ/QR ที่แนบกับโครงการนี้ — ใช้แจกในโปสเตอร์ ข้อความ หรือแชต แล้วดูว่ามีคนสแกนหรือคลิกเท่าไร (ลิงก์อื่นที่ไม่ใช่ของโครงการนี้ แนบได้จากหน้า ลิงก์ย่อ)'),
        h('div', { class: 'btn-row' }, newBtn, h('span', { class: 'pill' }, `${fmt(mine.length)} ลิงก์ · ${fmt(clicks)} คลิก`)),
        mine.length ? h('div', { class: 'hist-list prj-links' }, mine.map((l) => { const full = shortUrl(base, l.code);
          return h('div', { class: 'lnk-row' }, h('span', { class: 'hist-ico' }, svgIcon(I.link, 20)), h('span', { class: 'hist-main' }, h('b', null, l.title || hostOf(l.url)), h('small', { class: 'lnk-short' }, full.replace(/^https?:\/\//, '')), h('small', { class: 'muted lnk-target' }, `→ ${l.url}`)),
            h('div', { class: 'lnk-num' }, h('b', null, fmt(l.clicks)), h('small', null, `7 วัน ${fmt(l.week)}`)),
            h('button', { class: 'icon-btn lnk-act', type: 'button', 'aria-label': 'คัดลอก', onclick: () => copy(full, 'คัดลอกลิงก์แล้ว') }, svgIcon(I.copy, 18)), h('button', { class: 'icon-btn lnk-act', type: 'button', 'aria-label': 'QR Code', onclick: () => showQr(full, l.title || 'QR Code') }, svgIcon(I.qr, 18))); }))
          : h('div', { class: 'empty' }, svgIcon(I.link, 28), h('p', null, 'ยังไม่มีลิงก์ที่แนบกับโครงการนี้')));
    }
    function newLink(base) {
      const t = h('input', { type: 'text', maxlength: 120, value: S.site.name }); const u = h('input', { type: 'text', value: S.site.url, placeholder: 'https://…' }); const a = h('input', { type: 'text', maxlength: 32, placeholder: 'เว้นว่าง = สุ่มให้', autocapitalize: 'none' });
      let mm = null;
      const go = h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
        go.disabled = true;
        try { const r = await call('links', 'create', { url: u.value.trim(), title: t.value.trim(), alias: a.value.trim(), project: S.site.key }); const full = shortUrl(r.base || base, r.link.code); mm.close(); await copyText(full); toast('สร้างลิงก์ย่อแล้ว และคัดลอกไว้ในคลิปบอร์ด', 'success'); showQr(full, t.value.trim() || 'QR Code'); linksTab(); }
        catch (e) { toast(e.message, 'error', 6000); go.disabled = false; }
      } }, 'สร้างลิงก์');
      mm = modal('ลิงก์ย่อสำหรับโครงการนี้', [field('ชื่อเรียก', t).root, field('ปลายทาง', u, 'ค่าเริ่มต้นคือเว็บไซต์ของโครงการ หรือใส่หน้าเฉพาะ เช่น หน้าลงทะเบียน').root, field('ชื่อลิงก์ที่ต้องการ', a, 'a-z 0-9 - _ อย่างน้อย 3 ตัว').root], [go, h('button', { class: 'btn', type: 'button', onclick: () => mm.close() }, 'ยกเลิก')], { wide: true });
    }

    /* settings */
    function settingsTab() {
      const s = S.site;
      const name = h('input', { type: 'text', maxlength: 120, value: s.name }); const url = h('input', { type: 'text', value: s.url, placeholder: 'https://…' });
      const dom = h('input', { type: 'text', value: s.domains.join(', ') }); const note = h('input', { type: 'text', maxlength: 300, value: s.note }); const tags = h('input', { type: 'text', value: s.tags.join(', '), placeholder: 'คั่นด้วย comma' });
      const track = h('input', { type: 'checkbox', id: 'prj-track', checked: s.track && s.status === 'active' });
      const save = h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
        save.disabled = true;
        try {
          const r = await call('projects', 'update', { key: s.key, name: name.value.trim(), url: url.value.trim(), domains: dom.value.trim(), note: note.value.trim(), tags: tags.value, track: track.checked, status: track.checked ? 'active' : 'paused' });
          Object.assign(S.site, r.site); toast('บันทึกแล้ว', 'success'); title.textContent = S.site.name; await load(false); save.disabled = false;
        } catch (e) { toast(e.message, 'error', 6000); save.disabled = false; }
      } }, 'บันทึก');
      const del = h('button', { class: 'btn btn-danger', type: 'button', onclick: async () => {
        if (!(await confirmBox({ title: 'ลบโครงการนี้?', danger: true, confirm: 'ลบโครงการ', message: `“${s.name}” จะหยุดเก็บสถิติทันที และลิงก์ย่อที่แนบไว้จะถูกถอดออกจากโครงการ (ลิงก์ยังใช้งานได้)` }))) return;
        try { await call('projects', 'delete', { key: s.key }); toast('ลบโครงการแล้ว', 'success'); closeDrawer(); await load(false); } catch (e) { toast(e.message, 'error', 6000); }
      } }, svgIcon(ICONS.trash, 16), 'ลบโครงการ');
      body.replaceChildren(h('div', { class: 'grid-2' }, field('ชื่อโครงการ', name).root, field('ที่อยู่เว็บไซต์', url).root, field('โดเมนที่อนุญาต', dom, 'สถิติจากโดเมนอื่นจะถูกปฏิเสธ (โดเมนย่อยรวมให้อัตโนมัติ)').root, field('แท็ก', tags).root),
        field('หมายเหตุ', note).root,
        h('label', { class: 'pdf-check prj-switch' }, track, h('span', null, h('b', null, 'เก็บสถิติ'), h('small', { class: 'muted' }, ' — ปิดเพื่อหยุดรับข้อมูลชั่วคราว (ข้อมูลเดิมไม่หาย)'))),
        h('div', { class: 'btn-row' }, save, h('div', { class: 'spacer' }), del),
        h('dl', { class: 'meta' }, h('dt', null, 'รหัสไซต์'), h('dd', null, h('code', null, s.key)), h('dt', null, 'สร้างเมื่อ'), h('dd', null, s.created)));
    }
    setTab(tab);
  }

  load();
  const cleanup = () => { seq += 1; stopPoll(); closeAllLayers(); };
  /** Open a project's detail drawer from outside (e.g. the dashboard's top-projects list). */
  cleanup.open = (key, tab = 'overview') => { const s = st.items.find((x) => x.key === key); if (s) openDrawer(s, tab); };
  return cleanup;
}
