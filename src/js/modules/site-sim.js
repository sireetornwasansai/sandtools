// หน้าแรก 3 มิติ: "ผังโครงการและเว็บไซต์" — หนึ่งสถานี = หนึ่งโครงการ/เว็บไซต์ที่ผู้ใช้ติดตามไว้ (isometric canvas, ไม่ใช้ไลบรารีเพิ่ม)
// ข้อมูล: GAS action `projects` op `floor` (ครั้งเดียวต่อช่วงเวลา, cache ฝั่งเซิร์ฟเวอร์ 60 วินาที) · ถ้า Apps Script ยังเก่า ใช้ list + stats แทน · ยังไม่ล็อกอิน = ข้อมูลตัวอย่าง
// คลิกสถานี → ซูมเข้า "ภายในระบบ": แต่ละหน้าของเว็บเป็นห้อง 3 มิติ เห็นคนเดินจากหน้าหนึ่งไปอีกหน้า (GAS op `projects/pages`)
// มุมมอง "ภาพรวมโรงพยาบาล" = ผังบริเวณโรงพยาบาลสันทรายจากภายนอก (ตึกโรงพยาบาลหลัก + ตึกอุบัติเหตุ–ฉุกเฉินทางซ้าย) — คลิกตึกเพื่อเข้าไปดูแผนก (ระบบ) ภายในตึก · ระบบยานพาหนะอยู่ตึกอุบัติเหตุ
// ผัง = โรงพยาบาลสันทราย · กลุ่มงานพัฒนาคุณภาพและระบบบริการ (พื้นอาคาร ทางเดินกลาง ป้ายหน่วยงาน) · ประตู "เข้าสู่ระบบ" / "ออกสู่ระบบ" แทนทางเข้า–ออกเดิม
// โหมดเล่นซ้ำ: วันทั่วไป (เฉลี่ย) · วันนี้ · วันที่คนใช้มากสุด (GAS op `projects/replay`) — วนเล่นซ้ำได้ · แยก "ผู้ใช้ใหม่ / ผู้ใช้เดิมที่กลับมา" ภายในวันเดียวกัน (รหัสผู้เข้าชมเปลี่ยนทุกวัน จึงไม่ตามรอยข้ามวัน)
// ลำดับสถานีตามสถานะการใช้งานปัจจุบัน: มีคนออนไลน์ → ปกติ → เงียบ → ยังไม่มีข้อมูล → หยุดเก็บ
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
import { THEMES, themeOf, MAX_SITES, PALETTE, IDLE_COL, DEFAULTS, hhmm, fmt, hostOf, normalizeFloor, fromListStats, pickSites, stateOf, trendOf, perFigure, visitors, timeRange, crowdPeak, summarize, insights, sitesCsv, makeSample,
  kindMeta, normalizePages, pagesFromStats, pageJourneys, nextPages, prevPages, pageInsights, pagesCsv, makeSamplePages, asJourneys,
  MODES, MODE_IDS, usageRank, dayLabel, normalizeReplay, replayVisitors, replayRange, cumViews, dayStats, compareToPeak, replayInsights, replayCsv, makeSampleReplay, REPLAY_PRIVACY,
  VIEW_KEY, VIEWS, VIEW_IDS, DEPT, HOSP, HOSP_GROUPS, HG, groupOf, HOSP_BLDS, BLD, bldOf, campusLayout, interiorLayout, deptWorld, deptLayout, deptStand, headStand, hospStand, hospRoute, hospDoor, ROLES, ROLE_IDS, roleOf, roleText, wingOf, normalizeWings, makeSampleWings, wingPick, wingNext } from './site-engine.js';
import { drawRoom, roomColor } from './site-rooms.js';

const G = 12; const CORR = 6; const ENT = [0.6, CORR]; const EXIT = [11.4, CORR]; const CAP = 16;
const RANGES = [[7, '7 วัน'], [30, '30 วัน'], [90, '90 วัน']]; const RANGE_KEY = 'sand:home3d:days';
const STATE_TXT = { ok: 'ปกติ', paused: 'หยุดเก็บสถิติ', idle: 'ยังไม่มีข้อมูล', silent: 'เงียบผิดปกติ' };
const stTxt = (s) => (usageRank(s) === 0 ? 'กำลังใช้งาน' : STATE_TXT[stateOf(s)]);   // priority = current usage status
const stCls = (s) => (usageRank(s) === 0 ? 'live' : stateOf(s));
const bkkDay = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
const STATE_COL = { ok: '#16a34a', paused: '#f59e0b', idle: '#94a3b8', silent: '#ef4444' };
const SCREEN = { paused: '#475569', idle: '#334155', silent: '#7f1d1d' };
const WALK = '#64748b';
const LIVE_KEY = 'sand:home3d:live'; const MODE_KEY = 'sand:home3d:mode'; const LOOP_KEY = 'sand:home3d:loop';
const BACK_COL = '#f59e0b';   // ring around people who came back the same day
const GATE = { in: { col: '#14b8a6', label: 'เข้าสู่ระบบ', at: ENT }, out: { col: '#fb7185', label: 'ออกสู่ระบบ', at: EXIT } };
const GATE_H = 1.3; const GATE_W = 0.56;
const MODE_HINT = { typical: 'ภาพเฉลี่ยของ “วันทั่วไป” จากช่วงที่เลือก', today: 'ย้อนดูการเข้าใช้งานจริงของวันนี้ ตั้งแต่ต้นวันถึงขณะนี้', peak: 'ย้อนดูวันที่มีคนใช้มากที่สุดในรอบ 90 วัน' };
const PAL = {
  light: { floor: '#e9eef3', wk: 1.55, tower: '#e2e8f0', grid: '#d3dbe3', ink: '#1f2937', pill: 'rgba(255,255,255,.95)', pillLine: '#cfd8e1', desk: '#b08968', screen: '#334155', frame: '#334155', corr: '#f6f9fb', slab: '#c3ccd6', brand: '#0f766e', grass: '#d9ebd3', walk: '#ece8de', curb: '#d6d3cb', kerb: '#b8b3a7', lot: '#aab3bd', lotLine: '#f8fafc', road: '#59626e', roadWear: '#4d5662', roadLine: '#f1f5f9', zebra: '#f8fafc' },
  dark: { floor: '#1c2535', wk: 0.56, tower: '#334155', grid: '#2b374b', ink: '#e5e7eb', pill: 'rgba(17,24,39,.93)', pillLine: '#374357', desk: '#8a6a4f', screen: '#0f172a', frame: '#94a3b8', corr: '#243149', slab: '#0f1623', brand: '#2dd4bf', grass: '#173324', walk: '#2b3548', curb: '#364257', kerb: '#475569', lot: '#202a3a', lotLine: '#64748b', road: '#161c27', roadWear: '#10151e', roadLine: '#cbd5e1', zebra: '#cbd5e1' },
};
const TITLE_FLOOR = 'โรงพยาบาลสันทราย · โครงการและเว็บไซต์ที่ดูแล';
const rgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const hx = (c, f) => `#${rgb(c).map((v) => Math.round(f <= 1 ? v * f : v + (255 - v) * (f - 1)).toString(16).padStart(2, '0')).join('')}`;   // like shade() but returns a hex colour (box() / shade() only parse hex)
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
  const savedMode = localStorage.getItem(MODE_KEY); let mode = MODE_IDS.includes(savedMode) ? savedMode : 'today'; let loopOn = localStorage.getItem(LOOP_KEY) !== '0'; let endHold = 0;
  const R = { rep: null, st: null, busy: false, at: 0, src: '' }; const RC = Object.create(null); let rseq = 0;   // R = the replayed real day · RC = 60 s memory per mode
  let sites = []; let themes = []; let more = 0; let LAY = []; let vis = []; let range = { from: cfg.open, to: cfg.close }; let pf = 1; let sm = summarize([]); let hits = [];
  let started = false; let t = 0; let playing = false; let speed = 20; let raf = 0; let last = 0; let lastMin = -1; let seq = 0; let dead = false; let onScreen = true; let hover = -1;
  let jr = []; let floorRange = range; let ins = null; let ILAY = []; let focus = -1; let entering = false; let iseq = 0; const cam = { z: 1, tx: 0, ty: 0, tz: 1, ttx: 0, tty: 0 };
  let view = VIEW_IDS.includes(localStorage.getItem(VIEW_KEY)) ? localStorage.getItem(VIEW_KEY) : 'dept'; const W = { map: {}, days: 0, src: '', at: 0, busy: false }; let DL = []; let HL = null; let PW = []; let whits = []; let hoverT = null; let wseq = 0; let hb = null; let BL = []; let hoverB = ''; let bhits = []; let xhit = null;   // hb = building entered in the hospital view (null = campus seen from outside) · BL = building of every project   // view: 'dept' = department plan (rooms = pages) · 'hospital' = whole-hospital plan (rooms = systems)
  let liveOn = localStorage.getItem(LIVE_KEY) !== '0';   // real-time: the clock follows the real time and the numbers refresh by themselves
  let WX = 12; let WY = 12; let WD = 0; let CYc = CORR; let corrH = 0.5;   // size of the floor being drawn · y of its main corridor / road · half width of it
  let tw = 60; let ox = 0; let oy = 0; let dpr = 1; let pal = PAL.light; let font = 'sans-serif'; let ctx; let timer = 0;

  // ---------- DOM ----------
  const cv = h('canvas', { role: 'img', 'aria-label': 'ผัง 3 มิติของโครงการและเว็บไซต์ที่ติดตาม' });
  const clock = h('div', { class: 's3-clock' }); const sub = h('small'); const live = h('small', { class: 's3-live' }); const chip = h('div', { class: 's3-chip' }); const tip = h('div', { class: 's3-tip', role: 'status', hidden: true });
  const scroller = h('div', { class: 's3-scroll' }, cv);
  const brand = h('div', { class: 's3-brand', 'aria-hidden': 'true' }, h('i', null, '✚'), h('span', null, h('b', null, 'โรงพยาบาลสันทราย'), h('small', null, 'กลุ่มงานพัฒนาคุณภาพและระบบบริการ')));
  const stage = h('div', { class: 's3-stage' }, h('div', { class: 's3-clockbox' }, clock, sub, live), chip, scroller, brand, tip);
  const prog = h('i'); const banner = h('div', { class: 's3-banner' }); const status = h('span', { class: 's3-status', role: 'status', 'aria-live': 'polite' });
  const rangeEl = h('div', { class: 'tabs s3-range', role: 'tablist', 'aria-label': 'ช่วงเวลา' });
  const refreshBtn = h('button', { class: 'btn btn-sm', type: 'button', onclick: () => load(true) }, svgIcon(ICONS.rotate, 16), 'รีเฟรช');
  const csvBtn = h('button', { class: 'btn btn-sm', type: 'button', disabled: true, onclick: () => { downloadText(`\ufeff${ins ? pagesCsv(ins.units, S.days, ins.site.name) : dayOn() ? replayCsv(R.rep, sites) : sitesCsv(S.all, S.days)}`, `${ins ? `หน้าในระบบ_${ins.site.key}` : dayOn() ? `โครงการและเว็บไซต์_${R.rep.day}` : 'โครงการและเว็บไซต์'}_${dayOn() && !ins ? 'รายวัน' : `${S.days}วัน`}_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.csv`, 'text/csv'); toast('ส่งออกรายงานแล้ว', 'success'); } }, svgIcon(ICONS.download, 16), 'ส่งออก CSV');
  const playBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => (playing ? pause() : play()) });
  const loopBtn = h('button', { class: 'btn s3-loop', type: 'button', 'aria-pressed': String(loopOn), title: 'เมื่อเล่นถึงสิ้นวัน ให้เริ่มใหม่ต่อเนื่อง', onclick: () => setLoop(!loopOn) }, svgIcon(ICONS.rotate, 16), 'วนเล่นซ้ำ');
  const viewEl = h('div', { class: 'tabs s3-view', role: 'tablist', 'aria-label': 'มุมมองผัง' }); const viewHint = h('small', { class: 's3-modehint', role: 'status', 'aria-live': 'polite' });
  const liveBtn = h('button', { class: 'btn s3-livebtn', type: 'button', 'aria-pressed': String(liveOn), title: 'นาฬิกาเดินตามเวลาจริงและอัปเดตข้อมูลเองทุก 30 วินาที ไม่ต้องรีเฟรช', onclick: () => setLive(!liveOn) }, h('i', { class: 's3-livedot' }), 'เรียลไทม์');
  const modeEl = h('div', { class: 'tabs s3-mode', role: 'tablist', 'aria-label': 'โหมดการเล่นซ้ำ' }); const modeHint = h('small', { class: 's3-modehint', role: 'status', 'aria-live': 'polite' });
  const spd = h('select', { 'aria-label': 'ความเร็วการเล่น', onchange: () => { speed = Number(spd.value); } }, [[10, 'ช้า'], [20, 'ปกติ'], [40, 'เร็ว'], [80, 'เร็วมาก']].map(([v, l]) => h('option', { value: v, selected: v === 20 }, `${l} (${v} นาที/วินาที)`)));
  const legend = h('div', { class: 's3-legend', 'aria-label': 'โครงการที่แสดงในผัง' });
  const kpis = h('div', { class: 's3-kpis' }); const hoursEl = h('div', { class: 's3-hours', role: 'group', 'aria-label': 'จำนวนการเปิดหน้ารายชั่วโมง กดเพื่อข้ามไปช่วงเวลานั้น' });
  const titleEl = h('h2', { id: 's3-title' }, TITLE_FLOOR); const tblTitle = h('h3', { id: 's3-h-tbl' }, 'ทุกโครงการ'); const roomCard = h('section', { class: 'card s3-room', hidden: true, 'aria-live': 'polite' });
  const backBtn = h('button', { class: 'btn btn-sm s3-back', type: 'button', hidden: true, onclick: () => (ins ? leave() : leaveBld()) }, '← กลับผังรวม');
  const openBtn = h('button', { class: 'btn btn-sm', type: 'button', hidden: true, onclick: () => { if (ins && opts.onOpen) opts.onOpen(ins.site.key); } }, 'เปิดรายละเอียดโครงการ');
  const hoursTitle = h('h3', { id: 's3-h-hours' }, 'ช่วงเวลาที่คนเข้าเว็บ (เฉลี่ยต่อวัน)');
  const insightBox = h('div', { class: 's3-insights' }); const tableBox = h('div', { class: 's3-table-wrap' }); const note = h('p', { class: 's3-note' });
  host.append(h('section', { class: 's3', 'aria-labelledby': 's3-title' },
    h('div', { class: 's3-head' }, h('div', null, backBtn, titleEl, status), h('div', { class: 's3-tools' }, rangeEl, openBtn, refreshBtn, csvBtn)),
    banner, h('div', { class: 's3-viewbar' }, viewEl, viewHint), h('div', { class: 's3-modebar' }, modeEl, modeHint), stage,
    h('div', { class: 's3-controls' }, playBtn, liveBtn, loopBtn,
      h('button', { class: 'btn', type: 'button', onclick: () => { t = range.from; lastMin = -1; playing = true; sync(); } }, svgIcon(ICONS.rotate, 16), 'เล่นใหม่ตั้งแต่เช้า'),
      h('button', { class: 'btn', type: 'button', onclick: () => { setLive(true); } }, svgIcon(ICONS.eye, 16), 'ไปที่เวลาปัจจุบัน'),
      h('button', { class: 'btn', type: 'button', onclick: () => { t = crowdPeak(crowd(), range); lastMin = -1; pause(); } }, svgIcon(ICONS.focus, 16), 'ไปที่ช่วงคนแน่นสุด'),
      h('label', { class: 's3-field' }, h('span', null, 'ความเร็ว'), spd)),
    legend, kpis, roomCard,
    h('div', { class: 's3-grid' },
      h('section', { class: 'card', 'aria-labelledby': 's3-h-hours' }, hoursTitle, hoursEl),
      h('section', { class: 'card', 'aria-labelledby': 's3-h-ai' }, h('h3', { id: 's3-h-ai' }, 'ตัวช่วยวิเคราะห์'), insightBox)),
    h('section', { class: 'card s3-tablecard', 'aria-labelledby': 's3-h-tbl' }, tblTitle, tableBox), note));

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
    const pick = pickSites(S.all); sites = pick.sites; themes = sites.map(themeOf); more = pick.more; LAY = layout(sites.length); sm = summarize(S.all); pf = perFigure(sites, S.days);
    if (ins && ins.source !== source) leave();
    if (R.src !== source) { R.rep = null; R.st = null; R.src = source; }
    rebuildPlan(); resize(); rebuild(started ? 'keep' : 'start'); started = true; tip.hidden = true;
    chip.textContent = source === 'sample' ? 'ข้อมูลตัวอย่าง' : 'ข้อมูลจริง'; chip.dataset.kind = source;
    if (!ins) cv.setAttribute('aria-label', `ผัง 3 มิติ ${sites.length} โครงการ · เปิดหน้ารวม ${fmt(sm.pv)} ครั้งใน ${S.days} วัน`);
    csvBtn.disabled = false; drawAll();
    loadWings();
    if (mode !== 'typical') loadReplay(mode, !!R.rep);
  }

  // ---------- replay of a real day (today / the busiest day) ----------
  const dayOn = () => !ins && mode !== 'typical' && !!R.rep;
  const pfNow = () => (ins ? ins.pf : dayOn() ? 1 : pf);
  let rnote = null;
  /** The people, the replay window and the playhead. how: 'start' first draw · 'keep' data refreshed · 'reset' new mode/day → play it from its first hour. */
  function rebuild(how = 'keep') {
    const day = mode !== 'typical' && !!R.rep;
    vis = day ? replayVisitors(R.rep, sites, cfg) : visitors(sites, S.days, pf, cfg); jr = asJourneys(vis); floorRange = day ? replayRange(jr, R.rep, bkkMinutes(), cfg) : timeRange(jr, cfg); planWings();
    if (!ins) {
      range = floorRange; const home = () => (day ? range.from : Math.min(range.to, Math.max(range.from, bkkMinutes())));
      if (how === 'reset') { t = home(); playing = !reduced; endHold = 0; } else if (how === 'start' || t < range.from || t > range.to) t = home();
      cv.setAttribute('aria-label', day ? `ผัง 3 มิติ ${sites.length} โครงการ · ${R.rep.day === R.rep.today ? 'วันนี้' : dayLabel(R.rep.day)} เปิดหน้า ${fmt(R.st.views)} ครั้ง` : `ผัง 3 มิติ ${sites.length} โครงการ · เปิดหน้ารวม ${fmt(sm.pv)} ครั้งใน ${S.days} วัน`);
    }
    lastMin = -1; hover = -1;
  }
  function setReplay(rep, quiet) { R.rep = rep; R.st = dayStats(rep); R.at = Date.now(); R.busy = false; if (rnote) { rnote.remove(); rnote = null; } rebuild(quiet ? 'keep' : 'reset'); drawAll(); }
  async function loadReplay(m, quiet = false) {
    if (dead || !sites.length) return; const my = ++rseq; const ck = m + S.source; const hit = RC[ck];
    if (hit && Date.now() - hit.t < 60000) { setReplay(hit.rep, quiet); return; }
    if (!quiet) { R.busy = true; drawStatus(); drawModes(); }
    try {
      let rep;
      if (S.source === 'sample') rep = normalizeReplay(makeSampleReplay(S.all, m, bkkDay(), bkkMinutes()));
      else { rep = normalizeReplay(await sessionCall('projects', 'replay', { mode: m })); if (!rep) { const bad = new Error('รูปแบบข้อมูลไม่ตรงกับเวอร์ชันล่าสุด'); /** @type {any} */ (bad).code = 'UNKNOWN_ACTION'; throw bad; } }
      if (my !== rseq || dead || mode !== m) return; RC[ck] = { t: Date.now(), rep }; setReplay(rep, quiet);
    } catch (e) {
      if (my !== rseq || dead || mode !== m) return; R.busy = false;
      if (quiet && R.rep) { drawStatus(); return; }
      R.rep = null; R.st = null; mode = 'typical'; if (rnote) rnote.remove();
      rnote = e && e.code === 'UNKNOWN_ACTION' ? notice('warn', 'ยังไม่มีโหมดเล่นซ้ำวันจริง', 'Apps Script ยังเป็น Analytics.gs เวอร์ชันเก่า (ไม่มี op replay) — วางไฟล์ใหม่แล้ว Deploy เวอร์ชันใหม่ ระหว่างนี้ผังแสดง “วันทั่วไป (เฉลี่ย)”') : notice('error', 'โหลดข้อมูลรายวันไม่ได้', (e && e.message) || 'เกิดข้อผิดพลาด');
      banner.append(rnote); rebuild('start'); drawAll();
    }
  }
  function setMode(m) {
    if (m === mode || !MODE_IDS.includes(m)) return; if (ins) leave(); mode = m; if (m === 'peak') lastMin = -1; try { localStorage.setItem(MODE_KEY, m); } catch { /* ignore */ }
    if (rnote) { rnote.remove(); rnote = null; } rseq += 1; R.busy = false;
    if (m === 'typical') { rebuild('reset'); drawAll(); return; }
    R.rep = null; R.st = null; rebuild('keep'); drawAll(); loadReplay(m, false);
  }
  function setLoop(v) { loopOn = v; endHold = 0; try { localStorage.setItem(LOOP_KEY, v ? '1' : '0'); } catch { /* ignore */ } loopBtn.setAttribute('aria-pressed', String(v)); toast(v ? 'เปิดวนเล่นซ้ำ — เล่นถึงสิ้นวันแล้วเริ่มใหม่' : 'ปิดวนเล่นซ้ำ — เล่นจบแล้วหยุด', 'success', 2200); }
  function drawModes() {
    modeEl.replaceChildren(...MODES.map(([id, l]) => h('button', { class: 'tab', type: 'button', role: 'tab', 'aria-selected': String(mode === id), onclick: () => setMode(id) }, l)));
    modeEl.parentElement.hidden = !!ins; rangeEl.hidden = !(mode === 'typical' || ins); loopBtn.setAttribute('aria-pressed', String(loopOn));
    modeHint.textContent = mode === 'typical' ? MODE_HINT.typical : R.busy ? 'กำลังโหลดข้อมูลรายวัน…' : R.rep ? `${R.rep.day === R.rep.today ? 'วันนี้' : dayLabel(R.rep.day)}${R.rep.day === R.rep.today ? ` · ถึงเวลา ${hhmm(bkkMinutes())} น.` : ` · ${fmt(R.st.views)} ครั้ง`}${R.rep.scale > 1 ? ` · สุ่มแสดง 1 ใน ${R.rep.scale} คน` : ''}` : MODE_HINT[mode];
  }

  // ---------- wings: the pages of every system, drawn behind its station (no need to click into each system) ----------
  const deptOn = () => !ins && view === 'dept' && DL.length > 0;
  const hospOn = () => !ins && view === 'hospital' && !!HL;
  const hospIn = () => hospOn() && HL.interior === true;   // inside one building: departments are visible
  const hospOut = () => hospOn() && HL.interior !== true;   // the campus seen from outside: buildings only
  const planOn = () => deptOn() || hospOn();
  const VIEW_HINT = { dept: 'เดินเข้าแผนกตามทางเดิน แล้วแยกเข้าห้องส่วนย่อย (หน้าของระบบ) ทั้งสองข้าง — เห็นทันทีว่าคนใช้ส่วนไหน ไม่ต้องกดเข้าไปทีละระบบ', hospital: 'ผังโรงพยาบาลสันทราย — คลิกที่ตึกเพื่อเข้าไปดูแผนกภายใน · ตึกอุบัติเหตุ (ทางซ้ายของโรงพยาบาล) = ระบบยานพาหนะ · ตึกโรงพยาบาลหลัก = ระบบอื่นทั้งหมด' };
  /** Size of the floor + the corridor / road that the gates stand on. Inside a system the old square floor is used. */
  function setWorld() {
    WD = 0;
    if (ins || !sites.length) { WX = G; WY = G; CYc = CORR; corrH = 0.5; }
    else if (view === 'dept') { const w = deptWorld(sites.length); WX = w.GX; WY = w.GY; CYc = w.CY; corrH = DEPT.CORR / 2; }
    else { const w = (HL || campusLayout()).world; WX = w.GX; WY = w.GY; WD = w.D || 0; CYc = HL ? HL.sy : w.GY / 2; corrH = 0.5; }
    ENT[0] = 0.6; ENT[1] = CYc; EXIT[0] = WX - 0.6; EXIT[1] = CYc;
  }
  function rebuildPlan() {
    DL = []; HL = null; PW = []; BL = sites.map((s, i) => bldOf(s, themes[i]));
    if (!ins && sites.length) {
      if (view === 'dept') DL = deptLayout(sites.map((s) => (W.map[s.key] ? W.map[s.key].units.length : 0)));
      else { const its = sites.map((s, i) => ({ group: groupOf(s, themes[i]), bld: BL[i], pv: s.pv })); HL = hb ? interiorLayout(its, hb) : campusLayout(); }
      PW = buildWalls();
    }
    setWorld();
  }
  /** Walls as short segments (so a person is hidden by a wall only when really behind it). k 'y' = wall along x at y=c · 'x' = wall along y at x=c · gap = doorway. */
  function buildWalls() {
    const out = []; const T = 0.34; const EXT = '#94a3b8';
    const seg = (k, a, b, c, hh, col, gap, hedge) => { for (let u = a; u < b - 1e-6; u += 0.4) { const v = Math.min(b, u + 0.4); const m = (u + v) / 2; if (gap && (Array.isArray(gap[0]) ? gap : [gap]).some((q) => m > q[0] && m < q[1])) continue; out.push({ k, a: u, b: v, c, h: hh, col, d: c + m, hedge: !!hedge }); } };
    if (!ins && view === 'dept') {
      DL.forEach((d, i) => {
        const col = colOf(i); const hy = d.top ? 1.15 : T; const hd = d.head; const gapH = [d.hall.x0, d.hall.x1];
        seg('y', hd.x0, hd.x1, d.top ? hd.y0 : hd.y1, hy, col); seg('y', hd.x0, hd.x1, d.top ? hd.y1 : hd.y0, T, col, gapH); seg('x', hd.y0, hd.y1, hd.x0, hy, col); seg('x', hd.y0, hd.y1, hd.x1, T, col);
        d.rooms.forEach((r) => {
          const gd = [r.c[1] - 0.28, r.c[1] + 0.28];
          seg('y', r.x0, r.x1, r.y0, T, col); seg('y', r.x0, r.x1, r.y1, T, col); seg('x', r.y0, r.y1, r.x0, T, col, r.side > 0 ? gd : null); seg('x', r.y0, r.y1, r.x1, T, col, r.side < 0 ? gd : null);
        });
      });
    } else if (!ins && HL && HL.interior) {   // inside a building: tall back + west walls, low front + east walls (a cut-away, so nothing hides the rooms), thin walls round every room
      const sh = HL.shell; const WC = HL.bldId === 'er' ? '#d9b98a' : '#efe2b4'; const ge = [HL.avenue.x0 + 0.1, HL.avenue.x1 - 0.1];
      seg('y', sh.x0, sh.x1, sh.y0, 1.7, WC); seg('x', sh.y0, sh.y1, sh.x0, 1.7, WC); seg('y', sh.x0, sh.x1, sh.y1, 0.26, WC, ge); seg('x', sh.y0, sh.y1, sh.x1, 0.26, WC);
      HL.rooms.forEach((r) => { if (!r) return; const gd = [r.door[0] - 0.4, r.door[0] + 0.4]; seg('x', r.y0, r.y1, r.x0, T, r.wcol); seg('x', r.y0, r.y1, r.x1, T, r.wcol); seg('y', r.x0, r.x1, r.front ? r.y0 : r.y1, T, r.wcol, gd); });
    } else if (!ins && HL) {
      const HC = '#2f8f4e'; const xe = HL.campus.x1; const ye = HL.campus.y1;   // tree hedge all round the campus: back + left, and the FRONT + EAST edges that face the public roads (gaps: main gate, hospital name wall, side exit)
      const yb0 = (HL.world && HL.world.D) ? -HL.world.D : 0; seg('y', 0.25, xe, yb0 + 0.25, 0.62, HC, null, true); seg('x', yb0 + 0.25, ye, 0.25, 0.62, HC, null, true);
      seg('y', 0.25, xe, ye - 0.25, 0.62, HC, [[HL.avenue.x0, HL.avenue.x1], HL.sign.gap], true); seg('x', yb0 + 0.25, ye - 0.25, xe - 0.25, 0.62, HC, HL.rear.y, true);
    }
    return out;
  }
  const W_NOTE_DEPT = ' · ห้องในแผนก = หน้าย่อยของระบบนั้น (สีผนัง = แผนก) คนที่เข้ามาจะเดินตามทางเดินไปยังห้องที่ใช้จริง — คลิกห้องเพื่อเข้าไปดูภายในระบบ';
  const W_NOTE_OUT = ' · ผังบริเวณโรงพยาบาลจากภายนอก: เห็นเฉพาะตึก — คนเดินเข้าทางประตูหน้าไปยังตึกของระบบที่ใช้จริง (ตึกอุบัติเหตุทางซ้าย = ระบบยานพาหนะ · ตึกหลัก = ระบบอื่น) คลิกตึกเพื่อเข้าไปดูแผนกภายใน · ตึกด้านหลัง 3 หลัง (คลิกแล้วเข้าตึกหลัก) · พื้นที่ก่อสร้างหลังตึกอุบัติเหตุ · คนเดินในผัง (หมอ พยาบาล ผู้ป่วย ญาติ คนงาน) เป็นภาพบรรยากาศ ไม่ใช่ข้อมูลจริง';
  const W_NOTE_IN = ' · ภายในอาคาร: หนึ่งห้อง = หนึ่งแผนก/ระบบ คนเดินเข้าทางประตูอาคารไปยังห้องของระบบที่ใช้จริง — คลิกห้องเพื่อเข้าไปดูภายในระบบ · กด Esc หรือปุ่ม “ออกจากอาคาร” เพื่อกลับผังบริเวณ';
  /** Which page does each drawn person use? A real day knows it (pk); otherwise it is drawn in proportion to the page views. */
  const mixC = {}; let mixAt = 0;
  /** Role mix of a whole system (all its pages together), for the hospital view where people are not placed in pages. */
  function siteMix(z) { if (mixAt !== W.at) { for (const q of Object.keys(mixC)) delete mixC[q]; mixAt = W.at; } if (mixC[z]) return mixC[z]; const w = W.map[sites[z] && sites[z].key]; const by = {}; let tot = 0; if (w) for (const u of w.units) { const q = roleOf(u); tot += q.known + q.none; for (const id of ROLE_IDS) by[id] = (by[id] || 0) + (q.by[id] || 0); } return (mixC[z] = { by, tot: Math.max(1, tot) }); }
  function roleDraw(m, id) { const x = ((id * 2654435761) >>> 0) / 4294967296; let acc = 0; for (const r of ROLE_IDS) { acc += (m.by[r] || 0) / m.tot; if (x < acc) return r; } return ''; }
  function planWings() {
    for (const j of jr) {
      j.pg = -1; j.role = ''; if (!ins && view === 'hospital') { j.role = roleDraw(siteMix(j.stops[0].zone), j.id); continue; } if (view !== 'dept' || ins || !DL.length) continue;
      const z = j.stops[0].zone; const w = W.map[sites[z] && sites[z].key]; if (!w || !DL[z] || !DL[z].rooms.length) continue;
      const g = j.pk ? w.units.findIndex((u) => u.key === j.pk) : wingPick(w, j.id); j.pg = g >= 0 && g < DL[z].rooms.length ? g : -1;
      if (j.pg >= 0) j.role = roleDraw(roleMixOf(w.units[j.pg]), j.id);   // who stands in the room, in proportion to the roles the website reported
    }
  }
  const roleMixOf = (u) => { const q = roleOf(u); return { by: q.by, tot: Math.max(1, q.known + q.none) }; };
  function setWingData(map) {
    W.map = map; W.at = Date.now(); W.days = S.days; W.src = S.source; W.busy = false; rebuildPlan(); planWings(); lastMin = -1; drawStatus();
    if (!ins) { drawLegend(); drawInsights(); drawTable(); drawNote(); }
  }

  async function loadWings() {
    if (dead || !sites.length) return;
    if (W.src === S.source && W.days === S.days && Date.now() - W.at < 60000 && Object.keys(W.map).length) { rebuildPlan(); planWings(); return; }
    const my = ++wseq;
    if (S.source === 'sample') { setWingData(makeSampleWings(sites, S.days)); return; }
    if (!Object.keys(W.map).length || W.days !== S.days || W.src !== S.source) { const c = cacheGet(`wg:${S.days}`); const m = c && normalizeWings(c.d); if (m && Object.keys(m).length) setWingData(m); }
    W.busy = true; drawStatus();
    try {
      let m = null; let fallback = false;
      try {
        const raw = await sessionCall('projects', 'wings', { days: S.days }); m = normalizeWings(raw);
        if (!m) { const bad = new Error('รูปแบบข้อมูลส่วนย่อยไม่ตรงกับเวอร์ชันล่าสุด'); /** @type {any} */ (bad).code = 'UNKNOWN_ACTION'; throw bad; }
        cacheSet(`wg:${S.days}`, raw);
      } catch (e) {
        if (!e || e.code !== 'UNKNOWN_ACTION') throw e;
        fallback = true; m = {};   // older Apps Script: one `pages` call per project (slower, but it works)
        await Promise.all(sites.map(async (s) => { try { const r = await fetchPages(s, S.days); const w = wingOf(r.d); if (w) m[s.key] = w; } catch { /* that system gets no annex */ } }));
      }
      if (my !== wseq || dead) return;
      setWingData(m);
      if (fallback) banner.append(notice('warn', 'โหลดส่วนย่อยทีละระบบ (ช้ากว่า)', 'Apps Script ยังเป็น Analytics.gs เวอร์ชันเก่า (ไม่มี op wings) — วางไฟล์ใหม่แล้ว Deploy เวอร์ชันใหม่ ผังจะโหลดหน้าย่อยของทุกระบบในครั้งเดียวและเร็วขึ้น'));
    } catch (e) {
      if (my !== wseq || dead) return; W.busy = false; drawStatus();
      if (!Object.keys(W.map).length) banner.append(notice('warn', 'โหลดส่วนย่อยของระบบไม่สำเร็จ', (e && e.message) || 'เกิดข้อผิดพลาด'));
    }
  }
  function setView(v) {
    if (!VIEW_IDS.includes(v) || v === view) return; if (ins) leave(); view = v; hb = null; try { localStorage.setItem(VIEW_KEY, v); } catch { /* ignore */ }
    hoverT = null; hoverB = ''; hover = -1; tip.hidden = true; rebuildPlan(); resize(); planWings(); lastMin = -1; loadWings(); drawAll();
  }
  function drawViews() {
    viewEl.replaceChildren(...VIEWS.map(([id, l]) => h('button', { class: 'tab', type: 'button', role: 'tab', 'aria-selected': String(view === id), onclick: () => setView(id) }, l)));
    viewEl.parentElement.hidden = !!ins; viewHint.textContent = VIEW_HINT[view];
  }
  const topPageTxt = (key) => { const w = W.map[key]; const u = w && w.units[0]; return u && w.tot ? `${kindMeta(u.kind).icon} ${u.name} · ${Math.round((u.pv / w.tot) * 100)}%` : '–'; };
  function wingInsights() {
    const out = []; const ranked = sites.map((s) => ({ s, w: W.map[s.key] })).filter((x) => x.w && x.w.tot > 0 && x.w.units.length).sort((a, b) => b.s.pv - a.s.pv).slice(0, 3);
    for (const { s, w } of ranked) {
      const u = w.units[0]; const nx = wingNext(w, u.key); const nu = nx ? w.units.find((x) => x.key === nx.to) : null;
      out.push({ tone: 'info', text: `${s.name}: คนใช้หน้า “${u.name}” มากสุด (${Math.round((u.pv / w.tot) * 100)}% ของทั้งระบบ)${nu ? ` และมักไปต่อที่ “${nu.name}”` : ''}` });
    }
    return out;
  }

  /** Role mix per system (and overall), from the roles each website reports with its page views. */
  function roleInsights() {
    const out = []; const tot = {}; let all = 0;
    sites.forEach((s) => { const w = W.map[s.key]; if (!w) return; const by = {}; let n = 0; for (const u of w.units) for (const x of roleOf(u).list) { by[x.id] = (by[x.id] || 0) + x.n; n += x.n; tot[x.id] = (tot[x.id] || 0) + x.n; all += x.n; }
      if (n) out.push({ tone: 'info', text: `👥 ${s.name}: ${ROLE_IDS.filter((id) => by[id]).map((id) => `${ROLES[id].short} ${Math.round((by[id] / n) * 100)}%`).join(' · ')}` }); });
    if (all) { const side = (tot.admin || 0) + (tot.head || 0) + (tot.officer || 0); out.unshift({ tone: 'info', text: `👥 ทุกระบบรวมกัน: ผู้ดูแล/เจ้าหน้าที่ ${Math.round((side / all) * 100)}% · ผู้ใช้ทั่วไป ${Math.round(((all - side) / all) * 100)}%` }); }
    return out;
  }
  function hospInsights() {
    const tot = sites.reduce((a, s) => a + s.pv, 0) || 1; const txt = (m) => (m.length ? ` (${m.map((x) => x.name).join(', ')})` : ''); const sum = (m) => m.reduce((a, s) => a + s.pv, 0);
    const bs = HOSP_BLDS.map((b) => { const m = sites.filter((s, i) => BL[i] === b.id); const pv = sum(m); return { tone: 'info', text: `${b.icon} ${b.name}: ${fmt(m.length)} ระบบ${txt(m)} · เปิดหน้า ${fmt(pv)} ครั้ง (${Math.round((pv / tot) * 100)}% ของทั้งหมด)` }; });
    const gs = HOSP_GROUPS.map((g) => { const m = sites.filter((s, i) => BL[i] === 'main' && groupOf(s, themes[i]) === g.id); return { tone: 'info', text: `${g.icon} ปีก${g.name} (ในอาคารหลัก): ${fmt(m.length)} ระบบ${txt(m)} · เปิดหน้า ${fmt(sum(m))} ครั้ง` }; });
    return [...bs, ...gs];
  }

  // ---------- panels ----------
  const dot = (c) => h('i', { class: 's3-dot', style: `background:${c}` });
  const colOf = (i) => { const st = stateOf(sites[i]); return st === 'ok' ? PALETTE[i % PALETTE.length] : st === 'silent' ? STATE_COL.silent : IDLE_COL; };
  const open = (key) => { if (S.source === 'real' && opts.onOpen) opts.onOpen(key); };
  function drawStatus() {
    refreshBtn.disabled = S.busy; refreshBtn.classList.toggle('is-loading', S.busy);
    if (S.busy) { status.className = 's3-status is-busy'; status.replaceChildren(S.all.length ? 'กำลังอัปเดตข้อมูล…' : 'กำลังโหลดข้อมูล…'); return; }
    if (R.busy) { status.className = 's3-status is-busy'; status.replaceChildren('กำลังโหลดข้อมูลรายวัน…'); return; }
    if (W.busy && view === 'dept' && !ins) { status.className = 's3-status is-busy'; status.replaceChildren('กำลังโหลดหน้าย่อยของแต่ละระบบ…'); return; }
    if (S.source === 'sample') { status.className = 's3-status'; status.replaceChildren('ตัวอย่างการทำงานของผัง'); return; }
    if (S.err) { status.className = 's3-status is-err'; status.replaceChildren(dot('#ef4444'), 'อัปเดตล่าสุดไม่สำเร็จ · แสดงข้อมูลเดิม'); return; }
    status.className = 's3-status is-ok'; status.replaceChildren(dot('#16a34a'), `${liveOn && liveUsable() ? 'เรียลไทม์ · ' : ''}อัปเดต ${ago(S.at)}${S.fromCache ? ' · จากข้อมูลที่จำไว้' : ''} · ${dayOn() ? (R.rep.day === R.rep.today ? 'วันนี้' : dayLabel(R.rep.day)) : `ย้อนหลัง ${S.days} วัน`}`);
  }
  function drawRange() { rangeEl.replaceChildren(...RANGES.map(([n, l]) => h('button', { class: 'tab', type: 'button', role: 'tab', 'aria-selected': String(S.days === n), onclick: () => setDays(n) }, l))); }
  function setDays(n) { if (n === S.days) return; if (ins) leave(); S.days = n; try { localStorage.setItem(RANGE_KEY, String(n)); } catch { /* ignore */ } drawRange(); if (S.source === 'sample') { useSample(null); return; } load(); }
  function kpi(label, value, hint, extra) { return h('div', { class: 's3-kpi' }, h('span', null, label, extra || null), h('b', null, value), hint ? h('small', null, hint) : null); }
  function drawKpis() { if (ins) kpisIn(); else if (dayOn()) kpisDay(); else kpisFloor(); }
  function kpisDay() {
    const st = R.st; const isToday = R.rep.day === R.rep.today; const cmp = compareToPeak(R.rep.byDay, R.rep.today); const when = isToday ? 'วันนี้ถึงขณะนี้' : dayLabel(R.rep.day);
    kpis.replaceChildren(
      kpi('การเปิดหน้า', fmt(st.views), isToday && cmp && !cmp.isPeak ? `≈${cmp.pct}% ของวันที่คนใช้มากสุด` : isToday ? 'วันนี้คนใช้มากสุดแล้ว' : `ผู้เข้าชม ${fmt(st.uv)} คน`),
      kpi('ผู้ใช้ใหม่', fmt(st.fresh), 'เข้ามาครั้งแรกของวัน'),
      kpi('ผู้ใช้เดิมกลับมา', fmt(st.back), st.visits ? `${st.backPct}% ของการเข้าใช้ · ในวันเดียวกัน` : when),
      kpi('ออนไลน์ตอนนี้', sm.realtime === null ? '–' : fmt(sm.realtime), 'ภายใน 5 นาทีล่าสุด'),
      kpi('ช่วงคนเข้ามากสุด', st.peakHour >= 0 ? `${String(st.peakHour).padStart(2, '0')}:00–${String((st.peakHour + 1) % 24).padStart(2, '0')}:00` : '–', st.top ? `เด่นสุด: ${(S.all.find((x) => x.key === st.top.key) || { name: st.top.key }).name}` : when));
  }
  function kpisFloor() {
    kpis.replaceChildren(
      kpi('การเปิดหน้า', fmt(sm.pv), `ใน ${S.days} วัน · ไม่นับบอท`, sm.prev !== null ? deltaChip(sm.pv, sm.prev) : null),
      kpi('ผู้เข้าชม', fmt(sm.uv), 'นับรายวันต่อโครงการ'),
      kpi('ออนไลน์ตอนนี้', sm.realtime === null ? '–' : fmt(sm.realtime), 'ภายใน 5 นาทีล่าสุด'),
      kpi('โครงการ', `${fmt(sm.tracking)}/${fmt(sm.total)}`, 'กำลังเก็บสถิติ'),
      kpi('ช่วงคนเข้ามากสุด', sm.peakHour >= 0 ? `${String(sm.peakHour).padStart(2, '0')}:00–${String((sm.peakHour + 1) % 24).padStart(2, '0')}:00` : '–', sm.top && sm.top.pv ? `เด่นสุด: ${sm.top.name}` : null));
  }
  function drawHours() {
    const a = Math.floor(range.from / 60); const b = Math.ceil(range.to / 60); const dd = dayOn(); const hourly = ins ? ins.hourly : dd ? R.st.hourly : sm.hourly; const peak = ins ? ins.peak : dd ? R.st.peakHour : sm.peakHour; const mx = Math.max(1, ...hourly.slice(a, b)); const per = dd ? 1 : Math.max(1, S.days);
    hoursTitle.textContent = dd ? `ช่วงเวลาที่คนเข้าเว็บ (${R.rep.day === R.rep.today ? 'วันนี้' : dayLabel(R.rep.day)})` : 'ช่วงเวลาที่คนเข้าเว็บ (เฉลี่ยต่อวัน)';
    hoursEl.replaceChildren(...Array.from({ length: Math.max(0, b - a) }, (_, i) => { const hr = a + i; const n = hourly[hr] || 0;
      return h('button', { type: 'button', class: `s3-hbar${hr === peak ? ' peak' : ''}`, 'data-h': hr, 'aria-label': `${String(hr).padStart(2, '0')}:00 ${dd ? '' : 'เฉลี่ย '}${fmt(Math.round(n / per))} ครั้ง${dd ? '' : 'ต่อวัน'}`, onclick: () => { t = hr * 60 + 30; lastMin = -1; pause(); } },
        h('i', { style: `height:${Math.max(n ? 4 : 1, (n / mx) * 100)}%` }), h('small', null, String(hr).padStart(2, '0')), h('em', null, n ? fmt(Math.round(n / per)) : '')); }));
  }
  function drawInsights() {
    let list;
    if (ins) list = pageInsights(ins.units, ins.flows, S.days);
    else if (dayOn()) { const base = replayInsights(R.rep, R.st, Object.fromEntries(S.all.map((x) => [x.key, x.name]))); const priv = base.pop(); list = [...base, ...insights(S.all, S.days, S.extra).filter((x) => x.tone === 'warn'), priv]; } else list = insights(S.all, S.days, S.extra);
    if (!ins && view === 'dept') list = [...list, ...wingInsights(), ...roleInsights()]; else if (!ins && view === 'hospital') list = [...list, ...hospInsights(), ...roleInsights()];
    insightBox.replaceChildren(h('ul', { class: 's3-ilist' }, list.map((x) => h('li', { class: `tone-${x.tone}` }, svgIcon(x.tone === 'warn' ? ICONS.alert : x.tone === 'ok' ? ICONS.check : ICONS.eye, 18), h('span', null, x.text)))));
  }
  function drawLegend() { if (ins) legendIn(); else legendFloor(); }
  const hasRoles = () => Object.values(W.map).some((w) => w && w.units.some((u) => roleOf(u).known));
  const rolesLegend = () => (!ins && (deptOn() || hospOn()) && hasRoles() ? ROLE_IDS.filter((id) => Object.values(W.map).some((w) => w && w.units.some((u) => roleOf(u).by[id]))).map((id) => h('span', { class: 's3-lg' }, h('i', { class: `s3-adm s3-r-${id}` }), `จุดสีเหนือหัว = ${ROLES[id].short}`)) : []);
  function legendFloor() {
    legend.replaceChildren(...sites.map((s, i) => h('button', { type: 'button', class: `s3-lg${usageRank(s) === 0 ? ' is-live' : ''}`, title: `${stTxt(s)} · เปิดรายละเอียด`, onclick: () => open(s.key) }, h('i', { style: `background:${colOf(i)}` }), `${THEMES[themes[i]].icon} ${s.name}`, usageRank(s) === 0 ? h('em', { class: 's3-livetag' }, `● ${fmt(s.realtime)}`) : null)),
      ...(more ? [h('span', { class: 's3-lg more' }, `+${more} โครงการในตารางด้านล่าง`)] : []),
      ...(dayOn() ? [h('span', { class: 's3-lg' }, h('i', { class: 's3-new' }), 'ผู้ใช้ใหม่ (ครั้งแรกของวัน)'), h('span', { class: 's3-lg' }, h('i', { class: 's3-ring' }), 'ผู้ใช้เดิมที่กลับมาในวันเดียวกัน')] : []),
      ...(deptOn() ? [h('span', { class: 's3-lg' }, h('i', { class: 's3-wing' }), 'ห้องในแผนก = หน้าย่อยของระบบ (ยิ่งสีเข้มยิ่งมีคนเปิดมาก)')] : []),
      ...rolesLegend(),
    ...(hospOut() ? HOSP_BLDS.map((b) => h('button', { type: 'button', class: 's3-lg', title: 'เข้าไปดูแผนกภายในอาคาร', onclick: () => enterBld(b.id) }, h('i', { style: `background:${b.col}` }), `${b.icon} ${b.name} · ${fmt(BL.filter((x) => x === b.id).length)} ระบบ · เข้าไปดูภายใน ›`)) : []),
      ...(hospIn() ? [h('span', { class: 's3-lg' }, h('i', { style: `background:${BLD(hb).col}` }), `${BLD(hb).icon} ${BLD(hb).name} · ${fmt(HL.count)} ระบบ`), ...HL.wings.map((wg, gi) => h('span', { class: 's3-lg' }, h('i', { style: `background:${HOSP_GROUPS[gi].col}` }), `${HOSP_GROUPS[gi].icon} ปีก${HOSP_GROUPS[gi].name} · ${fmt(wg.count)} ระบบ`))] : []),
      h('span', { class: 's3-lg' }, h('i', { style: `background:${WALK}` }), 'กำลังเดินเข้า/ออก'), h('span', { class: 's3-lg' }, h('i', { style: `background:${STATE_COL.silent}` }), 'เงียบผิดปกติ'));
  }
  function drawTable() { if (ins) tableIn(); else tableFloor(); }
  function tableFloor() {
    const dd = dayOn(); const rows = S.all.filter((x) => x.status !== 'deleted').slice().sort((x, y) => usageRank(x) - usageRank(y) || y.pv - x.pv);
    tableBox.replaceChildren(h('table', { class: 's3-table' }, h('thead', null, h('tr', null, (dd ? ['โครงการ', 'เว็บไซต์', 'เปิดหน้า (วันนั้น)', 'ผู้ใช้ใหม่', 'ผู้ใช้เดิมกลับมา', 'ออนไลน์', 'หน้าที่ใช้มากสุด', 'สถานะ'] : ['โครงการ', 'เว็บไซต์', 'เปิดหน้า', 'เทียบก่อนหน้า', 'ผู้เข้าชม', 'ออนไลน์', 'หน้าที่ใช้มากสุด', 'สถานะ']).map((x) => h('th', null, x)))),
      h('tbody', null, rows.map((s2) => { const tr = trendOf(s2); const dr = dd ? R.rep.sites[s2.key] : null;
        return h('tr', null, h('td', null, h('button', { type: 'button', class: 'rowbtn', onclick: () => open(s2.key), title: 'เปิดรายละเอียด' }, `${THEMES[themeOf(s2)].icon} ${s2.name}`), sites.some((x) => x.key === s2.key) ? h('button', { type: 'button', class: 'rowbtn s3-enter', onclick: () => enterSite(sites.findIndex((x) => x.key === s2.key)), title: 'ซูมเข้าไปดูหน้าต่างๆ ภายในระบบ' }, 'เข้าไปดูภายใน ›') : null), h('td', { class: 's3-cut', title: s2.url }, hostOf(s2.url) || '–'),
          dd ? [h('td', null, fmt(dr ? dr.n : 0)), h('td', null, fmt(dr ? dr.fresh : 0)), h('td', null, fmt(dr ? dr.back : 0))] : [h('td', null, fmt(s2.pv)), h('td', null, s2.prev === null ? '–' : tr === null ? '0%' : deltaChip(s2.pv, s2.prev)), h('td', null, fmt(s2.uv))],
          h('td', null, s2.realtime === null ? '–' : fmt(s2.realtime)), h('td', { class: 's3-cut', title: 'หน้าที่คนเปิดมากสุดในระบบนี้' }, topPageTxt(s2.key)), h('td', null, h('span', { class: `s3-pill st-${stCls(s2)}` }, stTxt(s2)))); }))));
  }
  function drawNote() { drawNoteBase(); if (deptOn()) note.textContent += W_NOTE_DEPT; else if (hospOut()) note.textContent += W_NOTE_OUT; else if (hospIn()) note.textContent += W_NOTE_IN; }
  function drawNoteBase() {
    if (ins) { note.textContent = `ห้องหนึ่ง = หนึ่งหน้าของระบบ · คน 1 คนในภาพ ≈ ${fmt(ins.pf)} การเปิดหน้า · เส้นทางเดินระหว่างห้องนับจากผู้เข้าชมคนเดียวกันในวันเดียวกัน (ไม่ระบุตัวตน) · ภาพเป็น "วันทั่วไป" ที่เฉลี่ยจากช่วง ${S.days} วัน (เวลาไทย) · เวลาเดินและเวลาอยู่ในห้องเป็นเวลาสมมติเพื่อให้มองเห็นได้`; return; }
    if (dayOn()) { note.textContent = `${S.source === 'sample' ? 'ข้อมูลตัวอย่างเพื่อแสดงการทำงานของผัง · ' : ''}คน 1 คนในภาพ = การเข้าใช้จริง 1 ครั้ง${R.rep.scale > 1 ? ` (สุ่มแสดง 1 ใน ${R.rep.scale} คน ตัวเลขด้านบนเป็นค่าจริงทั้งหมด)` : ''} · คนที่มีวงแหวนสีทองคือผู้ใช้เดิมที่กลับมาใหม่ภายในวันเดียวกัน (ห่างจากการเปิดครั้งก่อนเกิน 30 นาที) · ${REPLAY_PRIVACY} · เวลาเดินเข้า–ออกและเวลาอยู่ที่สถานีเป็นเวลาสมมติเพื่อให้มองเห็นได้ · ไม่นับบอท`; return; }
    note.textContent = `${S.source === 'sample' ? 'ข้อมูลตัวอย่างเพื่อแสดงการทำงานของผัง · ' : ''}คน 1 คนในภาพ ≈ ${fmt(pf)} การเปิดหน้า · ภาพเป็น "วันทั่วไป" ที่เฉลี่ยจากช่วง ${S.days} วัน (เวลาไทย) ไม่ใช่ตัวเลขของวันใดวันหนึ่ง · เวลาเดินเข้า–ออกและเวลาอยู่ที่สถานีเป็นเวลาสมมติเพื่อให้มองเห็นได้ · สถิติไม่ใช้คุกกี้ ไม่เก็บ IP และไม่นับบอท`;
  }
  function drawTitle() { titleEl.textContent = ins ? `${ins.site.name} · ภายในระบบ` : view === 'hospital' ? (hospIn() ? `${BLD(hb).name} · ภายในอาคาร` : 'โรงพยาบาลสันทราย · ภาพรวมโรงพยาบาล') : TITLE_FLOOR; backBtn.textContent = ins ? (view === 'hospital' && hb ? '← กลับเข้าอาคาร' : '← กลับผังรวม') : '← ออกจากอาคาร'; tblTitle.textContent = ins ? 'ทุกหน้าในระบบนี้' : 'ทุกโครงการ'; backBtn.hidden = !(ins || hospIn()); openBtn.hidden = !(ins && S.source === 'real' && opts.onOpen); }
  function drawAll() { drawTitle(); drawRange(); drawViews(); drawModes(); drawStatus(); drawKpis(); drawHours(); drawInsights(); drawLegend(); drawTable(); drawRoomCard(); drawNote(); sync(); }

  // ---------- control ----------
  const liveUsable = () => !ins && mode !== 'peak';
  function unlive() { if (!liveOn) return; liveOn = false; try { localStorage.setItem(LIVE_KEY, '0'); } catch { /* ignore */ } liveBtn.setAttribute('aria-pressed', 'false'); }
  function setLive(v) {
    if (v && !liveUsable()) { toast(ins ? 'โหมดเรียลไทม์ใช้ได้เฉพาะผังรวม' : 'โหมดเรียลไทม์ใช้กับ “วันนี้” หรือ “วันทั่วไป” เท่านั้น', 'info', 2600); return; }
    liveOn = v; try { localStorage.setItem(LIVE_KEY, v ? '1' : '0'); } catch { /* ignore */ } liveBtn.setAttribute('aria-pressed', String(v)); lastMin = -1;
    if (v) { playing = false; sync(); refreshLive(true); toast('เรียลไทม์: นาฬิกาเดินตามเวลาจริง และอัปเดตข้อมูลเองทุก 30 วินาที', 'success', 2600); } else toast('ปิดเรียลไทม์');
  }
  /** Fetch fresh numbers (the floor, and today's replay) – called by the timer while real-time is on. */
  function refreshLive(force = false) {
    if (document.hidden || S.busy || !S.at || S.source !== 'real') return;
    if (force || Date.now() - S.at > 30000) load();
    if (mode !== 'typical' && R.rep && (force || Date.now() - R.at > 30000)) { delete RC[mode + S.source]; loadReplay(mode, true); }
  }
  function play() { unlive(); if (t >= range.to - 1) t = range.from; playing = true; sync(); }
  function pause() { unlive(); playing = false; sync(); }
  function sync() { playBtn.replaceChildren(svgIcon(playing ? '<path d="M8 5v14M16 5v14"/>' : '<path d="M7 4l13 8-13 8z"/>', 16), playing ? 'หยุด' : mode === 'today' && !ins ? 'เล่นย้อนดูวันนี้' : mode === 'peak' && !ins ? 'เล่นย้อนดูวันที่คนใช้มากสุด' : 'เล่นย้อนดูทั้งวัน'); }

  // ---------- geometry ----------
  const P = (x, y, z = 0) => [ox + ((x - y) * tw) / 2, oy + ((x + y) * tw) / 4 - z];
  const Z = (u) => u * tw * 0.5;
  function resize() {
    const r = scroller.getBoundingClientRect(); const avail = Math.max(280, Math.round(r.width)); const w = Math.max(avail, 600); let hgt; dpr = Math.min(2, devicePixelRatio || 1);
    if (ins || !sites.length) { hgt = Math.round(w * 0.58); tw = Math.min(w / 12.6, (hgt * 0.8) / (G / 2)); ox = w / 2; oy = hgt * 0.14; }
    else { const sum = WX + WY + WD; tw = (1.94 * w) / sum; oy = tw * (view === 'hospital' ? (hospOut() ? 1.25 : 1.15) : 1.1) + (WD * tw) / 4; ox = w / 2 + ((WY - WD - WX) * tw) / 4; hgt = Math.round(oy + ((WX + WY) * tw) / 4 + tw * 0.95); }
    cv.width = w * dpr; cv.height = hgt * dpr; cv.style.width = `${w}px`; cv.style.height = `${hgt}px`;
    scroller.scrollLeft = (w - avail) / 2; lastMin = -1; if (ins && focus >= 0) setCam(FOCUS_ZOOM, center(focus, ILAY)); else setCam(1, [0, 0]);
  }

  // ---------- drawing ----------
  const poly = (pts, fill, stroke, lw = 1) => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); } };
  function box(x, y, w, d, hu, col, z0 = 0) {
    const x0 = x - w / 2; const x1 = x + w / 2; const y0 = y - d / 2; const y1 = y + d / 2; const a = Z(z0); const b = Z(z0 + hu);
    poly([P(x0, y1, a), P(x1, y1, a), P(x1, y1, b), P(x0, y1, b)], shade(col, 0.82)); poly([P(x1, y0, a), P(x1, y1, a), P(x1, y1, b), P(x1, y0, b)], shade(col, 0.66));
    poly([P(x0, y0, b), P(x1, y0, b), P(x1, y1, b), P(x0, y1, b)], shade(col, 1.08));
  }
  function person(x, y, col, back = false, now = 0, sc = 1, role = '') {
    const [sx, sy] = P(x, y); const s = tw * 0.075 * sc;
    if (back) {   // came back the same day: gold halo on the floor, dark outline on the body, gold ring round the head
      const k = reduced ? 1 : 0.9 + 0.1 * Math.sin(now / 280 + x * 3);
      ctx.fillStyle = 'rgba(245,158,11,.30)'; ctx.beginPath(); ctx.ellipse(sx, sy, s * 2.1 * k, s * 0.98 * k, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = BACK_COL; ctx.lineWidth = Math.max(1.4, s * 0.32); ctx.beginPath(); ctx.ellipse(sx, sy, s * 2.1 * k, s * 0.98 * k, 0, 0, 7); ctx.stroke();
    } else { ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.beginPath(); ctx.ellipse(sx, sy, s * 1.2, s * 0.55, 0, 0, 7); ctx.fill(); }
    ctx.fillStyle = col; ctx.beginPath(); ctx.roundRect(sx - s * 0.85, sy - s * 3.3, s * 1.7, s * 3.3, s * 0.7); ctx.fill();
    if (back) { ctx.strokeStyle = pal.ink; ctx.lineWidth = Math.max(1.5, s * 0.4); ctx.stroke(); }
    ctx.fillStyle = '#f1c9a5'; ctx.beginPath(); ctx.arc(sx, sy - s * 4, s * 0.85, 0, 7); ctx.fill();
    if (back) { ctx.strokeStyle = BACK_COL; ctx.lineWidth = Math.max(1.5, s * 0.42); ctx.stroke(); }
    if (role && ROLES[role]) { ctx.fillStyle = ROLES[role].col; ctx.beginPath(); ctx.arc(sx, sy - s * 5.6, s * 0.75, 0, 7); ctx.fill(); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(1, s * 0.25); ctx.stroke(); }   // coloured dot over the head = role (admin purple, head orange, officer cyan, committee green, researcher pink, general user grey)
  }
  function pill(text, x, y, color, sc = 1) {
    const kz = Math.pow(cam.z, -0.6) * sc;   // labels grow only a little when the camera zooms in
    ctx.font = `600 ${Math.max(9, tw * 0.15 * kz)}px ${font}`; const w = ctx.measureText(text).width + 14 * kz; const hh = Math.max(16, tw * 0.27 * kz);
    if (!ins && cam.z < 1.05) { const cw = cv.width / dpr; x = Math.min(Math.max(x, w / 2 + 4), cw - w / 2 - 4); }
    ctx.fillStyle = pal.pill; ctx.strokeStyle = color || pal.pillLine; ctx.lineWidth = 1; ctx.beginPath(); ctx.roundRect(x - w / 2, y - hh / 2, w, hh, hh / 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = color || pal.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, x, y + 0.5);
  }
  // ---------- hospital building: floor slab, service corridor, emblem ----------
  function hospitalBase(now) {
    const th = Z(0.32); const A = P(0, WY); const B = P(WX, WY); const C = P(WX, hospOut() ? -WD : 0); const ch = corrH; const rect = (y0, y1, x0 = 0.2, x1 = WX - 0.2) => [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)];
    poly([A, B, [B[0], B[1] + th], [A[0], A[1] + th]], shade(pal.slab, 0.9)); poly([B, C, [C[0], C[1] + th], [B[0], B[1] + th]], shade(pal.slab, 0.72));   // building slab (visible sides)
    { const yb = hospOut() ? -WD : 0; poly([P(0, yb), P(WX, yb), P(WX, WY), P(0, WY)], hospOut() ? pal.grass : pal.floor); } if (hospOn()) return;   // the campus draws its own ground in campusGround()
    ctx.strokeStyle = pal.grid; ctx.lineWidth = 1; ctx.beginPath(); for (let i = 0; i <= Math.floor(WX); i++) { const a2 = P(i, 0); const b2 = P(i, WY); ctx.moveTo(a2[0], a2[1]); ctx.lineTo(b2[0], b2[1]); } for (let i = 0; i <= Math.floor(WY); i++) { const c2 = P(0, i); const d2 = P(WX, i); ctx.moveTo(c2[0], c2[1]); ctx.lineTo(d2[0], d2[1]); } ctx.stroke();
    ctx.globalAlpha = 0.9; poly(rect(CYc - ch, CYc + ch), pal.corr); ctx.globalAlpha = 1; poly(rect(CYc - ch, CYc + ch), null, pal.grid, 1.5);
    ctx.save(); ctx.strokeStyle = pal.brand; ctx.globalAlpha = 0.5; ctx.lineWidth = Math.max(1.5, tw * 0.02); ctx.setLineDash([tw * 0.12, tw * 0.1]); ctx.beginPath(); const l0 = P(1.7, CYc); const l1 = P(WX - 1.7, CYc); ctx.moveTo(l0[0], l0[1]); ctx.lineTo(l1[0], l1[1]); ctx.stroke(); ctx.restore();
    const pulse = reduced ? 0.85 : 0.75 + 0.15 * Math.sin(now / 600); ctx.globalAlpha = pulse;   // medical cross emblem painted on the corridor / road
    const mx = WX / 2; poly([P(mx - 0.55, CYc - 0.15), P(mx + 0.55, CYc - 0.15), P(mx + 0.55, CYc + 0.15), P(mx - 0.55, CYc + 0.15)], pal.brand); poly([P(mx - 0.15, CYc - ch + 0.05), P(mx + 0.15, CYc - ch + 0.05), P(mx + 0.15, CYc + ch - 0.05), P(mx - 0.15, CYc + ch - 0.05)], pal.brand); ctx.globalAlpha = 1;
    poly([P(0, 0), P(WX, 0), P(WX, WY), P(0, WY)], null, pal.brand, 2);   // building outline
  }

  // ---------- gates: เข้าสู่ระบบ (teal) / ออกสู่ระบบ (rose) — a glass portal with a neon frame, a scan band and chevrons that flow the way people walk ----------
  function gatePad(kind, now) {
    const g = GATE[kind]; const [gx, gy] = g.at; const y0 = gy - GATE_W - 0.08; const y1 = gy + GATE_W + 0.08; const pad = [P(gx - 0.62, y0), P(gx + 0.62, y0), P(gx + 0.62, y1), P(gx - 0.62, y1)];
    ctx.globalAlpha = reduced ? 0.26 : 0.2 + 0.08 * Math.sin(now / 420 + (kind === 'in' ? 0 : 2)); poly(pad, g.col); ctx.globalAlpha = 1; poly(pad, null, g.col, 1.5);
    ctx.strokeStyle = g.col; ctx.lineWidth = Math.max(2, tw * 0.035); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let k = 0; k < 3; k++) {
      const fr = reduced ? (k + 0.5) / 3 : (now / 1100 + k / 3) % 1; const x = gx - 0.5 + fr; ctx.globalAlpha = Math.sin(Math.PI * fr) * 0.95;
      ctx.beginPath(); [P(x - 0.1, gy - 0.17), P(x + 0.07, gy), P(x - 0.1, gy + 0.17)].forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py))); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  function gateItems(kind, now) {
    const g = GATE[kind]; const [gx, gy] = g.at; const y0 = gy - GATE_W - 0.08; const y1 = gy + GATE_W + 0.08; const fr = pal.frame;
    const pillar = (y) => () => { box(gx, y, 0.17, 0.17, GATE_H, fr); faceX(gx + 0.087, y - 0.04, y + 0.04, 0.06, GATE_H - 0.03, g.col); box(gx, y, 0.1, 0.1, 0.05, g.col, GATE_H); };
    return [{ d: gx + y0, f: pillar(y0) }, { d: gx + gy + 0.001, f: () => {
      ctx.globalAlpha = 0.16 + (reduced ? 0.04 : 0.04 * Math.sin(now / 500)); faceX(gx, y0 + 0.09, y1 - 0.09, 0.05, GATE_H - 0.02, g.col);
      const f = reduced ? 0.5 : (now / 1700 + (kind === 'in' ? 0 : 0.5)) % 1; const zb = 0.08 + f * (GATE_H - 0.3); ctx.globalAlpha = 0.05 + 0.5 * Math.sin(Math.PI * f); faceX(gx, y0 + 0.09, y1 - 0.09, zb, zb + 0.11, shade(g.col, 1.6)); ctx.globalAlpha = 1;
      box(gx, gy, 0.2, y1 - y0 + 0.17, 0.17, fr, GATE_H); faceX(gx + 0.102, y0 - 0.06, y1 + 0.06, GATE_H + 0.05, GATE_H + 0.12, g.col);
    } }, { d: gx + y1, f: pillar(y1) }];
  }
  /** Icon badge on the lintel + name + live counter (drawn on top of the crowd). */
  function gateSign(kind, sub) {
    const g = GATE[kind]; const [gx, gy] = g.at; const [ax, ay] = P(gx, gy, Z(GATE_H + 0.42)); const kz = Math.pow(cam.z, -0.6); const r = Math.max(9, tw * 0.1 * kz); const hh = Math.max(16, tw * 0.27 * kz); const u = r * 0.5;
    ctx.fillStyle = g.col; ctx.beginPath(); ctx.arc(ax, ay, r, 0, 7); ctx.fill(); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(1.6, r * 0.2); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath();
    if (kind === 'in') { ctx.moveTo(ax + u * 0.55, ay - u * 0.75); ctx.lineTo(ax + u * 0.85, ay - u * 0.75); ctx.lineTo(ax + u * 0.85, ay + u * 0.75); ctx.lineTo(ax + u * 0.55, ay + u * 0.75); ctx.moveTo(ax - u * 0.9, ay); ctx.lineTo(ax + u * 0.3, ay); ctx.moveTo(ax - u * 0.1, ay - u * 0.45); ctx.lineTo(ax + u * 0.35, ay); ctx.lineTo(ax - u * 0.1, ay + u * 0.45); }
    else { ctx.moveTo(ax - u * 0.55, ay - u * 0.75); ctx.lineTo(ax - u * 0.85, ay - u * 0.75); ctx.lineTo(ax - u * 0.85, ay + u * 0.75); ctx.lineTo(ax - u * 0.55, ay + u * 0.75); ctx.moveTo(ax - u * 0.25, ay); ctx.lineTo(ax + u * 0.9, ay); ctx.moveTo(ax + u * 0.45, ay - u * 0.45); ctx.lineTo(ax + u * 0.9, ay); ctx.lineTo(ax + u * 0.45, ay + u * 0.45); }
    ctx.stroke(); pill(g.label, ax, ay - r - hh * 0.72, g.col);
    const [sx, sy] = P(gx, gy + GATE_W + 0.62, 0); pill(sub, sx, sy, g.col, 0.9);
  }

  // ---------- station models (one per kind of system) ----------
  const faceY = (x0, x1, y, z0, z1, fill) => poly([P(x0, y, Z(z0)), P(x1, y, Z(z0)), P(x1, y, Z(z1)), P(x0, y, Z(z1))], fill);   // wall facing the viewer (+y)
  const faceX = (x, y0, y1, z0, z1, fill) => poly([P(x, y0, Z(z0)), P(x, y1, Z(z0)), P(x, y1, Z(z1)), P(x, y0, Z(z1))], fill);   // wall facing the viewer (+x)
  const disc = (x, y, z, r, fill) => { const [sx, sy] = P(x, y, Z(z)); ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(sx, sy, r, 0, 7); ctx.fill(); };
  const SK = '#f1c9a5';
  function prop(th, cx, cy, col, lit, st, now, i) {
    const blink = lit && !reduced ? Math.floor(now / 260) % 2 : 0;
    if (th === 'ems') {   // รถพยาบาล: body, cab, red cross, light bar (blinks while the project has people online)
      box(cx - 0.4, cy - 0.33, 0.24, 0.1, 0.24, '#111827'); box(cx + 0.55, cy - 0.33, 0.24, 0.1, 0.24, '#111827');
      box(cx - 0.1, cy, 1.2, 0.7, 0.55, '#f8fafc', 0.14); box(cx + 0.62, cy, 0.5, 0.7, 0.38, '#e2e8f0', 0.14);
      faceX(cx + 0.87, cy - 0.28, cy + 0.28, 0.3, 0.48, '#38bdf8'); faceY(cx - 0.7, cx + 0.5, cy + 0.351, 0.2, 0.28, '#dc2626');
      faceY(cx - 0.22, cx + 0.02, cy + 0.352, 0.5, 0.56, '#dc2626'); faceY(cx - 0.13, cx - 0.07, cy + 0.352, 0.41, 0.65, '#dc2626');
      box(cx - 0.4, cy + 0.33, 0.24, 0.1, 0.24, '#111827'); box(cx + 0.55, cy + 0.33, 0.24, 0.1, 0.24, '#111827');
      box(cx + 0.45, cy, 0.14, 0.4, 0.08, blink ? '#ef4444' : '#3b82f6', 0.52); box(cx - 0.55, cy, 0.14, 0.3, 0.07, blink ? '#3b82f6' : '#ef4444', 0.69);
    } else if (th === 'hrd') {   // ห้องอบรม: whiteboard, podium, 2 rows x 3 student desks
      box(cx, cy - 0.85, 1.7, 0.06, 0.8, '#f1f5f9', 0.4); faceY(cx - 0.7, cx + 0.1, cy - 0.819, 1.05, 1.11, col); faceY(cx - 0.7, cx + 0.5, cy - 0.819, 0.93, 0.97, '#94a3b8'); faceY(cx - 0.7, cx - 0.1, cy - 0.819, 0.81, 0.85, '#94a3b8');
      box(cx + 0.55, cy - 0.5, 0.35, 0.28, 0.45, pal.desk);
      for (const j of [0, 1]) for (const k of [-1, 0, 1]) { const x = cx + k * 0.55; const y = cy - 0.05 + j * 0.55; box(x, y - 0.18, 0.2, 0.14, 0.24, shade(col, 0.9), 0.06); disc(x, y - 0.2, 0.46, tw * 0.04, SK); box(x, y, 0.42, 0.26, 0.24, pal.desk); box(x, y - 0.02, 0.16, 0.02, 0.1, '#e2e8f0', 0.24); }
    } else if (th === 'ec') {   // ห้องวิจัย: lab bench, microscope, flasks, document table + ethics shield
      box(cx, cy - 0.35, 1.7, 0.5, 0.4, '#e2e8f0'); box(cx, cy - 0.35, 1.7, 0.5, 0.06, '#0f766e', 0.4);
      box(cx - 0.55, cy - 0.35, 0.28, 0.24, 0.05, '#334155', 0.46); box(cx - 0.58, cy - 0.4, 0.08, 0.08, 0.38, '#475569', 0.5); box(cx - 0.5, cy - 0.35, 0.26, 0.09, 0.07, '#94a3b8', 0.82);
      box(cx - 0.05, cy - 0.35, 0.15, 0.15, 0.22, '#22d3ee', 0.46); box(cx + 0.25, cy - 0.35, 0.15, 0.15, 0.3, '#4ade80', 0.46); box(cx + 0.55, cy - 0.35, 0.15, 0.15, 0.18, '#fbbf24', 0.46);
      box(cx - 0.2, cy + 0.5, 1.2, 0.36, 0.3, '#cbd5e1'); box(cx - 0.45, cy + 0.5, 0.3, 0.22, 0.05, '#ffffff', 0.3); box(cx - 0.45, cy + 0.5, 0.3, 0.22, 0.05, '#f8fafc', 0.35);
      const [sx, sy] = P(cx + 0.6, cy + 0.5, Z(0.95)); const u = tw * 0.085; poly([[sx - u, sy - u], [sx + u, sy - u], [sx + u, sy], [sx, sy + u * 1.35], [sx - u, sy]], col, '#ffffff', 1.2);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(1.5, u * 0.22); ctx.beginPath(); ctx.moveTo(sx - u * 0.45, sy - u * 0.1); ctx.lineTo(sx - u * 0.1, sy + u * 0.35); ctx.lineTo(sx + u * 0.5, sy - u * 0.5); ctx.stroke();
    } else if (th === 'vaccine') {   // ห้องวัคซีน: cold-chain fridge, exam bed, vial tray, nurse
      box(cx - 0.62, cy - 0.5, 0.5, 0.5, 1.15, '#e0f2fe'); faceY(cx - 0.86, cx - 0.38, cy - 0.248, 0.6, 0.64, '#93c5fd'); faceY(cx - 0.55, cx - 0.5, cy - 0.248, 0.7, 0.95, '#64748b'); faceY(cx - 0.55, cx - 0.5, cy - 0.248, 0.2, 0.45, '#64748b');
      box(cx + 0.1, cy + 0.15, 1.0, 0.5, 0.28, '#0d9488'); box(cx - 0.28, cy + 0.15, 0.25, 0.4, 0.06, '#f8fafc', 0.28);
      box(cx + 0.65, cy - 0.45, 0.35, 0.3, 0.4, '#cbd5e1'); for (const d of [0, 1, 2]) { box(cx + 0.55 + d * 0.1, cy - 0.45, 0.07, 0.07, 0.13, '#38bdf8', 0.4); box(cx + 0.55 + d * 0.1, cy - 0.45, 0.07, 0.07, 0.03, '#ef4444', 0.53); }
      person(cx + 0.5, cy + 0.55, '#ffffff');
    } else if (th === 'dental') {   // ห้องทันตกรรม: dental chair, lamp, instrument tray
      box(cx, cy + 0.1, 0.5, 0.5, 0.12, '#475569'); box(cx - 0.1, cy + 0.1, 0.7, 0.45, 0.18, '#0ea5e9', 0.12); box(cx - 0.55, cy + 0.1, 0.25, 0.45, 0.55, '#0ea5e9', 0.12);
      box(cx + 0.5, cy - 0.35, 0.06, 0.06, 0.95, '#94a3b8'); box(cx + 0.3, cy - 0.35, 0.42, 0.14, 0.08, '#f8fafc', 0.95); box(cx + 0.55, cy + 0.55, 0.35, 0.3, 0.4, '#e2e8f0'); box(cx + 0.55, cy + 0.55, 0.2, 0.08, 0.03, '#94a3b8', 0.4);
    } else if (th === 'pt') {   // ห้องกายภาพ: treatment bed, parallel bars, exercise ball
      box(cx - 0.35, cy + 0.1, 1.1, 0.55, 0.3, '#14b8a6'); box(cx - 0.7, cy + 0.1, 0.3, 0.5, 0.08, '#f8fafc', 0.3);
      for (const [x, y] of [[0.05, -0.55], [0.95, -0.55], [0.05, -0.15], [0.95, -0.15]]) box(cx + x, cy + y, 0.05, 0.05, 0.5, '#94a3b8'); box(cx + 0.5, cy - 0.55, 1.0, 0.05, 0.05, '#64748b', 0.5); box(cx + 0.5, cy - 0.15, 1.0, 0.05, 0.05, '#64748b', 0.5);
      disc(cx + 0.45, cy + 0.65, 0.22, tw * 0.1, col);
    } else if (th === 'plan') {   // ห้องแผนงาน: Gantt wall board + planning table
      box(cx, cy - 0.8, 1.7, 0.06, 0.9, '#f8fafc', 0.4); faceY(cx - 0.75, cx - 0.1, cy - 0.769, 1.12, 1.2, col); faceY(cx - 0.4, cx + 0.3, cy - 0.769, 0.97, 1.05, '#f59e0b'); faceY(cx - 0.1, cx + 0.65, cy - 0.769, 0.82, 0.9, '#16a34a'); faceY(cx + 0.2, cx + 0.7, cy - 0.769, 0.67, 0.75, '#8b5cf6');
      box(cx, cy + 0.15, 1.3, 0.55, 0.3, pal.desk); box(cx - 0.2, cy + 0.15, 0.45, 0.3, 0.03, '#334155', 0.3); box(cx + 0.35, cy + 0.1, 0.12, 0.12, 0.02, '#fde047', 0.3); box(cx + 0.5, cy + 0.25, 0.12, 0.12, 0.02, '#fb7185', 0.3);
    } else if (th === 'doc') {   // ห้องสารบรรณ: filing cabinets, file boxes, stamp desk
      for (const k of [-1, 0, 1]) { const x = cx + k * 0.58; box(x, cy - 0.45, 0.5, 0.5, 0.95, '#94a3b8'); faceY(x - 0.2, x + 0.2, cy - 0.199, 0.2, 0.24, '#64748b'); faceY(x - 0.2, x + 0.2, cy - 0.199, 0.5, 0.54, '#64748b'); faceY(x - 0.2, x + 0.2, cy - 0.199, 0.8, 0.84, '#64748b'); box(x, cy - 0.45, 0.32, 0.22, 0.14, k === 0 ? col : k < 0 ? '#f59e0b' : '#60a5fa', 0.95); }
      box(cx, cy + 0.5, 1.2, 0.4, 0.28, pal.desk); box(cx - 0.25, cy + 0.5, 0.3, 0.22, 0.04, '#ffffff', 0.28); box(cx + 0.3, cy + 0.5, 0.14, 0.14, 0.12, '#dc2626', 0.28);
    } else if (th === 'visit') {   // เยี่ยมบ้าน: house + map pin
      const hx = cx - 0.3; const z = Z(0.5); box(hx, cy, 0.85, 0.7, 0.5, '#fde68a'); faceY(hx - 0.1, hx + 0.1, cy + 0.351, 0, 0.3, '#92400e');
      const ap = P(hx, cy, Z(0.95)); poly([P(hx - 0.5, cy + 0.42, z), P(hx + 0.5, cy + 0.42, z), ap], '#dc2626'); poly([P(hx + 0.5, cy - 0.42, z), P(hx + 0.5, cy + 0.42, z), ap], '#b91c1c');
      const [px, py] = P(cx + 0.6, cy + 0.45, Z(0.2)); const r = tw * 0.075; ctx.fillStyle = '#ef4444'; ctx.beginPath(); ctx.arc(px, py - r * 2.2, r, 0, 7); ctx.fill(); poly([[px - r * 0.85, py - r * 1.5], [px + r * 0.85, py - r * 1.5], [px, py]], '#ef4444'); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(px, py - r * 2.2, r * 0.4, 0, 7); ctx.fill();
    } else {   // เว็บไซต์ทั่วไป: desk + monitor (screen colour = status)
      box(cx, cy, 1.3, 0.5, 0.45, pal.desk);
      const glow = lit && !reduced ? 1 + 0.12 * Math.sin(now / 260) : 1; box(cx, cy, 0.55, 0.08, 0.5, lit ? shade(col, glow) : SCREEN[st] || pal.screen, 0.45);
    }
  }

  // ---------- plan views: department (rooms = pages) · hospital (rooms = systems) ----------
  const shm = new Map();
  const wsh = (c, f) => { const k = `${c}|${f}`; let v = shm.get(k); if (!v) { v = shade(c, f); shm.set(k, v); } return v; };
  const rectPts = (x0, y0, x1, y1) => [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)];
  const bbox = (pts) => ({ x0: Math.min(...pts.map((q) => q[0])), x1: Math.max(...pts.map((q) => q[0])), y0: Math.min(...pts.map((q) => q[1])), y1: Math.max(...pts.map((q) => q[1])) });
  /** Draw `fn` (a model built for a 2 x 2 cell) at scale k around its centre (cx, cy). */
  function scaled(k, cx, cy, fn) {
    const t0 = tw; const x0 = ox; const y0 = oy; const nt = t0 * k; ox = x0 + ((cx - cy) * (t0 - nt)) / 2; oy = y0 + ((cx + cy) * (t0 - nt)) / 4; tw = nt;
    try { fn(); } finally { tw = t0; ox = x0; oy = y0; }
  }
  function wallDraw(q) {
    if (q.hedge) {   // trimmed hedge: a dark green block with two lighter rounded tufts on top
      const mid = (q.a + q.b) / 2; const dkk = pal.wk < 1 ? 0.6 : 1; const hc = hx('#2f8f4e', dkk); const hl = shade('#46b36a', dkk);
      if (q.k === 'y') box(mid, q.c, q.b - q.a + 0.03, 0.44, q.h, hc); else box(q.c, mid, 0.44, q.b - q.a + 0.03, q.h, hc);
      const [bx, by] = q.k === 'y' ? P(mid, q.c, Z(q.h)) : P(q.c, mid, Z(q.h)); const sg = q.k === 'y' ? 1 : -1; ctx.fillStyle = hl;
      for (const o of [-0.1, 0.1]) { ctx.beginPath(); ctx.ellipse(bx + sg * o * tw * 0.5, by + o * tw * 0.12 * sg, tw * 0.1, tw * 0.055, 0, 0, 7); ctx.fill(); }
      return;
    }
    const fill = wsh(q.col, pal.wk * (q.k === 'x' ? 0.9 : 1)); const cap = wsh(q.col, pal.wk * 1.12); const e = 0.035;
    if (q.k === 'y') { faceY(q.a, q.b, q.c, 0, q.h, fill); poly([P(q.a, q.c - e, Z(q.h)), P(q.b, q.c - e, Z(q.h)), P(q.b, q.c + e, Z(q.h)), P(q.a, q.c + e, Z(q.h))], cap); }
    else { faceX(q.c, q.a, q.b, 0, q.h, fill); poly([P(q.c - e, q.a, Z(q.h)), P(q.c + e, q.a, Z(q.h)), P(q.c + e, q.b, Z(q.h)), P(q.c - e, q.b, Z(q.h))], cap); }
  }
  /** Who is where at minute `tt`: people standing at a system's reception (`at`) or in one of its rooms (`rm`), numbered by arrival so they take the standing places in order. */
  function planState(tt) {
    const n = sites.length; const cum = Array(n).fill(0); const at = sites.map(() => []); const rm = deptOn() ? DL.map((d) => d.rooms.map(() => [])) : [];
    for (const j of jr) {
      const s0 = j.stops[0]; const z = s0.zone; const pg = deptOn() && j.pg >= 0 && DL[z] && DL[z].rooms[j.pg] ? j.pg : -1;
      if (tt >= s0.start) cum[z] += 1;
      if (tt >= s0.start && tt < s0.end) (pg >= 0 ? rm[z][pg] : at[z]).push({ id: j.id, st: s0.start });
    }
    const rank = new Map(); const rk = (a2) => a2.sort((x, y) => x.st - y.st || x.id - y.id).forEach((w, i) => rank.set(w.id, i)); at.forEach(rk); rm.forEach((zs) => zs.forEach(rk));
    if (dayOn()) sites.forEach((s2, i) => { cum[i] = cumViews(R.rep, s2.key, tt); });   // a replayed day counts its real page views, not the drawn people
    return { cum, rank, at, rm };
  }
  /** Walk in from the gate → along the corridor (and the hall / lobby) → stand in the room → walk out to the exit gate. */
  function planPlace(j, tt, F) {
    if (tt < j.enter || tt >= j.exit) return null;
    const s0 = j.stops[0]; const z = s0.zone; const rank = F.rank.get(j.id) ?? 0; let route; let stand; let col = null; let state = 'work'; let ent = ENT; let ext = EXIT; let hid = false;
    if (deptOn()) {
      const d = DL[z]; const r = j.pg >= 0 && d ? d.rooms[j.pg] : null; const cx = d.hall.cx;
      if (r) { stand = deptStand(r, rank); route = [[cx, CYc], [cx, r.c[1]], r.door]; const u = (W.map[sites[z].key] || { units: [] }).units[j.pg]; col = u ? roomColor(u.kind) : colOf(z); state = 'room'; }
      else { stand = headStand(d, rank); route = [[cx, CYc]]; }
    } else if (HL.interior) { const r = HL.rooms[z]; if (!r) return null; stand = hospStand(r, rank); route = hospRoute(HL, r); ent = hospDoor(HL, r); ext = ent; }
    else { const wp = HL.walk[BL[z]]; stand = wp[wp.length - 1]; route = wp.slice(0, -1); ent = HL.entry; ext = ent; hid = true; }   // campus: walk from the front gate to the door of the building, then disappear inside
    const fade = (p) => (hospOut() ? Math.min(1, Math.hypot(p[0] - ent[0], p[1] - ent[1]) / 0.9, Math.hypot(p[0] - stand[0], p[1] - stand[1]) / 0.5) : hospOn() ? Math.min(1, Math.hypot(p[0] - ent[0], p[1] - ent[1]) / 0.9) : 1);   // steps out of / back into a door: fades with the distance from it
    if (tt < s0.start) { const pos = along([ent, ...route, stand], (tt - j.enter) / Math.max(1, s0.start - j.enter)); return { pos, state: 'walk', zone: z, rank: 0, a: fade(pos) }; }
    if (tt < s0.end) return { pos: stand, state, zone: z, rank, col, a: 1, hid };
    { const pos = along([stand, ...route.slice().reverse(), ext], (tt - s0.end) / Math.max(1, j.exit - s0.end)); return { pos, state: 'walk', zone: z, rank: 0, a: fade(pos) }; }
  }
  const lineOf = (i, F) => { const s = sites[i]; const st = stateOf(s); return st === 'ok' ? `${dayOn() && R.rep.scale === 1 ? '' : '≈'}${fmt(F.cum[i] * pfNow())} ครั้ง${s.realtime ? ` · ออนไลน์ ${fmt(s.realtime)}` : ''}` : STATE_TXT[st]; };
  const busyAt = (i, F) => F.at[i].length > 0 || (F.rm[i] || []).some((a2) => a2.length > 0);
  const dotAt = (x, y, z, c, blink, now, i) => { const [bx, by] = P(x, y, Z(z)); ctx.fillStyle = c; ctx.globalAlpha = blink ? 0.55 + (reduced ? 0.45 : 0.45 * Math.sin(now / 350 + i)) : 1; ctx.beginPath(); ctx.arc(bx, by, Math.max(3, tw * 0.05), 0, 7); ctx.fill(); ctx.globalAlpha = 1; };

  function deptScene(items, labels, F, now, kit) {
    const mx = Math.max(1, ...sites.map((s) => s.pv)); const topKey = sm.top && sm.top.pv > 0 ? sm.top.key : ''; const kz = Math.pow(cam.z, -0.6); const hh = Math.max(16, tw * 0.27 * kz);
    DL.forEach((d, i) => {
      const s = sites[i]; const st = stateOf(s); const lit = st === 'ok'; const col = colOf(i); const hov = hover === i; const pd = d.pad; const hd = d.head; const hc = d.c; const hall = d.hall;
      ctx.globalAlpha = 0.1 + 0.3 * (s.pv / mx); poly(rectPts(pd.x0, pd.y0, pd.x1, pd.y1), col); ctx.globalAlpha = 1; poly(rectPts(pd.x0, pd.y0, pd.x1, pd.y1), null, hov ? pal.ink : col, hov ? 2.4 : 1.2);
      if (s.key === topKey) { ctx.globalAlpha = reduced ? 1 : 0.55 + 0.45 * Math.sin(now / 300); poly(rectPts(pd.x0 + 0.06, pd.y0 + 0.06, pd.x1 - 0.06, pd.y1 - 0.06), null, '#f59e0b', 2.5); ctx.globalAlpha = 1; }
      ctx.globalAlpha = 0.95; poly(rectPts(hall.x0, hall.y0, hall.x1, hall.y1), pal.corr); ctx.globalAlpha = 0.3; poly(rectPts(hd.x0, hd.y0, hd.x1, hd.y1), col); ctx.globalAlpha = 1;
      ctx.save(); ctx.strokeStyle = col; ctx.globalAlpha = 0.65; ctx.lineWidth = Math.max(1.5, tw * 0.022); ctx.lineCap = 'round'; ctx.setLineDash([tw * 0.07, tw * 0.09]); ctx.lineDashOffset = reduced ? 0 : -(now / 55) * (d.top ? 1 : -1) * (tw / 60) * -1;
      const a2 = P(hall.cx, d.mouth[1]); const b2 = P(hall.cx, d.top ? hd.y1 : hd.y0); ctx.beginPath(); ctx.moveTo(a2[0], a2[1]); ctx.lineTo(b2[0], b2[1]); ctx.stroke(); ctx.restore();
      items.push({ d: hc[0] + hc[1], f: () => { ctx.globalAlpha = st === 'paused' || st === 'idle' ? 0.6 : 1; scaled(0.82, hc[0], hc[1], () => prop(themes[i], hc[0], hc[1], col, lit && (s.realtime > 0 || s.key === topKey), st, now, i)); ctx.globalAlpha = 1; dotAt(hc[0], hc[1], 1.25, STATE_COL[st], lit || st === 'silent', now, i); } });
      hits.push({ i, d: hc[0] + hc[1], ...bbox([...rectPts(hd.x0, hd.y0, hd.x1, hd.y1), P(hd.x0, hd.y0, Z(1.2)), P(hd.x1, hd.y0, Z(1.2))]) });
      const [lx, ly] = d.top ? P(hall.cx, hd.y0, Z(1.15)) : P(hall.cx, hd.y1, 0); const off = d.top ? -tw * 0.2 : tw * 0.22;
      labels.push({ x: lx, y: ly + off, text: `${THEMES[themes[i]].icon} ${short(s.name, 20)}`, col: !lit && st === 'silent' ? STATE_COL.silent : null, sc: 1 });
      labels.push({ x: lx, y: ly + off + hh + 3, text: lineOf(i, F), col: lit ? (busyAt(i, F) ? col : null) : STATE_COL[st], sc: 1 });
      const wg = W.map[s.key]; const mxw = wg ? Math.max(1, ...wg.units.map((u) => u.pv)) : 1;
      d.rooms.forEach((r) => {
        const u = wg && wg.units[r.p]; if (!u) return; const rc = roomColor(u.kind); const hot = F.rm[i][r.p].length > 0; const hv = !!hoverT && hoverT.i === i && hoverT.p === r.p; const k = Math.max(0.34, Math.min(0.62, r.w / 2.7));
        ctx.globalAlpha = 0.12 + 0.42 * (u.pv / mxw); poly(rectPts(r.x0, r.y0, r.x1, r.y1), rc); ctx.globalAlpha = 1; poly(rectPts(r.x0, r.y0, r.x1, r.y1), null, hv ? pal.ink : rc, hv ? 2.4 : 1);
        items.push({ d: r.c[0] + r.c[1] + 0.02, f: () => { ctx.globalAlpha = u.pv ? 1 : 0.55; scaled(k, r.px, r.c[1], () => drawRoom(kit, u.kind, r.px, r.c[1], rc, hot, now)); ctx.globalAlpha = 1; if (u.realtime > 0) dotAt(r.px, r.c[1], 0.95 * k + 0.5, STATE_COL.ok, true, now, r.p); } });
        whits.push({ i, p: r.p, key: u.key, d: r.c[0] + r.c[1], ...bbox([...rectPts(r.x0, r.y0, r.x1, r.y1), P(r.x0, r.y0, Z(0.8))]) });
        const [qx, qy] = P(r.c[0], r.y1 - 0.14, 0); labels.push({ x: qx, y: qy, text: `${kindMeta(u.kind).icon} ${short(u.name, hv ? 18 : 6)}`, col: hv ? rc : null, sc: 0.66 });
      });
    });
  }

  /** Move + scale a model drawn around local point `from` so `from` lands on world point `to` (heights scale too). */
  function placed(k, from, to, fn) { const t0 = tw; const x0 = ox; const y0 = oy; tw = t0 * k; ox = x0 + ((to[0] - to[1]) - k * (from[0] - from[1])) * t0 / 2; oy = y0 + ((to[0] + to[1]) - k * (from[0] + from[1])) * t0 / 4; try { fn(); } finally { tw = t0; ox = x0; oy = y0; } }
  /** The main hospital building (Sansai Hospital): cream tiers, tan balcony bands, purple trim, rooftop pavilion, ward block + tan tower, name board.
   *  It stands at the very BACK of the campus (nothing is behind it, so it can never hide a system) and faces the avenue. Drawn in local coordinates (front door at (7.5, 6.15)) and placed with placed(). */
  function hospBuilding(items) {
    const K = 1.2; const FROM = [7.5, 6.15]; const TO = HL.bld.main.door; const gx = 7.5; const dk = pal.wk < 1 ? 0.55 : 1; const Cc = (c) => hx(c, dk); const out = [];
    const CREAM = Cc('#efe2b4'); const TAN = Cc('#c9a24e'); const TAN2 = Cc('#b68f3c'); const PUR = Cc('#7a4bc4'); const PUR2 = Cc('#9266d8'); const GLASS = Cc('#a9c9e2'); const DOOR = '#475569';
    // one tier: a cream block with a tan balcony band + purple trim under the roof edge and rows of windows on the two faces the viewer sees (front +y, east +x)
    const tier = (cx, cy, w, d, z0, hh, rows, skipDoor) => {
      const x0 = cx - w / 2; const x1 = cx + w / 2; const y1 = cy + d / 2; const y0 = cy - d / 2; box(cx, cy, w, d, hh, CREAM, z0);
      const top = z0 + hh; faceY(x0, x1, y1 + 0.004, top - 0.14, top - 0.04, TAN); faceY(x0, x1, y1 + 0.005, top - 0.2, top - 0.16, PUR); faceX(x1 + 0.004, y0, y1, top - 0.14, top - 0.04, TAN2); faceX(x1 + 0.005, y0, y1, top - 0.2, top - 0.16, PUR);
      for (let r = 0; r < rows; r++) { const za = z0 + 0.16 + r * ((hh - 0.45) / Math.max(1, rows)); const zb = za + Math.min(0.34, (hh - 0.45) / Math.max(1, rows) - 0.08);
        for (let x = x0 + 0.2; x < x1 - 0.3; x += 0.42) { if (skipDoor && r === 0 && Math.abs(x + 0.15 - gx) < 0.6) continue; faceY(x, x + 0.3, y1 + 0.006, za, zb, GLASS); }
        for (let y = y0 + 0.2; y < y1 - 0.3; y += 0.42) faceX(x1 + 0.006, y, y + 0.3, za, zb, GLASS); }
    };
    out.push({ d: 7.5 + 4.55, f: () => {   // tier 1 + the entrance with its canopy
      tier(7.5, 4.55, 3.0, 3.2, 0, 1.25, 2, true);
      faceY(gx - 0.45, gx + 0.45, 6.152, 0, 0.8, DOOR); faceY(gx - 0.4, gx - 0.03, 6.153, 0.04, 0.74, GLASS); faceY(gx + 0.03, gx + 0.4, 6.153, 0.04, 0.74, GLASS);
    } });
    out.push({ d: gx + 6.15 + 0.5, f: () => { for (const x of [gx - 0.85, gx + 0.85]) box(x, 6.45, 0.1, 0.1, 0.85, CREAM); box(gx, 6.4, 2.1, 0.7, 0.08, PUR, 0.85); box(gx, 6.4, 2.16, 0.76, 0.03, TAN, 0.93); } });
    out.push({ d: 7.45 + 4.2 + 0.2, f: () => { tier(7.45, 4.2, 2.6, 2.5, 1.25, 0.95, 1, false); } });   // tier 2
    out.push({ d: 7.5 + 5.8 + 0.4, f: () => {   // solar panels on the roof of tier 1 (dark blue arrays, as on the hospital roofs)
      const SP = Cc('#1e3a8a'); for (let x = 6.2; x < 8.9; x += 0.56) { box(x, 5.8, 0.5, 0.52, 0.05, SP, 1.25); faceY(x - 0.22, x + 0.22, 6.07, 1.26, 1.29, Cc('#60a5fa')); }
    } });
    out.push({ d: 7.2 + 3.9 + 0.4, f: () => { tier(7.2, 3.9, 1.9, 1.7, 2.2, 0.8, 1, false); box(7.2, 3.9, 1.2, 0.9, 0.45, PUR, 3.0); box(7.2, 3.9, 1.34, 1.04, 0.07, PUR2, 3.45); } });   // tier 3 + purple rooftop pavilion
    out.push({ d: gx + 5.35 + 0.3, f: () => {   // name board on the tier-2 roof
      const tx = gx; box(tx, 5.35, 3.3, 0.16, 0.95, pal.brand, 2.2); const [ssx, ssy] = P(tx - 1.65, 5.431, Z(2.2)); const u = tw / 2;
      ctx.save(); ctx.translate(ssx, ssy); ctx.transform(1, 0.5, 0, 1, 0, 0);
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(0.45 * u, -0.48 * u, 0.3 * u, 0, 7); ctx.fill(); ctx.fillStyle = '#dc2626'; ctx.fillRect(0.45 * u - 0.07 * u, -0.48 * u - 0.19 * u, 0.14 * u, 0.38 * u); ctx.fillRect(0.45 * u - 0.19 * u, -0.48 * u - 0.07 * u, 0.38 * u, 0.14 * u);
      ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; const cxs = 2.0 * u; const l2 = 'กลุ่มงานพัฒนาคุณภาพและระบบบริการ';
      ctx.font = `700 ${0.27 * u}px ${font}`; ctx.fillText('โรงพยาบาลสันทราย', cxs, -0.64 * u); let fs = 0.17 * u; ctx.font = `600 ${fs}px ${font}`; const mw = ctx.measureText(l2).width; if (mw > 2.5 * u) { fs *= (2.5 * u) / mw; ctx.font = `600 ${fs}px ${font}`; } ctx.fillText(l2, cxs, -0.3 * u);
      ctx.restore();
    } });
    out.forEach((it) => items.push({ d: TO[0] + TO[1] + K * (it.d - FROM[0] - FROM[1]), f: () => placed(K, FROM, TO, it.f) }));
  }
  const LAWNS = [[0.2, -15.8, 11.6, 4.2], [14.8, -15.8, 26.5, 4.3], [15.2, 9.5, 26.5, 12.2], [0.2, 9.0, 5.0, 12.2]];   // grass of the campus (x0, y0, x1, y1)
  // ---------- hospital campus: ground, roads, traffic, parking ----------
  /** A prism over a world polygon (any winding) · only the faces turned to the viewer are drawn · `top` overrides the roof colour. */
  const qs = (c, f) => wsh(c, Math.round(f * 50) / 50);
  function prism(pts, z0, z1, col, top) {
    let ar = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i]; const b = pts[(i + 1) % pts.length]; ar += a[0] * b[1] - b[0] * a[1]; }
    const sg = ar > 0 ? 1 : -1; const zb = Z(z0); const zt = Z(z1);
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]; const b = pts[(i + 1) % pts.length]; const ex = b[0] - a[0]; const ey = b[1] - a[1]; const ln = Math.hypot(ex, ey) || 1; const nx = (sg * ey) / ln; const ny = (-sg * ex) / ln;
      if (nx + ny <= 0.001) continue;
      poly([P(a[0], a[1], zb), P(b[0], b[1], zb), P(b[0], b[1], zt), P(a[0], a[1], zt)], qs(col, 0.74 + 0.09 * (ny - nx)));
    }
    poly(pts.map((q) => P(q[0], q[1], zt)), top ? qs(top, 1) : qs(col, 1.08));
  }
  /** A road vehicle at (x, y) heading `ang` (world radians). kind: car · van · ems (ambulance, `flash` = emergency lights on). */
  function vehicle(x, y, ang, v, now, flash = false) {
    const ux = Math.cos(ang); const uy = Math.sin(ang); const vx = -uy; const vy = ux; const R = (l, w) => [x + ux * l + vx * w, y + uy * l + vy * w]; const rect = (l0, l1, w0, w1) => [R(l0, w0), R(l1, w0), R(l1, w1), R(l0, w1)];
    const ems = v.kind === 'ems'; const L = ems ? 1.4 : v.kind === 'van' ? 1.1 : 0.95; const Wd = ems ? 0.6 : v.kind === 'van' ? 0.54 : 0.5; const hl = L / 2; const hw = Wd / 2;
    poly(rect(-hl - 0.05, hl + 0.05, -hw - 0.04, hw + 0.04).map(([a, b]) => P(a, b)), 'rgba(0,0,0,.2)');
    for (const l of [-L * 0.3, L * 0.3]) for (const s of [-1, 1]) prism(rect(l - 0.1, l + 0.1, s * (hw - 0.01) - 0.045, s * (hw - 0.01) + 0.045), 0, 0.13, '#0f172a');
    if (ems) {
      prism(rect(-hl, L * 0.16, -hw, hw), 0.08, 0.56, '#f8fafc'); prism(rect(-hl - 0.004, L * 0.16 + 0.004, -hw - 0.004, hw + 0.004), 0.2, 0.27, '#dc2626', '#f8fafc');
      prism(rect(L * 0.16, hl, -hw, hw), 0.08, 0.36, '#e5e7eb'); prism(rect(hl - 0.05, hl, -hw + 0.07, hw - 0.07), 0.2, 0.33, '#38bdf8');
      const on = flash && !reduced ? Math.floor(now / 230) % 2 : 0;
      prism(rect(L * 0.02, L * 0.12, -hw + 0.07, 0), 0.56, 0.64, flash ? (on ? '#ef4444' : '#7f1d1d') : '#7f1d1d'); prism(rect(L * 0.02, L * 0.12, 0, hw - 0.07), 0.56, 0.64, flash ? (on ? '#1e3a8a' : '#3b82f6') : '#1e3a8a');
    } else {
      prism(rect(-hl, hl, -hw, hw), 0.07, 0.27, v.col);
      prism(rect(-L * (v.kind === 'van' ? 0.4 : 0.2), L * (v.kind === 'van' ? 0.22 : 0.17), -hw + 0.045, hw - 0.045), 0.27, 0.43, '#a9c9e2', v.col);
    }
    for (const s of [-1, 1]) prism(rect(hl, hl + 0.02, s * (hw - 0.1) - 0.05, s * (hw - 0.1) + 0.05), 0.13, 0.19, '#fde68a');
    if (pal.wk < 1 && v.lit !== false) { ctx.globalAlpha = 0.2; poly([R(hl, -hw + 0.08), R(hl + 0.9, -hw - 0.2), R(hl + 0.9, hw + 0.2), R(hl, hw - 0.08)].map(([a, b]) => P(a, b)), '#fde68a'); ctx.globalAlpha = 1; }
  }
  /** Round the corners of a polyline (radius r) so a car turns instead of pivoting; returns points + cumulative length. */
  function roundPath(pts, r) {
    const out = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1]; const b = pts[i]; const c = pts[i + 1]; const l1 = Math.hypot(b[0] - a[0], b[1] - a[1]); const l2 = Math.hypot(c[0] - b[0], c[1] - b[1]); const rr = Math.min(r, l1 / 2, l2 / 2);
      const p0 = [b[0] + ((a[0] - b[0]) / l1) * rr, b[1] + ((a[1] - b[1]) / l1) * rr]; const p1 = [b[0] + ((c[0] - b[0]) / l2) * rr, b[1] + ((c[1] - b[1]) / l2) * rr];
      for (let k = 0; k <= 8; k++) { const u = k / 8; const w0 = (1 - u) * (1 - u); const w1 = 2 * u * (1 - u); const w2 = u * u; out.push([w0 * p0[0] + w1 * b[0] + w2 * p1[0], w0 * p0[1] + w1 * b[1] + w2 * p1[1]]); }
    }
    out.push(pts[pts.length - 1]); const cum = [0]; for (let i = 1; i < out.length; i++) cum.push(cum[i - 1] + Math.hypot(out[i][0] - out[i - 1][0], out[i][1] - out[i - 1][1]));
    return { pts: out, cum, len: cum[cum.length - 1] };
  }
  function pathAt(pa, s) {
    const f = (u) => { const d = Math.min(pa.len, Math.max(0, u)); let i = 1; while (i < pa.cum.length - 1 && pa.cum[i] < d) i++; const k = (d - pa.cum[i - 1]) / Math.max(1e-6, pa.cum[i] - pa.cum[i - 1]); return [pa.pts[i - 1][0] + (pa.pts[i][0] - pa.pts[i - 1][0]) * k, pa.pts[i - 1][1] + (pa.pts[i][1] - pa.pts[i - 1][1]) * k]; };
    const p = f(s); const q = f(s + 0.06); return { x: p[0], y: p[1], ang: Math.atan2(q[1] - p[1], q[0] - p[0]) };
  }
  const CAR_COLS = ['#e5e7eb', '#1f2937', '#b91c1c', '#1d4ed8', '#f59e0b', '#64748b', '#0f766e', '#f8fafc', '#7c3aed'];
  const hash01 = (n) => { let x = Math.imul(n + 1, 2654435761) >>> 0; x = Math.imul(x ^ (x >>> 15), 2246822519) >>> 0; return (x >>> 8) / 16777216; };
  const shelterY = (f0) => Math.max(2, f0 * 0.45);
  /** Everything on the campus roads and in the car parks (built once per layout): lanes, driving cars, parked cars, lamp posts, trees. Left-hand traffic, as in Thailand. */
  function buildCampus(L) {
    const R = L.road.w; const f0 = L.road.front[0]; const e0 = L.road.east[0];
    const yN = f0 + R * 0.27; const yS = f0 + R * 0.73; const xW = e0 + R * 0.27; const xE = e0 + R * 0.73;
    const Dd = L.world.D || 0; const paths = [roundPath([[0.2, yN], [xW, yN], [xW, -Dd - 0.2]], 0.7), roundPath([[xE, -Dd - 0.2], [xE, yS], [0.2, yS]], 0.7), roundPath(L.road2, 0.7)];
    const cars = []; paths.forEach((pa, pi) => { for (let k = 0; k < (pi === 2 ? 3 : 4); k++) cars.push({ pa, off: (k / 3) * pa.len + pi * 2.1, sp: 1.5 + 0.35 * hash01(pi * 9 + k), v: { kind: k === 1 ? 'van' : 'car', col: CAR_COLS[Math.floor(hash01(pi * 13 + k * 5) * CAR_COLS.length)] } }); });
    const ems = { pa: paths[0], off: paths[0].len * 0.25, sp: 2.3, v: { kind: 'ems' } };
    const parked = []; let n = 0;
    L.lots.forEach((lot, li) => {
      const bw = 0.62; const nb = Math.max(1, Math.floor((lot.x1 - lot.x0 - 0.2) / bw)); const x0 = lot.x0 + ((lot.x1 - lot.x0) - nb * bw) / 2;
      lot.rows.forEach((ry, row) => { for (let b = 0; b < nb; b++) { n += 1; if (lot.ems && row === 0 && b < 2) continue; if (hash01(n * 7 + li) > (lot.rows.length > 2 ? 0.5 : 0.58)) continue; parked.push({ x: x0 + (b + 0.5) * bw, y: ry + 0.55, ang: row % 2 ? -Math.PI / 2 : Math.PI / 2, v: { kind: hash01(n) > 0.8 ? 'van' : 'car', col: CAR_COLS[Math.floor(hash01(n * 3) * CAR_COLS.length)], lit: false } }); } });
      lot.bw = bw; lot.nb = nb; lot.bx = x0;
    });
    const lamps = []; for (let x = 2.2; x < e0 - 1; x += 4.6) if (Math.abs(x - L.gate[0]) > 1.6) lamps.push({ x, y: f0 - 0.14 }); for (let y = 2.4 - Math.floor((Dd + 1) / 4.6) * 4.6; y < f0 - 1; y += 4.6) lamps.push({ x: e0 - 0.14, y });
    for (let y = 10.0; y > -Dd + 1; y -= 4.6) { lamps.push({ x: L.avenue.x0 - 0.15, y }); lamps.push({ x: L.avenue.x1 + 0.15, y: y - 2.3 }); }   // lamps along both sides of the central walkway
    const trees = []; for (let x = 1.4; x < e0 - 1; x += 3.1) if (Math.abs(x - L.gate[0]) > 2.2 && !lamps.some((q) => Math.abs(q.x - x) < 0.9)) trees.push({ x, y: f0 - L.road.walk / 2 - 0.02 });
    for (let y = 3.2 - Math.floor((Dd + 1) / 3.1) * 3.1; y < f0 - 1.2; y += 3.1) if (Math.abs(y - shelterY(f0)) > 1.4 && !lamps.some((q) => q.x > e0 - 1 && Math.abs(q.y - y) < 0.9)) trees.push({ x: e0 - L.road.walk / 2 - 0.02, y });
    return { paths, cars, ems, parked, lamps, trees, shelter: { x: e0 - L.road.walk / 2, y: shelterY(f0) } };
  }
  let CMP = null; let CMPfor = null;
  const tree = (x, y) => { box(x, y, 0.12, 0.12, 0.35, '#7c5a3a'); box(x, y, 0.62, 0.62, 0.42, '#22a35a', 0.35); box(x, y, 0.4, 0.4, 0.32, '#34c26f', 0.77); };
  function lamp(x, y) {
    prism([[x - 0.03, y - 0.03], [x + 0.03, y - 0.03], [x + 0.03, y + 0.03], [x - 0.03, y + 0.03]], 0, 1.25, '#64748b'); prism([[x - 0.2, y - 0.04], [x + 0.03, y - 0.04], [x + 0.03, y + 0.04], [x - 0.2, y + 0.04]], 1.25, 1.31, '#475569');
    if (pal.wk < 1) { const [gx2, gy2] = P(x - 0.15, y, 0); const g = ctx.createRadialGradient(gx2, gy2, 0, gx2, gy2, tw * 0.62); g.addColorStop(0, 'rgba(253,230,138,.5)'); g.addColorStop(1, 'rgba(253,230,138,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(gx2, gy2, tw * 0.62, tw * 0.3, 0, 0, 7); ctx.fill(); const [lx2, ly2] = P(x - 0.15, y, Z(1.28)); ctx.fillStyle = '#fde68a'; ctx.beginPath(); ctx.arc(lx2, ly2, Math.max(2, tw * 0.035), 0, 7); ctx.fill(); }
  }
  /** The flat ground of the campus (drawn under everything): paving, the two public roads with their markings, the car parks. */
  function campusGround() {
    const L = HL; const { GX, GY } = L.world; const camp = L.campus; const ro = L.road; const R = ro.w; const f0 = ro.front[0]; const e0 = ro.east[0]; const wk = ro.walk; const gx = L.gate[0]; const Y0 = camp.y0;
    const rc = (x0, y0, x1, y1, col, a = 1) => { ctx.globalAlpha = a; poly(rectPts(x0, y0, x1, y1), col); ctx.globalAlpha = 1; };
    const line = (x0, y0, x1, y1, col, lw, dash) => { ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, tw * lw); ctx.lineCap = 'butt'; ctx.setLineDash(dash ? [tw * 0.14, tw * 0.12] : []); const a = P(x0, y0); const b = P(x1, y1); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); ctx.restore(); };
    // paving of the whole campus, the lawns, the avenue to the main entrance and the paths to the emergency building
    rc(0.15, Y0 + 0.15, camp.x1 - 0.1, f0 - wk, pal.walk);
    for (const [x0, y0, x1, y1] of LAWNS) rc(x0, y0, x1, y1, pal.grass);
    rc(L.avenue.x0, L.bld.main.y1 - 0.2, L.avenue.x1, f0 - wk, pal.corr, 0.7);
    {   // the central connecting walkway (ทางเชื่อมกลาง): front gate → back of the campus, with the service lanes leaving it to the east, the covered links to the towers and the ground of the construction site
      const sp = L.avenue; const yBack = -L.world.D + 0.55; const dash = (x0, x1, y) => { ctx.save(); ctx.strokeStyle = pal.roadLine; ctx.globalAlpha = 0.7; ctx.lineWidth = Math.max(1, tw * 0.02); ctx.setLineDash([tw * 0.12, tw * 0.1]); const a2 = P(x0, y); const b2 = P(x1, y); ctx.beginPath(); ctx.moveTo(a2[0], a2[1]); ctx.lineTo(b2[0], b2[1]); ctx.stroke(); ctx.restore(); };
      for (const ln of L.lanes) { rc(ln.x0, ln.y0, ln.x1, ln.y1, pal.road); if (ln.x1 - ln.x0 >= ln.y1 - ln.y0) dash(ln.x0 + 0.2, ln.x1 - 0.2, (ln.y0 + ln.y1) / 2); else { ctx.save(); ctx.strokeStyle = pal.roadLine; ctx.globalAlpha = 0.7; ctx.lineWidth = Math.max(1, tw * 0.02); ctx.setLineDash([tw * 0.12, tw * 0.1]); const a2 = P((ln.x0 + ln.x1) / 2, ln.y0 + 0.2); const b2 = P((ln.x0 + ln.x1) / 2, ln.y1 - 0.2); ctx.beginPath(); ctx.moveTo(a2[0], a2[1]); ctx.lineTo(b2[0], b2[1]); ctx.stroke(); ctx.restore(); } }
      rc(sp.x0, yBack, sp.x1, f0 - wk, pal.corr, 0.8); poly(rectPts(sp.x0, yBack, sp.x1, f0 - wk), null, pal.grid, 1.2);
      for (const l of L.links) rc(Math.min(l.x0, l.x1) - 0.05, l.y - 0.45, Math.max(l.x0, l.x1) + 0.05, l.y + 0.45, pal.corr, 0.8);
      siteGround();
    }
    for (const wp of [L.walk.er, L.walk.main]) { let pa = L.entry; for (const q of wp) { rc(Math.min(pa[0], q[0]) - 0.42, Math.min(pa[1], q[1]) - 0.42, Math.max(pa[0], q[0]) + 0.42, Math.max(pa[1], q[1]) + 0.42, pal.corr, 0.7); pa = q; } }
    ctx.save(); ctx.strokeStyle = pal.grid; ctx.lineWidth = 1; ctx.globalAlpha = 0.7; ctx.beginPath(); for (let y = -L.world.D + 0.7; y < f0 - wk; y += 0.6) { const a = P(L.avenue.x0, y); const b = P(L.avenue.x1, y); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); } ctx.stroke(); ctx.restore();
    // car parks (the one beside the emergency building has the ambulance bay with red hatching)
    L.lots.forEach((lot) => {
      rc(lot.x0, lot.y0, lot.x1, lot.y1, pal.lot); poly(rectPts(lot.x0, lot.y0, lot.x1, lot.y1), null, pal.lotLine, 1);
      ctx.save(); ctx.strokeStyle = pal.lotLine; ctx.lineWidth = Math.max(1, tw * 0.016); ctx.beginPath(); for (const ry of lot.rows) for (let b = 0; b <= lot.nb; b++) { const x = lot.bx + b * lot.bw; const a = P(x, ry); const c = P(x, ry + 1.05); ctx.moveTo(a[0], a[1]); ctx.lineTo(c[0], c[1]); } ctx.stroke(); ctx.restore();
    });
    { const lot = L.lots.find((q) => q.ems); const bx0 = lot.bx; const bx1 = lot.bx + 2 * lot.bw; const r0 = lot.rows[0]; rc(bx0, r0, bx1, r0 + 1.05, '#dc2626', 0.26); ctx.save(); ctx.strokeStyle = '#dc2626'; ctx.globalAlpha = 0.6; ctx.lineWidth = Math.max(1, tw * 0.02); ctx.beginPath(); for (let k = 0; k < 7; k++) { const xa = bx0 + (k / 6) * (bx1 - bx0); const a = P(xa, r0); const c = P(Math.min(bx1, xa + 0.5), r0 + 1.05); ctx.moveTo(a[0], a[1]); ctx.lineTo(c[0], c[1]); } ctx.stroke(); ctx.restore(); }
    // sidewalks + kerbs, then the two public roads as one L-shaped asphalt area
    rc(0, f0 - wk, e0, f0, pal.curb); rc(e0 - wk, Y0, e0, f0 - wk, pal.curb); line(0, f0, GX, f0, pal.kerb, 0.03); line(e0, Y0, e0, f0, pal.kerb, 0.03);
    rc(0, f0, GX, GY, pal.road); rc(e0, Y0, GX, f0, pal.road); rc(camp.x1 - 0.1, L.rear.y[0], e0, L.rear.y[1], pal.road);   // …and the dropped kerb of the side exit
    ctx.save(); ctx.globalAlpha = 0.5; ctx.fillStyle = pal.roadWear; for (const lane of [f0 + R * 0.27, f0 + R * 0.73]) { const a = P(0, lane - 0.17); const b = P(e0, lane - 0.17); const c = P(e0, lane + 0.17); const d = P(0, lane + 0.17); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(d[0], d[1]); ctx.fill(); } ctx.restore();   // darker wheel tracks
    line(0, f0 + 0.1, e0 - 0.02, f0 + 0.1, pal.roadLine, 0.022); line(0, GY - 0.1, GX, GY - 0.1, pal.roadLine, 0.022); line(e0 + 0.1, Y0, e0 + 0.1, f0 - 0.02, pal.roadLine, 0.022); line(GX - 0.1, Y0, GX - 0.1, f0, pal.roadLine, 0.022);
    line(0, f0 + R / 2, e0 - 0.5, f0 + R / 2, pal.roadLine, 0.026, true); line(e0 + R / 2, Y0, e0 + R / 2, f0 - 0.5, pal.roadLine, 0.026, true);
    for (let y = f0 + 0.2; y < GY - 0.25; y += 0.32) rc(gx - 1.0, y, gx + 1.0, y + 0.17, pal.zebra);   // zebra crossing at the main entrance
    { const yc = Math.min(f0 - 1.2, shelterY(f0) + 1.7); for (let x = e0 + 0.2; x < GX - 0.25; x += 0.32) rc(x, yc - 0.55, x + 0.17, yc + 0.55, pal.zebra); }   // zebra crossing on the right-hand road
    line(e0 + R * 0.5 + 0.08, f0 - 0.3, GX - 0.14, f0 - 0.3, pal.zebra, 0.035);   // stop line
    poly(rectPts(0, Y0, GX, GY), null, pal.brand, 2);
  }
  /** Moving cars + parked cars + street furniture, pushed into the depth-sorted list. */
  function campusItems(items, now, emsLive) {
    const L = HL; if (CMPfor !== L) { CMP = buildCampus(L); CMPfor = L; } const C = CMP; const T = reduced ? 3.2 : now / 1000;
    const drive = (c, flash) => { const s = (((c.off + T * c.sp) % c.pa.len) + c.pa.len) % c.pa.len; const q = pathAt(c.pa, s); const fd = Math.min(1, Math.min(s, c.pa.len - s) / 1.4); items.push({ d: q.x + q.y + 0.05, f: () => { ctx.globalAlpha = fd; vehicle(q.x, q.y, q.ang, c.v, now, flash); ctx.globalAlpha = 1; } }); };
    C.cars.forEach((c) => drive(c, false)); if (emsLive) drive(C.ems, true);
    C.parked.forEach((c) => items.push({ d: c.x + c.y + 0.05, f: () => vehicle(c.x, c.y, c.ang, c.v, now) }));
    { const lot = L.lots.find((q) => q.ems); const bx = lot.bx + lot.bw; items.push({ d: bx + lot.rows[0] + 0.6, f: () => vehicle(bx, lot.rows[0] + 0.55, Math.PI / 2, { kind: 'ems' }, now, emsLive) }); }
    C.lamps.forEach((q) => items.push({ d: q.x + q.y + 0.02, f: () => lamp(q.x, q.y) })); C.trees.forEach((q) => items.push({ d: q.x + q.y, f: () => tree(q.x, q.y) }));
    { const s = C.shelter; items.push({ d: s.x + s.y + 0.4, f: () => { for (const dy of [-0.55, 0.55]) prism([[s.x - 0.04, s.y + dy - 0.04], [s.x + 0.04, s.y + dy - 0.04], [s.x + 0.04, s.y + dy + 0.04], [s.x - 0.04, s.y + dy + 0.04]], 0, 0.95, '#64748b'); prism([[s.x - 0.26, s.y - 0.7], [s.x + 0.26, s.y - 0.7], [s.x + 0.26, s.y + 0.7], [s.x - 0.26, s.y + 0.7]], 0.95, 1.01, '#0f766e'); prism([[s.x - 0.1, s.y - 0.4], [s.x, s.y - 0.4], [s.x, s.y + 0.4], [s.x - 0.1, s.y + 0.4]], 0.18, 0.26, '#94a3b8'); } }); }   // bus shelter
  }

  // ---------- hospital v3: the campus seen from outside (buildings only) · click a building → its floor plan with the departments ----------
  const Cc = (c) => hx(c, pal.wk < 1 ? 0.55 : 1);   // a hex colour dimmed for the dark theme
  /** Paint on a wall that faces the viewer (+y): fn(u) draws in world units from the board's top-left corner (x → right, y → down). */
  function wallY(x0, y, ztop, fn) { const [sx, sy] = P(x0, y, Z(ztop)); ctx.save(); ctx.translate(sx, sy); ctx.transform(1, 0.5, 0, 1, 0, 0); fn(tw / 2); ctx.restore(); }
  /** Sign board on a +y wall. lines = [[text, size (world units), y from the top, shift x]]; the text shrinks to fit the board. */
  function signY(x0, y, z0, w, hgt, bg, lines, fg = '#ffffff') {
    faceY(x0, x0 + w, y, z0, z0 + hgt, bg);
    wallY(x0, y + 0.002, z0 + hgt, (u) => {
      ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const [txt, fs, dy, ox = 0] of lines) { let f = fs * u; ctx.font = `700 ${f}px ${font}`; const mw = ctx.measureText(txt).width; const mxw = (w - 0.1 - 2 * Math.abs(ox)) * u; if (mw > mxw) { f *= mxw / mw; ctx.font = `700 ${f}px ${font}`; } ctx.fillText(txt, (w / 2 + ox) * u, dy * u); }
    });
  }
  const TREES0 = [[1.6, 3.7], [3.4, 2.2], [2.2, 0.4], [4.2, -1.4], [1.8, -3.2], [4.6, -4.6], [2.4, -5.8], [7.6, 3.4], [9.8, 3.9], [10.5, 1.6], [8.0, 0.6], [10.2, -0.8], [7.0, -1.2],
    [1.0, 9.4], [6.6, 10.9], [9.4, 10.9], [16.2, 11.2], [18.2, 11.6], [20.4, 10.4], [22.6, 11.4], [24.6, 10.6], [21.8, 9.6], [22.8, 1.8], [24.2, 0.6], [22.6, -0.8], [24.4, 2.6],
    [17.0, -15.5], [19.5, -15.6], [22.6, -14.6], [24.0, -12.8], [23.8, -15.4], [11.0, -13.0], [9.0, -12.2], [11.2, -15.2]];
  const TREES = TREES0.filter(([x, y]) => !(x > 21.9 && x < 24.3 && y > -11.6 && y < 12.0) && !(x > 14.6 && y > 10.2 && y < 12.0));
  /** The emergency (accident) building, after the photo: low tan block of 3 floors with continuous window bands, a taller block at the right-hand end, a brown canopy with a red "อุบัติเหตุ–ฉุกเฉิน / EMERGENCY" sign,
   *  red traffic barriers in front and an ambulance at the side. It stands at the LEFT of the main hospital building. */
  function erBuilding(items, now, emsLive) {
    const b = HL.bld.er; const WALL = Cc('#dfc08a'); const BAND = Cc('#c08a4b'); const GLASS = Cc('#a9c9e2'); const DGL = Cc('#7f9db8'); const ROOF = Cc('#9a4a1c'); const CREAM = Cc('#f3ead2'); const TOWER = Cc('#caa270'); const RED = '#dc2626';
    const { x0, x1, y0, y1 } = b; const cx = (x0 + x1) / 2; const cy = (y0 + y1) / 2; const W = x1 - x0; const D = y1 - y0; const FH = 0.95; const gx = b.door[0];
    items.push({ d: cx + cy, f: () => {
      box(cx, cy, W, D, FH * 3, WALL); box(cx, cy, W + 0.1, D + 0.1, 0.08, BAND, FH * 3);
      for (let f = 0; f < 3; f++) {
        const za = f * FH + 0.2; const zb = za + 0.5;
        for (let x = x0 + 0.25; x < x1 - 1.5; x += 0.55) { if (f === 0 && Math.abs(x + 0.2 - gx) < 1.3) continue; faceY(x, x + 0.4, y1 + 0.006, za, zb, GLASS); }
        faceY(x0, x1 - 1.2, y1 + 0.005, (f + 1) * FH - 0.1, (f + 1) * FH - 0.02, BAND);
      }
    } });
    items.push({ d: x1 - 0.6 + cy + 0.05, f: () => {
      box(x1 - 0.6, cy, 1.2, D, 3.9, TOWER); box(x1 - 0.6, cy, 1.3, D + 0.1, 0.07, BAND, 3.9);
      for (let f = 0; f < 4; f++) { const za = f * 0.95 + 0.25; for (const x of [x1 - 1.05, x1 - 0.75, x1 - 0.45]) faceY(x, x + 0.22, y1 + 0.006, za, za + 0.5, DGL); for (let y = y0 + 0.3; y < y1 - 0.3; y += 0.62) faceX(x1 + 0.006, y, y + 0.4, za, za + 0.5, DGL); }
    } });
    items.push({ d: gx + y1 + 0.6, f: () => {
      faceY(gx - 0.45, gx + 0.45, y1 + 0.012, 0, 0.8, '#475569'); faceY(gx - 0.4, gx - 0.03, y1 + 0.013, 0.04, 0.74, GLASS); faceY(gx + 0.03, gx + 0.4, y1 + 0.013, 0.04, 0.74, GLASS);
      signY(gx - 1.2, y1 + 0.014, 1.15, 2.4, 0.62, RED, [['อุบัติเหตุ–ฉุกเฉิน', 0.21, 0.22], ['EMERGENCY', 0.15, 0.46]]);
      for (const dx of [-1.05, 1.05]) box(gx + dx, y1 + 0.62, 0.12, 0.12, 0.95, CREAM);
      box(gx, y1 + 0.35, 2.4, 0.78, 0.1, ROOF, 0.95); box(gx, y1 + 0.35, 2.48, 0.86, 0.04, BAND, 1.05);
    } });
    const by = y1 + 0.95; for (let x = x0 + 0.3; x <= x0 + 3.9; x += 0.6) { if (Math.abs(x - gx) < 0.75) continue; items.push({ d: x + by, f: () => { box(x, by, 0.45, 0.16, 0.26, RED); box(x, by, 0.47, 0.17, 0.05, '#f8fafc', 0.12); } }); }
    items.push({ d: x1 - 0.5 + by + 0.05, f: () => vehicle(x1 - 0.5, by, -Math.PI / 2, { kind: 'ems' }, now, emsLive) });
  }
  /** Covered skywalk between the emergency building and the main building (steel columns, a glazed band). */
  function skywalk(items) {   // upper level of the two-storey central walkway
    const a = HL.avenue; const gx = HL.gate[0]; const GLASS = Cc('#a9c9e2'); const DECK = Cc('#cfd8e1'); const RAIL = Cc('#94a3b8'); const Zd = 1.65; const yA = 9.2; const yB = -14.3;
    // the open deck above the whole walkway: parapets on both sides, columns every 3 units
    for (let y = yA; y > yB + 1e-6; y -= 1.0) { const y0 = Math.max(yB, y - 1.0); const ym = (y + y0) / 2;
      items.push({ d: gx + ym + 0.3, f: () => { box(gx, ym, a.x1 - a.x0, y - y0 + 0.02, 0.1, DECK, Zd); faceX(a.x1 - 0.02, y0, y, Zd + 0.1, Zd + 0.26, RAIL); faceX(a.x0 + 0.04, y0, y, Zd + 0.1, Zd + 0.26, RAIL); } }); }
    for (const y of [8.6, 5.6, 2.6, -0.4, -3.4, -6.4, -9.4, -12.4, -14.1]) for (const x of [a.x0 - 0.1, a.x1 + 0.1]) items.push({ d: x + y + 0.35, f: () => box(x, y, 0.18, 0.18, Zd, RAIL) });
    // glazed bridges from the deck into EVERY building
    for (const l of HL.links) { const xa = Math.min(l.x0, l.x1); const xb = Math.max(l.x0, l.x1); const xm = (xa + xb) / 2;
      items.push({ d: xb + l.y + 0.5, f: () => { box(xm, l.y, xb - xa, 0.8, 0.55, Cc('#cfd8e1'), 1.7); faceY(xa + 0.05, xb - 0.05, l.y + 0.401, 1.82, 2.12, GLASS); box(xm, l.y, xb - xa + 0.1, 0.9, 0.05, RAIL, 2.25); } }); }
    // stairs down to the ground at the front end of the deck (towards the gate)
    for (let k = 0; k < 8; k++) { const y = yA + 0.14 + 0.27 * k; const ht = Zd + 0.1 - 0.2 * (k + 1); if (ht <= 0.02) break; items.push({ d: gx + 0.6 + y + 0.05, f: () => box(gx + 0.6, y, 0.9, 0.27, ht, Cc('#e2e8f0')) }); }
    // lift + stair core at the back end of the deck
    items.push({ d: gx - 14.55 + 0.6, f: () => { box(gx, -14.95, 1.7, 0.8, 2.1, Cc('#f3ead2')); box(gx, -14.95, 1.8, 0.9, 0.07, Cc('#0f766e'), 2.1); faceY(gx - 0.35, gx + 0.35, -14.55 + 0.006, 0, 1.0, GLASS); signY(gx - 0.6, -14.55 + 0.012, 1.25, 1.2, 0.4, Cc('#0f766e'), [['ลิฟต์ · บันได', 0.13, 0.2]]); } });
  }
  /** The name wall at the front gate (white wall, dark bands, ministry emblem): "โรงพยาบาลสันทราย · Sansai Hospital". */
  function signWall(items) {
    const x0 = HL.sign.x0; const w = HL.sign.w; const y = HL.sign.y; const WH = 1.05; const WALL = Cc('#efece4');
    items.push({ d: x0 + w / 2 + y - 0.5, f: () => { for (let k = 0; k < 3; k++) box(x0 + 0.5 + k * 1.3, y - 0.45, 1.15, 0.2, 1.5 + (k % 2) * 0.12, Cc('#6d4aa0')); } });   // purple roof panels of the building behind the sign
    items.push({ d: x0 + w + y + 0.05, f: () => {
      box(x0 + w / 2, y, w, 0.24, WH, WALL); box(x0 + w / 2, y, w + 0.08, 0.28, 0.05, Cc('#cfcabd'), WH);
      const fy = y + 0.122; faceY(x0, x0 + w, fy, 0, WH, WALL);
      wallY(x0, fy + 0.004, WH, (u) => {
        ctx.fillStyle = '#111827'; ctx.beginPath(); ctx.moveTo(0, 0.36 * u); ctx.lineTo(0.55 * u, 0.04 * u); ctx.lineTo(w * u, 0.04 * u); ctx.lineTo(w * u, 0.1 * u); ctx.lineTo(0.6 * u, 0.1 * u); ctx.lineTo(0, 0.43 * u); ctx.fill();   // black swoosh across the top
        ctx.beginPath(); ctx.moveTo(0, 0.9 * u); ctx.lineTo(0.42 * u, 0.74 * u); ctx.lineTo(w * u, 0.74 * u); ctx.lineTo(w * u, 0.79 * u); ctx.lineTo(0.46 * u, 0.79 * u); ctx.lineTo(0, 0.96 * u); ctx.fill();   // thin line below
        const ex = 0.95 * u; const ey = 0.47 * u; const r = 0.27 * u; ctx.fillStyle = '#14532d'; ctx.beginPath(); ctx.arc(ex, ey, r, 0, 7); ctx.fill(); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(1, 0.022 * u); ctx.beginPath(); ctx.arc(ex, ey, r * 0.88, 0, 7); ctx.stroke();
        ctx.lineWidth = Math.max(1, 0.03 * u); ctx.beginPath(); ctx.moveTo(ex, ey - r * 0.62); ctx.lineTo(ex, ey + r * 0.62); ctx.stroke(); ctx.beginPath(); ctx.moveTo(ex - r * 0.5, ey - r * 0.38); ctx.quadraticCurveTo(ex, ey - r * 0.7, ex + r * 0.5, ey - r * 0.38); ctx.stroke();   // staff + wings of the ministry emblem
        ctx.beginPath(); for (let k = 0; k <= 12; k++) { const t2 = k / 12; const px = ex + Math.sin(t2 * Math.PI * 3) * r * 0.22; const py = ey - r * 0.5 + t2 * r * 1.0; k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.stroke();   // snake
        ctx.fillStyle = '#111827'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; let f = 0.25 * u; ctx.font = `700 ${f}px ${font}`; const t1 = 'โรงพยาบาลสันทราย'; const mx = (w - 1.55) * u; const m1 = ctx.measureText(t1).width; if (m1 > mx) { f *= mx / m1; ctx.font = `700 ${f}px ${font}`; } ctx.fillText(t1, 2.55 * u, 0.38 * u);
        f = 0.2 * u; ctx.font = `700 ${f}px ${font}`; ctx.fillText('Sansai Hospital', 2.55 * u, 0.62 * u);
      });
    } });
    items.push({ d: x0 + w + y + 0.4, f: () => { box(x0 + w / 2, y + 0.38, w + 0.1, 0.34, 0.16, Cc('#b9855f')); box(x0 + w / 2, y + 0.38, w - 0.06, 0.26, 0.1, Cc('#2f8f4e'), 0.16); for (const k of [0.6, 1.9, 3.2]) box(x0 + k, y + 0.28, 0.1, 0.08, 0.06, '#fde68a', 0.1); } });   // planter with hedge + ground spotlights
  }
  // ---------- rear buildings: three tall hospital blocks behind the front tiers (after the street-view photo) ----------
  function highrise(x0, y0, x1, y1, fl, fh, wall, trim, kind) {
    const cx = (x0 + x1) / 2; const cy = (y0 + y1) / 2; const W = x1 - x0; const D = y1 - y0; const H = fl * fh; const GL = Cc('#9dbbd4'); const BAL = Cc('#ece0c4');
    box(cx, cy, W, D, H, wall); box(cx, cy, W + 0.1, D + 0.1, 0.1, trim, H); box(cx - W * 0.18, cy - D * 0.1, W * 0.42, D * 0.4, 0.34, Cc('#94a3b8'), H + 0.1); box(cx + W * 0.25, cy + D * 0.1, W * 0.2, D * 0.2, 0.22, Cc('#cbd5e1'), H + 0.1);
    for (let f = 0; f < fl; f++) {
      const za = f * fh + 0.17; const zb = za + fh * 0.5;
      for (let x = x0 + 0.2; x < x1 - 0.32; x += 0.36) { if (f === 0 && Math.abs(x + 0.12 - cx) < 0.5) continue; faceY(x, x + 0.23, y1 + 0.006, za, zb, GL); }
      for (let y = y0 + 0.2; y < y1 - 0.32; y += 0.36) faceX(x1 + 0.006, y, y + 0.23, za, zb, GL);
      if (kind === 'balcony') { faceY(x0, x1, y1 + 0.008, za + fh * 0.5, za + fh * 0.6, BAL); faceX(x1 + 0.008, y0, y1, za + fh * 0.5, za + fh * 0.6, BAL); }
      else { faceY(x0, x1, y1 + 0.008, f * fh + fh * 0.84, f * fh + fh * 0.92, trim); faceX(x1 + 0.008, y0, y1, f * fh + fh * 0.84, f * fh + fh * 0.92, trim); }
    }
    if (kind === 'bars') for (let x = x0 + 0.1; x < x1 - 0.05; x += 0.36) faceY(x + 0.24, x + 0.28, y1 + 0.009, 0.1, H - 0.1, Cc('#7a4bc4'));
    faceY(cx - 0.4, cx + 0.4, y1 + 0.01, 0, 0.55, '#475569'); faceY(cx - 0.36, cx - 0.03, y1 + 0.011, 0.04, 0.5, GL); faceY(cx + 0.03, cx + 0.36, y1 + 0.011, 0.04, 0.5, GL);
  }
  /** The two inpatient towers (ตึกผู้ป่วยใน 1 / 2) and the covered links that join each one to the central walkway. */
  function towerItems(items) {
    HL.towers.forEach((k) => items.push({ d: k.x1 + k.y1 - 0.6, f: () => highrise(k.x0, k.y0, k.x1, k.y1, k.fl, k.fh, Cc(k.wall), Cc(k.trim), k.kind) }));
  }
  /** Lower level: a covered path from the central walkway to every building (emergency, main, both inpatient towers). */
  function linkItems(items) {
    const ROOF = Cc('#0f766e'); const POST = Cc('#94a3b8');
    HL.links.forEach((l) => { const xa = Math.min(l.x0, l.x1); const xb = Math.max(l.x0, l.x1); const len = xb - xa; const ym = l.y;
      items.push({ d: xa + ym + 0.35, f: () => box(xa + 0.08, ym + 0.42, 0.12, 0.12, 1.0, POST) });
      items.push({ d: xb + ym + 0.2, f: () => { box(xa + len / 2, ym, len, 1.0, 0.07, ROOF, 1.0); box(xa + len / 2, ym, len + 0.08, 1.08, 0.03, Cc('#5eead4'), 1.07); } });
      items.push({ d: xb + ym + 0.45, f: () => box(xb - 0.08, ym + 0.42, 0.12, 0.12, 1.0, POST) });
    });
  }
  // ---------- side exit: barrier, guard booth, sign, in the east hedge beside inpatient tower 2, onto road 1001 ----------
  function wallX(ys, x, ztop, fn) { const [sx, sy] = P(x, ys, Z(ztop)); ctx.save(); ctx.translate(sx, sy); ctx.transform(1, -0.5, 0, 1, 0, 0); fn(tw / 2); ctx.restore(); }
  /** Sign board on a +x wall (reads left → right = towards −y), starting at y = ys. */
  function signX(ys, x, z0, w, hgt, bg, lines, fg = '#ffffff') {
    faceX(x, ys - w, ys, z0, z0 + hgt, bg);
    wallX(ys, x + 0.002, z0 + hgt, (u) => {
      ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const [txt, fs, dy] of lines) { let f = fs * u; ctx.font = `700 ${f}px ${font}`; const mw = ctx.measureText(txt).width; const mxw = (w - 0.1) * u; if (mw > mxw) { f *= mxw / mw; ctx.font = `700 ${f}px ${font}`; } ctx.fillText(txt, (w / 2) * u, dy * u); }
    });
  }
  function sideGate(items, now) {
    const [g0, g1] = HL.rear.y; const x = HL.rear.x; const gc = (g0 + g1) / 2;
    for (const y of [g0 - 0.12, g1 + 0.12]) items.push({ d: x + y + 0.05, f: () => box(x, y, 0.2, 0.2, 0.95, Cc('#ece8dd')) });
    items.push({ d: x + gc + 0.1, f: () => {
      const open = reduced ? 0 : Math.max(0, Math.sin(now / 4200));   // the arm lifts now and then
      const n = 6; for (let k = 0; k < n; k++) { const a = g0 + (k / n) * (g1 - g0); const b = g0 + ((k + 1) / n) * (g1 - g0); const col = k % 2 ? '#f8fafc' : '#dc2626'; if (open > 0.6) faceX(x + 0.02, g0, g0 + 0.08, 0.62 + k * 0.1, 0.7 + k * 0.1, col); else faceX(x + 0.02, a, b, 0.62, 0.7, col); }
      signX(g1 + 0.25, x + 0.03, 1.0, g1 - g0 + 0.5, 0.4, Cc('#0f766e'), [['ทางออกด้านข้าง', 0.14, 0.16], ['SIDE EXIT', 0.095, 0.31]]);
    } });
    items.push({ d: x - 0.75 + g1 + 0.5 + 0.6, f: () => { box(x - 0.75, g1 + 0.5, 0.46, 0.5, 0.62, Cc('#f3ead2')); box(x - 0.75, g1 + 0.5, 0.54, 0.58, 0.07, Cc('#0f766e'), 0.62); faceX(x - 0.75 + 0.232, g1 + 0.32, g1 + 0.68, 0.28, 0.5, Cc('#a9c9e2')); } });
  }
  // ---------- construction site behind the emergency building ----------
  const DIRT = '#c4a77c'; const CONC = '#b9bec6';
  function siteGround() {
    const S = HL.site; const dy = S.dy; const rc = (x0, y0, x1, y1, col, a = 1) => { ctx.globalAlpha = a; poly(rectPts(x0, y0, x1, y1), col); ctx.globalAlpha = 1; };
    rc(S.x0, S.y0, S.x1, S.y1, Cc(DIRT)); rc(S.x0 + 0.2, S.y0 + 0.2, 3.0, S.y0 + 1.6, Cc('#a98a5f'), 0.55); rc(3.6, -1.9 + dy, S.x1 - 0.3, -0.7 + dy, Cc('#a98a5f'), 0.45); rc(1.2, -1.5 + dy, 2.4, -0.6 + dy, Cc('#8f7450'), 0.5); rc(2.6, 1.6 + dy, 5.2, 3.3 + dy, Cc('#a98a5f'), 0.35);
    ctx.save(); ctx.strokeStyle = Cc('#8a6d45'); ctx.globalAlpha = 0.6; ctx.lineWidth = Math.max(1, tw * 0.03); ctx.setLineDash([tw * 0.2, tw * 0.1]); for (const dx of [-0.16, 0.16]) { const a = P(3.8 + dx, S.y1); const b = P(3.8 + dx, -0.4 + dy); const c = P(2.4 + dx, -1.3 + dy); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.stroke(); } ctx.restore();   // tyre tracks from the gate
    poly(rectPts(S.x0, S.y0, S.x1, S.y1), null, Cc('#d97706'), 1.4);
  }
  function mound(x, y, r, h, col) { const [sx, sy] = P(x, y); const rr = tw * r * 0.5; ctx.fillStyle = shade(col, 0.78); ctx.beginPath(); ctx.ellipse(sx, sy, rr, rr * 0.5, 0, 0, 7); ctx.fill(); ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(sx - rr, sy); ctx.quadraticCurveTo(sx - rr * 0.3, sy - Z(h) * 1.1, sx, sy - Z(h)); ctx.quadraticCurveTo(sx + rr * 0.3, sy - Z(h) * 1.1, sx + rr, sy); ctx.ellipse(sx, sy, rr, rr * 0.5, 0, 0, Math.PI); ctx.fill(); }
  function fencePanels(items) {
    const S = HL.site; const gap = [3.2, 4.4]; const SH = Cc('#e2e8f0'); const OR = Cc('#f59e0b'); const POST = Cc('#64748b');
    for (let x = S.x0; x < S.x1 - 1e-6; x += 0.6) { const m = x + 0.3; if (m > gap[0] && m < gap[1]) continue; items.push({ d: m + S.y1 + 0.04, f: () => { faceY(x, x + 0.6, S.y1 + 0.01, 0, 0.5, ((x / 0.6) | 0) % 2 ? SH : Cc('#cbd5e1')); faceY(x, x + 0.6, S.y1 + 0.012, 0.42, 0.5, OR); box(x, S.y1, 0.06, 0.06, 0.56, POST); } }); }
    for (let y = S.y0; y < S.y1 - 1e-6; y += 0.6) items.push({ d: S.x1 + y + 0.34, f: () => { faceX(S.x1 + 0.01, y, y + 0.6, 0, 0.5, ((y / 0.6) | 0) % 2 ? SH : Cc('#cbd5e1')); faceX(S.x1 + 0.012, y, y + 0.6, 0.42, 0.5, OR); box(S.x1, y, 0.06, 0.06, 0.56, POST); } });
    for (const gx of gap) items.push({ d: gx + S.y1 + 0.05, f: () => { box(gx, S.y1, 0.14, 0.14, 0.8, Cc('#facc15')); for (let k = 0; k < 4; k++) faceY(gx - 0.07, gx + 0.07, S.y1 + 0.08, k * 0.2, k * 0.2 + 0.1, '#111827'); } });
    items.push({ d: 1.6 + S.y1 + 0.2, f: () => signY(0.9, S.y1 + 0.03, 0.62, 1.6, 0.46, Cc('#f59e0b'), [['เขตก่อสร้าง', 0.17, 0.17], ['ห้ามผู้ไม่เกี่ยวข้องเข้า', 0.1, 0.34]], '#111827') });
    for (const [x, y] of [[0.9, 3.45 + S.dy], [5.8, 3.4 + S.dy]]) items.push({ d: x + y, f: () => { box(x, y, 0.1, 0.1, 0.3, '#f97316'); box(x, y, 0.04, 0.04, 0.18, '#f8fafc', 0.3); } });   // traffic cones
  }
  /** The concrete frame of the new building: columns, slabs, rebar sticking out of the top floor, a green safety net on the lower floors. */
  function buildingFrame() {
    const xs = [1.7, 2.9, 4.1]; const ys = [1.0, 1.9, 2.8]; const FH = 0.8; const CN = Cc(CONC); const CN2 = Cc('#9aa1ab'); const cx = 2.9; const cy = 1.9;
    for (let l = 0; l < 4; l++) {
      for (const y of ys) for (const x of xs) box(x, y, 0.15, 0.15, FH, CN, l * FH);
      if (l < 3) { box(cx, cy, 2.75, 2.1, 0.08, CN2, (l + 1) * FH - 0.08); faceY(1.52, 4.28, 2.951, (l + 1) * FH - 0.16, (l + 1) * FH - 0.08, CN); }
    }
    for (const y of ys) for (const x of xs) { for (const [dx, dy] of [[-0.04, -0.04], [0.04, 0.04]]) box(x + dx, y + dy, 0.025, 0.025, 0.2, '#f97316', 4 * FH); }
    ctx.globalAlpha = 0.3; faceY(1.52, 4.28, 2.96, 0, 1.55, '#22c55e'); ctx.globalAlpha = 1;
    for (let x = 1.52; x < 4.28; x += 0.3) faceY(x, x + 0.015, 2.965, 0, 1.55, 'rgba(22,101,52,.45)');
    for (const x of [2.3, 3.5]) box(x, 1.9, 0.5, 0.35, 0.04, '#d6a35a', 3 * FH + 0.02);   // timber formwork on the second slab
  }
  /** Tower crane: striped mast, a jib that slowly swings, a counter-weight, trolley, cable and a hanging load. */
  function crane(now) {
    const cx = 5.4; const cy = 1.7; const H = 5.0; const Y = '#fbbf24'; const swing = reduced ? 0.25 : 0.25 + 0.32 * Math.sin(now / 5200); const L1 = 2.6; const L2 = 0.95;
    for (let k = 0; k * 0.3 < H; k++) box(cx, cy, 0.2, 0.2, 0.3, k % 2 ? '#111827' : Y, k * 0.3);
    box(cx, cy, 0.34, 0.34, 0.28, '#f59e0b', H); box(cx - 0.3, cy - 0.05, 0.3, 0.22, 0.22, '#e5e7eb', H + 0.05);
    const T = [cx - L1 * Math.cos(swing), cy - L1 * Math.sin(swing) * 0.6 + L1 * 0.05]; const C = [cx + L2 * Math.cos(swing), cy + L2 * Math.sin(swing) * 0.6]; const top = H + 0.18;
    const A = P(cx, cy, Z(top)); const Bt = P(T[0], T[1], Z(top)); const Cp = P(C[0], C[1], Z(top)); const apex = P(cx, cy, Z(top + 0.55));
    ctx.save(); ctx.lineCap = 'round'; ctx.strokeStyle = Y; ctx.lineWidth = Math.max(2, tw * 0.05); ctx.beginPath(); ctx.moveTo(Cp[0], Cp[1]); ctx.lineTo(Bt[0], Bt[1]); ctx.stroke();
    ctx.strokeStyle = '#111827'; ctx.lineWidth = Math.max(1, tw * 0.02); ctx.beginPath(); for (let k = 1; k < 9; k++) { const u = k / 9; const x = Cp[0] + (Bt[0] - Cp[0]) * u; const y = Cp[1] + (Bt[1] - Cp[1]) * u; ctx.moveTo(x, y); ctx.lineTo(x + tw * 0.03, y - tw * 0.07 * (k % 2 ? 1 : 0.4)); } ctx.stroke();
    ctx.strokeStyle = '#64748b'; ctx.lineWidth = Math.max(1, tw * 0.014); ctx.beginPath(); ctx.moveTo(apex[0], apex[1]); ctx.lineTo(Bt[0], Bt[1]); ctx.moveTo(apex[0], apex[1]); ctx.lineTo(Cp[0], Cp[1]); ctx.stroke(); ctx.restore();
    box(C[0], C[1], 0.36, 0.26, 0.3, '#475569', top - 0.3);   // counter-weight
    const u = reduced ? 0.6 : 0.62 + 0.18 * Math.sin(now / 3100 + 1); const hx2 = cx + (T[0] - cx) * u; const hy2 = cy + (T[1] - cy) * u; const drop = reduced ? 1.9 : 1.55 + 0.45 * (0.5 + 0.5 * Math.sin(now / 2300));
    const j = P(hx2, hy2, Z(top)); const hk = P(hx2, hy2, Z(drop + 0.35)); ctx.save(); ctx.strokeStyle = '#334155'; ctx.lineWidth = Math.max(1, tw * 0.012); ctx.beginPath(); ctx.moveTo(j[0], j[1]); ctx.lineTo(hk[0], hk[1]); ctx.stroke(); ctx.restore();
    box(hx2, hy2, 0.12, 0.12, 0.08, '#dc2626', drop + 0.3); box(hx2, hy2, 0.34, 0.2, 0.22, '#9ca3af', drop);   // hook + a load of concrete blocks
  }
  function digger(now) {
    const x = 1.5; const y = 3.0; const sw = reduced ? 0 : Math.sin(now / 1500);
    box(x, y, 0.95, 0.5, 0.16, '#1f2937'); box(x, y, 0.6, 0.46, 0.2, '#f59e0b', 0.16); box(x + 0.12, y, 0.3, 0.3, 0.2, '#fbbf24', 0.36); faceY(x + 0.02, x + 0.22, y + 0.152, 0.38, 0.52, '#a9c9e2');
    const a = P(x + 0.28, y, Z(0.5)); const b = P(x + 0.28, y - 0.55 - 0.1 * sw, Z(0.95)); const c = P(x + 0.28, y - 0.95, Z(0.2 + 0.22 * (0.5 + 0.5 * sw)));
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = Math.max(2, tw * 0.05); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.stroke(); ctx.fillStyle = '#374151'; ctx.beginPath(); ctx.arc(c[0], c[1], Math.max(2, tw * 0.05), 0, 7); ctx.fill(); ctx.restore();
  }
  function tipper(x, y) {
    box(x, y, 0.5, 0.46, 0.2, '#111827'); box(x, y, 0.42, 0.4, 0.26, '#f97316', 0.12); box(x + 0.45, y, 0.55, 0.44, 0.34, '#facc15', 0.14);
    faceY(x + 0.36, x + 0.62, y + 0.221, 0.34, 0.46, '#a9c9e2'); for (const dx of [-0.2, 0.2, 0.55]) for (const dy of [-0.22, 0.22]) box(x + dx, y + dy, 0.14, 0.05, 0.14, '#0f172a');
  }
  function siteProps(items0, now) {
    const SY = -4 + HL.site.dy; const items = []; const done = () => items.forEach((it) => items0.push({ d: it.d + SY, f: () => placed(1, [0, 0], [0, SY], it.f) }));
    items.push({ d: 2.9 + 1.9 + 0.8, f: buildingFrame }); items.push({ d: 5.4 + 1.7 + 0.5, f: () => crane(now) }); items.push({ d: 1.5 + 3.0 + 0.3, f: () => digger(now) });
    items.push({ d: 3.9 + 3.2 + 0.5, f: () => tipper(3.7, 3.2) });
    items.push({ d: 5.0 + 1.0 + 0.3, f: () => { mound(5.0, 1.0, 0.9, 0.38, Cc('#b08d5c')); mound(5.5, 1.35, 0.55, 0.26, Cc('#c9a56f')); } });
    items.push({ d: 4.9 + 2.9 + 0.3, f: () => { for (let k = 0; k < 3; k++) box(4.9, 2.9 + k * 0.0, 0.8, 0.28, 0.1, '#cbd5e1', k * 0.1); for (let k = 0; k < 4; k++) box(5.5, 2.5 + k * 0.12, 0.5, 0.08, 0.08, '#94a3b8'); box(0.95, 1.7, 0.4, 0.8, 0.28, '#b45309'); box(0.95, 1.7, 0.4, 0.8, 0.04, '#d97706', 0.28); } });
    items.push({ d: 0.9 + 2.3, f: () => { box(1.0, 2.4, 0.5, 0.5, 0.5, '#0ea5e9'); box(1.0, 2.4, 0.32, 0.32, 0.04, '#f8fafc', 0.5); } });   // site cabin
    done();
  }
  // ---------- simulated life: doctors, nurses, patients (some in wheelchairs / with a drip), visitors, children and site workers walking the footpaths — atmosphere only, not data ----------
  const SKINS = ['#f1c9a5', '#e0ac82', '#c68e64', '#8d5a3b'];
  const VIS_COLS = ['#f97316', '#6366f1', '#ec4899', '#84cc16', '#0ea5e9', '#a855f7', '#f59e0b', '#ef4444'];
  function ambFig(x, y, kind, now, seed, sc = 0.95, zl = 0) {
    const [sx, sy] = P(x, y, zl ? Z(zl) : 0); const s = tw * 0.075 * sc * (kind === 'kid' ? 0.72 : 1); const bob = reduced || kind === 'wheel' || kind === 'stand' ? 0 : Math.abs(Math.sin(now / 170 + seed * 3)) * s * 0.16; const by = sy - bob; const skin = SKINS[seed % SKINS.length];
    ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.beginPath(); ctx.ellipse(sx, sy, s * 1.2, s * 0.55, 0, 0, 7); ctx.fill();
    const body = (col, ol) => { ctx.fillStyle = col; ctx.beginPath(); ctx.roundRect(sx - s * 0.85, by - s * 3.3, s * 1.7, s * 3.3, s * 0.7); ctx.fill(); if (ol) { ctx.strokeStyle = ol; ctx.lineWidth = Math.max(1, s * 0.16); ctx.stroke(); } };
    const head = (hy) => { ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(sx, hy, s * 0.85, 0, 7); ctx.fill(); };
    const hair = (hy) => { ctx.fillStyle = '#1f2937'; ctx.beginPath(); ctx.arc(sx, hy - s * 0.04, s * 0.88, Math.PI * 1.02, Math.PI * 1.98); ctx.fill(); };
    if (kind === 'wheel') {
      ctx.strokeStyle = '#1f2937'; ctx.lineWidth = Math.max(1.4, s * 0.24); ctx.beginPath(); ctx.arc(sx - s * 0.55, sy - s * 0.95, s * 0.95, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.arc(sx + s * 0.85, sy - s * 0.4, s * 0.45, 0, 7); ctx.stroke();
      ctx.fillStyle = '#475569'; ctx.fillRect(sx - s * 0.95, sy - s * 1.35, s * 1.8, s * 0.32);
      ctx.fillStyle = '#bae6fd'; ctx.beginPath(); ctx.roundRect(sx - s * 0.7, by - s * 2.95, s * 1.4, s * 1.9, s * 0.5); ctx.fill(); ctx.fillStyle = '#93c5fd'; ctx.fillRect(sx - s * 0.75, by - s * 1.55, s * 1.5, s * 0.5);
      head(by - s * 3.55); hair(by - s * 3.55); return;
    }
    if (kind === 'patient' && seed % 2 === 0) {   // drip stand
      ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = Math.max(1, s * 0.14); ctx.beginPath(); ctx.moveTo(sx + s * 1.5, sy); ctx.lineTo(sx + s * 1.5, by - s * 5); ctx.moveTo(sx + s * 1.1, by - s * 5); ctx.lineTo(sx + s * 1.9, by - s * 5); ctx.stroke();
      ctx.fillStyle = '#e0f2fe'; ctx.beginPath(); ctx.roundRect(sx + s * 1.25, by - s * 4.8, s * 0.5, s * 0.9, s * 0.2); ctx.fill(); ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = Math.max(1, s * 0.1); ctx.stroke();
    }
    if (kind === 'doctor') { body('#f8fafc', '#cbd5e1'); ctx.strokeStyle = '#334155'; ctx.lineWidth = Math.max(1, s * 0.15); ctx.beginPath(); ctx.arc(sx, by - s * 2.6, s * 0.5, 0.1, Math.PI - 0.1); ctx.stroke(); }
    else if (kind === 'nurse') body('#14b8a6', '#0f766e');
    else if (kind === 'patient') { body('#bfdbfe', '#93c5fd'); ctx.fillStyle = '#93c5fd'; ctx.fillRect(sx - s * 0.85, by - s * 1.6, s * 1.7, s * 0.28); }
    else if (kind === 'worker') { body('#6b7280'); ctx.fillStyle = '#f97316'; ctx.beginPath(); ctx.roundRect(sx - s * 0.85, by - s * 3.3, s * 1.7, s * 2.2, s * 0.6); ctx.fill(); ctx.fillStyle = '#e5e7eb'; ctx.fillRect(sx - s * 0.85, by - s * 2.3, s * 1.7, s * 0.2); }
    else body(VIS_COLS[seed % VIS_COLS.length]);
    head(by - s * 4); if (kind === 'worker') { ctx.fillStyle = '#facc15'; ctx.beginPath(); ctx.arc(sx, by - s * 4.05, s * 0.95, Math.PI, 0); ctx.fill(); ctx.fillRect(sx - s * 1.1, by - s * 4.05, s * 2.2, s * 0.18); }
    else if (kind === 'nurse') { hair(by - s * 4); ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.roundRect(sx - s * 0.6, by - s * 4.95, s * 1.2, s * 0.5, s * 0.15); ctx.fill(); }
    else hair(by - s * 4);
    if (kind === 'visitor' && seed % 3 === 0) { ctx.fillStyle = '#7c3aed'; ctx.beginPath(); ctx.roundRect(sx + s * 0.9, by - s * 1.9, s * 0.8, s * 0.9, s * 0.2); ctx.fill(); }
  }
  let AMB = null; let AMBfor = null;
  function buildAmbient(L) {
    const P0 = L.paths; if (!P0) return { walkers: [], stand: [] }; const pa = {}; for (const k of Object.keys(P0)) pa[k] = roundPath(P0[k], 0.25);
    const W = []; const add = (path, kinds, base = 0) => kinds.forEach((kind, i) => { const q = pa[path]; W.push({ q, z: path === 'deck' ? 1.75 : 0, kind, seed: W.length * 7 + i + base, off: (i + 0.35) * (q.len / kinds.length) * 2 * (0.6 + 0.4 * hash01(W.length + i)), sp: (kind === 'wheel' ? 0.34 : kind === 'worker' ? 0.42 : kind === 'kid' ? 0.62 : 0.5) + 0.16 * hash01(W.length * 3 + i) }); });
    add('front', ['visitor', 'patient', 'visitor', 'kid', 'nurse']); add('ave', ['doctor', 'visitor', 'wheel', 'visitor', 'nurse', 'patient']); add('toEr', ['wheel', 'patient', 'nurse', 'visitor', 'doctor']);
    add('link', ['nurse', 'doctor', 'wheel']); add('lotW', ['visitor', 'visitor']);
    add('spine', ['doctor', 'visitor', 'nurse', 'wheel']); add('deck', ['visitor', 'doctor', 'nurse', 'wheel']); add('lotL', ['visitor', 'nurse']); add('lot', ['visitor', 'nurse', 'visitor']); add('s5', ['worker']);
    add('s1', ['worker', 'worker']); add('s2', ['worker']); add('s3', ['worker']); add('s4', ['worker', 'worker']);
    const dy = L.site ? L.site.dy : 0; const stand = [[6.0, 8.5, 'nurse', 1], [6.4, 8.62, 'patient', 2], [9.8, 8.5, 'visitor', 3], [17.0, 9.45, 'visitor', 4], [17.7, 9.5, 'doctor', 5], [16.5, 9.4, 'wheel', 6], [9.2, 2.4, 'kid', 7], [9.55, 2.55, 'visitor', 8], [3.2, 3.6 + dy, 'worker', 9], [4.0, 3.55 + dy, 'worker', 10], [18.4, 12.85, 'visitor', 11], [19.0, 12.9, 'kid', 12], [12.4, 4.0, 'visitor', 13], [14.4, 3.9, 'nurse', 14], [20.5, -1.4, 'doctor', 15], [17.8, -1.3, 'visitor', 16], [21.2, 0.8, 'wheel', 17]];
    return { walkers: W, stand };
  }
  function ambientItems(items, now) {
    const L = HL; if (AMBfor !== L) { AMB = buildAmbient(L); AMBfor = L; } const T = reduced ? 4 : now / 1000;
    for (const w of AMB.walkers) { const len = w.q.len; const u = (((w.off + T * w.sp) % (2 * len)) + 2 * len) % (2 * len); const s = u < len ? u : 2 * len - u; const q = pathAt(w.q, s); items.push({ d: q.x + q.y + (w.z ? 1.4 : 0.01), f: () => ambFig(q.x, q.y, w.kind, now, w.seed, w.kind === 'worker' ? 0.9 : 0.95, w.z) }); }
    for (const [x, y, kind, seed] of AMB.stand) items.push({ d: x + y + 0.01, f: () => ambFig(x, y, kind === 'wheel' ? 'wheel' : kind, now, seed, 0.95) });
  }
  function campusScene(items, labels, F, now, kit) {
    const L = HL; const f0 = L.road.front[0]; const e0 = L.road.east[0]; const gx = L.gate[0]; campusGround();
    const emsLive = sites.some((s, i) => themes[i] === 'ems' && stateOf(s) === 'ok' && s.realtime > 0); const kz = Math.pow(cam.z, -0.6); const hh = Math.max(16, tw * 0.27 * kz);
    HOSP_BLDS.forEach((bd) => {   // a tinted pad under each building = the clickable zone · a pulsing mark at its door
      const b = L.bld[bd.id]; const hov = hoverB === bd.id; const ids = BL.map((x, i) => (x === bd.id ? i : -1)).filter((i) => i >= 0); const pad = rectPts(b.x0 - 0.18, b.y0 - 0.18, b.x1 + 0.18, b.y1 + 0.18);
      ctx.globalAlpha = hov ? 0.32 : 0.15; poly(pad, bd.col); ctx.globalAlpha = 1; poly(pad, null, hov ? pal.ink : bd.col, hov ? 2.6 : 1.4);
      const [dx, dy] = P(b.door[0], b.door[1] + 0.4); ctx.globalAlpha = reduced ? 0.5 : 0.35 + 0.25 * Math.sin(now / 400); ctx.fillStyle = bd.col; ctx.beginPath(); ctx.ellipse(dx, dy, tw * 0.3, tw * 0.15, 0, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
      bhits.push({ id: bd.id, d: b.c[0] + b.c[1], ...bbox([...rectPts(b.x0, b.y0, b.x1, b.y1), P(b.x0, b.y0, Z(b.h)), P(b.x1, b.y0, Z(b.h))]) });
      if (bd.id === 'main') for (const k of L.towers) { const th = k.fl * k.fh + 0.5; bhits.push({ id: 'main', d: k.x0 + k.y0, ...bbox([...rectPts(k.x0, k.y0, k.x1, k.y1), P(k.x0, k.y0, Z(th)), P(k.x1, k.y0, Z(th))]) }); }
      const inside = ids.reduce((a, i) => a + F.at[i].length, 0); const cum = ids.reduce((a, i) => a + F.cum[i] * pfNow(), 0); const [lx, ly] = P(b.door[0], b.door[1] + 0.4, 0);
      labels.push({ x: lx, y: ly + tw * 0.34, text: `${bd.icon} ${bd.name} · ${ids.length ? `${ids.length} ระบบ` : 'ยังไม่มีระบบ'}`, col: bd.col, sc: 1 });
      labels.push({ x: lx, y: ly + tw * 0.34 + hh + 3, text: ids.length ? `ในอาคาร ${fmt(inside)} คน · เปิดหน้า ${dayOn() && R.rep.scale === 1 ? '' : '≈'}${fmt(cum)} · คลิกเพื่อเข้า` : 'คลิกเพื่อเข้าไปดู', col: hov ? bd.col : null, sc: 0.8 });
    });
    { const [dx, dy] = P(gx, f0 - 0.35, 0); labels.push({ x: dx, y: dy, text: 'ทางเข้าหลัก', col: pal.brand, sc: 0.8 }); }
    { const [rx, ry] = P(3.4, f0 + L.road.w * 0.5, 0); labels.push({ x: rx, y: ry, text: 'ทางหลวง 1260', col: null, sc: 0.6 }); const [ex, ey] = P(e0 + L.road.w * 0.5, 6.5, 0); labels.push({ x: ex, y: ey, text: 'ทางหลวง 1001', col: null, sc: 0.6 }); }
    L.lots.forEach((lot) => { const [px2, py2] = P((lot.x0 + lot.x1) / 2, lot.y1 - 0.5, 0); labels.push({ x: px2, y: py2, text: lot.name || '🅿 ที่จอดรถ', col: null, sc: 0.6 }); });
    erBuilding(items, now, emsLive); hospBuilding(items); skywalk(items); signWall(items);
    towerItems(items); linkItems(items); sideGate(items, now); fencePanels(items); siteProps(items, now); ambientItems(items, now);
    { const [fx, fy] = P(3.0, -2.1 + L.site.dy, Z(3.7)); labels.push({ x: fx, y: fy, text: '🚧 กำลังก่อสร้างอาคารใหม่', col: '#d97706', sc: 0.85 }); }
    for (const k of L.towers) { const [tx, ty] = P((k.x0 + k.x1) / 2, k.y1, Z(k.fl * k.fh + 0.2)); labels.push({ x: tx, y: ty - tw * 0.1, text: '🛏 ' + k.name, col: '#9a6b2f', sc: 0.85 }); }
    { const [sx, sy] = P(L.rear.x - 0.9, L.rear.y[0] - 0.2, Z(1.5)); labels.push({ x: sx, y: sy - tw * 0.1, text: '🚪 ทางออกด้านข้าง', col: '#0f766e', sc: 0.7 }); const [wx, wy] = P(gx, -6.0, 0); labels.push({ x: wx, y: wy, text: 'ทางเชื่อมกลาง 2 ชั้น (บน · ล่าง)', col: pal.brand, sc: 0.7 }); }
    TREES.forEach(([x, y]) => items.push({ d: x + y, f: () => tree(x, y) }));
    campusItems(items, now, emsLive);
  }
  /** Inside one building (cut-away floor plan): lobby with a name board and reception at the back, the departments (one room = one system) on both sides of the avenue, the entrance at the front. */
  function interiorScene(items, labels, F, now, kit) {
    const L = HL; const sh = L.shell; const B = BLD(L.bldId); const er = L.bldId === 'er'; const [yb0, yb1] = L.rows.back; const [yf0, yf1] = L.rows.front; const av = L.avenue; const gx = L.entry[0]; const GLASS = Cc('#a9c9e2');
    const rc = (x0, y0, x1, y1, col, a = 1) => { ctx.globalAlpha = a; poly(rectPts(x0, y0, x1, y1), col); ctx.globalAlpha = 1; };
    const mx = Math.max(1, ...sites.map((s) => s.pv)); const topKey = sm.top && sm.top.pv > 0 ? sm.top.key : '';
    rc(sh.x0, sh.y0, sh.x1, sh.y1, pal.corr);
    ctx.save(); ctx.strokeStyle = pal.grid; ctx.lineWidth = 1; ctx.globalAlpha = 0.55; ctx.beginPath();
    for (let x = sh.x0 + 0.8; x < sh.x1; x += 0.8) { const a = P(x, sh.y0); const c = P(x, sh.y1); ctx.moveTo(a[0], a[1]); ctx.lineTo(c[0], c[1]); } for (let y = sh.y0 + 0.8; y < sh.y1; y += 0.8) { const a = P(sh.x0, y); const c = P(sh.x1, y); ctx.moveTo(a[0], a[1]); ctx.lineTo(c[0], c[1]); } ctx.stroke(); ctx.restore();
    rc(sh.x0, sh.y0, sh.x1, L.lobby.y1, B.col, 0.08); rc(sh.x0 + 0.05, yb1, sh.x1 - 0.05, yf0, pal.walk, 0.85); rc(av.x0, L.lobby.y1, av.x1, sh.y1, B.col, 0.1);
    if (!er) HOSP_GROUPS.forEach((g, gi) => { const wg = L.wings[gi]; if (wg && wg.count) rc(wg.x0 - 0.12, yb0 - 0.08, wg.x1 + 0.12, yf1 + 0.08, g.col, 0.1); });
    ctx.save(); ctx.strokeStyle = B.col; ctx.globalAlpha = 0.6; ctx.lineWidth = Math.max(1.5, tw * 0.022); ctx.lineCap = 'round'; ctx.setLineDash([tw * 0.07, tw * 0.09]); ctx.lineDashOffset = reduced ? 0 : (now / 55) * (tw / 60);
    { const a = P(gx, sh.y1 - 0.2); const c = P(gx, L.lobby.y1 + 0.5); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(c[0], c[1]); ctx.stroke(); } ctx.restore();
    { const cy0 = L.lobby.y1 - 0.45; ctx.globalAlpha = reduced ? 0.55 : 0.45 + 0.15 * Math.sin(now / 600); poly(rectPts(gx - 0.45, cy0 - 0.13, gx + 0.45, cy0 + 0.13), B.col); poly(rectPts(gx - 0.13, cy0 - 0.45, gx + 0.13, cy0 + 0.45), B.col); ctx.globalAlpha = 1; }
    rc(av.x0 + 0.25, sh.y1 - 0.55, av.x1 - 0.25, sh.y1 - 0.05, B.col, 0.4); poly(rectPts(sh.x0, sh.y0, sh.x1, sh.y1), null, B.col, 2);
    if (er) {   // ambulance bay in front + stretcher beds in the empty departments
      const bay = L.bay; rc(bay.x0, bay.y0, bay.x1, bay.y1, '#dc2626', 0.18); ctx.save(); ctx.strokeStyle = '#dc2626'; ctx.globalAlpha = 0.6; ctx.lineWidth = Math.max(1, tw * 0.02); ctx.beginPath();
      for (let k = 0; k < 7; k++) { const xa = bay.x0 + (k / 6) * (bay.x1 - bay.x0); const a = P(xa, bay.y0); const c = P(Math.min(bay.x1, xa + 0.5), bay.y1); ctx.moveTo(a[0], a[1]); ctx.lineTo(c[0], c[1]); } ctx.stroke(); ctx.restore();
      const emsLive = sites.some((s, i) => themes[i] === 'ems' && stateOf(s) === 'ok' && s.realtime > 0); const bx = (bay.x0 + bay.x1) / 2; const by = (bay.y0 + bay.y1) / 2;
      items.push({ d: bx + by + 0.05, f: () => vehicle(bx, by, -Math.PI / 2, { kind: 'ems' }, now, emsLive) });
      const bed = (x, y) => { box(x, y, 0.9, 0.5, 0.14, Cc('#cbd5e1'), 0.16); box(x, y, 0.86, 0.46, 0.06, '#f8fafc', 0.3); box(x - 0.3, y, 0.22, 0.34, 0.07, '#bfdbfe', 0.36); box(x + 0.42, y, 0.05, 0.5, 0.3, '#94a3b8', 0.16); for (const [wx, wy] of [[-0.35, -0.2], [0.35, -0.2], [-0.35, 0.2], [0.35, 0.2]]) box(x + wx, y + wy, 0.07, 0.07, 0.16, '#111827'); };
      (L.free || []).forEach((q) => { rc(q.x0 + 0.1, q.y0 + 0.1, q.x1 - 0.1, q.y1 - 0.1, B.col, 0.06); poly(rectPts(q.x0 + 0.1, q.y0 + 0.1, q.x1 - 0.1, q.y1 - 0.1), null, B.col, 1); for (const dy of [-0.42, 0.42]) items.push({ d: q.c[0] + q.c[1] + dy, f: () => bed(q.c[0], q.c[1] + dy) }); });
    }
    L.rooms.forEach((r, i) => {
      if (!r) return; const s = sites[i]; const st = stateOf(s); const lit = st === 'ok'; const col = colOf(i); const hov = hover === i; const k = Math.max(0.5, Math.min(0.9, r.w / 2.2, r.d / 2.2));
      ctx.globalAlpha = 0.1 + 0.34 * (s.pv / mx); poly(rectPts(r.x0, r.y0, r.x1, r.y1), col); ctx.globalAlpha = 1; poly(rectPts(r.x0, r.y0, r.x1, r.y1), null, hov ? pal.ink : col, hov ? 2.4 : 1.2);
      if (s.key === topKey) { ctx.globalAlpha = reduced ? 1 : 0.55 + 0.45 * Math.sin(now / 300); poly(rectPts(r.x0 + 0.07, r.y0 + 0.07, r.x1 - 0.07, r.y1 - 0.07), null, '#f59e0b', 2.5); ctx.globalAlpha = 1; }
      ctx.globalAlpha = 0.9; poly(r.front ? rectPts(r.door[0] - 0.3, r.y0 - 0.02, r.door[0] + 0.3, r.y0 + 0.14) : rectPts(r.door[0] - 0.3, r.y1 - 0.14, r.door[0] + 0.3, r.y1 + 0.02), col); ctx.globalAlpha = 1;
      items.push({ d: r.c[0] + r.c[1] + 0.02, f: () => { ctx.globalAlpha = st === 'paused' || st === 'idle' ? 0.6 : 1; scaled(k, r.px, r.c[1], () => prop(themes[i], r.px, r.c[1], col, lit && (s.realtime > 0 || s.key === topKey), st, now, i)); ctx.globalAlpha = 1; dotAt(r.px, r.c[1], 0.9 * k + 0.6, STATE_COL[st], lit || st === 'silent', now, i); } });
      hits.push({ i, d: r.c[0] + r.c[1], ...bbox([...rectPts(r.x0, r.y0, r.x1, r.y1), P(r.x0, r.y0, Z(1.1)), P(r.x1, r.y0, Z(1.1))]) });
      const [lx, ly] = r.front ? P(r.c[0], r.y1, 0) : P(r.c[0], r.y0, Z(1.25)); const cnt = st === 'ok' ? `${dayOn() && R.rep.scale === 1 ? '' : '≈'}${fmt(F.cum[i] * pfNow())}` : STATE_TXT[st];
      labels.push({ x: lx, y: r.front ? ly + tw * 0.2 : ly - tw * 0.2, text: `${THEMES[themes[i]].icon} ${short(s.name, 12)} · ${cnt}`, col: !lit ? STATE_COL[st] : busyAt(i, F) ? col : null, sc: 0.9 });
    });
    if (!er) HOSP_GROUPS.forEach((g, gi) => { const wg = L.wings[gi]; if (!wg || !wg.count) return; const [bx, by] = P((wg.x0 + wg.x1) / 2, L.sy, 0); labels.push({ x: bx, y: by, text: `${g.icon} ปีก${g.name} · ${wg.count} ระบบ`, col: g.col, sc: 1.05 }); });   // wing names stand on the walking street between the two rows — the only band with no room label
    if (!L.count) { const [bx, by] = P(gx, (yb0 + yf1) / 2, 0); labels.push({ x: bx, y: by, text: 'ยังไม่มีระบบในอาคารนี้', col: B.col, sc: 1 }); }
    // lobby: name board on the back wall + reception desk + windows on the two tall walls
    const sw = er ? 3.2 : 3.8; items.push({ d: gx + sw / 2 + sh.y0 + 0.02, f: () => (er
      ? signY(gx - sw / 2, sh.y0 + 0.05, 0.95, sw, 0.62, '#dc2626', [['อุบัติเหตุ–ฉุกเฉิน', 0.26, 0.24], ['EMERGENCY ROOM', 0.15, 0.49]])
      : signY(gx - sw / 2, sh.y0 + 0.05, 0.95, sw, 0.66, Cc('#0f766e'), [['โรงพยาบาลสันทราย', 0.26, 0.24], ['กลุ่มงานพัฒนาคุณภาพและระบบบริการ', 0.14, 0.51]])) });
    items.push({ d: gx + sh.y0 + 1.1, f: () => { box(gx, sh.y0 + 1.05, 2.2, 0.55, 0.5, Cc(er ? '#fecaca' : '#f3ead2')); box(gx, sh.y0 + 1.05, 2.3, 0.65, 0.06, B.col, 0.5); box(gx - 0.5, sh.y0 + 1.02, 0.3, 0.05, 0.24, '#334155', 0.56); box(gx + 0.45, sh.y0 + 1.1, 0.2, 0.14, 0.02, '#fde047', 0.56); } });
    for (let x = sh.x0 + 0.9; x < sh.x1 - 0.8; x += 1.1) { if (Math.abs(x + 0.35 - gx) < sw / 2 + 0.2) continue; items.push({ d: x + 0.7 + sh.y0 + 0.05, f: () => faceY(x, x + 0.7, sh.y0 + 0.045, 0.75, 1.35, GLASS) }); }
    for (let y = sh.y0 + 1.0; y < sh.y1 - 1.0; y += 1.2) items.push({ d: sh.x0 + y + 0.75, f: () => faceX(sh.x0 + 0.045, y, y + 0.7, 0.75, 1.35, GLASS) });
    for (const [px, py] of [[sh.x0 + 0.55, sh.y1 - 0.6], [sh.x1 - 0.55, sh.y1 - 0.6], [sh.x0 + 0.55, sh.y0 + 0.7]]) items.push({ d: px + py, f: () => { box(px, py, 0.2, 0.2, 0.2, '#92400e'); disc(px, py, 0.34, tw * 0.1, '#16a34a'); disc(px, py, 0.45, tw * 0.06, '#22c55e'); } });
    // entrance: door frame in the low front wall + "click to leave"
    items.push({ d: av.x0 + sh.y1 + 0.01, f: () => box(av.x0 + 0.05, sh.y1, 0.14, 0.14, 1.15, B.col) });
    items.push({ d: av.x1 + sh.y1 + 0.01, f: () => { box(av.x1 - 0.05, sh.y1, 0.14, 0.14, 1.15, B.col); box(gx, sh.y1, av.x1 - av.x0, 0.14, 0.08, B.col, 1.15); } });
    xhit = bbox([P(av.x0, sh.y1 - 0.7), P(av.x1, sh.y1 - 0.7), P(av.x1, sh.y1 + 0.25), P(av.x0, sh.y1 + 0.25), P(av.x0, sh.y1, Z(1.2)), P(av.x1, sh.y1, Z(1.2))]);
    { const [ex, ey] = P(gx, sh.y1 + 0.25, 0); labels.push({ x: ex, y: ey + tw * 0.2, text: '🚪 ทางออกอาคาร · คลิกหรือกด Esc เพื่อออก', col: B.col, sc: 0.85 }); }
  }

  function drawPlan(now) {
    const F = planState(t); const items = []; const labels = []; hits = []; whits = []; bhits = []; xhit = null;
    const kit = { ctx, P, Z, get tw() { return tw; }, pal, reduced, box, faceX, faceY, disc, poly, shade };
    hospitalBase(now); if (!hospOn()) { gatePad('in', now); gatePad('out', now); }
    if (deptOn()) deptScene(items, labels, F, now, kit); else if (hospOut()) campusScene(items, labels, F, now, kit); else if (hospIn()) interiorScene(items, labels, F, now, kit);
    if (!hospOn()) items.push(...gateItems('in', now), ...gateItems('out', now)); for (const q of PW) items.push({ d: q.d + 0.001, f: () => wallDraw(q) });
    const psc = deptOn() ? 0.82 : 0.95; let here = 0; let entered = 0; let enteredBack = 0; let left = 0;
    for (const j of jr) {
      if (t >= j.enter) { entered += 1; if (j.back) enteredBack += 1; } if (t >= j.exit) left += 1;
      const r = planPlace(j, t, F); if (!r) continue; here += 1; if (r.hid || (r.state !== 'walk' && r.rank >= 6)) continue;
      items.push({ d: r.pos[0] + r.pos[1] + 0.01, f: () => { ctx.globalAlpha = r.a == null ? 1 : r.a; person(r.pos[0], r.pos[1], r.state === 'room' ? r.col : r.state === 'work' ? colOf(r.zone) : WALK, !!j.back, now, psc, j.role); ctx.globalAlpha = 1; } });
    }
    items.sort((a, b) => a.d - b.d).forEach((it) => it.f());
    labels.forEach((q) => pill(q.text, q.x, q.y, q.col, q.sc));
    if (!hospOn()) { gateSign('in', `เข้าแล้ว ${fmt(entered)} คน${dayOn() ? ` · ใหม่ ${fmt(entered - enteredBack)} · เดิม ${fmt(enteredBack)}` : ''}`); gateSign('out', `ออกแล้ว ${fmt(left)} คน`); }
    hud(F, here);
  }

  // ---------- frame state: floor visitors and page journeys are drawn by the same code ----------
  const crowd = () => (ins ? ins.journeys : jr);
  const curLay = () => (ins ? ILAY : LAY);
  function frameState(tt) {
    const n = curLay().length; const work = Array.from({ length: n }, () => []); const cum = Array(n).fill(0);
    for (const j of crowd()) {
      j.stops.forEach((st, k) => { if (tt >= st.start) cum[st.zone] += 1; if (tt >= st.start && tt < st.end) work[st.zone].push({ s: st, id: j.id, key: j.id * 8 + k }); });
    }
    const rank = new Map(); work.forEach((a2) => a2.sort((x, y) => x.s.start - y.s.start || x.id - y.id).forEach((w, i) => rank.set(w.key, i)));
    return { work, cum, rank };
  }
  /** Where a visitor is at minute `tt`: walking in → at a station/room → (walking to the next room) → walking out. */
  function place(j, tt, F) {
    if (tt < j.enter || tt >= j.exit) return null;
    const L = curLay(); const st = j.stops; const door = (z) => [L[z].door[0], CORR]; const rk = (k) => F.rank.get(j.id * 8 + k) ?? 0; const q = (z) => slot(L[z], F.work[z].length);
    if (tt < st[0].start) return { pos: along([ENT, door(st[0].zone), q(st[0].zone)], (tt - j.enter) / Math.max(1, st[0].start - j.enter)), state: 'walk', zone: st[0].zone, rank: 0 };
    for (let k = 0; k < st.length; k++) {
      const s = st[k];
      if (tt < s.end) return { pos: slot(L[s.zone], rk(k)), state: 'work', zone: s.zone, rank: rk(k) };
      const nx = st[k + 1];
      if (nx && tt < nx.start) return { pos: along([slot(L[s.zone], 0), door(s.zone), door(nx.zone), q(nx.zone)], (tt - s.end) / Math.max(1, nx.start - s.end)), state: 'walk', zone: s.zone, rank: 0 };
    }
    const l = st[st.length - 1];
    return { pos: along([slot(L[l.zone], 0), door(l.zone), EXIT], (tt - l.end) / Math.max(1, j.exit - l.end)), state: 'walk', zone: l.zone, rank: 0 };
  }

  /** What to draw in each cell: stations (projects) on the floor, rooms (pages) inside a system. */
  function zones() {
    if (ins) {
      const top = ins.top;
      return ins.units.map((u) => ({ key: u.key, col: roomColor(u.kind), pv: u.pv, lit: u.pv > 0, live: u.pv > 0 && (u.realtime > 0 || u.key === top), alpha: u.pv ? 1 : 0.6, icon: kindMeta(u.kind).icon, name: u.name, top: u.key === top && u.pv > 0,
        dot: u.realtime > 0 ? STATE_COL.ok : null, dotBlink: true, dotZ: 1.55, lineCol: (F, i) => (F.work[i].length ? roomColor(u.kind) : null),
        line: (F, i) => `≈${fmt(F.cum[i] * ins.pf)} ครั้ง${u.realtime ? ` · ออนไลน์ ${fmt(u.realtime)}` : ''}`,
        prop: (g, cx, cy, col, live, now) => drawRoom(g, u.kind, cx, cy, col, live, now) }));
    }
    const topKey = sm.top && sm.top.pv > 0 ? sm.top.key : '';
    return sites.map((s, i) => { const st = stateOf(s); const lit = st === 'ok';
      return { key: s.key, col: colOf(i), pv: s.pv, lit, live: lit && (s.realtime > 0 || s.key === topKey), alpha: st === 'paused' || st === 'idle' ? 0.6 : 1, icon: THEMES[themes[i]].icon, name: s.name, top: s.key === topKey,
        dot: STATE_COL[st], dotBlink: lit || st === 'silent', dotZ: themes[i] === 'ems' || themes[i] === 'visit' ? 1.35 : 1.7,
        lineCol: (F) => (st === 'ok' ? (F.work[i].length ? colOf(i) : null) : STATE_COL[st]), line: (F) => (st === 'ok' ? `${dayOn() && R.rep.scale === 1 ? '' : '≈'}${fmt(F.cum[i] * pfNow())} ครั้ง${s.realtime ? ` · ออนไลน์ ${fmt(s.realtime)}` : ''}` : STATE_TXT[st]),
        prop: (g, cx, cy, col, live, now) => prop(themes[i], cx, cy, col, live, st, now, i) }; });
  }

  /** Corridor lanes: the busiest page-to-page moves, thicker = more people. */
  function flowLanes(Zs, lay) {
    const fl = ins.flows.slice().sort((a, b) => b.n - a.n).slice(0, 8); if (!fl.length) return [];
    const mxn = Math.max(...fl.map((f) => f.n)); const idx = new Map(ins.units.map((u, i) => [u.key, i])); const labels = [];
    fl.forEach((f, k) => {
      const a = idx.get(f.from); const b = idx.get(f.to); if (a === undefined || b === undefined) return;
      const off = ((k % 4) - 1.5) * 0.26; const A = lay[a].door; const B = lay[b].door;
      const pts = [[A[0], A[1] + lay[a].dir * -0.05], [A[0], CORR + off], [B[0], CORR + off], [B[0], B[1] + lay[b].dir * -0.05]].map(([x, y]) => P(x, y));
      ctx.globalAlpha = 0.6; ctx.strokeStyle = Zs[a].col; ctx.lineWidth = 1.5 + 6 * (f.n / mxn); ctx.lineJoin = 'round'; ctx.beginPath(); pts.forEach(([x, y], i2) => (i2 ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
      const [p1, p2] = [pts[2], pts[3]]; const ang = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]); const sz = 4 + 5 * (f.n / mxn); ctx.fillStyle = Zs[a].col; ctx.beginPath();
      ctx.moveTo(p2[0], p2[1]); ctx.lineTo(p2[0] - Math.cos(ang - 0.5) * sz * 1.6, p2[1] - Math.sin(ang - 0.5) * sz * 1.6); ctx.lineTo(p2[0] - Math.cos(ang + 0.5) * sz * 1.6, p2[1] - Math.sin(ang + 0.5) * sz * 1.6); ctx.fill(); ctx.globalAlpha = 1;
      if (k < 3 && f.n >= 2) labels.push({ x: (pts[1][0] + pts[2][0]) / 2, y: (pts[1][1] + pts[2][1]) / 2, text: `${fmt(f.n)}`, col: Zs[a].col });
    });
    return labels;
  }

  function draw(now) {
    const w = cv.width / dpr; const hgt = cv.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, hgt); ctx.setTransform(dpr * cam.z, 0, 0, dpr * cam.z, dpr * cam.tx, dpr * cam.ty);
    if (!ins) { drawPlan(now); return; }
    const L = curLay(); const Zs = zones(); const F = frameState(t); const items = []; const mx = Math.max(1, ...Zs.map((z) => z.pv)); const Hz = Z(1.4); hits = []; whits = [];
    const kit = { ctx, P, Z, get tw() { return tw; }, pal, reduced, box, faceX, faceY, disc, poly, shade };
    hospitalBase(now);
    gatePad('in', now); gatePad('out', now);
    const lanes = ins ? flowLanes(Zs, L) : [];
    Zs.forEach((z, i) => {
      const l = L[i]; const [cx, cy] = l.c; const x0 = cx - l.hx; const x1 = cx + l.hx; const y0 = cy - l.hy; const y1 = cy + l.hy; const col = z.col; const dim = focus >= 0 && focus !== i ? 0.4 : 1;
      ctx.globalAlpha = (0.12 + 0.4 * (z.pv / mx)) * dim; poly([P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)], col); ctx.globalAlpha = 1;
      poly([P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)], null, hover === i || focus === i ? pal.ink : col, hover === i || focus === i ? 2.4 : 1.2);
      if (z.top) { ctx.globalAlpha = reduced ? 1 : 0.55 + 0.45 * Math.sin(now / 300); poly([P(x0 - 0.25, y0 - 0.25), P(x1 + 0.25, y0 - 0.25), P(x1 + 0.25, y1 + 0.25), P(x0 - 0.25, y1 + 0.25)], null, '#f59e0b', 2.5); ctx.globalAlpha = 1; }
      if (ins) { ctx.globalAlpha = 0.9; poly([P(cx - 0.3, l.door[1] - l.dir * 0.12), P(cx + 0.3, l.door[1] - l.dir * 0.12), P(cx + 0.3, l.door[1] + l.dir * 0.12), P(cx - 0.3, l.door[1] + l.dir * 0.12)], col); ctx.globalAlpha = 1; }   // doorstep
      const pts = [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1), P(x0, y0, Hz), P(x1, y0, Hz)]; hits.push({ i, d: cx + cy, x0: Math.min(...pts.map((p) => p[0])), x1: Math.max(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])), y1: Math.max(...pts.map((p) => p[1])) });
      items.push({ d: cx + cy - l.hx - l.hy, f: () => { ctx.globalAlpha = dim; if (l.top) poly([P(x0, y0), P(x1, y0), P(x1, y0, Hz), P(x0, y0, Hz)], shade(col, 1)); const Hl = ins ? Z(0.6) : Hz; poly([P(x0, y0), P(x0, y1), P(x0, y1, Hl), P(x0, y0, Hl)], shade(col, 0.78)); ctx.globalAlpha = 1; } });   // inside: low side walls so neighbouring rooms never hide each other
      items.push({ d: cx + cy, f: () => {
        ctx.globalAlpha = z.alpha * dim; z.prop(kit, cx, cy, col, z.live, now); ctx.globalAlpha = 1;
        if (z.dot) { const [bx, by] = P(cx, cy, Z(z.dotZ)); ctx.fillStyle = z.dot; ctx.globalAlpha = z.dotBlink ? 0.55 + (reduced ? 0.45 : 0.45 * Math.sin(now / 350 + i)) : 1; ctx.beginPath(); ctx.arc(bx, by, Math.max(3, tw * 0.05), 0, 7); ctx.fill(); ctx.globalAlpha = 1; }
      } });
      const ph = z.pv ? 0.2 + 0.8 * (z.pv / mx) : 0.08; items.push({ d: cx + cy + 0.3, f: () => { ctx.globalAlpha = dim; box(x1 - 0.22, cy + l.dir * 0.05, 0.24, 0.24, ph, col); ctx.globalAlpha = 1; } });   // data pillar: height = page views
    });
    items.push(...gateItems('in', now), ...gateItems('out', now));
    let here = 0; let entered = 0; let enteredBack = 0; let left = 0;
    for (const j of crowd()) {
      if (t >= j.enter) { entered += 1; if (j.back) enteredBack += 1; } if (t >= j.exit) left += 1;
      const r = place(j, t, F); if (!r) continue; here += 1;
      if (r.state === 'work' && r.rank >= CAP) continue;
      items.push({ d: r.pos[0] + r.pos[1] + 0.01, f: () => person(r.pos[0], r.pos[1], r.state === 'work' ? Zs[r.zone].col : WALK, !!j.back, now) });
    }
    items.sort((a, b) => a.d - b.d).forEach((it) => it.f());
    Zs.forEach((z, i) => {
      const l = L[i]; const [lx, ly] = l.top ? P(l.c[0], l.c[1] - l.hy, Hz) : P(l.c[0], l.c[1] + l.hy, 0); const sc = ins && L.length > 6 ? 0.82 : 1; const kz = Math.pow(cam.z, -0.6) * sc;
      const off = (l.top ? -tw * 0.22 : tw * 0.24) * kz; const hh = Math.max(16, tw * 0.27 * kz);
      pill(`${z.icon} ${short(z.name, ins ? (L.length > 6 ? 14 : 18) : 20)}`, lx, ly + off, !ins && z.dot === STATE_COL.silent ? STATE_COL.silent : null, sc);
      pill(z.line(F, i), lx, ly + off + hh + 3, z.lineCol(F, i), sc);
    });
    lanes.forEach((q) => pill(q.text, q.x, q.y, q.col, 0.8));
    if (!hospOn()) { gateSign('in', `เข้าแล้ว ${fmt(entered)} คน${dayOn() ? ` · ใหม่ ${fmt(entered - enteredBack)} · เดิม ${fmt(enteredBack)}` : ''}`); gateSign('out', `ออกแล้ว ${fmt(left)} คน`); }
    hud(F, here);
  }
  /** Clock, counters, progress bar and the hour strip (once per drawn minute). */
  function hud(F, here) {
    const min = Math.floor(t);
    if (min !== lastMin) {
      lastMin = min; if (liveOn && !ins) drawStatus(); clock.textContent = hhmm(t); sub.textContent = ins ? `${ins.site.name} · ภายในระบบ · วันทั่วไป` : dayOn() ? `${R.rep.day === R.rep.today ? 'วันนี้' : 'วันที่คนใช้มากสุด'} · ${dayLabel(R.rep.day)}` : 'วันทั่วไป · เฉลี่ยจากช่วงที่เลือก';
      const done = F.cum.reduce((a, b) => a + b, 0); live.textContent = `${ins ? 'ในระบบ' : 'ในผัง'}ตอนนี้ ${fmt(here)} คน · เปิดหน้าสะสม ${dayOn() && R.rep.scale === 1 ? '' : '≈'}${fmt(done * pfNow())}`;
      prog.style.width = `${Math.min(100, Math.max(0, ((t - range.from) / Math.max(1, range.to - range.from)) * 100))}%`;
      const hr = Math.floor(t / 60); [...hoursEl.children].forEach((b) => { if (Number(b.dataset.h) === hr) b.setAttribute('aria-current', 'time'); else b.removeAttribute('aria-current'); });
    }
  }

  // ---------- inside one system: pages as rooms ----------
  const FOCUS_ZOOM = 2.3;
  const idle = () => (!ins && !entering);
  const center = (i, lay) => P(lay[i].c[0], lay[i].c[1], Z(0.5));
  const planCenter = (i) => { const c = deptOn() && DL[i] ? DL[i].c : hospIn() && HL.rooms[i] ? HL.rooms[i].c : hospOut() && HL.bld[BL[i]] ? HL.bld[BL[i]].door : LAY[i].c; return P(c[0], c[1], Z(0.5)); };
  function setCam(zv, p) {
    const w = cv.width / dpr; const hg = cv.height / dpr; cam.tz = zv; cam.ttx = zv === 1 ? 0 : w / 2 - zv * p[0]; cam.tty = zv === 1 ? 0 : hg / 2 - zv * p[1];
    if (reduced) { cam.z = cam.tz; cam.tx = cam.ttx; cam.ty = cam.tty; }
  }
  function fadeSwap() { cv.classList.add('s3-swap'); requestAnimationFrame(() => requestAnimationFrame(() => cv.classList.remove('s3-swap'))); }

  /** Pages of one project: backend `projects/pages`; an older Apps Script falls back to `stats` (page totals, no walking paths). */
  async function fetchPages(s, days) {
    if (S.source === 'sample') return { d: normalizePages(makeSamplePages(s, days)), approx: false };
    try {
      const d = normalizePages(await sessionCall('projects', 'pages', { key: s.key, days }));
      if (!d) { const bad = new Error('รูปแบบข้อมูลหน้าไม่ตรงกับเวอร์ชันล่าสุด'); /** @type {any} */ (bad).code = 'UNKNOWN_ACTION'; throw bad; }
      return { d, approx: false };
    } catch (e) {
      if (!e || e.code !== 'UNKNOWN_ACTION') throw e;
      const st = await sessionCall('projects', 'stats', { key: s.key, days }); return { d: normalizePages(pagesFromStats(st, days)), approx: true };
    }
  }
  async function enterSite(i, focusKey = '') {
    if (!idle()) return; const s = sites[i]; if (!s) return; entering = true; tip.hidden = true; const my = ++iseq; setCam(1.9, planCenter(i));
    try {
      const [res] = await Promise.all([fetchPages(s, S.days), new Promise((r) => { setTimeout(r, reduced ? 0 : 340); })]); if (my !== iseq || dead) return;
      openInside(s, i, res.d, res.approx); if (focusKey) { const k = roomIdx(focusKey); if (k >= 0) focusRoom(k); }
    } catch (e) { if (my !== iseq || dead) return; toast(`เปิดมุมมองภายในระบบไม่สำเร็จ — ${e.message || e}`, 'error', 5000); setCam(1, [0, 0]); } finally { if (my === iseq) entering = false; }
  }
  function openInside(s, i, d, approx) {
    const units = d.units; const pf2 = perFigure(units, S.days); const journeys = pageJourneys(units, d.flows, S.days, pf2, cfg); const hourly = Array(24).fill(0); units.forEach((u) => u.byHour.forEach((n, k) => { hourly[k] += n; }));
    const tot = units.reduce((a, u) => a + u.pv, 0); const top = units.filter((u) => u.kind !== 'p:other').sort((a, b) => b.pv - a.pv)[0];
    ins = { site: s, idx: i, d, units, flows: d.flows, journeys, pf: pf2, hourly, peak: tot ? hourly.indexOf(Math.max(...hourly)) : -1, tot, top: top && top.pv ? top.key : '', next: nextPages(units, d.flows), prev: prevPages(units, d.flows), approx, source: S.source };
    if (view === 'hospital') hb = BL[i] || hb;   // leaving the system brings the visitor back INSIDE its building
    ILAY = layout(units.length); focus = -1; range = timeRange(journeys, cfg); t = Math.min(range.to, Math.max(range.from, bkkMinutes())); lastMin = -1; hover = -1;
    rebuildPlan(); resize(); fadeSwap(); setCam(1, [0, 0]); banner.replaceChildren(...(approx ? [notice('warn', 'ยังไม่เห็นเส้นทางเดินระหว่างหน้า', 'Apps Script ยังเป็นเวอร์ชันเก่า (ไม่มี op pages) — ตัวเลขรายหน้าเป็นค่าประมาณและไม่มีเส้นทางเดิน วางไฟล์ Analytics.gs ใหม่แล้ว Deploy เวอร์ชันใหม่')] : units.length ? [] : [notice('info', 'ยังไม่มีข้อมูลรายหน้า', 'วางโค้ดติดตามในทุกหน้าของเว็บไซต์นี้')]));
    cv.setAttribute('aria-label', `ภายในระบบ ${s.name}: ${units.length} หน้า · เปิดหน้ารวม ${fmt(tot)} ครั้งใน ${S.days} วัน`); playing = !reduced; drawAll();
  }
  function leave() {
    if (!ins) return; ins = null; ILAY = []; focus = -1; range = floorRange; t = Math.min(range.to, Math.max(range.from, t)); lastMin = -1; hover = -1; tip.hidden = true;
    banner.replaceChildren(); rebuildPlan(); resize(); planWings(); fadeSwap(); setCam(1, [0, 0]); cv.setAttribute('aria-label', `ผัง 3 มิติ ${sites.length} โครงการ · เปิดหน้ารวม ${fmt(sm.pv)} ครั้งใน ${S.days} วัน`); drawAll();
  }
  function focusRoom(i) {
    if (!ins) return; if (i === focus || i < 0) { focus = -1; setCam(1, [0, 0]); } else { focus = i; setCam(FOCUS_ZOOM, center(i, ILAY)); }
    lastMin = -1; drawRoomCard(); drawLegend();
  }

  const unitName = (k) => (ins.units.find((u) => u.key === k) || { name: k }).name;
  const roomIdx = (k) => ins.units.findIndex((u) => u.key === k);
  function kpisIn() {
    const I = ins; const top = I.units.find((u) => u.key === I.top);
    kpis.replaceChildren(kpi('การเปิดหน้า', fmt(I.tot), `ใน ${S.days} วัน · ${fmt(I.units.length)} หน้า`), kpi('ผู้เข้าชม', fmt(I.d.uv), 'นับรายวันต่อหน้า'), kpi('ออนไลน์ตอนนี้', fmt(I.d.realtime), 'ภายใน 5 นาทีล่าสุด'),
      kpi('หน้ายอดนิยม', top ? top.name : '–', top && I.tot ? `${Math.round((top.pv / I.tot) * 100)}% ของทั้งระบบ` : null),
      kpi('ช่วงคนเข้ามากสุด', I.peak >= 0 ? `${String(I.peak).padStart(2, '0')}:00–${String((I.peak + 1) % 24).padStart(2, '0')}:00` : '–', I.flows.length ? `${fmt(I.flows.reduce((a, f) => a + f.n, 0))} ครั้งที่เดินต่อไปหน้าอื่น` : null));
  }
  function legendIn() {
    legend.replaceChildren(...ins.units.map((u, i) => h('button', { type: 'button', class: `s3-lg${focus === i ? ' is-on' : ''}`, title: 'ซูมไปที่ห้องนี้', onclick: () => focusRoom(i) }, h('i', { style: `background:${roomColor(u.kind)}` }), `${kindMeta(u.kind).icon} ${u.name}`)),
      h('span', { class: 's3-lg' }, h('i', { style: `background:${WALK}` }), 'กำลังเดินเข้า/ออก/ข้ามหน้า'), h('span', { class: 's3-lg' }, h('i', { class: 's3-lane' }), 'เส้นบนทางเดิน = คนที่ไปต่อหน้าอื่น (ยิ่งหนายิ่งมาก)'));
  }
  function tableIn() {
    const I = ins; const tot = I.tot || 1;
    tableBox.replaceChildren(h('table', { class: 's3-table' }, h('thead', null, h('tr', null, [...['หน้า', 'พาธ', 'เปิดหน้า', 'สัดส่วน', 'ผู้เข้าชม', 'ออนไลน์', 'คนมักไปต่อที่'], 'บทบาทผู้ใช้'].map((x) => h('th', null, x)))),
      h('tbody', null, I.units.map((u, i) => { const nx = (I.next[u.key] || [])[0];
        return h('tr', { class: focus === i ? 'is-on' : '' }, h('td', null, h('button', { type: 'button', class: 'rowbtn', onclick: () => focusRoom(i), title: 'ซูมไปที่ห้องนี้' }, `${kindMeta(u.kind).icon} ${u.name}`)), h('td', { class: 's3-cut', title: u.path }, u.path === '*other' ? '–' : u.path), h('td', null, fmt(u.pv)),
          h('td', null, h('span', { class: 's3-bar', title: `${Math.round((u.pv / tot) * 100)}%` }, h('i', { style: `width:${Math.max(2, (u.pv / tot) * 100)}%;background:${roomColor(u.kind)}` }), h('em', null, `${Math.round((u.pv / tot) * 100)}%`))),
          h('td', null, fmt(u.uv)), h('td', null, fmt(u.realtime)), h('td', { title: roleText(u) }, roleOf(u).known ? roleOf(u).list.slice(0, 2).map((x) => `${ROLES[x.id].short} ${x.pct}%`).join(' / ') : '–'), h('td', null, nx ? `${unitName(nx.to)} (${fmt(nx.n)})` : '–')); }))));
  }
  function drawRoomCard() {
    roomCard.hidden = !ins; if (!ins) return; const I = ins; const u = focus >= 0 ? I.units[focus] : null;
    if (!u) { roomCard.replaceChildren(h('h3', null, 'คลิกห้องเพื่อซูมเข้าไปดู'), h('p', { class: 's3-note' }, 'หนึ่งห้อง = หนึ่งหน้าของระบบ · คนสีตามห้องคือผู้ใช้ที่กำลังอยู่หน้านั้น · เส้นบนทางเดินคือการเปลี่ยนจากหน้าหนึ่งไปอีกหน้า · กด Esc เพื่อกลับ')); return; }
    const nx = I.next[u.key] || []; const pv = I.prev[u.key] || []; const chip = (k, n) => h('button', { type: 'button', class: 's3-lg', onclick: () => focusRoom(roomIdx(k)) }, `${kindMeta((I.units[roomIdx(k)] || {}).kind).icon} ${unitName(k)} · ${fmt(n)}`);
    roomCard.replaceChildren(h('h3', null, `${kindMeta(u.kind).icon} ${u.name}`), h('p', { class: 's3-roommeta' }, `${kindMeta(u.kind).label} · `, h('code', null, u.path === '*other' ? 'หลายหน้ารวมกัน' : u.path)),
      h('p', null, `${fmt(u.pv)} ครั้ง (${Math.round((u.pv / (I.tot || 1)) * 100)}% ของทั้งระบบ) · ผู้เข้าชม ${fmt(u.uv)} · ออนไลน์ ${fmt(u.realtime)}`),
      h('div', { class: 's3-flowrow' }, h('b', null, 'มาจากหน้า'), pv.length ? pv.slice(0, 4).map((x) => chip(x.from, x.n)) : h('small', null, 'เข้าตรงหน้านี้ (ลิงก์ / บุ๊กมาร์ก / QR)')),
      h('div', { class: 's3-flowrow' }, h('b', null, 'ไปต่อที่'), nx.length ? nx.slice(0, 4).map((x) => chip(x.to, x.n)) : h('small', null, 'ส่วนใหญ่จบที่หน้านี้')),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => focusRoom(focus) }, 'ซูมออก'));
  }

  // ---------- hospital: walk into / out of a building ----------
  function enterBld(id) {
    if (!idle() || !hospOut() || !HL.bld[id]) return; entering = true; tip.hidden = true; const my = ++iseq; const b = HL.bld[id]; setCam(1.7, P(b.door[0], b.door[1], Z(0.7)));
    setTimeout(() => { if (my !== iseq || dead) return; entering = false; hb = id; hover = -1; hoverB = ''; rebuildPlan(); resize(); planWings(); fadeSwap(); setCam(1, [0, 0]); lastMin = -1; drawAll(); }, reduced ? 0 : 340);
  }
  function leaveBld() {
    if (ins || !hb) return; hb = null; hover = -1; hoverB = ''; tip.hidden = true; rebuildPlan(); resize(); planWings(); fadeSwap(); setCam(1, [0, 0]); lastMin = -1; drawAll();
  }
  const canvasXY = (ev) => { const r = cv.getBoundingClientRect(); return [(ev.clientX - r.left - cam.tx) / cam.z, (ev.clientY - r.top - cam.ty) / cam.z]; };
  function bldAt(ev) { if (!bhits.length) return null; const [x, y] = canvasXY(ev); return bhits.filter((q) => x >= q.x0 && x <= q.x1 && y >= q.y0 - tw * 0.1 && y <= q.y1 + tw * 0.2).sort((a2, b2) => b2.d - a2.d)[0] || null; }
  function exitAt(ev) { if (!xhit) return false; const [x, y] = canvasXY(ev); return x >= xhit.x0 && x <= xhit.x1 && y >= xhit.y0 && y <= xhit.y1; }
  function showBldTip(b, ev) {
    const ids = BL.map((x, i) => (x === b.id ? i : -1)).filter((i) => i >= 0); const sr = stage.getBoundingClientRect(); const pv = ids.reduce((a, i) => a + sites[i].pv, 0);
    tip.replaceChildren(h('b', null, `${b.icon} ${b.name}`), h('small', null, ids.length ? ids.map((i) => sites[i].name).join(' · ') : 'ยังไม่มีระบบในอาคารนี้'), h('span', null, `${fmt(ids.length)} ระบบ · เปิดหน้า ${fmt(pv)} ครั้งใน ${S.days} วัน`), h('small', null, 'คลิกเพื่อเข้าไปดูแผนกภายในอาคาร'));
    tip.hidden = false; const px = ev.clientX - sr.left; tip.style.left = `${Math.min(Math.max(8, px + 14), Math.max(8, sr.width - 230))}px`; tip.style.top = `${Math.max(8, ev.clientY - sr.top + 14)}px`;
  }

  // ---------- pointer ----------
  function stationAt(ev) {
    const r = cv.getBoundingClientRect(); const x = (ev.clientX - r.left - cam.tx) / cam.z; const y = (ev.clientY - r.top - cam.ty) / cam.z; const L = curLay();
    const hit = hits.filter((q) => x >= q.x0 && x <= q.x1 && y >= q.y0 - tw * 0.55 && y <= q.y1 + tw * 0.2).sort((a2, b2) => b2.d - a2.d)[0];
    return hit ? hit.i : -1;
  }
  function tileAt(ev) {
    if (ins || !whits.length) return null;
    const r = cv.getBoundingClientRect(); const x = (ev.clientX - r.left - cam.tx) / cam.z; const y = (ev.clientY - r.top - cam.ty) / cam.z;
    return whits.filter((q) => x >= q.x0 && x <= q.x1 && y >= q.y0 && y <= q.y1).sort((a2, b2) => b2.d - a2.d)[0] || null;
  }
  function showTileTip(tl, ev) {
    const w = W.map[sites[tl.i].key]; const u = w && w.units[tl.p]; if (!u) { tip.hidden = true; return; }
    const sr = stage.getBoundingClientRect(); const km = kindMeta(u.kind); const nx = wingNext(w, u.key); const nu = nx ? w.units.find((x) => x.key === nx.to) : null;
    tip.replaceChildren(h('b', null, `${km.icon} ${u.name}`), h('small', null, `${sites[tl.i].name} · ${km.label} · ${u.path}`), h('span', null, `${fmt(u.pv)} ครั้ง (${Math.round((u.pv / (w.tot || 1)) * 100)}% ของระบบนี้) · ผู้เข้าชม ${fmt(u.uv)}${u.realtime ? ` · ออนไลน์ ${fmt(u.realtime)}` : ''}`),
      nu ? h('small', null, `มักไปต่อ → ${nu.name} (${fmt(nx.n)})`) : null, roleOf(u).known ? h('small', null, `👥 ${roleText(u)}`) : null, h('small', null, 'คลิกเพื่อเข้าไปดูภายในระบบและซูมที่หน้านี้'));
    tip.hidden = false; const px = ev.clientX - sr.left; tip.style.left = `${Math.min(Math.max(8, px + 14), Math.max(8, sr.width - 230))}px`; tip.style.top = `${Math.max(8, ev.clientY - sr.top + 14)}px`;
  }
  function showTip(i, ev) {
    if (i < 0 || entering) { tip.hidden = true; return; }
    const sr = stage.getBoundingClientRect();
    if (ins) {
      const u = ins.units[i]; const nx = (ins.next[u.key] || [])[0]; const km = kindMeta(u.kind);
      tip.replaceChildren(h('b', null, `${km.icon} ${u.name}`), h('small', null, `${km.label} · ${u.path === '*other' ? 'หลายหน้า' : u.path}`), h('span', null, `${fmt(u.pv)} ครั้ง (${Math.round((u.pv / (ins.tot || 1)) * 100)}%) · ผู้เข้าชม ${fmt(u.uv)}`),
        nx ? h('small', null, `มักไปต่อ → ${unitName(nx.to)} (${fmt(nx.n)})`) : null, h('small', null, focus === i ? 'คลิกเพื่อซูมออก' : 'คลิกเพื่อซูมเข้าห้องนี้'));
    } else {
      const s = sites[i]; const st = stateOf(s); const tr = trendOf(s);
      tip.replaceChildren(h('b', null, `${THEMES[themes[i]].icon} ${s.name}`), h('small', null, `${THEMES[themes[i]].label} · ${hostOf(s.url) || '–'}`), h('span', null, `${fmt(s.pv)} ครั้ง · ผู้เข้าชม ${fmt(s.uv)}${tr === null ? '' : tr === 'new' ? ' · ใหม่' : ` · ${tr > 0 ? '+' : ''}${tr}%`}`), dayOn() && R.rep.sites[s.key] ? h('span', null, `วันนั้น ${fmt(R.rep.sites[s.key].n)} ครั้ง · ใหม่ ${fmt(R.rep.sites[s.key].fresh)} · กลับมา ${fmt(R.rep.sites[s.key].back)}`) : null, h('span', { class: `s3-pill st-${stCls(s)}` }, stTxt(s)), h('small', null, 'คลิกเพื่อซูมเข้าไปดูหน้าต่างๆ ภายในระบบ'));
    }
    tip.hidden = false; const px = ev.clientX - sr.left; tip.style.left = `${Math.min(Math.max(8, px + 14), Math.max(8, sr.width - 230))}px`; tip.style.top = `${Math.max(8, ev.clientY - sr.top + 14)}px`;
  }
  cv.addEventListener('pointermove', (ev) => {
    const tl = tileAt(ev); const bd = !tl && hospOut() && !entering ? bldAt(ev) : null; const i = tl || bd ? -1 : stationAt(ev); hoverT = tl; hoverB = bd ? bd.id : ''; if (i !== hover) hover = i;
    const xo = hospIn() && !entering && i < 0 && exitAt(ev); cv.style.cursor = tl || bd || xo || i >= 0 || (ins && focus >= 0) ? 'pointer' : 'default';
    if (tl && !entering) showTileTip(tl, ev); else if (bd) showBldTip(BLD(bd.id), ev); else if (xo) tip.hidden = true; else showTip(i, ev);
  });
  cv.addEventListener('pointerleave', () => { hover = -1; hoverT = null; hoverB = ''; tip.hidden = true; });
  cv.addEventListener('click', (ev) => { const tl = tileAt(ev); if (tl) { enterSite(tl.i, tl.key); return; } if (hospOut()) { const bd = bldAt(ev); if (bd) enterBld(bd.id); return; } const i = stationAt(ev); if (hospIn() && i < 0 && exitAt(ev)) { leaveBld(); return; } if (ins) { if (i >= 0) focusRoom(i); else if (focus >= 0) focusRoom(focus); } else if (i >= 0) enterSite(i); });
  const onKey = (ev) => { if (ev.key !== 'Escape') return; if (ins) { if (focus >= 0) focusRoom(focus); else leave(); } else if (hospIn() && !entering) leaveBld(); };
  document.addEventListener('keydown', onKey);

  // ---------- loop ----------
  function themeSync() { pal = document.documentElement.dataset.theme === 'dark' ? PAL.dark : PAL.light; font = getComputedStyle(document.body).fontFamily || 'sans-serif'; }
  function loop(now) {
    raf = requestAnimationFrame(loop); const dt = last ? Math.min(100, Math.max(0, now - last)) : 0; last = now; if (document.hidden || !onScreen || !sites.length) return;
    if (liveOn && liveUsable()) {   // real time: follow the clock, widen the window when the day moves on
      const nm = bkkMinutes(); if (nm > range.to) { range = { from: range.from, to: Math.min(1440, Math.ceil(nm / 60) * 60 + 60) }; floorRange = range; } if (nm < range.from) { range = { from: Math.floor(nm / 60) * 60, to: range.to }; floorRange = range; }
      t = nm; if (playing) { playing = false; sync(); }
    } else if (playing) {
      if (t >= range.to) { if (!loopOn) pause(); else if (!endHold) endHold = now + 1200; else if (now >= endHold) { t = range.from; endHold = 0; lastMin = -1; } }   // วนเล่นซ้ำ
      else t = Math.min(range.to, t + (dt / 1000) * speed);
    }
    const k = reduced ? 1 : 1 - Math.exp(-dt / 110); cam.z += (cam.tz - cam.z) * k; cam.tx += (cam.ttx - cam.tx) * k; cam.ty += (cam.tty - cam.ty) * k;
    draw(now);
  }
  loadCss('site3d').catch(() => {});
  ctx = cv.getContext('2d'); themeSync(); resize(); drawRange(); sync();
  const ro = new ResizeObserver(() => { resize(); if (sites.length) draw(performance.now()); }); ro.observe(scroller);
  const mo = new MutationObserver(themeSync); mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const io = typeof IntersectionObserver === 'function' ? new IntersectionObserver((e) => { onScreen = e[e.length - 1].isIntersecting; }) : null; if (io) io.observe(stage);
  const onVisible = () => { if (document.hidden || S.busy || !S.at || S.source !== 'real') return; if (liveOn && liveUsable()) refreshLive(); else if (Date.now() - S.at > 120000) load(); };
  document.addEventListener('visibilitychange', onVisible); timer = window.setInterval(onVisible, 15000);
  load().then(() => { if (!dead && !reduced && sites.length && !liveOn) play(); });   // starts playing "now" unless the visitor prefers reduced motion
  raf = requestAnimationFrame(loop);
  return () => { dead = true; seq += 1; cancelAnimationFrame(raf); clearInterval(timer); ro.disconnect(); mo.disconnect(); if (io) io.disconnect(); document.removeEventListener('visibilitychange', onVisible); document.removeEventListener('keydown', onKey); };
}
