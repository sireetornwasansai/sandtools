// Runs gas/Inbox.gs in a Node VM with a tiny in-memory sheet: parsing of Thai letters, the silent webhook, de-duplication and numbering.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const code = fs.readFileSync(path.join(root, 'gas', 'Inbox.gs'), 'utf8');

function env(props = {}) {
  const store = { EDGE_SECRET: 's3cret', TG_ALLOWED_CHATS: '-1001', ...props }; const fetched = []; const rows = [];
  const sheet = {
    getLastRow: () => rows.length + 1, getMaxRows: () => rows.length + 50,
    getRange: (r, c, nr = 1, nc = 1) => ({
      getValues: () => rows.slice(r - 2, r - 2 + nr).map((x) => x.slice(c - 1, c - 1 + nc)),
      setValues: (v) => { v.forEach((line, i) => { rows[r - 2 + i] = line.map((x) => String(x == null ? '' : x)); }); },
      setNumberFormat() { return this; }
    })
  };
  const ctx = {
    console: { log() {}, error() {} }, fetched,
    prop: (k) => store[k] || '', intProp: (k, d) => d, listProp: (k) => (store[k] || '').split(/[,\s]+/).map((s) => s.toLowerCase()).filter(Boolean),
    safeEqual: (a, b) => a === b, httpError: (code, message) => Object.assign(new Error(message), { code, expected: true }), rateLimit() {},
    sheetTab: (name) => (name === 'Inbox' ? sheet : { appendRow() {} }), LOG_HEADERS: [], cell: (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').slice(0, max || 300),
    libTags: (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((s) => String(s).trim()).filter(Boolean), lnkLocked: (fn) => fn(), lnkStamp: (ms) => new Date(ms + 7 * 3600e3).toISOString().slice(0, 19).replace('T', ' '),
    lnkCheckUrl: (u) => { if (!/^https?:\/\//i.test(u)) throw new Error('bad'); return u; }, LNK_ALPHABET: 'abcdefghjkmnpqrstuvwxyz23456789', LNK_TZ: 'Asia/Bangkok',
    lnkScope: (u) => ({ email: u.email, admin: false }), requireUser: () => ({ email: 'clerk@x.go.th' }),
    UrlFetchApp: { fetch: (u) => { fetched.push(u); throw new Error('no network in tests'); } },
    Utilities: {
      getUuid: () => crypto.randomUUID(), DigestAlgorithm: { MD5: 'md5' }, computeDigest: (a, s) => [...crypto.createHash('md5').update(s).digest()],
      base64EncodeWebSafe: (x) => Buffer.from(x.map((b) => (b < 0 ? b + 256 : b))).toString('base64url'),
      formatDate: (d, tz, f) => { const t = new Date(d.getTime() + 7 * 3600e3).toISOString(); return f === 'yyyy' ? t.slice(0, 4) : f === 'yyyy-MM-dd' ? t.slice(0, 10) : t.slice(0, 7); }
    }
  };
  vm.createContext(ctx); vm.runInContext(code, ctx);
  return { ctx, rows, store, fetched };
}
const upd = (over = {}) => ({ chat: { id: -1001, title: 'กลุ่มงานธุรการ' }, mid: 1, date: 1760400000, text: '', urls: [], doc: null, ...over });
const LETTER = 'หนังสือเวียน\nที่ ศธ 04010/ว1234 ลงวันที่ 9 ตุลาคม 2569\nเรื่อง ขอเชิญเข้าร่วมประชุมชี้แจงแนวทางการดำเนินงาน\nhttps://drive.google.com/file/d/ABC123/view?usp=sharing';

test('parses the fields of a Thai circular letter', () => {
  const { ctx } = env();
  assert.equal(ctx.inbBookNo('ที่ ศธ 04010/ว1234 ลงวันที่'), 'ศธ 04010/ว1234');
  assert.equal(ctx.inbBookNo('ที่ มท ๐๘๑๐.๓/ว ๕๖๗๘'), 'มท 0810.3/ว5678');
  assert.equal(ctx.inbBookDate('ลงวันที่ 9 ตุลาคม 2569'), '2026-10-09');
  assert.equal(ctx.inbBookDate('ลงวันที่ ๑๒ ก.ย. ๒๕๖๙'), '2026-09-12');
  assert.equal(ctx.inbBookDate('ลงวันที่ 05/03/2569'), '2026-03-05');
  assert.equal(ctx.inbBookDate('ลงวันที่ 31 กุมภาพันธ์ 2569'), '');
  assert.equal(ctx.inbSubject(LETTER, ''), 'ขอเชิญเข้าร่วมประชุมชี้แจงแนวทางการดำเนินงาน');
  assert.deepEqual([...ctx.inbUrlsOf(LETTER, [])], ['https://drive.google.com/file/d/ABC123/view?usp=sharing']);
  assert.deepEqual([...ctx.inbUrlsOf('ดูที่ https://a.th/x). และ https://a.th/x', [])], ['https://a.th/x']);
});

test('relevance: needs a link/file and a keyword (or a book number)', () => {
  const { ctx } = env(); const kw = ctx.inbKeywords();
  assert.equal(ctx.inbRelevant(LETTER, ['https://x.th'], '', kw, false), true);
  assert.equal(ctx.inbRelevant('สวัสดีตอนเช้า https://youtu.be/x', ['https://youtu.be/x'], '', kw, false), false);
  assert.equal(ctx.inbRelevant('หนังสือเวียน เรื่อง ประชุม', [], '', kw, false), false);          // a keyword without a link/file is just chat
  assert.equal(ctx.inbRelevant('', [], 'ศธ04010-ว1234.pdf', kw, false), false);
  assert.equal(ctx.inbRelevant('ดูไฟล์', [], 'a.pdf', kw, true), true);
});

test('webhook: stores a draft, stays silent, ignores other chats and bad secrets', () => {
  const { ctx, rows, fetched } = env();
  assert.throws(() => ctx.inbHook({ secret: 'wrong', u: upd() }), /ไม่อนุญาต/);
  assert.equal(ctx.inbHook({ secret: 's3cret', u: upd({ chat: { id: -999, title: 'x' }, text: LETTER }) }).ok, false);
  const r = ctx.inbHook({ secret: 's3cret', u: upd({ text: LETTER, urls: ['https://drive.google.com/file/d/ABC123/view?usp=sharing'] }) });
  assert.equal(r.ok, true); assert.equal(rows.length, 1);
  const o = ctx.inbObj(rows[0], 2);
  assert.equal(o.status, 'pending'); assert.equal(o.bookNo, 'ศธ 04010/ว1234'); assert.equal(o.bookDate, '2026-10-09'); assert.equal(o.from, 'กลุ่มงานธุรการ'); assert.equal(o.regNo, '');
  assert.equal(fetched.length, 0, 'no token → nothing is requested from Telegram');
  const bare = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/sendMessage|reply_to|sendDocument|sendPhoto|setMessageReaction|answerCallback/i.test(bare), 'Inbox.gs must contain no code that writes into the group');
  assert.deepEqual([...bare.matchAll(/api\.telegram\.org\/(?:file\/)?bot' \+ token \+ '\/(\w+)/g)].map((x) => x[1]).sort(), ['getFile']);   // the only Bot API method used (the file download has its own URL)
  const api = fs.readFileSync(path.join(root, 'api', 'telegram.js'), 'utf8').replace(/\/\/.*$/gm, '');
  assert.ok(!/api\.telegram\.org|method\s*:\s*['"]send/.test(api), 'the edge function never calls Telegram');
});

test('webhook: the same message or the same link is stored once', () => {
  const { ctx, rows } = env();
  ctx.inbHook({ secret: 's3cret', u: upd({ text: LETTER }) });
  assert.equal(ctx.inbHook({ secret: 's3cret', u: upd({ text: LETTER }) }).status, 'duplicate');                 // same message id (edited / redelivered)
  assert.equal(ctx.inbHook({ secret: 's3cret', u: upd({ mid: 2, text: 'ส่งอีกรอบ ' + LETTER }) }).status, 'duplicate');   // same link posted again
  assert.equal(rows.length, 1);
});

test('imported history uses the same duplicate key as live messages', () => {
  const { ctx, rows } = env();
  ctx.inbHook({ secret: 's3cret', u: upd({ mid: 7, text: LETTER }) });
  const res = ctx.inbImport({}, {}, { items: [{ chatId: 1, mid: 7, date: 1760400000, text: LETTER }] });   // export ids have no -100 prefix
  assert.equal(res.duplicate, 1); assert.equal(rows.length, 1);
});

test('accept: running number per Buddhist year, manual start, no reuse', () => {
  const { ctx, rows } = env({ INBOX_STAFF_EMAILS: 'clerk@x.go.th' });
  for (let i = 1; i <= 3; i += 1) ctx.inbHook({ secret: 's3cret', u: upd({ mid: i, text: `หนังสือเวียน เรื่อง ทดสอบ ${i} https://a.th/${i}` }) });
  const ids = rows.map((r) => r[0]);
  const a = ctx.inbox({ session: 's', op: 'accept', id: ids[0], no: '150/2569' });
  assert.equal(a.item.regNo, '150/2569'); assert.equal(a.item.status, 'accepted');
  assert.equal(ctx.inbox({ session: 's', op: 'accept', id: ids[1] }).item.regNo, '151/2569');
  assert.throws(() => ctx.inbox({ session: 's', op: 'accept', id: ids[2], no: '150/2569' }), /ถูกใช้แล้ว/);
  assert.throws(() => ctx.inbox({ session: 's', op: 'ignore', id: ids[0] }), /รับแล้ว/);
  assert.equal(ctx.inbox({ session: 's', op: 'ignore', id: ids[2] }).item.status, 'ignored');
  assert.equal(ctx.inbox({ session: 's', op: 'list' }).counts.accepted, 2);
});

test('only staff may use the page', () => {
  const { ctx } = env();
  assert.throws(() => ctx.inbox({ session: 's', op: 'list' }), /เจ้าหน้าที่ธุรการ/);
  const staff = env({ INBOX_STAFF_EMAILS: 'clerk@x.go.th' });
  assert.equal(staff.ctx.inbox({ session: 's', op: 'list' }).items.length, 0);
});

test('edge function: secret header, allow-list and slimming', async () => {
  const { slim } = await import(path.join(root, 'api', 'telegram.js'));
  const allowed = new Set(['-1001']);
  const m = { message: { message_id: 5, date: 1, chat: { id: -1001, title: 'G' }, from: { id: 9, first_name: 'Somchai' }, text: 'ดู https://a.th/x', entities: [{ type: 'url', offset: 3, length: 14 }] } };
  const s = slim(m, allowed);
  assert.deepEqual(s.urls, ['https://a.th/x']); assert.equal(JSON.stringify(s).includes('Somchai'), false);
  assert.equal(slim({ message: { ...m.message, chat: { id: -5 } } }, allowed), null);
  assert.equal(slim({ message: { message_id: 1, date: 1, chat: { id: -1001 }, text: 'สวัสดี' } }, allowed), null);
  assert.equal(slim({ message: { message_id: 1, date: 1, chat: { id: -1001 }, caption: 'หนังสือ', document: { file_id: 'F', file_name: 'a.pdf', file_size: 10 } } }, allowed).doc.file_name, 'a.pdf');
  const { default: handler } = await import(path.join(root, 'api', 'telegram.js'));
  process.env.SAND_TG_WEBHOOK_SECRET = 'wh'; process.env.SAND_GAS_URL = 'http://127.0.0.1:9/x'; process.env.SAND_EDGE_SECRET = 'e'; process.env.SAND_TG_CHATS = '-1001';
  const bad = await handler(new Request('https://x/api/telegram', { method: 'POST', body: '{}' }));
  assert.equal(bad.status, 401);
  const ok = await handler(new Request('https://x/api/telegram', { method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'wh' }, body: JSON.stringify(m) }), {});
  assert.equal(ok.status, 200); assert.equal(await ok.text(), '');
});
