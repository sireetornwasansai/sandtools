// Runs gas/Hr.gs in a Node VM (in-memory sheets): roles, validation, leave quota, holidays, own-record editing, report, attachments.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hrEnv } from './helpers/hr-env.mjs';

const rec = (o = {}) => ({ name: 'สมชาย ใจดี', department: 'กลุ่มงานโสตฯ', type: 'ประชุม', startDate: '2026-10-20', endDate: '2026-10-20', startTime: '09:00', endTime: '11:00', note: '', ...o });
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj').toString('base64');

test('boot: roles come from the Script properties', () => {
  const e = hrEnv();
  assert.deepEqual(JSON.parse(JSON.stringify(e.call('boot', [], 'user@x.go.th').me)), { email: 'user@x.go.th', admin: false, dev: false, editAll: false });
  assert.equal(e.call('boot', [], 'admin@x.go.th').me.admin, true);
  assert.equal(e.call('boot', [], 'dev@x.go.th').me.dev, true);
});
test('admin-only and dev-only operations are refused for ordinary users', () => {
  const e = hrEnv();
  assert.throws(() => e.call('addStaff', ['ก', 'กลุ่มงานโสตฯ', '#c4623d'], 'user@x.go.th'), { code: 'FORBIDDEN' });
  assert.throws(() => e.call('exportReport', [], 'user@x.go.th'), { code: 'FORBIDDEN' });
  assert.throws(() => e.call('getDailyLogList', [], 'user@x.go.th'), { code: 'FORBIDDEN' });
  assert.throws(() => e.call('nope', [], 'user@x.go.th'), { code: 'UNKNOWN_OP' });
  assert.equal(e.call('addStaff', ['สมชาย ใจดี', 'กลุ่มงานโสตฯ', '#c4623d'], 'admin@x.go.th').status, 'success');
  assert.equal(e.call('getStaffList', [], 'user@x.go.th').length, 1);
});
test('save → shows on the calendar; invalid input is rejected', () => {
  const e = hrEnv();
  const r = e.call('saveData', [rec()]); assert.equal(r.status, 'success');
  const ev = e.call('getEvents'); assert.equal(ev.length, 1);
  assert.equal(ev[0].extendedProps.type, 'ประชุม'); assert.equal(ev[0].start, '2026-10-20T09:00:00'); assert.equal(ev[0].extendedProps.canEdit, true);
  for (const bad of [rec({ type: 'x' }), rec({ startTime: '25:00' }), rec({ endDate: '2026-10-01' }), rec({ name: '' })]) assert.equal(e.call('saveData', [bad]).status, 'error');
  assert.equal(e.call('getEvents').length, 1);
});
test('leave on an official holiday is refused (23 Oct)', () => {
  const e = hrEnv();
  const r = e.call('saveData', [rec({ type: 'ลากิจ', startDate: '2026-10-23', endDate: '2026-10-23', startTime: '', endTime: '' })]);
  assert.equal(r.status, 'error'); assert.match(r.message, /วันหยุดราชการ/);
});
test('only the owner (or an admin) edits / deletes a record', () => {
  const e = hrEnv(); const id = e.call('saveData', [rec()], 'user@x.go.th').id; assert.ok(id);
  assert.equal(e.call('getEvents', [], 'other@x.go.th')[0].extendedProps.canEdit, false);
  const upd = () => e.call('updateRecord', [{ ...rec({ note: 'แก้' }), id }], 'other@x.go.th');
  let blocked = false; try { blocked = upd().status !== 'success'; } catch { blocked = true; } assert.ok(blocked);
  assert.equal(e.call('updateRecord', [{ ...rec({ note: 'แก้' }), id }], 'user@x.go.th').status, 'success');
  let del = false; try { del = e.call('deleteRecord', [id], 'other@x.go.th').status !== 'success'; } catch { del = true; } assert.ok(del);
  assert.equal(e.call('deleteRecord', [id], 'admin@x.go.th').status, 'success');
  assert.equal(e.call('getEvents').length, 0);
});
test('monthly report counts the record; dashboard counts today', () => {
  const e = hrEnv(); e.call('saveData', [rec({ startDate: '2026-10-19', endDate: '2026-10-19' })]);
  const rep = e.call('getMonthlySummary', [2026, 10]);
  assert.ok(JSON.stringify(rep).includes('สมชาย')); assert.ok(e.call('getDashboard').counts['ประชุม'] >= 1);
});
test('attachments: only real PDF/JPG/PNG, saved in Drive; a fake file is refused', () => {
  const e = hrEnv();
  const r = e.call('saveData', [rec({ fileBase64: PDF, fileName: 'a.pdf', fileMime: 'application/pdf' })]); assert.equal(r.status, 'success');
  assert.equal(e.files.length, 1); assert.match(e.call('getEvents')[0].extendedProps.file, /^https:\/\/drive\.google\.com\//);
  assert.equal(e.call('saveData', [rec({ fileBase64: Buffer.from('MZ evil').toString('base64'), fileName: 'x.pdf' })]).status, 'error');
  assert.equal(e.files.length, 1);
});
test('formula-looking text is stored as text (no spreadsheet injection)', () => {
  const e = hrEnv(); e.call('saveData', [rec({ note: '=HYPERLINK("http://x")' })]);
  assert.ok(e.sheets.HR_Control[1].some((v) => v === `'=HYPERLINK("http://x")`));
});

// ---- v1.2: a record on a weekend must be visible; the page can say why the calendar is empty; odd cell formats are read
test('a record on a Sunday is saved, flagged as weekend and returned (the calendar hides weekends unless told otherwise)', () => {
  const e = hrEnv();
  const r = e.call('saveData', [rec({ type: 'ลากิจครึ่งวัน', startDate: '2026-10-25', endDate: '2026-10-25', startTime: '08:00', endTime: '12:00' })]);
  assert.equal(r.status, 'success'); assert.equal(r.weekend, 'all'); assert.equal(r.startDate, '2026-10-25');
  const ev = e.call('getEvents'); assert.equal(ev.length, 1); assert.equal(ev[0].start, '2026-10-25T08:00:00');
  assert.equal(e.call('saveData', [rec({ startDate: '2026-10-23', endDate: '2026-10-26' })]).weekend, 'some');   // Fri → Mon
  assert.equal(e.call('saveData', [rec({ startDate: '2026-10-20', endDate: '2026-10-20' })]).weekend, '');
});
test('boot / getAll carry diag: rows, shown, and why rows were left out', () => {
  const e = hrEnv();
  assert.deepEqual(JSON.parse(JSON.stringify(e.call('boot').diag)).rows, 0);
  const d = (r) => JSON.parse(JSON.stringify(r));
  e.call('saveData', [rec()]); e.call('saveData', [rec({ startDate: '2026-10-25', endDate: '2026-10-25' })]);
  e.sheets.HR_Control.push(['', 'ไม่มีวันที่', 'กลุ่มงานโสตฯ', 'ประชุม', 'ไม่ใช่วันที่', '', '', '', '', '', 'id-x', '', '', '']);
  e.sheets.HR_Control.push(['', '', 'กลุ่มงานโสตฯ', 'ประชุม', '2026-10-20', '', '', '', '', '', 'id-y', '', '', '']);
  const g = d(e.call('getAll').diag);
  assert.equal(g.rows, 4); assert.equal(g.shown, 2); assert.equal(g.noDate, 1); assert.equal(g.noName, 1); assert.equal(g.weekendOnly, 1);
  assert.equal(g.first, '2026-10-20'); assert.equal(g.last, '2026-10-25'); assert.equal(g.own, false); assert.equal(g.sheet, 'HR_Control');
});
test('cells written by hand are read: พ.ศ. dates, d/M/yyyy, Date.toString text, serial numbers, 8:00, day fractions', () => {
  const e = hrEnv(); const D = e.ctx.Date; e.call('getEvents');   // creates the header row
  const row = (name, start, end, st, et) => ['', name, 'กลุ่มงานโสตฯ', 'ประชุม', start, end, st, et, '', '', 'id-' + name, '', '', ''];
  e.sheets.HR_Control.push(
    row('a', '2569-10-20', '', '8:00', '12.30'),
    row('b', '21/10/2569', '21/10/2569', "'09:15", '10:00'),
    row('c', 'Wed Oct 22 2026 00:00:00 GMT+0700 (Indochina Time)', '', '', ''),
    row('d', 46322, 46322, 0.5, 0.625),                                   // 2026-10-27 · 12:00–15:00
    row('e', new D('2026-10-28T00:00:00+07:00'), '', new D('1899-12-30T08:00:00+07:00'), new D('1899-12-30T16:00:00.020+07:00')));
  const by = Object.fromEntries(JSON.parse(JSON.stringify(e.call('getEvents'))).map((x) => [x.extendedProps.name, x]));
  assert.equal(by.a.start, '2026-10-20T08:00:00'); assert.equal(by.a.end, '2026-10-20T12:30:00');
  assert.equal(by.b.start, '2026-10-21T09:15:00');
  assert.equal(by.c.extendedProps.startDate, '2026-10-22');
  assert.equal(by.d.extendedProps.startDate, '2026-10-27'); assert.equal(by.d.start, '2026-10-27T12:00:00'); assert.equal(by.d.end, '2026-10-27T15:00:00');
  assert.equal(by.e.start, '2026-10-28T08:00:00'); assert.equal(by.e.end, '2026-10-28T16:00:00');
});
test('a name typed with a double space is stored with one space (it used to become a second person)', () => {
  const e = hrEnv(); e.call('saveData', [rec({ name: 'ทวีศักดิ์  สายเขียว' })]);
  assert.equal(e.call('getEvents')[0].extendedProps.name, 'ทวีศักดิ์ สายเขียว');
});
