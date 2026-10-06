// Runs gas/Code.gs + Library.gs + Links.gs + Analytics.gs together in a Node VM with an in-memory Google Sheet,
// and checks the QR history / tracked QR / statistics flow end to end (including that Code.gs routes every action the frontend calls).
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'gas');
const source = ['Code.gs', 'Library.gs', 'Links.gs', 'Analytics.gs'].map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
const CLIENT = 'client-123.apps.googleusercontent.com';

function makeSheet() {
  const rows = [];
  const sh = {
    getLastRow: () => rows.length, getMaxRows: () => Math.max(rows.length, 1000), setFrozenRows() {}, getFilter: () => ({}), createFilter() {}, setRowHeight() {}, setColumnWidth() {}, setTabColor() {}, deleteRows(at, n) { rows.splice(at - 1, n); },
    appendRow: (r) => { rows.push(r.slice()); },
    getRange: (r, c, nr = 1, nc = 1) => {
      const api = {
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => { const v = (rows[r - 1 + i] || [])[c - 1 + j]; return v === undefined ? '' : v; })),
        setValues: (vals) => { vals.forEach((vr, i) => { rows[r - 1 + i] = rows[r - 1 + i] || []; vr.forEach((v, j) => { rows[r - 1 + i][c - 1 + j] = typeof v === 'string' && /^'/.test(v) ? v.slice(1) : v; }); }); return api; },
        setValue: (v) => api.setValues([[v]])
      };
      for (const m of ['setFontWeight', 'setFontColor', 'setBackground', 'setVerticalAlignment', 'setNumberFormat', 'createFilter']) api[m] = () => api;
      return api;
    }
  };
  return { sh, rows };
}

function makeEnv(extra = {}) {
  const store = { GOOGLE_CLIENT_ID: CLIENT, SESSION_SECRET: 'secret-secret-secret', LOG_SHEET_ID: 'sheet', SHORT_BASE: 'https://sand.example.go.th', ADMIN_EMAILS: 'admin@example.go.th', EDGE_SECRET: 'edge-secret', ...extra };
  const cache = new Map(); const sheets = {};
  const claimsFor = {};
  const toSigned = (buf) => Array.from(buf, (b) => (b > 127 ? b - 256 : b));
  const unsigned = (arr) => Buffer.from(arr.map((b) => (b < 0 ? b + 256 : b)));
  const ctx = {
    console: { log() {}, error() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in store ? store[k] : null), setProperty: (k, v) => { store[k] = v; } }) },
    CacheService: { getScriptCache: () => ({ get: (k) => cache.get(k) ?? null, put: (k, v) => cache.set(k, v), remove: (k) => cache.delete(k) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: { openById: () => ({ getName: () => 'x', getSheetByName: (n) => (sheets[n] ? sheets[n].sh : null), insertSheet: (n) => { sheets[n] = makeSheet(); return sheets[n].sh; } }) },
    UrlFetchApp: { fetch: (url) => { const t = decodeURIComponent(url.split('id_token=')[1]); return { getResponseCode: () => 200, getContentText: () => JSON.stringify(claimsFor[t]) }; } },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ text: t, setMimeType() { return this; } }) },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      formatDate: (d, tz, fmt) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(d).map((x) => [x.type, x.value]));
        return fmt === 'H' ? String(Number(p.hour)) : fmt === 'yyyy-MM-dd' ? `${p.year}-${p.month}-${p.day}` : `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`; },
      base64EncodeWebSafe: (x) => (typeof x === 'string' ? Buffer.from(x, 'utf8') : unsigned(x)).toString('base64url') + '==',
      base64DecodeWebSafe: (s) => toSigned(Buffer.from(s, 'base64url')),
      computeHmacSha256Signature: (data, key) => toSigned(crypto.createHmac('sha256', key).update(data).digest()),
      newBlob: (bytes) => ({ getDataAsString: () => unsigned(bytes).toString('utf8') })
    },
    Buffer, Date, JSON, Math, Number, String, parseInt, isFinite, encodeURIComponent, Object, Array, RegExp, Error
  };
  vm.createContext(ctx); vm.runInContext(source, ctx);
  const post = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).text);
  const get = (parameter) => JSON.parse(ctx.doGet({ parameter }).text);
  const login = (email) => {
    claimsFor[email] = { aud: CLIENT, iss: 'https://accounts.google.com', sub: email, email, email_verified: 'true', exp: String(Math.floor(Date.now() / 1000) + 3600), name: email };
    const r = post({ action: 'login', idToken: email }); assert.equal(r.success, true); return r.data.session;
  };
  return { post, get, login, sheets, store };
}

const dz = { fg: '#112233', bg: '#ffffff', style: 'rounded', ec: 'Q', margin: 4, size: 512, cat: 'vaccine', cap: 'สแกนเพื่อลงทะเบียน' };

test('Code.gs routes every action the frontend uses and reports its features', () => {
  const e = makeEnv();
  const h = e.get({ action: 'health' }); assert.equal(h.success, true); assert.ok(h.data.features.includes('projects') && h.data.features.includes('qr'));
  const s = e.login('somchai@example.go.th');
  for (const a of ['links', 'projects', 'library']) assert.notEqual(e.post({ action: a, session: s, op: 'list' }).error?.code, 'UNKNOWN_ACTION', a);
  assert.equal(e.post({ action: 'hit', secret: 'wrong', k: 'pabcdefghi' }).error.code, 'FORBIDDEN');
  assert.equal(e.post({ action: 'click', secret: 'wrong', code: 'abc' }).error.code, 'FORBIDDEN');
});

test('static QR is saved in the history with its purpose, category and fields — and never gets a short link', () => {
  const e = makeEnv(); const s = e.login('somchai@example.go.th');
  const r = e.post({ action: 'links', session: s, op: 'create', kind: 'qrs', title: 'QR ลงทะเบียนวัคซีนไข้หวัดใหญ่', note: 'ติดหน้าห้องฉีดยา', qr: { t: 'email', d: dz, f: { email: 'a@b.go.th', subject: 'สวัสดี', password: 'x' } } });
  assert.equal(r.success, true); const l = r.data.link;
  assert.equal(l.kind, 'qrs'); assert.equal(l.url, ''); assert.equal(l.qr.t, 'email'); assert.equal(l.qr.d.cat, 'vaccine'); assert.equal(l.qr.f.email, 'a@b.go.th'); assert.ok(!('password' in l.qr.f));
  assert.equal(e.get({ action: 'go', c: l.code }).data.reason, 'notfound');                 // a static QR can never be opened as a short link
  const g = e.post({ action: 'links', session: s, op: 'get', code: l.code }); assert.equal(g.data.link.title, 'QR ลงทะเบียนวัคซีนไข้หวัดใหญ่'); assert.equal(g.data.base, 'https://sand.example.go.th');
  const list = e.post({ action: 'links', session: s, op: 'list' }).data.items; assert.equal(list.length, 1); assert.equal(list[0].clicks, 0);
});

test('static QR needs a name and refuses to store a Wi-Fi password', () => {
  const e = makeEnv(); const s = e.login('somchai@example.go.th');
  assert.equal(e.post({ action: 'links', session: s, op: 'create', kind: 'qrs', title: '  ', qr: { t: 'text', d: dz, f: { text: 'x' } } }).error.code, 'BAD_REQUEST');
  assert.equal(e.post({ action: 'links', session: s, op: 'create', kind: 'qrs', title: 'wifi', qr: { t: 'wifi', d: dz, f: { ssid: 'a', password: 'secret' } } }).error.code, 'NO_SECRET');
  assert.equal(e.post({ action: 'links', session: s, op: 'create', kind: 'qrs', title: 'bad', qr: { t: 'exe', d: dz, f: {} } }).error.code, 'BAD_REQUEST');
});

test('tracked QR: scans are counted, robots are not, destination can change, and other users cannot see it', () => {
  const e = makeEnv(); const s = e.login('somchai@example.go.th'); const other = e.login('other@example.go.th'); const admin = e.login('admin@example.go.th');
  const r = e.post({ action: 'links', session: s, op: 'create', kind: 'qr', title: 'QR แบบประเมิน', url: 'example.com/survey', qr: { t: 'text', d: { ...dz, cat: 'survey' } } });
  assert.equal(r.success, true); const code = r.data.link.code; assert.equal(r.data.link.kind, 'qr'); assert.equal(r.data.link.url, 'https://example.com/survey'); assert.equal(r.data.link.qr.t, 'url');
  assert.equal(e.get({ action: 'go', c: code }).data.url, 'https://example.com/survey');
  const click = (extra) => e.post({ action: 'click', secret: 'edge-secret', code, country: 'TH', device: 'mobile', browser: 'Chrome', os: 'Android', ref: '', vid: 'abcdef123456', bot: false, ...extra });
  assert.equal(click({}).data.ok, true); click({ vid: '0123456789ab' }); click({ vid: 'abcdef123456' }); click({ bot: true, device: 'bot' });
  const st = e.post({ action: 'links', session: s, op: 'stats', code, days: 7 }).data;
  assert.equal(st.total, 3); assert.equal(st.unique, 2); assert.equal(st.bots, 1); assert.equal(st.devices[0].name, 'mobile');
  const it = e.post({ action: 'links', session: s, op: 'list' }).data.items[0]; assert.equal(it.clicks, 3); assert.equal(it.week, 3);
  const up = e.post({ action: 'links', session: s, op: 'update', code, url: 'https://example.com/survey-v2', title: 'QR แบบประเมิน v2', qr: { d: { ...dz, cat: 'survey' } } });
  assert.equal(up.success, true); assert.equal(up.data.link.url, 'https://example.com/survey-v2'); assert.equal(e.get({ action: 'go', c: code }).data.url, 'https://example.com/survey-v2');
  assert.equal(e.post({ action: 'links', session: s, op: 'update', code, title: ' ' }).error.code, 'BAD_REQUEST');
  assert.equal(e.post({ action: 'links', session: other, op: 'stats', code }).error.code, 'NOT_FOUND');
  assert.equal(e.post({ action: 'links', session: other, op: 'list' }).data.items.length, 0);
  assert.equal(e.post({ action: 'links', session: admin, op: 'list' }).data.items.length, 1);
  assert.equal(e.post({ action: 'links', session: s, op: 'update', code, status: 'disabled' }).success, true); assert.equal(e.get({ action: 'go', c: code }).data.reason, 'disabled');
  assert.equal(e.post({ action: 'links', session: s, op: 'delete', code }).success, true); assert.equal(e.get({ action: 'go', c: code }).data.reason, 'notfound');
  assert.equal(e.post({ action: 'links', session: s, op: 'list' }).data.items.length, 0);
});

test('QR history limit is separate from the short-link limit and codes never collide', () => {
  const e = makeEnv({ LINK_MAX_PER_USER: '1', QR_MAX_PER_USER: '3' }); const s = e.login('somchai@example.go.th');
  assert.equal(e.post({ action: 'links', session: s, op: 'create', url: 'https://example.com/a' }).success, true);
  assert.equal(e.post({ action: 'links', session: s, op: 'create', url: 'https://example.com/b' }).error.code, 'LIMIT');
  const codes = new Set();
  for (let i = 0; i < 3; i++) { const r = e.post({ action: 'links', session: s, op: 'create', kind: 'qrs', title: `q${i}`, qr: { t: 'text', d: dz, f: { text: `t${i}` } } }); assert.equal(r.success, true); codes.add(r.data.link.code); }
  assert.equal(codes.size, 3);
  assert.equal(e.post({ action: 'links', session: s, op: 'create', kind: 'qrs', title: 'q4', qr: { t: 'text', d: dz, f: { text: 'x' } } }).error.code, 'LIMIT');
});

test('a short link can still be attached to a project and website hits are counted (Analytics wired through Code.gs)', () => {
  const e = makeEnv(); const s = e.login('somchai@example.go.th');
  const p = e.post({ action: 'projects', session: s, op: 'create', name: 'เว็บโรงพยาบาล', url: 'https://hospital.example.go.th' }); assert.equal(p.success, true); const key = p.data.site.key;
  const l = e.post({ action: 'links', session: s, op: 'create', kind: 'qr', title: 'QR โครงการ', url: 'https://hospital.example.go.th/x', project: key, qr: { d: dz } }); assert.equal(l.data.link.project, key);
  const hit = e.post({ action: 'hit', secret: 'edge-secret', k: key, t: 'pv', p: '/home', host: 'hospital.example.go.th', device: 'desktop', browser: 'Chrome', os: 'Windows', country: 'TH', vid: 'abcdef123456' }); assert.equal(hit.data.ok, true);
  const st = e.post({ action: 'projects', session: s, op: 'stats', key, days: 7 }).data; assert.equal(st.pv, 1);
});
