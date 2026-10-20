// v1.9.0: ส่งออก = พิมพ์เลขเอง · ศูนย์สารบรรณแยกกลุ่มงาน · boot (1 รอบ) · แคชอ่านอย่างเดียวที่ล้างเมื่อมีการเขียน
import test from 'node:test';
import assert from 'node:assert/strict';
import { env } from './helpers/saraban-env.mjs';

const A = 'admin@x.go.th'; const C = 'clerk@x.go.th';
const out = (over = {}) => ({ subject: 'ขอส่งข้อมูล', docDate: '2026-10-14', parties: [{ name: 'สสจ.ชม.', channel: 'esaraban' }], registry: 'strat', ...over });
function setup() {
  const e = env({ ADMIN_EMAILS: A, SAR_BOOK_PREFIX: 'สธ 0123.4' });
  e.call(A, 'unitsave', { code: 'strat', name: 'งานยุทธศาสตร์ฯ', type: 'internal', registry: true, prefix: 'สธ 0312.1' });
  e.call(A, 'unitsave', { code: 'qual', name: 'งานพัฒนาคุณภาพฯ', type: 'internal', registry: true, prefix: 'สธ 0912.06' });
  return e;
}

test('send: the clerk types the send number; the next empty one continues after it; a used number is refused', () => {
  const e = setup();
  const r = e.call(C, 'send', out({ no: '150' }));
  assert.equal(r.doc.reg, '150/2569'); assert.equal(r.docNo, 'สธ 0312.1/150');
  assert.ok(r.warnings.some((w) => /ข้าม/.test(w)), 'jumping from 0 to 150 is flagged');
  const n = e.call(C, 'send', out({ subject: 'ฉบับถัดไป' })); assert.equal(n.doc.reg, '151/2569');
  assert.throws(() => e.call(C, 'send', out({ subject: 'เลขซ้ำ', no: '150' })), { code: 'DUPLICATE' });
  const o = e.call(C, 'send', out({ subject: 'อีกทะเบียน', registry: 'qual', no: '150' })); assert.equal(o.doc.reg, '150/2569');   // numbers are per registry
});
test('send: circular number "ว.7" and a book number typed in full', () => {
  const e = setup();
  const c = e.call(C, 'send', out({ bookType: 'circular', no: '40', circNo: 'ว.7' })); assert.equal(c.docNo, 'สธ 0312.1/ว7');
  assert.throws(() => e.call(C, 'send', out({ subject: 'เวียนซ้ำ', bookType: 'circular', no: '41', circNo: '7' })), { code: 'DUPLICATE' });
  const f = e.call(C, 'send', out({ subject: 'พิมพ์เลขที่เอง', no: '41', docNo: 'สธ 0312.1/พิเศษ 9' })); assert.equal(f.docNo, 'สธ 0312.1/พิเศษ 9');
  assert.throws(() => e.call(C, 'send', out({ subject: 'เลขที่ซ้ำ', no: '42', docNo: 'สธ 0312.1/พิเศษ 9' })), { code: 'DUPLICATE' });
});
test('dashboard: totals + one group per registry (ยุทธศาสตร์ / พัฒนาคุณภาพ)', () => {
  const e = setup();
  const rc = (registry, n) => { for (let i = 0; i < n; i += 1) e.call(C, 'receive', { docNo: `ศธ ${registry}/${i}`, docDate: '2026-10-14', subject: `หนังสือ ${registry} ${i}`, party: 'สสจ.', registry }); };
  rc('strat', 3); rc('qual', 2); e.call(C, 'send', out({ no: '1' }));
  const d = e.call(C, 'dash', {});
  assert.equal(d.groups.map((g) => g.code).join(','), 'strat,qual');
  const g = Object.fromEntries(d.groups.map((x) => [x.code, x]));
  assert.equal(g.strat.kpi.inYear, 3); assert.equal(g.qual.kpi.inYear, 2); assert.equal(g.strat.kpi.outYear, 1); assert.equal(g.qual.kpi.outYear, 0);
  assert.equal(d.kpi.inYear, 5); assert.equal(g.strat.name, 'งานยุทธศาสตร์ฯ'); assert.equal(g.strat.days.length, 14);
});
test('boot: config + dashboard in one call', () => {
  const e = setup(); e.call(C, 'receive', { docNo: 'ศธ 1/1', docDate: '2026-10-14', subject: 'เรื่องแรก', party: 'สสจ.', registry: 'strat' });
  const b = e.call(C, 'boot', {}); assert.ok(b.config.units.length >= 2); assert.equal(b.dash.kpi.inYear, 1); assert.equal(b.queue, null);
});
test('read cache: repeat reads are served from cache, any write makes the next read fresh', () => {
  const e = setup(); const store = {}; let gets = 0;
  e.ctx.CacheService = { getScriptCache: () => ({ get: (k) => { gets += 1; return store[k] || null; }, put: (k, v) => { store[k] = v; } }) };
  const d1 = e.call(C, 'dash', {}); const d2 = e.call(C, 'dash', {}); assert.equal(JSON.stringify(d2), JSON.stringify(d1));
  assert.ok(Object.keys(store).some((k) => /:dash:/.test(k)));
  e.call(C, 'receive', { docNo: 'ศธ 9/9', docDate: '2026-10-14', subject: 'เรื่องใหม่หลังแคช', party: 'สสจ.', registry: 'strat' });
  const d3 = e.call(C, 'dash', {}); assert.equal(d3.kpi.inYear, d1.kpi.inYear + 1);
});
test('nextno: the forms get the next number (and the book prefix) from the counter tab only', () => {
  const e = setup();
  const a = e.call(C, 'nextno', { registry: 'strat' }); assert.equal(a.out, 1); assert.equal(a.in, 1); assert.equal(a.circ, 1); assert.equal(a.prefix, 'สธ 0312.1');
  e.call(C, 'send', out({ no: '150' })); e.call(C, 'send', out({ subject: 'เวียน', bookType: 'circular', no: '151', circNo: '7' }));
  const b = e.call(C, 'nextno', { registry: 'strat' }); assert.equal(b.out, 152); assert.equal(b.circ, 8);
  assert.equal(e.call(C, 'nextno', { registry: 'qual' }).out, 1);   // numbers are per registry
  assert.throws(() => e.call(C, 'nextno', { registry: 'nope' }), { code: 'BAD_REQUEST' });
});
