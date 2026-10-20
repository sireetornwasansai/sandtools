// Shared Node-VM environment for gas/Saraban.gs (+ Inbox.gs, SarImport.gs): in-memory sheets, fake clock, no Google services.
import vm from 'node:vm';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f) => fs.readFileSync(path.join(root, 'gas', f), 'utf8');
const SARABAN = read('Saraban.gs'); const INBOX = read('Inbox.gs'); const IMPORT = read('SarImport.gs');
export const T0 = Date.parse('2026-10-15T03:00:00Z'); // 10:00 Bangkok, Thu 15 Oct 2026 (BE 2569)

export function env(props = {}, { withInbox = true } = {}) {
  const store = { ADMIN_EMAILS: 'admin@x.go.th', SARABAN_STAFF_EMAILS: 'clerk@x.go.th,clerk2@x.go.th,secret@x.go.th', SARABAN_EXEC_EMAILS: 'boss@x.go.th', SARABAN_SECRET_EMAILS: 'secret@x.go.th,clerk2@x.go.th', SAR_ORG_NAME: 'รพ.ทดสอบ', SAR_BOOK_PREFIX: 'สธ 0123.4', EDGE_SECRET: 's3cret', TG_ALLOWED_CHATS: '-1001', ...props };
  const clock = { t: T0 }; const sheets = {}; const who = { email: 'clerk@x.go.th' }; const grants = []; const files = {}; const logs = [];
  const grid = (name) => (sheets[name] = sheets[name] || [[]]);
  const mk = (name) => {
    const g = grid(name);
    return {
      getLastRow: () => g.length, getMaxRows: () => g.length + 50,
      getRange: (r, c, nr = 1, nc = 1) => ({
        getValues: () => { const out = []; for (let i = 0; i < nr; i += 1) { const row = g[r - 1 + i] || []; const line = []; for (let j = 0; j < nc; j += 1) line.push(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]); out.push(line); } return out; },
        setValues(v) { v.forEach((line, i) => { const row = (g[r - 1 + i] = g[r - 1 + i] || []); line.forEach((x, j) => { row[c - 1 + j] = String(x == null ? '' : x); }); }); return this; },
        setNumberFormat() { return this; }, setFontWeight() { return this; }, setFontColor() { return this; }, setBackground() { return this; }
      }),
      appendRow: (arr) => { g.push(arr.map(String)); }, setFrozenRows() {}, setTabColor() {}, setColumnWidth() {}
    };
  };
  class FakeDate extends Date { constructor(...a) { if (a.length) super(...a); else super(clock.t); } static now() { return clock.t; } }
  const ctx = {
    console: { log() {}, error() {} }, Date: FakeDate, JSON, Math, Object, Array, String, Number, parseInt, isFinite, RegExp, Error,
    prop: (k) => store[k] || '', intProp: (k, d) => (store[k] ? Number(store[k]) : d), listProp: (k) => (store[k] || '').split(/[,\s]+/).map((s) => s.toLowerCase()).filter(Boolean),
    safeEqual: (a, b) => a === b, httpError: (code, message) => Object.assign(new Error(message), { code, expected: true }), rateLimit() {},
    sheetTab: (name) => { grid(name); return mk(name); }, LOG_HEADERS: [], cell: (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').slice(0, max || 300),
    lnkLocked: (fn) => fn(), LNK_ALPHABET: 'abcdefghjkmnpqrstuvwxyz23456789', LNK_TZ: 'Asia/Bangkok',
    lnkScope: (u) => ({ email: u.email, admin: (store.ADMIN_EMAILS || '').split(',').includes(u.email) }), requireUser: () => ({ email: who.email }),
    hmac: (s) => crypto.createHmac('sha256', 'k').update(s).digest('base64url'),
    lnkStamp: (ms) => new Date(ms + 7 * 3600e3).toISOString(), libTags: (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((s) => String(s).trim()).filter(Boolean),
    lnkCheckUrl: (u) => { if (!/^https?:\/\//i.test(u)) throw new Error('bad'); return u; }, UrlFetchApp: { fetch() { throw new Error('no network'); } },
    Utilities: {
      getUuid: () => crypto.randomUUID(), DigestAlgorithm: { MD5: 'md5' }, computeDigest: (a, s) => [...crypto.createHash('md5').update(s).digest()],
      base64EncodeWebSafe: (x) => Buffer.from(x.map((b) => (b < 0 ? b + 256 : b))).toString('base64url'), base64Decode: (s) => [...Buffer.from(s, 'base64')].map((b) => (b > 127 ? b - 256 : b)),
      newBlob: (bytes, mime, name) => ({ bytes, mime, name }),
      formatDate: (d, tz, f) => { const t = new Date(d.getTime() + 7 * 3600e3).toISOString(); return f === 'yyyy' ? t.slice(0, 4) : f === 'yyyy-MM-dd' ? t.slice(0, 10) : f === 'yyyy-MM-dd HH:mm:ss' ? t.slice(0, 10) + ' ' + t.slice(11, 19) : t.slice(0, 7); }
    }
  };
  vm.createContext(ctx); vm.runInContext(SARABAN, ctx); if (withInbox) vm.runInContext(INBOX, ctx);
  vm.runInContext(IMPORT, ctx);
  // Drive is out of scope for unit tests: replace the thin wrappers.
  ctx.sarSave = (kind, name, bytes, mime, email) => { const id = 'F' + crypto.randomBytes(8).toString('hex'); files[id] = { id, url: `https://drive.google.com/file/d/${id}/view`, name, desc: 'sar:' + email }; return files[id]; };
  ctx.sarFileInfo = (id) => files[id] || null; ctx.sarGrant = (id, emails) => grants.push({ id, emails });
  const logRows = () => logs;
  const call = (email, op, body = {}) => { who.email = email; return ctx.saraban({ session: 's', op, ...body }); };
  const as = (email) => (op, body) => call(email, op, body);
  const seed = () => { ctx.setupSarabanSeed = null; };
  return { ctx, store, sheets, clock, who, grants, files, call, as, logRows, seed };
}
