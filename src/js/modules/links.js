import { h, field, svgIcon, debounce } from '../core/dom.js';
import { ICONS } from '../core/icons.js';
import { getSession, signOut } from '../core/auth.js';
import { gasCall } from '../core/api.js';
import { notice } from '../core/notices.js';
import { toast } from '../core/toast.js';
import { copyText, downloadBlob } from '../core/download.js';
import { addLayer, modal, confirmBox, closeAllLayers } from '../core/layers.js';
import { showQr } from '../core/qrdialog.js';
import { cachedLinksList, fetchLinksList } from '../core/qrsaved.js';
import { loadCss } from '../core/css.js';
import { fmt, DEVICE, countryName, hostOf, bkk, when, ago, barChart, hBars, dayLabel } from '../core/charts.js';

/* ------------------------------- helpers ------------------------------- */

const I = {
  link: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>', qr: ICONS.qr || '<path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM20 14v7h-3"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>', copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 012-2h9"/>',
  out: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"/>'
};
const statusOf = (l) => (l.status === 'disabled' ? 'off' : l.expires && bkk(l.expires) < new Date() ? 'expired' : 'active');
const STATUS_LABEL = { active: 'ใช้งานอยู่', off: 'ปิดอยู่', expired: 'หมดอายุ' };

async function call(op, params = {}, timeout = 60000) {
  const s = getSession();
  if (!s) { const e = new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่'); e.code = 'INVALID_SESSION'; throw e; }
  try { return (await gasCall('links', { session: s.token, op, ...params }, timeout)).data; } catch (e) { if (e && (e.code === 'INVALID_SESSION' || e.code === 'DOMAIN_NOT_ALLOWED')) signOut(); throw e; }
}
const shortUrl = (base, code) => `${String(base || location.origin).replace(/\/+$/, '')}/s/${code}`;
async function copy(text, msg = 'คัดลอกลิงก์แล้ว') { if (await copyText(text)) toast(msg, 'success'); else toast('คัดลอกไม่ได้ — กดค้างที่ลิงก์เพื่อคัดลอกเอง', 'error'); }

/* ---------------------------------- page ---------------------------------- */

export async function mount(root, ctx) {
  await loadCss('links');
  const s = getSession();
  const host = h('div');
  root.append(h('div', { class: 'page' }, h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'ลิงก์ย่อและสถิติ'),
    h('p', null, 'ย่อลิงก์ให้สั้น สร้าง QR และดูว่ามีคนเปิดกี่ครั้ง จากอุปกรณ์ไหน เมื่อไหร่ — ไม่เก็บ IP ของผู้เข้าชม'))), host));
  if (!s) { host.append(notice('warn', 'ต้องเข้าสู่ระบบก่อน', 'ระบบลิงก์ย่อใช้ได้เฉพาะผู้ที่ล็อกอินแล้ว')); return () => {}; }

  const st = { items: [], base: '', admin: false, q: '', filter: 'all', project: '', sort: 'new', loaded: false, projects: [] };
  const projName = (k) => (st.projects.find((p) => p.key === k) || {}).name || '';
  const me = (s.user && s.user.email || '').toLowerCase();
  let seq = 0; let closeDrawer = null;

  /* ---- create card ---- */
  const urlIn = h('input', { type: 'text', inputmode: 'url', autocomplete: 'off', placeholder: 'วางลิงก์ที่ต้องการย่อ เช่น https://…', 'aria-label': 'ลิงก์ที่ต้องการย่อ' });
  const titleIn = h('input', { type: 'text', maxlength: 120, placeholder: 'เช่น เมนูอาหารผู้ป่วย ตุลาคม' });
  const aliasIn = h('input', { type: 'text', maxlength: 32, placeholder: 'เว้นว่าง = สุ่มให้', autocapitalize: 'none', spellcheck: 'false' });
  const expIn = h('input', { type: 'date' });
  const noteIn = h('input', { type: 'text', maxlength: 300, placeholder: 'บันทึกช่วยจำ (ไม่บังคับ)' });
  const prefix = h('span', { class: 'lnk-prefix' });
  const projIn = h('select', { 'aria-label': 'โครงการ' }, h('option', { value: '' }, '— ไม่แนบโครงการ —'));
  const fillProjects = (sel, cur = '') => { sel.replaceChildren(h('option', { value: '' }, '— ไม่แนบโครงการ —'), ...st.projects.map((p) => h('option', { value: p.key }, p.name))); sel.value = cur; };
  const createBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => create() }, svgIcon(I.link, 18), 'ย่อลิงก์');
  const result = h('div', { class: 'lnk-result', hidden: true, 'aria-live': 'polite' });
  const more = h('details', { class: 'lnk-more' }, h('summary', null, 'ตัวเลือกเพิ่มเติม (ชื่อเรียก · ชื่อลิงก์ · วันหมดอายุ)'),
    h('div', { class: 'grid-2' }, field('ชื่อเรียก', titleIn, 'ใช้แสดงในรายการ ค้นหาง่ายขึ้น').root,
      field('ชื่อลิงก์ที่ต้องการ', h('div', { class: 'lnk-alias' }, prefix, aliasIn), 'a-z 0-9 - _ อย่างน้อย 3 ตัว').root,
      field('หมดอายุวันที่', expIn, 'เว้นว่าง = ไม่หมดอายุ').root, field('หมายเหตุ', noteIn).root, field('แนบกับโครงการ', projIn, 'รวมสถิติลิงก์ไว้ในหน้า โครงการ').root));
  urlIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); create(); } });
  urlIn.addEventListener('paste', () => setTimeout(() => { if (/^https?:\/\//i.test(urlIn.value.trim()) && !titleIn.value) titleIn.placeholder = `เช่น ${hostOf(urlIn.value.trim())}`; }, 0));

  async function create() {
    const url = urlIn.value.trim();
    if (!url) { urlIn.focus(); toast('วางลิงก์ที่ต้องการย่อก่อน', 'error'); return; }
    createBtn.classList.add('is-loading'); createBtn.disabled = true;
    try {
      const d = await call('create', { url, title: titleIn.value.trim(), alias: aliasIn.value.trim(), note: noteIn.value.trim(), project: projIn.value, expires: expIn.value ? `${expIn.value} 23:59:59` : '' });
      st.base = d.base || st.base; const l = d.link; const full = shortUrl(st.base, l.code);
      urlIn.value = titleIn.value = aliasIn.value = noteIn.value = expIn.value = projIn.value = '';
      result.hidden = false;
      result.replaceChildren(h('div', { class: 'lnk-result-main' }, h('span', { class: 'lnk-result-label' }, 'ลิงก์ย่อของคุณ'), h('a', { class: 'lnk-result-url', href: full, target: '_blank', rel: 'noopener noreferrer' }, full)),
        h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: () => copy(full) }, svgIcon(I.copy, 16), 'คัดลอก'),
          h('button', { class: 'btn', type: 'button', onclick: () => showQr(full, l.title || 'QR Code') }, svgIcon(I.qr, 16), 'QR Code'),
          h('button', { class: 'btn', type: 'button', onclick: () => openStats(l) }, svgIcon(I.chart, 16), 'ดูสถิติ')));
      copy(full, 'ย่อลิงก์แล้ว และคัดลอกไว้ในคลิปบอร์ด');
      await load(false);
    } catch (e) { toast(e.message, 'error', 6000); } finally { createBtn.classList.remove('is-loading'); createBtn.disabled = false; }
  }

  /* ---- list ---- */
  const kpi = h('div', { class: 'lnk-kpis' });
  const search = h('input', { type: 'search', placeholder: 'ค้นหาชื่อ ลิงก์ย่อ หรือปลายทาง…', 'aria-label': 'ค้นหาลิงก์' });
  search.addEventListener('input', debounce(() => { st.q = search.value.trim().toLowerCase(); draw(); }, 150));
  const filterSel = h('select', { 'aria-label': 'กรองสถานะ', onchange: () => { st.filter = filterSel.value; draw(); } },
    h('option', { value: 'all' }, 'ทั้งหมด'), h('option', { value: 'active' }, 'ใช้งานอยู่'), h('option', { value: 'off' }, 'ปิด/หมดอายุ'), h('option', { value: 'mine' }, 'ของฉัน'), h('option', { value: 'drive' }, 'จากคลังข้อมูล (Drive)'), h('option', { value: 'qr' }, 'QR ที่ติดตามสถิติ'), h('option', { value: 'plain' }, 'ลิงก์ย่อทั่วไป'));
  const projSel = h('select', { 'aria-label': 'กรองตามโครงการ', hidden: true, onchange: () => { st.project = projSel.value; draw(); } });
  const sortSel = h('select', { 'aria-label': 'เรียงลำดับ', onchange: () => { st.sort = sortSel.value; draw(); } },
    h('option', { value: 'new' }, 'ใหม่สุดก่อน'), h('option', { value: 'clicks' }, 'คลิกมากสุด'), h('option', { value: 'week' }, 'คลิก 7 วันมากสุด'), h('option', { value: 'name' }, 'ชื่อ ก–ฮ'));
  const refreshBtn = h('button', { class: 'btn', type: 'button', onclick: () => load(true) }, svgIcon(ICONS.rotate, 18), 'รีเฟรช');
  const list = h('div', { class: 'hist-list' });
  const foot = h('p', { class: 'hint' });
  host.append(h('div', { class: 'card lnk-create' }, h('div', { class: 'lnk-create-row' }, urlIn, createBtn), more, result), kpi,
    h('div', { class: 'card' }, h('div', { class: 'hist-tools' }, search, filterSel, projSel, sortSel, refreshBtn), list, foot));

  const skeleton = () => list.replaceChildren(...[1, 2, 3].map(() => h('div', { class: 'skeleton', style: 'height:68px;margin-bottom:.5rem' })));
  async function load(showSkeleton = true) {
    const my = ++seq;
    const apply = (d) => { st.items = d.items.filter((l) => l.kind !== 'qrs'); st.savedQr = d.items.length - st.items.length; st.base = d.base || ''; st.admin = d.admin; st.loaded = true; st.scanned = d.scanned; };
    const cached = showSkeleton && !st.loaded ? cachedLinksList() : null;
    if (cached) { apply(cached); draw(); } else if (showSkeleton) skeleton();   // show the last known list at once, then refresh
    try {
      // the list and the project names are independent: ask for both at the same time
      const namesP = st.projectsLoaded ? null : (st.projectsLoaded = true, gasCall('projects', { session: getSession().token, op: 'names' }, 30000).then((r) => r.data.items).catch(() => []));
      const d = await fetchLinksList(); if (my !== seq) return;
      apply(d);
      if (namesP) { st.projects = await namesP; fillProjects(projIn); }
      if (my !== seq) return; draw();
      const want = !st.deepLinked && ctx && ctx.params && ctx.params.get('stats');
      if (want) { st.deepLinked = true; const hit = st.items.find((x) => x.code === want); if (hit) openStats(hit); else toast('ไม่พบลิงก์/QR ที่ต้องการดูสถิติ หรือไม่มีสิทธิ์เข้าถึง', 'error'); }
    } catch (e) {
      if (my !== seq) return;
      list.replaceChildren(...[notice('error', 'โหลดลิงก์ไม่ได้', e.message), e.code === 'INVALID_SESSION' ? h('button', { class: 'btn btn-primary', type: 'button', onclick: () => location.reload() }, 'เข้าสู่ระบบใหม่') : null].filter(Boolean));
    }
  }

  function drawKpi() {
    const act = st.items.filter((l) => statusOf(l) === 'active').length; const total = st.items.reduce((a, l) => a + l.clicks, 0); const week = st.items.reduce((a, l) => a + l.week, 0);
    const top = [...st.items].sort((a, b) => b.clicks - a.clicks)[0];
    const card = (label, value, sub, icon) => h('div', { class: 'lnk-kpi' }, h('span', { class: 'lnk-kpi-ico' }, svgIcon(icon, 20)), h('div', null, h('small', null, label), h('b', null, value), sub ? h('span', { class: 'muted' }, sub) : null));
    kpi.replaceChildren(card('ลิงก์ที่ใช้งานอยู่', fmt(act), `จากทั้งหมด ${fmt(st.items.length)} ลิงก์`, I.link), card('คลิก/สแกนทั้งหมด', fmt(total), 'ไม่นับบอทและตัวอย่างลิงก์ในแชต', I.chart),
      card('คลิก 7 วันล่าสุด', fmt(week), null, ICONS.clock || I.chart), card('ลิงก์ยอดนิยม', top && top.clicks ? fmt(top.clicks) : '-', top && top.clicks ? top.title || `/${top.code}` : 'ยังไม่มีคนเข้า', I.qr));
  }

  function filtered() {
    const q = st.q;
    const items = st.items.filter((l) => {
      const s2 = statusOf(l);
      if (st.filter === 'active' && s2 !== 'active') return false; if (st.filter === 'off' && s2 === 'active') return false;
      if (st.filter === 'mine' && l.owner !== me) return false; if (st.filter === 'drive' && !l.ref) return false; if (st.filter === 'qr' && l.kind !== 'qr') return false; if (st.filter === 'plain' && l.kind === 'qr') return false; if (st.project && l.project !== st.project) return false;
      return !q || `${l.title} ${l.code} ${l.url} ${l.note} ${l.tags.join(' ')} ${l.owner} ${projName(l.project)}`.toLowerCase().includes(q);
    });
    const by = { new: (a, b) => (a.created < b.created ? 1 : -1), clicks: (a, b) => b.clicks - a.clicks, week: (a, b) => b.week - a.week, name: (a, b) => (a.title || a.code).localeCompare(b.title || b.code, 'th') }[st.sort];
    return items.sort(by);
  }

  function draw() {
    if (!st.loaded) return;
    drawKpi();
    filterSel.querySelector('option[value=mine]').hidden = !st.admin;
    projSel.hidden = !st.projects.length; projSel.replaceChildren(h('option', { value: '' }, 'ทุกโครงการ'), ...st.projects.map((p) => h('option', { value: p.key }, p.name))); projSel.value = st.project;
    const shown = filtered();
    if (!shown.length) {
      list.replaceChildren(h('div', { class: 'empty' }, svgIcon(I.link, 28), h('p', null, st.items.length ? 'ไม่พบลิงก์ที่ตรงกับเงื่อนไข' : 'ยังไม่มีลิงก์ — วางลิงก์ด้านบนแล้วกด "ย่อลิงก์" ได้เลย')));
    } else list.replaceChildren(...shown.map(row));
    foot.textContent = st.scanned ? 'สถิติคำนวณจากการคลิกล่าสุด 60,000 รายการ' : st.admin ? 'ผู้ดูแลระบบเห็นลิงก์ของทุกคน' : st.savedQr ? `มี QR ที่เก็บประวัติอย่างเดียว ${fmt(st.savedQr)} รายการ — ดูได้ที่หน้า ประวัติ QR` : '';
  }

  function row(l) {
    const stt = statusOf(l); const full = shortUrl(st.base, l.code);
    return h('div', { class: `lnk-row${stt === 'active' ? '' : ' is-off'}` },
      h('button', { class: 'lnk-main', type: 'button', onclick: () => openStats(l) },
        h('span', { class: 'hist-ico' }, svgIcon(l.kind === 'qr' ? I.qr : l.ref ? ICONS.folder : I.link, 20)),
        h('span', { class: 'hist-main' }, h('b', { title: l.title || hostOf(l.url) }, l.title || hostOf(l.url)),
          h('small', { class: 'lnk-short' }, full.replace(/^https?:\/\//, '')), h('small', { class: 'muted lnk-target', title: l.url }, `→ ${l.url}`))),
      l.kind === 'qr' ? h('span', { class: 'pill', title: 'QR Code ที่นับผู้สแกน' }, 'QR') : null,
      l.project && projName(l.project) ? h('span', { class: 'pill lnk-proj', title: 'โครงการ' }, projName(l.project)) : null,
      ...l.tags.slice(0, 2).map((t) => h('span', { class: 'pill lib-tag' }, `#${t}`)),
      st.admin && l.owner !== me ? h('span', { class: 'pill', title: l.owner }, l.owner.split('@')[0]) : null,
      stt !== 'active' ? h('span', { class: 'pill pill-err' }, STATUS_LABEL[stt]) : null,
      h('div', { class: 'lnk-num', title: `คลิกล่าสุด: ${ago(l.last)}` }, h('b', null, fmt(l.clicks)), h('small', null, `7 วัน ${fmt(l.week)}`)),
      h('button', { class: 'icon-btn lnk-act', type: 'button', 'aria-label': `คัดลอกลิงก์ ${l.title || l.code}`, title: 'คัดลอก', onclick: () => copy(full) }, svgIcon(I.copy, 18)),
      h('button', { class: 'icon-btn lnk-act', type: 'button', 'aria-label': `QR Code ของ ${l.title || l.code}`, title: 'QR Code', onclick: () => showQr(full, l.title || 'QR Code') }, svgIcon(I.qr, 18)));
  }

  /* ---- stats drawer ---- */
  async function openStats(link, days = 30) {
    if (closeDrawer) closeDrawer();
    const body = h('div', { class: 'lnk-body' }, h('div', { class: 'skeleton', style: 'height:220px' }));
    const title = h('h2', null, link.title || hostOf(link.url));
    const aside = h('aside', { class: 'drawer lnk-drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'สถิติลิงก์' },
      h('div', { class: 'drawer-head' }, title, h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'ปิด', onclick: () => closeDrawer && closeDrawer() }, svgIcon(I.close))), body);
    closeDrawer = addLayer(h('div', { class: 'drawer-wrap' }, aside), { onClose: () => { closeDrawer = null; } });
    const my = ++seq;
    async function fetchStats(d) {
      body.replaceChildren(h('div', { class: 'skeleton', style: 'height:220px' }));
      try { const data = await call('stats', { code: link.code, days: d }); if (my === seq || true) render(data); } catch (e) { body.replaceChildren(notice('error', 'โหลดสถิติไม่ได้', e.message)); }
    }
    function render(d) {
      const l = d.link; const full = shortUrl(st.base, l.code); const stt = statusOf(l); const unit = l.kind === 'qr' ? 'สแกน' : 'คลิก';
      title.textContent = l.title || hostOf(l.url);
      const range = h('div', { class: 'tabs lnk-range', role: 'tablist', 'aria-label': 'ช่วงเวลา' }, [[7, '7 วัน'], [30, '30 วัน'], [90, '90 วัน'], [365, '1 ปี']].map(([n, label]) =>
        h('button', { class: 'tab', type: 'button', role: 'tab', 'aria-selected': String(d.days === n), onclick: () => fetchStats(n) }, label)));
      const stat = (label, value, sub) => h('div', { class: 'lnk-stat' }, h('small', null, label), h('b', null, fmt(value)), sub ? h('span', { class: 'muted' }, sub) : null);
      const hours = d.byHour.map((n, i) => ({ n, label: `${String(i).padStart(2, '0')}:00` }));
      body.replaceChildren(...[
        h('div', { class: 'lnk-linkbox' }, h('a', { href: full, target: '_blank', rel: 'noopener noreferrer' }, full), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'คัดลอก', onclick: () => copy(full) }, svgIcon(I.copy, 18))),
        h('p', { class: 'lnk-dest muted' }, '→ ', h('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer' }, l.url)),
        h('div', { class: 'btn-row lnk-actions' },
          h('button', { class: 'btn btn-sm', type: 'button', onclick: () => showQr(full, l.title || 'QR Code') }, svgIcon(I.qr, 16), 'QR Code'),
          l.kind === 'qr' ? h('a', { class: 'btn btn-sm', href: `#/qr?load=${encodeURIComponent(l.code)}`, onclick: () => closeDrawer && closeDrawer() }, svgIcon(ICONS.edit, 16), 'เปิดใน QR Generator') : null,
          h('button', { class: 'btn btn-sm', type: 'button', onclick: () => exportCsv(l) }, svgIcon(ICONS.download, 16), 'ส่งออก CSV'),
          h('button', { class: 'btn btn-sm', type: 'button', onclick: () => editLink(l, () => fetchStats(d.days)) }, svgIcon(ICONS.edit, 16), 'แก้ไข'),
          h('button', { class: 'btn btn-sm', type: 'button', onclick: () => toggle(l, () => fetchStats(d.days)) }, l.status === 'disabled' ? 'เปิดใช้งาน' : 'ปิดชั่วคราว'),
          h('button', { class: 'btn btn-sm btn-danger', type: 'button', onclick: () => remove(l) }, svgIcon(ICONS.trash, 16), 'ลบ')),
        stt !== 'active' ? notice('warn', stt === 'expired' ? 'ลิงก์นี้หมดอายุแล้ว' : 'ลิงก์นี้ปิดใช้งานอยู่', 'ผู้ที่เปิดลิงก์จะเห็นหน้าแจ้งว่าใช้งานไม่ได้') : null,
        h('div', { class: 'lnk-stats' }, stat(`${unit}ทั้งหมด`, d.total, `ล่าสุด ${ago(d.last)}`), stat('ผู้เข้าชมไม่ซ้ำ', d.unique, 'นับจากอุปกรณ์/เครือข่าย'), stat(`ใน ${d.days} วัน`, d.inRange, `${fmt(d.uniqueInRange)} คนไม่ซ้ำ`), stat('บอทที่ไม่นับ', d.bots, 'ตัวอย่างลิงก์ในแชต ฯลฯ')),
        range,
        h('section', { class: 'lnk-sec' }, h('h3', null, `${unit}ต่อวัน`), barChart(d.byDay.map((p) => ({ n: p.n, label: dayLabel(p.d) })), `${unit}ต่อวัน`)),
        h('section', { class: 'lnk-sec' }, h('h3', null, 'ช่วงเวลาที่คนเข้า (ชั่วโมงของวัน)'), barChart(hours, `${unit}ตามชั่วโมง`)),
        h('div', { class: 'lnk-breaks' }, hBars('อุปกรณ์', d.devices, (n) => DEVICE[n] || n), hBars('ประเทศ', d.countries, countryName), hBars('เบราว์เซอร์/แอป', d.browsers, (n) => n || 'ไม่ทราบ'),
          hBars('ระบบปฏิบัติการ', d.systems, (n) => n || 'ไม่ทราบ'), hBars('มาจาก', d.referrers, (n) => n || 'เข้าโดยตรง / แอปแชต')),
        h('section', { class: 'lnk-sec' }, h('h3', null, 'การเข้าชมล่าสุด'), d.recent.length
          ? h('div', { class: 'lnk-table-wrap' }, h('table', { class: 'lnk-table' }, h('thead', null, h('tr', null, ['เวลา', 'อุปกรณ์', 'เบราว์เซอร์', 'ประเทศ', 'มาจาก'].map((x) => h('th', null, x)))),
            h('tbody', null, d.recent.map((r) => h('tr', null, h('td', null, when(r.t)), h('td', null, `${DEVICE[r.device] || r.device} · ${r.os}`), h('td', null, r.browser), h('td', null, countryName(r.country)), h('td', null, r.ref || 'โดยตรง'))))))
          : h('p', { class: 'muted' }, l.kind === 'qr' ? 'ยังไม่มีคนสแกน QR นี้' : 'ยังไม่มีคนเข้าลิงก์นี้')),
        h('dl', { class: 'meta' }, h('dt', null, 'สร้างเมื่อ'), h('dd', null, when(bkk(l.created))), h('dt', null, 'หมดอายุ'), h('dd', null, l.expires ? when(bkk(l.expires)) : 'ไม่หมดอายุ'),
          h('dt', null, `${unit}แรก`), h('dd', null, d.first ? when(d.first) : '-'), l.project && projName(l.project) ? h('dt', null, 'โครงการ') : null, l.project && projName(l.project) ? h('dd', null, projName(l.project)) : null, l.ref ? h('dt', null, 'ที่มา') : null, l.ref ? h('dd', null, `ไฟล์/โฟลเดอร์ในคลังข้อมูล`) : null, st.admin ? h('dt', null, 'เจ้าของ') : null, st.admin ? h('dd', null, l.owner) : null),
        d.scanned ? h('p', { class: 'hint' }, 'สถิติคำนวณจากการคลิกล่าสุด 60,000 รายการ') : null].filter(Boolean));
    }
    fetchStats(days);
  }

  async function exportCsv(l) {
    try {
      const d = await call('export', { code: l.code });
      const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const lines = [['เวลา (เวลาไทย)', 'ประเทศ', 'อุปกรณ์', 'เบราว์เซอร์', 'ระบบปฏิบัติการ', 'มาจาก'].map(esc).join(',')];
      d.rows.forEach((r) => lines.push([new Date(r.t).toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' }), countryName(r.country), DEVICE[r.device] || r.device, r.browser, r.os, r.ref || 'โดยตรง'].map(esc).join(',')));
      downloadBlob(new Blob([`\ufeff${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' }), `สถิติลิงก์_${l.code}_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.csv`);
      toast(`ส่งออก ${fmt(d.rows.length)} รายการ`, 'success');
    } catch (e) { toast(e.message, 'error', 5000); }
  }

  async function toggle(l, done) {
    try { await call('update', { code: l.code, status: l.status === 'disabled' ? 'active' : 'disabled' }); toast(l.status === 'disabled' ? 'เปิดใช้งานแล้ว' : 'ปิดลิงก์ชั่วคราวแล้ว', 'success'); await load(false); const nl = st.items.find((x) => x.code === l.code); if (nl) { Object.assign(l, nl); } done(); } catch (e) { toast(e.message, 'error', 5000); }
  }
  async function remove(l) {
    if (!(await confirmBox({ title: 'ลบลิงก์นี้?', danger: true, confirm: 'ลบลิงก์', message: `“${l.title || l.code}” จะใช้งานไม่ได้ทันที และจะไม่ปรากฏในรายการ (ชื่อลิงก์จะไม่ถูกนำกลับมาใช้ซ้ำ)` }))) return;
    try { await call('delete', { code: l.code }); toast('ลบลิงก์แล้ว', 'success'); if (closeDrawer) closeDrawer(); await load(false); } catch (e) { toast(e.message, 'error', 5000); }
  }
  function editLink(l, done) {
    const t = h('input', { type: 'text', maxlength: 120, value: l.title }); const u = h('input', { type: 'text', value: l.url, disabled: !!l.ref });
    const n = h('input', { type: 'text', maxlength: 300, value: l.note }); const tg = h('input', { type: 'text', value: l.tags.join(', '), placeholder: 'คั่นด้วย comma' });
    const e = h('input', { type: 'date', value: l.expires ? l.expires.slice(0, 10) : '' });
    const pj = h('select', { 'aria-label': 'โครงการ' }); fillProjects(pj, l.project || '');
    let mm = null;
    const save = h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
      try {
        const body = { code: l.code, title: t.value.trim(), note: n.value.trim(), tags: tg.value, expires: e.value ? (e.value === (l.expires || '').slice(0, 10) ? l.expires : `${e.value} 23:59:59`) : '', project: pj.value };
        if (!l.ref) body.url = u.value.trim();
        await call('update', body); mm.close(); toast('บันทึกแล้ว', 'success'); await load(false); const nl = st.items.find((x) => x.code === l.code); if (nl) Object.assign(l, nl); done();
      } catch (err) { toast(err.message, 'error', 6000); }
    } }, 'บันทึก');
    mm = modal('แก้ไขลิงก์', [field('ชื่อเรียก', t).root, field('ลิงก์ปลายทาง', u, l.ref ? 'ลิงก์จากคลังข้อมูล เปลี่ยนปลายทางไม่ได้' : 'เปลี่ยนแล้ว ลิงก์ย่อเดิมจะพาไปที่ปลายทางใหม่ทันที').root, field('วันหมดอายุ', e, 'เว้นว่าง = ไม่หมดอายุ').root, field('แท็ก', tg).root, field('แนบกับโครงการ', pj).root, field('หมายเหตุ', n).root],
      [save, h('button', { class: 'btn', type: 'button', onclick: () => mm.close() }, 'ยกเลิก')], { wide: true });
  }

  const today = new Date(Date.now() + 86400000); expIn.min = today.toISOString().slice(0, 10);
  prefix.textContent = `${location.host}/s/`;
  load();
  return () => { seq += 1; closeAllLayers(); };
}
