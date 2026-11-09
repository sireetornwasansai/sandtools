/**
 * SAND Office Tools — Projects & website statistics (โครงการและสถิติเว็บไซต์).
 *
 * A "project" is a website / system / campaign the office wants to measure. It gets a public site key and a tiny tracking
 * snippet (served by Vercel as /t.js). Visits are sent to the edge function /api/collect, which forwards them here.
 * Short links (Links.gs) can be attached to a project so one dashboard shows both website visits and link clicks.
 *
 * Public part (no login, secret-protected):
 *   POST {action:"hit", secret, …}     one page view / event — only the edge function (which holds EDGE_SECRET) may call it
 * Signed-in part:
 *   POST {action:"projects", session, op: list | names | create | update | delete | stats | monitor | feed | issues | around}
 *   monitor / feed / issues / around = หน้า #/monitor (ดูท้ายไฟล์ "Monitor")
 *
 * Sheet tabs:  Sites (one row per project)  ·  Hits (one row per page view or event, newest at the bottom)
 *
 * Privacy (PDPA): no cookies, no IP address, no query strings. Stored per visit: time, page path, referring host, country,
 * device class, browser, OS, language, utm_source and a ONE-WAY hash that changes every day (so visitors are counted per day
 * and cannot be followed across days or across sites). Robots are flagged and not counted. Hits older than ANA_RETENTION_DAYS
 * (default 400) are deleted every night by anaPruneJob.
 *
 * Performance: hits are buffered in the script cache and written to the sheet in one batch (every 40 hits or every minute by
 * anaFlushJob), so a visit costs a few milliseconds instead of a sheet write.
 *
 * Script properties (all optional):  ANA_RATE_PER_MIN (per site, default 300) · ANA_MAX_PER_USER (default 50) · ANA_RETENTION_DAYS
 * Uses helpers from Code.gs / Links.gs / Library.gs.
 */

var ANA_SITE_HEADERS = ['รหัสไซต์ (key)', 'ชื่อโครงการ', 'เว็บไซต์', 'โดเมนที่อนุญาต', 'เจ้าของ', 'สร้างเมื่อ', 'สถานะ', 'คำอธิบาย', 'แท็ก', 'เก็บสถิติ'];
var ANA_HIT_HEADERS = ['เวลา', 'รหัสไซต์', 'ชนิด', 'หน้า / เหตุการณ์', 'มาจาก', 'ประเทศ', 'อุปกรณ์', 'เบราว์เซอร์', 'ระบบ', 'ผู้เข้าชม (hash รายวัน)', 'ภาษา', 'utm', 'บอท'];
var ANA_SCAN_ROWS = 80000;
var ANA_BUF_KEY = 'ah:buf';
var ANA_BUF_MAX = 40;
var ANA_DEVICES = ['mobile', 'desktop', 'tablet', 'bot', 'other'];

/* --------------------------------- helpers --------------------------------- */

function anaKeyOk(k) { return /^p[a-z0-9]{9}$/.test(String(k || '')); }
function anaObj(r, row) {
  return { row: row, key: String(r[0]), name: String(r[1] || ''), url: String(r[2] || ''), domains: String(r[3] || '').split(',').map(function (d) { return d.trim().toLowerCase(); }).filter(Boolean),
    owner: String(r[4] || '').toLowerCase(), created: String(r[5] || ''), status: String(r[6] || 'active'), note: String(r[7] || ''), tags: libTags(String(r[8] || '')), track: String(r[9]) !== 'FALSE' };
}
function anaRowOf(s) { return [s.key, lnkText(s.name, 120), s.url, s.domains.join(', '), s.owner, s.created, s.status, lnkText(s.note, 300), s.tags.join(', '), s.track ? 'TRUE' : 'FALSE']; }
function anaAll() {
  var sh = sheetTab('Sites', ANA_SITE_HEADERS), last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, 10).getValues().map(function (r, i) { return anaObj(r, i + 2); }).filter(function (s) { return s.key; });
}
function anaFind(key) {
  var all = anaAll();
  for (var i = 0; i < all.length; i++) if (all[i].key === key) return all[i];
  return null;
}
function anaPublic(s, x) {
  x = x || {};
  return { key: s.key, name: s.name, url: s.url, domains: s.domains, owner: s.owner, created: s.created, status: s.status, note: s.note, tags: s.tags, track: s.track,
    pv7: x.pv7 || 0, uv7: x.uv7 || 0, last: x.last || 0, links: x.links || 0, linkClicks: x.linkClicks || 0, qrs: x.qrs || 0, err24: x.err24 || 0, health: x.health || '' };
}
function anaUncache(key) { try { CacheService.getScriptCache().remove('as:' + key); } catch (x) { /* ignore */ } }
function anaLog(u, op, key, extra) {
  try { sheetTab('Logs', LOG_HEADERS).appendRow([new Date(), Utilities.getUuid().slice(0, 8), u.email, 'projects', op, 'ok', cell(key, 200), 0, 0, cell(JSON.stringify(extra || {}), 500)]); } catch (x) { console.error('anaLog ' + x); }
}
/** Hostnames only: accepts "example.com", "https://www.example.com/path", "*.example.com". */
function anaDomains(list) {
  var out = [], seen = Object.create(null);
  String(Array.isArray(list) ? list.join(',') : list || '').split(/[,\s]+/).forEach(function (d) {
    d = d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^\*\./, '').replace(/[\/?#].*$/, '').replace(/:\d+$/, '').replace(/^www\./, '');
    if (!d) return;
    if (!/^[a-z0-9]([a-z0-9.\-]*[a-z0-9])?$/.test(d) || d.length > 100) throw httpError('BAD_DOMAIN', 'โดเมน “' + d + '” ไม่ถูกต้อง (ใช้ตัวอักษรอังกฤษ ตัวเลข จุด และขีด)');
    if (!seen[d]) { seen[d] = true; out.push(d); }
  });
  return out.slice(0, 10);
}
function anaHostMatches(domains, host) {
  host = String(host || '').toLowerCase().replace(/^www\./, '');
  if (!host) return false;
  for (var i = 0; i < domains.length; i++) if (host === domains[i] || host.slice(-(domains[i].length + 1)) === '.' + domains[i]) return true;
  return false;
}
function anaHostOfUrl(url) { var m = /^https?:\/\/([^\/?#:]*)/i.exec(String(url || '')); return m ? m[1].toLowerCase().replace(/^www\./, '') : ''; }

/** The project, if it exists, is not deleted and belongs to the user (or the user is an admin). */
function anaOwned(sc, key) {
  key = String(key || '');
  var s = anaKeyOk(key) ? anaFind(key) : null;
  if (!s || s.status === 'deleted' || (!sc.admin && s.owner !== sc.email)) throw httpError('NOT_FOUND', 'ไม่พบโครงการนี้ หรือไม่มีสิทธิ์เข้าถึง');
  return s;
}

/* ------------------------------ collecting hits ------------------------------ */

function anaSmall(v, max, re) { return String(v == null ? '' : v).replace(re || /[\u0000-\u001f\u007f]/g, '').slice(0, max); }

/** One page view or event. Only the edge function (which holds EDGE_SECRET) may call this. */
function anaHit(b) {
  var secret = prop('EDGE_SECRET');
  if (!secret || !safeEqual(String(b.secret || ''), secret)) throw httpError('FORBIDDEN', 'ไม่อนุญาต');
  var key = String(b.k || '');
  if (!anaKeyOk(key)) return { ok: false };
  var cache = CacheService.getScriptCache(), hit = cache.get('as:' + key), rec = null;
  if (hit) { try { rec = JSON.parse(hit); } catch (x) { rec = null; } }
  if (!rec) {
    var s = anaFind(key);
    rec = s ? { d: s.domains, on: s.track && s.status === 'active' ? 1 : 0 } : { n: 1 };
    cache.put('as:' + key, JSON.stringify(rec), rec.n ? 300 : 21600);
  }
  if (rec.n || !rec.on) return { ok: false };
  var host = String(b.host || '').toLowerCase();
  if (host ? !anaHostMatches(rec.d, host) : b.src !== 'px') return { ok: false, reason: 'domain' };
  var rk = 'ar:' + key + ':' + Math.floor(Date.now() / 60000), n = Number(cache.get(rk) || 0) + 1;
  cache.put(rk, String(n), 120);
  if (n > intProp('ANA_RATE_PER_MIN', 300)) return { ok: false, reason: 'rate' };
  if (b.t === 'lg') return anaEventHit(key, b);   // log / error / task → Events tab (Monitor section)
  var type = b.t === 'ev' ? 'ev' : 'pv';
  var name = type === 'ev' ? anaSmall(b.e, 60) : anaSmall(b.p, 200) || '/';
  if (!name) return { ok: false };
  var device = ANA_DEVICES.indexOf(b.device) >= 0 ? b.device : 'other';
  var row = [Date.now(), key, type, name, /^[a-z0-9.\-]{1,80}$/i.test(String(b.ref || '')) ? String(b.ref).toLowerCase() : '', /^[A-Z]{2}$/.test(String(b.country || '')) ? b.country : '', device,
    anaSmall(b.browser, 24, /[^\w .\-]/g), anaSmall(b.os, 24, /[^\w .\-]/g), /^[0-9a-f]{8,16}$/.test(String(b.vid || '')) ? 'v' + b.vid : '', /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})?$/.test(String(b.lang || '')) ? String(b.lang).toLowerCase() : '',
    anaSmall(b.utm, 40, /[^\w .\-]/g), b.bot ? 1 : 0];
  anaBuffer(row);
  return { ok: true };
}

/** Rows wait in the cache (under a lock) and are written to the sheet in one batch. A failed write puts the rows back instead of losing them. */
function anaBuffer(row) {
  var lock = LockService.getScriptLock(), cache = CacheService.getScriptCache(), held = false;
  try { lock.waitLock(4000); held = true; } catch (e) { held = false; }
  if (!held) { try { anaWrite([row]); } catch (e2) { console.error('anaBuffer ' + e2); } return; }   // lock timeout: write directly
  try {
    var buf = []; try { buf = JSON.parse(cache.get(ANA_BUF_KEY) || '[]'); } catch (x) { buf = []; }
    buf.push(row);
    if (buf.length >= ANA_BUF_MAX) {
      try { anaWrite(buf); cache.remove(ANA_BUF_KEY); } catch (we) { console.error('anaBuffer write ' + we); cache.put(ANA_BUF_KEY, JSON.stringify(buf.slice(-400)), 21600); }
    } else cache.put(ANA_BUF_KEY, JSON.stringify(buf), 21600);
  } finally { try { lock.releaseLock(); } catch (x) { /* not held */ } }
}
function anaWrite(rows) {
  if (!rows.length) return;
  var sh = sheetTab('Hits', ANA_HIT_HEADERS), at = sh.getLastRow() + 1;
  sh.getRange(at, 1, rows.length, ANA_HIT_HEADERS.length).setValues(rows);
}
/** Write whatever is waiting in the buffer (called before every statistics read and by the 1-minute trigger). Never throws for a busy lock. */
function anaFlush() {
  var lock = LockService.getScriptLock(), cache = CacheService.getScriptCache();
  try { lock.waitLock(8000); } catch (e) { return 0; }
  try {
    var raw = cache.get(ANA_BUF_KEY); if (!raw) return 0;
    var buf = []; try { buf = JSON.parse(raw); } catch (x) { buf = []; }
    anaWrite(buf); cache.remove(ANA_BUF_KEY);
    return buf.length;
  } finally { try { lock.releaseLock(); } catch (x) { /* not held */ } }
}
function anaFlushJob() { try { anaFlush(); } catch (x) { console.error('anaFlushJob ' + x); } }

/** Nightly: delete hits older than ANA_RETENTION_DAYS (rows are in time order, so it is one contiguous block). */
function anaPruneJob() {
  try {
    anaFlush();
    try { anaPruneEvents(); } catch (pe) { console.error('anaPruneEvents ' + pe); }
    var sh = sheetTab('Hits', ANA_HIT_HEADERS), last = sh.getLastRow();
    if (last < 2) return;
    var cutoff = Date.now() - intProp('ANA_RETENTION_DAYS', 400) * 86400000, ts = sh.getRange(2, 1, last - 1, 1).getValues(), n = 0;
    while (n < ts.length && Number(ts[n][0]) < cutoff) n++;
    if (n > 0) sh.deleteRows(2, n);
    console.log('anaPruneJob removed ' + n);
  } catch (x) { console.error('anaPruneJob ' + x); }
}

/* --------------------------------- statistics -------------------------------- */

function anaRead(onlyKey) {
  var sh = sheetTab('Hits', ANA_HIT_HEADERS), last = sh.getLastRow();
  if (last < 2) return [];
  var from = Math.max(2, last - ANA_SCAN_ROWS + 1), vals = sh.getRange(from, 1, last - from + 1, ANA_HIT_HEADERS.length).getValues(), out = [];
  for (var i = 0; i < vals.length; i++) {
    var r = vals[i];
    if (onlyKey && String(r[1]) !== onlyKey) continue;
    var t = r[0] instanceof Date ? r[0].getTime() : Number(r[0]);
    if (!isFinite(t)) continue;
    out.push({ t: t, key: String(r[1]), type: String(r[2]), name: String(r[3]), ref: String(r[4] || ''), country: String(r[5] || ''), device: String(r[6] || ''), browser: String(r[7] || ''), os: String(r[8] || ''),
      vid: String(r[9] || ''), lang: String(r[10] || ''), utm: String(r[11] || ''), bot: Number(r[12]) === 1 });
  }
  return out;
}
function anaDay(t) { return lnkDayOf(t); }   // arithmetic, not Utilities.formatDate (≈1 ms per call)

function anaStats(s, daysIn) {
  var days = [7, 30, 90, 365].indexOf(Number(daysIn)) >= 0 ? Number(daysIn) : 30;
  anaFlush();
  var rows = anaRead(s.key), now = Date.now(), cutoff = now - days * 86400000, five = now - 5 * 60000;
  var pv = 0, bots = 0, first = 0, last = 0, lastAny = 0, real = {}, perDay = Object.create(null), dayVid = Object.create(null);
  var pages = Object.create(null), pageVid = Object.create(null), ref = Object.create(null), co = Object.create(null), dev = Object.create(null), br = Object.create(null), os = Object.create(null),
    utm = Object.create(null), lang = Object.create(null), evs = Object.create(null);
  var hours = []; for (var h = 0; h < 24; h++) hours.push(0);
  rows.forEach(function (r) {
    if (r.t > lastAny) lastAny = r.t;
    if (r.bot) { bots++; return; }
    if (!first || r.t < first) first = r.t;
    if (r.t > last) last = r.t;
    if (r.t >= five && r.vid) real[r.vid] = 1;
    if (r.t < cutoff) return;
    var d = anaDay(r.t);
    if (r.type === 'ev') { lnkBump(evs, r.name); return; }
    pv++; lnkBump(pages, r.name); lnkBump(ref, r.ref); lnkBump(co, r.country); lnkBump(dev, r.device); lnkBump(br, r.browser); lnkBump(os, r.os); lnkBump(lang, r.lang);
    if (r.utm) lnkBump(utm, r.utm);
    var pd = perDay[d] = perDay[d] || { pv: 0 }; pd.pv++;
    (dayVid[d] = dayVid[d] || Object.create(null))[r.vid || ('x' + pv)] = 1;
    (pageVid[r.name] = pageVid[r.name] || Object.create(null))[(r.vid || ('x' + pv)) + d] = 1;
    hours[lnkHourOf(r.t)]++;
  });
  var byDay = [], uv = 0;
  for (var i = days - 1; i >= 0; i--) {
    var dd = anaDay(now - i * 86400000), u = dayVid[dd] ? Object.keys(dayVid[dd]).length : 0;
    uv += u; byDay.push({ d: dd, pv: perDay[dd] ? perDay[dd].pv : 0, uv: u });
  }
  var topPages = lnkTop(pages, 12).map(function (p) { return { name: p.name, n: p.n, u: Object.keys(pageVid[p.name] || {}).length }; });
  return { site: anaPublic(s), days: days, pv: pv, uv: uv, events: Object.keys(evs).reduce(function (a, k) { return a + evs[k]; }, 0), bots: bots, avgPages: uv ? Math.round((pv / uv) * 10) / 10 : 0,
    realtime: Object.keys(real).length, first: first ? new Date(first).toISOString() : '', last: last ? new Date(last).toISOString() : '', lastAny: lastAny ? new Date(lastAny).toISOString() : '',
    byDay: byDay, byHour: hours, pages: topPages, referrers: lnkTop(ref, 8), countries: lnkTop(co, 8), devices: lnkTop(dev, 5), browsers: lnkTop(br, 6), systems: lnkTop(os, 6), utms: lnkTop(utm, 6),
    languages: lnkTop(lang, 4), eventNames: lnkTop(evs, 10), scanned: rows.length >= ANA_SCAN_ROWS };
}

/* ------------------- statistics of an attached OLD QR (kind 'qrx') ------------------- */
/** Path (and SPA hash route) of a web address, normalised the way t.js reports pages: no query string, no trailing slash. */
function anaPathOf(url) {
  var m = /^https?:\/\/[^\/?#]*([^?#]*)(#[^?]*)?/i.exec(String(url || '')), p = m ? m[1] : '', hash = m && m[2] ? m[2] : '';
  try { p = decodeURI(p); } catch (x) { /* keep encoded */ }
  p = p || '/';
  if (/^#!?\//.test(hash)) p += hash;
  if (p.length > 1) p = p.replace(/\/+$/, '');
  return p.slice(0, 200) || '/';
}
function anaUtmOf(url) {
  var m = /[?&]utm_source=([^&#]*)/.exec(String(url || ''));
  try { return m ? decodeURIComponent(m[1]).slice(0, 40) : ''; } catch (x) { return ''; }
}
/**
 * An old QR goes straight to its target, so scans cannot be counted. What CAN be measured, when the target is a page of a project's website
 * (the tracking script is installed there), is how often that page was opened, per day, robots excluded. If the old QR's address carries
 * ?utm_source=… only visits with that utm_source count, which isolates the people who came through the QR.
 * Same answer shape as lnkStats() so the page draws both alike; mode = 'pageviews'; `linked`/`reason` say whether matching was possible.
 */
function anaQrxStats(l, daysIn) {
  var days = [7, 30, 90, 365].indexOf(Number(daysIn)) >= 0 ? Number(daysIn) : 30, now = Date.now();
  var out = { link: lnkPublic(l, null), mode: 'pageviews', linked: false, reason: '', matched: { path: '', utm: '' }, days: days, total: 0, unique: 0, bots: 0, inRange: 0, uniqueInRange: 0, week: 0, first: '', last: '',
    byDay: [], byHour: [], devices: [], browsers: [], systems: [], countries: [], referrers: [], recent: [], scanned: false };
  var hours = []; for (var h = 0; h < 24; h++) hours.push(0);
  for (var i = days - 1; i >= 0; i--) out.byDay.push({ d: lnkDayOf(now - i * 86400000), n: 0 });
  out.byHour = hours;
  if (!l.url) { out.reason = 'no-url'; return out; }
  if (!l.project) { out.reason = 'no-project'; return out; }
  var s = anaFind(l.project);
  if (!s || s.status === 'deleted') { out.reason = 'no-project'; return out; }
  if (!anaHostMatches(s.domains, anaHostOfUrl(l.url))) { out.reason = 'other-domain'; return out; }
  anaFlush();
  var path = anaPathOf(l.url), utm = anaUtmOf(l.url), rows = anaRead(s.key), cutoff = now - days * 86400000, wk = now - 7 * 86400000;
  var idx = Object.create(null); out.byDay.forEach(function (x, n) { idx[x.d] = n; });
  var uniq = {}, uniqRange = {}, dev = Object.create(null), co = Object.create(null), rf = Object.create(null), br = Object.create(null), os = Object.create(null), first = 0, last = 0;
  rows.forEach(function (r) {
    if (r.type !== 'pv') return;
    var name = String(r.name || ''); if (name.length > 1) name = name.replace(/\/+$/, '');
    if (name !== path || (utm && r.utm !== utm)) return;
    if (r.bot) { out.bots++; return; }
    out.total++; if (r.vid) uniq[r.vid + lnkDayOf(r.t)] = 1;
    if (!first || r.t < first) first = r.t;
    if (r.t > last) last = r.t;
    if (r.t >= wk) out.week++;
    if (r.t < cutoff) return;
    out.inRange++; if (r.vid) uniqRange[r.vid + lnkDayOf(r.t)] = 1;
    var d = lnkDayOf(r.t); if (idx[d] !== undefined) out.byDay[idx[d]].n++;
    hours[lnkHourOf(r.t)]++;
    lnkBump(dev, r.device); lnkBump(br, r.browser); lnkBump(os, r.os); lnkBump(co, r.country); lnkBump(rf, r.ref);
  });
  out.linked = true; out.matched = { path: path, utm: utm };
  out.unique = Object.keys(uniq).length; out.uniqueInRange = Object.keys(uniqRange).length;
  out.first = first ? new Date(first).toISOString() : ''; out.last = last ? new Date(last).toISOString() : '';
  out.devices = lnkTop(dev, 5); out.browsers = lnkTop(br, 6); out.systems = lnkTop(os, 6); out.countries = lnkTop(co, 8); out.referrers = lnkTop(rf, 8); out.scanned = rows.length >= ANA_SCAN_ROWS;
  return out;
}

/* ------------------------------ dashboard overview ----------------------------- */
/** Everything the home dashboard needs in ONE call (cached 60 s per user): totals vs the previous period, daily series, top projects / pages,
 *  breakdowns and the short-link / QR scans of the same period. Read-only; the page falls back to op "list" when this Apps Script is older. */
function anaOverview(sc, daysIn) {
  var days = [7, 30, 90].indexOf(Number(daysIn)) >= 0 ? Number(daysIn) : 30;
  var cache = CacheService.getScriptCache(), ck = 'ov:' + (sc.admin ? '*' : sc.email) + ':' + days;
  try { var hit = cache.get(ck); if (hit) return JSON.parse(hit); } catch (x) { /* recompute */ }
  anaFlush();
  var mine = anaAll().filter(function (s) { return s.status !== 'deleted' && (sc.admin || s.owner === sc.email); }), keys = Object.create(null), names = Object.create(null);
  mine.forEach(function (s) { keys[s.key] = true; names[s.key] = s.name; });
  var now = Date.now(), cut = now - days * 86400000, pcut = now - 2 * days * 86400000, five = now - 5 * 60000;
  var perDay = Object.create(null), dayVid = Object.create(null), siteAgg = Object.create(null), pageAgg = Object.create(null);
  var ref = Object.create(null), co = Object.create(null), dev = Object.create(null), br = Object.create(null);
  var hours = []; for (var h = 0; h < 24; h++) hours.push(0);
  var pv = 0, prevPv = 0, bots = 0, lastAny = 0, real = Object.create(null), seq = 0;
  anaRead(null).forEach(function (r) {
    if (!keys[r.key]) return;
    if (r.t > lastAny) lastAny = r.t;
    if (r.bot) { bots++; return; }
    if (r.type !== 'pv') return;
    if (r.t >= five && r.vid) real[r.vid] = 1;
    if (r.t < pcut) return;
    var d = anaDay(r.t), vid = (r.vid || ('x' + (++seq))), s = siteAgg[r.key] = siteAgg[r.key] || { pv: 0, prev: 0, vids: Object.create(null) };
    (dayVid[d] = dayVid[d] || Object.create(null))[vid] = 1;
    if (r.t < cut) { prevPv++; s.prev++; return; }
    pv++; s.pv++; s.vids[vid + d] = 1;
    var pd = perDay[d] = perDay[d] || { pv: 0 }; pd.pv++;
    lnkBump(ref, r.ref); lnkBump(co, r.country); lnkBump(dev, r.device); lnkBump(br, r.browser);
    var pk = r.key + '\u0001' + r.name, pg = pageAgg[pk] = pageAgg[pk] || { site: r.key, name: r.name, n: 0 }; pg.n++;
    hours[lnkHourOf(r.t)]++;
  });
  /* short links + QR scans of the same user scope */
  var links = lnkAll().filter(function (l) { return l.status !== 'deleted' && (sc.admin || l.owner === sc.email); }), only = Object.create(null), meta = Object.create(null), kinds = { link: 0, qr: 0, qrs: 0, qrx: 0 };
  links.forEach(function (l) { only[l.code] = 1; meta[l.code] = l; kinds[l.kind] = (kinds[l.kind] || 0) + 1; });
  var scanDay = Object.create(null), perCode = Object.create(null), scans = 0, prevScans = 0;
  (links.length ? lnkClicks(only) : []).forEach(function (c) {
    if (c.bot) return;
    if (c.t >= cut) { scans++; var d = anaDay(c.t); scanDay[d] = (scanDay[d] || 0) + 1; perCode[c.code] = (perCode[c.code] || 0) + 1; } else if (c.t >= pcut) prevScans++;
  });
  var byDay = [], uv = 0, prevUv = 0, i;
  for (i = days - 1; i >= 0; i--) { var dd = anaDay(now - i * 86400000), u = dayVid[dd] ? Object.keys(dayVid[dd]).length : 0; uv += u; byDay.push({ d: dd, pv: perDay[dd] ? perDay[dd].pv : 0, uv: u, sc: scanDay[dd] || 0 }); }
  for (i = days; i < 2 * days; i++) { var pd2 = anaDay(now - i * 86400000); prevUv += dayVid[pd2] ? Object.keys(dayVid[pd2]).length : 0; }
  var topProjects = Object.keys(siteAgg).map(function (k) { var s = siteAgg[k]; return { key: k, name: names[k] || k, pv: s.pv, prev: s.prev, uv: Object.keys(s.vids).length }; }).sort(function (a, c) { return c.pv - a.pv; }).slice(0, 8);
  var pages = Object.keys(pageAgg).map(function (k) { var p = pageAgg[k]; return { site: names[p.site] || p.site, name: p.name, n: p.n }; }).sort(function (a, c) { return c.n - a.n; }).slice(0, 10);
  var out = { days: days, generated: now, projects: { total: mine.length, tracking: mine.filter(function (s) { return s.track && s.status === 'active'; }).length },
    pv: pv, prevPv: prevPv, uv: uv, prevUv: prevUv, avgPages: uv ? Math.round((pv / uv) * 10) / 10 : 0, realtime: Object.keys(real).length, bots: bots, last: lastAny ? new Date(lastAny).toISOString() : '',
    byDay: byDay, byHour: hours, topProjects: topProjects, pages: pages, referrers: lnkTop(ref, 6), countries: lnkTop(co, 6), devices: lnkTop(dev, 5), browsers: lnkTop(br, 5),
    links: { links: kinds.link || 0, qr: kinds.qr || 0, qrs: kinds.qrs || 0, qrx: kinds.qrx || 0, scans: scans, prevScans: prevScans, top: lnkTop(perCode, 5).map(function (x) { var l = meta[x.name]; return { code: x.name, n: x.n, kind: l.kind, title: l.title || l.url }; }) } };
  try { cache.put(ck, JSON.stringify(out), 60); } catch (x) { /* too big for the cache: just recompute next time */ }
  return out;
}

/* ------------------------------------ actions ------------------------------------ */

function projects(b) {
  var u = requireUser(b.session), sc = lnkScope(u), op = String(b.op || '');
  rateLimit('projects', intProp('LINK_LIMIT_PER_MIN', 60) * (op === 'create' || op === 'update' || op === 'delete' ? 1 : 5));
  switch (op) {
    case 'list':   return anaList(sc);
    case 'overview': return anaOverview(sc, b.days);   // home dashboard: one cached call
    case 'names':  return { items: anaAll().filter(function (s) { return s.status !== 'deleted' && (sc.admin || s.owner === sc.email); }).map(function (s) { return { key: s.key, name: s.name }; }) };
    case 'create': return anaCreate(sc, u, b);
    case 'update': return anaUpdate(sc, u, b);
    case 'delete': return anaDelete(sc, u, b);
    case 'stats':  return anaStats(anaOwned(sc, b.key), b.days);
    case 'monitor': return anaMonitor(sc);
    case 'feed':   return anaFeed(sc, b);
    case 'issues': return anaIssues(sc, b);
    case 'around': return anaAround(sc, b);
    case 'replay': return simReplay(sc, b);   // 3D plan: replay of a real day (below)
    case 'wings':  return simWings(sc, b);    // 3D plan: pages of every system in one call (below)
    case 'floor':  return simFloor(sc, b);    // 3D plan: every project's totals + hourly profile in ONE call (below)
    default: throw httpError('UNKNOWN_ACTION', 'ไม่รู้จักคำสั่งนี้');
  }
}

function anaList(sc) {
  anaFlush();
  var mine = anaAll().filter(function (s) { return s.status !== 'deleted' && (sc.admin || s.owner === sc.email); }), keys = Object.create(null);
  mine.forEach(function (s) { keys[s.key] = { pv7: 0, uvd: Object.create(null), last: 0, links: 0, linkClicks: 0, qrs: 0 }; });
  var wk = Date.now() - 7 * 86400000;
  anaRead(null).forEach(function (r) {
    var a = keys[r.key]; if (!a || r.bot) return;
    if (r.t > a.last) a.last = r.t;
    if (r.type === 'pv' && r.t >= wk) { a.pv7++; a.uvd[r.vid + anaDay(r.t)] = 1; }
  });
  var links = lnkAll().filter(function (l) { return l.project && keys[l.project] && l.status !== 'deleted'; }), only = {};
  links.forEach(function (l) { only[l.code] = l.project; keys[l.project].links++; if (l.kind !== 'link') keys[l.project].qrs++; });
  if (links.length) lnkClicks(only).forEach(function (c) { if (!c.bot) keys[only[c.code]].linkClicks++; });
  var pr = {}, hl = {}; try { pr = anaProblems(keys, Date.now()); hl = anaHealthAll(); } catch (mx) { console.error('anaList monitor ' + mx); }   // bonus: never break the list
  return { admin: sc.admin, base: lnkBase(), items: mine.map(function (s) { var a = keys[s.key]; return anaPublic(s, { pv7: a.pv7, uv7: Object.keys(a.uvd).length, last: a.last, links: a.links, linkClicks: a.linkClicks, qrs: a.qrs, err24: pr[s.key] ? pr[s.key].err24 : 0, health: hl[s.key] ? hl[s.key].state : '' }); })
    .sort(function (x, y) { return x.created < y.created ? 1 : -1; }) };
}

function anaCreate(sc, u, b) { return lnkLocked(function () { return anaCreateLocked(sc, u, b); }); }
function anaCreateLocked(sc, u, b) {
  var all = anaAll(), mine = all.filter(function (s) { return s.owner === sc.email && s.status !== 'deleted'; });
  if (mine.length >= intProp('ANA_MAX_PER_USER', 50)) throw httpError('LIMIT', 'สร้างโครงการครบจำนวนที่กำหนดแล้ว');
  var name = String(b.name || '').trim().slice(0, 120);
  if (!name) throw httpError('BAD_REQUEST', 'กรุณาระบุชื่อโครงการ');
  var url = b.url ? lnkCheckUrl(b.url) : '';
  var domains = anaDomains([anaHostOfUrl(url)].concat(String(b.domains || '').split(/[,\s]+/)));
  var taken = Object.create(null); all.forEach(function (s) { taken[s.key] = true; });
  var key = '';
  for (var n = 0; n < 12 && !key; n++) {
    var k = 'p'; for (var i = 0; i < 9; i++) k += LNK_ALPHABET.charAt(Math.floor(Math.random() * LNK_ALPHABET.length));
    if (!taken[k]) key = k;
  }
  if (!key) throw httpError('INTERNAL_RETRY', 'สร้างรหัสไม่สำเร็จ กรุณาลองใหม่');
  var s = { key: key, name: name, url: url, domains: domains, owner: sc.email, created: lnkStamp(Date.now()), status: 'active', note: String(b.note || '').slice(0, 300), tags: libTags(b.tags), track: b.track !== false };
  sheetTab('Sites', ANA_SITE_HEADERS).appendRow(anaRowOf(s));
  anaUncache(key);
  anaLog(u, 'create', key, { host: anaHostOfUrl(url) });
  return { site: anaPublic(s), base: lnkBase() };
}

function anaUpdate(sc, u, b) {
  var s = anaOwned(sc, b.key);
  if (b.name !== undefined) { s.name = String(b.name).trim().slice(0, 120); if (!s.name) throw httpError('BAD_REQUEST', 'กรุณาระบุชื่อโครงการ'); }
  if (b.url !== undefined) s.url = b.url ? lnkCheckUrl(b.url) : '';
  if (b.domains !== undefined) s.domains = anaDomains(String(b.domains).split(/[,\s]+/));
  if (b.url !== undefined && !s.domains.length) s.domains = anaDomains([anaHostOfUrl(s.url)]);
  if (b.note !== undefined) s.note = String(b.note).slice(0, 300);
  if (b.tags !== undefined) s.tags = libTags(b.tags);
  if (b.track !== undefined) s.track = b.track === true;
  if (b.status !== undefined) { if (['active', 'paused'].indexOf(b.status) < 0) throw httpError('BAD_REQUEST', 'สถานะไม่ถูกต้อง'); s.status = b.status; }
  sheetTab('Sites', ANA_SITE_HEADERS).getRange(s.row, 1, 1, 10).setValues([anaRowOf(s)]);
  anaUncache(s.key);
  anaLog(u, 'update', s.key, { status: s.status, track: s.track });
  return { site: anaPublic(s) };
}

/** Soft delete: statistics are kept; short links attached to the project are detached. */
function anaDelete(sc, u, b) {
  var s = anaOwned(sc, b.key);
  s.status = 'deleted';
  sheetTab('Sites', ANA_SITE_HEADERS).getRange(s.row, 1, 1, 10).setValues([anaRowOf(s)]);
  anaUncache(s.key);
  var sh = sheetTab('Links', LNK_LINK_HEADERS);
  lnkAll().forEach(function (l) { if (l.project === s.key) { l.project = ''; sh.getRange(l.row, 1, 1, LNK_COLS).setValues([lnkRowOf(l)]); lnkUncache(l.code); } });
  anaLog(u, 'delete', s.key, {});
  return { key: s.key };
}

/* ------------------------------------- setup ------------------------------------- */

/** Run ONCE from the editor: creates the tabs and the triggers (flush every minute, prune every night). Safe to run again. */
function setupAnalytics() {
  var sites = sheetTab('Sites', ANA_SITE_HEADERS), hits = sheetTab('Hits', ANA_HIT_HEADERS), events = sheetTab('Events', ANA_EVT_HEADERS), health = sheetTab('Health', ANA_HEALTH_HEADERS);
  [[sites, ANA_SITE_HEADERS, [110, 220, 300, 260, 200, 150, 80, 260, 160, 80], '#3758f9'], [hits, ANA_HIT_HEADERS, [160, 110, 60, 300, 160, 70, 90, 110, 110, 130, 70, 100, 50], '#c2410c'],
    [events, ANA_EVT_HEADERS, [150, 110, 60, 70, 160, 320, 70, 90, 200, 90, 130, 80, 110, 110, 260], '#be123c'], [health, ANA_HEALTH_HEADERS, [110, 80, 100, 110, 150, 150, 100], '#15803d']].forEach(function (t) {
    var sh = t[0];
    sh.getRange(1, 1, 1, t[1].length).setFontWeight('bold').setFontColor('#ffffff').setBackground('#0f5c9e');
    sh.setFrozenRows(1); t[2].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); }); sh.setTabColor(t[3]);
  });
  sites.getRange(2, 1, Math.max(sites.getMaxRows() - 1, 1), 4).setNumberFormat('@');
  hits.getRange(2, 1, Math.max(hits.getMaxRows() - 1, 1), 1).setNumberFormat('0');
  events.getRange(2, 1, Math.max(events.getMaxRows() - 1, 1), 1).setNumberFormat('0');
  health.getRange(2, 5, Math.max(health.getMaxRows() - 1, 1), 2).setNumberFormat('0');
  var links = sheetTab('Links', LNK_LINK_HEADERS);
  links.getRange(1, 12, 1, 7).setValues([['โครงการ', 'ชนิด', 'ข้อมูล QR', 'ที่มา', 'ลิงก์ย่อ (URL)', 'รูป QR (Drive id)', 'รูป QR (URL)']]).setFontWeight('bold').setFontColor('#ffffff').setBackground('#0f5c9e'); links.setColumnWidth(12, 110);
  ScriptApp.getProjectTriggers().forEach(function (t) { var f = t.getHandlerFunction(); if (f === 'anaFlushJob' || f === 'anaPruneJob' || f === 'anaPingJob') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('anaFlushJob').timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger('anaPruneJob').timeBased().everyDays(1).atHour(3).create();
  ScriptApp.newTrigger('anaPingJob').timeBased().everyMinutes(10).create();   // uptime check (off: Script property ANA_PING = off)
  if (!prop('EDGE_SECRET')) setupLinks();
  console.log('พร้อมใช้งาน — แท็บ Sites, Hits, Events, Health และทริกเกอร์เขียนข้อมูลทุกนาที/ตรวจสถานะเว็บทุก 10 นาที/ล้างข้อมูลเก่าทุกคืนถูกสร้างแล้ว\nอย่าลืมตั้ง SAND_EDGE_SECRET ใน Vercel ให้เท่ากับ EDGE_SECRET (ดูได้ใน Project Settings → Script properties)');
}

/* ====================================================================================================================
 * 3D hospital plan — projects/replay and projects/wings
 * ==================================================================================================================== */

/**
 * SAND Office Tools — ผังจำลอง 3 มิติของโรงพยาบาล: เล่นซ้ำวันจริง (projects/replay) และหน้าย่อยของทุกระบบในครั้งเดียว (projects/wings).
 *
 * วางต่อท้าย Analytics.gs แล้วเพิ่ม 2 บรรทัดใน switch ของ projects():
 *     case 'replay': return simReplay(sc, b);
 *     case 'wings':  return simWings(sc, b);
 *     case 'floor':  return simFloor(sc, b);
 *
 *   projects/replay {mode: 'today' | 'peak'}   → {mode, day, today, byDay:[{d,pv}], scale, sites:[{key, n, uv, fresh, back, ev:[[นาทีของวัน, ผู้เข้าชม#, f, หน้า#]], pgs:[พาธ]}]}
 *        f = 0 เข้าครั้งแรกของวัน · 1 กลับมาใหม่หลังห่างเกิน 30 นาที · 2 เปิดหน้าอื่นในการเข้าครั้งเดียวกัน   (ผู้เข้าชม# เป็นเลขรัน ไม่ใช่ค่าแฮช)
 *   projects/floor  {days: 7 | 30 | 90 | 365}  → {days, total, generated, sites:[{key, name, url, tags, status, track, pv, prev, uv, realtime, last, byHour[24]}]}
 *        ทุกโครงการของผู้ใช้ในครั้งเดียว: ยอดดู (pv) เทียบช่วงก่อนหน้า (prev) · ผู้เข้าชมไม่ซ้ำรายวัน (uv) · คนออนไลน์ 5 นาทีล่าสุด (realtime) · เวลาล่าสุด (last) · ยอดดูรายชั่วโมงเวลาไทย (byHour) · แคช 60 วินาที
 *   projects/wings  {days: 7 | 30 | 90 | 365}  → {days, sites:[{site, uv, realtime, pages:[{path, pv, uv, realtime, byHour[24], rl}], other, flows:[{from, to, n}]}]}
 *        รูปแบบเดียวกับ op "pages" ของแต่ละโครงการ แต่อ่านชีต Hits ครั้งเดียวสำหรับทุกโครงการ (เร็วกว่าเรียกทีละระบบมาก) · แคช 60 วินาที
 *
 * ความเป็นส่วนตัว (PDPA): ใช้เฉพาะข้อมูลที่ Hits เก็บอยู่แล้ว (hash รายวัน ไม่มี IP / คุกกี้) · ตอบเฉพาะโครงการของผู้ใช้ (แอดมินเห็นทั้งหมด) · ไม่ส่ง hash ออกไปเลย
 * ต้องใช้ฟังก์ชันจาก Code.gs / Links.gs / Analytics.gs: requireUser, rateLimit, intProp, lnkScope, lnkDayOf, lnkHourOf, sheetTab, anaAll, anaFlush
 */

var SIM_SCAN_ROWS = 80000;      // newest Hits rows read (same budget as Analytics.gs)
var SIM_VISIT_GAP = 30;         // minutes: a view after a longer silence is a "return visit" (must match VISIT_GAP in site-engine.js)
var SIM_MAX_EV = 2000;          // events sent per project (the page ignores more)
var SIM_MAX_PGS = 16;           // page names sent per project for the replay
var SIM_MAX_PAGES = 10;         // rooms per system (MAX_PAGES in site-engine.js); more → busiest 9 + "other pages"
var SIM_ROLES = ['admin', 'head', 'officer', 'committee', 'researcher', 'user'];

/* ------------------------------------ helpers ------------------------------------ */

/** Same grouping rule as pageKey() in site-engine.js: no query string, index.html folded into its folder, no trailing slash, "#/route" kept. */
function simPageKey(p) {
  var t = String(p == null || p === '' ? '/' : p), hash = '', hi = t.indexOf('#');
  if (hi >= 0) { var hv = t.slice(hi); if (/^#!?\//.test(hv)) hash = hv.split('?')[0].toLowerCase().replace(/\/+$/, ''); t = t.slice(0, hi); }
  t = t.split('?')[0].toLowerCase(); if (t.charAt(0) !== '/') t = '/' + t;
  t = t.replace(/\/index\.html?$/, '/'); if (t.length > 1) t = t.replace(/\/+$/, '');
  return t + hash;
}
function simMinuteOf(t) { return Math.floor(((t + 25200000) % 86400000) / 60000); }   // minute of the day in Thailand time (UTC+7)
function simScope(sc) { return sc.admin ? '*' : sc.email; }
function simSites(sc) {
  return anaAll().filter(function (s) { return s.status !== 'deleted' && (sc.admin || s.owner === sc.email); });
}
function simZero24() { var a = []; for (var h = 0; h < 24; h++) a.push(0); return a; }
function simCacheGet(k) { try { var v = CacheService.getScriptCache().get(k); return v ? JSON.parse(v) : null; } catch (x) { return null; } }
function simCachePut(k, v, sec) { try { CacheService.getScriptCache().put(k, JSON.stringify(v), sec); } catch (x) { /* too big for the cache: just recompute next time */ } }

/**
 * Page views (no robots, no events) of the given projects since `since` — newest SIM_SCAN_ROWS rows of Hits.
 * The role column is found by its header (บทบาท / role) so this works whether or not your Hits tab has one; without it every `rl` stays empty.
 */
function simRead(keys, since) {
  var sh = sheetTab('Hits', ANA_HIT_HEADERS), last = sh.getLastRow();
  if (last < 2) return [];
  var width = ANA_HIT_HEADERS.length; try { if (typeof sh.getLastColumn === 'function') width = Math.max(width, sh.getLastColumn()); } catch (x) { /* keep default */ }
  var roleCol = -1;
  if (width > ANA_HIT_HEADERS.length) {
    var head = sh.getRange(1, 1, 1, width).getValues()[0];
    for (var c = ANA_HIT_HEADERS.length; c < head.length; c++) if (/บทบาท|role/i.test(String(head[c]))) { roleCol = c; break; }
  }
  var from = Math.max(2, last - SIM_SCAN_ROWS + 1), vals = sh.getRange(from, 1, last - from + 1, width).getValues(), out = [];
  for (var i = 0; i < vals.length; i++) {
    var r = vals[i];
    if (!keys[String(r[1])] || String(r[2]) !== 'pv' || Number(r[12]) === 1) continue;
    var t = r[0] instanceof Date ? r[0].getTime() : Number(r[0]);
    if (!isFinite(t) || t < since) continue;
    var role = roleCol >= 0 ? String(r[roleCol] || '').toLowerCase() : '';
    out.push({ t: t, key: String(r[1]), name: String(r[3] || '/'), vid: String(r[9] || ''), role: SIM_ROLES.indexOf(role) >= 0 ? role : '' });
  }
  return out;
}
function simPrepare(sc) {
  if (typeof anaFlush === 'function') anaFlush();   // views still waiting in the cache buffer count too
  var sites = simSites(sc), keys = Object.create(null);
  sites.forEach(function (s) { keys[s.key] = s; });
  return { sites: sites, keys: keys };
}

/* ------------------------------ projects/replay ------------------------------ */

function simReplay(sc, b) {
  var mode = b.mode === 'peak' ? 'peak' : 'today', ck = 'sr:' + simScope(sc) + ':' + mode, hit = simCacheGet(ck);
  if (hit) return hit;
  var p = simPrepare(sc), now = Date.now(), today = lnkDayOf(now);
  var rows = simRead(p.keys, now - 31 * 86400000);
  var perDay = Object.create(null);
  rows.forEach(function (r) { var d = lnkDayOf(r.t); perDay[d] = (perDay[d] || 0) + 1; });
  var byDay = [], best = null, i;
  for (i = 29; i >= 0; i--) {
    var d = lnkDayOf(now - i * 86400000), pv = perDay[d] || 0;
    byDay.push({ d: d, pv: pv });
    if (pv > 0 && (!best || pv > best.pv || (pv === best.pv && d > best.d))) best = { d: d, pv: pv };   // busiest day; ties → the latest day (same rule as the page)
  }
  var day = mode === 'peak' && best ? best.d : today;
  var perSite = Object.create(null);
  rows.forEach(function (r) { if (lnkDayOf(r.t) === day) (perSite[r.key] = perSite[r.key] || []).push(r); });
  var sites = Object.keys(perSite).map(function (key) { return simReplaySite(key, perSite[key]); });
  var out = { mode: mode, day: day, today: today, byDay: byDay, scale: 1, sites: sites };
  simCachePut(ck, out, 60);
  return out;
}

function simReplaySite(key, rows) {
  rows.sort(function (a, c) { return a.t - c.t; });
  var visitors = Object.create(null), seen = 0, fresh = 0, back = 0, pageCount = Object.create(null), ev = [];
  rows.forEach(function (r) {
    var pk = simPageKey(r.name); pageCount[pk] = (pageCount[pk] || 0) + 1;
    var v = r.vid ? visitors[r.vid] : null, f;
    if (!v) { v = { no: ++seen, last: r.t }; if (r.vid) visitors[r.vid] = v; f = 0; fresh++; }                       // first view of this visitor today (no hash → every view is its own visitor)
    else if ((r.t - v.last) / 60000 > SIM_VISIT_GAP) { f = 1; back++; v.last = r.t; }                                // came back after a pause
    else { f = 2; v.last = r.t; }                                                                                     // another page of the same visit
    ev.push([simMinuteOf(r.t), v.no, f, pk]);
  });
  var pgs = Object.keys(pageCount).sort(function (a, c) { return pageCount[c] - pageCount[a]; }).slice(0, SIM_MAX_PGS), idx = Object.create(null);
  pgs.forEach(function (k, n) { idx[k] = n; });
  ev.forEach(function (e) { e[3] = idx[e[3]] === undefined ? -1 : idx[e[3]]; });
  var n = ev.length;
  if (ev.length > SIM_MAX_EV) {                                  // keep every visit start first, then thin the rest evenly
    var starts = ev.filter(function (e) { return e[2] !== 2; });
    ev = starts.length > SIM_MAX_EV ? starts.filter(function (e, i) { return i % Math.ceil(starts.length / SIM_MAX_EV) === 0; }) : starts;
  }
  return { key: key, n: n, uv: seen, fresh: fresh, back: back, ev: ev, pgs: pgs };
}

/* ------------------------------- projects/wings ------------------------------- */

function simWings(sc, b) {
  var days = [7, 30, 90, 365].indexOf(Number(b.days)) >= 0 ? Number(b.days) : 30, ck = 'sw:' + simScope(sc) + ':' + days, hit = simCacheGet(ck);
  if (hit) return hit;
  var p = simPrepare(sc), now = Date.now(), rows = simRead(p.keys, now - days * 86400000), per = Object.create(null);
  rows.forEach(function (r) { (per[r.key] = per[r.key] || []).push(r); });
  var sites = Object.keys(per).map(function (key) { return simWingSite(p.keys[key], per[key], days, now); });
  var out = { days: days, sites: sites };
  simCachePut(ck, out, 60);
  return out;
}

function simPageAgg(path) { return { path: path, pv: 0, uv: Object.create(null), rt: Object.create(null), byHour: simZero24(), rl: {} }; }
function simPageOut(a) {
  var rl = {}; SIM_ROLES.forEach(function (id) { if (a.rl[id]) rl[id] = a.rl[id]; });
  return { path: a.path, pv: a.pv, uv: Object.keys(a.uv).length, realtime: Object.keys(a.rt).length, byHour: a.byHour, rl: rl };
}

/** One project → the same shape as `projects/pages`: the busiest pages (+ "other"), who uses them, when, and the walks between pages. */
function simWingSite(s, rows, days, now) {
  rows.sort(function (a, c) { return a.t - c.t; });
  var five = now - 5 * 60000, agg = Object.create(null), siteUv = Object.create(null), siteRt = Object.create(null), walk = Object.create(null), anon = 0;
  rows.forEach(function (r) {
    var pk = simPageKey(r.name), a = agg[pk] = agg[pk] || simPageAgg(pk), day = lnkDayOf(r.t), who = (r.vid || ('x' + (++anon))) + day;
    a.pv++; a.uv[who] = 1; a.byHour[lnkHourOf(r.t)]++;
    if (r.role) a.rl[r.role] = (a.rl[r.role] || 0) + 1;
    siteUv[who] = 1;
    if (r.t >= five && r.vid) { a.rt[r.vid] = 1; siteRt[r.vid] = 1; }
    if (r.vid) { var w = walk[who] = walk[who] || []; w.push({ k: pk, t: r.t }); }
  });
  var ranked = Object.keys(agg).map(function (k) { return agg[k]; }).sort(function (a, c) { return c.pv - a.pv; });
  var keep = ranked.length > SIM_MAX_PAGES ? ranked.slice(0, SIM_MAX_PAGES - 1) : ranked, rest = ranked.slice(keep.length), kept = Object.create(null);
  keep.forEach(function (a) { kept[a.path] = true; });
  var other = null;
  if (rest.length) {
    var o = simPageAgg('*other');
    rest.forEach(function (a) {
      o.pv += a.pv; o.byHour = o.byHour.map(function (n, i) { return n + a.byHour[i]; });
      Object.keys(a.uv).forEach(function (u) { o.uv[u] = 1; }); Object.keys(a.rt).forEach(function (u) { o.rt[u] = 1; });
      SIM_ROLES.forEach(function (id) { if (a.rl[id]) o.rl[id] = (o.rl[id] || 0) + a.rl[id]; });
    });
    other = simPageOut(o); delete other.path;
  }
  var flow = Object.create(null);
  Object.keys(walk).forEach(function (who) {
    var w = walk[who];
    for (var i = 1; i < w.length; i++) {
      if ((w[i].t - w[i - 1].t) / 60000 > SIM_VISIT_GAP) continue;      // a long pause is a new visit, not a walk from page to page
      var from = kept[w[i - 1].k] ? w[i - 1].k : (other ? '*other' : ''), to = kept[w[i].k] ? w[i].k : (other ? '*other' : '');
      if (!from || !to || from === to) continue;
      var fk = from + '\u0001' + to; flow[fk] = (flow[fk] || 0) + 1;
    }
  });
  var flows = Object.keys(flow).map(function (k) { var x = k.split('\u0001'); return { from: x[0], to: x[1], n: flow[k] }; }).sort(function (a, c) { return c.n - a.n; }).slice(0, 40);
  return { days: days, site: { key: s.key, name: s.name, url: s.url, tags: s.tags }, uv: Object.keys(siteUv).length, realtime: Object.keys(siteRt).length, pages: keep.map(simPageOut), other: other, flows: flows };
}

/* ------------------------------- projects/floor ------------------------------- */

/**
 * ข้อมูลที่ผัง 3 มิติหน้าแรกต้องใช้ของทุกโครงการ ในการอ่านชีต Hits รอบเดียว (แคช 60 วินาทีต่อผู้ใช้)
 * ชื่อฟิลด์ตรงกับ site() / normalizeFloor() ใน site-engine.js · ไม่นับบอตและ event · โครงการที่ยังไม่มีข้อมูลก็ส่งไป (เป็น 0) เพื่อแสดงว่า "ยังไม่มีข้อมูล"
 */
function simFloor(sc, b) {
  var days = [7, 30, 90, 365].indexOf(Number(b && b.days)) >= 0 ? Number(b.days) : 30, ck = 'sf:' + simScope(sc) + ':' + days, hit = simCacheGet(ck);
  if (hit) return hit;
  if (typeof anaFlush === 'function') anaFlush();
  var mine = simSites(sc), agg = Object.create(null);
  mine.forEach(function (s) { agg[s.key] = { pv: 0, prev: 0, uvd: Object.create(null), rt: Object.create(null), last: 0, byHour: simZero24() }; });
  var now = Date.now(), cut = now - days * 86400000, pcut = now - 2 * days * 86400000, five = now - 5 * 60000, anon = 0;
  anaRead(null).forEach(function (r) {
    var a = agg[r.key]; if (!a || r.bot) return;
    if (r.t > a.last) a.last = r.t;
    if (r.type !== 'pv' || r.t < pcut) return;
    if (r.t < cut) { a.prev++; return; }
    a.pv++; a.byHour[lnkHourOf(r.t)]++;
    a.uvd[(r.vid || ('x' + (++anon))) + anaDay(r.t)] = 1;
    if (r.t >= five && r.vid) a.rt[r.vid] = 1;
  });
  var sites = mine.map(function (s) {
    var a = agg[s.key];
    return { key: s.key, name: s.name, url: s.url, tags: s.tags, status: s.status, track: s.track, pv: a.pv, prev: a.prev, uv: Object.keys(a.uvd).length,
      realtime: Object.keys(a.rt).length, last: a.last ? new Date(a.last).toISOString() : '', byHour: a.byHour };
  });
  var out = { days: days, total: sites.length, generated: now, sites: sites };
  simCachePut(ck, out, 60);
  return out;
}

/* ====================================================================================================================
 * Monitor — event log · task log · uptime of every project  (หน้า #/monitor)
 * ==================================================================================================================== */

/**
 * ที่มาของข้อมูล (ชีตเดียวกัน ไม่ต้องมีเซิร์ฟเวอร์เพิ่ม):
 *   Hits    pv = เปิดหน้า · ev = เหตุการณ์ผู้ใช้ (sandTrack)                       (มีอยู่เดิม)
 *   Events  er = ข้อผิดพลาดที่ t.js จับเอง · lg = บันทึก (sandLog) · tk = งาน (sandTask) · hc = ตรวจสถานะเว็บ (ล่ม/กลับมา)
 *   Health  สถานะล่าสุดของแต่ละเว็บ (แถวละโครงการ) — เขียนโดย anaPingJob ทุก 10 นาที
 * ความเป็นส่วนตัว: ข้อความทุกบรรทัดผ่าน anaScrub (ตัด query string, อีเมล, เบอร์, เลขยาว ≥ 7 หลัก, โทเคน) · ไม่ส่ง hash ผู้เข้าชมออกไป (ส่งแค่ 4 ตัวแรก)
 * Script properties (ไม่บังคับ): ANA_EVENT_RATE_PER_MIN (120) · ANA_EVENT_RETENTION_DAYS (90) · ANA_PING (off) · ANA_PING_MAX (40)
 */

var ANA_EVT_HEADERS = ['เวลา', 'รหัสไซต์', 'ชนิด', 'ระดับ', 'ชื่อ / งาน', 'ข้อความ', 'สถานะ', 'ใช้เวลา (ms)', 'หน้า', 'กลุ่ม (fp)', 'ผู้เข้าชม (hash รายวัน)', 'อุปกรณ์', 'เบราว์เซอร์', 'ระบบ', 'ข้อมูลเพิ่ม'];
var ANA_HEALTH_HEADERS = ['รหัสไซต์', 'สถานะ', 'รหัสตอบกลับ', 'เวลาตอบ (ms)', 'ตรวจล่าสุด', 'เริ่มสถานะนี้', 'ล้มเหลวติดกัน'];
var ANA_EVT_SCAN_ROWS = 30000;
var ANA_FEED_KINDS = ['er', 'lg', 'tk', 'hc', 'ev', 'pv'];
var ANA_LEVELS = ['info', 'warn', 'error'];
var ANA_PING_NAME = 'ตรวจสถานะเว็บ';

function anaScrub(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/https?:\/\/[^\s"'<>)\]]+/gi, function (u) { return u.replace(/[?#].*$/, ''); })
    .replace(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(\.[A-Za-z0-9\-]+)+/g, '[อีเมล]')
    .replace(/\b0\d{1,2}[- ]?\d{3}[- ]?\d{4}\b/g, '[เบอร์]')
    .replace(/\b\d-\d{4}-\d{5}-\d{2}-\d\b/g, '[เลข]')
    .replace(/\b\d{7,}\b/g, '[เลข]')
    .replace(/\b[A-Za-z0-9_\-]{28,}\b/g, '[รหัส]')
    .replace(/\s+/g, ' ').trim().slice(0, max || 300);
}
/** Same problem → same short code (numbers / placeholders ignored). */
function anaFp(kind, name, msg) {
  var s = kind + '|' + String(name || '').toLowerCase() + '|' + String(msg || '').toLowerCase().replace(/\[[^\]]*\]/g, '').replace(/\d+/g, '#').replace(/\s+/g, ' ').slice(0, 120), h = 5381;
  for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
function anaEvtRow(t, key, kind, level, name, msg, status, ms, page, fp, vid, device, browser, os, extra) {
  return [t, key, kind, level, cell(name, 60), cell(msg, 300), status, ms, cell(page, 200), fp, vid, device, browser, os, cell(extra, 300)];
}
function anaPick(list, allowed, dflt) {
  var a = Array.isArray(list) ? list : String(list || '').split(/[,\s]+/), out = [];
  a.forEach(function (k) { if (allowed.indexOf(k) >= 0 && out.indexOf(k) < 0) out.push(k); });
  return out.length ? out : dflt;
}
function anaNum(v, dflt) { var n = Number(v); return isFinite(n) && n > 0 ? n : dflt; }

/** One log / error / task line (called from anaHit: secret, project switch and domain allow-list already checked). */
function anaEventHit(key, b) {
  var cache = CacheService.getScriptCache(), min = Math.floor(Date.now() / 60000);
  var rk = 'ae:' + key + ':' + min, n = Number(cache.get(rk) || 0) + 1;
  cache.put(rk, String(n), 120);
  if (n > intProp('ANA_EVENT_RATE_PER_MIN', 120)) return { ok: false, reason: 'rate' };
  var kind = b.kind === 'er' || b.kind === 'tk' ? b.kind : 'lg';
  var status = kind === 'tk' ? (['start', 'ok', 'fail'].indexOf(b.st) >= 0 ? b.st : 'ok') : '';
  var level = ANA_LEVELS.indexOf(b.lv) >= 0 ? b.lv : (kind === 'er' ? 'error' : 'info');
  if (kind === 'er') level = 'error';
  if (status === 'fail' && level === 'info') level = 'error';
  var name = anaScrub(b.e, 60), msg = anaScrub(b.msg, 300);
  if (!name && !msg) return { ok: false };
  var fp = anaFp(kind, name, msg), fk = 'af:' + key + ':' + fp + ':' + min, fn = Number(cache.get(fk) || 0) + 1;
  cache.put(fk, String(fn), 120);
  if (fn > 10) return { ok: false, reason: 'dup' };
  var device = b.device === 'server' ? 'server' : (ANA_DEVICES.indexOf(b.device) >= 0 ? b.device : 'other');
  sheetTab('Events', ANA_EVT_HEADERS).appendRow(anaEvtRow(Date.now(), key, kind, level, name, msg, status, Math.min(86400000, Math.round(anaNum(b.ms, 0))), b.p ? anaScrub(b.p, 200) : '', fp,
    /^[0-9a-f]{8,16}$/.test(String(b.vid || '')) ? 'v' + b.vid : '', device, anaSmall(b.browser, 24, /[^\w .\-]/g), anaSmall(b.os, 24, /[^\w .\-]/g), anaScrub(b.x, 300)));
  return { ok: true };
}

function anaEvtRead(keys, since) {
  var sh = sheetTab('Events', ANA_EVT_HEADERS), last = sh.getLastRow();
  if (last < 2) return [];
  var from = Math.max(2, last - ANA_EVT_SCAN_ROWS + 1), vals = sh.getRange(from, 1, last - from + 1, ANA_EVT_HEADERS.length).getValues(), out = [];
  for (var i = 0; i < vals.length; i++) {
    var r = vals[i];
    if (keys && !keys[String(r[1])]) continue;
    var t = r[0] instanceof Date ? r[0].getTime() : Number(r[0]);
    if (!isFinite(t) || t < since) continue;
    out.push({ t: t, key: String(r[1]), kind: String(r[2]), level: String(r[3]), name: String(r[4] || ''), msg: String(r[5] || ''), status: String(r[6] || ''), ms: Number(r[7]) || 0,
      page: String(r[8] || ''), fp: String(r[9] || ''), vid: String(r[10] || ''), device: String(r[11] || ''), browser: String(r[12] || ''), os: String(r[13] || ''), x: String(r[14] || '') });
  }
  return out;
}
function anaHitRows(keys, since, kinds, onlyKey) {
  var want = { ev: kinds.indexOf('ev') >= 0, pv: kinds.indexOf('pv') >= 0 }, out = [];
  if (!want.ev && !want.pv) return out;
  anaRead(onlyKey || null).forEach(function (r) {
    if (!keys[r.key] || r.bot || r.t < since || !want[r.type]) return;
    out.push({ t: r.t, key: r.key, kind: r.type, level: 'info', name: r.name, msg: '', status: '', ms: 0, page: r.type === 'pv' ? r.name : '', fp: '', vid: r.vid, device: r.device, browser: r.browser, os: r.os, x: '' });
  });
  return out;
}
/** What the page may see: never the visitor hash, only its first 4 characters. */
function anaOut(e, names) {
  return { t: e.t, key: e.key, site: names[e.key] || e.key, kind: e.kind, level: e.level, name: e.name, msg: e.msg, status: e.status, ms: e.ms, page: e.page, fp: e.fp,
    v: e.vid ? e.vid.slice(1, 5) : '', device: e.device, browser: e.browser, os: e.os, x: e.x };
}
function anaIsProblem(e) { return e.level === 'error' || e.level === 'warn'; }

function anaProblems(keys, now) {
  var out = Object.create(null), k;
  for (k in keys) { var z = []; for (var h = 0; h < 24; h++) z.push(0); out[k] = { err24: 0, warn24: 0, fail24: 0, ok24: 0, err1h: 0, lastEvt: 0, series: z }; }
  anaEvtRead(keys, now - 86400000).forEach(function (e) {
    var a = out[e.key]; if (!a) return;
    if (e.t > a.lastEvt) a.lastEvt = e.t;
    if (e.kind === 'tk' && e.status === 'ok') a.ok24++;
    if (e.kind === 'tk' && e.status === 'fail') a.fail24++;
    if (e.kind !== 'hc') { if (e.level === 'error') { a.err24++; if (e.t >= now - 3600000) a.err1h++; } else if (e.level === 'warn') a.warn24++; }   // up/down comes from Health, so a past outage is not an "error" once the site is back
    if (anaIsProblem(e)) a.series[Math.max(0, 23 - Math.floor((now - e.t) / 3600000))]++;
  });
  return out;
}

/* ------------------------------------ uptime ------------------------------------ */

function anaHealthAll() {
  var sh = sheetTab('Health', ANA_HEALTH_HEADERS), last = sh.getLastRow(), map = Object.create(null);
  if (last < 2) return map;
  sh.getRange(2, 1, last - 1, ANA_HEALTH_HEADERS.length).getValues().forEach(function (r, i) {
    if (!r[0]) return;
    map[String(r[0])] = { row: i + 2, state: String(r[1] || 'unknown'), code: Number(r[2]) || 0, ms: Number(r[3]) || 0, checked: Number(r[4]) || 0, since: Number(r[5]) || 0, fails: Number(r[6]) || 0 };
  });
  return map;
}
/** "Down" needs 2 failed checks in a row. 401/403 count as up. Only a change of state writes an Events line. */
function anaHealthApply(sh, map, s, code, ms) {
  var now = Date.now(), prev = map[s.key] || null, okish = (code >= 200 && code < 400) || code === 401 || code === 403;
  var fails = okish ? 0 : (prev ? prev.fails : 0) + 1;
  var state = okish ? 'up' : (fails >= 2 ? 'down' : (prev ? prev.state : 'unknown'));
  var since = prev && prev.state === state ? prev.since : now, wasDown = !!prev && prev.state === 'down', downFor = prev ? now - prev.since : 0;
  var row = [s.key, state, code, ms, now, since, fails], at = prev ? prev.row : 0;
  if (prev) sh.getRange(prev.row, 1, 1, 7).setValues([row]); else { sh.appendRow(row); at = sh.getLastRow(); }
  map[s.key] = { row: at, state: state, code: code, ms: ms, checked: now, since: since, fails: fails };
  if (state === 'down' && !wasDown) {
    sheetTab('Events', ANA_EVT_HEADERS).appendRow(anaEvtRow(now, s.key, 'hc', 'error', ANA_PING_NAME, 'เข้าเว็บไม่ได้ (' + (code ? 'HTTP ' + code : 'ไม่มีการตอบกลับ') + ')', 'down', ms, '', anaFp('hc', ANA_PING_NAME, 'down'), '', 'server', '', '', ''));
  } else if (state === 'up' && wasDown) {
    sheetTab('Events', ANA_EVT_HEADERS).appendRow(anaEvtRow(now, s.key, 'hc', 'info', ANA_PING_NAME, 'กลับมาใช้งานได้ (HTTP ' + code + ') · ล่มนาน ' + Math.max(1, Math.round(downFor / 60000)) + ' นาที', 'up', ms, '', anaFp('hc', ANA_PING_NAME, 'up'), '', 'server', '', '', ''));
  }
  return state;
}
/** Every 10 min: GET each active project's website. Stops before the 6-minute limit. */
function anaPingJob() {
  try {
    if (prop('ANA_PING') === 'off') return;
    var t0 = Date.now(), sites = anaAll().filter(function (s) { return s.status === 'active' && s.track && /^https?:\/\//i.test(s.url); }).slice(0, intProp('ANA_PING_MAX', 40));
    if (!sites.length) return;
    var map = anaHealthAll(), sh = sheetTab('Health', ANA_HEALTH_HEADERS);
    sites.forEach(function (s) {
      if (Date.now() - t0 > 240000) return;
      var url; try { url = lnkCheckUrl(s.url); } catch (x) { return; }
      var code = 0, t1 = Date.now();
      try { code = UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true, followRedirects: true, headers: { 'User-Agent': 'SAND-Monitor/1.0' } }).getResponseCode(); } catch (e) { code = 0; }
      try { anaHealthApply(sh, map, s, code, Date.now() - t1); } catch (e2) { console.error('anaHealthApply ' + e2); }
    });
  } catch (x) { console.error('anaPingJob ' + x); }
}
function anaPruneEvents() {
  var sh = sheetTab('Events', ANA_EVT_HEADERS), last = sh.getLastRow();
  if (last < 2) return 0;
  var cutoff = Date.now() - intProp('ANA_EVENT_RETENTION_DAYS', 90) * 86400000, ts = sh.getRange(2, 1, last - 1, 1).getValues(), n = 0;
  while (n < ts.length && Number(ts[n][0]) < cutoff) n++;
  if (n > 0) sh.deleteRows(2, n);
  return n;
}

/* ------------------------------ projects/monitor ------------------------------ */
/** → {generated, totals:{down,error,warn,ok,wait,off}, items:[{key,name,url,tags,state,reasons[],health,err24,warn24,fail24,ok24,err1h,pv24,ev24,lastHit,lastEvent,series[24]}]} */
function anaMonitor(sc) {
  var ck = 'mo:' + simScope(sc), hit = simCacheGet(ck);
  if (hit) return hit;
  var p = simPrepare(sc), now = Date.now(), pr = anaProblems(p.keys, now), hl = anaHealthAll(), agg = Object.create(null);
  p.sites.forEach(function (s) { agg[s.key] = { last: 0, pv24: 0, ev24: 0, pv7: 0 }; });
  anaRead(null).forEach(function (r) {
    var a = agg[r.key]; if (!a || r.bot) return;
    if (r.t > a.last) a.last = r.t;
    if (r.type === 'pv' && r.t >= now - 7 * 86400000) a.pv7++;
    if (r.t >= now - 86400000) { if (r.type === 'pv') a.pv24++; else a.ev24++; }
  });
  var totals = { down: 0, error: 0, warn: 0, ok: 0, wait: 0, off: 0 };
  var items = p.sites.map(function (s) {
    var a = agg[s.key], q = pr[s.key], h = hl[s.key] || null, reasons = [], state, on = s.track && s.status === 'active';
    if (on && h && h.state === 'down') reasons.push('down');
    if (on && q.err1h > 0) reasons.push('err1h');
    if (on && q.err24 > 0) reasons.push('err24');
    if (on && q.fail24 > 0) reasons.push('taskfail');
    if (on && a.last && now - a.last > 86400000 && a.pv7 >= 20) reasons.push('quiet');
    if (on && h && h.state === 'up' && h.ms > 8000) reasons.push('slow');
    if (on && !a.last && !q.lastEvt && !h) reasons.push('nodata');
    if (!on) state = 'off';
    else if (reasons.indexOf('down') >= 0) state = 'down';
    else if (reasons.indexOf('err1h') >= 0) state = 'error';
    else if (reasons.indexOf('nodata') >= 0) state = 'wait';
    else if (reasons.length) state = 'warn';
    else state = 'ok';
    totals[state]++;
    return { key: s.key, name: s.name, url: s.url, tags: s.tags, state: state, reasons: reasons, health: h ? { state: h.state, code: h.code, ms: h.ms, checked: h.checked, since: h.since } : null,
      err24: q.err24, warn24: q.warn24, fail24: q.fail24, ok24: q.ok24, err1h: q.err1h, pv24: a.pv24, ev24: a.ev24, lastHit: a.last, lastEvent: q.lastEvt, series: q.series };
  });
  var out = { generated: now, totals: totals, items: items };
  simCachePut(ck, out, 30);
  return out;
}

/* -------------------------------- projects/feed -------------------------------- */
/** feed {key?, kinds?, level?, q?, fp?, hours?, from?, to?, before?, limit?, order?} → {items, total, more, next, from, to, kindCount} (newest first) */
function anaFeed(sc, b) {
  var p = simPrepare(sc), keys = p.keys, onlyKey = '';
  if (b.key) { anaOwned(sc, b.key); onlyKey = String(b.key); keys = {}; keys[onlyKey] = p.keys[onlyKey]; }
  var kinds = anaPick(b.kinds, ANA_FEED_KINDS, ['er', 'lg', 'tk', 'hc', 'ev']);
  var level = ['info', 'warn', 'error', 'problem'].indexOf(b.level) >= 0 ? b.level : '';
  var q = String(b.q || '').toLowerCase().replace(/[\u0000-\u001f]/g, '').trim().slice(0, 60);
  var fp = /^[a-z0-9]{1,10}$/.test(String(b.fp || '')) ? String(b.fp) : '';
  var now = Date.now(), base = now - (now % 20000), hours = [1, 6, 24, 168, 720].indexOf(Number(b.hours)) >= 0 ? Number(b.hours) : 24;
  var to = anaNum(b.to, base + 60000), from = anaNum(b.from, base - hours * 3600000), before = anaNum(b.before, 0);
  var limit = Math.max(1, Math.min(200, parseInt(b.limit, 10) || 60)), asc = b.order === 'asc';
  var ck = 'fd:' + simScope(sc) + ':' + onlyKey + ':' + kinds.join('') + ':' + level + ':' + q + ':' + fp + ':' + from + ':' + to + ':' + before + ':' + limit + (asc ? 'a' : 'd'), hit = simCacheGet(ck);
  if (hit) return hit;
  var names = Object.create(null); p.sites.forEach(function (s) { names[s.key] = s.name; });
  var rows = anaEvtRead(keys, from).filter(function (e) { return e.t <= to; }).concat(anaHitRows(keys, from, kinds, onlyKey).filter(function (e) { return e.t <= to; }));
  var kindCount = { er: 0, lg: 0, tk: 0, hc: 0, ev: 0, pv: 0 }, shown = [];
  rows.forEach(function (e) {
    if (level === 'problem' ? !anaIsProblem(e) : level && e.level !== level) return;
    if (fp && e.fp !== fp) return;
    if (q && (e.name + ' ' + e.msg + ' ' + e.page + ' ' + (names[e.key] || '') + ' ' + e.x).toLowerCase().indexOf(q) < 0) return;
    kindCount[e.kind] = (kindCount[e.kind] || 0) + 1;
    if (kinds.indexOf(e.kind) >= 0) shown.push(e);
  });
  shown.sort(function (a, c) { return asc ? a.t - c.t : c.t - a.t; });
  if (before) shown = shown.filter(function (e) { return asc ? e.t > before : e.t < before; });
  var more = shown.length > limit, page = shown.slice(0, limit);
  var out = { items: page.map(function (e) { return anaOut(e, names); }), total: shown.length, more: more, next: page.length ? page[page.length - 1].t : 0, from: from, to: to, kindCount: kindCount };
  simCachePut(ck, out, 20);
  return out;
}
/** around {key, t, mins?} → everything one project did around moment t (oldest first). */
function anaAround(sc, b) {
  var t = anaNum(b.t, 0); if (!t) throw httpError('BAD_REQUEST', 'ไม่ระบุเวลา');
  var w = Math.max(1, Math.min(60, parseInt(b.mins, 10) || 10)) * 60000;
  return anaFeed(sc, { key: b.key, kinds: ANA_FEED_KINDS.join(','), from: t - w, to: t + w, order: 'asc', limit: 200 });
}

/* ------------------------------- projects/issues ------------------------------- */
/** issues {key?, hours?: 24|168|720} → repeated problems grouped by fingerprint (worst first) */
function anaIssues(sc, b) {
  var p = simPrepare(sc), keys = p.keys;
  if (b.key) { anaOwned(sc, b.key); keys = {}; keys[String(b.key)] = p.keys[String(b.key)]; }
  var hours = [24, 168, 720].indexOf(Number(b.hours)) >= 0 ? Number(b.hours) : 168, now = Date.now(), since = now - hours * 3600000, step = (hours * 3600000) / 12;
  var names = Object.create(null); p.sites.forEach(function (s) { names[s.key] = s.name; });
  var groups = Object.create(null);
  anaEvtRead(keys, since).forEach(function (e) {
    if (!anaIsProblem(e)) return;
    var gk = e.key + ':' + (e.fp || e.name), g = groups[gk];
    if (!g) g = groups[gk] = { fp: e.fp, key: e.key, site: names[e.key] || e.key, kind: e.kind, level: e.level, name: e.name, msg: e.msg, n: 0, users: Object.create(null), first: e.t, last: e.t, trend: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], pages: Object.create(null) };
    g.n++;
    if (e.level === 'error') g.level = 'error';
    if (e.t < g.first) g.first = e.t;
    if (e.t >= g.last) { g.last = e.t; g.msg = e.msg; g.name = e.name; }
    g.users[(e.vid || ('x' + g.n)) + anaDay(e.t)] = 1;
    g.trend[Math.max(0, Math.min(11, Math.floor((e.t - since) / step)))]++;
    if (e.page) lnkBump(g.pages, e.page);
  });
  var items = Object.keys(groups).map(function (k) { var g = groups[k]; g.users = Object.keys(g.users).length; g.pages = lnkTop(g.pages, 3); return g; })
    .sort(function (a, c) { return (c.level === 'error') - (a.level === 'error') || c.n - a.n || c.last - a.last; }).slice(0, 50);
  return { hours: hours, items: items };
}
