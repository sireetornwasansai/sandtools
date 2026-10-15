// Runs gas/Saraban.gs (+ gas/Inbox.gs) in a Node VM with in-memory sheets: numbering, duplicates, secrecy, routing, SLA, cancel/void, Inbox integration.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, 'gas', f), 'utf8');
const SARABAN = read('Saraban.gs'); const INBOX = read('Inbox.gs');
const T0 = Date.parse('2026-10-15T03:00:00Z'); // 10:00 Bangkok, Thu 15 Oct 2026 (BE 2569)

function env(props = {}, { withInbox = true } = {}) {
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
  // Drive is out of scope for unit tests: replace the thin wrappers.
  ctx.sarSave = (kind, name, bytes, mime, email) => { const id = 'F' + crypto.randomBytes(8).toString('hex'); files[id] = { id, url: `https://drive.google.com/file/d/${id}/view`, name, desc: 'sar:' + email }; return files[id]; };
  ctx.sarFileInfo = (id) => files[id] || null; ctx.sarGrant = (id, emails) => grants.push({ id, emails });
  const logRows = () => logs;
  const call = (email, op, body = {}) => { who.email = email; return ctx.saraban({ session: 's', op, ...body }); };
  const as = (email) => (op, body) => call(email, op, body);
  const seed = () => { ctx.setupSarabanSeed = null; };
  return { ctx, store, sheets, clock, who, grants, files, call, as, logRows, seed };
}
const clerk = 'clerk@x.go.th'; const boss = 'boss@x.go.th'; const admin = 'admin@x.go.th'; const sec = 'secret@x.go.th'; const nobody = 'nurse@x.go.th';
const F = (over = {}) => ({ docNo: 'ศธ 04010/ว1234', docDate: '2026-10-09', subject: 'ขอเชิญประชุมชี้แจงแนวทาง', party: 'สสจ.ทดสอบ', urgency: 'normal', secrecy: 'normal', channel: 'esaraban', ...over });
function units(e) {
  const a = e.as(admin);
  a('unitsave', { code: 'exec', name: 'ผู้บริหาร', short: 'ผอ.', type: 'exec', head: boss });
  a('unitsave', { code: 'nurse', name: 'กลุ่มงานการพยาบาล', short: 'การพยาบาล', head: 'head@x.go.th', members: 'n1@x.go.th,n2@x.go.th', keywords: 'พยาบาล,ผู้ป่วย' });
  a('unitsave', { code: 'fin', name: 'งานการเงิน', short: 'การเงิน', head: 'fin@x.go.th', keywords: 'งบประมาณ,เบิกจ่าย' });
  a('unitsave', { code: 'ext1', name: 'สสจ.ทดสอบ', short: 'สสจ.', type: 'external', email: 'p@x.go.th' });
}

test('pure helpers: dates, working days, SLA, normalisation, sniffing', () => {
  const { ctx } = env();
  assert.equal(ctx.sarAddWorkdays('2026-10-15', 0, []), '2026-10-15');
  assert.equal(ctx.sarAddWorkdays('2026-10-15', 1, []), '2026-10-16');                 // Thu → Fri
  assert.equal(ctx.sarAddWorkdays('2026-10-16', 1, []), '2026-10-19');                 // Fri → Mon
  assert.equal(ctx.sarAddWorkdays('2026-10-15', 2, ['2026-10-16']), '2026-10-20');     // holiday skipped
  assert.equal(ctx.sarDueFor('2026-10-30', 'normal', '2026-10-15', [7, 3, 1, 0], []), '2026-10-30');
  assert.equal(ctx.sarDueFor('', 'most', '2026-10-15', [7, 3, 1, 0], []), '2026-10-15');
  assert.deepEqual([...ctx.sarParseSla('0,1,3,7')], [0, 1, 3, 7]); assert.deepEqual([...ctx.sarParseSla('')], [7, 3, 1, 0]);
  assert.equal(ctx.sarNorm('ศธ 04010 / ว๑๒๓๔'), 'ศธ04010/ว1234');
  assert.equal(ctx.sarDateOk('2569-10-09'), '2026-10-09'); assert.throws(() => ctx.sarDateOk('2026-02-30'), /วันที่/);
  assert.equal(ctx.sarSameLetter({ docNo: 'ศธ 1/2', party: 'สสจ.ก', subject: 'a' }, { docNo: 'ศธ1/2', party: 'สสจ.ก', subject: 'b' }), true);
  assert.equal(ctx.sarSameLetter({ docNo: 'ศธ 1/2', party: 'สสจ.ก', subject: 'a' }, { docNo: 'ศธ 1/3', party: 'สสจ.ก', subject: 'b' }), false);
  assert.equal(ctx.sarMagicOk([0x25, 0x50, 0x44, 0x46]), 'application/pdf'); assert.equal(ctx.sarMagicOk([0x4d, 0x5a, 0, 0]), '');
  assert.equal(ctx.sarEmail('A@B.go.th'), 'a@b.go.th'); assert.equal(ctx.sarEmail('x@y'), '');
});

test('receive: running numbers per Buddhist year, restart on 1 January, void numbers are never reused', () => {
  const e = env(); units(e); const c = e.as(clerk);
  const r1 = c('receive', F({ docNo: 'A1' })); const r2 = c('receive', F({ docNo: 'A2', subject: 'เรื่องอื่น' }));
  assert.equal(r1.doc.reg, '1/2569'); assert.equal(r2.doc.reg, '2/2569'); assert.equal(r1.stamp.org, 'รพ.ทดสอบ'); assert.match(r1.stamp.time, /^10\.00 น\.$/);
  c('cancelno', { id: r2.doc.id, reason: 'ลงรับผิดฉบับ' });
  assert.equal(c('receive', F({ docNo: 'A3', subject: 'เรื่องที่สาม' })).doc.reg, '3/2569', 'a cancelled number stays used');
  e.clock.t = Date.parse('2026-12-31T16:59:00Z');            // 23:59 on 31 Dec
  assert.equal(c('receive', F({ docNo: 'A4', subject: 'ก่อนสิ้นปี' })).doc.reg, '4/2569');
  e.clock.t = Date.parse('2026-12-31T17:01:00Z');            // 00:01 on 1 Jan 2027 → BE 2570
  assert.equal(c('receive', F({ docNo: 'A5', subject: 'ปีใหม่' })).doc.reg, '1/2570');
  assert.equal(c('numbers', { year: 2569 }).in.count, 3);
  assert.deepEqual([...c('numbers', { year: 2569 }).voids.map((v) => v.reg)], ['2/2569']);
});

test('receive: same rid returns the first result (no second number), manual number rules', () => {
  const e = env(); units(e); const c = e.as(clerk);
  const a = c('receive', F({ rid: 'req-12345678' })); const b = c('receive', F({ rid: 'req-12345678' }));
  assert.equal(b.replay, true); assert.equal(b.doc.reg, a.doc.reg);
  assert.equal(c('numbers', {}).in.count, 1);
  assert.equal(c('receive', F({ docNo: 'B1', subject: 'ต่อเลขเดิม', no: '150/2569' })).doc.reg, '150/2569');
  assert.equal(c('receive', F({ docNo: 'B2', subject: 'ต่อไป' })).doc.reg, '151/2569');
  assert.throws(() => c('receive', F({ docNo: 'B3', subject: 'ซ้ำเลข', no: '150/2569' })), /ถูกใช้แล้ว/);
  assert.throws(() => c('receive', F({ docNo: 'B4', subject: 'ปีผิด', no: '5/2570' })), /ปี พ.ศ. 2569/);
  assert.ok(c('numbers', {}).in.gaps.length > 100 || c('numbers', {}).in.gaps.length === 50, 'a jump leaves gaps that the numbers page reports');
});

test('receive: duplicate letters are caught, then accepted only with confirmation', () => {
  const e = env(); units(e); const c = e.as(clerk);
  c('receive', F());
  const again = c('receive', F({ docNo: 'ศธ04010/ว๑๒๓๔' }));
  assert.equal(again.needsConfirm, true); assert.equal(again.dups[0].reg, '1/2569');
  assert.equal(c('numbers', {}).in.count, 1, 'nothing was written');
  assert.equal(c('receive', F({ dupOk: true })).doc.reg, '2/2569');
  assert.equal(c('dup', F()).items.length, 2);
});

test('validation: required fields, dates, party, enums fall back safely', () => {
  const e = env(); units(e); const c = e.as(clerk);
  assert.throws(() => c('receive', F({ subject: '' })), /เรื่อง/);
  assert.throws(() => c('receive', F({ party: '' })), /ผู้ส่ง/);
  assert.throws(() => c('receive', F({ docDate: '2026-13-01' })), /วันที่/);
  assert.throws(() => c('receive', F({ docDate: '2026-10-10', due: '2026-10-01' })), /กำหนดเสร็จ/);
  const r = c('receive', F({ urgency: 'bogus', channel: 'bogus', docDate: '2028-01-01', subject: '=HYPERLINK("x")' }));
  assert.equal(r.doc.urgency, 'normal'); assert.ok(r.warnings.some((w) => /อนาคต/.test(w)));
  const g = c('get', { id: r.doc.id }); assert.equal(g.doc.subject, '=HYPERLINK("x")');     // the sheet formula guard is invisible to users
});

test('roles: only staff/exec read the register; everyone else sees only their own work', () => {
  const e = env(); units(e); const c = e.as(clerk); const r = c('receive', F());
  assert.throws(() => e.as(nobody)('list', {}), /ทะเบียนเปิดให้/);
  assert.throws(() => e.as(nobody)('receive', F({ docNo: 'Z' })), /เฉพาะเจ้าหน้าที่/);
  assert.throws(() => e.as(nobody)('get', { id: r.doc.id }), /ไม่มีสิทธิ์/);
  assert.throws(() => e.as(nobody)('unitsave', { code: 'zz', name: 'x' }), /ผู้ดูแลระบบ/);
  assert.equal(e.as(nobody)('my', {}).items.length, 0);
  assert.equal(e.as(boss)('list', {}).total, 1);
  const cfg = e.as(nobody)('config', {}); assert.equal(cfg.me.staff, false); assert.ok(cfg.units.every((u) => u.head === undefined));
});

test('secrecy: only cleared people see the subject; staff see a masked row; others nothing', () => {
  const e = env(); units(e);
  assert.throws(() => e.as(clerk)('receive', F({ secrecy: 'secret', subject: 'ลับมาก' })), /ชั้นความลับ/);
  const r = e.as(sec)('receive', F({ secrecy: 'secret', subject: 'เรื่องลับเฉพาะ', docNo: 'S1', route: { mode: 'units', units: [{ unit: 'nurse', action: 'perform' }] } }));
  const row = e.as(clerk)('list', {}).items[0];
  assert.equal(row.subject, '(หนังสือชั้นความลับ)'); assert.equal(row.masked, true); assert.equal(row.party, '');
  assert.equal(e.as(clerk)('get', { id: r.doc.id }).doc.subject, '(หนังสือชั้นความลับ)');
  assert.equal(e.as(clerk)('list', { q: 'เรื่องลับเฉพาะ' }).total, 0, 'search must not reveal masked subjects');
  assert.equal(e.as(boss)('get', { id: r.doc.id }).doc.subject, 'เรื่องลับเฉพาะ');
  assert.equal(e.as('head@x.go.th')('get', { id: r.doc.id }).doc.subject, 'เรื่องลับเฉพาะ', 'the head of the receiving unit may read it');
  assert.equal(e.as('n1@x.go.th')('get', { id: r.doc.id }).doc.subject, '(หนังสือชั้นความลับ)', 'ordinary members only see that it exists');
  assert.throws(() => e.as(nobody)('get', { id: r.doc.id }), /ไม่มีสิทธิ์/);
  assert.equal(e.grants.filter((g) => g.emails.includes('n1@x.go.th')).length, 0, 'no Drive access for members on secret letters');
  assert.throws(() => e.as(clerk)('update', { id: r.doc.id, subject: 'x' }), /ไม่มีสิทธิ์/);
  assert.throws(() => e.as(clerk)('cancelno', { id: r.doc.id, reason: 'ทดลองยกเลิก' }), /ชั้นความลับ/);
});

test('routing: forward to units, acknowledge, assign, done — stages, SLA and permissions', () => {
  const e = env(); units(e); const c = e.as(clerk);
  const r = c('receive', F({ urgency: 'most', route: { mode: 'units', units: [{ unit: 'nurse', action: 'perform' }, { unit: 'fin', action: 'ack' }], text: 'โปรดดำเนินการ' } }));
  assert.deepEqual([...r.routed].sort(), ['fin', 'nurse']);
  let g = c('get', { id: r.doc.id }); assert.equal(g.doc.stage, 'routed'); assert.equal(g.dueDate, '2026-10-15', 'ด่วนที่สุด = same day');
  assert.equal(e.as('n1@x.go.th')('my', {}).open, 1);
  assert.throws(() => e.as(nobody)('ack', { id: r.doc.id, unit: 'nurse' }), /ไม่มีสิทธิ์|เฉพาะบุคลากร/);
  e.as('n1@x.go.th')('ack', { id: r.doc.id, unit: 'nurse' });
  assert.throws(() => e.as('n1@x.go.th')('assign', { id: r.doc.id, unit: 'nurse', users: ['n2@x.go.th'] }), /หัวหน้า/);
  assert.throws(() => e.as('head@x.go.th')('assign', { id: r.doc.id, unit: 'nurse', users: ['stranger@x.go.th'] }), /ไม่ได้อยู่ในหน่วยงาน/);
  e.as('head@x.go.th')('assign', { id: r.doc.id, unit: 'nurse', users: ['n2@x.go.th'], due: '2026-10-20' });
  assert.equal(e.as('n2@x.go.th')('my', {}).items[0].status, 'assigned');
  e.clock.t = Date.parse('2026-10-19T03:00:00Z');
  g = c('get', { id: r.doc.id }); assert.ok(g.doc.overdue >= 1, 'overdue is visible to the clerk');
  e.as('n2@x.go.th')('done', { id: r.doc.id, unit: 'nurse', note: 'เสร็จแล้ว' });
  e.as('fin@x.go.th')('done', { id: r.doc.id, unit: 'fin' });
  g = c('get', { id: r.doc.id }); assert.equal(g.doc.stage, 'done'); assert.equal(g.doc.overdue, 0);
  assert.deepEqual([...g.events.map((x) => x.type)].filter((t) => ['receive', 'route', 'ack', 'assign', 'done'].includes(t)), ['receive', 'route', 'route', 'ack', 'assign', 'done', 'done']);
  assert.throws(() => e.as('n2@x.go.th')('done', { id: r.doc.id, unit: 'nurse' }), /ปิดงานไปแล้ว/);
});

test('return to the clerk and re-route; exec command; delegate (acting head) expires', () => {
  const e = env(); units(e); const c = e.as(clerk);
  const r = c('receive', F({ route: { mode: 'exec' } }));
  assert.equal(e.as(boss)('my', {}).open, 1);
  assert.throws(() => c('route', { id: r.doc.id, kind: 'command', toUnits: [{ unit: 'fin' }], text: 'x' }), /ผู้บริหาร/);
  e.as(boss)('route', { id: r.doc.id, kind: 'command', text: 'มอบการเงินพิจารณา', toUnits: [{ unit: 'fin', action: 'perform', due: '2026-10-22' }] });
  assert.match(c('get', { id: r.doc.id }).doc.action, /สั่งการ/);
  assert.throws(() => e.as('fin@x.go.th')('return', { id: r.doc.id, unit: 'fin', reason: '' }), /เหตุผล/);
  e.as('fin@x.go.th')('return', { id: r.doc.id, unit: 'fin', reason: 'ไม่ใช่งานของหน่วยนี้' });
  e.as(boss)('done', { id: r.doc.id, unit: 'exec' });
  assert.equal(c('get', { id: r.doc.id }).doc.stage, 'returned');
  c('route', { id: r.doc.id, toUnits: [{ unit: 'nurse' }] });
  assert.equal(c('get', { id: r.doc.id }).doc.stage, 'routed');
  // delegate
  e.as(admin)('unitsave', { code: 'fin', name: 'งานการเงิน', short: 'การเงิน', head: 'fin@x.go.th', delegate: 'act@x.go.th', delegateUntil: '2026-10-20', members: '' });
  assert.ok(e.as('act@x.go.th')('config', {}).me.headOf.includes('fin'));
  e.clock.t = Date.parse('2026-10-22T03:00:00Z');
  assert.equal(e.as('act@x.go.th')('config', {}).me.headOf.includes('fin'), false, 'acting rights end on the stated date');
  assert.throws(() => e.as(admin)('unitsave', { code: 'fin', name: 'x', delegate: 'act@x.go.th' }), /วันที่สิ้นสุด/);
});

test('send: book numbers (normal and circular ว), reserve → fulfil, duplicate-send guard, reply link', () => {
  const e = env(); units(e); const c = e.as(clerk);
  const inc = c('receive', F());
  const p = [{ name: 'สสจ.ทดสอบ', channel: 'email', email: 'p@x.go.th' }];
  const s1 = c('send', { subject: 'ตอบรับการประชุม', parties: p, replyTo: inc.doc.id });
  assert.equal(s1.doc.reg, '1/2569'); assert.equal(s1.docNo, 'สธ 0123.4/1');
  assert.throws(() => c('send', { subject: 'ตอบรับการประชุม', parties: p }), /ภายใน 10 นาที/);
  const s2 = c('send', { subject: 'หนังสือเวียนถึงหน่วยงาน', bookType: 'circular', parties: [{ name: 'ทุกกลุ่มงาน', channel: 'hand' }] });
  assert.equal(s2.docNo, 'สธ 0123.4/ว1'); assert.equal(s2.doc.reg, '2/2569');
  assert.equal(c('send', { subject: 'เวียนอีกฉบับ', bookType: 'circular', parties: [{ name: 'ทุกกลุ่มงาน', channel: 'hand' }] }).docNo, 'สธ 0123.4/ว2');
  const rs = c('reserve', { purpose: 'หนังสือขอทุนวิจัย' }); assert.equal(rs.doc.reg, '4/2569');
  assert.throws(() => e.as('clerk2@x.go.th')('send', { reservedId: rs.doc.id, subject: 'x', parties: p }), /จองไว้เป็นของ/);
  const f = c('send', { reservedId: rs.doc.id, subject: 'ขอทุนวิจัย', parties: [{ name: 'สวรส.', channel: 'ems', trackingNo: 'EX123456789TH' }] });
  assert.equal(f.doc.reg, '4/2569'); assert.equal(f.docNo, rs.docNo);
  assert.equal(c('numbers', {}).reserved.length, 0);
  assert.match(c('get', { id: inc.doc.id }).doc.action, /ตอบแล้ว/);
  assert.throws(() => c('send', { subject: 'x', parties: [{ name: 'a', channel: 'email', email: 'bad' }] }), /อีเมล/);
  assert.throws(() => c('send', { subject: 'x', parties: [] }), /ผู้รับ/);
  assert.equal(c('parties', { q: 'สวรส' }).items[0].name, 'สวรส.');
});

test('cancel: reason required, in-progress letters need an admin, void rows leave the work lists', () => {
  const e = env(); units(e); const c = e.as(clerk);
  const r = c('receive', F({ route: { mode: 'units', units: [{ unit: 'nurse' }] } }));
  assert.throws(() => c('cancelno', { id: r.doc.id, reason: 'x' }), /เหตุผล/);
  e.as('n1@x.go.th')('ack', { id: r.doc.id, unit: 'nurse' });
  assert.throws(() => c('cancelno', { id: r.doc.id, reason: 'ลงรับซ้ำโดยไม่ตั้งใจ' }), /ผู้ดูแลระบบ/);
  assert.equal(e.as(admin)('cancelno', { id: r.doc.id, reason: 'ลงรับซ้ำโดยไม่ตั้งใจ' }).doc.stage, 'void');
  assert.equal(e.as('n1@x.go.th')('my', {}).items.length, 0);
  assert.throws(() => e.as(admin)('cancelno', { id: r.doc.id, reason: 'ลงรับซ้ำโดยไม่ตั้งใจ' }), /ยกเลิกไปแล้ว/);
  assert.throws(() => c('route', { id: r.doc.id, toUnits: [{ unit: 'fin' }] }), /ยกเลิก/);
});

test('update is audited; secrecy can only be lowered by an admin', () => {
  const e = env(); units(e); const c = e.as(clerk); const r = c('receive', F());
  const u = c('update', { id: r.doc.id, subject: 'ขอเชิญประชุม (แก้คำผิด)', urgency: 'very' });
  assert.deepEqual([...u.changed], ['เรื่อง', 'ชั้นความเร็ว']);
  assert.throws(() => c('update', { id: r.doc.id, secrecy: 'secret' }), /ชั้นความลับ/);
  const s = e.as(sec)('update', { id: r.doc.id, secrecy: 'secret' }); assert.equal(s.doc.secrecy, 'secret');
  assert.throws(() => e.as(sec)('update', { id: r.doc.id, secrecy: 'normal' }), /ผู้ดูแลระบบ/);
  assert.ok(e.as(admin)('get', { id: r.doc.id }).events.some((x) => x.type === 'edit'));
});

test('list / track / export: filters, paging, verify code, year separation', () => {
  const e = env(); units(e); const c = e.as(clerk);
  for (let i = 1; i <= 7; i += 1) c('receive', F({ docNo: 'L' + i, subject: 'เรื่องที่ ' + i + (i % 2 ? ' งบประมาณ' : '') }));
  const l = c('list', { limit: 3 }); assert.equal(l.total, 7); assert.equal(l.items.length, 3); assert.equal(l.more, true); assert.equal(l.items[0].no, 7);
  assert.equal(c('list', { q: 'งบประมาณ' }).total, 4); assert.equal(c('list', { year: 2568 }).total, 0);
  const t = c('track', { q: '3' }); assert.equal(t.items[0].reg, '3/2569');
  const v = c('get', { id: t.items[0].id }).verify; assert.match(v, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(c('track', { q: v.toLowerCase() }).items[0].reg, '3/2569');
  assert.equal(c('rows', {}).rows.length, 7); assert.throws(() => c('track', { q: 'a' }), /อย่างน้อย 2/);
  assert.deepEqual([...c('rows', {}).rows.map((x) => x.no)], [1, 2, 3, 4, 5, 6, 7]);
});

test('upload: only real documents; attach to a letter; attachments must come from this page', () => {
  const e = env(); units(e); const c = e.as(clerk);
  const pdf = Buffer.from('%PDF-1.4 test').toString('base64'); const exe = Buffer.from('MZ\u0090\u0000fake').toString('base64');
  assert.throws(() => c('upload', { name: 'a.pdf', data: exe }), /รองรับเฉพาะ/);
  assert.throws(() => e.as(nobody)('upload', { name: 'a.pdf', data: pdf }), /เฉพาะเจ้าหน้าที่/);
  const up = c('upload', { name: '../../x.pdf', data: pdf, kind: 'in' }); assert.ok(!up.file.name.includes('/'));
  assert.ok(e.grants.some((g) => g.id === up.file.id && g.emails.includes(boss)), 'executives can open every register file');
  const r = c('receive', F({ files: [{ id: up.file.id }] })); assert.equal(c('get', { id: r.doc.id }).doc.files.length, 1);
  assert.throws(() => c('receive', F({ docNo: 'X', subject: 'ไฟล์ปลอม', files: [{ id: 'AbCdEfGhIjKlMn' }] })), /ไม่ได้มาจากหน้าสารบรรณ/);
  const up2 = c('upload', { name: 'stamped.pdf', data: pdf, docId: r.doc.id, label: 'ฉบับประทับตรารับ' });
  assert.equal(up2.attached, r.doc.id); assert.equal(c('get', { id: r.doc.id }).doc.files.length, 2);
});

test('Inbox integration: one counter for both pages; a queue item cannot be registered twice', () => {
  const e = env({ INBOX_STAFF_EMAILS: 'clerk@x.go.th' }); units(e); const c = e.as(clerk);
  const upd = (mid, text) => ({ chat: { id: -1001, title: 'กลุ่มงานธุรการ' }, mid, date: 1760400000, text, urls: [], doc: null });
  const L = (n) => `หนังสือเวียน\nที่ ศธ 04010/ว${n} ลงวันที่ 9 ตุลาคม 2569\nเรื่อง ขอความอนุเคราะห์ข้อมูลครั้งที่ ${n}\nhttps://drive.google.com/file/d/ABC${n}/view?usp=sharing`;
  for (let n = 1; n <= 3; n += 1) e.ctx.inbHook({ secret: 's3cret', u: { ...upd(n, L(n)), urls: [`https://drive.google.com/file/d/ABC${n}/view?usp=sharing`] } });
  const q = c('queue', {}); assert.equal(q.items.length, 3);
  const r1 = c('receive', { ...F({ docNo: 'ศธ 04010/ว1', subject: 'ขอความอนุเคราะห์ข้อมูลครั้งที่ 1', channel: 'telegram' }), inboxId: q.items[2].id });
  assert.equal(r1.doc.reg, '1/2569');
  assert.throws(() => c('receive', { ...F({ docNo: 'Q', subject: 'อีกครั้ง' }), inboxId: q.items[2].id }), /ถูกลงรับแล้ว/);
  const viaInbox = e.ctx.inbox({ session: 's', op: 'accept', id: q.items[1].id });
  assert.equal(viaInbox.item.regNo, '2/2569', 'the Inbox page continues the SAME sequence');
  assert.equal(c('receive', F({ docNo: 'N1', subject: 'ลงรับโดยตรง' })).doc.reg, '3/2569');
  assert.equal(c('list', {}).total, 3, 'every accepted letter is in the register');
  assert.throws(() => e.ctx.inbox({ session: 's', op: 'update', id: q.items[1].id, subject: 'แก้' }), /หน้า “สารบรรณ”/);
  c('reject', { id: q.items[0].id, reason: 'ไม่เกี่ยวกับโรงพยาบาล' });
  assert.equal(c('queue', {}).items.length, 0);
  assert.throws(() => c('reject', { id: q.items[0].id, reason: 'อีกครั้ง ไม่ใช่' }), /ย้ายไป/);
});

test('Inbox numbers made before the register existed are respected', () => {
  const e = env({ INBOX_STAFF_EMAILS: 'clerk@x.go.th' }, { withInbox: true }); units(e); const c = e.as(clerk);
  e.ctx.inbHook({ secret: 's3cret', u: { chat: { id: -1001, title: 'g' }, mid: 1, date: 1760400000, text: 'หนังสือเวียน เรื่อง เก่า https://a.th/1', urls: ['https://a.th/1'], doc: null } });
  const row = e.sheets.Inbox[1]; row[4] = '41/2569'; row[3] = 'accepted';       // an old accepted row (status column 4, regNo column 5)
  const o = e.ctx.inbObj(row, 2); assert.equal(o.status, 'accepted');
  assert.equal(c('receive', F()).doc.reg, '42/2569');
});

test('dash: counts and masked access; setup seeds hospital units', () => {
  const e = env(); units(e); const c = e.as(clerk);
  c('receive', F({ urgency: 'most', route: { mode: 'units', units: [{ unit: 'nurse' }] } })); c('receive', F({ docNo: 'D2', subject: 'ลงรับอย่างเดียว' }));
  const d = c('dash', {}); assert.equal(d.kpi.inToday, 2); assert.equal(d.kpi.unrouted, 1); assert.equal(d.kpi.urgentOpen, 1); assert.equal(d.days.length, 14);
  assert.equal(e.as(nobody)('dash', {}).kpi, undefined);
  assert.equal(e.as('n1@x.go.th')('dash', {}).my.open, 1);
  const f = env(); f.ctx.PropertiesService = { getScriptProperties: () => ({ getProperty: () => '', setProperty() {} }) };
  f.ctx.setupSaraban(); f.ctx.setupSaraban();
  assert.ok(f.sheets.SarUnits.length > 10 && f.sheets.SarUnits.length < 20, 'seeded once, not twice');
});

/* ---------------------------- v1.8.0: คิวรอลงรับ — age, urgency, already-registered hint ---------------------------- */
test('queue: urgency read from the words, age in days, and a letter already in the register is flagged', () => {
  const e = env({ INBOX_STAFF_EMAILS: 'clerk@x.go.th' }); units(e); const c = e.as(clerk);
  const hook = (mid, text) => e.ctx.inbHook({ secret: 's3cret', u: { chat: { id: -1001, title: 'กลุ่มงานธุรการ' }, mid, date: 1760400000, text, urls: ['https://a.th/' + mid], doc: null } });
  hook(1, 'ด่วนที่สุด\nที่ ศธ 04010/ว9 ลงวันที่ 9 ตุลาคม 2569\nเรื่อง ขอข้อมูลด่วน https://a.th/1');
  hook(2, 'หนังสือเวียน\nที่ ศธ 04010/ว77 ลงวันที่ 9 ตุลาคม 2569\nเรื่อง ทั่วไป https://a.th/2');
  c('receive', F({ docNo: 'ศธ 04010/ว77', subject: 'ทั่วไป' }));
  const q = c('queue', {}); assert.equal(q.items.length, 2);
  const urgent = q.items.find((i) => /ขอข้อมูลด่วน/.test(i.subject)); const plain = q.items.find((i) => /ทั่วไป/.test(i.subject));
  assert.equal(urgent.urgency, 'most'); assert.equal(plain.urgency, '');
  assert.equal(plain.registered, '1/2569', 'same เลขที่หนังสือ is already in the register'); assert.equal(urgent.registered, '');
  assert.ok(Number.isInteger(urgent.age) && urgent.age >= 0);
  assert.equal(c('queue', {}).today, e.ctx.sarToday());
});
