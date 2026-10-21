// Runs gas/Hr.gs + gas/HrLine.gs in a Node VM with in-memory sheets and fake Apps Script services (UrlFetchApp, CacheService, ScriptApp …),
// so the LINE notifications can be tested without LINE or Google.
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f) => fs.readFileSync(path.join(root, 'gas', f), 'utf8');

export function lineEnv(props = {}, now = '2026-10-30T08:00:00Z') {   // Friday 30 Oct 2026, 15:00 in Bangkok — also the last working day of October
  const store = { ADMIN_EMAILS: 'admin@x.go.th', EDGE_SECRET: 'edge-secret', LINE_CHANNEL_ACCESS_TOKEN: 'tok', ...props };
  const sheets = {}; const who = { email: 'user@x.go.th' }; const fetchLog = []; const triggers = []; const cache = new Map();
  const clock = { t: Date.parse(now) };
  const net = { quota: { type: 'none' }, used: { totalUsage: 0 }, fail: false, profile: { displayName: 'เพื่อนใหม่' } };
  const mk = (name) => {
    const g = (sheets[name] = sheets[name] || []);
    return {
      getLastRow: () => g.length, getMaxColumns: () => 40, getParent: () => ({ getSpreadsheetTimeZone: () => 'Asia/Bangkok' }),
      insertColumnsAfter() {}, setFrozenRows() {}, appendRow: (a) => { g.push(a.map((v) => (v instanceof Date ? v : String(v)))); },
      deleteRow: (r) => { g.splice(r - 1, 1); }, deleteRows: (r, n) => { g.splice(r - 1, n); },
      getRange: (r, c, nr = 1, nc = 1) => ({
        getValues: () => { const out = []; for (let i = 0; i < nr; i++) { const row = g[r - 1 + i] || []; const l = []; for (let j = 0; j < nc; j++) l.push(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]); out.push(l); } return out; },
        setValues(v) { v.forEach((line, i) => { const row = (g[r - 1 + i] = g[r - 1 + i] || []); line.forEach((x, j) => { row[c - 1 + j] = x instanceof Date ? x : String(x); }); }); return this; },
        setValue(x) { const row = (g[r - 1] = g[r - 1] || []); row[c - 1] = String(x); return this; }, setNumberFormat() { return this; }
      })
    };
  };
  class FakeDate extends Date { constructor(...a) { if (a.length) super(...a); else super(clock.t); } static now() { return clock.t; } }
  const pad = (n) => String(n).padStart(2, '0');
  const res = (code, body) => ({ getResponseCode: () => code, getContentText: () => (typeof body === 'string' ? body : JSON.stringify(body)) });
  const mkTrigger = (fn) => { const t = { fn, kind: '', weekday: '', hour: -1, minute: -1 }; const b = { timeBased: () => b, onWeekDay: (d) => { t.kind = 'weekly'; t.weekday = d; return b; }, everyDays: () => { t.kind = 'daily'; return b; }, atHour: (h) => { t.hour = h; return b; }, nearMinute: (m) => { t.minute = m; return b; }, create: () => { triggers.push(t); return t; } }; return b; };
  const ctx = {
    console: { log() {}, error() {}, warn() {} }, Date: FakeDate, JSON, Math, Object, Array, String, Number, parseInt, parseFloat, isFinite, isNaN, RegExp, Error, encodeURIComponent,
    prop: (k) => store[k] || '', intProp: (k, d) => (store[k] ? Number(store[k]) : d), listProp: (k) => (store[k] || '').split(/[,\s]+/).map((s) => s.toLowerCase()).filter(Boolean),
    httpError: (code, message) => Object.assign(new Error(message), { code, expected: true }), rateLimit() {},
    safeEqual: (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && a === b,
    requireUser: () => ({ email: who.email }), LOG_HEADERS: [], REQ: {},
    cell: (v, max) => { v = String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').slice(0, max || 300); return /^[=+\-@]/.test(v) ? `'${v}` : v; },
    sheetTab: (name) => mk(name), styleTab() {}, subFolder: () => ({}),
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in store ? store[k] : null), setProperty: (k, v) => { store[k] = String(v); } }) },
    CacheService: { getScriptCache: () => ({ get: (k) => (cache.has(k) ? cache.get(k) : null), put: (k, v) => { cache.set(k, v); }, removeAll: (ks) => ks.forEach((k) => cache.delete(k)) }) },
    ScriptApp: { WeekDay: { MONDAY: 'MONDAY', TUESDAY: 'TUESDAY', WEDNESDAY: 'WEDNESDAY', THURSDAY: 'THURSDAY', FRIDAY: 'FRIDAY', SATURDAY: 'SATURDAY', SUNDAY: 'SUNDAY' }, newTrigger: mkTrigger, getProjectTriggers: () => triggers.map((t) => ({ getHandlerFunction: () => t.fn, _t: t })), deleteTrigger: (h) => { const i = triggers.indexOf(h._t); if (i >= 0) triggers.splice(i, 1); } },
    UrlFetchApp: {
      fetch: (url, opt = {}) => {
        const body = opt.payload ? JSON.parse(opt.payload) : null; fetchLog.push({ url, method: opt.method, body, auth: opt.headers && opt.headers.Authorization });
        if (net.fail) return res(500, { message: 'boom' });
        if (url.endsWith('/message/quota')) return res(200, net.quota);
        if (url.endsWith('/message/quota/consumption')) return res(200, net.used);
        if (url.includes('/bot/profile/')) return res(200, net.profile);
        return res(200, {});
      }
    },
    Utilities: {
      getUuid: () => 'xxxxxxxx-' + Math.random().toString(16).slice(2), base64Decode: (s) => [...Buffer.from(s, 'base64')], newBlob: (b, mime, name) => ({ b, mime, name }),
      formatDate: (d, tz, f) => { const t = new Date(d.getTime() + 7 * 3600e3); const Y = t.getUTCFullYear(), M = pad(t.getUTCMonth() + 1), D = pad(t.getUTCDate()), h = pad(t.getUTCHours()), m = pad(t.getUTCMinutes()), s = pad(t.getUTCSeconds()); return f.replace('yyyy', Y).replace('MM', M).replace('dd', D).replace('HH', h).replace('mm', m).replace('ss', s); }
    },
    DriveApp: {}, SpreadsheetApp: { newDataValidation: () => ({ requireValueInList() { return this; }, setAllowInvalid() { return this; }, build() { return {}; } }) }
  };
  vm.createContext(ctx); vm.runInContext(read('Hr.gs'), ctx); vm.runInContext(read('HrLine.gs'), ctx);
  const env = {
    ctx, sheets, store, clock, net, fetchLog, triggers,
    as: (email) => { who.email = email; },
    call: (op, args = [], email) => { if (email) who.email = email; ctx.REQ = {}; return ctx.hr({ session: 's', op, args }); },
    run: (fn, ...args) => { ctx.REQ = {}; return ctx[fn](...args); },
    addUser: (userId, name, role = '', enabled = 'TRUE', status = 'active') => { ctx.REQ = {}; ctx.hrTab('LUSERS').appendRow([userId, name, '01/10/2026 09:00:00', status, '01/10/2026 09:00:00', role, enabled]); },
    pushes: () => fetchLog.filter((f) => f.method === 'post'),
    clear: () => { fetchLog.length = 0; }
  };
  return env;
}
