/**
 * SAND Office Tools — backend (Google Apps Script web app).
 *
 * Responsibilities (kept deliberately small — everything else runs in the browser):
 *   • GET  ?action=health|version        public status check
 *   • POST {action:"login", idToken}     verify a Google ID token, enforce the allowed domain, issue a signed session
 *   • POST {action:"me", session}        validate a session
 *
 * The web app runs as the deploying user but never touches that user's Drive/Gmail/Calendar:
 * the only OAuth scope is script.external_request (to call Google's tokeninfo endpoint).
 *
 * Configuration lives in Script Properties (Project Settings → Script properties). Nothing secret is in this file.
 *   GOOGLE_CLIENT_ID      (required)  OAuth Web client ID used by the frontend
 *   ALLOWED_EMAIL_DOMAIN  (optional)  e.g. "example.go.th" or "a.go.th,b.go.th". Empty = any verified Google account
 *   ALLOWED_EMAILS        (optional)  comma-separated exceptions that are allowed even outside the domain
 *   SESSION_SECRET        (required)  created by setup(); never share
 *   SESSION_TTL_MIN       (optional)  default 480
 *   LOGIN_LIMIT_PER_MIN   (optional)  default 30 (global, protects the quota)
 */

var APP_VERSION = '1.0.0';
var TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo?id_token=';
var VALID_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
var MAX_BODY_CHARS = 8192;
var MAX_TOKEN_CHARS = 4096;

/* ------------------------------ entry points ------------------------------ */

function doGet(e) {
  var ctx = newCtx('get');
  try {
    var action = (e && e.parameter && e.parameter.action) || 'health';
    if (action === 'health') return respond(ctx, { status: 'ok', version: APP_VERSION, time: new Date().toISOString(), configured: isConfigured() });
    if (action === 'version') return respond(ctx, { version: APP_VERSION });
    throw httpError('UNKNOWN_ACTION', 'ไม่รู้จักคำสั่งนี้');
  } catch (err) { return fail(ctx, err); }
}

function doPost(e) {
  var ctx = newCtx('post');
  try {
    var raw = (e && e.postData && e.postData.contents) || '';
    if (raw.length > MAX_BODY_CHARS) throw httpError('REQUEST_TOO_LARGE', 'คำขอมีขนาดใหญ่เกินไป');
    var body;
    try { body = JSON.parse(raw); } catch (x) { throw httpError('BAD_REQUEST', 'รูปแบบคำขอไม่ถูกต้อง'); }
    if (!body || typeof body !== 'object') throw httpError('BAD_REQUEST', 'รูปแบบคำขอไม่ถูกต้อง');
    ctx.op = String(body.action || '');
    switch (body.action) {
      case 'health': return respond(ctx, { status: 'ok', version: APP_VERSION, time: new Date().toISOString(), configured: isConfigured() });
      case 'login': return respond(ctx, login(body.idToken));
      case 'me': return respond(ctx, me(body.session));
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

/* ------------------------------ one-time setup ----------------------------- */

/**
 * Run once from the Apps Script editor (select "setup" → Run).
 * Generates SESSION_SECRET if missing and creates empty placeholders for the other properties.
 */
function setup() {
  var p = PropertiesService.getScriptProperties();
  if (!p.getProperty('SESSION_SECRET')) p.setProperty('SESSION_SECRET', Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid());
  ['GOOGLE_CLIENT_ID', 'ALLOWED_EMAIL_DOMAIN'].forEach(function (k) { if (p.getProperty(k) === null) p.setProperty(k, ''); });
  console.log('SESSION_SECRET ready. Now set GOOGLE_CLIENT_ID (and ALLOWED_EMAIL_DOMAIN) in Project Settings → Script properties.');
}
