// หน้าแรก 3 มิติ: "ผังโครงการและเว็บไซต์" — หนึ่งสถานี = หนึ่งโครงการ/เว็บไซต์ที่ผู้ใช้ติดตามไว้ (isometric canvas, ไม่ใช้ไลบรารีเพิ่ม)
// ข้อมูล: GAS action `projects` op `floor` (ครั้งเดียวต่อช่วงเวลา, cache ฝั่งเซิร์ฟเวอร์ 60 วินาที) · ถ้า Apps Script ยังเก่า ใช้ list + stats แทน · ยังไม่ล็อกอิน = ข้อมูลตัวอย่าง
// ใช้งาน: const stop = mountSiteFloor(hostElement, { onOpen: (key) => panel.open(key) });  → stop() ตอนออกจากหน้า
import { h, svgIcon } from '../core/dom.js';
import { ICONS } from '../core/icons.js';
import { loadCss } from '../core/css.js';
import { notice } from '../core/notices.js';
import { toast } from '../core/toast.js';
import { downloadText } from '../core/download.js';
import { getSession } from '../core/auth.js';
import { backendConfigured } from '../core/api.js';
import { sessionCall, cacheGet, cacheSet } from '../core/ops.js';
import { deltaChip, ago } from '../core/charts.js';
import { MAX_SITES, PALETTE, IDLE_COL, DEFAULTS, hhmm, fmt, hostOf, normalizeFloor, fromListStats, pickSites, stateOf, trendOf, perFigure, visitors, timeRange, crowdPeak, summarize, insights, sitesCsv, makeSample } from './site-engine.js';

const G = 12; const CORR = 6; const ENT = [0.6, CORR]; const EXIT = [11.4, CORR]; const CAP = 16;
const RANGES = [[7, '7 วัน'], [30, '30 วัน'], [90, '90 วัน']]; const RANGE_KEY = 'sand:home3d:days';
const STATE_TXT = { ok: 'ปกติ', paused: 'หยุดเก็บสถิติ', idle: 'ยังไม่มีข้อมูล', silent: 'เงียบผิดปกติ' };
const STATE_COL = { ok: '#16a34a', paused: '#f59e0b', idle: '#94a3b8', silent: '#ef4444' };
const SCREEN = { paused: '#475569', idle: '#334155', silent: '#7f1d1d' };
const WALK = '#64748b';
const PAL = {
  light: { floor: '#e9eef3', grid: '#d3dbe3', ink: '#1f2937', pill: 'rgba(255,255,255,.95)', pillLine: '#cfd8e1', desk: '#b08968', screen: '#334155' },
  dark: { floor: '#1c2535', grid: '#2b374b', ink: '#e5e7eb', pill: 'rgba(17,24,39,.93)', pillLine: '#374357', desk: '#8a6a4f', screen: '#0f172a' },
};
const rgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const shade = (c, f) => `rgb(${rgb(c).map((v) => Math.round(f <= 1 ? v * f : v + (255 - v) * (f - 1))).join(',')})`;
const short = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const bkkMinutes = () => { const d = new Date(); return ((d.getUTCHours() + 7) % 24) * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60; };

/** Station positions: first half on the back row (door faces +y), the rest on the front row (door faces -y). */
export function layout(n) {
  const top = Math.ceil(n / 2); const out = [];
  for (let i = 0; i < n; i++) {
    const isTop = i < top; const cnt = isTop ? top : n - top; const k = isTop ? i : i - top; const x = ((k + 0.5) * G) / cnt;
    out.push({ top: isTop, c: [x, isTop ? 1.7 : 10.3], door: [x, isTop ? 2.9 : 9.1], dir: isTop ? 1 : -1, hx: 1, hy: 1 });
  }
  return out;
}
const slot = (l, i) => { const col = Math.floor(i / 6); const lat = col === 0 ? 0 : (col % 2 ? 1 : -1) * Math.ceil(col / 2) * 0.42; return [l.door[0] + lat, l.door[1] + l.dir * (0.25 + (i % 6) * 0.28)]; };
function along(pts, f) {
  const L = []; let tot = 0; for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); L.push(d); tot += d; }
  let rem = Math.min(1, Math.max(0, f)) * tot;
  for (let i = 0; i < L.length; i++) { if (rem <= L[i] || i === L.length - 1) { const u = L[i] ? Math.min(1, rem / L[i]) : 1; return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * u, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * u]; } rem -= L[i]; }
  return pts[pts.length - 1];
}

export function mountSiteFloor(host, opts = {}) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const cfg = { ...DEFAULTS };
  const S = { days: 30, all: [], extra: {}, source: 'sample', busy: false, err: null, at: 0, fromCache: false, legacy: false };
  const saved = Number(localStorage.getItem(RANGE_KEY)); if (RANGES.some(([n]) => n === saved)) S.days = saved;
  let sites = []; let more = 0; let LAY = []; let vis = []; let range = { from: cfg.open, to: cfg.close }; let pf = 1; let sm = summarize([]); let hits = [];
  let started = false; let t = 0; let playing = false; let speed = 20; let raf = 0; let last = 0; let lastMin = -1; let seq = 0; let dead = false; let onScreen = true; let hover = -1;
  let tw = 60; let ox = 0; let oy = 0; let dpr = 1; let pal = PAL.light; let font = 'sans-serif'; let ctx; let timer = 0;

  // ---------- DOM ----------
  const cv = h('canvas', { role: 'img', 'aria-label': 'ผัง 3 มิติของโครงการและเว็บไซต์ที่ติดตาม' });
  const clock = h('div', { class: 's3-clock' }); const sub = h('small'); const live = h('small', { class: 's3-live' }); const chip = h('div', { class: 's3-chip' }); const tip = h('div', { class: 's3-tip', role: 'status', hidden: true });
  const scroller = h('div', { class: 's3-scroll' }, cv);
  const stage = h('div', { class: 's3-stage' }, h('div', { class: 's3-clockbox' }, clock, sub, live), chip, scroller, tip);
  const prog = h('i'); const banner = h('div', { class: 's3-banner' }); const status = h('span', { class: 's3-status', role: 'status', 'aria-live': 'polite' });
  const rangeEl = h('div', { class: 'tabs s3-range', role: 'tablist', 'aria-label': 'ช่วงเวลา' });
  const refreshBtn = h('button', { class: 'btn btn-sm', type: 'button', onclick: () => load(true) }, svgIcon(ICONS.rotate, 16), 'รีเฟรช');
  const csvBtn = h('button', { class: 'btn btn-sm', type: 'button', disabled: true, onclick: () => { downloadText(`\ufeff${sitesCsv(S.all, S.days)}`, `โครงการและเว็บไซต์_${S.days}วัน_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.csv`, 'text/csv'); toast('ส่งออกรายงานแล้ว', 'success'); } }, svgIcon(ICONS.download, 16), 'ส่งออก CSV');
  const playBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => (playing ? pause() : play()) });
  const spd = h('select', { 'aria-label': 'ความเร็วการเล่น', onchange: () => { speed = Number(spd.value); } }, [[10, 'ช้า'], [20, 'ปกติ'], [40, 'เร็ว'], [80, 'เร็วมาก']].map(([v, l]) => h('option', { value: v, selected: v === 20 }, `${l} (${v} นาที/วินาที)`)));
  const legend = h('div', { class: 's3-legend', 'aria-label': 'โครงการที่แสดงในผัง' });
  const kpis = h('div', { class: 's3-kpis' }); const hoursEl = h('div', { class: 's3-hours', role: 'group', 'aria-label': 'จำนวนการเปิดหน้ารายชั่วโมง กดเพื่อข้ามไปช่วงเวลานั้น' });
  const insightBox = h('div', { class: 's3-insights' }); const tableBox = h('div', { class: 's3-table-wrap' }); const note = h('p', { class: 's3-note' });
  host.append(h('section', { class: 's3', 'aria-labelledby': 's3-title' },
    h('div', { class: 's3-head' }, h('div', null, h('h2', { id: 's3-title' }, 'โครงการและเว็บไซต์ที่ดูแล · ผัง 3 มิติ'), status), h('div', { class: 's3-tools' }, rangeEl, refreshBtn, csvBtn)),
    banner, stage, h('div', { class: 's3-progress', 'aria-hidden': 'true' }, prog),
    h('div', { class: 's3-controls' }, playBtn,
      h('button', { class: 'btn', type: 'button', onclick: () => { t = range.from; lastMin = -1; playing = true; sync(); } }, svgIcon(ICONS.rotate, 16), 'เล่นใหม่ตั้งแต่เช้า'),
      h('button', { class: 'btn', type: 'button', onclick: () => { t = Math.min(range.to, Math.max(range.from, bkkMinutes())); lastMin = -1; pause(); } }, svgIcon(ICONS.eye, 16), 'ไปที่เวลาปัจจุบัน'),
      h('button', { class: 'btn', type: 'button', onclick: () => { t = crowdPeak(vis, range); lastMin = -1; pause(); } }, svgIcon(ICONS.focus, 16), 'ไปที่ช่วงคนแน่นสุด'),
      h('label', { class: 's3-field' }, h('span', null, 'ความเร็ว'), spd)),
    legend, kpis,
    h('div', { class: 's3-grid' },
      h('section', { class: 'card', 'aria-labelledby': 's3-h-hours' }, h('h3', { id: 's3-h-hours' }, 'ช่วงเวลาที่คนเข้าเว็บ (เฉลี่ยต่อวัน)'), hoursEl),
      h('section', { class: 'card', 'aria-labelledby': 's3-h-ai' }, h('h3', { id: 's3-h-ai' }, 'ตัวช่วยวิเคราะห์'), insightBox)),
    h('section', { class: 'card s3-tablecard', 'aria-labelledby': 's3-h-tbl' }, h('h3', { id: 's3-h-tbl' }, 'ทุกโครงการ'), tableBox), note));

  // ---------- data ----------
  async function fetchReal(days) {
    const ovP = sessionCall('projects', 'overview', { days }).catch(() => null);   // devices / referrers / daily series for the insights (optional)
    let floor;
    try {
      floor = normalizeFloor(await sessionCall('projects', 'floor', { days }));
      if (!floor) { const bad = new Error('รูปแบบข้อมูลจาก Apps Script ไม่ตรงกับเวอร์ชันล่าสุด'); /** @type {any} */ (bad).code = 'UNKNOWN_ACTION'; throw bad; }
      S.legacy = false;
    } catch (e) {
      if (!e || e.code !== 'UNKNOWN_ACTION') throw e;
      const list = await sessionCall('projects', 'list'); const top = pickSites((list.items || []).map((p) => ({ ...p, pv: p.pv7 || 0, byHour: [] }))).sites; const by = {};
      await Promise.all(top.map(async (p) => { try { by[p.key] = await sessionCall('projects', 'stats', { key: p.key, days }); } catch { /* that project stays empty */ } }));
      floor = fromListStats(list, by, days); S.legacy = true;
    }
    const ov = await ovP;
    return { floor, extra: ov ? { devices: ov.devices, referrers: ov.referrers, byDay: ov.byDay } : {} };
  }
  async function load(manual = false) {
    const my = ++seq; const days = S.days; banner.replaceChildren();
    if (!getSession() || !backendConfigured()) { useSample(backendConfigured() ? 'เข้าสู่ระบบเพื่อดูโครงการจริงของคุณ' : 'ยังไม่ได้ตั้งค่า Backend'); return; }
    if (!S.all.length || S.source === 'sample') { const c = cacheGet(`fl:${days}`); const f = c && normalizeFloor(c.d && c.d.floor); if (f && f.sites.length) { apply(f, c.d.extra || {}, 'real', c.t, true); } }
    S.busy = true; S.err = null; drawStatus();
    try {
      const { floor, extra } = await fetchReal(days); if (my !== seq || dead) return;
      if (!floor.sites.length) { useSample('ยังไม่มีโครงการที่ติดตาม — เพิ่มโครงการด้านล่าง แล้วผังนี้จะแสดงเว็บไซต์ของคุณ'); return; }
      if (!S.legacy) cacheSet(`fl:${days}`, { floor, extra });
      apply(floor, extra, 'real', Date.now(), false);
      if (S.legacy) banner.append(notice('warn', 'ข้อมูลรายชั่วโมงจำกัด', 'Apps Script ยังเป็น Analytics.gs เวอร์ชันเก่า (ไม่มี op floor) — วางไฟล์ใหม่แล้ว Deploy เวอร์ชันใหม่ ผังจะแม่นยำและเร็วขึ้น'));
    } catch (e) {
      if (my !== seq || dead) return; S.err = e;
      if (S.all.length && S.source === 'real') { if (manual) toast(`อัปเดตข้อมูลไม่สำเร็จ — ${e.message}`, 'error', 5000); } else { banner.append(notice('error', 'โหลดข้อมูลโครงการไม่ได้', e.message || 'เกิดข้อผิดพลาด')); useSample(null); }
    } finally { if (my === seq && !dead) { S.busy = false; drawStatus(); } }
  }
  function useSample(msg) {
    const d = makeSample(S.days); if (msg) banner.replaceChildren(notice('info', 'กำลังแสดงข้อมูลตัวอย่าง', msg));
    apply(d, d.extra, 'sample', 0, false); S.busy = false; drawStatus();
  }
  function apply(floor, extra, source, at, fromCache) {
    S.source = source; S.at = at; S.fromCache = fromCache; S.extra = extra || {}; S.all = floor.sites; S.days = floor.days || S.days;
    const pick = pickSites(S.all); sites = pick.sites; more = pick.more; LAY = layout(sites.length); sm = summarize(S.all); pf = perFigure(sites, S.days);
    vis = visitors(sites, S.days, pf, cfg); range = timeRange(vis, cfg);
    if (!started || t < range.from || t > range.to) t = Math.min(range.to, Math.max(range.from, bkkMinutes())); started = true;
    lastMin = -1; hover = -1; tip.hidden = true;
    chip.textContent = source === 'sample' ? 'ข้อมูลตัวอย่าง' : 'ข้อมูลจริง'; chip.dataset.kind = source;
    cv.setAttribute('aria-label', `ผัง 3 มิติ ${sites.length} โครงการ · เปิดหน้ารวม ${fmt(sm.pv)} ครั้งใน ${S.days} วัน`);
    csvBtn.disabled = false; drawAll();
  }

  // ---------- panels ----------
  const dot = (c) => h('i', { class: 's3-dot', style: `background:${c}` });
  const colOf = (i) => { const st = stateOf(sites[i]); return st === 'ok' ? PALETTE[i % PALETTE.length] : st === 'silent' ? STATE_COL.silent : IDLE_COL; };
  const open = (key) => { if (S.source === 'real' && opts.onOpen) opts.onOpen(key); };
  function drawStatus() {
    refreshBtn.disabled = S.busy; refreshBtn.classList.toggle('is-loading', S.busy);
    if (S.busy) { status.className = 's3-status is-busy'; status.replaceChildren(S.all.length ? 'กำลังอัปเดตข้อมูล…' : 'กำลังโหลดข้อมูล…'); return; }
    if (S.source === 'sample') { status.className = 's3-status'; status.replaceChildren('ตัวอย่างการทำงานของผัง'); return; }
    if (S.err) { status.className = 's3-status is-err'; status.replaceChildren(dot('#ef4444'), 'อัปเดตล่าสุดไม่สำเร็จ · แสดงข้อมูลเดิม'); return; }
    status.className = 's3-status is-ok'; status.replaceChildren(dot('#16a34a'), `อัปเดต ${ago(S.at)}${S.fromCache ? ' · จากข้อมูลที่จำไว้' : ''} · ย้อนหลัง ${S.days} วัน`);
  }
  function drawRange() { rangeEl.replaceChildren(...RANGES.map(([n, l]) => h('button', { class: 'tab', type: 'button', role: 'tab', 'aria-selected': String(S.days === n), onclick: () => setDays(n) }, l))); }
  function setDays(n) { if (n === S.days) return; S.days = n; try { localStorage.setItem(RANGE_KEY, String(n)); } catch { /* ignore */ } drawRange(); if (S.source === 'sample') { useSample(null); return; } load(); }
  function kpi(label, value, hint, extra) { return h('div', { class: 's3-kpi' }, h('span', null, label, extra || null), h('b', null, value), hint ? h('small', null, hint) : null); }
  function drawKpis() {
    kpis.replaceChildren(
      kpi('การเปิดหน้า', fmt(sm.pv), `ใน ${S.days} วัน · ไม่นับบอท`, sm.prev !== null ? deltaChip(sm.pv, sm.prev) : null),
      kpi('ผู้เข้าชม', fmt(sm.uv), 'นับรายวันต่อโครงการ'),
      kpi('ออนไลน์ตอนนี้', sm.realtime === null ? '–' : fmt(sm.realtime), 'ภายใน 5 นาทีล่าสุด'),
      kpi('โครงการ', `${fmt(sm.tracking)}/${fmt(sm.total)}`, 'กำลังเก็บสถิติ'),
      kpi('ช่วงคนเข้ามากสุด', sm.peakHour >= 0 ? `${String(sm.peakHour).padStart(2, '0')}:00–${String((sm.peakHour + 1) % 24).padStart(2, '0')}:00` : '–', sm.top && sm.top.pv ? `เด่นสุด: ${sm.top.name}` : null));
  }
  function drawHours() {
    const a = Math.floor(range.from / 60); const b = Math.ceil(range.to / 60); const mx = Math.max(1, ...sm.hourly.slice(a, b)); const per = Math.max(1, S.days);
    hoursEl.replaceChildren(...Array.from({ length: Math.max(0, b - a) }, (_, i) => { const hr = a + i; const n = sm.hourly[hr] || 0;
      return h('button', { type: 'button', class: `s3-hbar${hr === sm.peakHour ? ' peak' : ''}`, 'data-h': hr, 'aria-label': `${String(hr).padStart(2, '0')}:00 เฉลี่ย ${fmt(Math.round(n / per))} ครั้งต่อวัน`, onclick: () => { t = hr * 60 + 30; lastMin = -1; pause(); } },
        h('i', { style: `height:${Math.max(n ? 4 : 1, (n / mx) * 100)}%` }), h('small', null, String(hr).padStart(2, '0')), h('em', null, n ? fmt(Math.round(n / per)) : '')); }));
  }
  function drawInsights() {
    const list = insights(S.all, S.days, S.extra);
    insightBox.replaceChildren(h('ul', { class: 's3-ilist' }, list.map((x) => h('li', { class: `tone-${x.tone}` }, svgIcon(x.tone === 'warn' ? ICONS.alert : x.tone === 'ok' ? ICONS.check : ICONS.eye, 18), h('span', null, x.text)))));
  }
  function drawLegend() {
    legend.replaceChildren(...sites.map((s, i) => h('button', { type: 'button', class: 's3-lg', title: `${STATE_TXT[stateOf(s)]} · เปิดรายละเอียด`, onclick: () => open(s.key) }, h('i', { style: `background:${colOf(i)}` }), s.name)),
      more ? h('span', { class: 's3-lg more' }, `+${more} โครงการในตารางด้านล่าง`) : null, h('span', { class: 's3-lg' }, h('i', { style: `background:${WALK}` }), 'กำลังเดินเข้า/ออก'), h('span', { class: 's3-lg' }, h('i', { style: `background:${STATE_COL.silent}` }), 'เงียบผิดปกติ'));
  }
  function drawTable() {
    const rows = S.all.filter((x) => x.status !== 'deleted');
    tableBox.replaceChildren(h('table', { class: 's3-table' }, h('thead', null, h('tr', null, ['โครงการ', 'เว็บไซต์', 'เปิดหน้า', 'เทียบก่อนหน้า', 'ผู้เข้าชม', 'ออนไลน์', 'สถานะ'].map((x) => h('th', null, x)))),
      h('tbody', null, rows.map((s) => { const st = stateOf(s); const tr = trendOf(s);
        return h('tr', null, h('td', null, h('button', { type: 'button', class: 'rowbtn', onclick: () => open(s.key), title: 'เปิดรายละเอียด' }, s.name)), h('td', { class: 's3-cut', title: s.url }, hostOf(s.url) || '–'), h('td', null, fmt(s.pv)),
          h('td', null, s.prev === null ? '–' : tr === null ? '0%' : deltaChip(s.pv, s.prev)), h('td', null, fmt(s.uv)), h('td', null, s.realtime === null ? '–' : fmt(s.realtime)),
          h('td', null, h('span', { class: `s3-pill st-${st}` }, STATE_TXT[st]))); }))));
  }
  function drawNote() {
    note.textContent = `${S.source === 'sample' ? 'ข้อมูลตัวอย่างเพื่อแสดงการทำงานของผัง · ' : ''}คน 1 คนในภาพ ≈ ${fmt(pf)} การเปิดหน้า · ภาพเป็น "วันทั่วไป" ที่เฉลี่ยจากช่วง ${S.days} วัน (เวลาไทย) ไม่ใช่ตัวเลขของวันใดวันหนึ่ง · เวลาเดินเข้า–ออกและเวลาอยู่ที่สถานีเป็นเวลาสมมติเพื่อให้มองเห็นได้ · สถิติไม่ใช้คุกกี้ ไม่เก็บ IP และไม่นับบอท`;
  }
  function drawAll() { drawRange(); drawStatus(); drawKpis(); drawHours(); drawInsights(); drawLegend(); drawTable(); drawNote(); sync(); }

  // ---------- control ----------
  function play() { if (t >= range.to - 1) t = range.from; playing = true; sync(); }
  function pause() { playing = false; sync(); }
  function sync() { playBtn.replaceChildren(svgIcon(playing ? '<path d="M8 5v14M16 5v14"/>' : '<path d="M7 4l13 8-13 8z"/>', 16), playing ? 'หยุด' : 'เล่นย้อนดูทั้งวัน'); }

  // ---------- geometry ----------
  const P = (x, y, z = 0) => [ox + ((x - y) * tw) / 2, oy + ((x + y) * tw) / 4 - z];
  const Z = (u) => u * tw * 0.5;
  function resize() {
    const r = scroller.getBoundingClientRect(); const avail = Math.max(280, Math.round(r.width)); const w = Math.max(avail, 600);
    const hgt = Math.round(w * 0.58); dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = w * dpr; cv.height = hgt * dpr; cv.style.width = `${w}px`; cv.style.height = `${hgt}px`; tw = Math.min(w / 12.6, (hgt * 0.8) / 6); ox = w / 2; oy = hgt * 0.14;
    scroller.scrollLeft = (w - avail) / 2; lastMin = -1;
  }

  // ---------- drawing ----------
  const poly = (pts, fill, stroke, lw = 1) => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); } };
  function box(x, y, w, d, hu, col, z0 = 0) {
    const x0 = x - w / 2; const x1 = x + w / 2; const y0 = y - d / 2; const y1 = y + d / 2; const a = Z(z0); const b = Z(z0 + hu);
    poly([P(x0, y1, a), P(x1, y1, a), P(x1, y1, b), P(x0, y1, b)], shade(col, 0.82)); poly([P(x1, y0, a), P(x1, y1, a), P(x1, y1, b), P(x1, y0, b)], shade(col, 0.66));
    poly([P(x0, y0, b), P(x1, y0, b), P(x1, y1, b), P(x0, y1, b)], shade(col, 1.08));
  }
  function person(x, y, col) {
    const [sx, sy] = P(x, y); const s = tw * 0.075;
    ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.beginPath(); ctx.ellipse(sx, sy, s * 1.2, s * 0.55, 0, 0, 7); ctx.fill();
    ctx.fillStyle = col; ctx.beginPath(); ctx.roundRect(sx - s * 0.85, sy - s * 3.3, s * 1.7, s * 3.3, s * 0.7); ctx.fill();
    ctx.fillStyle = '#f1c9a5'; ctx.beginPath(); ctx.arc(sx, sy - s * 4, s * 0.85, 0, 7); ctx.fill();
  }
  function pill(text, x, y, color) {
    ctx.font = `600 ${Math.max(10, tw * 0.15)}px ${font}`; const w = ctx.measureText(text).width + 14; const hh = Math.max(18, tw * 0.27);
    ctx.fillStyle = pal.pill; ctx.strokeStyle = color || pal.pillLine; ctx.lineWidth = 1; ctx.beginPath(); ctx.roundRect(x - w / 2, y - hh / 2, w, hh, hh / 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = color || pal.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, x, y + 0.5);
  }
  function frameState(tt) {
    const work = sites.map(() => []); const cum = sites.map(() => 0);
    for (const v of vis) { if (tt >= v.start) cum[v.site] += 1; if (tt >= v.start && tt < v.end) work[v.site].push(v); }
    const rank = new Map(); work.forEach((a) => a.sort((x, y) => x.start - y.start || x.id - y.id).forEach((v, i) => rank.set(v.id, i)));
    return { work, cum, rank };
  }
  function place(v, tt, F) {
    if (tt < v.enter || tt >= v.exit) return null; const l = LAY[v.site]; const dx = l.door[0];
    if (tt < v.start) return { pos: along([ENT, [dx, CORR], slot(l, F.work[v.site].length)], (tt - v.enter) / (v.start - v.enter)), state: 'walk' };
    if (tt < v.end) return { pos: slot(l, F.rank.get(v.id) ?? 0), state: 'work' };
    return { pos: along([slot(l, 0), [dx, CORR], EXIT], (tt - v.end) / (v.exit - v.end)), state: 'walk' };
  }

  function draw(now) {
    const w = cv.width / dpr; const hgt = cv.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, hgt);
    const F = frameState(t); const items = []; const mx = Math.max(1, ...sites.map((s) => s.pv)); const topKey = sm.top && sm.top.pv > 0 ? sm.top.key : ''; const Hz = Z(1.4); hits = [];
    poly([P(0, 0), P(G, 0), P(G, G), P(0, G)], pal.floor);
    ctx.strokeStyle = pal.grid; ctx.lineWidth = 1; ctx.beginPath(); for (let i = 0; i <= G; i++) { const a = P(i, 0); const b = P(i, G); const c = P(0, i); const d = P(G, i); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.moveTo(c[0], c[1]); ctx.lineTo(d[0], d[1]); } ctx.stroke();
    ctx.globalAlpha = 0.5; poly([P(0.2, CORR - 0.5), P(G - 0.2, CORR - 0.5), P(G - 0.2, CORR + 0.5), P(0.2, CORR + 0.5)], null, pal.grid, 1.5); ctx.globalAlpha = 1;
    sites.forEach((s, i) => {
      const l = LAY[i]; const [cx, cy] = l.c; const x0 = cx - l.hx; const x1 = cx + l.hx; const y0 = cy - l.hy; const y1 = cy + l.hy; const st = stateOf(s); const col = colOf(i); const lit = st === 'ok';
      ctx.globalAlpha = 0.12 + 0.4 * (s.pv / mx); poly([P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)], col); ctx.globalAlpha = 1;
      poly([P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)], null, hover === i ? pal.ink : col, hover === i ? 2.4 : 1.2);
      if (s.key === topKey) { ctx.globalAlpha = reduced ? 1 : 0.55 + 0.45 * Math.sin(now / 300); poly([P(x0 - 0.25, y0 - 0.25), P(x1 + 0.25, y0 - 0.25), P(x1 + 0.25, y1 + 0.25), P(x0 - 0.25, y1 + 0.25)], null, '#f59e0b', 2.5); ctx.globalAlpha = 1; }
      const pts = [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1), P(x0, y0, Hz), P(x1, y0, Hz)]; hits.push({ i, x0: Math.min(...pts.map((p) => p[0])), x1: Math.max(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])), y1: Math.max(...pts.map((p) => p[1])) });
      items.push({ d: cx + cy - l.hx - l.hy, f: () => { if (l.top) poly([P(x0, y0), P(x1, y0), P(x1, y0, Hz), P(x0, y0, Hz)], shade(col, 1)); poly([P(x0, y0), P(x0, y1), P(x0, y1, Hz), P(x0, y0, Hz)], shade(col, 0.78)); } });
      items.push({ d: cx + cy, f: () => {
        box(cx, cy, 1.3, 0.5, 0.45, pal.desk);
        const glow = lit && (s.realtime > 0 || s.key === topKey) && !reduced ? 1 + 0.12 * Math.sin(now / 260) : 1;
        box(cx, cy, 0.55, 0.08, 0.5, lit ? shade(col, glow) : SCREEN[st] || pal.screen, 0.45);
        const [bx, by] = P(cx, cy, Z(1.2)); ctx.fillStyle = STATE_COL[st]; ctx.globalAlpha = lit || st === 'silent' ? 0.55 + (reduced ? 0.45 : 0.45 * Math.sin(now / 350 + i)) : 1; ctx.beginPath(); ctx.arc(bx, by, Math.max(3, tw * 0.05), 0, 7); ctx.fill(); ctx.globalAlpha = 1;
      } });
      const ph = s.pv ? 0.3 + 1.7 * (s.pv / mx) : 0.1; items.push({ d: cx + cy + 0.3, f: () => box(x1 - 0.22, cy + l.dir * 0.05, 0.24, 0.24, ph, col) });   // data pillar: height = page views
    });
    items.push({ d: ENT[0] + ENT[1], f: () => box(ENT[0], ENT[1], 0.8, 0.8, 1.2, '#64748b') }, { d: EXIT[0] + EXIT[1], f: () => box(EXIT[0], EXIT[1], 0.8, 0.8, 1.2, '#64748b') });
    let inside = 0;
    for (const v of vis) {
      const r = place(v, t, F); if (!r) continue; inside += 1;
      if (r.state === 'work' && (F.rank.get(v.id) ?? 0) >= CAP) continue;
      items.push({ d: r.pos[0] + r.pos[1] + 0.01, f: () => person(r.pos[0], r.pos[1], r.state === 'work' ? colOf(v.site) : WALK) });
    }
    items.sort((a, b) => a.d - b.d).forEach((it) => it.f());
    sites.forEach((s, i) => {
      const l = LAY[i]; const wk = F.work[i].length; const st = stateOf(s);
      const [lx, ly] = l.top ? P(l.c[0], l.c[1] - l.hy, Hz) : P(l.c[0], l.c[1] + l.hy, 0); const off = l.top ? -tw * 0.22 : tw * 0.24; const hh = Math.max(18, tw * 0.27);
      pill(short(s.name, 22), lx, ly + off, st === 'silent' ? STATE_COL.silent : null);
      const line = st === 'ok' ? `≈${fmt(F.cum[i] * pf)} ครั้ง${s.realtime ? ` · ออนไลน์ ${fmt(s.realtime)}` : ''}` : STATE_TXT[st];
      pill(line, lx, ly + off + hh + 3, st === 'ok' ? (wk ? colOf(i) : null) : STATE_COL[st]);
    });
    for (const [tx, p0] of [['ทางเข้า', ENT], ['ทางออก', EXIT]]) { const [a, b] = P(p0[0], p0[1], Z(1.2)); ctx.font = `500 ${Math.max(10, tw * 0.14)}px ${font}`; ctx.fillStyle = pal.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillText(tx, a, b - 8); }
    const min = Math.floor(t);
    if (min !== lastMin) {
      lastMin = min; clock.textContent = hhmm(t); sub.textContent = 'วันทั่วไป · เฉลี่ยจากช่วงที่เลือก';
      const done = F.cum.reduce((a, b) => a + b, 0); live.textContent = `ในผังตอนนี้ ${fmt(inside)} คน · เปิดหน้าสะสม ≈${fmt(done * pf)}`;
      prog.style.width = `${Math.min(100, Math.max(0, ((t - range.from) / Math.max(1, range.to - range.from)) * 100))}%`;
      const hr = Math.floor(t / 60); [...hoursEl.children].forEach((b) => { if (Number(b.dataset.h) === hr) b.setAttribute('aria-current', 'time'); else b.removeAttribute('aria-current'); });
    }
  }

  // ---------- pointer ----------
  function stationAt(ev) {
    const r = cv.getBoundingClientRect(); const x = ev.clientX - r.left; const y = ev.clientY - r.top;
    const hit = hits.filter((q) => x >= q.x0 && x <= q.x1 && y >= q.y0 - tw * 0.55 && y <= q.y1 + tw * 0.2).sort((a, b) => (LAY[b.i].c[0] + LAY[b.i].c[1]) - (LAY[a.i].c[0] + LAY[a.i].c[1]))[0];
    return hit ? hit.i : -1;
  }
  function showTip(i, ev) {
    if (i < 0) { tip.hidden = true; return; }
    const s = sites[i]; const st = stateOf(s); const tr = trendOf(s); const sr = stage.getBoundingClientRect();
    tip.replaceChildren(h('b', null, s.name), h('small', null, hostOf(s.url) || '–'), h('span', null, `${fmt(s.pv)} ครั้ง · ผู้เข้าชม ${fmt(s.uv)}${tr === null ? '' : tr === 'new' ? ' · ใหม่' : ` · ${tr > 0 ? '+' : ''}${tr}%`}`), h('span', { class: `s3-pill st-${st}` }, STATE_TXT[st]), S.source === 'real' ? h('small', null, 'คลิกเพื่อเปิดรายละเอียด') : null);
    tip.hidden = false; const px = ev.clientX - sr.left; tip.style.left = `${Math.min(Math.max(8, px + 14), Math.max(8, sr.width - 230))}px`; tip.style.top = `${Math.max(8, ev.clientY - sr.top + 14)}px`;
  }
  cv.addEventListener('pointermove', (ev) => { const i = stationAt(ev); if (i !== hover) { hover = i; cv.style.cursor = i >= 0 && S.source === 'real' ? 'pointer' : 'default'; } showTip(i, ev); });
  cv.addEventListener('pointerleave', () => { hover = -1; tip.hidden = true; });
  cv.addEventListener('click', (ev) => { const i = stationAt(ev); if (i >= 0) open(sites[i].key); });

  // ---------- loop ----------
  function themeSync() { pal = document.documentElement.dataset.theme === 'dark' ? PAL.dark : PAL.light; font = getComputedStyle(document.body).fontFamily || 'sans-serif'; }
  function loop(now) {
    raf = requestAnimationFrame(loop); const dt = last ? Math.min(100, Math.max(0, now - last)) : 0; last = now; if (document.hidden || !onScreen || !sites.length) return;
    if (playing) { t = Math.min(range.to, t + (dt / 1000) * speed); if (t >= range.to) pause(); }
    draw(now);
  }
  loadCss('site3d').catch(() => {});
  ctx = cv.getContext('2d'); themeSync(); resize(); drawRange(); sync();
  const ro = new ResizeObserver(() => { resize(); if (sites.length) draw(performance.now()); }); ro.observe(scroller);
  const mo = new MutationObserver(themeSync); mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const io = typeof IntersectionObserver === 'function' ? new IntersectionObserver((e) => { onScreen = e[e.length - 1].isIntersecting; }) : null; if (io) io.observe(stage);
  const onVisible = () => { if (!document.hidden && !S.busy && S.at && S.source === 'real' && Date.now() - S.at > 120000) load(); };
  document.addEventListener('visibilitychange', onVisible); timer = window.setInterval(onVisible, 60000);
  load().then(() => { if (!dead && !reduced && sites.length) play(); });   // starts playing "now" unless the visitor prefers reduced motion
  raf = requestAnimationFrame(loop);
  return () => { dead = true; seq += 1; cancelAnimationFrame(raf); clearInterval(timer); ro.disconnect(); mo.disconnect(); if (io) io.disconnect(); document.removeEventListener('visibilitychange', onVisible); };
}
