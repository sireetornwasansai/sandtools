// Engine for the 3D home page: one station per monitored project/website. Turns the backend's per-project statistics
// (pageviews, previous period, "online now", 24-hour profile) into a replayable "typical day", plain-language insights and a CSV.
// Pure functions, no DOM → unit-testable. Insights are simple arithmetic computed in the browser (no language model, nothing leaves the device).

export const MAX_SITES = 8;       // stations on the floor (the rest are listed below)
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
  return { key: String(s.key || ''), name: String(s.name || s.key || '-'), url: String(s.url || ''), status: String(s.status || 'active'), track: s.track !== false, pv: num(s.pv), prev: s.prev === undefined || s.prev === null ? null : num(s.prev),
    uv: num(s.uv), realtime: s.realtime === null || s.realtime === undefined ? null : num(s.realtime), last: s.last || '', byHour };
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
    return site({ key: p.key, name: p.name, url: p.url, status: p.status, track: p.track, pv: st ? st.pv : p.pv7, uv: st ? st.uv : p.uv7, prev: undefined, realtime: st ? st.realtime : null, byHour: st ? st.byHour : [], last: st ? st.last : p.last ? new Date(p.last).toISOString() : '' });
  });
  return { days, total: out.length, sites: out };
}

/** Busiest projects first; quiet ones last. Returns the stations to draw and how many projects did not fit. */
export function pickSites(all) {
  const s = all.filter((x) => x.status !== 'deleted').slice().sort((a, b) => b.pv - a.pv || a.name.localeCompare(b.name, 'th'));
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
export function timeRange(vis, c = DEFAULTS) {
  if (!vis.length) return { from: c.open, to: c.close };
  const first = Math.min(...vis.map((v) => v.start)); const last = Math.max(...vis.map((v) => v.start));
  return { from: Math.max(0, Math.min(c.open, Math.floor((first - c.walk) / 60) * 60)), to: Math.min(1440, Math.max(c.close, Math.ceil((last + c.dwell + c.walk) / 60) * 60)) };
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
  const defs = [['เว็บไซต์โรงพยาบาล', 'https://hospital.example.org', 420, 1.0, 'ok'], ['ระบบนัดหมายออนไลน์', 'https://appoint.example.org', 300, 1.2, 'ok'], ['ระบบรายงานตัวชี้วัด', 'https://kpi.example.org', 150, 0.8, 'ok'],
    ['แบบประเมินความพึงพอใจ', 'https://survey.example.org', 90, 0.7, 'ok'], ['ข่าวประชาสัมพันธ์', 'https://news.example.org', 60, 0, 'silent'], ['คู่มือผู้ป่วย (ฉบับร่าง)', 'https://guide.example.org', 0, 0, 'idle']];
  const sites = defs.map(([name, url, perDay, trend, kind], i) => {
    const byHour = prof.map((w) => (kind === 'silent' ? (r(), 0) : Math.round(((w * perDay * days) / 160) * (0.8 + 0.4 * r())))); const pv = byHour.reduce((a, b) => a + b, 0);
    const prev = kind === 'silent' ? 120 : kind === 'idle' ? 0 : Math.round(pv / (trend === 0 ? 1 : trend)); return site({ key: `demo${i}`, name, url, status: 'active', track: true, pv, prev, uv: Math.round(pv * 0.42), realtime: pv ? Math.round(r() * 4) : 0, last: '', byHour });
  });
  return { days, total: sites.length, sites, extra: { devices: [{ name: 'mobile', n: 520 }, { name: 'desktop', n: 330 }], referrers: [{ name: '', n: 410 }, { name: 'facebook.com', n: 160 }],
    byDay: Array.from({ length: Math.min(days, 14) }, (_, i) => ({ d: String(i), pv: Math.round(300 + 120 * Math.sin(i / 2) + r() * 60) })) } };
}
