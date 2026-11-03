import test from 'node:test';
import assert from 'node:assert/strict';
import { env } from './helpers/saraban-env.mjs';

const recv = (c, o = {}) => c('receive', { subject: 'ขอเชิญประชุม', party: 'สสจ.', docNo: 'สธ 0201/ว1', docDate: '2026-10-14', rid: 'rid-' + Math.random().toString(36).slice(2, 10), ...o });
const send = (c, o = {}) => c('send', { subject: 'ตอบกลับ', parties: [{ name: 'สสจ.', channel: 'hand' }], docDate: '2026-10-15', rid: 'rid-' + Math.random().toString(36).slice(2, 10), ...o });

test('edit outgoing: book number (dup-checked) and single recipient', () => {
  const e = env(); const c = e.as('clerk@x.go.th');
  const a = send(c, { subject: 'หนึ่ง' }), b = send(c, { subject: 'สอง', parties: [{ name: 'รพ.', channel: 'hand' }] });
  const u = c('update', { id: a.doc.id, docNo: 'สธ 0312.1/99', party: 'โรงพยาบาลสันทราย' });
  assert.deepEqual([...u.changed].sort(), ['ถึง', 'เลขที่หนังสือ'].sort());
  const g = c('get', { id: a.doc.id }); assert.equal(g.doc.docNo, 'สธ 0312.1/99'); assert.equal(g.doc.party, 'โรงพยาบาลสันทราย'); assert.equal(g.doc.parties[0].name, 'โรงพยาบาลสันทราย'); assert.equal(g.doc.parties[0].channel, 'hand');
  assert.throws(() => c('update', { id: b.doc.id, docNo: 'สธ 0312.1/99' }), /ถูกใช้แล้ว/);
  assert.throws(() => c('update', { id: b.doc.id, docNo: '' }), /ต้องไม่ว่าง/);
});

test('edit: unchanged form saves "no change"; old out-of-order dates do not block other fields', () => {
  const e = env(); const c = e.as('clerk@x.go.th');
  const r = recv(c); const g = c('get', { id: r.doc.id }).doc;
  const same = c('update', { id: g.id, subject: g.subject, docNo: g.docNo, party: g.party, docDate: g.docDate, due: g.due, urgency: g.urgency, cat: g.cat, channel: g.channel, refs: g.refs, encl: g.encl, note: g.note, action: g.action, salut: g.salut });
  assert.deepEqual([...same.changed], []);
  c('update', { id: g.id, due: '2026-10-20' });
  assert.throws(() => c('update', { id: g.id, docDate: '2026-10-25' }), /ไม่เร็วกว่า/);
  const n = c('update', { id: g.id, note: 'ok', channel: '' });            // channel '' = keep
  assert.deepEqual([...n.changed], ['หมายเหตุ']); assert.equal(c('get', { id: g.id }).doc.channel, g.channel);
});

test('edit: reserved number cannot be edited; void cannot', () => {
  const e = env(); const c = e.as('clerk@x.go.th');
  const rs = c('reserve', { purpose: 'ทดสอบ' }); const id = rs.doc ? rs.doc.id : rs.id;
  assert.throws(() => c('update', { id, subject: 'x' }), /จองไว้/);
});

test('unit save keeps parent / members when the page does not send them; expired delegation does not block', () => {
  const e = env(); const admin = e.as('admin@x.go.th');
  admin('unitsave', { code: 'dept', name: 'กลุ่มงานหลัก' });
  admin('unitsave', { code: 'sub', name: 'งานย่อย', parent: 'dept', head: 'h@x.go.th', members: 'a@x.go.th, b@x.go.th', delegate: 'd@x.go.th', delegateUntil: '2026-10-20' });
  e.clock.t += 30 * 86400000;                                                  // delegation is now long expired
  admin('unitsave', { code: 'sub', name: 'งานย่อย (แก้ชื่อ)', type: 'internal', head: 'h@x.go.th', members: 'a@x.go.th, b@x.go.th', delegate: 'd@x.go.th', delegateUntil: '2026-10-20', registry: false, active: true });
  const u = admin('units', {}).units.find((x) => x.code === 'sub');
  assert.equal(u.name, 'งานย่อย (แก้ชื่อ)'); assert.equal(u.members.length, 2);
  const row = e.sheets.SarUnits.find((r) => r[0] === 'sub'); assert.equal(row[11], 'dept');          // parent survived
  assert.throws(() => admin('unitsave', { code: 'sub', name: 'x', members: 'a@x.go.th, nonsense' }), /อีเมลสมาชิกไม่ถูกต้อง/);
  assert.throws(() => admin('unitsave', { code: 'sub', name: 'x', parent: 'nope' }), /ไม่พบหน่วยงานต้นสังกัด/);
});
