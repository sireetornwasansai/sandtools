// เฝ้าระวังระบบ — one page for every attached website: who is up or down, what went wrong, which tasks failed, what users did.
// Data: backend ops projects/monitor (state of every project) · feed (events, newest first) · issues (repeated problems) · around (what happened near one event).
import { h, svgIcon, debounce, field } from '../core/dom.js';
import { ICONS } from '../core/icons.js';
import { getSession } from '../core/auth.js';
import { sessionCall, cacheGet } from '../core/ops.js';
import { notice, privacyNotice } from '../core/notices.js';
import { toast } from '../core/toast.js';
import { copyText } from '../core/download.js';
import { addLayer, modal, closeAllLayers } from '../core/layers.js';
import { loadCss } from '../core/css.js';
import { fmt, ago } from '../core/charts.js';
import {
  KIND, KIND_ORDER, LEVEL, HOURS, LEVEL_FILTERS, TASK_STATUS, STATE, sortFleet, stateCounts, fmtDuration, fmtClock, fmtFull, groupByDay, explain,
  parseFilters, filtersToParams, feedParams, activeFilterCount, defaultFilters, eventText, headline, logSnippets
} from './monitor-engine.js';

const IC = {
  ok: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 9.5"/>',
  warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17.2v.1"/>',
  error: '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>',
  down: '<path d="M9 3v5M15 3v5M7 8h10v3a5 5 0 01-10 0zM12 16v5"/>',
  wait: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  off: '<circle cx="12" cy="12" r="9"/><path d="M10 9v6M14 9v6"/>',
  er: '<path d="M9 8a3 3 0 016 0v7a3 3 0 01-6 0zM4 13h5M15 13h5M5 7l3 2M19 7l-3 2M5 19l3-2M19 19l-3-2"/>',
  lg: '<path d="M5 6h14M5 12h14M5 18h9"/>',
  tk: '<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 01-2 2H6a2 2 0 01-2-2V7a2 2 0 012-2h9"/>',
  hc: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18"/>',
  ev: '<path d="M9 3v3M3 9h3M5 5l2 2M11 11l9 3-4 2-2 4z"/>',
  pv: '<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>', code: '<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M14 5l-4 14"/>'
};
const call = (op, params = {}, timeout = 60000) => sessionCall('projects', op, params, timeout);
const kindIcon = (e) => (e.kind === 'hc' && e.status === 'down' ? IC.down : IC[e.kind] || IC.lg);
const ERR_OLD_BACKEND = 'ฝั่ง Apps Script ยังเป็นเวอร์ชันเก่า — วางไฟล์ Analytics.gs ใหม่ รัน setupAnalytics แล้ว Deploy เวอร์ชันใหม่';

/** Little 24-bar strip: problems per hour over the last 24 hours (oldest left). */
function strip(series, label) {
  const max = Math.max(1, ...series);
  return h('span', { class: 'mon-strip', role: 'img', 'aria-label': label }, series.map((n) => h('i', { class: n ? 'on' : '', style: `height:${n ? Math.max(18, Math.round((n / max) * 100)) : 8}%` })));
}

/** @param {HTMLElement} root @param {{params?: URLSearchParams}} [ctx] */
export async function mount(root, ctx = {}) {
  await Promise.all([loadCss('links'), loadCss('projects'), loadCss('monitor')]);   // links = shared section/chart styles · projects = code boxes
  const sess = getSession();
  const head = (extra) => h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'เฝ้าระวังระบบ'),
    h('p', null, 'ดูสถานะ ข้อผิดพลาด บันทึกงาน และเหตุการณ์ของทุกเว็บไซต์/ระบบที่แนบไว้ ในหน้าเดียว — กดแต่ละรายการเพื่อดูรายละเอียดและสิ่งที่เกิดขึ้นก่อน–หลัง')), extra || null);
  if (!sess) { root.append(h('div', { class: 'page' }, head(), notice('warn', 'ต้องเข้าสู่ระบบก่อน', 'หน้านี้ใช้ได้เฉพาะผู้ที่ล็อกอินแล้ว'))); return () => {}; }

  const F = parseFilters(ctx.params);
  const st = { fleet: null, feed: null, issues: null, stateFilter: '', auto: true, seq: 0, fseq: 0, drawerOpen: false, updated: 0 };
  let timer = null; let closeDrawer = null;

  /* ---------- skeleton of the page ---------- */
  const refreshBtn = h('button', { class: 'btn', type: 'button', onclick: () => reloadAll(true) }, svgIcon(ICONS.rotate, 18), 'รีเฟรช');
  const howBtn = h('button', { class: 'btn', type: 'button', onclick: () => snippetsDialog() }, svgIcon(IC.code, 18), 'วิธีส่งบันทึกเข้ามา');
  const autoBox = h('input', { type: 'checkbox', id: 'mon-auto', checked: true, onchange: () => { st.auto = autoBox.checked; schedule(); } });
  const updated = h('small', { class: 'muted mon-updated' }, '');
  const fleetBox = h('div', { class: 'mon-fleet' }); const chipsBox = h('div', { class: 'mon-states', role: 'group', 'aria-label': 'กรองตามสถานะ' });
  const toolsBox = h('div', { class: 'mon-filters' }); const feedBox = h('div', { class: 'mon-feed', 'aria-live': 'off' });
  const tabsBox = h('div', { class: 'tabs mon-tabs', role: 'tablist', 'aria-label': 'มุมมองบันทึก' });
  const page = h('div', { class: 'page mon-page' }, head(h('div', { class: 'btn-row mon-head-actions' }, howBtn, refreshBtn, h('label', { class: 'mon-auto', for: 'mon-auto' }, autoBox, h('span', null, 'อัปเดตเอง ทุก 30 วินาที')), updated)),
    h('section', { class: 'mon-sec', 'aria-labelledby': 'mon-h-fleet' }, h('div', { class: 'mon-sec-head' }, h('h2', { id: 'mon-h-fleet' }, 'สถานะรายโครงการ'), chipsBox), fleetBox),
    h('section', { class: 'mon-sec', 'aria-labelledby': 'mon-h-feed' }, h('div', { class: 'mon-sec-head' }, h('h2', { id: 'mon-h-feed' }, 'เหตุการณ์และบันทึก'), tabsBox), toolsBox, feedBox));
  root.append(page);

  /* ---------- url ↔ filters ---------- */
  function syncUrl() {
    const q = new URLSearchParams(filtersToParams(F)).toString();
    try { history.replaceState(null, '', `#/monitor${q ? `?${q}` : ''}`); } catch { /* ignore */ }
  }
  const siteName = (key) => { const p = st.fleet && st.fleet.items.find((x) => x.key === key); return p ? p.name : key; };

  /* ---------- fleet ---------- */
  function drawChips() {
    const items = (st.fleet && st.fleet.items) || []; const c = stateCounts(items);
    const chip = (k, label, n) => h('button', { class: 'mon-chip', type: 'button', 'aria-pressed': String(st.stateFilter === k), disabled: k && !n, onclick: () => { st.stateFilter = st.stateFilter === k ? '' : k; drawFleet(); drawChips(); } }, label, h('b', null, fmt(n)));
    chipsBox.replaceChildren(chip('', 'ทั้งหมด', items.length), ...['down', 'error', 'warn', 'ok', 'wait', 'off'].filter((k) => c[k]).map((k) => chip(k, STATE[k].label, c[k])));
  }
  function fleetRow(p) {
    const on = F.site === p.key; const meta = STATE[p.state] || STATE.ok; const why = explain(p);
    const hl = p.health; const live = hl ? `${hl.state === 'down' ? 'ล่ม' : 'ตอบกลับ'} ${hl.code ? `HTTP ${hl.code}` : ''}${hl.ms ? ` · ${fmtDuration(hl.ms)}` : ''}`.trim() : (p.state === 'off' ? '—' : 'ยังไม่ตรวจ');
    return h('button', { class: `mon-row mon-s-${p.state}`, type: 'button', 'aria-pressed': String(on), title: 'กดเพื่อดูบันทึกของโครงการนี้', onclick: () => { F.site = on ? '' : p.key; F.tab = 'feed'; syncUrl(); drawFleet(); drawTools(); loadFeed(true); drawTabs(); } },
      h('span', { class: 'mon-state' }, svgIcon(IC[p.state] || IC.ok, 18), h('span', null, meta.label)),
      h('span', { class: 'mon-name' }, h('b', { title: p.name }, p.name), h('small', { class: 'muted' }, why.length ? why[0] : (p.url ? p.url.replace(/^https?:\/\//, '').replace(/\/$/, '') : 'ยังไม่ระบุเว็บไซต์'))),
      h('span', { class: 'mon-health' }, h('span', null, live), h('small', { class: 'muted' }, hl && hl.checked ? `ตรวจ ${ago(hl.checked)}` : '')),
      h('span', { class: 'mon-errs' }, strip(p.series, `ปัญหาต่อชั่วโมง ย้อนหลัง 24 ชม.: ${p.err24 + p.warn24} ครั้ง`), h('small', null, p.err24 || p.warn24 ? `${fmt(p.err24)} ผิดพลาด${p.warn24 ? ` · ${fmt(p.warn24)} เตือน` : ''}` : 'ไม่มีปัญหา')),
      h('span', { class: 'mon-last' }, h('b', null, p.lastHit || p.lastEvent ? ago(Math.max(p.lastHit, p.lastEvent)) : '—'), h('small', { class: 'muted' }, `${fmt(p.pv24)} เปิดหน้า · ${fmt(p.ev24)} เหตุการณ์ (24 ชม.)`)));
  }
  function drawFleet() {
    if (!st.fleet) return;
    const all = sortFleet(st.fleet.items); const shown = st.stateFilter ? all.filter((p) => p.state === st.stateFilter) : all;
    if (!all.length) { fleetBox.replaceChildren(h('div', { class: 'empty' }, svgIcon(IC.hc, 28), h('p', null, 'ยังไม่มีโครงการ — เพิ่มเว็บไซต์ก่อน แล้วจะเห็นสถานะที่นี่'), h('a', { class: 'btn btn-primary', href: '#/projects' }, svgIcon(ICONS.plus, 18), 'ไปหน้าโครงการ'))); return; }
    fleetBox.replaceChildren(h('div', { class: 'mon-head-row', 'aria-hidden': 'true' }, ['สถานะ', 'โครงการ', 'เว็บตอบกลับ', 'ปัญหา 24 ชม.', 'ข้อมูลล่าสุด'].map((x) => h('span', null, x))), ...shown.map(fleetRow));
  }

  /* ---------- filters ---------- */
  const search = h('input', { type: 'search', placeholder: 'ค้นหาข้อความ ชื่องาน หรือหน้า…', 'aria-label': 'ค้นหาในบันทึก', value: F.q });
  search.addEventListener('input', debounce(() => { F.q = search.value.trim(); syncUrl(); drawTools(true); loadFeed(true); }, 350));
  const siteSel = h('select', { 'aria-label': 'โครงการ', onchange: () => { F.site = siteSel.value; syncUrl(); drawFleet(); drawTools(true); loadFeed(true); } });
  function drawTools(keepSearch) {
    const typing = document.activeElement === search; const caret = typing ? search.selectionStart : 0;   // re-drawing must not steal the cursor while someone types
    const items = (st.fleet && st.fleet.items) || [];
    siteSel.replaceChildren(h('option', { value: '' }, 'ทุกโครงการ'), ...items.map((p) => h('option', { value: p.key, selected: p.key === F.site }, p.name)));
    siteSel.value = F.site;
    const seg = (list, cur, on, label) => h('div', { class: 'tabs mon-seg', role: 'group', 'aria-label': label }, list.map(([k, text]) => h('button', { class: 'tab', type: 'button', 'aria-pressed': String(cur === k), onclick: () => on(k) }, text)));
    const kc = (st.feed && st.feed.kindCount) || {};
    const kindChips = h('div', { class: 'mon-kinds', role: 'group', 'aria-label': 'ชนิดของเหตุการณ์' }, KIND_ORDER.map((k) => h('button', { class: `mon-chip mon-k-${k}`, type: 'button', 'aria-pressed': String(F.kinds.includes(k)), onclick: () => {
      F.kinds = F.kinds.includes(k) ? F.kinds.filter((x) => x !== k) : KIND_ORDER.filter((x) => x === k || F.kinds.includes(x)); if (!F.kinds.length) F.kinds = [k]; syncUrl(); drawTools(true); loadFeed(true);
    } }, svgIcon(IC[k], 16), KIND[k], F.kinds.includes(k) && kc[k] !== undefined ? h('b', null, fmt(kc[k])) : null)));
    const clear = activeFilterCount(F) ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { Object.assign(F, defaultFilters(), { tab: F.tab }); search.value = ''; syncUrl(); drawFleet(); drawTools(); loadFeed(true); } }, 'ล้างตัวกรอง') : null;
    const fpChip = F.fp ? h('button', { class: 'mon-chip mon-fp', type: 'button', title: 'เอาตัวกรองกลุ่มนี้ออก', onclick: () => { F.fp = ''; syncUrl(); drawTools(true); loadFeed(true); } }, `เฉพาะกลุ่มปัญหา ${F.fp}`, svgIcon(IC.close, 14)) : null;
    toolsBox.replaceChildren(...(F.tab === 'issues'
      ? [h('div', { class: 'mon-row-tools' }, siteSel, seg(HOURS.filter(([n]) => n >= 24), F.hours < 24 ? 24 : F.hours, (n) => { F.hours = n; syncUrl(); drawTools(true); loadIssues(true); }, 'ช่วงเวลา'), clear)]
      : [h('div', { class: 'mon-row-tools' }, siteSel, seg(LEVEL_FILTERS, F.level, (k) => { F.level = k; syncUrl(); drawTools(true); loadFeed(true); }, 'ระดับ'), seg(HOURS, F.hours, (n) => { F.hours = n; syncUrl(); drawTools(true); loadFeed(true); }, 'ช่วงเวลา'), clear),
        h('div', { class: 'mon-row-tools' }, h('label', { class: 'mon-search' }, svgIcon(ICONS.search, 18), search), kindChips, fpChip)]));
    if (!keepSearch) search.value = F.q;
    if (typing) { search.focus({ preventScroll: true }); try { search.setSelectionRange(caret, caret); } catch { /* not supported for this type */ } }
  }
  function drawTabs() {
    tabsBox.replaceChildren(...[['feed', 'เหตุการณ์ตามเวลา'], ['issues', 'ปัญหาที่เกิดซ้ำ']].map(([k, label]) => h('button', { class: 'tab', type: 'button', role: 'tab', 'aria-selected': String(F.tab === k), onclick: () => { F.tab = k; if (k === 'issues' && F.hours < 24) F.hours = 24; syncUrl(); drawTabs(); drawTools(true); (k === 'issues' ? loadIssues : loadFeed)(true); } }, label)));
  }

  /* ---------- feed ---------- */
  function evRow(e, onOpen, compact, mark) {
    const task = e.kind === 'tk' ? h('span', { class: `mon-badge mon-b-${e.status === 'fail' ? 'error' : 'ok'}` }, TASK_STATUS[e.status] || e.status, e.ms ? ` · ${fmtDuration(e.ms)}` : '')
      : e.kind === 'hc' ? h('span', { class: `mon-badge mon-b-${e.status === 'down' ? 'error' : 'ok'}` }, e.status === 'down' ? 'ล่ม' : 'กลับมาปกติ') : null;
    return h('button', { class: `mon-ev mon-l-${e.level}${compact ? ' mon-ev-c' : ''}${mark ? ` ${mark}` : ''}`, type: 'button', onclick: () => onOpen(e) },
      h('time', { class: 'mon-time', datetime: new Date(e.t).toISOString() }, fmtClock(e.t)),
      h('span', { class: 'mon-kind', title: `${KIND[e.kind]} · ${LEVEL[e.level]}` }, svgIcon(kindIcon(e), 16), h('span', null, KIND[e.kind] || e.kind)),
      h('span', { class: 'mon-main' }, h('span', { class: 'mon-text' }, e.kind === 'er' && e.name ? h('b', null, `${e.name} `) : null, headline(e)),
        compact ? null : h('small', { class: 'muted' }, [!F.site ? e.site : null, e.page && e.kind !== 'pv' ? e.page : null, [e.device, e.browser].filter(Boolean).join(' · ') || null].filter(Boolean).join(' · '))),
      task);
  }
  function feedEmpty() {
    const filtered = activeFilterCount(F) > 0;
    return h('div', { class: 'empty' }, svgIcon(IC.lg, 28), h('p', null, filtered ? 'ไม่พบเหตุการณ์ที่ตรงกับตัวกรองในช่วงเวลานี้' : 'ยังไม่มีเหตุการณ์ในช่วงเวลานี้'),
      filtered ? null : h('p', { class: 'hint' }, 'ข้อผิดพลาดของหน้าเว็บจะถูกจับอัตโนมัติเมื่อวางโค้ดติดตั้งแล้ว · ส่งบันทึกและบันทึกงานเพิ่มได้ด้วย sandLog / sandTask'),
      filtered ? h('button', { class: 'btn', type: 'button', onclick: () => { Object.assign(F, defaultFilters(), { tab: F.tab }); search.value = ''; syncUrl(); drawFleet(); drawTools(); loadFeed(true); } }, 'ล้างตัวกรอง') : h('button', { class: 'btn btn-primary', type: 'button', onclick: () => snippetsDialog() }, svgIcon(IC.code, 18), 'วิธีส่งบันทึกเข้ามา'));
  }
  function drawFeed() {
    const d = st.feed; if (!d) return;
    if (!d.items.length) { feedBox.replaceChildren(feedEmpty()); return; }
    const groups = groupByDay(d.items);
    feedBox.replaceChildren(h('p', { class: 'mon-count muted', role: 'status' }, `พบ ${fmt(d.total)} รายการ${d.more ? ` · แสดง ${fmt(d.items.length)} รายการล่าสุด` : ''}`),
      ...groups.map((g) => h('div', { class: 'mon-day' }, h('h3', null, g.label), h('div', { class: 'mon-list' }, g.items.map((e) => evRow(e, openEvent))))),
      d.more ? h('button', { class: 'btn mon-more', type: 'button', onclick: (ev) => loadMore(ev.currentTarget) }, 'โหลดรายการที่เก่ากว่า') : null);
  }
  async function loadFeed(skeleton) {
    const my = ++st.fseq; if (F.tab !== 'feed') return;
    if (skeleton) feedBox.replaceChildren(...[1, 2, 3, 4, 5].map(() => h('div', { class: 'skeleton', style: 'height:54px;margin-bottom:.5rem' })));
    try { const d = await call('feed', feedParams(F)); if (my !== st.fseq) return; st.feed = d; drawFeed(); drawTools(true); } catch (e) { if (my === st.fseq) feedBox.replaceChildren(problem(e, () => loadFeed(true))); }
  }
  async function loadMore(btn) {
    btn.disabled = true;
    try { const d = await call('feed', feedParams(F, { before: st.feed.next })); st.feed = { ...d, items: st.feed.items.concat(d.items), total: st.feed.total }; drawFeed(); } catch (e) { toast(e.message, 'error', 5000); btn.disabled = false; }
  }
  const problem = (e, retry) => h('div', null, notice('error', 'โหลดข้อมูลไม่ได้', e.code === 'UNKNOWN_ACTION' ? ERR_OLD_BACKEND : e.message), h('button', { class: 'btn btn-primary', type: 'button', onclick: retry }, svgIcon(ICONS.rotate, 18), 'ลองใหม่'));

  /* ---------- issues ---------- */
  function drawIssues() {
    const d = st.issues; if (!d) return;
    if (!d.items.length) { feedBox.replaceChildren(h('div', { class: 'empty' }, svgIcon(IC.ok, 28), h('p', null, `ไม่พบปัญหาในช่วง ${d.hours >= 168 ? `${d.hours / 24} วัน` : '24 ชั่วโมง'}ที่ผ่านมา`))); return; }
    feedBox.replaceChildren(h('p', { class: 'mon-count muted', role: 'status' }, `${fmt(d.items.length)} กลุ่มปัญหา — จัดกลุ่มข้อความที่เหมือนกัน (ตัวเลขต่างกันนับเป็นกลุ่มเดียว) เรียงจากร้ายแรงและเกิดบ่อยที่สุด`),
      h('div', { class: 'mon-list' }, d.items.map((g) => {
        const max = Math.max(1, ...g.trend);
        return h('button', { class: `mon-ev mon-issue mon-l-${g.level}`, type: 'button', onclick: () => { F.site = g.key; F.fp = g.fp; F.tab = 'feed'; F.level = ''; F.hours = d.hours; F.kinds = ['er', 'lg', 'tk', 'hc']; syncUrl(); drawFleet(); drawTabs(); drawTools(); loadFeed(true); } },
          h('span', { class: 'mon-count-n' }, h('b', null, fmt(g.n)), h('small', null, 'ครั้ง')),
          h('span', { class: 'mon-kind' }, svgIcon(IC[g.kind] || IC.er, 16), h('span', null, LEVEL[g.level])),
          h('span', { class: 'mon-main' }, h('span', { class: 'mon-text' }, g.name && g.msg ? h('b', null, `${g.name} `) : null, g.msg || g.name), h('small', { class: 'muted' }, `${g.site} · ${fmt(g.users)} คนได้รับผลกระทบ · พบครั้งแรก ${ago(g.first)} · ล่าสุด ${ago(g.last)}${g.pages[0] ? ` · ${g.pages[0].name}` : ''}`)),
          h('span', { class: 'mon-strip mon-trend', role: 'img', 'aria-label': `แนวโน้ม ${g.trend.join(', ')}` }, g.trend.map((n) => h('i', { class: n ? 'on' : '', style: `height:${n ? Math.max(18, Math.round((n / max) * 100)) : 8}%` }))));
      })));
  }
  async function loadIssues(skeleton) {
    const my = ++st.fseq; if (F.tab !== 'issues') return;
    if (skeleton) feedBox.replaceChildren(...[1, 2, 3].map(() => h('div', { class: 'skeleton', style: 'height:64px;margin-bottom:.5rem' })));
    try { const d = await call('issues', { hours: F.hours < 24 ? 24 : F.hours, ...(F.site ? { key: F.site } : {}) }); if (my !== st.fseq) return; st.issues = d; drawIssues(); } catch (e) { if (my === st.fseq) feedBox.replaceChildren(problem(e, () => loadIssues(true))); }
  }

  /* ---------- event detail ---------- */
  function openEvent(e) {
    if (closeDrawer) closeDrawer();
    let mins = 10; let recur = null;
    const body = h('div', { class: 'lnk-body mon-detail' }); const around = h('div', { class: 'mon-around' });
    const title = h('h2', null, `${KIND[e.kind] || e.kind}`);
    const aside = h('aside', { class: 'drawer mon-drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'รายละเอียดเหตุการณ์' },
      h('div', { class: 'drawer-head' }, title, h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'ปิด', onclick: () => closeDrawer && closeDrawer() }, svgIcon(IC.close))), body);
    st.drawerOpen = true;
    closeDrawer = addLayer(h('div', { class: 'drawer-wrap' }, aside), { onClose: () => { closeDrawer = null; st.drawerOpen = false; } });
    const dl = () => {
      const rows = [['เวลา', `${fmtFull(e.t)} (เวลาไทย)`], ['โครงการ', e.site], ['ชนิด', `${KIND[e.kind]} · ระดับ${LEVEL[e.level]}`], e.name ? [e.kind === 'tk' ? 'งาน' : 'ชื่อ', e.name] : null,
        e.status ? ['สถานะ', `${TASK_STATUS[e.status] || e.status}${e.ms ? ` · ใช้เวลา ${fmtDuration(e.ms)}` : ''}`] : null, e.page ? ['หน้า', e.page] : null,
        [e.device, e.browser, e.os].some(Boolean) ? ['อุปกรณ์', [e.device === 'server' ? 'ฝั่งเซิร์ฟเวอร์' : e.device, e.browser, e.os].filter(Boolean).join(' · ')] : null, e.x ? ['ข้อมูลเพิ่ม', e.x] : null,
        e.fp ? ['รหัสกลุ่ม', e.fp] : null].filter(Boolean);
      return h('dl', { class: 'meta mon-meta' }, rows.flatMap(([k, v]) => [h('dt', null, k), h('dd', { class: k === 'หน้า' || k === 'ข้อมูลเพิ่ม' || k === 'รหัสกลุ่ม' ? 'mon-mono' : null }, v)]));
    };
    const actions = () => h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => { if (await copyText(eventText(e, recur ? { total: recur, days: 7 } : {}))) toast('คัดลอกรายละเอียดแล้ว', 'success'); else toast('คัดลอกไม่ได้', 'error'); } }, svgIcon(ICONS.copy, 16), 'คัดลอกรายละเอียด'),
      e.fp ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { F.site = e.key; F.fp = e.fp; F.tab = 'feed'; F.level = ''; F.hours = 168; F.kinds = ['er', 'lg', 'tk', 'hc']; syncUrl(); closeDrawer(); drawFleet(); drawTabs(); drawTools(); loadFeed(true); } }, 'ดูทุกครั้งที่เกิดเหมือนกัน') : null,
      !F.site || F.site !== e.key ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { F.site = e.key; F.fp = ''; F.tab = 'feed'; syncUrl(); closeDrawer(); drawFleet(); drawTabs(); drawTools(); loadFeed(true); } }, 'ดูเฉพาะโครงการนี้') : null);
    const render = () => body.replaceChildren(
      h('div', { class: `mon-msg mon-l-${e.level}` }, svgIcon(kindIcon(e), 18), h('p', null, headline(e) || '(ไม่มีข้อความ)')),
      recur ? h('p', { class: 'mon-recur' }, `เกิดแบบเดียวกัน ${fmt(recur)} ครั้งใน 7 วันที่ผ่านมา`) : null, actions(), dl(),
      h('section', { class: 'lnk-sec' }, h('h3', null, 'สิ่งที่เกิดขึ้นก่อนและหลัง'),
        h('div', { class: 'tabs mon-seg', role: 'group', 'aria-label': 'ช่วงเวลา' }, [[5, '±5 นาที'], [10, '±10 นาที'], [30, '±30 นาที']].map(([n, t]) => h('button', { class: 'tab', type: 'button', 'aria-pressed': String(mins === n), onclick: () => { mins = n; render(); loadAround(); } }, t))),
        h('p', { class: 'hint' }, 'รวมการเปิดหน้าและเหตุการณ์ผู้ใช้ของโครงการนี้ · จุดเขียวหน้าเวลา = ผู้เข้าชมคนเดียวกันในวันเดียวกัน (ไม่ทราบตัวตน)'), around));
    render(); loadAround();
    async function loadAround() {
      around.replaceChildren(h('div', { class: 'skeleton', style: 'height:120px' }));
      try {
        const d = await call('around', { key: e.key, t: e.t, mins }); if (!closeDrawer) return;
        if (e.fp && recur === null) { try { recur = (await call('feed', { key: e.key, fp: e.fp, kinds: 'er,lg,tk,hc', hours: 168, limit: 1 })).total; render(); } catch { recur = 0; } }
        const me = d.items.find((x) => x.t === e.t && x.kind === e.kind && x.name === e.name && x.msg === e.msg);
        const same = (x) => (me && me.v && x.v === me.v && x !== me ? 'mon-same' : '');
        const list = h('div', { class: 'mon-list mon-around-list' }, d.items.length ? d.items.map((x) => evRow(x, openEvent, true, x === me ? 'mon-current' : same(x))) : h('p', { class: 'muted' }, 'ไม่มีเหตุการณ์อื่นในช่วงนี้'));
        const host = around; host.replaceChildren(list, d.more ? h('p', { class: 'hint' }, `แสดง ${fmt(d.items.length)} จาก ${fmt(d.total)} รายการ — ลดช่วงเวลาเพื่อดูเฉพาะที่ใกล้เคียง`) : null);
        const cur = host.querySelector('.mon-current'); if (cur) cur.scrollIntoView({ block: 'center' });
      } catch (err) { around.replaceChildren(notice('error', 'โหลดเหตุการณ์ใกล้เคียงไม่ได้', err.message)); }
    }
  }

  /* ---------- how to send logs ---------- */
  function snippetsDialog() {
    const items = (st.fleet && st.fleet.items) || [];
    if (!items.length) { toast('ยังไม่มีโครงการ — เพิ่มโครงการก่อน', 'info'); return; }
    const cached = cacheGet('prj:list'); const origin = String((cached && cached.d.base) || location.origin).replace(/\/+$/, '');
    const sel = h('select', { 'aria-label': 'โครงการ' }, items.map((p) => h('option', { value: p.key, selected: p.key === (F.site || items[0].key) }, p.name)));
    const out = h('div', null); let mm = null;
    const box = (text, label) => h('div', { class: 'prj-code' }, h('pre', null, h('code', null, text)), h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => { if (await copyText(text)) toast(`คัดลอก${label}แล้ว`, 'success'); } }, svgIcon(ICONS.copy, 16), 'คัดลอก'));
    const draw = () => {
      const p = items.find((x) => x.key === sel.value) || items[0]; const host = (p.url || '').replace(/^https?:\/\//, '').replace(/[/?#].*$/, '');
      const s = logSnippets(origin, p.key, host);
      out.replaceChildren(h('h3', null, 'เว็บไซต์ (ฝั่งผู้ใช้)'), h('p', { class: 'hint' }, 'ข้อผิดพลาดของหน้าเว็บ promise ที่พลาด และ fetch ที่ตอบ 5xx ถูกจับให้อัตโนมัติ ไม่ต้องเขียนเพิ่ม — เขียนเองเมื่ออยากบันทึกเหตุการณ์สำคัญหรือจับเวลางาน'), box(s.web, 'โค้ดเว็บ'),
        h('h3', null, 'ระบบ Apps Script (ฝั่งเซิร์ฟเวอร์ / งานตั้งเวลา)'), h('p', { class: 'hint' }, 'ให้ทริกเกอร์หรือฟังก์ชันฝั่งเซิร์ฟเวอร์รายงานผลงานเข้ามา — ใช้ชื่อโดเมนที่อนุญาตของโครงการเป็นค่า h'), box(s.server, 'โค้ด Apps Script'),
        h('h3', null, 'สถานะเว็บ'), h('p', { class: 'hint' }, 'ไม่ต้องติดตั้งอะไร — ระบบเปิดที่อยู่เว็บของโครงการทุก 10 นาที ล่ม 2 รอบติดกันจึงแจ้งว่า “เข้าเว็บไม่ได้” (ปิดได้ที่ Script property ANA_PING = off)'));
    };
    sel.addEventListener('change', draw); draw();
    mm = modal('วิธีส่งบันทึกเข้ามาดูที่นี่', [privacyNotice({ detail: 'ระบบตัดอีเมล เบอร์โทร เลขยาว และ query string ออกให้อีกชั้นหนึ่ง แต่ไม่รับประกันว่าตัดชื่อหรือข้อมูลอื่นได้ครบ — อย่าใส่ข้อมูลผู้ป่วยในข้อความบันทึก'  }), field('โครงการ', sel).root, out],
      [h('button', { class: 'btn', type: 'button', onclick: () => mm.close() }, 'ปิด')], { wide: true });
  }

  /* ---------- load / refresh ---------- */
  async function loadFleet() {
    const my = ++st.seq;
    try { const d = await call('monitor'); if (my !== st.seq) return; st.fleet = d; st.updated = Date.now(); updated.textContent = `อัปเดตล่าสุด ${fmtClock(st.updated)}`; drawChips(); drawFleet(); drawTools(true); }
    catch (e) { if (my === st.seq && !st.fleet) fleetBox.replaceChildren(problem(e, () => loadFleet())); else if (my === st.seq) toast(`อัปเดตสถานะไม่สำเร็จ — ${e.message}`, 'error', 4000); }
  }
  async function reloadAll(manual) {
    refreshBtn.classList.add('is-loading');
    await Promise.all([loadFleet(), F.tab === 'issues' ? loadIssues(manual && !st.issues) : loadFeed(manual && !st.feed)]);
    refreshBtn.classList.remove('is-loading');
  }
  function schedule() {
    if (timer) { clearInterval(timer); timer = null; }
    if (st.auto) timer = setInterval(() => { if (!document.hidden && !st.drawerOpen && !(st.feed && st.feed.items.length > 60)) reloadAll(false); }, 30000);
  }

  /* ---------- go ---------- */
  fleetBox.replaceChildren(...[1, 2, 3].map(() => h('div', { class: 'skeleton', style: 'height:58px;margin-bottom:.5rem' })));
  drawTabs(); drawTools(); drawChips(); schedule();
  await Promise.all([loadFleet(), F.tab === 'issues' ? loadIssues(true) : loadFeed(true)]);
  return () => { st.seq += 1; st.fseq += 1; if (timer) clearInterval(timer); closeAllLayers(); };
}
