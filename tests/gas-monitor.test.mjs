// Monitor (Analytics.gs): log lines, uptime, feed, issues — through Code.gs in a Node VM with an in-memory Google Sheet.
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
    getLastRow: () => rows.length, getLastColumn: () => Math.max(1, ...rows.map((r) => r.length)), getMaxRows: () => Math.max(rows.length, 1000), setFrozenRows() {}, getFilter: () => ({}), createFilter() {}, setRowHeight() {}, setColumnWidth() {}, setTabColor() {}, deleteRows(at, n) { rows.splice(at - 1, n); },
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
  const cache = new Map(); const sheets = {}; const counters = { open: 0 };
  const claimsFor = {};
  const toSigned = (buf) => Array.from(buf, (b) => (b > 127 ? b - 256 : b));
  const unsigned = (arr) => Buffer.from(arr.map((b) => (b < 0 ? b + 256 : b)));
  const ctx = {
    console: { log() {}, error() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in store ? store[k] : null), setProperty: (k, v) => { store[k] = v; } }) },
    CacheService: { getScriptCache: () => ({ get: (k) => cache.get(k) ?? null, put: (k, v) => cache.set(k, v), remove: (k) => cache.delete(k) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: { openById: () => (counters.open++, { getName: () => 'x', getSheetByName: (n) => (sheets[n] ? sheets[n].sh : null), insertSheet: (n) => { sheets[n] = makeSheet(); return sheets[n].sh; } }) },
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
  return { post, get, login, sheets, store, counters, ctx };
}

const edge = (e, key, o) => e.post({ action: 'hit', secret: 'edge-secret', k: key, t: 'lg', host: 'hospital.example.go.th', device: 'desktop', ...o });
function seed() {
  const e = makeEnv(); const s = e.login('somchai@example.go.th'); const other = e.login('other@example.go.th');
  const mk = (sess, name) => e.post({ action: 'projects', session: sess, op: 'create', name, url: 'https://hospital.example.go.th' }).data.site.key;
  return { e, s, other, A: mk(s, 'ระบบ A'), B: mk(other, 'ระบบของคนอื่น') };
}

test('log line: stored scrubbed, shown with a 4-char visitor code only, other users cannot see it', () => {
  const { e, s, other, A } = seed();
  assert.equal(edge(e, A, { kind: 'er', e: 'app.js:10', msg: 'fail for a@b.go.th HN 12345678 at https://x.go.th/p?token=abc', vid: 'abcdef012345' }).data.ok, true);
  const f = e.post({ action: 'projects', session: s, op: 'feed', hours: 1 }).data;
  assert.equal(f.items.length, 1); const it = f.items[0];
  assert.ok(!/a@b|12345678|token=/.test(JSON.stringify(f)), JSON.stringify(it));
  assert.equal(it.level, 'error'); assert.equal(it.v, 'abcd'); assert.ok(!JSON.stringify(f).includes('abcdef012345'));
  assert.equal(e.post({ action: 'projects', session: other, op: 'feed', hours: 1 }).data.items.length, 0);
  assert.equal(e.post({ action: 'projects', session: other, op: 'feed', key: A }).error.code, 'NOT_FOUND');
});

test('log line: wrong secret / wrong domain / empty are refused; a storm of the same line is cut', () => {
  const { e, A } = seed();
  assert.equal(e.post({ action: 'hit', secret: 'nope', k: A, t: 'lg', host: 'hospital.example.go.th', msg: 'x' }).error.code, 'FORBIDDEN');
  assert.equal(edge(e, A, { host: 'evil.example.com', msg: 'x' }).data.ok, false);
  assert.equal(edge(e, A, { msg: '', e: '' }).data.ok, false);
  let okN = 0; for (let i = 0; i < 15; i++) if (edge(e, A, { msg: 'same line ' + i }).data.ok) okN++;
  assert.equal(okN, 10);
});

test('task: failed task makes the project "error"; issues group the same problem; monitor totals add up', () => {
  const { e, s, A, B } = seed();
  edge(e, A, { kind: 'tk', e: 'ส่งหนังสือ', st: 'fail', msg: 'timeout 30s', ms: 5000 }); edge(e, A, { kind: 'tk', e: 'ส่งหนังสือ', st: 'fail', msg: 'timeout 45s' });
  edge(e, A, { kind: 'tk', e: 'ส่งหนังสือ', st: 'ok', ms: 900 });
  const m = e.post({ action: 'projects', session: s, op: 'monitor' }).data; assert.equal(m.items.length, 1);
  const a = m.items[0]; assert.equal(a.key, A); assert.equal(a.fail24, 2); assert.equal(a.ok24, 1); assert.equal(a.state, 'error'); assert.ok(a.reasons.includes('taskfail'));
  assert.equal(Object.values(m.totals).reduce((x, y) => x + y, 0), 1);
  const iss = e.post({ action: 'projects', session: s, op: 'issues', hours: 24 }).data.items; assert.equal(iss.length, 1); assert.equal(iss[0].n, 2); assert.equal(iss[0].level, 'error');
  const one = e.post({ action: 'projects', session: s, op: 'feed', fp: iss[0].fp }).data; assert.equal(one.items.length, 2);
  assert.ok(B);
});

test('uptime: down needs 2 failed checks; recovery is logged; around returns the neighbourhood', () => {
  const { e, s, A } = seed();
  let code = 500; e.ctx.UrlFetchApp.fetch = () => ({ getResponseCode: () => code });
  const state = () => e.post({ action: 'projects', session: s, op: 'monitor' }).data.items[0];
  e.ctx.anaPingJob(); e.ctx.CacheService.getScriptCache().remove('mo:somchai@example.go.th');
  assert.notEqual(e.post({ action: 'projects', session: s, op: 'list' }).data.items[0].health, 'down');
  e.ctx.anaPingJob(); e.ctx.CacheService.getScriptCache().remove('mo:somchai@example.go.th'); assert.equal(state().state, 'down');
  code = 200; e.ctx.anaPingJob(); e.ctx.CacheService.getScriptCache().remove('mo:somchai@example.go.th'); assert.equal(state().state, 'ok');
  const evs = e.post({ action: 'projects', session: s, op: 'feed', kinds: 'hc', hours: 1 }).data.items; assert.deepEqual(evs.map((x) => x.status).sort(), ['down', 'up']);
  const ar = e.post({ action: 'projects', session: s, op: 'around', key: A, t: evs[0].t, mins: 5 }).data; assert.equal(ar.items.length, 2);
  assert.equal(e.post({ action: 'projects', session: s, op: 'around', key: A }).error.code, 'BAD_REQUEST');
});
