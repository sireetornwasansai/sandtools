// Engine for the 3D home page: one station per monitored project/website. Turns the backend's per-project statistics
// (pageviews, previous period, "online now", 24-hour profile) into a replayable "typical day", plain-language insights and a CSV.
// Pure functions, no DOM → unit-testable. Insights are simple arithmetic computed in the browser (no language model, nothing leaves the device).

export const MAX_SITES = 8;       // stations on the floor (the rest are listed below)
export const MAX_PAGES = 10;      // rooms inside one system (the rest are folded into "other pages")
export const MAX_FIGURES = 140;   // upper bound of people drawn in a typical day
export const PALETTE = ['#3758f9', '#0b7a7c', '#c2410c', '#7c3aed', '#be185d', '#4d7c0f', '#0891b2', '#b45309'];
export const IDLE_COL = '#94a3b8';
/** Replay settings. `walk`/`dwell` are *display* minutes (a page view really lasts seconds) so the crowd stays visible. */
export const DEFAULTS = { open: 360, close: 1200, walk: 10, dwell: 30 };

const pad = (n) => String(n).padStart(2, '0');
export const hhmm = (m) => { const t = Math.max(0, Math.round(m)); return `${pad(Math.floor(t / 60) % 24)}:${pad(t % 60)}`; };
export const fmt = (n) => Number(n || 0).toLocaleString('th-TH');
export const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return String(u || ''); } };

/** Deterministic PRNG (mulberry32): the same data always draws the same crowd. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const arr = (v) => (Array.isArray(v) ? v : []);
function site(s) {
  const byHour = arr(s.byHour).length === 24 ? s.byHour.map(num) : Array(24).fill(0);
  return { tags: Array.isArray(s.tags) ? s.tags.map(String) : String(s.tags || '').split(/[,\s]+/).filter(Boolean), key: String(s.key || ''), name: String(s.name || s.key || '-'), url: String(s.url || ''), status: String(s.status || 'active'), track: s.track !== false, pv: num(s.pv), prev: s.prev === undefined || s.prev === null ? null : num(s.prev),
    uv: num(s.uv), realtime: s.realtime === null || s.realtime === undefined ? null : num(s.realtime), last: s.last || '', byHour };
}

/** Station "model" per kind of system. Picked from a `theme:<id>` tag (override) or by keywords in the project's name / address (Thai + English). */
export const THEMES = {
  ems: { icon: '🚑', label: 'ยานพาหนะ / รถพยาบาล' }, hrd: { icon: '🎓', label: 'ห้องอบรมบุคลากร' }, ec: { icon: '🔬', label: 'ห้องวิจัย / จริยธรรมการวิจัย' }, vaccine: { icon: '💉', label: 'ห้องวัคซีน' },
  dental: { icon: '🦷', label: 'ห้องทันตกรรม' }, pt: { icon: '🩺', label: 'ห้องกายภาพบำบัด' }, plan: { icon: '📊', label: 'ห้องแผนงาน / ยุทธศาสตร์' }, doc: { icon: '🗂️', label: 'ห้องสารบรรณ' },
  visit: { icon: '🏠', label: 'เยี่ยมบ้าน / แผนที่' }, web: { icon: '🌐', label: 'เว็บไซต์ / ระบบทั่วไป' },
};
const RULES = [
  ['vaccine', /vaccin|วัคซีน|\bepi\b|immuniz/], ['dental', /dental|ทันต|ฟัน/], ['pt', /physio|กายภาพ|\bpt\b|pt-?station/],
  ['ems', /ยานพาหนะ|พาหนะ|ขอใช้รถ|จองรถ|รถพยาบาล|รถ|ambulance|\bems\b|fleet|vehicle|carsystem/], ['hrd', /hrd|อบรม|training|บุคลากร|ทรัพยากรบุคคล/],
  ['ec', /\bec\b|จริยธรรม|วิจัย|ethic|research|\birb\b/], ['visit', /เยี่ยมบ้าน|home-?visit|แผนที่|\bmap\b/], ['doc', /สารบรรณ|เอกสาร|document|\bdocs?\b/], ['plan', /แผนงาน|ยุทธศาสตร์|strategy|\bplan\b|kpi|ตัวชี้วัด/],
];
/** @returns {keyof typeof THEMES} */
export function themeOf(s) {
  const tag = (s.tags || []).map((t) => String(t).toLowerCase()).find((t) => t.startsWith('theme:')); if (tag && THEMES[tag.slice(6)]) return tag.slice(6);
  const text = `${(s.tags || []).join(' ')} ${s.name} ${hostOf(s.url)} ${s.key}`.toLowerCase();
  if (/\bsand\b/.test(text) && !/office|tool/.test(text)) return 'ems';   // SAND = fleet system (not "SAND Office Tools")
  for (const [id, re] of RULES) if (re.test(text)) return id;
  return 'web';
}

/** Backend answer of `projects/floor` → safe shape (or null when it is not that answer, e.g. an older Apps Script). */
export function normalizeFloor(d) {
  if (!d || typeof d !== 'object' || !Array.isArray(d.sites)) return null;
  return { days: num(d.days) || 30, total: num(d.total) || d.sites.length, sites: d.sites.map(site).filter((s) => s.key) };
}

/** Fallback for backends without `floor`: the project list (7-day totals) plus `stats` of the busiest projects. */
export function fromListStats(list, statsByKey, days) {
  const items = arr(list && list.items); const out = items.map((p) => {
    const st = statsByKey[p.key];
    return site({ key: p.key, tags: p.tags, name: p.name, url: p.url, status: p.status, track: p.track, pv: st ? st.pv : p.pv7, uv: st ? st.uv : p.uv7, prev: undefined, realtime: st ? st.realtime : null, byHour: st ? st.byHour : [], last: st ? st.last : p.last ? new Date(p.last).toISOString() : '' });
  });
  return { days, total: out.length, sites: out };
}

/** Priority of a station = its CURRENT usage status: 0 people online now · 1 normal · 2 silent (had visitors, none now) · 3 no data yet · 4 collection paused. */
export function usageRank(s) {
  const st = stateOf(s);
  return st === 'paused' ? 4 : st === 'idle' ? 3 : st === 'silent' ? 2 : num(s.realtime) > 0 ? 0 : 1;
}
/** Projects with people online now first, then by busiest; quiet ones last. Returns the stations to draw and how many projects did not fit. */
export function pickSites(all) {
  const s = all.filter((x) => x.status !== 'deleted').slice().sort((a, b) => usageRank(a) - usageRank(b) || b.pv - a.pv || a.name.localeCompare(b.name, 'th'));
  return { sites: s.slice(0, MAX_SITES), more: Math.max(0, s.length - MAX_SITES) };
}

/** Station status: 'ok' | 'paused' (collection switched off) | 'idle' (no data in the period) | 'silent' (had visitors before, none now). */
export function stateOf(s) {
  if (s.status === 'paused' || s.track === false) return 'paused';
  if (s.pv === 0) return s.prev > 0 ? 'silent' : 'idle';
  return 'ok';
}
export const trendOf = (s) => (s.prev === null ? null : s.prev === 0 ? (s.pv > 0 ? 'new' : null) : Math.round(((s.pv - s.prev) / s.prev) * 100));

/** How many page views one drawn person stands for, so a busy day never draws thousands of people. */
export const perFigure = (sites, days) => Math.max(1, Math.ceil(sites.reduce((a, s) => a + s.pv, 0) / Math.max(1, days) / MAX_FIGURES));

/** A "typical day": the 24-hour profile of each site divided by the number of days, one walking person per `perFig` page views. */
export function visitors(sites, days, perFig, c = DEFAULTS, seed = 43) {
  const r = rng(seed); const out = []; let id = 0;
  sites.forEach((s, si) => s.byHour.forEach((n, hr) => {
    const e = n / Math.max(1, days) / perFig; let k = Math.floor(e) + (r() < e - Math.floor(e) ? 1 : 0);
    for (; k > 0; k--) { const at = hr * 60 + r() * 60; out.push({ id: ++id, site: si, enter: at - c.walk, start: at, end: at + c.dwell, exit: at + c.dwell + c.walk }); }
  }));
  return out;
}

/** Replay window (minutes from midnight), widened to fit everyone and clamped to the day. */
export function timeRange(vis, c = DEFAULTS) {   // works with single-stop visitors and multi-stop journeys (uses enter / exit)
  if (!vis.length) return { from: c.open, to: c.close };
  const first = Math.min(...vis.map((v) => v.enter)); const last = Math.max(...vis.map((v) => v.exit));
  return { from: Math.max(0, Math.min(c.open, Math.floor(first / 60) * 60)), to: Math.min(1440, Math.max(c.close, Math.ceil(last / 60) * 60)) };
}

/** Minute with the most people on the floor (opening frame of the replay). */
export function crowdPeak(vis, range) {
  let best = range.from; let bn = -1;
  for (let t = range.from; t <= range.to; t += 1) { let n = 0; for (const v of vis) if (t >= v.enter && t < v.exit) n += 1; if (n > bn) { bn = n; best = t; } }
  return best;
}

/** Totals over every project (not only the ones drawn). */
export function summarize(all) {
  const s = all.filter((x) => x.status !== 'deleted'); const hourly = Array(24).fill(0); let pv = 0; let prev = 0; let hasPrev = false; let uv = 0; let rt = 0; let hasRt = false;
  for (const x of s) { pv += x.pv; uv += x.uv; if (x.prev !== null) { prev += x.prev; hasPrev = true; } if (x.realtime !== null) { rt += x.realtime; hasRt = true; } x.byHour.forEach((n, i) => { hourly[i] += n; }); }
  const peakHour = pv ? hourly.indexOf(Math.max(...hourly)) : -1;
  return { total: s.length, tracking: s.filter((x) => stateOf(x) !== 'paused').length, pv, prev: hasPrev ? prev : null, uv, realtime: hasRt ? rt : null, hourly, peakHour, top: s.slice().sort((a, b) => b.pv - a.pv)[0] || null };
}

/** Exponential smoothing forecast of the next value. */
export function forecast(counts, alpha = 0.5) { let s = counts[0] || 0; for (let i = 1; i < counts.length; i++) s = alpha * counts[i] + (1 - alpha) * s; return s; }

/**
 * Rule-based insights about the monitored websites. Each item: {tone:'ok'|'warn'|'info', text}.
 * @param {ReturnType<typeof site>[]} all @param {number} days
 * @param {{devices?:Array<{name:string,n:number}>, referrers?:Array<{name:string,n:number}>, byDay?:Array<{d:string,pv:number}>}} [extra] from the overview answer
 */
export function insights(all, days, extra = {}) {
  const sm = summarize(all); const out = []; const pct = (a, b) => Math.round((a / Math.max(1, b)) * 100);
  if (!sm.total) return [{ tone: 'info', text: 'ยังไม่มีโครงการที่ติดตาม — เพิ่มโครงการด้านล่างเพื่อเริ่มดูสถิติ' }];
  if (sm.top && sm.top.pv > 0) out.push({ tone: 'info', text: `${sm.top.name} มีคนเปิดมากสุด ${fmt(sm.top.pv)} ครั้งใน ${days} วัน (${pct(sm.top.pv, sm.pv)}% ของทุกโครงการ)` });
  if (sm.peakHour >= 0) out.push({ tone: 'info', text: `ช่วงที่คนเข้าเว็บมากสุด ${pad(sm.peakHour)}:00–${pad((sm.peakHour + 1) % 24)}:00 น. (เวลาไทย) — เลี่ยงอัปเดตหรือปิดปรับปรุงระบบช่วงนี้` });
  if (sm.realtime) out.push({ tone: 'ok', text: `ตอนนี้มีผู้ออนไลน์ ${fmt(sm.realtime)} คน (ภายใน 5 นาทีล่าสุด)` });
  const moves = all.filter((s) => stateOf(s) === 'ok' && s.prev > 0 && Math.max(s.pv, s.prev) >= 10).map((s) => ({ s, p: trendOf(s) })).filter((x) => Math.abs(x.p) >= 20).sort((a, b) => a.p - b.p);
  const fall = moves.filter((x) => x.p < 0)[0]; const rise = moves.filter((x) => x.p > 0).pop();
  if (fall) out.push({ tone: 'warn', text: `${fall.s.name} ลดลง ${Math.abs(fall.p)}% เทียบกับช่วงก่อนหน้า — ตรวจว่าเว็บยังเปิดได้ปกติและโค้ดติดตามยังอยู่` });
  if (rise) out.push({ tone: 'ok', text: `${rise.s.name} เพิ่มขึ้น ${rise.p}% เทียบกับช่วงก่อนหน้า` });
  const silent = all.filter((s) => stateOf(s) === 'silent'); const idle = all.filter((s) => stateOf(s) === 'idle'); const paused = all.filter((s) => stateOf(s) === 'paused');
  if (silent.length) out.push({ tone: 'warn', text: `เงียบผิดปกติ: ${silent.map((s) => s.name).join(', ')} เคยมีคนเข้า แต่ใน ${days} วันนี้ไม่มีเลย — ตรวจว่าเว็บล่มหรือโค้ดติดตามถูกถอดหรือไม่` });
  if (idle.length) out.push({ tone: 'info', text: `ยังไม่มีข้อมูลเข้ามา: ${idle.map((s) => s.name).join(', ')} — วางโค้ดติดตามในเว็บไซต์แล้วเปิดเว็บสักหน้า ข้อมูลจะปรากฏภายในไม่กี่นาที` });
  if (paused.length) out.push({ tone: 'info', text: `หยุดเก็บสถิติอยู่ ${paused.length} โครงการ: ${paused.map((s) => s.name).join(', ')}` });
  const dv = arr(extra.devices); const dt = dv.reduce((a, d) => a + num(d.n), 0); const mob = dv.find((d) => d.name === 'mobile');
  if (mob && dt >= 20 && pct(mob.n, dt) >= 50) out.push({ tone: 'info', text: `ผู้เข้าชม ${pct(mob.n, dt)}% ใช้มือถือ — ควรตรวจหน้าเว็บบนมือถือเป็นอันดับแรก` });
  const ref = arr(extra.referrers)[0]; if (ref && num(ref.n) >= 10) out.push({ tone: 'info', text: `ช่องทางที่พาคนเข้ามามากสุดคือ ${ref.name || 'เข้าโดยตรง / แอปแชต'} (${fmt(ref.n)} ครั้ง)` });
  const bd = arr(extra.byDay).map((x) => num(x.pv)); if (bd.length >= 3 && bd.some(Boolean)) out.push({ tone: 'info', text: `พรุ่งนี้คาดว่ามีการเปิดหน้าราว ${fmt(Math.round(forecast(bd.slice(-14))))} ครั้ง (ประมาณการจากค่าเฉลี่ยถ่วงน้ำหนัก ใช้เป็นแนวทางเท่านั้น)` });
  return out;
}

/** CSV of the per-project summary (formula-injection safe). */
export function sitesCsv(all, days) {
  const esc = (v) => { let t = String(v ?? ''); if (/^[=+\-@]/.test(t)) t = `'${t}`; return `"${t.replace(/"/g, '""')}"`; };
  const rows = [['โครงการ', 'เว็บไซต์', `เปิดหน้า (${days} วัน)`, 'ช่วงก่อนหน้า', 'ผู้เข้าชม', 'ออนไลน์ตอนนี้', 'สถานะ'], ...all.map((s) => [s.name, hostOf(s.url), s.pv, s.prev ?? '', s.uv, s.realtime ?? '', { ok: 'ปกติ', paused: 'หยุดเก็บสถิติ', idle: 'ยังไม่มีข้อมูล', silent: 'เงียบผิดปกติ' }[stateOf(s)]])];
  return rows.map((r) => r.map(esc).join(',')).join('\r\n');
}

/** Demo data so the home page is useful before anything is attached. Same seed ⇒ same data. */
export function makeSample(days = 30, seed = 11) {
  const r = rng(seed); const prof = [1, 0, 0, 0, 1, 2, 4, 9, 16, 20, 18, 12, 9, 13, 17, 15, 11, 6, 4, 3, 2, 2, 1, 1];
  const defs = [['ระบบยานพาหนะ (SAND)', 'https://sand.example.org', 420, 1.0, 'ok'], ['ระบบพัฒนาบุคลากร HRD', 'https://hrd.example.org', 300, 1.2, 'ok'], ['จริยธรรมการวิจัย (EC)', 'https://ec.example.org', 150, 0.8, 'ok'],
    ['ห้องวัคซีน', 'https://vaccine.example.org', 90, 0.7, 'ok'], ['เว็บไซต์โรงพยาบาล', 'https://hospital.example.org', 260, 1.1, 'ok'], ['ระบบสารบรรณ', 'https://doc.example.org', 120, 0.9, 'ok'],
    ['ระบบทันตกรรม', 'https://dental.example.org', 60, 0, 'silent'], ['ระบบกายภาพบำบัด', 'https://pt.example.org', 0, 0, 'idle']];
  const sites = defs.map(([name, url, perDay, trend, kind], i) => {
    const byHour = prof.map((w) => (kind === 'silent' ? (r(), 0) : Math.round(((w * perDay * days) / 160) * (0.8 + 0.4 * r())))); const pv = byHour.reduce((a, b) => a + b, 0);
    const prev = kind === 'silent' ? 120 : kind === 'idle' ? 0 : Math.round(pv / (trend === 0 ? 1 : trend)); return site({ key: `demo${i}`, name, url, status: 'active', track: true, pv, prev, uv: Math.round(pv * 0.42), realtime: pv ? Math.round(r() * 4) : 0, last: '', byHour });
  });
  return { days, total: sites.length, sites, extra: { devices: [{ name: 'mobile', n: 520 }, { name: 'desktop', n: 330 }], referrers: [{ name: '', n: 410 }, { name: 'facebook.com', n: 160 }],
    byDay: Array.from({ length: Math.min(days, 14) }, (_, i) => ({ d: String(i), pv: Math.round(300 + 120 * Math.sin(i / 2) + r() * 60) })) } };
}

/* ============================ inside one system: pages as rooms ============================ */

/** Kind of page → icon + label. The kind is guessed from the file name (Thai or English). Extend PAGE_LABELS / PAGE_RULES for your own pages. */
export const PAGE_KINDS = {
  'p:home': { icon: '🏠', label: 'หน้าแรก / ต้อนรับ' }, 'p:dash': { icon: '📊', label: 'แดชบอร์ด' }, 'p:map': { icon: '🗺️', label: 'แผนที่ / เส้นทาง' },
  'p:ems': { icon: '🚑', label: 'ตรวจรถ EMS' }, 'p:check': { icon: '✅', label: 'ตรวจสอบ / เช็คลิสต์' }, 'p:mile': { icon: '⏱️', label: 'เลขไมล์' },
  'p:cal': { icon: '📅', label: 'ตาราง / ปฏิทิน' }, 'p:swap': { icon: '🔄', label: 'สลับ / แลกเปลี่ยน' }, 'p:report': { icon: '🖨️', label: 'รายงาน' },
  'p:admin': { icon: '🛠️', label: 'ผู้ดูแลระบบ' }, 'p:form': { icon: '📝', label: 'แบบฟอร์ม / ขอใช้' }, 'p:login': { icon: '🔑', label: 'เข้าสู่ระบบ' },
  'p:page': { icon: '📄', label: 'หน้าทั่วไป' }, 'p:other': { icon: '📦', label: 'หน้าอื่นๆ รวมกัน' },
};
export const kindMeta = (k) => THEMES[k] || PAGE_KINDS[k] || PAGE_KINDS['p:page'];

// Order matters: the first rule that matches the last path segment wins. "ems" must not match inside words such as "carsystemsansai".
const PAGE_RULES = [
  ['p:login', /login|signin|เข้าสู่ระบบ|auth/], ['p:ems', /(^|[^a-z])ems/], ['p:dash', /dashboard|summary|overview|สรุป|แดชบอร์ด/], ['p:map', /map|route|แผนที่|เส้นทาง/],
  ['p:mile', /mile|odometer|ไมล์/], ['p:check', /check|inspect|ตรวจ/], ['p:cal', /table|schedule|calendar|roster|ตาราง|ปฏิทิน/], ['p:swap', /swap|exchange|แลก|สลับ/],
  ['p:report', /report|export|print|รายงาน/], ['p:admin', /admin|setting|manage|config|ตั้งค่า|จัดการ/], ['p:form', /form|request|booking|register|submit|new|ขอ|จอง|ลงทะเบียน|บันทึก/],
  ['p:home', /^(|index|home|main|default|หน้าแรก)$/],
];

/** Friendly Thai names for common file names (lower-case, without extension). Add your own here. */
export const PAGE_LABELS = {
  '': 'หน้าแรก', index: 'หน้าแรก', home: 'หน้าแรก', dashboard: 'แดชบอร์ด', startmile: 'บันทึกไมล์เริ่มต้น', endmile: 'บันทึกไมล์สิ้นสุด', editmile: 'แก้ไขเลขไมล์', check: 'ตรวจสภาพรถ',
  emscheck: 'ตรวจรถ EMS', worktable: 'ตารางงาน', swap: 'สลับ/แลกเปลี่ยน', routemap: 'แผนที่เส้นทาง', login: 'เข้าสู่ระบบ', admin: 'ผู้ดูแลระบบ', report: 'รายงาน', request: 'ขอใช้',
  booking: 'จอง', calendar: 'ปฏิทิน', schedule: 'ตารางเวลา', map: 'แผนที่', settings: 'ตั้งค่า', setting: 'ตั้งค่า', form: 'แบบฟอร์ม', history: 'ประวัติ', profile: 'โปรไฟล์', register: 'ลงทะเบียน', search: 'ค้นหา', submit: 'ยื่นเรื่อง',
};

/**
 * "/Sys/Index.html?x=1" → "/sys" — query dropped, index.html folded into its folder, trailing slash removed. A single-page-app route ("#/submit") is kept because
 * it IS the page. The Apps Script backend (anaPageKey) groups with exactly the same rule.
 */
export const pageKey = (p) => {
  let t = String(p || '/'); let hash = ''; const hi = t.indexOf('#');
  if (hi >= 0) { const hv = t.slice(hi); if (/^#!?\//.test(hv)) hash = hv.split('?')[0].toLowerCase().replace(/\/+$/, ''); t = t.slice(0, hi); }
  t = t.split('?')[0].toLowerCase(); if (t[0] !== '/') t = `/${t}`;
  t = t.replace(/\/index\.html?$/, '/'); t = t.length > 1 ? t.replace(/\/+$/, '') : t;
  return t + hash;
};
const lastSeg = (k) => { const hi = k.indexOf('#'); const seg = (hi >= 0 ? k.slice(hi + 1) : k).split('/').filter(Boolean); return (seg.length ? seg[seg.length - 1] : '').replace(/\.(html?|php|aspx?)$/, ''); };
const isFront = (k, rootPath) => k === '/' || (!!rootPath && rootPath !== '/' && k === pageKey(rootPath));

export function pageKind(path, rootPath = '') {
  const k = pageKey(path); if (isFront(k, rootPath)) return 'p:home';
  const n = lastSeg(k); for (const [id, re] of PAGE_RULES) if (re.test(n)) return id;
  return 'p:page';
}
export function pageLabel(path, rootPath = '') {
  const k = pageKey(path); if (isFront(k, rootPath)) return 'หน้าแรก';
  const n = lastSeg(k); if (PAGE_LABELS[n]) return PAGE_LABELS[n];
  const raw = lastSeg(String(path || '').split('?')[0].replace(/\/index\.html?$/i, '/')); const orig = raw.toLowerCase() === n ? raw : n;
  return orig.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').trim() || k;
}

const unit = (o) => ({ ...site({ key: o.key, name: o.name, url: o.path, status: 'active', track: true, pv: o.pv, uv: o.uv, prev: null, realtime: o.realtime, byHour: o.byHour }), path: o.path, kind: o.kind });
const hours24 = (a) => (arr(a).length === 24 ? a.map(num) : Array(24).fill(0));

/**
 * Backend answer of `projects/pages` → {days, site, uv, realtime, units[] (≤8: the busiest pages + "other"), flows[]} or null when it is not that answer.
 * A folder that other pages live under ("/carsystemsansai" when "/carsystemsansai/startmile.html" exists) is that system's front page.
 */
export function normalizePages(d) {
  if (!d || typeof d !== 'object' || !Array.isArray(d.pages)) return null;
  const s = d.site || {}; const root = (() => { try { return new URL(s.url).pathname; } catch { return ''; } })();
  const merged = new Map();
  for (const p of d.pages.filter((x) => x && x.path !== undefined)) {
    const key = pageKey(p.path); const m = merged.get(key);
    if (!m) merged.set(key, { key, path: key, pv: num(p.pv), uv: num(p.uv), realtime: num(p.realtime), byHour: hours24(p.byHour) });
    else { m.pv += num(p.pv); m.uv += num(p.uv); m.realtime += num(p.realtime); m.byHour = m.byHour.map((n, i) => n + num(hours24(p.byHour)[i])); }
  }
  const all = [...merged.values()];
  const isFolder = (k) => !/\.[a-z0-9]{2,5}$/.test(k) && all.some((o) => o.key !== k && o.key.startsWith(`${k === '/' ? '' : k}/`));
  const list = all.map((p) => { const front = isFront(p.key, root) || (isFolder(p.key) && !p.key.includes('#')); return { ...p, name: front ? 'หน้าแรก' : pageLabel(p.path, root), kind: front ? 'p:home' : pageKind(p.path, root) }; });
  const hasOther = d.other && num(d.other.pv) > 0;
  const units = list.sort((a, b) => b.pv - a.pv).slice(0, hasOther ? MAX_PAGES - 1 : MAX_PAGES).map(unit);
  if (hasOther) units.push(unit({ key: '*other', path: '*other', name: 'หน้าอื่นๆ', kind: 'p:other', pv: num(d.other.pv), uv: num(d.other.uv), realtime: num(d.other.realtime), byHour: hours24(d.other.byHour) }));
  const keys = new Set(units.map((u) => u.key)); const fk = (k) => (k === '*other' ? '*other' : pageKey(k));
  const flows = arr(d.flows).map((f) => ({ from: fk(f.from), to: fk(f.to), n: num(f.n) })).filter((f) => f.n > 0 && keys.has(f.from) && keys.has(f.to) && f.from !== f.to);
  return { days: num(d.days) || 30, site: { key: String(s.key || ''), name: String(s.name || ''), url: String(s.url || '') }, uv: num(d.uv) || units.reduce((a, u) => a + u.uv, 0),
    realtime: d.realtime === undefined || d.realtime === null ? units.reduce((a, u) => a + u.realtime, 0) : num(d.realtime), units, flows };
}

/** Fallback for a backend without `pages`: the `stats` answer has page totals but no per-page hours, so the site's 24-hour profile is shared out in proportion (approximate, no flows). */
export function pagesFromStats(st, days) {
  const pages = arr(st && st.pages); const tot = pages.reduce((a, p) => a + num(p.n), 0) || 1; const hrs = hours24(st && st.byHour);
  const mk = (n, u) => ({ pv: n, uv: u, realtime: 0, byHour: hrs.map((h) => Math.round((h * n) / tot)) });
  const top = pages.slice(0, 7); const rest = pages.slice(7);
  return { days, site: st && st.site ? { key: st.site.key, name: st.site.name, url: st.site.url } : {}, uv: st && st.uv, realtime: st && st.realtime,
    pages: top.map((p) => ({ path: p.name, ...mk(num(p.n), num(p.u)) })), other: rest.length ? mk(rest.reduce((a, p) => a + num(p.n), 0), rest.reduce((a, p) => a + num(p.u), 0)) : null, flows: [] };
}

/**
 * "Who goes where": one stop per page view. Real page-to-page transitions (`flows`, counted per visitor and day by the backend) decide how many views are
 * continuations of an earlier stop — those figures walk from room to room instead of entering again, so the number of stops stays the page-view count.
 * @returns {{id:number, enter:number, stops:{zone:number,start:number,end:number}[], exit:number}[]}
 */
export function pageJourneys(units, flows, days, perFig, c = DEFAULTS, seed = 71) {
  const r = rng(seed); const arrivals = [];
  units.forEach((u, zi) => u.byHour.forEach((n, hr) => {
    const e = n / Math.max(1, days) / perFig; let k = Math.floor(e) + (r() < e - Math.floor(e) ? 1 : 0);
    for (; k > 0; k--) arrivals.push({ zone: zi, at: hr * 60 + r() * 60 });
  }));
  arrivals.sort((a, b) => a.at - b.at || a.zone - b.zone);
  const idx = new Map(units.map((u, i) => [u.key, i])); const into = units.map(() => []); const inflow = units.map(() => 0);
  for (const f of arr(flows)) { const i = idx.get(f.from); const j = idx.get(f.to); if (i === undefined || j === undefined || i === j) continue; into[j].push({ i, n: num(f.n) }); inflow[j] += num(f.n); }
  const figs = []; const tails = units.map(() => []); let id = 0;
  for (const a of arrivals) {
    let host = null; const q = Math.min(0.8, inflow[a.zone] / Math.max(1, units[a.zone].pv));
    if (q > 0 && r() < q) {
      const opts = into[a.zone].map((o) => ({ o, cand: tails[o.i].filter((f) => { const l = f.stops[f.stops.length - 1]; const gap = a.at - (l.start + c.dwell); return gap >= 2 && gap <= c.walk + 45 && f.stops.length < 3; }) })).filter((x) => x.cand.length);
      if (opts.length) { let pick = r() * opts.reduce((t, x) => t + x.o.n, 0); let ch = opts[0]; for (const x of opts) { pick -= x.o.n; if (pick <= 0) { ch = x; break; } } host = ch.cand[ch.cand.length - 1]; }   // the most recent arrival: the shortest wait in the source room
    }
    if (host) {
      const l = host.stops[host.stops.length - 1]; tails[l.zone].splice(tails[l.zone].indexOf(host), 1);
      l.end = Math.max(l.start + c.dwell, a.at - c.walk); host.stops.push({ zone: a.zone, start: a.at, end: a.at + c.dwell }); host.exit = a.at + c.dwell + c.walk; tails[a.zone].push(host);
    } else { const f = { id: ++id, enter: a.at - c.walk, stops: [{ zone: a.zone, start: a.at, end: a.at + c.dwell }], exit: a.at + c.dwell + c.walk }; figs.push(f); tails[a.zone].push(f); }
  }
  return figs;
}

/** Where do people go next from each page: {pageKey: [{to, n}]} sorted by n. */
export function nextPages(units, flows) {
  const by = {}; units.forEach((u) => { by[u.key] = []; });
  for (const f of arr(flows)) if (by[f.from]) by[f.from].push({ to: f.to, n: f.n });
  Object.values(by).forEach((a) => a.sort((x, y) => y.n - x.n)); return by;
}
/** Where do people come from before each page. */
export function prevPages(units, flows) {
  const by = {}; units.forEach((u) => { by[u.key] = []; });
  for (const f of arr(flows)) if (by[f.to]) by[f.to].push({ from: f.from, n: f.n });
  Object.values(by).forEach((a) => a.sort((x, y) => y.n - x.n)); return by;
}

/** Plain-language findings about the pages of one system. */
export function pageInsights(units, flows, days) {
  const out = []; const tot = units.reduce((a, u) => a + u.pv, 0); const pct = (a, b) => Math.round((a / Math.max(1, b)) * 100); const name = (k) => (units.find((u) => u.key === k) || { name: k }).name;
  if (!tot) return [{ tone: 'info', text: 'ยังไม่มีการเปิดหน้าในระบบนี้ในช่วงที่เลือก — วางโค้ดติดตามในทุกหน้าของเว็บแล้วเปิดสักหน้า' }];
  const sorted = units.filter((u) => u.kind !== 'p:other').slice().sort((a, b) => b.pv - a.pv); const top = sorted[0];
  if (top) out.push({ tone: 'info', text: `หน้า “${top.name}” คนใช้มากสุด ${fmt(top.pv)} ครั้งใน ${days} วัน (${pct(top.pv, tot)}% ของทั้งระบบ)` });
  if (top && pct(top.pv, tot) >= 60 && sorted.length > 2) out.push({ tone: 'info', text: 'ผู้ใช้กระจุกอยู่ที่หน้าเดียวเป็นหลัก — หน้าอื่นอาจหาไม่เจอหรือไม่จำเป็น ลองทบทวนเมนูและลำดับการใช้งาน' });
  const nx = nextPages(units, flows); const best = [].concat(...Object.entries(nx).map(([from, a]) => a.map((x) => ({ from, ...x })))).sort((a, b) => b.n - a.n)[0];
  if (best && best.n >= 3) out.push({ tone: 'ok', text: `เส้นทางที่เดินบ่อยสุด: “${name(best.from)}” → “${name(best.to)}” (${fmt(best.n)} ครั้ง)` });
  const dead = sorted.filter((u) => u.pv >= 20 && flows.length && !(nx[u.key] || []).length && u.kind !== 'p:home');
  if (dead.length) out.push({ tone: 'info', text: `คนเปิด “${dead[0].name}” แล้วมักจบแค่นั้น (ไม่ไปต่อหน้าอื่น) — เป็นหน้าปลายทางตามปกติหรือไม่` });
  const front = units.find((u) => u.kind === 'p:home'); const hs = sorted.filter((u) => u.kind !== 'p:home' && u.pv > 0);
  if (front && hs[0] && front.pv > 0 && hs[0].pv > front.pv * 1.5) out.push({ tone: 'info', text: `หน้า “${hs[0].name}” ถูกเปิดมากกว่าหน้าแรกมาก — ผู้ใช้น่าจะเข้าผ่านลิงก์หรือบุ๊กมาร์กตรงๆ` });
  const quiet = units.filter((u) => u.pv === 0 && u.kind !== 'p:other'); if (quiet.length) out.push({ tone: 'warn', text: `ยังไม่มีคนเข้า: ${quiet.map((u) => u.name).join(', ')}` });
  const small = sorted.filter((u) => u.pv > 0 && pct(u.pv, tot) <= 2); if (small.length >= 2) out.push({ tone: 'info', text: `มี ${small.length} หน้าที่ใช้น้อยมาก (≤2%): ${small.slice(0, 3).map((u) => u.name).join(', ')} — พิจารณารวมหรือย้ายเมนู` });
  const hourly = Array(24).fill(0); units.forEach((u) => u.byHour.forEach((n, i) => { hourly[i] += n; })); const ph = hourly.indexOf(Math.max(...hourly));
  out.push({ tone: 'info', text: `ช่วงที่คนใช้ระบบนี้มากสุด ${pad(ph)}:00–${pad((ph + 1) % 24)}:00 น.` });
  return out;
}

export function pagesCsv(units, days, siteName) {
  const esc = (v) => { let t = String(v ?? ''); if (/^[=+\-@]/.test(t)) t = `'${t}`; return `"${t.replace(/"/g, '""')}"`; }; const tot = units.reduce((a, u) => a + u.pv, 0) || 1;
  return [['ระบบ', 'หน้า', 'พาธ', `เปิดหน้า (${days} วัน)`, 'สัดส่วน %', 'ผู้เข้าชม', 'ออนไลน์ตอนนี้'], ...units.map((u) => [siteName, u.name, u.path, u.pv, Math.round((u.pv / tot) * 100), u.uv, u.realtime])].map((r) => r.map(esc).join(',')).join('\r\n');
}

/** Demo pages: the real vehicle system for a fleet project (your own numbers), a generic set (home · form · report · dashboard · admin) for the others. */
export function makeSamplePages(s, days = 30, seed = 23) {
  const r = rng(seed + s.key.length * 7 + (s.key.charCodeAt(s.key.length - 1) || 0)); const prof = [1, 0, 0, 0, 1, 2, 4, 9, 16, 20, 18, 12, 9, 13, 17, 15, 11, 6, 4, 3, 2, 2, 1, 1]; const ps = prof.reduce((a, b) => a + b, 0);
  const hrs = (pv) => prof.map((w) => Math.round((w / ps) * pv * (0.85 + 0.3 * r())));
  const car = themeOf(s) === 'ems'; const base = '/demo';
  const defs = car
    ? [['/carsystemsansai/index.html', 232, 79, 1], ['/carsystemsansai/startmile.html', 240, 82, 1], ['/carsystemsansai/check.html', 115, 47, 0], ['/carsystemsansai/', 21, 15, 0], ['/carsystemsansai/worktable.html', 12, 8, 0],
      ['/carsystemsansai/dashboard.html', 10, 7, 0], ['/carsystemsansai/swap.html', 2, 2, 0], ['/carsystemsansai/routemap.html', 2, 2, 0], ['/carsystemsansai/emscheck.html', 1, 1, 0], ['/carsystemsansai/editmile.html', 1, 1, 0]]
    : [[`${base}/`, 0.4, 0.45, 1], [`${base}/form.html`, 0.25, 0.3, 0], [`${base}/report.html`, 0.15, 0.15, 0], [`${base}/dashboard.html`, 0.12, 0.1, 0], [`${base}/admin.html`, 0.08, 0.05, 0]];
  const pages = defs.map(([path, a, b, rt]) => { const pv = car ? a : Math.max(1, Math.round(s.pv * a)); return { path, pv, uv: car ? b : Math.max(1, Math.round(s.pv * b * 0.4)), realtime: rt && s.realtime ? 1 : 0, byHour: hrs(pv) }; });
  const other = null;
  const K = (i) => pageKey(pages[i].path); const q = (a, b, n) => ({ from: car && a === 0 ? '/carsystemsansai' : K(a), to: car && b === 0 ? '/carsystemsansai' : K(b), n: Math.round(n) });
  const flows = car ? [q(0, 1, 120), q(1, 2, 80), q(0, 4, 6), q(0, 5, 5), q(5, 4, 3), q(2, 5, 3), q(0, 6, 2), q(0, 7, 2), q(0, 8, 1), q(1, 9, 1)]
    : [q(0, 1, pages[1].pv * 0.5), q(1, 2, pages[2].pv * 0.4), q(0, 3, pages[3].pv * 0.4), q(3, 4, pages[4].pv * 0.3)];
  return { days, site: { key: s.key, name: s.name, url: s.url }, uv: pages.reduce((a, p) => a + p.uv, 0), realtime: s.realtime || 0, pages, other, flows };
}

/** Site-level visitors (overview) in the same shape as page journeys, so one renderer can draw both. */
export const asJourneys = (vis) => vis.map((v) => ({ id: v.id, enter: v.enter, stops: [{ zone: v.site, start: v.start, end: v.end }], exit: v.exit, back: !!v.back }));

/* ============================ replay of a REAL day (today / the busiest day) ============================ */

export const MAX_DAY_FIGURES = 360;
export const VISIT_GAP = 30;
export const MODES = [['typical', 'วันทั่วไป (เฉลี่ย)'], ['today', 'วันนี้'], ['peak', 'วันที่คนใช้มากสุด']];
export const MODE_IDS = MODES.map((m) => m[0]);
export const REPLAY_PRIVACY = 'แยก “ผู้ใช้ใหม่ / ผู้ใช้เดิม” ภายในวันเดียวกันเท่านั้น — รหัสผู้เข้าชมเป็นค่าแฮชที่เปลี่ยนทุกวัน จึงไม่สามารถตามรอยคนเดิมข้ามวัน ข้ามเว็บ หรือระบุตัวบุคคลได้ (ไม่เก็บ IP ไม่ใช้คุกกี้)';

/** Busiest day of `[{d:'YYYY-MM-DD', pv}]` (days without views never win; ties → the latest day). */
export function busiestDay(byDay) {
  let best = null;
  for (const x of arr(byDay)) { const pv = num(x.pv); const d = String(x.d); if (pv > 0 && (!best || pv > best.pv || (pv === best.pv && d > best.d))) best = { d, pv }; }
  return best;
}

/**
 * Backend answer of `projects/replay`: {mode, day, today, byDay:[{d,pv}], scale, sites:[{key, n, uv, fresh, back, ev:[[minute, visitor#, f]]}]}
 * f = 0 first view of that day · 1 return visit after > VISIT_GAP minutes · 2 another page of the same visit. visitor# is a running number, never the hash.
 */
export function normalizeReplay(d) {
  if (!d || typeof d !== 'object' || !Array.isArray(d.sites) || !/^\d{4}-\d\d-\d\d$/.test(String(d.day || ''))) return null;
  const scale = Math.max(1, num(d.scale) || 1); const sites = {};
  for (const s of d.sites) {
    if (!s || !s.key) continue;
    const ev = arr(s.ev).slice(0, 2000).map((e) => ({ m: num(e[0]), v: num(e[1]), f: Math.min(2, Math.max(0, Math.round(num(e[2])))) })).filter((e) => e.m >= 0 && e.m < 1440).sort((a, b) => a.m - b.m || a.v - b.v);
    const fresh = s.fresh === undefined ? ev.filter((e) => e.f === 0).length * scale : num(s.fresh); const back = s.back === undefined ? ev.filter((e) => e.f === 1).length * scale : num(s.back);
    sites[String(s.key)] = { n: s.n === undefined ? ev.length * scale : num(s.n), uv: s.uv === undefined ? fresh : num(s.uv), fresh, back, ev };
  }
  const byDay = arr(d.byDay).map((x) => ({ d: String(x.d), pv: num(x.pv) }));
  return { mode: d.mode === 'peak' ? 'peak' : 'today', day: String(d.day), today: String(d.today || ''), byDay, busiest: busiestDay(byDay), scale, sites };
}

export const dayLabel = (d) => { try { return new Date(`${d}T12:00:00+07:00`).toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); } catch { return d; } };
export const addDays = (d, n) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);

/** One walking person per VISIT (f=0 new, f=1 returning); pages of the same visit (f=2) only add to counters. Deterministic. */
export function replayVisitors(rep, sites, c = DEFAULTS, seed = 57) {
  const out = []; if (!rep) return out; let id = 0; const all = [];
  sites.forEach((s, si) => { const r = rep.sites[s.key]; if (r) for (const e of r.ev) if (e.f !== 2) all.push({ si, e }); });
  all.sort((a, b) => a.e.m - b.e.m || a.si - b.si || a.e.v - b.e.v);
  for (const { si, e } of all) { const at = e.m + rng(seed + si * 977 + e.v * 13 + e.m)(); out.push({ id: ++id, site: si, v: e.v, enter: at - c.walk, start: at, end: at + c.dwell, exit: at + c.dwell + c.walk, back: e.f === 1 }); }
  return out;
}

/** Replay window of a real day (≥ 3 h). Today stops around the current time. */
export function replayRange(vis, rep, nowMin = 1440, c = DEFAULTS) {
  const isToday = !!rep && rep.day === rep.today; const nowEnd = Math.min(1440, Math.ceil((nowMin + c.walk) / 60) * 60);
  let from; let to;
  if (vis.length) { from = Math.max(0, Math.floor(Math.min(...vis.map((v) => v.enter)) / 60) * 60); to = Math.min(1440, Math.ceil(Math.max(...vis.map((v) => v.exit)) / 60) * 60); } else { from = c.open; to = c.close; }
  if (isToday) { to = Math.min(to, nowEnd); if (!vis.length) from = Math.max(0, nowEnd - 180); }
  if (to - from < 180) { to = Math.min(1440, from + 180); from = Math.max(0, to - 180); }
  return { from, to };
}

export function cumViews(rep, key, t) {
  const s = rep && rep.sites[key]; if (!s) return 0; let n = 0; for (const e of s.ev) { if (e.m > t) break; n += 1; } return n * rep.scale;
}

export function dayStats(rep) {
  const hourly = Array(24).fill(0); let views = 0; let uv = 0; let fresh = 0; let back = 0; const per = [];
  for (const [key, s] of Object.entries(rep ? rep.sites : {})) {
    views += s.n; uv += s.uv; fresh += s.fresh; back += s.back; per.push({ key, views: s.n, uv: s.uv, fresh: s.fresh, back: s.back });
    for (const e of s.ev) hourly[Math.floor(e.m / 60)] += rep.scale;
  }
  const visits = fresh + back; const peakHour = views ? hourly.indexOf(Math.max(...hourly)) : -1;
  per.sort((a, b) => b.views - a.views);
  return { views, uv, fresh, back, visits, backPct: visits ? Math.round((back / visits) * 100) : 0, hourly, peakHour, per, top: per[0] && per[0].views ? per[0] : null };
}

export function compareToPeak(byDay, today) {
  const peak = busiestDay(byDay); if (!peak) return null;
  const t = arr(byDay).find((x) => String(x.d) === today); const todayPv = t ? num(t.pv) : 0;
  return { peakDay: peak.d, peakPv: peak.pv, today, todayPv, pct: Math.round((todayPv / peak.pv) * 100), isPeak: peak.d === today };
}

export function replayInsights(rep, st, names = {}) {
  if (!rep) return [];
  const out = []; const cmp = compareToPeak(rep.byDay, rep.today); const isToday = rep.day === rep.today; const nm = (k) => names[k] || k;
  if (!st.views) {
    out.push({ tone: 'info', text: `${isToday ? 'วันนี้ (ถึงขณะนี้)' : dayLabel(rep.day)} ยังไม่มีการเปิดหน้าในโครงการที่ติดตาม` });
  } else {
    out.push({ tone: 'info', text: `${isToday ? 'วันนี้ (ถึงขณะนี้)' : dayLabel(rep.day)} มีการเปิดหน้า ${fmt(st.views)} ครั้ง จากผู้เข้าชม ${fmt(st.uv)} คน` });
    out.push({ tone: st.backPct >= 30 ? 'ok' : 'info', text: `ผู้ใช้ใหม่ ${fmt(st.fresh)} ครั้งที่เข้า · ผู้ใช้เดิมที่กลับมาใหม่ในวันเดียวกัน ${fmt(st.back)} ครั้ง (${st.backPct}%)${st.backPct >= 30 ? ' — เป็นงานที่คนกลับมาใช้ซ้ำทั้งวัน ลองทำทางลัดหรือบุ๊กมาร์กให้เปิดง่ายขึ้น' : ''}` });
    if (st.top) out.push({ tone: 'info', text: `${nm(st.top.key)} มีคนเปิดมากสุด ${fmt(st.top.views)} ครั้ง (${Math.round((st.top.views / st.views) * 100)}% ของวันนั้น)` });
    if (st.peakHour >= 0) out.push({ tone: 'info', text: `ช่วงที่คนเข้ามากสุด ${pad(st.peakHour)}:00–${pad((st.peakHour + 1) % 24)}:00 น.` });
  }
  if (cmp) {
    if (isToday) out.push(cmp.isPeak ? { tone: 'ok', text: 'วันนี้เป็นวันที่มีคนใช้มากที่สุดในช่วงที่ตรวจแล้ว' } : { tone: cmp.pct >= 100 ? 'ok' : 'info', text: `วันนี้ถึงขณะนี้ ${fmt(cmp.todayPv)} ครั้ง ≈ ${cmp.pct}% ของวันที่คนใช้มากสุด (${dayLabel(cmp.peakDay)} · ${fmt(cmp.peakPv)} ครั้ง)` });
    else out.push({ tone: 'info', text: `วันที่คนใช้มากสุดในช่วงที่ตรวจคือ ${dayLabel(cmp.peakDay)} · วันนี้ถึงขณะนี้ ${fmt(cmp.todayPv)} ครั้ง ≈ ${cmp.pct}% ของวันนั้น` });
  }
  out.push({ tone: 'info', text: REPLAY_PRIVACY });
  return out;
}

export function replayCsv(rep, all) {
  const esc = (v) => { let t = String(v ?? ''); if (/^[=+\-@]/.test(t)) t = `'${t}`; return `"${t.replace(/"/g, '""')}"`; };
  const rows = [['วันที่', 'โครงการ', 'เปิดหน้า', 'ผู้เข้าชม', 'ผู้ใช้ใหม่ (ครั้งแรกของวัน)', 'ผู้ใช้เดิมกลับมา (ในวันเดียวกัน)'], ...all.filter((s) => rep.sites[s.key]).map((s) => { const r = rep.sites[s.key]; return [rep.day, s.name, r.n, r.uv, r.fresh, r.back]; })];
  return rows.map((r) => r.map(esc).join(',')).join('\r\n');
}

/** Demo replay (same seed ⇒ same day). */
export function makeSampleReplay(all, mode = 'today', today = '2026-10-13', nowMin = 1440, seed = 29) {
  const r = rng(seed + (mode === 'peak' ? 5 : 0)); const day = mode === 'peak' ? addDays(today, -3) : today; const limit = day === today ? Math.max(30, Math.min(1439, Math.floor(nowMin))) : 1439;
  const prof = [1, 0, 0, 0, 1, 2, 4, 9, 16, 20, 18, 12, 9, 13, 17, 15, 11, 6, 4, 3, 2, 2, 1, 1]; const cdf = []; prof.reduce((a, w, i) => { cdf[i] = a + w; return a + w; }, 0);
  const pickHour = () => { const x = r() * cdf[23]; return cdf.findIndex((c) => x < c); };
  const live = all.filter((s) => stateOf(s) === 'ok' && s.pv > 0); let base = 0;
  const sites = live.map((s) => {
    const daily = s.pv / 30; base += daily * 0.27; const F = Math.max(2, Math.round(daily * 0.12 * (mode === 'peak' ? 1.5 : 1))); const ev = []; let back = 0; let fresh = 0;
    for (let v = 0; v < F; v++) {
      const m0 = Math.floor(pickHour() * 60 + r() * 60); if (m0 > limit) continue; fresh += 1; ev.push([m0, v, 0]);
      const more = r() < 0.55 ? 1 + Math.floor(r() * 3) : 0; for (let k = 1; k <= more; k++) if (m0 + k * 2 <= limit) ev.push([m0 + k * 2, v, 2]);
      if (r() < 0.32) { const m1 = m0 + 45 + Math.floor(r() * 255); if (m1 <= limit && m1 < 1440) { back += 1; ev.push([m1, v, 1]); if (r() < 0.4 && m1 + 2 <= limit) ev.push([m1 + 2, v, 2]); } }
    }
    ev.sort((a, b) => a[0] - b[0]); return { key: s.key, n: ev.length, uv: fresh, fresh, back, ev };
  });
  const total = sites.reduce((a, s) => a + s.n, 0); const peakDay = addDays(today, -3);
  const byDay = Array.from({ length: 30 }, (_, i) => { const d = addDays(today, i - 29); const wk = [0.35, 0.95, 1, 0.95, 0.9, 0.85, 0.3][new Date(`${d}T12:00:00Z`).getUTCDay()]; const pv = d === peakDay ? Math.round(base * 1.6) : d === today ? (day === today ? total : Math.round(base * 0.5)) : Math.round(base * 0.9 * wk * (0.85 + 0.3 * r())); return { d, pv }; });
  if (day === peakDay) byDay.find((x) => x.d === day).pv = Math.max(total, byDay.find((x) => x.d === day).pv);
  return { mode: mode === 'peak' ? 'peak' : 'today', day, today, byDay, scale: 1, sites };
}
