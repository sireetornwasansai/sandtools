/**
 * SAND Office Tools — backend (Google Apps Script web app).  FINAL (v1.3.0)
 *
 * This project has FOUR script files — keep them together:
 *   Code.gs     (this file)  entry points, login/session, usage log, file archive, history
 *   Library.gs               คลังข้อมูล: browse/manage the Drive archive, tags, search index   (action "library")
 *   Links.gs                 ลิงก์ย่อและสถิติ                                                  (actions "links", "go", "click")
 *   Analytics.gs             โครงการและสถิติเว็บไซต์ (แนบเว็บ/โครงการเพื่อนับผู้เข้าชม)         (actions "projects", "hit")
 *
 * Responsibilities (kept deliberately small — everything else runs in the browser):
 *   • GET  ?action=health|version        public status check
 *   • GET  ?action=go&c=<code>           public: resolve a short link (called by the Vercel edge function /api/go)
 *   • POST {action:"login", idToken}     verify a Google ID token, enforce the allowed domain, issue a signed session
 *   • POST {action:"me", session}        validate a session
 *   • POST {action:"log"|"archive"|"history"|"library"|"links"|"projects", session, …}   signed-in features
 *   • POST {action:"click"|"hit", secret, …}   public but secret-protected: record one short-link click / website page view (edge functions only)
 *
 * The web app runs as the deploying user. Scopes: script.external_request, script.scriptapp, spreadsheets, drive.
 *
 * Configuration lives in Script Properties (Project Settings → Script properties). Nothing secret is in this file.
 *   GOOGLE_CLIENT_ID      (required)  OAuth Web client ID used by the frontend
 *   ALLOWED_EMAIL_DOMAIN  (optional)  e.g. "example.go.th" or "a.go.th,b.go.th". Empty = any verified Google account
 *   ALLOWED_EMAILS        (optional)  comma-separated exceptions that are allowed even outside the domain
 *   SESSION_SECRET        (required)  created by setup(); never share
 *   SESSION_TTL_MIN       (optional)  default 480
 *   LOGIN_LIMIT_PER_MIN   (optional)  default 30 (global, protects the quota)
 *   LOG_SHEET_ID          (required for logs)   ID of the Google Sheet that receives usage logs (tabs Logs, Files, Index, Links, Clicks)
 *   DRIVE_FOLDER_ID       (required for archive) ID of the Drive folder that receives file copies (yyyy-MM/email/)
 *   ADMIN_EMAILS          (optional)  emails that may see/manage everyone's history, library and short links
 *   ARCHIVE_FILES         (optional)  "false" turns file archiving off (logs continue)
 *   EDGE_SECRET           (links)     created by setupLinks(); must equal SAND_EDGE_SECRET in Vercel
 *   SHORT_BASE            (links, optional)  e.g. https://sand.example.go.th
 *   LIBRARY_USER_DELETE   (library, optional)  "false" = only admins may delete
 *   More optional properties are documented at the top of Library.gs and Links.gs.
 *
 * One-time setup (run from the editor):  setup → setupSheet → setupSearchIndex → setupLinks → setupAnalytics
 */

var APP_VERSION = '1.3.0';
var TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo?id_token=';
var VALID_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
var MAX_BODY_CHARS = 8192;
var MAX_ARCHIVE_CHARS = 14 * 1024 * 1024; // base64 of a ~10 MB file
var LOG_HEADERS = ['เวลา', 'logId', 'อีเมล', 'เครื่องมือ', 'การทำงาน', 'สถานะ', 'ชื่อไฟล์', 'ขนาดก่อน', 'ขนาดหลัง', 'รายละเอียด', 'ลิงก์ไฟล์ต้นฉบับ', 'ลิงก์ไฟล์ผลลัพธ์'];
var FILE_HEADERS = ['เวลา', 'logId', 'อีเมล', 'เครื่องมือ', 'ประเภท', 'ชื่อไฟล์', 'ขนาด (ไบต์)', 'ลิงก์ Drive'];
var MAX_ARCHIVE_BYTES = 10 * 1024 * 1024;
var MAX_TOKEN_CHARS = 4096;

/* ------------------------------ entry points ------------------------------ */

function doGet(e) {
  var ctx = newCtx('get');
  try {
    var action = (e && e.parameter && e.parameter.action) || 'health';
    if (action === 'health') return respond(ctx, { status: 'ok', version: APP_VERSION, time: new Date().toISOString(), configured: isConfigured() });
    if (action === 'version') return respond(ctx, { version: APP_VERSION });
    if (action === 'go') { ctx.op = 'go'; return respond(ctx, lnkGo(e.parameter)); }   // Links.gs — public short-link lookup
    throw httpError('UNKNOWN_ACTION', 'ไม่รู้จักคำสั่งนี้');
  } catch (err) { return fail(ctx, err); }
}

function doPost(e) {
  var ctx = newCtx('post');
  try {
    var raw = (e && e.postData && e.postData.contents) || '';
    if (raw.length > MAX_ARCHIVE_CHARS || (raw.length > MAX_BODY_CHARS && raw.indexOf('"archive"') < 0)) throw httpError('REQUEST_TOO_LARGE', 'คำขอมีขนาดใหญ่เกินไป');
    var body;
    try { body = JSON.parse(raw); } catch (x) { throw httpError('BAD_REQUEST', 'รูปแบบคำขอไม่ถูกต้อง'); }
    if (!body || typeof body !== 'object') throw httpError('BAD_REQUEST', 'รูปแบบคำขอไม่ถูกต้อง');
    ctx.op = String(body.action || '');
    if (body.action !== 'archive' && raw.length > MAX_BODY_CHARS) throw httpError('REQUEST_TOO_LARGE', 'คำขอมีขนาดใหญ่เกินไป');
    switch (body.action) {
      case 'health': return respond(ctx, { status: 'ok', version: APP_VERSION, time: new Date().toISOString(), configured: isConfigured() });
      case 'login': return respond(ctx, login(body.idToken));
      case 'me': return respond(ctx, me(body.session));
      case 'log': return respond(ctx, logUse(body));
      case 'archive': return respond(ctx, archive(body));
      case 'history': return respond(ctx, history(body));
      case 'library': ctx.op = 'library:' + String(body.op || '').slice(0, 12); return respond(ctx, library(body));   // Library.gs
      case 'links': ctx.op = 'links:' + String(body.op || '').slice(0, 10); return respond(ctx, links(body));          // Links.gs
      case 'projects': ctx.op = 'projects:' + String(body.op || '').slice(0, 10); return respond(ctx, projects(body));  // Analytics.gs
      case 'click': return respond(ctx, lnkClick(body));                                                                // Links.gs (edge function only)
      case 'hit': return respond(ctx, anaHit(body));                                                                    // Analytics.gs (edge function only)
      default: throw httpError('UNKNOWN_ACTION', 'ไม่รู้จักคำสั่งนี้');
    }
  } catch (err) { return fail(ctx, err); }
}

/* --------------------------------- actions -------------------------------- */

function login(idToken) {
  rateLimit('login', intProp('LOGIN_LIMIT_PER_MIN', 30));
  if (typeof idToken !== 'string' || !idToken || idToken.length > MAX_TOKEN_CHARS) throw httpError('INVALID_TOKEN', 'ไม่สามารถยืนยันตัวตนได้');
  var claims = verifyIdToken(idToken);
  var email = String(claims.email || '').toLowerCase();
  if (claims.email_verified !== true && claims.email_verified !== 'true') throw httpError('EMAIL_NOT_VERIFIED', 'อีเมลยังไม่ได้รับการยืนยัน');
  if (!isEmailAllowed(email, claims.hd)) throw httpError('DOMAIN_NOT_ALLOWED', 'บัญชีนี้ไม่ได้อยู่ในโดเมนที่อนุญาต');
  var ttl = intProp('SESSION_TTL_MIN', 480) * 60;
  var exp = Math.floor(Date.now() / 1000) + ttl;
  var user = { email: email, name: String(claims.name || ''), picture: String(claims.picture || '') };
  return { session: signSession({ sub: String(claims.sub), email: email, exp: exp }), exp: exp, user: user };
}

function me(session) {
  var p = verifySession(session);
  if (!p) throw httpError('INVALID_SESSION', 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
  // Re-check the allow-list on every call so removing a domain/email takes effect immediately.
  if (!isEmailAllowed(p.email, null)) throw httpError('DOMAIN_NOT_ALLOWED', 'บัญชีนี้ไม่ได้อยู่ในโดเมนที่อนุญาต');
  return { email: p.email, exp: p.exp };
}

/* ------------------------- usage log + file archive ------------------------ */
// Both actions require a valid session. Rows go to the Google Sheet (LOG_SHEET_ID), files to the Drive folder (DRIVE_FOLDER_ID).

function requireUser(session) {
  var p = verifySession(session);
  if (!p) throw httpError('INVALID_SESSION', 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
  if (!isEmailAllowed(p.email, null)) throw httpError('DOMAIN_NOT_ALLOWED', 'บัญชีนี้ไม่ได้อยู่ในโดเมนที่อนุญาต');
  return p;
}
function sheetTab(name, headers) {
  var id = prop('LOG_SHEET_ID');
  if (!id) throw httpError('NOT_CONFIGURED', 'ยังไม่ได้ตั้งค่า LOG_SHEET_ID');
  var ss = SpreadsheetApp.openById(id);
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sh.getLastRow() === 0) { sh.appendRow(headers); sh.setFrozenRows(1); }
  return sh;
}
/** Text for a Sheet cell: trimmed, and neutralised against formula injection (=, +, -, @). */
function cell(v, max) {
  v = String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').slice(0, max || 300);
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}
function logUse(b) {
  var u = requireUser(b.session);
  rateLimit('log', intProp('LOG_LIMIT_PER_MIN', 300));
  var m = (b.meta && typeof b.meta === 'object') ? b.meta : {};
  var logId = Utilities.getUuid().slice(0, 8);
  sheetTab('Logs', LOG_HEADERS).appendRow([
    new Date(), logId, u.email, cell(b.tool, 40), cell(b.op, 40), cell(m.status || 'ok', 20), cell(m.fileName, 200),
    Number(m.sizeIn) || 0, Number(m.sizeOut) || 0, cell(JSON.stringify(m.extra || {}), 500)]);
  return { logId: logId };
}
/** Latest log rows with their archived files. Admins (ADMIN_EMAILS) see everyone's rows; others only their own. */
function history(b) {
  var u = requireUser(b.session);
  rateLimit('history', 60);
  var admin = listProp('ADMIN_EMAILS').indexOf(u.email) >= 0;
  var sh = sheetTab('Logs', LOG_HEADERS);
  var fs = sheetTab('Files', FILE_HEADERS);
  var files = {}, fl = fs.getLastRow();
  if (fl > 1) {
    var fv = fs.getRange(Math.max(2, fl - 999), 1, Math.min(1000, fl - 1), 8).getValues();
    fv.forEach(function (r) {
      if (!admin && String(r[2]).toLowerCase() !== u.email) return;
      (files[r[1]] = files[r[1]] || []).push({ role: r[4], name: r[5], size: r[6], url: r[7] });
    });
  }
  var last = sh.getLastRow(); if (last < 2) return { admin: admin, rows: [] };
  var from = Math.max(2, last - 799);
  var vals = sh.getRange(from, 1, last - from + 1, 9).getValues();
  var rows = [];
  for (var i = vals.length - 1; i >= 0 && rows.length < 200; i--) {
    var r = vals[i];
    if (!admin && String(r[2]).toLowerCase() !== u.email) continue;
    rows.push({ ts: r[0] instanceof Date ? r[0].toISOString() : String(r[0]), logId: r[1], email: r[2], tool: r[3], op: r[4], status: r[5], fileName: r[6], sizeIn: r[7], sizeOut: r[8], files: files[r[1]] || [] });
  }
  return { admin: admin, rows: rows };
}
function subFolder(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}
function archive(b) {
  var u = requireUser(b.session);
  if (prop('ARCHIVE_FILES') === 'false') throw httpError('ARCHIVE_DISABLED', 'หน่วยงานปิดการเก็บสำเนาไฟล์');
  rateLimit('archive', intProp('ARCHIVE_LIMIT_PER_MIN', 60));
  var folderId = prop('DRIVE_FOLDER_ID');
  if (!folderId) throw httpError('NOT_CONFIGURED', 'ยังไม่ได้ตั้งค่า DRIVE_FOLDER_ID');
  if (typeof b.data !== 'string' || !b.data) throw httpError('BAD_REQUEST', 'ไม่พบข้อมูลไฟล์');
  var bytes = Utilities.base64Decode(b.data);
  if (bytes.length > MAX_ARCHIVE_BYTES) throw httpError('FILE_TOO_LARGE', 'ไฟล์ใหญ่เกิน 10 MB ไม่สามารถเก็บสำเนาได้');
  var role = b.role === 'output' ? 'output' : 'input';
  var name = String(b.name || 'file').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '').slice(0, 120) || 'file';
  var mime = /^[\w.+-]+\/[\w.+-]+$/.test(String(b.mime || '')) ? b.mime : 'application/octet-stream';
  var stamp = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM');
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  var file;
  try {
    var dir = subFolder(subFolder(DriveApp.getFolderById(folderId), stamp), u.email);
    file = dir.createFile(Utilities.newBlob(bytes, mime, Utilities.formatDate(new Date(), 'Asia/Bangkok', 'dd-HHmmss') + '_' + role + '_' + name));
  } finally { lock.releaseLock(); }
  try { file.addViewer(u.email); } catch (x) { /* owner/admin already has access */ }
  sheetTab('Files', FILE_HEADERS).appendRow([
    new Date(), cell(b.logId, 20), u.email, cell(b.tool, 40), role, cell(name, 200), bytes.length, file.getUrl()]);
  linkToLog(b.logId, role, file.getUrl());   // Library.gs — puts the Drive link in the Logs row
  libIndexFile(file, u.email);                // Library.gs — makes the new file searchable in คลังข้อมูล
  return { fileId: file.getId() };
}

/* ----------------------------- token + policy ----------------------------- */

/** Validate the ID token with Google and check audience, issuer and expiry. */
function verifyIdToken(idToken) {
  var clientId = prop('GOOGLE_CLIENT_ID');
  if (!clientId) throw httpError('NOT_CONFIGURED', 'ระบบยังไม่ได้ตั้งค่า GOOGLE_CLIENT_ID');
  var res;
  try {
    res = UrlFetchApp.fetch(TOKENINFO_URL + encodeURIComponent(idToken), { muteHttpExceptions: true, followRedirects: false });
  } catch (x) { throw httpError('UPSTREAM', 'ติดต่อ Google เพื่อตรวจสอบไม่ได้ กรุณาลองใหม่'); }
  if (res.getResponseCode() !== 200) throw httpError('INVALID_TOKEN', 'ไม่สามารถยืนยันตัวตนได้');
  var c;
  try { c = JSON.parse(res.getContentText()); } catch (x) { throw httpError('INVALID_TOKEN', 'ไม่สามารถยืนยันตัวตนได้'); }
  if (c.aud !== clientId) throw httpError('INVALID_TOKEN', 'ไม่สามารถยืนยันตัวตนได้');
  if (VALID_ISSUERS.indexOf(c.iss) < 0) throw httpError('INVALID_TOKEN', 'ไม่สามารถยืนยันตัวตนได้');
  if (!c.sub || !c.email) throw httpError('INVALID_TOKEN', 'ไม่สามารถยืนยันตัวตนได้');
  if (Number(c.exp) * 1000 <= Date.now()) throw httpError('INVALID_TOKEN', 'ไม่สามารถยืนยันตัวตนได้');
  return c;
}

/** Domain policy. `hd` (hosted domain claim) is cross-checked when present. Never trusts the browser. */
function isEmailAllowed(email, hd) {
  email = String(email || '').toLowerCase();
  var at = email.lastIndexOf('@');
  if (at < 1) return false;
  var domain = email.slice(at + 1);
  var domains = listProp('ALLOWED_EMAIL_DOMAIN');
  var emails = listProp('ALLOWED_EMAILS');
  if (emails.indexOf(email) >= 0) return true;
  if (!domains.length) return true; // no restriction configured
  if (domains.indexOf(domain) < 0) return false;
  if (hd && domains.indexOf(String(hd).toLowerCase()) < 0) return false;
  return true;
}

/* -------------------------------- sessions -------------------------------- */

function signSession(payload) {
  var data = Utilities.base64EncodeWebSafe(JSON.stringify(payload)).replace(/=+$/, '');
  return data + '.' + hmac(data);
}

function verifySession(token) {
  if (typeof token !== 'string' || token.length > MAX_TOKEN_CHARS) return null;
  var parts = token.split('.');
  if (parts.length !== 2) return null;
  if (!safeEqual(hmac(parts[0]), parts[1])) return null;
  var payload;
  try { payload = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString()); } catch (x) { return null; }
  if (!payload || !payload.exp || payload.exp * 1000 <= Date.now()) return null;
  return payload;
}

function hmac(data) {
  var secret = prop('SESSION_SECRET');
  if (!secret) throw httpError('NOT_CONFIGURED', 'ระบบยังไม่ได้ตั้งค่า (SESSION_SECRET)');
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(data, secret)).replace(/=+$/, '');
}

/** Constant-time string comparison. */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  var r = 0;
  for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/* ------------------------------ rate limiting ----------------------------- */

/** Fixed-window counter in CacheService (global, because Apps Script does not expose client IPs). */
function rateLimit(name, limit) {
  var cache = CacheService.getScriptCache();
  var key = 'rl:' + name + ':' + Math.floor(Date.now() / 60000);
  var lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    var n = Number(cache.get(key) || 0) + 1;
    cache.put(key, String(n), 120);
    if (n > limit) throw httpError('RATE_LIMITED', 'มีการเรียกใช้งานบ่อยเกินไป กรุณารอสักครู่');
  } finally { lock.releaseLock(); }
}

/* --------------------------------- plumbing -------------------------------- */

function prop(name) { return PropertiesService.getScriptProperties().getProperty(name) || ''; }
function intProp(name, dflt) { var n = parseInt(prop(name), 10); return isFinite(n) && n > 0 ? n : dflt; }
function listProp(name) { return prop(name).split(/[,\s]+/).map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean); }
function isConfigured() { return !!(prop('GOOGLE_CLIENT_ID') && prop('SESSION_SECRET')); }

function httpError(code, message) { var e = new Error(message); e.code = code; e.expected = true; return e; }
function newCtx(method) { return { id: Utilities.getUuid().slice(0, 8), t0: Date.now(), op: method }; }

/** Structured audit log. Never includes tokens, emails' contents, file data, or secrets. */
function audit(ctx, success, code) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), requestId: ctx.id, operation: ctx.op, success: success, ms: Date.now() - ctx.t0, errorCode: code || null }));
}
function json(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
function respond(ctx, data) { audit(ctx, true); return json({ success: true, requestId: ctx.id, data: data }); }
function fail(ctx, err) {
  var code = err && err.expected ? err.code : 'INTERNAL';
  var message = err && err.expected ? err.message : 'เกิดข้อผิดพลาดภายในระบบ';
  audit(ctx, false, code);
  if (!(err && err.expected)) console.error(ctx.id + ' ' + (err && err.stack || err)); // detail stays server-side
  return json({ success: false, requestId: ctx.id, error: { code: code, message: message } });
}

/* ------------------------------ sheet setup ------------------------------ */

function styleTab(sh, headers, widths, dateCol) {
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setFontColor('#ffffff').setBackground('#0f5c9e').setVerticalAlignment('middle');
  sh.setFrozenRows(1); sh.setRowHeight(1, 32);
  widths.forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  if (dateCol) sh.getRange(2, dateCol, Math.max(sh.getMaxRows() - 1, 1), 1).setNumberFormat('dd/MM/yyyy HH:mm:ss');
  if (!sh.getFilter()) sh.getRange(1, 1, Math.max(sh.getMaxRows(), 2), headers.length).createFilter();
}

/**
 * Run once from the editor (select "setupSheet" -> Run), and again after changing columns. Safe to repeat.
 * Creates/updates the tabs Logs and Files (headers, frozen row, filter, widths, date format, red rows for errors)
 * and checks that the Drive folder is reachable. Needs script properties LOG_SHEET_ID and DRIVE_FOLDER_ID.
 */
function setupSheet() {
  var id = prop('LOG_SHEET_ID');
  if (!id) throw new Error('ตั้งค่า LOG_SHEET_ID ใน Script properties ก่อน');
  var ss = SpreadsheetApp.openById(id);
  var logs = sheetTab('Logs', LOG_HEADERS), files = sheetTab('Files', FILE_HEADERS);
  styleTab(logs, LOG_HEADERS, [150, 90, 200, 100, 100, 80, 260, 90, 90, 260, 120, 120], 1);
  styleTab(files, FILE_HEADERS, [150, 90, 200, 100, 80, 280, 100, 420], 1);
  logs.setTabColor('#0f5c9e'); files.setTabColor('#0b7a7c');
  logs.setConditionalFormatRules([SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$F2="error"')
    .setBackground('#fdeceb').setRanges([logs.getRange(2, 1, Math.max(logs.getMaxRows() - 1, 1), LOG_HEADERS.length)]).build()]);
  var folder = prop('DRIVE_FOLDER_ID') ? DriveApp.getFolderById(prop('DRIVE_FOLDER_ID')).getName() : '(ยังไม่ได้ตั้ง DRIVE_FOLDER_ID)';
  console.log('พร้อมใช้งาน — ชีต: ' + ss.getName() + ' | โฟลเดอร์ Drive: ' + folder + ' | แท็บ: Logs, Files');
}

/* ------------------------------ one-time setup ----------------------------- */

/**
 * Run once from the Apps Script editor (select "setup" → Run).
 * Generates SESSION_SECRET if missing and creates empty placeholders for the other properties.
 * Afterwards run, in this order:  setupSheet → setupSearchIndex (Library.gs) → setupLinks (Links.gs) → setupAnalytics (Analytics.gs).
 */
function setup() {
  var p = PropertiesService.getScriptProperties();
  if (!p.getProperty('SESSION_SECRET')) p.setProperty('SESSION_SECRET', Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid());
  ['GOOGLE_CLIENT_ID', 'ALLOWED_EMAIL_DOMAIN', 'ADMIN_EMAILS', 'LOG_SHEET_ID', 'DRIVE_FOLDER_ID'].forEach(function (k) { if (p.getProperty(k) === null) p.setProperty(k, ''); });
  if (p.getProperty('LOG_SHEET_ID')) setupSheet();
  console.log('SESSION_SECRET ready. Now set GOOGLE_CLIENT_ID, ALLOWED_EMAIL_DOMAIN (a domain such as example.go.th, not an e-mail address) and ADMIN_EMAILS in Project Settings → Script properties.');
}
