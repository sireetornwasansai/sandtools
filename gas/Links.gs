/**
 * SAND Office Tools — Short links with click statistics (ลิงก์ย่อและสถิติ).
 *
 * Public part (no login):
 *   GET  ?action=go&c=<code>          resolves a short code to its target (used by the Vercel edge function /api/go)
 *   POST {action:"click", secret,…}   records one visit — only accepted with EDGE_SECRET, which only the edge function knows
 * Signed-in part:
 *   POST {action:"links", session, op: list | get | create | update | delete | stats | export}
 *     create: kind 'link' (default) | 'qr' (tracked QR) | 'qrs' (static QR saved in the history)
 *
 * Sheet tabs (created by setupLinks):  Links (one row per short link)  ·  Clicks (one row per visit, newest at the bottom)
 *
 * Privacy (PDPA): no IP address is ever stored. The edge function sends only country, device class, browser, OS, the referring
 * host and a salted one-way hash used to count unique visitors. Link-preview robots are flagged and not counted.
 *
 * Script properties:
 *   EDGE_SECRET            (required)  created by setupLinks(); the same value must be set in Vercel as SAND_EDGE_SECRET
 *   SHORT_BASE             (optional)  e.g. https://sand.example.go.th — used to build short URLs and to refuse loops
 *   LINK_BLOCK_DOMAINS     (optional)  comma-separated domains that cannot be shortened
 *   LINK_MAX_PER_USER      (optional)  active short links per user, default 500
 *   QR_MAX_PER_USER        (optional)  saved QR codes (history) per user, default 1000
 *   LINK_LIMIT_PER_MIN     (optional)  create/update calls per minute (all users), default 60
 * A link can be attached to a project (Analytics.gs) through the 12th column "โครงการ".
 * The same table also stores QR Codes (column 13 "ชนิด"): kind 'link' = plain short link, 'qr' = tracked QR (a QR that encodes the short URL, so scans
 * are counted and the destination can be edited later), 'qrs' = static QR saved in the history (no short link, no statistics). Column 14 holds the QR
 * design / form data as JSON (never a Wi-Fi password).
 * QR history = every row whose kind is 'qr' or 'qrs' (title = what the QR is for, tags/note/"cat" = category). Statistics of a tracked QR are the visits
 * of its short link (every visit through a tracked QR's short URL is a "scan"; robots are not counted).
 * Uses helpers from Code.gs (requireUser, sheetTab, cell, rateLimit, httpError, prop, intProp, listProp, safeEqual) and Library.gs.
 */

var LNK_LINK_HEADERS = ['รหัสลิงก์', 'ปลายทาง', 'ชื่อเรียก', 'เจ้าของ', 'สร้างเมื่อ', 'หมดอายุ', 'สถานะ', 'หมายเหตุ', 'แท็ก', 'อ้างอิง (Drive id)', 'ชนิดอ้างอิง', 'โครงการ', 'ชนิด', 'ข้อมูล QR'];
var LNK_COLS = 14;
var LNK_KINDS = ['link', 'qr', 'qrs'];
var LNK_QR_TYPES = ['url', 'text', 'wifi', 'email', 'phone', 'sms', 'vcard'];
var LNK_QR_STYLES = ['square', 'rounded', 'dots'];
var LNK_CLICK_HEADERS = ['เวลา', 'รหัสลิงก์', 'ประเทศ', 'อุปกรณ์', 'เบราว์เซอร์', 'ระบบปฏิบัติการ', 'มาจาก', 'ผู้เข้าชม (hash)', 'บอท'];
var LNK_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';   // no look-alike characters (i l o 0 1)
var LNK_CODE_LEN = 7;
var LNK_URL_MAX = 2000;
var LNK_SCAN_ROWS = 60000;     // newest click rows read per request
var LNK_CACHE_S = 21600;
var LNK_TZ = 'Asia/Bangkok';
var LNK_RESERVED = ['api', 's', 'admin', 'login', 'static', 'assets', 'links', 'link', 'go', 'new', 'stats', 'sw', 'config', 'index', 'css', 'js', 'icons', 'manifest'];
var LNK_DEVICES = ['mobile', 'desktop', 'tablet', 'bot', 'other'];

/* --------------------------------- helpers -------------------------------- */

function lnkStamp(ms) { return ms ? Utilities.formatDate(new Date(ms), LNK_TZ, 'yyyy-MM-dd HH:mm:ss') : ''; }
function lnkParse(s) {
  s = String(s || '').trim();
  if (!s) return 0;
  var t = Date.parse(s.replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? '' : '+07:00'));
  return isFinite(t) ? t : 0;
}
/** Text that must stay text in a Sheet cell (no formula, no number coercion). */
function lnkText(v, max) {
  v = cell(v, max);
  return /^\d+$/.test(v) ? "'" + v : v;
}
/** Runs fn under the script lock so two simultaneous creates can never get the same code. */
function lnkLocked(fn) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (x) { throw httpError('BUSY', 'ระบบกำลังประมวลผลคำขออื่นอยู่ กรุณาลองใหม่อีกครั้ง'); }
  try { return fn(); } finally { try { lock.releaseLock(); } catch (y) { /* not held */ } }
}
function lnkScope(u) {
  return { email: u.email, admin: listProp('ADMIN_EMAILS').indexOf(u.email) >= 0, rootId: prop('DRIVE_FOLDER_ID'), memo: {} };
}
function lnkLog(u, op, code, extra, tool) {
  try { sheetTab('Logs', LOG_HEADERS).appendRow([new Date(), Utilities.getUuid().slice(0, 8), u.email, tool || 'links', op, 'ok', cell(code, 200), 0, 0, cell(JSON.stringify(extra || {}), 500)]); } catch (x) { console.error('lnkLog ' + x); }
}
function lnkObj(r, row) {
  return { row: row, code: String(r[0]), url: String(r[1]), title: String(r[2] || ''), owner: String(r[3] || '').toLowerCase(), created: String(r[4] || ''), expires: String(r[5] || ''),
    status: String(r[6] || 'active'), note: String(r[7] || ''), tags: libTags(String(r[8] || '')), ref: String(r[9] || ''), refKind: String(r[10] || ''), project: String(r[11] || ''), kind: LNK_KINDS.indexOf(String(r[12])) >= 0 ? String(r[12]) : 'link', data: String(r[13] || '') };
}
function lnkRowOf(l) {
  return [l.code, l.url, lnkText(l.title, 120), l.owner, l.created, l.expires, l.status, lnkText(l.note, 300), l.tags.join(', '), l.ref, l.refKind, l.project || '', l.kind || 'link', l.data || ''];
}
function lnkAll() {
  var sh = sheetTab('Links', LNK_LINK_HEADERS), last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, LNK_COLS).getValues().map(function (r, i) { return lnkObj(r, i + 2); }).filter(function (l) { return l.code; });
}
function lnkFind(code) {
  var all = lnkAll();
  for (var i = 0; i < all.length; i++) if (all[i].code === code) return all[i];
  return null;
}
function lnkPublic(l, c) {
  c = c || {};
  return { code: l.code, url: l.url, title: l.title, owner: l.owner, created: l.created, expires: l.expires, status: l.status, note: l.note, tags: l.tags, ref: l.ref, refKind: l.refKind, project: l.project || '', kind: l.kind || 'link', qr: lnkQrParse(l.data),
    clicks: c.total || 0, week: c.week || 0, last: c.last || 0 };
}
function lnkBase() { return prop('SHORT_BASE').replace(/\/+$/, ''); }
function lnkUncache(code) { try { CacheService.getScriptCache().remove('lk:' + code); } catch (x) { /* ignore */ } }

/** Validate and normalise a target URL. Only http(s); no embedded credentials; no loops; optional domain block list. */
function lnkCheckUrl(raw) {
  var s = String(raw == null ? '' : raw).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!s) throw httpError('BAD_URL', 'กรุณาวางลิงก์ที่ต้องการย่อ');
  if (!/^[a-z][a-z0-9+.\-]*:/i.test(s)) s = 'https://' + s.replace(/^\/+/, '');
  if (!/^https?:\/\//i.test(s)) throw httpError('BAD_URL', 'รองรับเฉพาะลิงก์ที่ขึ้นต้นด้วย http:// หรือ https://');
  if (/\s/.test(s)) throw httpError('BAD_URL', 'ลิงก์มีช่องว่าง กรุณาตรวจสอบอีกครั้ง');
  var m = /^https?:\/\/([^\/?#]*)/i.exec(s), auth = m ? m[1] : '';
  if (!auth) throw httpError('BAD_URL', 'ลิงก์ไม่ถูกต้อง');
  if (auth.indexOf('@') >= 0) throw httpError('BAD_URL', 'ไม่รองรับลิงก์ที่มีชื่อผู้ใช้/รหัสผ่านฝังอยู่');
  if (/[^\x21-\x7e]/.test(auth)) throw httpError('BAD_URL', 'ชื่อโดเมนต้องเป็นอักษรภาษาอังกฤษ (ให้คัดลอกลิงก์จากแถบที่อยู่ของเบราว์เซอร์)');
  s = s.replace(/[^\x21-\x7e]+/g, function (c) { return encodeURIComponent(c); });
  if (s.length > LNK_URL_MAX) throw httpError('BAD_URL', 'ลิงก์ยาวเกินไป (สูงสุด 2,000 ตัวอักษร)');
  var host = auth.replace(/:\d+$/, '').toLowerCase();
  listProp('LINK_BLOCK_DOMAINS').forEach(function (d) {
    if (host === d || host.slice(-(d.length + 1)) === '.' + d) throw httpError('BLOCKED', 'โดเมนนี้ไม่อนุญาตให้ย่อลิงก์');
  });
  var base = lnkBase();
  if (base) {
    var bm = /^https?:\/\/([^\/?#:]*)/i.exec(base);
    if (bm && bm[1].toLowerCase() === host && /^https?:\/\/[^\/?#]*\/s\//i.test(s)) throw httpError('LOOP', 'ไม่สามารถย่อลิงก์ย่อซ้ำได้');
  }
  return s;
}
function lnkQrParse(data) { if (!data) return null; try { return JSON.parse(data); } catch (x) { return null; } }
/** Validate the QR part of a request: {t: type, f: form fields (static only), d: design}. Returns the JSON text to store. */
function lnkQrData(q, kind) {
  q = (q && typeof q === 'object') ? q : {};
  var t = String(q.t || 'url');
  if (LNK_QR_TYPES.indexOf(t) < 0) throw httpError('BAD_REQUEST', 'ชนิด QR ไม่ถูกต้อง');
  var out = { t: t }, d = (q.d && typeof q.d === 'object') ? q.d : {};
  var color = function (v, dflt) { return /^#[0-9a-fA-F]{6}$/.test(String(v || '')) ? String(v).toLowerCase() : dflt; };
  out.d = { fg: color(d.fg, '#000000'), bg: color(d.bg, '#ffffff'), style: LNK_QR_STYLES.indexOf(d.style) >= 0 ? d.style : 'square',
    ec: ['L', 'M', 'Q', 'H'].indexOf(d.ec) >= 0 ? d.ec : 'M', margin: Math.min(16, Math.max(0, parseInt(d.margin, 10) || 0)), size: Math.min(2048, Math.max(128, parseInt(d.size, 10) || 512)),
    cat: String(d.cat || 'general').replace(/[^a-z]/g, '').slice(0, 12) || 'general', cap: String(d.cap || '').replace(/[\u0000-\u001f]/g, ' ').slice(0, 40) };
  if (kind === 'qrs') {
    var f = (q.f && typeof q.f === 'object') ? q.f : {}, keys = Object.keys(f).slice(0, 14), o = {};
    if (t === 'wifi' && String(f.password || '')) throw httpError('NO_SECRET', 'ไม่บันทึกรหัสผ่าน Wi-Fi ลงในประวัติ — เว้นช่องรหัสผ่านก่อนบันทึก');
    keys.forEach(function (k) { if (/^[a-zA-Z]{1,20}$/.test(k) && k !== 'password') o[k] = String(f[k] == null ? '' : f[k]).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').slice(0, 600); });
    out.f = o;
  }
  var json = JSON.stringify(out);
  if (json.length > 3000) throw httpError('BAD_REQUEST', 'ข้อมูล QR ยาวเกินไปสำหรับบันทึกในประวัติ');
  return json;
}
/** '' clears the project; otherwise it must be a project the user may use. */
function lnkProject(sc, v) {
  v = String(v == null ? '' : v);
  if (!v) return '';
  return anaOwned(sc, v).key;
}
function lnkExpiry(v) {
  if (v === undefined || v === null || v === '') return '';
  var t = lnkParse(v);
  if (!t) throw httpError('BAD_REQUEST', 'วันหมดอายุไม่ถูกต้อง');
  if (t < Date.now()) throw httpError('BAD_REQUEST', 'วันหมดอายุต้องเป็นเวลาในอนาคต');
  return lnkStamp(t);
}
function lnkCodeFor(alias, taken) {
  if (alias) {
    var a = String(alias).toLowerCase().trim();
    if (!/^(?=.*[a-z])[a-z0-9_-]{3,32}$/.test(a) || /^\d+e\d+$/.test(a)) throw httpError('BAD_ALIAS', 'ชื่อลิงก์ใช้ได้เฉพาะ a-z 0-9 - _ ความยาว 3–32 ตัว และต้องมีตัวอักษรอย่างน้อย 1 ตัว');
    if (LNK_RESERVED.indexOf(a) >= 0 || taken[a]) throw httpError('DUPLICATE', 'ชื่อลิงก์นี้ถูกใช้แล้ว กรุณาเลือกชื่ออื่น');
    return a;
  }
  for (var n = 0; n < 12; n++) {
    var c = '';
    for (var i = 0; i < LNK_CODE_LEN; i++) c += LNK_ALPHABET.charAt(Math.floor(Math.random() * LNK_ALPHABET.length));
    if (/[a-z]/.test(c) && !taken[c] && LNK_RESERVED.indexOf(c) < 0) return c;
  }
  throw httpError('INTERNAL_RETRY', 'สร้างรหัสลิงก์ไม่สำเร็จ กรุณาลองใหม่');
}

/* ------------------------------- public: go/click ------------------------------ */

/** Resolve a code. Never throws for "not found" — the edge function shows the right page for each reason. */
function lnkGo(p) {
  var code = String((p && p.c) || '').toLowerCase();
  if (!/^[a-z0-9_-]{3,32}$/.test(code)) return { reason: 'notfound' };
  var cache = CacheService.getScriptCache(), hit = cache.get('lk:' + code), rec = null;
  if (hit) { try { rec = JSON.parse(hit); } catch (x) { rec = null; } }
  if (!rec) {
    rateLimit('lnkgo', intProp('LINK_MISS_LIMIT_PER_MIN', 120));
    var l = lnkFind(code);
    rec = l && l.kind !== 'qrs' ? { u: l.url, x: lnkParse(l.expires), s: l.status } : { n: 1 };
    cache.put('lk:' + code, JSON.stringify(rec), rec.n ? 300 : LNK_CACHE_S);
  }
  if (rec.n || rec.s === 'deleted') return { reason: 'notfound' };
  if (rec.s !== 'active') return { reason: 'disabled' };
  if (rec.x && rec.x < Date.now()) return { reason: 'expired' };
  return { url: rec.u };
}

function lnkSmall(v, max) { return String(v == null ? '' : v).replace(/[^\w .\-+\/]/g, '').slice(0, max); }

/** One visit. Only the edge function (which holds EDGE_SECRET) may call this. */
function lnkClick(b) {
  var secret = prop('EDGE_SECRET');
  if (!secret || !safeEqual(String(b.secret || ''), secret)) throw httpError('FORBIDDEN', 'ไม่อนุญาต');
  var code = String(b.code || '').toLowerCase();
  if (!/^[a-z0-9_-]{3,32}$/.test(code)) throw httpError('BAD_REQUEST', 'รหัสไม่ถูกต้อง');
  if (!CacheService.getScriptCache().get('lk:' + code) && !lnkFind(code)) return { ok: false };
  var country = /^[A-Z]{2}$/.test(String(b.country || '')) ? b.country : '';
  var device = LNK_DEVICES.indexOf(b.device) >= 0 ? b.device : 'other';
  var ref = /^[a-z0-9.\-]{1,80}$/i.test(String(b.ref || '')) ? String(b.ref).toLowerCase() : '';
  var vid = /^[0-9a-f]{8,16}$/.test(String(b.vid || '')) ? 'v' + b.vid : '';
  sheetTab('Clicks', LNK_CLICK_HEADERS).appendRow([new Date(), code, country, device, lnkSmall(b.browser, 24), lnkSmall(b.os, 24), ref, vid, b.bot ? 1 : 0]);
  return { ok: true };
}

/* ------------------------------- click statistics ----------------------------- */

/** Newest click rows → [{t,code,country,device,browser,os,ref,vid,bot}] (only the codes in `only` when given). */
function lnkClicks(only) {
  var sh = sheetTab('Clicks', LNK_CLICK_HEADERS), last = sh.getLastRow();
  if (last < 2) return [];
  var from = Math.max(2, last - LNK_SCAN_ROWS + 1), vals = sh.getRange(from, 1, last - from + 1, 9).getValues(), out = [];
  for (var i = 0; i < vals.length; i++) {
    var r = vals[i], code = String(r[1]);
    if (only && !only[code]) continue;
    var t = r[0] instanceof Date ? r[0].getTime() : Date.parse(String(r[0]));
    if (!isFinite(t)) continue;
    out.push({ t: t, code: code, country: String(r[2] || ''), device: String(r[3] || ''), browser: String(r[4] || ''), os: String(r[5] || ''), ref: String(r[6] || ''), vid: String(r[7] || ''), bot: Number(r[8]) === 1 });
  }
  return out;
}
function lnkTop(map, n) {
  return Object.keys(map).map(function (k) { return { name: k, n: map[k] }; }).sort(function (a, c) { return c.n - a.n; }).slice(0, n || 8);
}
function lnkBump(map, k) { k = k || ''; map[k] = (map[k] || 0) + 1; }

function lnkStats(l, daysIn) {
  var days = [7, 30, 90, 365].indexOf(Number(daysIn)) >= 0 ? Number(daysIn) : 30;
  var only = {}; only[l.code] = true;
  var rows = lnkClicks(only), now = Date.now(), cutoff = now - days * 86400000, wk = now - 7 * 86400000;
  var total = 0, bots = 0, inRange = 0, week = 0, first = 0, last = 0, uniq = {}, uniqRange = {};
  var dev = Object.create(null), br = Object.create(null), os = Object.create(null), co = Object.create(null), rf = Object.create(null), perDay = Object.create(null);
  var hours = []; for (var h = 0; h < 24; h++) hours.push(0);
  rows.forEach(function (r) {
    if (r.bot) { bots++; return; }
    total++; if (r.vid) uniq[r.vid] = 1;
    if (!first || r.t < first) first = r.t;
    if (r.t > last) last = r.t;
    if (r.t >= wk) week++;
    if (r.t < cutoff) return;
    inRange++; if (r.vid) uniqRange[r.vid] = 1;
    lnkBump(dev, r.device); lnkBump(br, r.browser); lnkBump(os, r.os); lnkBump(co, r.country); lnkBump(rf, r.ref);
    lnkBump(perDay, Utilities.formatDate(new Date(r.t), LNK_TZ, 'yyyy-MM-dd'));
    hours[Number(Utilities.formatDate(new Date(r.t), LNK_TZ, 'H'))]++;
  });
  var byDay = [];
  for (var i = days - 1; i >= 0; i--) { var d = Utilities.formatDate(new Date(now - i * 86400000), LNK_TZ, 'yyyy-MM-dd'); byDay.push({ d: d, n: perDay[d] || 0 }); }
  var recent = rows.filter(function (r) { return !r.bot; }).slice(-20).reverse().map(function (r) { return { t: new Date(r.t).toISOString(), country: r.country, device: r.device, browser: r.browser, os: r.os, ref: r.ref }; });
  return {
    link: lnkPublic(l, { total: total, week: week, last: last }), days: days, total: total, unique: Object.keys(uniq).length, bots: bots, inRange: inRange, uniqueInRange: Object.keys(uniqRange).length, week: week,
    first: first ? new Date(first).toISOString() : '', last: last ? new Date(last).toISOString() : '', byDay: byDay, byHour: hours,
    devices: lnkTop(dev, 5), browsers: lnkTop(br, 6), systems: lnkTop(os, 6), countries: lnkTop(co, 8), referrers: lnkTop(rf, 8), recent: recent, scanned: rows.length >= LNK_SCAN_ROWS
  };
}

/* ----------------------------------- actions ---------------------------------- */

function links(b) {
  var u = requireUser(b.session), sc = lnkScope(u), op = String(b.op || '');
  rateLimit('links', intProp('LINK_LIMIT_PER_MIN', 60) * (op === 'list' || op === 'stats' || op === 'export' ? 5 : 1));
  switch (op) {
    case 'list':   return lnkList(sc);
    case 'get':    return { link: lnkPublic(lnkOwned(sc, b.code), null), base: lnkBase() };   // one row without scanning the clicks (used to re-open a saved QR)
    case 'create': return lnkCreate(sc, u, b);
    case 'update': return lnkUpdate(sc, u, b);
    case 'delete': return lnkDelete(sc, u, b);
    case 'stats':  return lnkStats(lnkOwned(sc, b.code), b.days);
    case 'export': return lnkExport(lnkOwned(sc, b.code), b.bots === true);
    default: throw httpError('UNKNOWN_ACTION', 'ไม่รู้จักคำสั่งนี้');
  }
}

/** The link, if it exists, is not deleted and belongs to the user (or the user is an admin). */
function lnkOwned(sc, code) {
  code = String(code || '').toLowerCase();
  var l = /^[a-z0-9_-]{3,32}$/.test(code) ? lnkFind(code) : null;
  if (!l || l.status === 'deleted' || (!sc.admin && l.owner !== sc.email)) throw httpError('NOT_FOUND', 'ไม่พบลิงก์นี้ หรือไม่มีสิทธิ์เข้าถึง');
  return l;
}

function lnkList(sc) {
  var mine = lnkAll().filter(function (l) { return l.status !== 'deleted' && (sc.admin || l.owner === sc.email); });
  var only = {}; mine.forEach(function (l) { only[l.code] = true; });
  var rows = lnkClicks(only), now = Date.now(), wk = now - 7 * 86400000, agg = Object.create(null);
  rows.forEach(function (r) {
    if (r.bot) return;
    var a = agg[r.code] = agg[r.code] || { total: 0, week: 0, last: 0 };
    a.total++; if (r.t >= wk) a.week++; if (r.t > a.last) a.last = r.t;
  });
  var items = mine.map(function (l) { return lnkPublic(l, agg[l.code]); }).sort(function (a, c) { return a.created < c.created ? 1 : -1; });
  return { admin: sc.admin, base: lnkBase(), items: items, scanned: rows.length >= LNK_SCAN_ROWS };
}

function lnkCreate(sc, u, b) { return lnkLocked(function () { return lnkCreateLocked(sc, u, b); }); }
function lnkCreateLocked(sc, u, b) {
  var all = lnkAll(), mine = all.filter(function (l) { return l.owner === sc.email && l.status !== 'deleted'; });
  var kind = LNK_KINDS.indexOf(b.kind) >= 0 ? b.kind : 'link';
  var ref = '', refKind = '', url = '', data = '';
  if (kind === 'qrs') {
    data = lnkQrData(b.qr, 'qrs');
    if (!String(b.title || '').trim()) throw httpError('BAD_REQUEST', 'กรุณาตั้งชื่อ QR');
  } else if (b.ref && kind === 'link') {
    ref = libId(b.ref);
    if (b.refKind === 'folder') { libFolderChain(sc, ref); refKind = 'folder'; url = 'https://drive.google.com/drive/folders/' + ref; }
    else { url = libFile(sc, ref).file.getUrl(); refKind = 'file'; }
    var dup = mine.filter(function (l) { return l.ref === ref && l.refKind === refKind; })[0];
    if (dup) {
      if (b.project !== undefined && lnkProject(sc, b.project) !== dup.project) { dup.project = lnkProject(sc, b.project); sheetTab('Links', LNK_LINK_HEADERS).getRange(dup.row, 1, 1, LNK_COLS).setValues([lnkRowOf(dup)]); }
      return { link: lnkPublic(dup, null), existing: true, base: lnkBase() };
    }
  } else {
    url = lnkCheckUrl(b.url);
    if (kind === 'qr') { b.qr = b.qr || {}; b.qr.t = 'url'; data = lnkQrData(b.qr, 'qr'); if (!String(b.title || '').trim()) throw httpError('BAD_REQUEST', 'กรุณาตั้งชื่อ QR'); }
  }
  if (kind === 'link') {
    if (mine.filter(function (l) { return l.kind === 'link'; }).length >= intProp('LINK_MAX_PER_USER', 500)) throw httpError('LIMIT', 'สร้างลิงก์ครบจำนวนที่กำหนดแล้ว กรุณาลบรายการที่ไม่ใช้');
  } else if (mine.filter(function (l) { return l.kind !== 'link'; }).length >= intProp('QR_MAX_PER_USER', 1000)) throw httpError('LIMIT', 'บันทึก QR ครบจำนวนที่กำหนดแล้ว กรุณาลบรายการที่ไม่ใช้');
  var taken = Object.create(null); all.forEach(function (l) { taken[l.code] = true; });
  var l = { code: lnkCodeFor(kind === 'qrs' ? '' : b.alias, taken), url: url, title: String(b.title || '').trim().slice(0, 120), owner: sc.email, created: lnkStamp(Date.now()), expires: kind === 'qrs' ? '' : lnkExpiry(b.expires),
    status: 'active', note: String(b.note || '').slice(0, 300), tags: libTags(b.tags), ref: ref, refKind: refKind, project: lnkProject(sc, b.project), kind: kind, data: data };
  sheetTab('Links', LNK_LINK_HEADERS).appendRow(lnkRowOf(l));
  lnkUncache(l.code);
  lnkLog(u, 'create', l.code, { kind: kind, host: (/^https?:\/\/([^\/?#]*)/i.exec(url) || [])[1] || '', ref: ref }, kind === 'link' ? 'links' : 'qr');
  return { link: lnkPublic(l, null), existing: false, base: lnkBase() };
}

function lnkUpdate(sc, u, b) { return lnkLocked(function () { return lnkUpdateLocked(sc, u, b); }); }
function lnkUpdateLocked(sc, u, b) {
  var l = lnkOwned(sc, b.code);
  if (b.url !== undefined && !l.ref && l.kind !== 'qrs') l.url = lnkCheckUrl(b.url);
  if (b.qr !== undefined && l.kind !== 'link') { var cur = lnkQrParse(l.data) || {}; b.qr = b.qr || {}; if (l.kind === 'qr') b.qr.t = 'url'; else if (!b.qr.t) b.qr.t = cur.t; l.data = lnkQrData(b.qr, l.kind); }
  if (b.title !== undefined) { l.title = String(b.title).trim().slice(0, 120); if (!l.title && l.kind !== 'link') throw httpError('BAD_REQUEST', 'กรุณาตั้งชื่อ QR'); }
  if (b.note !== undefined) l.note = String(b.note).slice(0, 300);
  if (b.tags !== undefined) l.tags = libTags(b.tags);
  if (b.project !== undefined) l.project = lnkProject(sc, b.project);
  if (b.expires !== undefined) l.expires = b.expires === '' || b.expires === null ? '' : (lnkParse(b.expires) === lnkParse(l.expires) ? l.expires : lnkExpiry(b.expires));
  if (b.status !== undefined) {
    if (['active', 'disabled'].indexOf(b.status) < 0) throw httpError('BAD_REQUEST', 'สถานะไม่ถูกต้อง');
    l.status = b.status;
  }
  var sh = sheetTab('Links', LNK_LINK_HEADERS);
  sh.getRange(l.row, 1, 1, LNK_COLS).setValues([lnkRowOf(l)]);
  lnkUncache(l.code);
  lnkLog(u, 'update', l.code, { status: l.status, kind: l.kind }, l.kind === 'link' ? 'links' : 'qr');
  return { link: lnkPublic(l, null) };
}

/** Soft delete: the row stays (stats are kept and the code can never be re-used for a different target). */
function lnkDelete(sc, u, b) { return lnkLocked(function () { return lnkDeleteLocked(sc, u, b); }); }
function lnkDeleteLocked(sc, u, b) {
  var l = lnkOwned(sc, b.code);
  l.status = 'deleted';
  sheetTab('Links', LNK_LINK_HEADERS).getRange(l.row, 1, 1, LNK_COLS).setValues([lnkRowOf(l)]);
  lnkUncache(l.code);
  lnkLog(u, 'delete', l.code, { kind: l.kind }, l.kind === 'link' ? 'links' : 'qr');
  return { code: l.code };
}

function lnkExport(l, withBots) {
  var only = {}; only[l.code] = true;
  var rows = lnkClicks(only).filter(function (r) { return withBots || !r.bot; }).slice(-5000).reverse();
  return { link: lnkPublic(l, null), rows: rows.map(function (r) { return { t: new Date(r.t).toISOString(), country: r.country, device: r.device, browser: r.browser, os: r.os, ref: r.ref, bot: r.bot }; }) };
}

/* -------------------------------------- setup -------------------------------------- */

/** Run ONCE from the editor: creates the tabs and EDGE_SECRET, and prints what to put in Vercel. Safe to run again. */
function setupLinks() {
  var P = PropertiesService.getScriptProperties();
  if (!P.getProperty('EDGE_SECRET')) P.setProperty('EDGE_SECRET', Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''));
  var links = sheetTab('Links', LNK_LINK_HEADERS), clicks = sheetTab('Clicks', LNK_CLICK_HEADERS);
  [[links, LNK_LINK_HEADERS, [110, 380, 200, 200, 150, 150, 80, 220, 160, 220, 90, 110, 70, 360], '#0b7a7c'], [clicks, LNK_CLICK_HEADERS, [150, 110, 70, 90, 110, 120, 200, 130, 50], '#7e22ce']].forEach(function (t) {
    var sh = t[0];
    sh.getRange(1, 1, 1, t[1].length).setFontWeight('bold').setFontColor('#ffffff').setBackground('#0f5c9e');
    sh.setFrozenRows(1); t[2].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); }); sh.setTabColor(t[3]);
  });
  links.getRange(2, 1, Math.max(links.getMaxRows() - 1, 1), 3).setNumberFormat('@');
  clicks.getRange(2, 1, Math.max(clicks.getMaxRows() - 1, 1), 1).setNumberFormat('dd/MM/yyyy HH:mm:ss');
  links.getRange(1, 12, 1, 3).setValues([['โครงการ', 'ชนิด', 'ข้อมูล QR']]);
  console.log('พร้อมใช้งาน — ตั้งค่าใน Vercel (Settings → Environment Variables):\n  SAND_EDGE_SECRET = ' + P.getProperty('EDGE_SECRET') + '\n  SAND_GAS_URL ต้องตั้งไว้แล้ว (URL ของ Web app /exec)\nจากนั้น Redeploy บน Vercel');
}