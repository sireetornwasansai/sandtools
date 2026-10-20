// Runs gas/Hr.gs in a Node VM with in-memory sheets / Drive, so the HR backend can be tested (and served to the browser in the e2e test).
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HR = fs.readFileSync(path.join(root, 'gas', 'Hr.gs'), 'utf8');

export function hrEnv(props = {}, now = '2026-10-19T03:00:00Z') {
  const store = { ADMIN_EMAILS: 'admin@x.go.th', HR_DEV_EMAILS: 'dev@x.go.th', ...props };
  const sheets = {}; const who = { email: 'user@x.go.th' }; const files = [];
  const clock = { t: Date.parse(now) };
  const mk = (name) => {
    const g = (sheets[name] = sheets[name] || []); const sh = {
      getLastRow: () => g.length, getMaxColumns: () => 40, getParent: () => ({ getSpreadsheetTimeZone: () => 'Asia/Bangkok' }),
      insertColumnsAfter() {}, setFrozenRows() {}, appendRow: (a) => { g.push(a.map((v) => (v instanceof Date ? v : String(v)))); },
      deleteRow: (r) => { g.splice(r - 1, 1); }, deleteRows: (r, n) => { g.splice(r - 1, n); },
      getRange: (r, c, nr = 1, nc = 1) => ({
        getValues: () => { const out = []; for (let i = 0; i < nr; i++) { const row = g[r - 1 + i] || []; const l = []; for (let j = 0; j < nc; j++) l.push(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]); out.push(l); } return out; },
        setValues(v) { v.forEach((line, i) => { const row = (g[r - 1 + i] = g[r - 1 + i] || []); line.forEach((x, j) => { row[c - 1 + j] = x; }); }); return this; },
        setValue(x) { const row = (g[r - 1] = g[r - 1] || []); row[c - 1] = x; return this; }, setNumberFormat() { return this; }
      })
    }; return sh;
  };
  class FakeDate extends Date { constructor(...a) { if (a.length) super(...a); else super(clock.t); } static now() { return clock.t; } }
  const pad = (n) => String(n).padStart(2, '0');
  const ctx = {
    console: { log() {}, error() {} }, Date: FakeDate, JSON, Math, Object, Array, String, Number, parseInt, parseFloat, isFinite, isNaN, RegExp, Error,
    prop: (k) => store[k] || '', intProp: (k, d) => (store[k] ? Number(store[k]) : d), listProp: (k) => (store[k] || '').split(/[,\s]+/).map((s) => s.toLowerCase()).filter(Boolean),
    httpError: (code, message) => Object.assign(new Error(message), { code, expected: true }), rateLimit() {},
    requireUser: () => ({ email: who.email }), LOG_HEADERS: [], REQ: {},
    cell: (v, max) => { v = String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').slice(0, max || 300); return /^[=+\-@]/.test(v) ? `'${v}` : v; },
    sheetTab: (name) => mk(name), styleTab() {}, subFolder: () => ({}),
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      getUuid: () => 'xxxxxxxx-' + Math.random().toString(16).slice(2), base64Decode: (s) => [...Buffer.from(s, 'base64')], newBlob: (b, mime, name) => ({ b, mime, name }),
      formatDate: (d, tz, f) => { const t = new Date(d.getTime() + 7 * 3600e3); const Y = t.getUTCFullYear(), M = pad(t.getUTCMonth() + 1), D = pad(t.getUTCDate()), h = pad(t.getUTCHours()), m = pad(t.getUTCMinutes()), s = pad(t.getUTCSeconds()); return f.replace('yyyy', Y).replace('MM', M).replace('dd', D).replace('HH', h).replace('mm', m).replace('ss', s); }
    },
    DriveApp: { Access: { ANYONE_WITH_LINK: 1, DOMAIN_WITH_LINK: 2 }, Permission: { VIEW: 1 }, getFoldersByName: () => ({ hasNext: () => false }), createFolder: () => ({ createFile: (blob) => { files.push(blob); return { setSharing() {}, addViewer() {}, getUrl: () => `https://drive.google.com/file/d/${files.length}/view` }; } }) },
    SpreadsheetApp: { newDataValidation: () => ({ requireValueInList() { return this; }, setAllowInvalid() { return this; }, build() { return {}; } }) }
  };
  vm.createContext(ctx); vm.runInContext(HR, ctx);
  return { ctx, sheets, files, store, clock, as: (email) => { who.email = email; }, call: (op, args = [], email) => { if (email) who.email = email; ctx.REQ = {}; return ctx.hr({ session: 's', op, args }); } };
}
