// Monitor page — the parts that need no DOM (labels, filters ↔ URL ↔ backend params, grouping, copy text, install snippets). Unit tested.

export const KIND = { er: 'ข้อผิดพลาด', lg: 'บันทึก', tk: 'งาน', hc: 'สถานะเว็บ', ev: 'เหตุการณ์ผู้ใช้', pv: 'เปิดหน้า' };
export const KIND_ORDER = ['er', 'tk', 'lg', 'hc', 'ev', 'pv'];
export const DEFAULT_KINDS = ['er', 'tk', 'lg', 'hc', 'ev'];
export const LEVEL = { error: 'ผิดพลาด', warn: 'เตือน', info: 'ข้อมูล' };
export const HOURS = [[1, '1 ชม.'], [6, '6 ชม.'], [24, '24 ชม.'], [168, '7 วัน'], [720, '30 วัน']];
export const LEVEL_FILTERS = [['', 'ทั้งหมด'], ['problem', 'เฉพาะปัญหา'], ['error', 'เฉพาะผิดพลาด']];
export const TASK_STATUS = { start: 'เริ่ม', ok: 'สำเร็จ', fail: 'ล้มเหลว' };

/** rank = how urgent (0 first). */
export const STATE = {
  down: { label: 'เข้าเว็บไม่ได้', rank: 0 }, error: { label: 'มีข้อผิดพลาด', rank: 1 }, warn: { label: 'ควรตรวจสอบ', rank: 2 },
  wait: { label: 'รอข้อมูลแรก', rank: 3 }, ok: { label: 'ปกติ', rank: 4 }, off: { label: 'ปิดเก็บ', rank: 5 }
};
const TZ = 'Asia/Bangkok';

/** Most urgent first; inside a state the one with more recent problems first, then by name. */
export function sortFleet(items) {
  return items.slice().sort((a, b) => (STATE[a.state] || STATE.ok).rank - (STATE[b.state] || STATE.ok).rank || (b.err24 - a.err24) || String(a.name).localeCompare(String(b.name), 'th'));
}
export function stateCounts(items) {
  const c = { down: 0, error: 0, warn: 0, wait: 0, ok: 0, off: 0 };
  for (const p of items) if (c[p.state] !== undefined) c[p.state] += 1;
  return c;
}

export function fmtDuration(ms) {
  const n = Number(ms) || 0;
  if (n <= 0) return '';
  if (n < 1000) return `${Math.round(n)} ms`;
  if (n < 60000) return `${(n / 1000).toFixed(n < 10000 ? 1 : 0).replace(/\.0$/, '')} วินาที`;
  const m = Math.floor(n / 60000); const s = Math.round((n % 60000) / 1000);
  return s ? `${m} นาที ${s} วินาที` : `${m} นาที`;
}
export const fmtClock = (ts) => new Date(ts).toLocaleTimeString('th-TH', { timeZone: TZ, hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
export const fmtFull = (ts) => new Date(ts).toLocaleString('th-TH', { timeZone: TZ, hour12: false, day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const dayKey = (ts) => new Date(ts + 7 * 3600e3).toISOString().slice(0, 10);
/** "วันนี้" / "เมื่อวาน" / "9 พ.ย. 2569" (Thailand day). */
export function dayHeading(ts, now = Date.now()) {
  const k = dayKey(ts);
  if (k === dayKey(now)) return 'วันนี้';
  if (k === dayKey(now - 86400000)) return 'เมื่อวาน';
  return new Date(ts).toLocaleDateString('th-TH', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' });
}
/** Consecutive events of the same Thailand day → [{label, items}] (keeps the order it was given). */
export function groupByDay(items, now = Date.now()) {
  const out = [];
  for (const e of items) {
    const k = dayKey(e.t); const last = out[out.length - 1];
    if (last && last.k === k) last.items.push(e); else out.push({ k, label: dayHeading(e.t, now), items: [e] });
  }
  return out;
}

/** Why a project is not "ปกติ", in words (the backend only sends codes). */
export function explain(p) {
  const out = [];
  const r = new Set(p.reasons || []);
  if (r.has('down')) out.push(p.health && p.health.code ? `เข้าเว็บไม่ได้ (HTTP ${p.health.code})` : 'เข้าเว็บไม่ได้ (ไม่มีการตอบกลับ)');
  if (r.has('err1h')) out.push(`มีข้อผิดพลาด ${p.err1h} ครั้งในชั่วโมงที่ผ่านมา`);
  else if (r.has('err24')) out.push(`มีข้อผิดพลาด ${p.err24} ครั้งใน 24 ชม.`);
  if (r.has('taskfail')) out.push(`งานล้มเหลว ${p.fail24} ครั้งใน 24 ชม.`);
  if (r.has('quiet')) out.push('เงียบผิดปกติ — ไม่มีคนเข้าเกิน 24 ชม. ทั้งที่ปกติมี');
  if (r.has('slow')) out.push('เว็บตอบช้า (เกิน 8 วินาที)');
  if (r.has('nodata')) out.push('ยังไม่มีข้อมูลเข้ามา');
  return out;
}

/* ------------------------------- filters ------------------------------- */

export const defaultFilters = () => ({ site: '', level: '', kinds: DEFAULT_KINDS.slice(), hours: 24, q: '', fp: '', tab: 'feed' });

/** "#/monitor?site=…&level=problem&kinds=er,tk&hours=168&q=…&fp=…&tab=issues" → filters (anything invalid falls back to the default). */
export function parseFilters(params) {
  const f = defaultFilters(); const g = (k) => (params && typeof params.get === 'function' ? params.get(k) : null) || '';
  if (/^p[a-z0-9]{9}$/.test(g('site'))) f.site = g('site');
  if (['problem', 'error', 'warn', 'info'].includes(g('level'))) f.level = g('level');
  const kinds = g('kinds').split(',').filter((k) => KIND_ORDER.includes(k));
  if (kinds.length) f.kinds = KIND_ORDER.filter((k) => kinds.includes(k));
  const hrs = Number(g('hours')); if (HOURS.some(([n]) => n === hrs)) f.hours = hrs;
  f.q = g('q').slice(0, 60);
  if (/^[a-z0-9]{1,10}$/.test(g('fp'))) f.fp = g('fp');
  if (g('tab') === 'issues') f.tab = 'issues';
  return f;
}
/** Only what differs from the default goes in the address (short, shareable links). */
export function filtersToParams(f) {
  const d = defaultFilters(); const p = {};
  if (f.site) p.site = f.site;
  if (f.level) p.level = f.level;
  if (f.kinds.join() !== d.kinds.join()) p.kinds = f.kinds.join(',');
  if (f.hours !== d.hours) p.hours = String(f.hours);
  if (f.q) p.q = f.q;
  if (f.fp) p.fp = f.fp;
  if (f.tab !== 'feed') p.tab = f.tab;
  return p;
}
/** Filters → the parameters of backend op "feed". */
export function feedParams(f, extra = {}) {
  const p = { kinds: f.kinds.join(','), hours: f.hours, limit: 60, ...extra };
  if (f.site) p.key = f.site;
  if (f.level) p.level = f.level;
  if (f.q) p.q = f.q;
  if (f.fp) p.fp = f.fp;
  return p;
}
export function activeFilterCount(f) {
  const d = defaultFilters();
  return (f.site ? 1 : 0) + (f.level ? 1 : 0) + (f.kinds.join() !== d.kinds.join() ? 1 : 0) + (f.q ? 1 : 0) + (f.fp ? 1 : 0);
}

/* ------------------------------ event text ------------------------------ */

const clock = (ts) => `${fmtFull(ts)} (เวลาไทย)`;
/** One event as plain text (copy into a chat / ticket). Never includes the visitor code. */
export function eventText(e, opts = {}) {
  const lines = [`โครงการ: ${e.site}`, `เวลา: ${clock(e.t)}`, `ชนิด: ${KIND[e.kind] || e.kind} · ระดับ: ${LEVEL[e.level] || e.level}`];
  if (e.name) lines.push(`${e.kind === 'tk' ? 'งาน' : 'ชื่อ'}: ${e.name}`);
  if (e.status) lines.push(`สถานะ: ${TASK_STATUS[e.status] || e.status}${e.ms ? ` (${fmtDuration(e.ms)})` : ''}`);
  if (e.msg) lines.push(`ข้อความ: ${e.msg}`);
  if (e.page) lines.push(`หน้า: ${e.page}`);
  const env = [e.device, e.browser, e.os].filter(Boolean).join(' · '); if (env) lines.push(`อุปกรณ์: ${env}`);
  if (e.x) lines.push(`ข้อมูลเพิ่ม: ${e.x}`);
  if (opts.total) lines.push(`เกิดซ้ำ: ${opts.total} ครั้ง${opts.days ? ` ใน ${opts.days} วัน` : ''}`);
  if (e.fp) lines.push(`รหัสกลุ่ม: ${e.fp}`);
  return lines.join('\n');
}

/** The one line shown for an event in lists. */
export function headline(e) {
  if (e.kind === 'pv') return e.page || e.name || '/';
  if (e.kind === 'ev') return e.name;
  if (e.kind === 'tk') return e.name + (e.msg ? ` — ${e.msg}` : '');
  return e.msg || e.name;
}

/* ------------------------------ install snippets ------------------------------ */

/** Code to paste into a website (browser) and into an Apps Script web app (server). `origin` = where t.js / api/collect live. */
export function logSnippets(origin, key, host) {
  const o = String(origin || '').replace(/\/+$/, '');
  const web = [
    '// ต้องวางโค้ดติดตั้ง t.js ของโครงการนี้ก่อน (แท็บ "ติดตั้ง") — ข้อผิดพลาดของหน้าเว็บถูกจับให้เองแล้ว',
    "sandLog('warn', 'ส่งฟอร์มช้า', { step: 'upload' });      // บันทึก 1 บรรทัด: 'info' | 'warn' | 'error'",
    "var done = sandTask('ส่งหนังสือเวียน');                    // เริ่มจับเวลางาน",
    'done();                                                  // สำเร็จ   หรือ   done(false, \'เหตุผลสั้น ๆ\');  = ล้มเหลว'
  ].join('\n');
  const server = [
    '// Apps Script ของเว็บนั้น: วางไว้ 1 ครั้ง แล้วเรียกจากฟังก์ชัน/ทริกเกอร์ใดก็ได้',
    'function sandLog(level, message, o) {   // level: info | warn | error · o = { task, status: \'start\'|\'ok\'|\'fail\', ms }',
    '  try {',
    `    UrlFetchApp.fetch('${o}/api/collect', { method: 'post', contentType: 'text/plain', muteHttpExceptions: true,`,
    `      payload: JSON.stringify({ k: '${key}', t: 'lg', h: '${host || 'ชื่อโดเมนของเว็บนี้'}', c: o && o.task ? 'tk' : 'lg', v: level, m: message, e: o && o.task, s: o && o.status, d: o && o.ms }) });`,
    '  } catch (e) { /* บันทึกไม่สำเร็จต้องไม่ทำให้งานหลักล้ม */ }',
    '}',
    '',
    '// ตัวอย่างงานตั้งเวลา',
    'function nightlySync() {',
    '  var t0 = Date.now();',
    '  try { /* …งานจริง… */ sandLog(\'info\', \'ซิงก์เสร็จ\', { task: \'ซิงก์ข้อมูลรายคืน\', status: \'ok\', ms: Date.now() - t0 }); }',
    '  catch (e) { sandLog(\'error\', String(e.message || e), { task: \'ซิงก์ข้อมูลรายคืน\', status: \'fail\', ms: Date.now() - t0 }); throw e; }',
    '}'
  ].join('\n');
  return { web, server };
}
