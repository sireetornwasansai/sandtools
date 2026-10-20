// v1.10: ทะเบียนเป็นข้อมูลสำรอง (ไม่รู้สถานะจริง → ไม่ขึ้น "รอเสนอ"/"เลยกำหนด") · วิเคราะห์ข้อมูลศูนย์สารบรรณ (op analytics)
import test from 'node:test';
import assert from 'node:assert/strict';
import { env } from './helpers/saraban-env.mjs';

const A = 'admin@x.go.th'; const C = 'clerk@x.go.th'; const B = 'boss@x.go.th';
function setup() {
  const e = env({ ADMIN_EMAILS: A });
  e.call(A, 'unitsave', { code: 'strat', name: 'งานยุทธศาสตร์ฯ', type: 'internal', registry: true, prefix: 'สธ 0312.1' });
  e.call(A, 'unitsave', { code: 'hr', name: 'กลุ่มงานบุคคล', type: 'internal', head: 'hr@x.go.th', members: ['hr@x.go.th'], keywords: 'บรรจุ,แต่งตั้ง' });
  return e;
}
const rc = (e, o) => e.call(C, 'receive', { docDate: '2026-10-14', party: 'สสจ.ชม.', registry: 'strat', ...o });

test('backup register: an imported letter has no status and is never overdue — a letter routed in this system still is', () => {
  const e = setup();
  const r = rc(e, { docNo: 'ศธ 1/ว1', docDate: '2026-09-01', subject: 'เรื่องที่นำเข้าจากทะเบียนเดิม', urgency: 'most' });
  const row = e.sheets.Saraban.find((x) => x[0] === r.doc.id); row[28] = JSON.stringify({ imported: { sheet: 'abc', tab: 'x', row: 2 } }); row[7] = '2026-09-01 00:00:00';
  const d = e.call(C, 'dash', {});
  assert.equal(d.kpi.overdue, 0); assert.equal(d.kpi.urgentOpen, 0); assert.equal(d.kpi.imported, 1);
  const l = e.call(C, 'list', { kind: 'in', registry: 'strat' }).items[0];
  assert.equal(l.stage, 'registered'); assert.equal(l.legacy, true); assert.equal(l.overdue, 0);
  e.call(C, 'route', { id: r.doc.id, toUnits: [{ unit: 'hr', action: 'perform' }] });
  const l2 = e.call(C, 'list', { kind: 'in', registry: 'strat' }).items[0];
  assert.equal(l2.stage, 'routed'); assert.ok(l2.overdue > 0, 'a routed letter past its due date is overdue'); assert.equal(e.call(C, 'dash', {}).kpi.routedOpen, 1);
});

test('a new letter received here and not yet routed is simply "registered": no overdue alarm either', () => {
  const e = setup(); rc(e, { docNo: 'ศธ 2/2', subject: 'ด่วนที่สุดแต่ยังไม่ส่งต่อ', urgency: 'most', docDate: '2026-09-01' });
  assert.equal(e.call(C, 'dash', {}).kpi.overdue, 0);
});

test('analytics: months, issuers (from the letter number), circulars (ว), senders, topics, lag, data quality, number gaps', () => {
  const e = setup();
  rc(e, { docNo: 'สธ 0123/ว5', subject: 'ขอเชิญประชุมวิชาการ', docDate: '2026-10-10', party: 'กระทรวงสาธารณสุข' });
  rc(e, { docNo: 'ชม 0033/ว9', subject: 'ขอเชิญอบรมหลักสูตรพยาบาล', docDate: '2026-10-12', party: 'สสจ.ชม.' });
  rc(e, { docNo: 'ชม 0033/12', subject: 'แจ้งการบรรจุแต่งตั้ง', docDate: '2026-10-14', party: 'สสจ.ชม.', no: '5' });
  e.call(C, 'send', { subject: 'ส่งรายงาน', docDate: '2026-10-14', parties: [{ name: 'สสจ.ชม.', channel: 'esaraban' }], registry: 'strat' });
  const a = e.call(C, 'analytics', { year: 2569, registry: 'strat' });
  assert.equal(a.total.in, 3); assert.equal(a.total.out, 1); assert.equal(a.months[9].in, 3); assert.equal(a.months[9].out, 1);
  assert.equal(a.bookType.circular, 2); assert.equal(a.bookType.normal, 1);
  assert.equal(a.issuers[0].key, 'ชม'); assert.equal(a.issuers[0].n, 2); assert.equal(a.issuers[0].name, 'จังหวัดเชียงใหม่');
  assert.equal(a.senders[0].name, 'สสจ.ชม.'); assert.equal(a.senders[0].n, 2);
  assert.equal(a.recipients[0].name, 'สสจ.ชม.');
  const cats = Object.fromEntries(a.cats.in.map((c) => [c.name, c.n])); assert.equal(cats['การประชุม'], 1); assert.equal(cats['พัฒนาบุคลากรและการอบรม'], 1); assert.equal(cats['บริหารงานบุคคล'], 1);
  assert.equal(a.lag.n, 3); assert.ok(a.lag.avg >= 1 && a.lag.avg <= 5);
  assert.equal(a.seq.in.last, 5); assert.equal(a.seq.in.gaps, 2, 'numbers 2 and 3 were skipped on purpose'); assert.equal(a.quality.pct.docDate, 100); assert.equal(a.quality.pct.file, 0);
  assert.ok(a.years.includes(2569)); assert.equal(a.busiestMonth.m, 10);
});

test('analytics: a secret letter is counted but its subject/sender never appear; ordinary users cannot read analytics', () => {
  const e = setup();
  e.call('secret@x.go.th', 'receive', { docNo: 'ลับ 1/1', docDate: '2026-10-14', subject: 'เรื่องลับมาก', party: 'หน่วยงานลับ', secrecy: 'secret', registry: 'strat' });
  const a = e.call(C, 'analytics', { year: 2569, registry: 'strat' });
  assert.equal(a.total.in, 1); assert.equal(a.masked, 1); assert.equal(a.senders.length, 0); assert.equal(JSON.stringify(a).includes('หน่วยงานลับ'), false);
  assert.throws(() => e.call('nobody@x.go.th', 'analytics', {}), { code: 'FORBIDDEN' });
  assert.ok(e.call(B, 'analytics', {}).total);   // executives may read it
});

test('legacy rows are recognised even when the JSON column is empty (real sheets: imported rows have no registrar / verify code / extra)', () => {
  const e = setup(); const r = rc(e, { docNo: 'ศธ 3/3', subject: 'หนังสือที่ลงในระบบนี้' });
  const row = e.sheets.Saraban.find((x) => x[0] === r.doc.id);
  assert.equal(e.call(C, 'list', { kind: 'in', registry: 'strat' }).items[0].legacy, false, 'a letter registered here is not legacy');
  row[22] = ''; row[23] = ''; row[28] = '';     // what the imported rows look like
  assert.equal(e.call(C, 'list', { kind: 'in', registry: 'strat' }).items[0].legacy, true);
  assert.equal(e.call(C, 'dash', {}).kpi.imported, 1);
});

test('setupSarabanUnits: unit names typed without a code get a code, become selectable; "ภารกิจ…" headings stay inactive', () => {
  const e = setup();
  const sh = e.sheets.SarUnits; sh.push(['', 'กลุ่มงานพัสดุ', '', '', '', '', '', '', '', '', '', '', '', ''], ['', 'ภารกิจด้านบริหาร', '', '', '', '', '', '', '', '', '', '', '', ''], ['', 'HA', '', '', '', '', '', '', '', '', '', '', '', '']);
  assert.equal(e.call(A, 'units', {}).units.some((u) => u.name === 'กลุ่มงานพัสดุ'), false, 'rows without a code are ignored by the page');
  assert.match(e.ctx.setupSarabanUnits(), /3 หน่วยงาน/);
  const u = Object.fromEntries(e.call(A, 'units', {}).units.map((x) => [x.name, x]));
  assert.ok(u['กลุ่มงานพัสดุ'].code && u['กลุ่มงานพัสดุ'].active && u['กลุ่มงานพัสดุ'].type === 'internal');
  assert.equal(u['ภารกิจด้านบริหาร'].active, false); assert.equal(u.HA.active, true);
  assert.match(e.ctx.setupSarabanUnits(), /0 หน่วยงาน/, 'safe to run twice');
  const r = rc(e, { docNo: 'ศธ 4/4', subject: 'ส่งต่อพัสดุ' });
  assert.equal(e.call(C, 'route', { id: r.doc.id, toUnits: [{ unit: u['กลุ่มงานพัสดุ'].code, action: 'perform' }] }).routed.length, 1);
});
