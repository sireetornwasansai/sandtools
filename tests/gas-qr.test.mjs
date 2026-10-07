// QR attached to projects (v1.6.0): old QR (kind 'qrx') with page-view statistics, QR pictures kept in Drive (saveimg / getimg),
// the URL columns of the Links sheet and the request-size rules — with an in-memory Sheet and an in-memory Drive.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'gas');
const source = ['Code.gs', 'Library.gs', 'Links.gs', 'Analytics.gs'].map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
const drive = { n: 0, files: {} };
const mkFolder = (name) => { const f = { id: `fold${++drive.n}0000000`, name, kids: [], files: [] }; f.getFoldersByName = (n) => { const m = f.kids.filter((k) => k.name === n); let i = 0; return { hasNext: () => i < m.length, next: () => m[i++] }; }; f.createFolder = (n) => { const k = mkFolder(n); f.kids.push(k); return k; };
  f.createFile = (blob) => { const x = { id: `file${++drive.n}0000000`, name: blob.getName(), bytes: blob.getBytes(), trashed: false, viewers: [] }; x.getId = () => x.id; x.getUrl = () => `https://drive.google.com/file/d/${x.id}/view`; x.getName = () => x.name; x.getBlob = () => ({ getBytes: () => x.bytes });
    x.setTrashed = (t) => { x.trashed = t; }; x.isTrashed = () => x.trashed; x.addViewer = (e) => { x.viewers.push(e); }; x.getParents = () => ({ hasNext: () => true, next: () => f }); drive.files[x.id] = x; f.files.push(x); return x; };
  return f; };
const driveRoot = mkFolder('root');
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
  const store = { GOOGLE_CLIENT_ID: CLIENT, SESSION_SECRET: 'secret-secret-secret', LOG_SHEET_ID: 'sheet', SHORT_BASE: 'https://sand.example.go.th', DRIVE_FOLDER_ID: 'root', ADMIN_EMAILS: 'admin@example.go.th', EDGE_SECRET: 'edge-secret', ...extra };
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
        return fmt === 'H' ? String(Number(p.hour)) : fmt === 'yyyy-MM' ? `${p.year}-${p.month}` : fmt === 'yyyy-MM-dd' ? `${p.year}-${p.month}-${p.day}` : `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`; },
      base64EncodeWebSafe: (x) => (typeof x === 'string' ? Buffer.from(x, 'utf8') : unsigned(x)).toString('base64url') + '==',
      base64DecodeWebSafe: (s) => toSigned(Buffer.from(s, 'base64url')),
      computeHmacSha256Signature: (data, key) => toSigned(crypto.createHmac('sha256', key).update(data).digest()),
      newBlob: (bytes, mime, name) => ({ getDataAsString: () => unsigned(bytes).toString('utf8'), getBytes: () => bytes, getName: () => name }),
      base64Decode: (t) => { if (/[^A-Za-z0-9+/=]/.test(t)) throw new Error('bad'); return toSigned(Buffer.from(t, 'base64')); },
      base64Encode: (b) => unsigned(b).toString('base64')
    },
    DriveApp: { getFolderById: () => driveRoot, getFileById: (id) => { if (!drive.files[id]) throw new Error('nf'); return drive.files[id]; } },
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

const dz = { fg: '#000000', bg: '#ffffff', style: 'square', ec: 'M', margin: 4, size: 512, cat: 'general', cap: '' };
const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(40, 7)]).toString('base64');
const mkSite = (e, s, url = 'https://hospital.example.go.th') => e.post({ action: 'projects', session: s, op: 'create', name: 'เว็บโรงพยาบาล', url }).data.site.key;
const hit = (e, key, p, extra = {}) => e.post({ action: 'hit', secret: 'edge-secret', k: key, t: 'pv', p, host: 'hospital.example.go.th', device: 'mobile', browser: 'Chrome', os: 'Android', country: 'TH', vid: 'abcdef123456', ...extra });

test('every row records its URLs: short URL (SHORT_BASE or the page origin), destination, static URL-QR address', () => {
  const e = makeEnv(); const s = e.login('somchai@example.go.th');
  const q = e.post({ action: 'links', session: s, op: 'create', kind: 'qr', title: 'QR สมัคร', url: 'example.com/join', qr: { d: dz } }).data.link;
  assert.equal(q.short, `https://sand.example.go.th/s/${q.code}`); assert.equal(q.url, 'https://example.com/join'); assert.equal(q.origin, 'app'); assert.equal(q.hasImg, false);
  const st = e.post({ action: 'links', session: s, op: 'create', kind: 'qrs', title: 'QR ลิงก์ตรง', qr: { t: 'url', d: dz, f: { url: 'https://forms.gle/abc' } } }).data.link;
  assert.equal(st.url, 'https://forms.gle/abc'); assert.equal(st.short, ''); assert.equal(e.get({ action: 'go', c: st.code }).data.reason, 'notfound');
  assert.equal(e.post({ action: 'links', session: s, op: 'create', kind: 'qrs', title: 'ข้อความ', qr: { t: 'text', d: dz, f: { text: 'สวัสดี' } } }).data.link.url, '');
  const row = e.sheets.Links.rows.find((r) => r[0] === q.code); assert.equal(row[14], 'app'); assert.equal(row[15], q.short); assert.equal(row.length, 18);
  const e2 = makeEnv({ SHORT_BASE: '' }); const s2 = e2.login('somchai@example.go.th');
  const a = e2.post({ action: 'links', session: s2, op: 'create', url: 'https://example.com/a', origin: 'https://sandtools.vercel.app' }).data.link; assert.equal(a.short, `https://sandtools.vercel.app/s/${a.code}`);
  assert.equal(e2.post({ action: 'links', session: s2, op: 'create', url: 'https://example.com/b', origin: 'https://evil.example/x y' }).data.link.short, '', 'a malformed origin is never stored');
});

test('QR picture: kept in Drive under <root>/<month>/<email>/QR, URL recorded, replaced (old trashed), owner-only, PNG-only', () => {
  const e = makeEnv(); const s = e.login('somchai@example.go.th'); const other = e.login('other@example.go.th'); const admin = e.login('admin@example.go.th');
  const l = e.post({ action: 'links', session: s, op: 'create', kind: 'qr', title: 'QR แบบประเมิน', url: 'https://example.com/s', qr: { d: dz } }).data.link;
  const r = e.post({ action: 'links', session: s, op: 'saveimg', code: l.code, data: PNG }); assert.equal(r.success, true, JSON.stringify(r.error));
  assert.match(r.data.imgUrl, /drive\.google\.com/); assert.equal(r.data.link.hasImg, true);
  const month = driveRoot.kids[0]; assert.match(month.name, /^\d{4}-\d{2}$/); const mail = month.kids[0]; assert.equal(mail.name, 'somchai@example.go.th'); const qrDir = mail.kids[0]; assert.equal(qrDir.name, 'QR');
  assert.equal(qrDir.files.length, 1); assert.match(qrDir.files[0].name, new RegExp(`^qr_${l.code}_QR แบบประเมิน\\.png$`)); assert.deepEqual(qrDir.files[0].viewers, ['somchai@example.go.th']);
  const row = e.sheets.Links.rows.find((x) => x[0] === l.code); assert.equal(row[16], qrDir.files[0].id); assert.equal(row[17], r.data.imgUrl);
  assert.equal(e.post({ action: 'links', session: s, op: 'getimg', code: l.code }).data.dataUrl, `data:image/png;base64,${PNG}`);
  assert.equal(e.post({ action: 'links', session: s, op: 'saveimg', code: l.code, data: PNG }).success, true);
  assert.equal(qrDir.files.length, 2); assert.equal(qrDir.files[0].trashed, true); assert.equal(qrDir.files[1].trashed, false); assert.equal(mail.kids.length, 1, 'the QR folder is reused');
  assert.equal(e.post({ action: 'links', session: s, op: 'saveimg', code: l.code, data: Buffer.from('<html>......').toString('base64') }).error.code, 'BAD_REQUEST');
  assert.equal(e.post({ action: 'links', session: s, op: 'saveimg', code: l.code, data: '!!!' }).error.code, 'BAD_REQUEST');
  assert.equal(e.post({ action: 'links', session: other, op: 'saveimg', code: l.code, data: PNG }).error.code, 'NOT_FOUND');
  assert.equal(e.post({ action: 'links', session: other, op: 'getimg', code: l.code }).error.code, 'NOT_FOUND');
  assert.equal(e.post({ action: 'links', session: admin, op: 'getimg', code: l.code }).success, true);
  const none = e.post({ action: 'links', session: s, op: 'create', kind: 'qrs', title: 'x', qr: { t: 'text', d: dz, f: { text: 'a' } } }).data.link; assert.equal(e.post({ action: 'links', session: s, op: 'getimg', code: none.code }).error.code, 'NOT_FOUND');
  const e3 = makeEnv({ DRIVE_FOLDER_ID: '' }); const s3 = e3.login('somchai@example.go.th'); const l3 = e3.post({ action: 'links', session: s3, op: 'create', url: 'https://example.com/z' }).data.link;
  assert.equal(e3.post({ action: 'links', session: s3, op: 'saveimg', code: l3.code, data: PNG }).error.code, 'NOT_CONFIGURED');
});

test('attached OLD QR (qrx): no short link, never redirects, belongs to a project, counted in the project card', () => {
  const e = makeEnv(); const s = e.login('somchai@example.go.th'); const key = mkSite(e, s);
  assert.equal(e.post({ action: 'links', session: s, op: 'create', kind: 'qrx', title: ' ', url: 'https://hospital.example.go.th/reg', project: key, qr: { t: 'url', d: dz } }).error.code, 'BAD_REQUEST');
  const r = e.post({ action: 'links', session: s, op: 'create', kind: 'qrx', title: 'โปสเตอร์วัคซีน (พิมพ์ปี 2568)', url: 'hospital.example.go.th/reg', project: key, qr: { t: 'url', d: { ...dz, cat: 'vaccine' }, f: { url: 'ignored' } } });
  assert.equal(r.success, true, JSON.stringify(r.error)); const l = r.data.link;
  assert.equal(l.kind, 'qrx'); assert.equal(l.origin, 'import'); assert.equal(l.short, ''); assert.equal(l.project, key); assert.equal(l.url, 'https://hospital.example.go.th/reg'); assert.ok(!('f' in l.qr));
  assert.equal(e.get({ action: 'go', c: l.code }).data.reason, 'notfound');
  const noUrl = e.post({ action: 'links', session: s, op: 'create', kind: 'qrx', title: 'QR Wi-Fi เดิม', project: key, qr: { t: 'wifi', d: dz } }); assert.equal(noUrl.success, true); assert.equal(noUrl.data.link.url, '');
  assert.equal(e.post({ action: 'links', session: s, op: 'create', kind: 'qrx', title: 'bad', url: 'ftp://x/y', qr: { t: 'url', d: dz } }).error.code, 'BAD_URL');
  assert.equal(e.post({ action: 'links', session: s, op: 'update', code: l.code, url: 'https://hospital.example.go.th/reg2', title: 'โปสเตอร์ใหม่' }).data.link.url, 'https://hospital.example.go.th/reg2');
  assert.equal(e.post({ action: 'links', session: s, op: 'update', code: l.code, project: '' }).data.link.project, '');
  assert.equal(e.post({ action: 'links', session: s, op: 'update', code: l.code, project: key }).data.link.project, key);
  const p = e.post({ action: 'projects', session: s, op: 'list' }).data.items[0]; assert.equal(p.links, 2); assert.equal(p.qrs, 2);
  assert.equal(e.post({ action: 'projects', session: s, op: 'overview', days: 7 }).data.links.qrx, 2);
});

test('old QR statistics = page views of its destination page (robots out, utm_source isolates the QR, other domains refused)', () => {
  const e = makeEnv(); const s = e.login('somchai@example.go.th'); const key = mkSite(e, s);
  const mk = (url, extra = {}) => e.post({ action: 'links', session: s, op: 'create', kind: 'qrx', title: 'QR เดิม', url, project: key, qr: { t: 'url', d: dz }, ...extra }).data.link;
  const plain = mk('https://hospital.example.go.th/register/'); const utm = mk('https://hospital.example.go.th/register?utm_source=poster'); const far = mk('https://other.example.org/x'); const free = mk('https://hospital.example.go.th/x', { project: '' });
  hit(e, key, '/register'); hit(e, key, '/register', { vid: '0123456789ab', utm: 'poster' }); hit(e, key, '/register', { vid: 'ffffffffffff', bot: true }); hit(e, key, '/other', { vid: 'aaaaaaaaaaaa' }); hit(e, key, '/register', { vid: 'abcdef123456' });
  const a = e.post({ action: 'links', session: s, op: 'stats', code: plain.code, days: 7 }).data;
  assert.equal(a.mode, 'pageviews'); assert.equal(a.linked, true); assert.equal(a.matched.path, '/register'); assert.equal(a.total, 3); assert.equal(a.bots, 1); assert.equal(a.unique, 2); assert.equal(a.byDay.length, 7); assert.equal(a.byDay.reduce((x, d) => x + d.n, 0), 3); assert.equal(a.devices[0].name, 'mobile');
  const u = e.post({ action: 'links', session: s, op: 'stats', code: utm.code, days: 30 }).data; assert.equal(u.matched.utm, 'poster'); assert.equal(u.total, 1);
  const f = e.post({ action: 'links', session: s, op: 'stats', code: far.code }).data; assert.equal(f.linked, false); assert.equal(f.reason, 'other-domain');
  assert.equal(e.post({ action: 'links', session: s, op: 'stats', code: free.code }).data.reason, 'no-project');
  assert.equal(e.post({ action: 'links', session: e.login('other@example.go.th'), op: 'stats', code: plain.code }).error.code, 'NOT_FOUND');
});

test('request size: only a QR picture may be large; everything else keeps the 8 KB limit', () => {
  const e = makeEnv(); const s = e.login('somchai@example.go.th'); const l = e.post({ action: 'links', session: s, op: 'create', url: 'https://example.com/z' }).data.link;
  const big = Buffer.concat([Buffer.from([137, 80, 78, 71]), Buffer.alloc(60000, 1)]).toString('base64');
  assert.equal(e.post({ action: 'links', session: s, op: 'saveimg', code: l.code, data: big }).success, true);
  assert.equal(e.post({ action: 'links', session: s, op: 'update', code: l.code, note: 'x'.repeat(9000) }).error.code, 'REQUEST_TOO_LARGE');
  assert.equal(e.post({ action: 'links', session: s, op: 'saveimg', code: l.code, data: Buffer.alloc(2000000, 1).toString('base64') }).error.code, 'REQUEST_TOO_LARGE');
  const f = e.get({ action: 'health' }).data.features; assert.ok(f.includes('qrimg') && f.includes('qrx'));
});
