// HrLine v1.3: กลุ่มงาน ≠ คน · alias ชื่อ (ทวีศักดิ์ สายเขียว = เอ) · เดือนหน้าใครลา · ประชุมสัปดาห์นี้ · ครึ่งวัน ◐ เช้า / ◑ บ่าย
import test from 'node:test';
import assert from 'node:assert/strict';
import { lineEnv } from './helpers/hrline-env.mjs';

const rec = (o = {}) => ({ name: 'สมชาย ใจดี', department: 'กลุ่มงานโสตฯ', type: 'ลากิจ', startDate: '2026-10-28', endDate: '2026-10-28', startTime: '', endTime: '', note: '', province: '', mission: '', ...o });
const J = (v) => JSON.parse(JSON.stringify(v));
const textOf = (call) => call.body.messages.map((m) => m.text).join('\n');
const ev = (o) => ({ id: 'e' + Math.random().toString(16).slice(2), type: 'message', replyToken: 'rt', source: { type: 'user', userId: 'Uboss' }, text: '', ...o });
const D = 'กลุ่มงานโสตฯ';

function seeded() {                                                     // today = Fri 30 Oct 2026
  const e = lineEnv({ HR_LINE_GROUP_IDS: 'Cgroup1', HR_LINE_AUTO_ADMIN: 'false' });
  const add = (n) => e.call('addStaff', [n, D, '#c4623d'], 'admin@x.go.th');
  ['สมชาย ใจดี', 'เอ', 'ทวีศักดิ์ สายเขียว', 'กลุ่มงานโสตฯ', 'คกก.SMC', 'สมปอง ไม่ลา', 'บี'].forEach(add);
  const save = (o) => assert.equal(e.call('saveData', [rec(o)], 'user@x.go.th').status, 'success');
  save({ name: 'ทวีศักดิ์ สายเขียว', type: 'ลากิจ', startDate: '2026-10-27', endDate: '2026-10-27' });                           // = เอ
  save({ name: 'เอ', type: 'ลาพักผ่อน', startDate: '2026-10-22', endDate: '2026-10-22' });
  save({ name: 'สมชาย ใจดี', type: 'ลากิจครึ่งวัน', startDate: '2026-10-26', endDate: '2026-10-26', note: 'บ่าย' });
  save({ name: 'สมชาย ใจดี', type: 'ลาป่วยครึ่งวัน', startDate: '2026-10-28', endDate: '2026-10-28', startTime: '13:00', endTime: '16:00' });   // afternoon by time, no note
  save({ name: 'สมปอง ไม่ลา', type: 'ลาป่วยครึ่งวัน', startDate: '2026-10-30', endDate: '2026-10-30', note: '(เช้า) ' });
  save({ name: 'สมชาย ใจดี', type: 'ประชุม P4P', startDate: '2026-10-29', endDate: '2026-10-29', startTime: '13:00', endTime: '16:00', mission: 'ทบทวนตัวชี้วัด' });
  save({ name: 'เอ', type: 'ประชุม P4P', startDate: '2026-10-29', endDate: '2026-10-29', startTime: '13:00', endTime: '16:00', mission: 'ทบทวนตัวชี้วัด' });
  save({ name: 'คกก.SMC', department: 'รวมทุกกลุ่มงาน', type: 'ประชุม SMC', startDate: '2026-10-30', endDate: '2026-10-30', startTime: '09:00', endTime: '11:00' });
  save({ name: 'เอ', type: 'ลากิจ', startDate: '2026-11-04', endDate: '2026-11-04' });                                       // next month
  save({ name: 'ทวีศักดิ์ สายเขียว', type: 'ลากิจครึ่งวัน', startDate: '2026-11-05', endDate: '2026-11-05', note: 'เช้า' });
  e.addUser('Uadmin', 'แอดมิน', 'แอดมิน'); e.addUser('Uboss', 'หัวหน้า', 'หัวหน้า'); e.addUser('Ustaff', 'บุคลากร', 'บุคลากร');
  e.clear(); return e;
}
const ask = (e, text, userId = 'Uboss', source) => { e.clear(); e.run('hrLineHook', { secret: 'edge-secret', events: [ev({ text, source: source || { type: 'user', userId } })] }); return e.pushes().find((f) => f.url.endsWith('/reply')); };

test('keywords: เดือนหน้า / ประชุม / เดือนนี้ are understood; the old words still work', () => {
  const e = lineEnv(); const p = (t) => e.run('hrlParseText', t);
  assert.equal(p('เดือนหน้าใครลา'), 'nextmonth'); assert.equal(p('สรุปลาเดือนหน้า'), 'nextmonth'); assert.equal(p('เดือน ถัดไป ใครลา'), 'nextmonth');
  assert.equal(p('ประชุมสัปดาห์นี้'), 'meetweek'); assert.equal(p('ประชุมอะไรบ้างในสัปดาห์นี้'), 'meetweek'); assert.equal(p('สัปดาห์นี้ประชุมอะไร'), 'meetweek');
  assert.equal(p('ประชุมสัปดาห์หน้า'), 'meetnext'); assert.equal(p('เดือนนี้ใครลา'), 'month');
  assert.equal(p('สรุปลาเดือนนี้'), 'month'); assert.equal(p('สัปดาห์นี้ใครลา'), 'thisweek'); assert.equal(p('สัปดาห์หน้าใครลา'), 'nextweek'); assert.equal(p('ใครลา 5 พ.ย.'), 'day:2026-11-05');
  assert.equal(e.run('hrlParsePostback', 'action=leave_next_month'), 'nextmonth'); assert.equal(e.run('hrlParsePostback', 'action=meet_this_week'), 'meetweek');
});

test('1+2: กลุ่มงาน / คกก. are not people; ทวีศักดิ์ สายเขียว is merged into เอ (month summary)', () => {
  const e = seeded(); const t = textOf(ask(e, 'สรุปลาเดือนนี้'));
  assert.match(t, /กลุ่มงานโสตฯ — ลารวม 3\.5 วัน \(3 จาก 4 คน\)/, 'คน = สมชาย, เอ, สมปอง, บี — not กลุ่มงานโสตฯ / คกก.SMC / ทวีศักดิ์');
  assert.match(t, /ไม่มีวันลา: บี\n?/);
  assert.match(t, /• เอ — 2 วัน \(กิจ 1 · พักผ่อน 1\)/); assert.doesNotMatch(t, /ทวีศักดิ์/);
  assert.doesNotMatch(t, /ไม่มีวันลา:[^\n]*(กลุ่มงานโสตฯ|คกก\.|รวมทุกกลุ่มงาน)/); assert.doesNotMatch(t, /ไม่ระบุกลุ่มงาน/);
});

test('2: week / day answers show เอ, never the second name; one person is counted once', () => {
  const e = seeded(); const t = textOf(ask(e, 'สัปดาห์นี้ใครลา'));
  assert.match(t, /เอ \(โสตฯ\)/); assert.doesNotMatch(t, /ทวีศักดิ์/);
  const day = textOf(ask(e, 'ใครลา 27 ต.ค.')); assert.match(day, /เอ \(โสตฯ\)/); assert.doesNotMatch(day, /ทวีศักดิ์/);
});

test('5: half day is drawn ◐ ครึ่งเช้า (left half) / ◑ ครึ่งบ่าย (right half) — by note OR by the times; never guessed wrong', () => {
  const e = seeded(); const t = textOf(ask(e, 'สัปดาห์นี้ใครลา'));
  assert.match(t, /สมชาย ใจดี \(โสตฯ\) · ลากิจ ◑ ครึ่งบ่าย · 26 ต\.ค\./, 'note says บ่าย');
  assert.match(t, /สมชาย ใจดี \(โสตฯ\) · ลาป่วย ◑ ครึ่งบ่าย · 28 ต\.ค\. 13:00–16:00/, 'no note, but 13:00–16:00');
  assert.match(t, /สมปอง ไม่ลา \(โสตฯ\) · ลาป่วย ◐ ครึ่งเช้า · 30 ต\.ค\./, '(เช้า) note');
  assert.doesNotMatch(t, /ครึ่งวัน/, 'the word "ครึ่งวัน" is replaced by the side');
  const by = textOf(ask(e, 'ใครลาวันไหน')); assert.match(by, /สมปอง ไม่ลา \(โสตฯ\) — ลาป่วย ◐ ครึ่งเช้า/); assert.match(by, /เอ \(โสตฯ\) — ลากิจ ◐ ครึ่งเช้า/);
  assert.match(textOf(ask(e, 'ใครลา 28 ต.ค.')), /ลาป่วย ◑ ครึ่งบ่าย/);
  const b = J(e.call('mobileBoot', [], 'user@x.go.th'));
  const items = b.thisWeek.items; assert.equal(items.find((x) => x.start === '2026-10-28' && x.type === 'ลาป่วยครึ่งวัน').afternoon, true);
});

test('3: เดือนหน้าใครลา — next month summary for แอดมิน/หัวหน้า in private chat only, with the quick-reply button', () => {
  const e = seeded(); const r = ask(e, 'เดือนหน้าใครลา'); const t = textOf(r);
  assert.match(t, /สรุปวันลาประจำเดือนพฤศจิกายน 2569/); assert.match(t, /ข้อมูลเท่าที่บันทึกไว้/);
  assert.match(t, /• เอ — 1\.5 วัน \(กิจ 1\.5\)/); assert.doesNotMatch(t, /ทวีศักดิ์/);
  assert.match(textOf(ask(e, 'เดือนหน้าใครลา', 'Ustaff')), /เฉพาะแอดมินและหัวหน้า/);
  assert.match(textOf(ask(e, 'เดือนหน้าใครลา', 'x', { type: 'group', groupId: 'Cgroup1', userId: 'Uboss' })), /ทางแชตส่วนตัว/);
  const q = J(ask(e, 'สัปดาห์นี้ใครลา', 'Uboss').body.messages.at(-1).quickReply.items).map((x) => x.action.text);
  assert.ok(q.includes('เดือนหน้าใครลา') && q.includes('ประชุมสัปดาห์นี้')); 
  const qs = J(ask(e, 'สัปดาห์นี้ใครลา', 'Ustaff').body.messages.at(-1).quickReply.items).map((x) => x.action.text);
  assert.ok(!qs.includes('เดือนหน้าใครลา') && qs.includes('ประชุมสัปดาห์นี้'), 'ordinary staff are not offered a button they cannot use');
});

test('4: ประชุมสัปดาห์นี้ — meetings only, same meeting merged, who attends, group bodies are not counted as people, no leave', () => {
  const e = seeded(); const t = textOf(ask(e, 'ประชุมอะไรบ้างในสัปดาห์นี้', 'Ustaff'));
  assert.match(t, /👥 ประชุมสัปดาห์นี้ 26–30 ต\.ค\. 2569/); assert.match(t, /มี 2 การประชุม/);
  assert.match(t, /พฤ\. 29 ต\.ค\.[\s\S]*ประชุม P4P · 13:00–16:00 — 2 คน: สมชาย ใจดี, เอ[\s\S]*ทบทวนตัวชี้วัด/);
  assert.match(t, /ศ\. 30 ต\.ค\.[\s\S]*ประชุม SMC \(คกก\.SMC\) · 09:00–11:00/); assert.doesNotMatch(t, /09:00–11:00 — \d+ คน/);
  assert.doesNotMatch(t, /ลากิจ|ลาป่วย|ลาพักผ่อน|🌴/); assert.doesNotMatch(t, /ทวีศักดิ์/);
  const nx = textOf(ask(e, 'ประชุมสัปดาห์หน้า', 'Ustaff')); assert.match(nx, /ประชุมสัปดาห์หน้า 2–6 พ\.ย\. 2569/); assert.match(nx, /ยังไม่มีการประชุม/);
  assert.match(textOf(ask(e, 'ประชุมสัปดาห์นี้', 'x', { type: 'group', groupId: 'Cgroup1', userId: 'Uboss' })), /ประชุม P4P/);
  assert.equal(ask(e, 'ประชุมสัปดาห์นี้', 'x', { type: 'group', groupId: 'Cother' }), undefined, 'unknown groups stay silent');
});

test('help text lists the new questions', () => {
  const e = lineEnv(); const h = e.run('hrlHelpText'); assert.match(h, /เดือนหน้าใครลา/); assert.match(h, /ประชุมสัปดาห์นี้/);
});
