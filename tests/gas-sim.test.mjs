// projects/replay and projects/wings (Analytics.gs) answered through Code.gs in a Node VM with an in-memory Google Sheet.
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
  return { post, get, login, sheets, store, counters };
}


const DAY = 86400000;
const bkkStart = (ago = 0) => Math.floor((Date.now() + 25200000) / DAY) * DAY - 25200000 - ago * DAY;   // 00:00 Thailand time, `ago` days back
const bkkDay = (ago = 0) => new Date(bkkStart(ago) + 25200000).toISOString().slice(0, 10);

/** project + hits: [minute, vid, page, {role, bot, type, ago}] → Hits rows (13 standard columns, optional 14th = role) */
function seed(withRole) {
  const e = makeEnv(); const s = e.login('somchai@example.go.th'); const other = e.login('other@example.go.th');
  const mk = (sess, name) => e.post({ action: 'projects', session: sess, op: 'create', name, url: 'https://hospital.example.go.th' }).data.site.key;
  const A = mk(s, 'ระบบ A'); const B = mk(other, 'ระบบของคนอื่น');
  e.post({ action: 'projects', session: s, op: 'list' });   // first read creates the Hits tab
  const hits = e.sheets.Hits.rows; if (withRole) hits[0].push('บทบาท');
  const add = (key, min, vid, page, o = {}) => { const row = [bkkStart(o.ago || 0) + min * 60000, key, o.type || 'pv', page, '', 'TH', 'desktop', 'Chrome', 'Windows', vid, 'th', '', o.bot ? 1 : 0]; if (withRole) row.push(o.role || ''); hits.push(row); };
  return { e, s, other, A, B, add };
}

test('replay: visits, return visits and later pages of one visit are told apart; robots, events and other people\'s projects are left out', () => {
  const { e, s, A, B, add } = seed(false);
  add(A, 480, 'v111111111', '/a/index.html'); add(A, 482, 'v111111111', '/a/form.html'); add(A, 600, 'v111111111', '/a/');   // v1: visit, same visit, return after 118 min
  add(A, 490, 'v222222222', '/a/'); add(A, 500, '', '/a/form.html');                                                          // v2 and an anonymous view (its own visitor)
  add(A, 510, 'v333333333', '/a/', { bot: true }); add(A, 511, 'v444444444', 'click', { type: 'ev' }); add(B, 480, 'v555555555', '/b/');
  const r = e.post({ action: 'projects', session: s, op: 'replay', mode: 'today' }); assert.equal(r.success, true, JSON.stringify(r.error));
  const d = r.data; assert.equal(d.mode, 'today'); assert.equal(d.day, bkkDay()); assert.equal(d.today, bkkDay()); assert.equal(d.byDay.length, 30); assert.equal(d.byDay[29].d, bkkDay()); assert.equal(d.byDay[29].pv, 5);
  assert.equal(d.sites.length, 1); const a = d.sites[0]; assert.equal(a.key, A);
  assert.deepEqual([a.n, a.uv, a.fresh, a.back], [5, 3, 3, 1]);
  assert.deepEqual(a.ev.map((x) => x[0]), [480, 482, 490, 500, 600]);   // sorted by time
  const byMin = Object.fromEntries(a.ev.map((x) => [x[0], x])); assert.deepEqual([byMin[480][2], byMin[482][2], byMin[490][2], byMin[500][2], byMin[600][2]], [0, 2, 0, 0, 1]);
  assert.equal(byMin[480][1], byMin[600][1]); assert.notEqual(byMin[480][1], byMin[490][1]);                                    // same person keeps one number, never the hash
  assert.deepEqual(a.pgs.slice().sort(), ['/a', '/a/form.html']); assert.equal(a.pgs[byMin[480][3]], '/a'); assert.equal(a.pgs[byMin[482][3]], '/a/form.html');
  assert.ok(!JSON.stringify(d).includes('v111111111'), 'the visitor hash must never leave the server');
  assert.equal(e.post({ action: 'projects', session: s, op: 'replay', mode: 'today' }).data.sites[0].n, 5);                      // cached answer is the same
});

test('replay peak picks the busiest day of the last 30 days; today stays what it is', () => {
  const { e, s, A, add } = seed(false);
  add(A, 480, 'v111111111', '/a/'); add(A, 485, 'v222222222', '/a/');
  for (let i = 0; i < 4; i++) add(A, 600 + i * 40, `v${i}0000000000`.slice(0, 10), '/a/', { ago: 2 }); add(A, 700, 'v999999999a', '/a/', { ago: 5 });
  const peak = e.post({ action: 'projects', session: s, op: 'replay', mode: 'peak' }).data;
  assert.equal(peak.mode, 'peak'); assert.equal(peak.day, bkkDay(2)); assert.equal(peak.today, bkkDay()); assert.equal(peak.sites[0].n, 4);
  assert.equal(e.post({ action: 'projects', session: s, op: 'replay', mode: 'bogus' }).data.mode, 'today');
});

test('replay with no data at all answers an empty day instead of an error; admin sees every project, a stranger sees none', () => {
  const { e, s, other, A, B, add } = seed(false); const admin = e.login('admin@example.go.th');
  let r = e.post({ action: 'projects', session: s, op: 'replay', mode: 'today' }); assert.equal(r.success, true); assert.deepEqual(r.data.sites, []);
  add(A, 480, 'v111111111', '/a/'); add(B, 481, 'v222222222', '/b/');
  assert.equal(e.post({ action: 'projects', session: admin, op: 'replay', mode: 'today' }).data.sites.length, 2);
  assert.equal(e.post({ action: 'projects', session: other, op: 'replay', mode: 'today' }).data.sites.map((x) => x.key).join(), B);
  assert.equal(e.post({ action: 'projects', session: 'forged', op: 'replay', mode: 'today' }).error.code, 'INVALID_SESSION');
});

test('wings: pages are grouped like the page does, with hours, flows between pages and who uses them', () => {
  const { e, s, A, B, add } = seed(true);
  add(A, 480, 'v111111111', '/a/index.html?x=1'); add(A, 482, 'v111111111', '/a/form.html', { role: 'admin' }); add(A, 600, 'v111111111', '/a/form.html', { role: 'admin' });
  add(A, 490, 'v222222222', '/a/'); add(A, 491, 'v222222222', '/a/form.html', { role: 'user' }); add(A, 495, '', '/a/'); add(A, 500, 'v333333333', '/a/', { bot: true }); add(B, 480, 'v444444444', '/b/');
  const r = e.post({ action: 'projects', session: s, op: 'wings', days: 30 }); assert.equal(r.success, true, JSON.stringify(r.error));
  assert.equal(r.data.days, 30); assert.equal(r.data.sites.length, 1); const w = r.data.sites[0];
  assert.equal(w.site.key, A); assert.equal(w.site.name, 'ระบบ A'); assert.equal(w.site.url, 'https://hospital.example.go.th');
  const pg = Object.fromEntries(w.pages.map((p) => [p.path, p]));
  assert.equal(pg['/a'].pv, 3); assert.equal(pg['/a/form.html'].pv, 3); assert.equal(w.other, null);
  assert.equal(pg['/a/form.html'].uv, 2); assert.equal(pg['/a'].uv, 3);
  assert.equal(pg['/a'].byHour.length, 24); assert.equal(pg['/a'].byHour[1] + pg['/a'].byHour[2], 0); assert.equal(pg['/a'].byHour.reduce((x, y) => x + y, 0), 3);
  assert.deepEqual(pg['/a/form.html'].rl, { admin: 2, user: 1 });
  assert.deepEqual(w.flows.map((f) => [f.from, f.to, f.n]).sort(), [['/a', '/a/form.html', 2]]);                                 // v1 480→482, v2 490→491 · v1 482→600 is a new visit
  assert.equal(w.uv, 3);                                                                                          // v1, v2 and the anonymous view · the robot is not counted
  assert.ok(!JSON.stringify(r.data).includes('v111111111'));
});

test('wings: more than 10 pages fold into "other pages"; a Hits tab without a role column still works; days default to 30', () => {
  const { e, s, A, add } = seed(false);
  for (let i = 0; i < 12; i++) for (let k = 0; k <= 12 - i; k++) add(A, 480 + k, `v${String(k).padStart(2, '0')}00000000`, `/a/p${i}.html`);
  const w = e.post({ action: 'projects', session: s, op: 'wings', days: 'x' }).data; assert.equal(w.days, 30);
  const x = w.sites[0]; assert.equal(x.pages.length, 9); assert.ok(x.other && x.other.pv > 0 && x.other.byHour.length === 24 && x.other.path === undefined);
  let all = 0; for (let i = 0; i < 12; i++) all += 13 - i;   // page i got 13-i views
  assert.equal(x.pages.reduce((a, p) => a + p.pv, x.other.pv), all);
  assert.deepEqual(x.pages[0].rl, {});
  assert.ok(x.flows.every((f) => f.from !== f.to));
});

test('other projects ops still reach Analytics.gs through projects()', () => {
  const { e, s } = seed(false);
  const l = e.post({ action: 'projects', session: s, op: 'list' }); assert.equal(l.success, true); assert.equal(l.data.items.length, 1);
  assert.equal(e.post({ action: 'projects', session: s, op: 'nonsense' }).error.code, 'UNKNOWN_ACTION');
});

test('the answers are accepted by the page\'s own normalizers (normalizeReplay / normalizeWings) — the banners disappear', async () => {
  const { normalizeReplay, normalizeWings, replayVisitors, dayStats, wingOf } = await import('../src/js/modules/site-engine.js');
  const { e, s, A, add } = seed(true);
  add(A, 480, 'v111111111', '/a/index.html'); add(A, 482, 'v111111111', '/a/form.html', { role: 'admin' }); add(A, 600, 'v111111111', '/a/'); add(A, 490, 'v222222222', '/a/form.html', { role: 'user' });
  const rep = normalizeReplay(e.post({ action: 'projects', session: s, op: 'replay', mode: 'today' }).data);
  assert.ok(rep, 'normalizeReplay must accept the backend answer'); const st = dayStats(rep);
  assert.deepEqual([st.views, st.uv, st.fresh, st.back], [4, 2, 2, 1]); assert.equal(rep.sites[A].pg.length, 2);
  const people = replayVisitors(rep, [{ key: A }]); assert.equal(people.length, 3);               // 2 first visits + 1 return = one walking figure each
  assert.ok(people.every((p) => p.pk === '' || p.pk.startsWith('/a')));
  const wings = normalizeWings(e.post({ action: 'projects', session: s, op: 'wings', days: 30 }).data);
  assert.ok(wings && wings[A], 'normalizeWings must accept the backend answer'); assert.equal(wings[A].units.length, 2); assert.equal(wings[A].tot, 4);
  assert.ok(wings[A].flows.length >= 1);
});
