// v1.17: สารบรรณ — คัดกรองตามต้นทาง (origin) · ตรวจรหัสหน่วยงานต้นทาง (รู้จัก/ไม่รู้จัก/ไม่มีรหัส + แนะนำคำที่พิมพ์ผิด) · รวมชื่อผู้ส่งที่พิมพ์ต่างกัน · งานของฉัน: สิทธิ์ทำรายการ (can) สำหรับเลือกหลายรายการ
import test from 'node:test';
import assert from 'node:assert/strict';
import { env } from './helpers/saraban-env.mjs';

// objects built inside the VM have another Object prototype: compare them as JSON
const same = (a, b) => assert.equal(JSON.stringify(a), JSON.stringify(b));
const A = 'admin@x.go.th'; const C = 'clerk@x.go.th'; const HEAD = 'head@x.go.th'; const STAFF = 'staff@x.go.th'; const OTHER = 'other@x.go.th';
function setup() {
  const e = env({ ADMIN_EMAILS: A });
  e.call(A, 'unitsave', { code: 'strat', name: 'งานยุทธศาสตร์ฯ', type: 'internal', registry: true });
  e.call(A, 'unitsave', { code: 'qa', name: 'งานพัฒนาคุณภาพฯ', type: 'internal', head: HEAD, members: [HEAD, STAFF] });
  return e;
}
const rc = (e, o) => e.call(C, 'receive', { docDate: '2026-10-14', party: 'สสจ.ชม.', registry: 'strat', ...o });

test('issuer code: "ที่ ", Thai digits, case and a missing code are handled; "ที่" is no longer an agency', () => {
  const e = setup(); const f = e.ctx.sarIssuer;
  assert.equal(f('สธ 0201.02/ว123'), 'สธ'); assert.equal(f('ที่ สธ 0201.02/ว123'), 'สธ'); assert.equal(f('ที่สธ0201/12'), 'สธ');
  assert.equal(f('สธ ๐๒๐๑/๑๒'), 'สธ'); assert.equal(f('or 0033/1'), 'OR'); assert.equal(f('OR 0033/1'), 'OR');
  assert.equal(f('ที่ 1234/2569'), ''); assert.equal(f(''), '');
});

test('issuer info: known code → name; unknown → flagged, suggestion only when exactly one known code is one typo away', () => {
  const e = setup(); const sc = e.ctx.sarScope({ email: C }); const m = e.ctx.sarIssuerMap(sc); const I = (c) => e.ctx.sarIssuerInfo(m, c);
  assert.equal(I('สธ').known, true); assert.equal(I('สธ').name, 'กระทรวงสาธารณสุข');
  const typo = I('สสธ'); assert.equal(typo.known, false); assert.equal(typo.suggest, 'สธ'); assert.equal(typo.suggestName, 'กระทรวงสาธารณสุข');
  assert.equal(I('XYZQ').suggest, '');
});

test('analytics: issuers carry known/unknown, the stats split, a review list with examples, and "no code" letters are counted apart', () => {
  const e = setup();
  rc(e, { docNo: 'สธ 0201/ว1', subject: 'a' }); rc(e, { docNo: 'สธ 0201/ว2', subject: 'b' });
  rc(e, { docNo: 'สสธ 0201/3', subject: 'c' }); rc(e, { docNo: 'ที่ 55/2569', subject: 'd' }); rc(e, { docNo: 'or 0033/1', subject: 'e' });
  const a = e.call(C, 'analytics', { year: 2569, registry: 'strat' });
  same(a.issuerStats, { known: 2, unknown: 2, none: 1 });
  const by = Object.fromEntries(a.issuers.map((i) => [i.key, i]));
  assert.equal(by['สธ'].known, true); assert.equal(by['สสธ'].known, false); assert.equal(by['สสธ'].suggest, 'สธ'); assert.equal(by['OR'].known, false);
  assert.equal(a.issuerReview.length, 2); assert.ok(a.issuerReview.every((r) => r.examples.length >= 1 && r.examples[0].id));
  assert.equal(a.issuerNone.n, 1); assert.equal(a.issuerNone.examples[0].docNo, 'ที่ 55/2569'); assert.equal(a.quality.pct.issuer, 40);
});

test('teaching the system a code (issuersave) turns it from unknown to known; removing it turns it back; only clerks may', () => {
  const e = setup(); rc(e, { docNo: 'OR 0033/1', subject: 'e' });
  assert.equal(e.call(C, 'analytics', { year: 2569, registry: 'strat' }).issuerStats.unknown, 1);
  assert.throws(() => e.call(OTHER, 'issuersave', { code: 'OR', name: 'x' }), { code: 'FORBIDDEN' });
  assert.throws(() => e.call(C, 'issuersave', { code: 'OR12', name: 'x' }), { code: 'BAD_REQUEST' });
  e.call(C, 'issuersave', { code: 'or', name: 'โรงพยาบาลสวนปรุง' });
  const a = e.call(C, 'analytics', { year: 2569, registry: 'strat' });
  same([a.issuerStats.known, a.issuerStats.unknown], [1, 0]); assert.equal(a.issuers[0].name, 'โรงพยาบาลสวนปรุง');
  assert.ok(e.call(C, 'issuers', {}).items.some((i) => i.code === 'OR' && i.custom));
  e.call(C, 'issuersave', { code: 'OR', name: '' });
  assert.equal(e.call(C, 'analytics', { year: 2569, registry: 'strat' }).issuerStats.unknown, 1);
});

test('list: filter by origin (code / _unknown / _none), the drop-down counts ignore the other filters, rows carry their origin', () => {
  const e = setup();
  rc(e, { docNo: 'สธ 1/ว1', subject: 'ก' }); rc(e, { docNo: 'สธ 1/ว2', subject: 'ข' }); rc(e, { docNo: 'ชม 2/1', subject: 'ค' }); rc(e, { docNo: 'สสธ 9/1', subject: 'ง' }); rc(e, { docNo: 'ที่ 77/2569', subject: 'จ' });
  const all = e.call(C, 'list', { kind: 'in', registry: 'strat' });
  assert.equal(all.total, 5); assert.equal(all.origins.unknown, 1); assert.equal(all.origins.none, 1);
  assert.equal(all.origins.list.find((o) => o.key === 'สธ').n, 2);
  const q = (origin, extra) => e.call(C, 'list', { kind: 'in', registry: 'strat', origin, ...extra });
  assert.equal(q('สธ').total, 2); assert.equal(q('สธ').origins.list.find((o) => o.key === 'สธ').n, 2);
  same(q('_unknown').items.map((d) => d.subject), ['ง']); same(q('_none').items.map((d) => d.subject), ['จ']);
  assert.equal(q('สธ', { q: 'ข' }).total, 1);
  const row = q('สธ').items[0]; assert.equal(row.issuer, 'สธ'); assert.equal(row.issuerName, 'กระทรวงสาธารณสุข'); assert.equal(row.issuerKnown, true);
  assert.equal(e.call(C, 'rows', { kind: 'in', registry: 'strat', origin: 'ชม' }).rows.length, 1);
  assert.equal(e.call(C, 'list', { kind: 'out', registry: 'strat', origin: 'สธ' }).origins, null);
});

test('senders spelt differently are counted as ONE name (flagged) and can be unified with partyfix; each letter gets a history entry', () => {
  const e = setup();
  rc(e, { docNo: 'สธ 1/1', subject: 'ก', party: 'สำนักงานเขตสุขภาพที่ 1' }); rc(e, { docNo: 'สธ 1/2', subject: 'ข', party: 'สำนักงานเขตสุขภาพที่ 1' }); rc(e, { docNo: 'สธ 1/3', subject: 'ค', party: 'สำนักงานเขตสุขภาพที่1' });
  rc(e, { docNo: 'สธ 1/4', subject: 'ง', party: 'สำนักงานเขตสุขภาพที่ 2' });
  let a = e.call(C, 'analytics', { year: 2569, registry: 'strat' });
  const s1 = a.senders.find((s) => s.name === 'สำนักงานเขตสุขภาพที่ 1'); assert.equal(s1.n, 3); assert.equal(s1.variants.length, 2);
  assert.ok(a.senderSimilar.some((p) => [p.a, p.b].includes('สำนักงานเขตสุขภาพที่ 2')));
  assert.throws(() => e.call(OTHER, 'partyfix', { from: ['x'], to: 'y' }), { code: 'FORBIDDEN' }); assert.throws(() => e.call(C, 'partyfix', { from: [], to: 'y' }), { code: 'BAD_REQUEST' });
  const r = e.call(C, 'partyfix', { year: 2569, registry: 'strat', from: ['สำนักงานเขตสุขภาพที่1'], to: 'สำนักงานเขตสุขภาพที่ 1' });
  assert.equal(r.changed, 1);
  a = e.call(C, 'analytics', { year: 2569, registry: 'strat' });
  assert.equal(a.senders.find((s) => s.name === 'สำนักงานเขตสุขภาพที่ 1').variants.length, 0);
  const id = e.call(C, 'list', { kind: 'in', registry: 'strat', q: 'ค' }).items[0].id;
  assert.ok(e.call(C, 'get', { id }).events.some((x) => x.type === 'edit' && /รวมชื่อผู้ส่ง/.test(x.text)));
});

test('my work: every item says what this person may do (can) · the head gets the pool to assign from · a stranger sees nothing', () => {
  const e = setup(); const r = rc(e, { docNo: 'สธ 1/1', subject: 'ส่งต่อ' }); e.call(C, 'route', { id: r.doc.id, toUnits: [{ unit: 'qa', action: 'perform' }] });
  const mine = (who) => e.call(who, 'my', {});
  const h = mine(HEAD).items[0]; same(h.can, { ack: true, assign: true, done: true, ret: true }); same([...mine(HEAD).pools.qa].sort(), [HEAD, STAFF].sort()); assert.equal(h.issuer, 'สธ');
  const s = mine(STAFF); same(s.items[0].can, { ack: true, assign: false, done: true, ret: true }); assert.equal(s.pools.qa, undefined);
  assert.equal(mine(OTHER).items.length, 0);
  e.call(STAFF, 'ack', { id: r.doc.id, unit: 'qa' });
  same(mine(STAFF).items[0].can, { ack: false, assign: false, done: true, ret: true });
  e.call(HEAD, 'done', { id: r.doc.id, unit: 'qa', note: 'เสร็จ' });
  same(mine(HEAD).items[0].can, { ack: false, assign: false, done: false, ret: false });
  same(e.call(HEAD, 'get', { id: r.doc.id }).to[0].can, { ack: false, assign: false, done: false, ret: false });
});
