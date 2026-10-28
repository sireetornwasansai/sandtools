// Upload integrity: a file that reaches Drive must be complete, must not be lost to lock contention or a flaky phone connection,
// and a saved record must never lose its attachment proof. Covers Code.gs archive, Hr.gs uploadFile, Inbox.gs Telegram copy, api.js retry.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hrEnv } from './helpers/hr-env.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, 'gas', f), 'utf8');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj').toString('base64');
const rec = (o = {}) => ({ name: 'สมชาย ใจดี', department: 'กลุ่มงานโสตฯ', type: 'ประชุม', startDate: '2026-10-20', endDate: '2026-10-20', startTime: '09:00', endTime: '11:00', note: '', ...o });

/** A Drive that remembers files; `shortBy` makes getSize come back smaller than what was written (an incomplete write). */
function fakeDrive({ shortBy = 0 } = {}) {
  const files = {}; let n = 0; const created = [];
  const mkFile = (blob) => {
    const id = 'DRV' + String(++n).padStart(6, '0') + 'abcdefghijkl'; const f = { id, name: blob.name, size: (blob.b || blob.bytes || blob.getBytes()).length, desc: '', trashed: false }; files[id] = f; created.push(f);
    return { getId: () => id, getName: () => f.name, getUrl: () => `https://drive.google.com/file/d/${id}/view`, getSize: () => Math.max(0, f.size - shortBy), setSharing() {}, addViewer() {},
      setDescription: (d) => { f.desc = d; }, getDescription: () => f.desc, getDateCreated: () => new Date(), setTrashed: () => { f.trashed = true; } };
  };
  return { files, created, mkFile, folder: () => ({ createFile: mkFile }), byId: (id) => { const f = files[id]; if (!f) throw new Error('not found'); return { getDescription: () => f.desc, getDateCreated: () => new Date(), getSize: () => f.size }; } };
}

/* ------------------------------ Code.gs · archive ------------------------------ */
function archEnv({ lockFails = false, shortBy = 0 } = {}) {
  const store = { DRIVE_FOLDER_ID: 'root' }; const cache = {}; const drive = fakeDrive({ shortBy }); const state = { held: false, createdWhileHeld: 0, rows: 0 };
  const ctx = {
    console: { log() {}, error() {} }, Date, JSON, Math, Number, String, parseInt, isFinite, encodeURIComponent, Buffer,
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in store ? store[k] : null), setProperty() {} }) },
    CacheService: { getScriptCache: () => ({ get: (k) => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = v; } }) },
    LockService: { getScriptLock: () => ({ waitLock() { if (lockFails) throw new Error('Lock timeout'); state.held = true; }, releaseLock() { state.held = false; } }) },
    Utilities: { getUuid: () => 'u', base64Decode: (s) => [...Buffer.from(s, 'base64')], newBlob: (b, mime, name) => ({ b, mime, name }), formatDate: () => '2026-10' },
    DriveApp: { getFolderById: () => ({}) }
  };
  vm.createContext(ctx); vm.runInContext(read('Code.gs'), ctx);
  ctx.requireUser = () => ({ email: 'u@x.go.th' }); ctx.rateLimit = () => {};
  ctx.sheetTab = () => ({ appendRow() { state.rows += 1; } }); ctx.linkToLog = () => {}; ctx.libIndexFile = () => {};
  ctx.subFolder = () => ({ createFile: (blob) => { if (state.held) state.createdWhileHeld += 1; return drive.mkFile(blob); } });
  return { ctx, drive, state, archive: (o = {}) => ctx.archive({ session: 's', tool: 'pdf', logId: 'L1', role: 'input', name: 'a.pdf', mime: 'application/pdf', data: PDF, ...o }) };
}

test('archive: still stores the file when the script lock is busy (a lost lock must not lose the copy)', () => {
  const e = archEnv({ lockFails: true });
  const r = e.archive(); assert.ok(r.fileId); assert.equal(e.drive.created.length, 1);
});
test('archive: the big createFile call runs outside the script lock', () => {
  const e = archEnv(); e.archive(); assert.equal(e.drive.created.length, 1); assert.equal(e.state.createdWhileHeld, 0);
});
test('archive: a short write is detected, the broken file is trashed and nothing is recorded', () => {
  const e = archEnv({ shortBy: 3 });
  assert.throws(() => e.archive(), { code: 'UPLOAD_INCOMPLETE' });
  assert.equal(e.drive.created[0].trashed, true); assert.equal(e.state.rows, 0);
});
test('archive: a retry with the same key (answer lost on the phone) is answered, not stored twice', () => {
  const e = archEnv(); const a = e.archive({ key: 'key-0001' }); const b = e.archive({ key: 'key-0001' });
  assert.equal(a.fileId, b.fileId); assert.equal(e.drive.created.length, 1);
  assert.notEqual(e.archive({ key: 'key-0002' }).fileId, a.fileId);
});

/* ------------------------------ Hr.gs · uploadFile ------------------------------ */
function hrWithDrive(opts) {
  const e = hrEnv(); const d = fakeDrive(opts);
  e.ctx.DriveApp.createFolder = () => d.folder(); e.ctx.DriveApp.getFileById = (id) => d.byId(id);
  return { e, d };
}
test('HR: an attachment is still accepted after the 6-hour cache proof is gone (proof also lives on the Drive file)', () => {
  const { e } = hrWithDrive(); const up = e.call('uploadFile', [{ fileBase64: PDF, fileName: 'a.pdf' }]); assert.equal(up.status, 'success');
  e.ctx.CacheService = { getScriptCache: () => ({ get: () => null, put() {}, removeAll() {} }) };
  assert.equal(e.call('saveData', [rec({ files: [up.url], clientId: 'cache-gone-1' })]).status, 'success');
});
test('HR: the Drive-side proof is per person — someone else cannot reuse a link', () => {
  const { e } = hrWithDrive(); const up = e.call('uploadFile', [{ fileBase64: PDF, fileName: 'a.pdf' }], 'other@x.go.th');
  e.ctx.CacheService = { getScriptCache: () => ({ get: () => null, put() {}, removeAll() {} }) };
  assert.equal(e.call('saveData', [rec({ files: [up.url] })], 'user@x.go.th').status, 'error');
});
test('HR: an incomplete write is reported (not saved as a good attachment) and the broken file is trashed', () => {
  const { e, d } = hrWithDrive({ shortBy: 2 }); const up = e.call('uploadFile', [{ fileBase64: PDF, fileName: 'a.pdf' }]);
  assert.equal(up.status, 'error'); assert.match(up.message, /ไม่สมบูรณ์/); assert.equal(d.created[0].trashed, true);
});

/* ------------------------------ Inbox.gs · Telegram copy ------------------------------ */
function inboxEnv(sizes) {
  const store = { TG_BOT_TOKEN: 't', DRIVE_FOLDER_ID: 'root' }; const drive = fakeDrive(); let dl = 0;
  const ctx = {
    console: { log() {}, error() {} }, JSON, Math, Date, Number, String, encodeURIComponent,
    prop: (k) => store[k] || '', listProp: () => [], LNK_TZ: 'Asia/Bangkok', libIndexFile() {}, subFolder: () => drive.folder(), DriveApp: { getFolderById: () => ({}) },
    Utilities: { formatDate: () => '2026-10' },
    UrlFetchApp: { fetch: (u) => {
      if (/getFile/.test(u)) return { getContentText: () => JSON.stringify({ ok: true, result: { file_path: 'docs/a.pdf' } }) };
      const size = sizes[Math.min(dl++, sizes.length - 1)]; const bytes = Array.from({ length: size }, () => 1);
      return { getResponseCode: () => 200, getBlob: () => ({ getBytes: () => bytes, setName() {} }) };
    } }
  };
  vm.createContext(ctx); vm.runInContext(read('Inbox.gs'), ctx); return { ctx, drive, downloads: () => dl };
}
test('Inbox: a truncated Telegram download is retried once and the complete copy is kept', () => {
  const e = inboxEnv([50, 100]); const url = e.ctx.inbFetchDoc({ file_id: 'x', size: 100, file_name: 'a.pdf' }, Date.now());
  assert.match(url, /drive\.google\.com/); assert.equal(e.downloads(), 2); assert.equal(e.drive.created.length, 1);
});
test('Inbox: a download that stays incomplete is not stored as if it were the letter', () => {
  const e = inboxEnv([50]); assert.equal(e.ctx.inbFetchDoc({ file_id: 'x', size: 100, file_name: 'a.pdf' }, Date.now()), ''); assert.equal(e.drive.created.length, 0);
});

/* ------------------------------ api.js · retry for uploads ------------------------------ */
test('api: gasCallRetry retries a dropped connection, but never an answer the server gave', async () => {
  globalThis.window = { SAND_CONFIG: { gasUrl: 'https://gas.test/exec' } };
  const api = await import('../src/js/core/api.js'); assert.equal(typeof api.gasCallRetry, 'function');
  let calls = 0; const answers = [() => { throw new TypeError('Failed to fetch'); }, () => ({ json: async () => ({ success: true, data: { ok: 1 } }), ok: true })];
  globalThis.fetch = async () => answers[Math.min(calls++, answers.length - 1)]();
  assert.deepEqual((await api.gasCallRetry('archive', {}, 1000, { tries: 3, delayMs: 1 })).data, { ok: 1 }); assert.equal(calls, 2);
  calls = 0; globalThis.fetch = async () => { calls += 1; return { ok: true, json: async () => ({ success: false, error: { code: 'FILE_TOO_LARGE', message: 'x' } }) }; };
  await assert.rejects(() => api.gasCallRetry('archive', {}, 1000, { tries: 3, delayMs: 1 }), { code: 'FILE_TOO_LARGE' }); assert.equal(calls, 1);
  calls = 0; globalThis.fetch = async () => { calls += 1; throw new TypeError('Failed to fetch'); };
  await assert.rejects(() => api.gasCallRetry('archive', {}, 1000, { tries: 3, delayMs: 1 }), { code: 'NETWORK' }); assert.equal(calls, 3);
});
