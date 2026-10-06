// Runs gas/Code.gs in a Node VM with mocked Apps Script services and checks the security behaviour.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const code = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'gas', 'Code.gs'), 'utf8');

function makeEnv(props = {}, tokeninfo = () => ({ code: 404, body: '{}' })) {
  const store = { ...props }; const cache = new Map(); const logs = [];
  const toSigned = (buf) => Array.from(buf, (b) => (b > 127 ? b - 256 : b));
  const unsigned = (arr) => Buffer.from(arr.map((b) => (b < 0 ? b + 256 : b)));
  const ctx = {
    console: { log: (m) => logs.push(m), error: () => {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in store ? store[k] : null), setProperty: (k, v) => { store[k] = v; } }) },
    CacheService: { getScriptCache: () => ({ get: (k) => cache.get(k) ?? null, put: (k, v) => cache.set(k, v) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    UrlFetchApp: { fetch: (url) => { const r = tokeninfo(decodeURIComponent(url.split('id_token=')[1])); return { getResponseCode: () => r.code, getContentText: () => r.body }; } },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ text: t, setMimeType() { return this; } }) },
    Utilities: {
      sleep: () => {},
      getUuid: () => crypto.randomUUID(),
      base64EncodeWebSafe: (x) => (typeof x === 'string' ? Buffer.from(x, 'utf8') : unsigned(x)).toString('base64url') + '==',
      base64DecodeWebSafe: (s) => toSigned(Buffer.from(s, 'base64url')),
      computeHmacSha256Signature: (data, key) => toSigned(crypto.createHmac('sha256', key).update(data).digest()),
      newBlob: (bytes) => ({ getDataAsString: () => unsigned(bytes).toString('utf8') })
    },
    Buffer, Date, JSON, Math, Number, String, parseInt, isFinite, encodeURIComponent
  };
  vm.createContext(ctx); vm.runInContext(code, ctx);
  const post = (body) => JSON.parse(ctx.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).text);
  const get = (action) => JSON.parse(ctx.doGet({ parameter: { action } }).text);
  return { post, get, logs, store };
}

const CLIENT = 'client-123.apps.googleusercontent.com';
const goodClaims = (o = {}) => ({ aud: CLIENT, iss: 'https://accounts.google.com', sub: '42', email: 'somchai@example.go.th', email_verified: 'true', hd: 'example.go.th', name: 'สมชาย', exp: String(Math.floor(Date.now() / 1000) + 3600), ...o });
const base = { GOOGLE_CLIENT_ID: CLIENT, SESSION_SECRET: 'secret-secret-secret', ALLOWED_EMAIL_DOMAIN: 'example.go.th' };
const ok = (c) => () => ({ code: 200, body: JSON.stringify(c) });

test('health works unauthenticated and reports configuration', () => {
  const e = makeEnv(base); const r = e.get('health');
  assert.equal(r.success, true); assert.equal(r.data.status, 'ok'); assert.equal(r.data.configured, true);
});
test('unknown action / bad JSON / oversized body are rejected with structured errors', () => {
  const e = makeEnv(base);
  assert.equal(e.post({ action: 'nope' }).error.code, 'UNKNOWN_ACTION');
  assert.equal(e.post('not json').error.code, 'BAD_REQUEST');
  assert.equal(e.post('x'.repeat(9000)).error.code, 'REQUEST_TOO_LARGE');
});
test('login succeeds for an allowed domain and the session validates', () => {
  const e = makeEnv(base, ok(goodClaims()));
  const r = e.post({ action: 'login', idToken: 'tok' });
  assert.equal(r.success, true); assert.equal(r.data.user.email, 'somchai@example.go.th');
  const m = e.post({ action: 'me', session: r.data.session });
  assert.equal(m.success, true); assert.equal(m.data.email, 'somchai@example.go.th');
});
test('wrong audience, issuer, expired and unverified email are rejected', () => {
  assert.equal(makeEnv(base, ok(goodClaims({ aud: 'other' }))).post({ action: 'login', idToken: 't' }).error.code, 'INVALID_TOKEN');
  assert.equal(makeEnv(base, ok(goodClaims({ iss: 'https://evil.example' }))).post({ action: 'login', idToken: 't' }).error.code, 'INVALID_TOKEN');
  assert.equal(makeEnv(base, ok(goodClaims({ exp: '1' }))).post({ action: 'login', idToken: 't' }).error.code, 'INVALID_TOKEN');
  assert.equal(makeEnv(base, ok(goodClaims({ email_verified: 'false' }))).post({ action: 'login', idToken: 't' }).error.code, 'EMAIL_NOT_VERIFIED');
  assert.equal(makeEnv(base).post({ action: 'login', idToken: 't' }).error.code, 'INVALID_TOKEN'); // Google says 404
});
test('domain restriction: other domains, look-alike suffixes and hd mismatch are denied', () => {
  assert.equal(makeEnv(base, ok(goodClaims({ email: 'a@gmail.com', hd: undefined }))).post({ action: 'login', idToken: 't' }).error.code, 'DOMAIN_NOT_ALLOWED');
  assert.equal(makeEnv(base, ok(goodClaims({ email: 'a@evil-example.go.th', hd: undefined }))).post({ action: 'login', idToken: 't' }).error.code, 'DOMAIN_NOT_ALLOWED');
  assert.equal(makeEnv(base, ok(goodClaims({ email: 'a@example.go.th', hd: 'other.go.th' }))).post({ action: 'login', idToken: 't' }).error.code, 'DOMAIN_NOT_ALLOWED');
});
test('ALLOWED_EMAILS exception and unrestricted mode', () => {
  const allow = { ...base, ALLOWED_EMAILS: 'guest@gmail.com' };
  assert.equal(makeEnv(allow, ok(goodClaims({ email: 'guest@gmail.com', hd: undefined }))).post({ action: 'login', idToken: 't' }).success, true);
  const open = { ...base, ALLOWED_EMAIL_DOMAIN: '' };
  assert.equal(makeEnv(open, ok(goodClaims({ email: 'x@gmail.com', hd: undefined }))).post({ action: 'login', idToken: 't' }).success, true);
});
test('tampered, forged, expired sessions are rejected', () => {
  const e = makeEnv(base, ok(goodClaims())); const s = e.post({ action: 'login', idToken: 't' }).data.session;
  const [d, sig] = s.split('.');
  const forged = Buffer.from(JSON.stringify({ sub: '1', email: 'admin@example.go.th', exp: 9999999999 })).toString('base64url');
  assert.equal(e.post({ action: 'me', session: `${forged}.${sig}` }).error.code, 'INVALID_SESSION');
  assert.equal(e.post({ action: 'me', session: `${d}.AAAA` }).error.code, 'INVALID_SESSION');
  assert.equal(e.post({ action: 'me', session: 'garbage' }).error.code, 'INVALID_SESSION');
  assert.equal(e.post({ action: 'me' }).error.code, 'INVALID_SESSION');
  const other = makeEnv({ ...base, SESSION_SECRET: 'different' });
  assert.equal(other.post({ action: 'me', session: s }).error.code, 'INVALID_SESSION');
});
test('removing the domain from the allow-list invalidates existing sessions', () => {
  const e = makeEnv(base, ok(goodClaims())); const s = e.post({ action: 'login', idToken: 't' }).data.session;
  e.store.ALLOWED_EMAIL_DOMAIN = 'another.go.th';
  assert.equal(e.post({ action: 'me', session: s }).error.code, 'DOMAIN_NOT_ALLOWED');
});
test('missing configuration fails closed', () => {
  assert.equal(makeEnv({}, ok(goodClaims())).post({ action: 'login', idToken: 't' }).error.code, 'NOT_CONFIGURED');
  assert.equal(makeEnv({ GOOGLE_CLIENT_ID: CLIENT }, ok(goodClaims())).post({ action: 'login', idToken: 't' }).error.code, 'NOT_CONFIGURED');
});
test('login is rate limited', () => {
  const e = makeEnv({ ...base, LOGIN_LIMIT_PER_MIN: '3' }, ok(goodClaims()));
  for (let i = 0; i < 3; i++) assert.equal(e.post({ action: 'login', idToken: 't' }).success, true);
  assert.equal(e.post({ action: 'login', idToken: 't' }).error.code, 'RATE_LIMITED');
});
test('audit log never contains tokens, secrets or emails', () => {
  const e = makeEnv(base, ok(goodClaims())); e.post({ action: 'login', idToken: 'SUPER-SECRET-TOKEN' });
  const all = e.logs.join('\n');
  assert.ok(!all.includes('SUPER-SECRET-TOKEN')); assert.ok(!all.includes('secret-secret')); assert.ok(!all.includes('somchai'));
  const entry = JSON.parse(e.logs[0]); for (const k of ['ts', 'requestId', 'operation', 'success', 'ms']) assert.ok(k in entry);
});

test('log/archive require a valid session and neutralise formula injection', () => {
  const rows = []; const env = makeEnv({ ...base, LOG_SHEET_ID: 'sheet', DRIVE_FOLDER_ID: 'folder' });
  assert.equal(env.post({ action: 'log', session: 'bad', tool: 'qr', op: 'x' }).error.code, 'INVALID_SESSION');
  assert.equal(env.post({ action: 'archive', session: 'bad', name: 'a.txt', data: 'AAAA' }).error.code, 'INVALID_SESSION');
  assert.equal(env.post('{"action":"log","pad":"' + 'x'.repeat(9000) + '"}').error.code, 'REQUEST_TOO_LARGE');
});

test('history requires a valid session', () => {
  const env = makeEnv({ ...base, LOG_SHEET_ID: 'sheet' });
  assert.equal(env.post({ action: 'history', session: 'bad' }).error.code, 'INVALID_SESSION');
});

/* ---------------- username / password account (passlogin) ---------------- */
import { hashPassword } from '../scripts/make-local-account.mjs';
const localProps = (pw = 'correct horse 42') => ({ ...base, LOCAL_USER: 'hrdsansai', LOCAL_SALT: 'abc123salt', LOCAL_ITER: '200', LOCAL_HASH: hashPassword(pw, 'abc123salt', 200) });

test('passlogin: correct credentials issue a session that works for me/history', () => {
  const e = makeEnv(localProps());
  const r = e.post({ action: 'passlogin', username: 'HRDSansai', password: 'correct horse 42' });
  assert.equal(r.success, true); assert.equal(r.data.user.email, 'hrdsansai@local.sand');
  assert.equal(e.post({ action: 'me', session: r.data.session }).success, true);
});
test('passlogin: wrong password / wrong user / missing fields are rejected with one generic error', () => {
  const e = makeEnv(localProps());
  for (const b of [{ username: 'hrdsansai', password: 'nope' }, { username: 'other', password: 'correct horse 42' }, { username: 'hrdsansai' }, { password: 'x' }, { username: 1, password: 2 }])
    assert.equal(e.post({ action: 'passlogin', ...b }).error.code, 'BAD_CREDENTIALS');
});
test('passlogin: disabled until LOCAL_* properties exist, and removing LOCAL_HASH revokes live sessions', () => {
  assert.equal(makeEnv(base).post({ action: 'passlogin', username: 'a', password: 'b' }).error.code, 'LOCAL_DISABLED');
  const e = makeEnv(localProps());
  const s = e.post({ action: 'passlogin', username: 'hrdsansai', password: 'correct horse 42' }).data.session;
  delete e.store.LOCAL_HASH;
  assert.equal(e.post({ action: 'me', session: s }).success, false);
});
test('passlogin: rate limited, and the local account is not accepted via the Google domain list', () => {
  const e = makeEnv({ ...localProps(), PASSLOGIN_LIMIT_PER_MIN: '3' });
  let last; for (let i = 0; i < 5; i++) last = e.post({ action: 'passlogin', username: 'hrdsansai', password: 'bad' });
  assert.equal(last.error.code, 'RATE_LIMITED');
  const e2 = makeEnv(base); // a forged session for the local e-mail is useless without LOCAL_HASH
  assert.equal(e2.post({ action: 'me', session: 'x.y' }).success, false);
});
