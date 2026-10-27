// gas/HrLine.gs in a Node VM: weekly + month-end reports, typed / rich-menu keywords, webhook safety, roles, quota, schedule triggers, phone page data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { lineEnv } from './helpers/hrline-env.mjs';

const rec = (o = {}) => ({ name: 'สมชาย ใจดี', department: 'กลุ่มงานโสตฯ', type: 'ลากิจ', startDate: '2026-11-03', endDate: '2026-11-03', startTime: '', endTime: '', note: '', ...o });
const J = (v) => JSON.parse(JSON.stringify(v));
const textOf = (call) => call.body.messages.map((m) => m.text).join('\n');
const ev = (o) => ({ id: 'e' + Math.random().toString(16).slice(2), type: 'message', replyToken: 'rt', source: { type: 'user', userId: 'U1' }, text: '', ...o });

function seeded() {
  const e = lineEnv({ HR_LINE_GROUP_IDS: 'Cgroup1', HR_LINE_AUTO_ADMIN: 'false' });   // manual roles = the strict mode most tests describe
  e.call('addStaff', ['สมชาย ใจดี', 'กลุ่มงานโสตฯ', '#c4623d'], 'admin@x.go.th'); e.call('addStaff', ['สมหญิง รักงาน', 'กลุ่มงานยุทธศาสตร์ฯ', '#7a8a6f'], 'admin@x.go.th');
  e.call('addStaff', ['สมปอง ไม่ลา', 'กลุ่มงานยุทธศาสตร์ฯ', '#6f8299'], 'admin@x.go.th');
  e.call('saveData', [rec({ type: 'ลาป่วย', note: 'ไข้หวัดใหญ่ ไปโรงพยาบาล' })], 'user@x.go.th');                                                        // next week, Tue
  e.call('saveData', [rec({ name: 'สมหญิง รักงาน', department: 'กลุ่มงานยุทธศาสตร์ฯ', type: 'ไปราชการ', startDate: '2026-11-04', endDate: '2026-11-05', province: 'เชียงใหม่', mission: 'ประชุมเขตสุขภาพ' })], 'user@x.go.th');
  e.call('saveData', [rec({ name: 'สมหญิง รักงาน', department: 'กลุ่มงานยุทธศาสตร์ฯ', type: 'อบรม', startDate: '2026-11-06', endDate: '2026-11-06', startTime: '09:00', endTime: '12:00', mission: 'อบรม HA' })], 'user@x.go.th');
  e.call('saveData', [rec({ type: 'ลากิจ', startDate: '2026-10-26', endDate: '2026-10-27' })], 'user@x.go.th');                                    // this month
  e.call('saveData', [rec({ type: 'ลาพักผ่อนครึ่งวัน', startDate: '2026-10-28', endDate: '2026-10-28', note: 'บ่าย' })], 'user@x.go.th');
  e.addUser('Uadmin', 'แอดมิน', 'แอดมิน'); e.addUser('Uboss', 'หัวหน้า', 'หัวหน้า'); e.addUser('Ustaff', 'บุคลากร', 'บุคลากร'); e.addUser('Unone', 'ไม่มีสิทธิ์', ''); e.addUser('Uoff', 'ปิดรับ', 'บุคลากร', 'FALSE'); e.addUser('Ugone', 'เลิกติดตาม', 'บุคลากร', 'TRUE', 'ยกเลิก');
  e.clear(); return e;
}

test('keywords: typed text and rich-menu words are understood (spaces / word order tolerant)', () => {
  const e = lineEnv(); const p = (t) => e.run('hrlParseText', t);
  assert.equal(p('สัปดาห์นี้ใครลา'), 'thisweek'); assert.equal(p('สัปดาห์หน้า ใครลา'), 'nextweek'); assert.equal(p('อาทิตย์หน้าใครลา'), 'nextweek');
  assert.equal(p('วันนี้ใครลา'), 'today'); assert.equal(p('สรุปลาเดือนนี้'), 'month'); assert.equal(p('รหัสกลุ่ม'), 'groupid'); assert.equal(p('help'), 'help');
  assert.equal(p('ใครลาวันไหน'), 'byday'); assert.equal(p('ใคร ไปราชการ วันไหนบ้าง'), 'byday'); assert.equal(p('ลาวันไหน'), 'byday');
  assert.equal(p('สวัสดี'), ''); assert.equal(p(''), '');
  assert.equal(e.run('hrlParsePostback', 'action=leave_next_week'), 'nextweek'); assert.equal(e.run('hrlParsePostback', 'action=evil'), ''); assert.equal(e.run('hrlParsePostback', 'action=leave_by_day'), 'byday');
});

test('Friday job: next week report to roles + groups; never prints the note of a leave; skips switched-off / unfollowed / no-role users', () => {
  const e = seeded(); const r = J(e.run('hrLineWeeklyJob'));
  assert.equal(r.status, 'ok'); assert.equal(r.result.recipients, 3); assert.equal(r.result.groups, 1);
  const multi = e.pushes().find((f) => f.url.endsWith('/multicast')); assert.deepEqual(J(multi.body.to).sort(), ['Uadmin', 'Uboss', 'Ustaff']);
  assert.ok(e.pushes().some((f) => f.url.endsWith('/push') && f.body.to === 'Cgroup1'));
  const t = textOf(multi);
  assert.match(t, /รายงานสัปดาห์หน้า 2–6 พ\.ย\. 2569/); assert.match(t, /🌴 ลา \(1\)/); assert.match(t, /สมชาย ใจดี \(โสตฯ\) · ลาป่วย · 3 พ\.ย\./);
  assert.match(t, /🚗 ไปราชการ \(1\)[\s\S]*สมหญิง รักงาน[\s\S]*4–5 พ\.ย\.[\s\S]*เชียงใหม่/); assert.match(t, /🎓 อบรม \(1\)[\s\S]*09:00–12:00/);
  assert.doesNotMatch(t, /ไข้หวัด/); assert.doesNotMatch(t, /สมปอง/);
});

test('Friday job with nobody to send to reports an error and does not call LINE', () => {
  const e = lineEnv(); const r = J(e.run('hrLineWeeklyJob'));
  assert.equal(r.status, 'error'); assert.match(r.result.error, /ไม่มีผู้รับ/); assert.equal(e.pushes().length, 0);
});

test('month-end job: only on the last working day, once per month, per กลุ่มงาน, admins/heads only', () => {
  const e = seeded(); e.clock.t = Date.parse('2026-10-29T08:00:00Z');   // Thursday: not the last working day (Fri 30 is)
  assert.equal(J(e.run('hrLineMonthEndJob')).reason, 'not-last-workday'); assert.equal(e.pushes().length, 0);
  e.clock.t = Date.parse('2026-10-30T08:00:00Z');
  const r = J(e.run('hrLineMonthEndJob')); assert.equal(r.status, 'ok'); assert.equal(r.result.groups, 0);
  const multi = e.pushes().find((f) => f.url.endsWith('/multicast')); assert.deepEqual(J(multi.body.to).sort(), ['Uadmin', 'Uboss']);
  const t = textOf(multi);
  assert.match(t, /สรุปวันลาประจำเดือนตุลาคม 2569/); assert.match(t, /🏢 กลุ่มงานโสตฯ — ลารวม 2\.5 วัน \(1 จาก 1 คน\)/); assert.match(t, /สมชาย ใจดี — 2\.5 วัน \(กิจ 2 · พักผ่อน 0\.5\)/);
  assert.match(t, /🏢 กลุ่มงานยุทธศาสตร์ฯ — ลารวม 0 วัน/); assert.match(t, /ไม่มีวันลา: สมปอง ไม่ลา, สมหญิง รักงาน/);
  e.clear(); assert.equal(J(e.run('hrLineMonthEndJob')).reason, 'already-sent'); assert.equal(e.pushes().length, 0);
});

test('quota: nothing is sent when this month would exceed the OA allowance', () => {
  const e = seeded(); e.net.quota = { type: 'limited', value: 10 }; e.net.used = { totalUsage: 9 };
  const r = J(e.run('hrLineWeeklyJob')); assert.equal(r.result.skipped, 'quota'); assert.match(r.result.error, /โควต้า/); assert.equal(e.pushes().length, 0);
});

test('webhook: wrong secret refused; unknown friend registered but gets nothing; role user is answered; duplicate event ignored', () => {
  const e = seeded();
  assert.throws(() => e.run('hrLineHook', { secret: 'nope', events: [] }), { code: 'FORBIDDEN' });
  const hook = (...events) => e.run('hrLineHook', { secret: 'edge-secret', events });
  hook(ev({ source: { type: 'user', userId: 'Unew' }, text: 'สัปดาห์นี้ใครลา' }));
  let reply = e.pushes().find((f) => f.url.endsWith('/reply')); assert.match(textOf(reply), /ยังไม่ได้รับสิทธิ์/); assert.ok(e.sheets.LineUsers.some((r) => r[0] === 'Unew'));
  e.clear(); hook(ev({ source: { type: 'user', userId: 'Ustaff' }, text: 'สัปดาห์หน้าใครลา' }));
  reply = e.pushes().find((f) => f.url.endsWith('/reply')); assert.match(textOf(reply), /สัปดาห์หน้า 2–6 พ\.ย\./); assert.ok(reply.body.messages.at(-1).quickReply.items.length === 4);
  e.clear(); const dup = ev({ source: { type: 'user', userId: 'Ustaff' }, text: 'วันนี้ใครลา' }); hook(dup, dup); assert.equal(e.pushes().filter((f) => f.url.endsWith('/reply')).length, 1);
  e.clear(); hook(ev({ source: { type: 'user', userId: 'Ustaff' }, text: 'สรุปลาเดือนนี้' })); assert.match(textOf(e.pushes()[0]), /เฉพาะแอดมินและหัวหน้า/);
  e.clear(); hook(ev({ source: { type: 'user', userId: 'Uboss' }, text: 'สรุปลาเดือนนี้' })); assert.match(textOf(e.pushes()[0]), /สรุปวันลาประจำเดือน/);
});

test('webhook in groups: silent unless the group is configured and the text is a command; "รหัสกลุ่ม" works anywhere', () => {
  const e = seeded(); const hook = (...events) => e.run('hrLineHook', { secret: 'edge-secret', events });
  const g = (groupId, text) => ev({ source: { type: 'group', groupId, userId: 'Ux' }, text });
  hook(g('Cother', 'สัปดาห์นี้ใครลา'), g('Cgroup1', 'สวัสดีครับ')); assert.equal(e.pushes().length, 0);
  hook(g('Cother', 'รหัสกลุ่ม')); assert.match(textOf(e.pushes()[0]), /Cother/);
  e.clear(); hook(g('Cgroup1', 'สัปดาห์หน้าใครลา')); assert.match(textOf(e.pushes()[0]), /สัปดาห์หน้า/);
  e.clear(); hook(g('Cgroup1', 'สรุปลาเดือนนี้')); assert.match(textOf(e.pushes()[0]), /ทางแชตส่วนตัว/);
});

test('follow / unfollow keep the user list current', () => {
  const e = seeded(); const hook = (...events) => e.run('hrLineHook', { secret: 'edge-secret', events });
  hook({ id: 'f1', type: 'follow', replyToken: 'rt', source: { type: 'user', userId: 'Unew2' } }); assert.ok(e.sheets.LineUsers.some((r) => r[0] === 'Unew2'));
  assert.match(textOf(e.pushes().find((f) => f.url.endsWith('/reply'))), /ลงทะเบียนแล้ว/);
  hook({ id: 'u1', type: 'unfollow', source: { type: 'user', userId: 'Ustaff' } }); assert.equal(e.sheets.LineUsers.find((r) => r[0] === 'Ustaff')[3], 'ยกเลิก');
});

test('LINE_QUERY_SCOPE=leave: typed keywords list leave only', () => {
  const e = seeded(); e.store.HR_LINE_QUERY_SCOPE = 'leave'; e.run('hrLineHook', { secret: 'edge-secret', events: [ev({ source: { type: 'user', userId: 'Ustaff' }, text: 'สัปดาห์หน้าใครลา' })] });
  const t = textOf(e.pushes().find((f) => f.url.endsWith('/reply'))); assert.match(t, /🌴 ลา/); assert.doesNotMatch(t, /ไปราชการ/);
});

test('admin ops: ordinary users are refused; schedule save rebuilds the triggers; channel switch needs a token', () => {
  const e = seeded();
  for (const op of ['lineStatus', 'lineUsers', 'lineSend']) assert.throws(() => e.call(op, [], 'user@x.go.th'), { code: 'FORBIDDEN' });
  assert.equal(e.call('lineSetUser', ['Unone', 'หัวหน้า', true], 'admin@x.go.th').status, 'success'); assert.equal(e.call('lineUsers', [], 'admin@x.go.th').find((u) => u.userId === 'Unone').role, 'หัวหน้า');
  assert.equal(e.call('lineSetUser', ['Unone', 'เจ้านาย', true], 'admin@x.go.th').status, 'error');
  const st = e.call('lineStatus', [], 'admin@x.go.th'); assert.equal(st.schedule.length, 2); assert.equal(st.users.pending, 0);
  const r = e.call('lineSaveSchedule', [[{ key: 'weekly', hour: 8, minute: 30, weekday: 'THURSDAY', enabled: true, roles: ['แอดมิน', 'กลุ่ม'] }, { key: 'monthend', hour: 16, minute: 0, weekday: '', enabled: false, roles: ['แอดมิน'] }]], 'admin@x.go.th');
  assert.equal(r.status, 'success'); assert.equal(e.triggers.length, 1); assert.deepEqual(J({ ...e.triggers[0] }), { fn: 'hrLineWeeklyJob', kind: 'weekly', weekday: 'THURSDAY', hour: 8, minute: 30 });
  assert.throws(() => e.call('lineSaveSchedule', [[{ key: 'weekly', hour: 25, minute: 0, weekday: 'FRIDAY', enabled: true, roles: [] }]], 'admin@x.go.th'), { code: 'BAD_REQUEST' });
  assert.equal(e.call('lineSwitch', ['backup'], 'admin@x.go.th').status, 'error'); e.store.LINE_CHANNEL_ACCESS_TOKEN_BACKUP = 'bk';
  assert.equal(e.call('lineSwitch', ['backup'], 'admin@x.go.th').status, 'success'); e.clear(); e.run('hrLineTestAdmins'); assert.equal(e.pushes().find((f) => f.url.endsWith('/multicast')).auth, 'Bearer bk');
});

test('"send now" works even when the report is switched off, and previews match what is sent', () => {
  const e = seeded(); e.call('lineSaveSchedule', [[{ key: 'weekly', hour: 15, minute: 0, weekday: 'FRIDAY', enabled: false, roles: ['แอดมิน'] }]], 'admin@x.go.th');
  assert.equal(J(e.run('hrLineWeeklyJob')).reason, 'disabled');
  const pv = e.call('linePreview', ['weekly'], 'admin@x.go.th').text; const r = e.call('lineSend', ['weekly'], 'admin@x.go.th');
  assert.equal(r.status, 'success'); assert.equal(textOf(e.pushes().find((f) => f.url.endsWith('/multicast'))), pv); assert.equal(e.pushes().filter((f) => f.url.endsWith('/multicast'))[0].body.to.length, 1);
});

test('phone page: mobileBoot gives my records (only mine), staff, holidays and both weeks in one answer', () => {
  const e = seeded(); const b = J(e.call('mobileBoot', [], 'user@x.go.th'));
  assert.equal(b.today, '2026-10-30'); assert.equal(b.staff.length, 3); assert.equal(b.holidays['2026-10-23'] !== undefined, true); assert.equal(b.nextWeek.from, '2026-11-02'); assert.equal(b.thisWeek.from, '2026-10-26');
  assert.equal(b.mine.length, 5); assert.ok(b.mine.every((m) => m.canEdit)); assert.equal(b.nextWeek.items.length, 3);
  assert.equal(J(e.call('mobileBoot', [], 'other@x.go.th')).mine.length, 0);
  const id = b.mine.find((m) => m.type === 'ลาป่วย').id; assert.equal(e.call('updateRecord', [{ ...rec({ type: 'ลาป่วยครึ่งวัน', note: '(เช้า) ' }), id }], 'user@x.go.th').status, 'success');
});

test('rich-menu "ใครลาวันไหน": leave AND official duty listed day by day (today → end of next week), no leave note, working days only', () => {
  const e = seeded(); e.run('hrLineHook', { secret: 'edge-secret', events: [ev({ source: { type: 'user', userId: 'Ustaff' }, text: 'ใครลาวันไหน' })] });
  const t = textOf(e.pushes().find((f) => f.url.endsWith('/reply')));
  assert.match(t, /ใครลา \/ ไปราชการ วันไหน/); assert.match(t, /🗓 อ\. 3 พ\.ย\.[\s\S]*🌴 สมชาย ใจดี \(โสตฯ\) — ลาป่วย/);
  assert.match(t, /🗓 พ\. 4 พ\.ย\.[\s\S]*🚗 สมหญิง รักงาน[\s\S]*ไปราชการ เชียงใหม่[\s\S]*\(ถึง 5 พ\.ย\.\)/);
  assert.match(t, /🗓 พฤ\. 5 พ\.ย\.[\s\S]*🚗 สมหญิง/); assert.match(t, /🗓 ศ\. 6 พ\.ย\.[\s\S]*🎓 สมหญิง รักงาน[\s\S]*— อบรม HA[\s\S]*09:00–12:00/);
  assert.ok(t.indexOf('3 พ.ย.') < t.indexOf('4 พ.ย.') && t.indexOf('4 พ.ย.') < t.indexOf('6 พ.ย.'));
  assert.doesNotMatch(t, /ไข้หวัด/); assert.doesNotMatch(t, /28 ต\.ค\./);                     // the note of a leave is private · days already past are not listed
  e.clear(); e.run('hrLineHook', { secret: 'edge-secret', events: [ev({ source: { type: 'user', userId: 'Ustaff' }, text: 'ใครลาวันไหน' })] }); e.clear();
  e.store.HR_LINE_QUERY_SCOPE = 'leave'; e.run('hrLineHook', { secret: 'edge-secret', events: [ev({ source: { type: 'user', userId: 'Uboss' }, text: 'ใครลาวันไหน' })] });
  const only = textOf(e.pushes().find((f) => f.url.endsWith('/reply'))); assert.match(only, /🌴/); assert.doesNotMatch(only, /🚗|🎓/);
  e.clear(); e.store.HR_LINE_QUERY_SCOPE = ''; e.store.HR_LINE_WHO_DAYS = '1';                // fixed window: today only
  e.run('hrLineHook', { secret: 'edge-secret', events: [ev({ source: { type: 'user', userId: 'Uadmin' }, text: 'ใครลาวันไหน' })] });
  assert.match(textOf(e.pushes().find((f) => f.url.endsWith('/reply'))), /ยังไม่มีผู้บันทึก/);
});

/* ---------------------------------- "ใครลาวันไหน" (rich-menu button 3) ---------------------------------- */
test('day words: dates typed in Thai / numbers are understood (today = Fri 30 Oct 2026)', () => {
  const e = lineEnv(); const p = (t) => e.run('hrlParseText', t);
  assert.equal(p('ใครลาวันไหน'), 'byday'); assert.equal(p('ใครลา วันไหน บ้าง'), 'byday'); assert.equal(p('เลือกวัน'), 'dayask'); assert.equal(p('เลือกวันที่'), 'dayask');
  assert.equal(p('ใครลา 5 พ.ย.'), 'day:2026-11-05'); assert.equal(p('ใครลา 5พย'), 'day:2026-11-05'); assert.equal(p('ใครลาวันที่ 5 พฤศจิกายน 2569'), 'day:2026-11-05');
  assert.equal(p('ใครลา ๕ พ.ย.'), 'day:2026-11-05', 'Thai digits'); assert.equal(p('ใครลา 5/11'), 'day:2026-11-05'); assert.equal(p('ใครลา 5/11/69'), 'day:2026-11-05'); assert.equal(p('ใครลา 5/11/2026'), 'day:2026-11-05');
  assert.equal(p('ใครลา 2026-11-05'), 'day:2026-11-05'); assert.equal(p('ใครลา 2569-11-05'), 'day:2026-11-05');
  assert.equal(p('ใครลาพรุ่งนี้'), 'day:2026-10-31'); assert.equal(p('ใครลามะรืนนี้'), 'day:2026-11-01'); assert.equal(p('ใครลาเมื่อวาน'), 'day:2026-10-29');
  assert.equal(p('ใครลาวันพุธ'), 'day:2026-11-04', 'next Wednesday'); assert.equal(p('ใครลาวันศุกร์'), 'day:2026-10-30', 'today is Friday'); assert.equal(p('ใครลาวันศุกร์หน้า'), 'day:2026-11-06', 'Friday of next week, not today'); assert.equal(p('ใครลาวันพุธสัปดาห์หน้า'), 'day:2026-11-04'); assert.equal(p('ใครลาวันอาทิตย์'), 'day:2026-11-01');
  assert.equal(p('ใครลา 3 ม.ค.'), 'day:2027-01-03', 'no year and long past → next year'); assert.equal(p('ใครลาวันที่ 5'), 'day:2026-10-05');
  assert.equal(p('ใครลา 31/2'), '', 'impossible date'); assert.equal(p('ใครลา 99 พ.ย.'), ''); assert.equal(p('5 พ.ย.'), '', 'a bare date is not a question');
  // the old words are untouched
  assert.equal(p('สัปดาห์นี้ใครลา'), 'thisweek'); assert.equal(p('สัปดาห์หน้า ใครลา'), 'nextweek'); assert.equal(p('อาทิตย์หน้าใครลา'), 'nextweek'); assert.equal(p('วันนี้ใครลา'), 'today'); assert.equal(p('สรุปลาเดือนนี้'), 'month');
  assert.equal(e.run('hrlParsePostback', 'action=leave_day&date=2026-11-05'), 'day:2026-11-05'); assert.equal(e.run('hrlParsePostback', 'action=leave_day&date=2026-13-45'), '');
  assert.equal(e.run('hrlParsePostback', 'action=leave_pick', '2026-11-05'), 'day:2026-11-05'); assert.equal(e.run('hrlParsePostback', 'action=leave_pick', 'x'), ''); assert.equal(e.run('hrlParsePostback', 'action=leave_dayask'), 'dayask');
});

test('"เลือกวัน" / "ใครลาวันไหน": date picker + shortcut days; picking a day answers that day with ◀ ▶ buttons', () => {
  const e = seeded();
  e.call('saveData', [rec({ type: 'ลากิจ', startDate: '2026-11-05', endDate: '2026-11-05' })], 'user@x.go.th'); e.clear();
  e.run('hrLineHook', { secret: 'edge-secret', events: [ev({ source: { type: 'user', userId: 'Ustaff' }, text: 'เลือกวัน' })] });
  let reply = e.pushes().find((f) => f.url.endsWith('/reply')); const q = J(reply.body.messages.at(-1).quickReply.items);
  assert.match(textOf(reply), /เลือกวันที่/); assert.equal(q[0].action.type, 'datetimepicker'); assert.equal(q[0].action.mode, 'date'); assert.equal(q[0].action.data, 'action=leave_pick'); assert.equal(q[0].action.initial, '2026-10-30');
  assert.ok(q.length <= 13 && q.every((x) => (x.action.label || '').length <= 20)); assert.equal(q[1].action.data, 'action=leave_day&date=2026-10-30'); assert.equal(q[2].action.data, 'action=leave_day&date=2026-10-31');
  assert.ok(q.slice(3).every((x) => ![0, 6].includes(new Date(x.action.data.slice(-10) + 'T00:00:00Z').getUTCDay())), 'shortcut days skip weekends');
  e.clear();                                                                                                                      // the picker answers with params.date → slimmed to ev.date
  e.run('hrLineHook', { secret: 'edge-secret', events: [ev({ type: 'postback', source: { type: 'user', userId: 'Ustaff' }, data: 'action=leave_pick', date: '2026-11-05', text: undefined })] });
  reply = e.pushes().find((f) => f.url.endsWith('/reply')); const t = textOf(reply);
  assert.match(t, /📅 พฤ\. 5 พ\.ย\. 2569/); assert.match(t, /🚗 ไปราชการ \(1\)[\s\S]*สมหญิง รักงาน/); assert.match(t, /🌴 ลา \(1\)[\s\S]*สมชาย ใจดี/); assert.doesNotMatch(t, /ไข้หวัด/, 'no leave notes'); assert.doesNotMatch(t, /อบรม HA/, 'only that day');
  const nav = J(reply.body.messages.at(-1).quickReply.items).map((x) => x.action.label); assert.equal(nav[0], '◀ พ. 4 พ.ย.'); assert.equal(nav[1], 'ศ. 6 พ.ย. ▶'); assert.ok(nav.includes('📅 เลือกวันอื่น')); assert.ok(nav.includes('สัปดาห์นี้'));
  e.clear(); e.run('hrLineHook', { secret: 'edge-secret', events: [ev({ source: { type: 'user', userId: 'Ustaff' }, text: 'ใครลา 7 พ.ย.' })] });                // Saturday, nobody
  const sat = textOf(e.pushes().find((f) => f.url.endsWith('/reply'))); assert.match(sat, /วันหยุดสุดสัปดาห์/); assert.match(sat, /ไม่มีผู้ลา/);
});

test('day questions follow the same rules: no role = no answer; groups only when configured; LINE_QUERY_SCOPE=leave hides trips; month-end rule untouched', () => {
  const e = seeded();
  e.run('hrLineHook', { secret: 'edge-secret', events: [ev({ source: { type: 'user', userId: 'Unone' }, text: 'ใครลา 5 พ.ย.' })] });
  assert.match(textOf(e.pushes()[0]), /ยังไม่ได้รับสิทธิ์/); e.clear();
  e.run('hrLineHook', { secret: 'edge-secret', events: [ev({ source: { type: 'group', groupId: 'Cother', userId: 'Ustaff' }, text: 'ใครลา 5 พ.ย.' })] }); assert.equal(e.pushes().length, 0, 'unknown group: silent');
  e.run('hrLineHook', { secret: 'edge-secret', events: [ev({ source: { type: 'group', groupId: 'Cgroup1', userId: 'Ustaff' }, text: 'ใครลาวันไหน' })] });
  const g = e.pushes()[0]; assert.equal(J(g.body.messages.at(-1).quickReply.items)[0].action.type, 'datetimepicker', 'the picker also works in a configured group'); e.clear();
  e.store.HR_LINE_QUERY_SCOPE = 'leave';
  e.run('hrLineHook', { secret: 'edge-secret', events: [ev({ source: { type: 'user', userId: 'Ustaff' }, text: 'ใครลา 4 พ.ย.' })] });
  assert.doesNotMatch(textOf(e.pushes()[0]), /ไปราชการ/);
});

test('phone page: mobileWho gives one day (same grouping), flags weekend / holiday, rejects garbage', () => {
  const e = seeded();
  const w = J(e.call('mobileWho', ['2026-11-04'], 'user@x.go.th')); assert.equal(w.day, '2026-11-04'); assert.deepEqual(w.items.map((x) => x.name), ['สมหญิง รักงาน']); assert.equal(w.items[0].group, 'trip'); assert.equal(w.weekend, false);
  assert.equal(J(e.call('mobileWho', ['2026-11-07'], 'user@x.go.th')).weekend, true);
  assert.equal(J(e.call('mobileWho', ['2026-12-10'], 'user@x.go.th')).holiday.length > 0, true, 'public holiday named');
  assert.throws(() => e.call('mobileWho', ['2026-02-31'], 'user@x.go.th'), /วันที่ไม่ถูกต้อง/); assert.throws(() => e.call('mobileWho', ['x'], 'user@x.go.th'));
});

test('auto-admin (as deployed): a new friend of the OA becomes แอดมิน at once, a follow promotes an existing friend without a role; HR_LINE_AUTO_ADMIN=false turns it off', () => {
  const e = lineEnv({ HR_LINE_GROUP_IDS: 'Cgroup1' });                                             // default = on
  const hook = (...events) => e.run('hrLineHook', { secret: 'edge-secret', events });
  hook(ev({ source: { type: 'user', userId: 'Unew' }, text: 'สัปดาห์นี้ใครลา' }));
  assert.equal(e.sheets.LineUsers.find((r) => r[0] === 'Unew')[5], 'แอดมิน'); assert.match(textOf(e.pushes().find((f) => f.url.endsWith('/reply'))), /สัปดาห์นี้/);
  e.clear(); hook({ id: 'f9', type: 'follow', replyToken: 'rt', source: { type: 'user', userId: 'Unew3' } });
  assert.match(textOf(e.pushes().find((f) => f.url.endsWith('/reply'))), /ได้รับสิทธิ์ "แอดมิน"/);
  const off = lineEnv({ HR_LINE_AUTO_ADMIN: 'false' });
  off.run('hrLineHook', { secret: 'edge-secret', events: [ev({ source: { type: 'user', userId: 'Unew' }, text: 'สัปดาห์นี้ใครลา' })] });
  assert.equal(off.sheets.LineUsers.find((r) => r[0] === 'Unew')[5], ''); assert.match(textOf(off.pushes().find((f) => f.url.endsWith('/reply'))), /ยังไม่ได้รับสิทธิ์/);
});

test('"ใครลาวันไหน": day-by-day list AND the date picker buttons under it', () => {
  const e = seeded();
  e.run('hrLineHook', { secret: 'edge-secret', events: [ev({ source: { type: 'user', userId: 'Ustaff' }, text: 'ใครลาวันไหน' })] });
  const reply = e.pushes().find((f) => f.url.endsWith('/reply')), q = J(reply.body.messages.at(-1).quickReply.items);
  assert.match(textOf(reply), /ใครลา \/ ไปราชการ วันไหน/); assert.equal(q[0].action.type, 'datetimepicker'); assert.ok(q.length <= 13);
});
