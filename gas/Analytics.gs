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
 *   POST {action:"projects", session, op: list | names | create | update | delete | stats}
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
    pv7: x.pv7 || 0, uv7: x.uv7 || 0, last: x.last || 0, links: x.links || 0, linkClicks: x.linkClicks || 0, qrs: x.qrs || 0 };
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
  return { admin: sc.admin, base: lnkBase(), items: mine.map(function (s) { var a = keys[s.key]; return anaPublic(s, { pv7: a.pv7, uv7: Object.keys(a.uvd).length, last: a.last, links: a.links, linkClicks: a.linkClicks, qrs: a.qrs }); })
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
  var sites = sheetTab('Sites', ANA_SITE_HEADERS), hits = sheetTab('Hits', ANA_HIT_HEADERS);
  [[sites, ANA_SITE_HEADERS, [110, 220, 300, 260, 200, 150, 80, 260, 160, 80], '#3758f9'], [hits, ANA_HIT_HEADERS, [160, 110, 60, 300, 160, 70, 90, 110, 110, 130, 70, 100, 50], '#c2410c']].forEach(function (t) {
    var sh = t[0];
    sh.getRange(1, 1, 1, t[1].length).setFontWeight('bold').setFontColor('#ffffff').setBackground('#0f5c9e');
    sh.setFrozenRows(1); t[2].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); }); sh.setTabColor(t[3]);
  });
  sites.getRange(2, 1, Math.max(sites.getMaxRows() - 1, 1), 4).setNumberFormat('@');
  hits.getRange(2, 1, Math.max(hits.getMaxRows() - 1, 1), 1).setNumberFormat('0');
  var links = sheetTab('Links', LNK_LINK_HEADERS);
  links.getRange(1, 12, 1, 7).setValues([['โครงการ', 'ชนิด', 'ข้อมูล QR', 'ที่มา', 'ลิงก์ย่อ (URL)', 'รูป QR (Drive id)', 'รูป QR (URL)']]).setFontWeight('bold').setFontColor('#ffffff').setBackground('#0f5c9e'); links.setColumnWidth(12, 110);
  ScriptApp.getProjectTriggers().forEach(function (t) { var f = t.getHandlerFunction(); if (f === 'anaFlushJob' || f === 'anaPruneJob') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('anaFlushJob').timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger('anaPruneJob').timeBased().everyDays(1).atHour(3).create();
  if (!prop('EDGE_SECRET')) setupLinks();
  console.log('พร้อมใช้งาน — แท็บ Sites, Hits และทริกเกอร์เขียนข้อมูลทุกนาที/ล้างข้อมูลเก่าทุกคืนถูกสร้างแล้ว\nอย่าลืมตั้ง SAND_EDGE_SECRET ใน Vercel ให้เท่ากับ EDGE_SECRET (ดูได้ใน Project Settings → Script properties)');
}