// Runs gas/SarImport.gs: the clerks' Google Sheet (4 tabs, different column layouts) → the Saraban register. Rows are synthetic but keep the real layouts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { env } from './helpers/saraban-env.mjs';

const D = (y, m, d) => new Date(Date.UTC(y, m - 1, d, -7));   // midnight Bangkok; the clerks' sheet holds Buddhist-era years (2569)
const SID = '1sbpFcG9ObJw5vpLXd2IJG9G4p8Tno9K0gCK3bKajoEg';
const URL = `https://docs.google.com/spreadsheets/d/${SID}/edit?gid=1050450088#gid=1050450088`;

function book(tabs) {
  const mkTab = (t) => ({ getName: () => t.name, getSheetId: () => t.gid, getLastRow: () => t.rows.length, getLastColumn: () => Math.max(...t.rows.map((r) => r.length)),
    getRange: (r, c, nr, nc) => ({ getValues: () => t.rows.slice(r - 1, r - 1 + nr).map((row) => Array.from({ length: nc }, (_, j) => (row[c - 1 + j] === undefined ? '' : row[c - 1 + j]))) }) });
  return { getId: () => SID, getName: () => 'หนังสือรับ-ส่ง ปี 2569', getSpreadsheetTimeZone: () => 'Asia/Bangkok', getSheets: () => tabs.map(mkTab) };
}
const TABS = () => [
  { name: 'หนังสือรับงานยุทธศาสตร์ฯ', gid: 1, rows: [
    ['ที่', 'รายการสำคัญ', 'เลขรับ', 'วันที่รับ', 'หน่วยงาน', 'เรื่อง', 'ส่งได้', 'โน้ต'],
    ['1', 'ปกติ', 1, D(2569, 1, 5), ' สธ0312.1/ว2392  ', 'ขอประชาสัมพันธ์หลักสูตรการอบรม', '', ''],
    ['2', 'ปกติ', 2, D(2569, 1, 5), ' อว78.06/ว.20419 ', 'ขอเชิญชวนส่งบุคลากรเข้าประชุมวิชาการ', '', ''],
    ['', 'ด่วนมาก', 2, D(2569, 1, 6), 'ชม0033.002/ว1190', 'เลขเดิมซ้ำกับแถวก่อนหน้า', '', 'โน้ตทดสอบ'],
    ['', '', '', '', '', '', '', '']] },
  { name: 'หนังส่งรับงานยุทธศาสตร์ฯ', gid: 2, rows: [
    ['ที่', 'รายการสำคัญ', 'เลขส่ง', 'วันที่รับ', 'คอลัมน์ 5', 'หน่วยงานที่รับ', 'ส่งได้', 'หมายเหตุ'],
    ['1', 'ปกติ', 1, D(2569, 1, 7), 'ขออนุมัติดำเนินการโครงการพัฒนาศักยภาพพยาบาล', 'สสจ.ชม.', '', ''],
    ['2', 'ปกติ', 'ว.2', D(2569, 1, 9), 'ขอแจ้งเวียนงบลงทุน', 'กลุ่มงานรพ.สันทราย', '', ''],
    ['3', 'ปกติ', 3, D(2569, 1, 15), 'ขออนุมัติดำเนินการโครงการเพิ่มเติม', '', '', '']] },
  { name: ' หนังสือรับงานพัฒนาคุณภาพฯ', gid: 3, rows: [
    ['ที่', 'รายการสำคัญ', 'เลขรับ', 'วันที่รับ', 'Column 9', 'Column 10', 'เรื่อง', 'Column 11', 'ส่งได้', 'Column 8', 'โน้ต'],
    ['', 'ปกติ', 'สธ 0912.06/ว1830', D(2569, 9, 30), '10.3', '', 'ขอเชิญเข้ารับการอบรมหลักสูตรการวางแผน', 'ศูนย์อนามัยที่ 2 พิษณุโลก', '', '', ''],
    ['', 'ปกติ', 'ชม0033.003/ว989', D(2569, 10, 12), '11.36', '', 'ขอเชิญเข้าร่วมประชุมเชิงปฏิบัติการ', 'รพ.สวนปรุง', '', '', ''],
    ['7325', 'ปกติ', 'สธ 0829.25/ว5512', D(2569, 10, 6), '8.45', D(2569, 10, 16), 'ขอเชิญพยาบาลวิชาชีพสมัครเข้ารับการอบรม', 'รพ.สวนปรุง', '', '', '']] },
  { name: 'หนังส่งรับงานพัฒนาคุณภาพฯ', gid: 4, rows: [
    ['ที่', 'รายการสำคัญ', 'เลขส่ง', 'วันที่รับ', 'เรื่อง', 'หน่วยงานที่รับ', 'ส่งได้', 'หมายเหตุ'],
    ['1', 'ปกติ', 1, D(2569, 12, 9), 'ขออนุมัติจ่ายเงินคืนกรณีสำรองจ่าย', '', '', ''],
    ['2', 'ปกติ', 2, D(2569, 1, 19), 'สรุปรายงานผลการเข้าร่วมประชุม', '', '', '']] }
];
function setup(opts = {}) {
  const e = env({ ADMIN_EMAILS: 'admin@x.go.th', SAR_BOOK_PREFIX: 'สธ 0123.4' });
  let tabs = TABS(); let sheet = book(tabs); const props = {};
  e.ctx.SpreadsheetApp = { openById: (id) => { if (id !== SID) throw new Error('no access'); return sheet; } };
  e.ctx.PropertiesService = { getScriptProperties: () => ({ setProperty: (k, v) => { props[k] = v; e.store[k] = v; } }) };
  e.ctx.reopen = () => { sheet = book(tabs); };
  e.call('admin@x.go.th', 'unitsave', { code: 'strat', name: 'งานยุทธศาสตร์ฯ', type: 'internal', registry: true, prefix: 'สธ 0312.1' });
  e.call('admin@x.go.th', 'unitsave', { code: 'qual', name: 'งานพัฒนาคุณภาพฯ', type: 'internal', registry: true });
  return { ...e, tabs, props, rebuild: () => { sheet = book(tabs); } };
}
const PLAN = (num = 'keep') => ({ tabs: [{ gid: 1, registry: 'strat', numbering: num }, { gid: 2, registry: 'strat', numbering: num }, { gid: 3, registry: 'qual', numbering: 'new' }, { gid: 4, registry: 'qual', numbering: num }] });
const regRows = (e) => (e.sheets.Saraban || [[]]).slice(1);

test('scan: link or id, finds the four registers and their columns', () => {
  const e = setup(); const r = e.call('admin@x.go.th', 'impscan', { sheet: URL });
  assert.equal(r.tabs.length, 4);
  const by = Object.fromEntries(r.tabs.map((t) => [t.gid, t]));
  assert.deepEqual([by[1].kind, by[2].kind, by[3].kind, by[4].kind], ['in', 'out', 'in', 'out']);
  assert.equal(by[1].rows, 3); assert.equal(by[1].mapped.docNo, 'หน่วยงาน'); assert.equal(by[2].mapped.subject, 'คอลัมน์ 5');
  assert.equal(by[3].noIsNumber, false); assert.equal(by[3].mapped.party, 'Column 11'); assert.equal(by[3].mapped.docNo, 'เลขรับ');
  assert.equal(by[1].from, '2026-01-05');
});
test('scan / import need the admin; a bad link and an inaccessible sheet give clear errors', () => {
  const e = setup();
  assert.throws(() => e.call('clerk@x.go.th', 'impscan', { sheet: URL }), { code: 'FORBIDDEN' });
  assert.throws(() => e.call('admin@x.go.th', 'impscan', { sheet: 'hello' }), { code: 'BAD_REQUEST' });
  assert.throws(() => e.call('admin@x.go.th', 'impscan', { sheet: 'https://docs.google.com/spreadsheets/d/AAAAAAAAAAAAAAAAAAAAAAAA/edit' }), { code: 'IMPORT_NOACCESS' });
});
test('dry run counts but writes nothing', () => {
  const e = setup(); const before = regRows(e).length;
  const r = e.call('admin@x.go.th', 'import', { sheet: URL, plan: PLAN(), dry: true });
  assert.equal(r.imported, 11); assert.equal(regRows(e).length, before);
});
test('import keeps the old numbers, fixes a duplicate, builds book numbers, keeps unknown columns', () => {
  const e = setup(); const r = e.call('admin@x.go.th', 'import', { sheet: URL, plan: PLAN() });
  assert.equal(r.imported, 11);
  const rows = regRows(e); const f = (kind, reg, regNo) => rows.filter((x) => x[1] === kind && x[5] === reg && x[4] === regNo);
  const first = f('in', 'strat', '1/2569')[0]; assert.equal(first[8], 'สธ0312.1/ว2392'); assert.equal(first[10], 'ขอประชาสัมพันธ์หลักสูตรการอบรม'); assert.equal(first[9], '');
  assert.equal(first[7], '2026-01-05 00:00:00'); assert.match(first[11], /ไม่ระบุผู้ส่ง/); assert.equal(first[6], 'registered');
  assert.equal(f('in', 'strat', '2/2569').length, 1);
  const dup = f('in', 'strat', '3/2569')[0]; assert.ok(dup, 'duplicate old number 2 got the next free number'); assert.equal(dup[12], 'very'); assert.match(dup[20], /โน้ตทดสอบ/);
  const circ = f('out', 'strat', '2/2569')[0]; assert.equal(circ[8], 'สธ 0312.1/ว2'); assert.equal(JSON.parse(circ[28]).bookType, 'circular');
  assert.equal(f('out', 'strat', '1/2569')[0][8], 'สธ 0312.1/1'); assert.equal(f('out', 'strat', '1/2569')[0][11], 'สสจ.ชม.'); assert.equal(f('out', 'strat', '1/2569')[0][6], 'sent');
  const legacy = JSON.parse(rows.find((x) => x[8] === 'สธ 0829.25/ว5512')[28]).legacy; assert.equal(legacy['Column 9'], '8.45'); assert.equal(legacy['Column 10'], '2026-10-16');
});
test('tab without a real receive number: numbered by date, sender from the unnamed column', () => {
  const e = setup(); e.call('admin@x.go.th', 'import', { sheet: URL, plan: PLAN() });
  const q = regRows(e).filter((x) => x[1] === 'in' && x[5] === 'qual').sort((a, b) => a[3] - b[3]);
  assert.deepEqual(q.map((x) => x[8]), ['สธ 0912.06/ว1830', 'สธ 0829.25/ว5512', 'ชม0033.003/ว989']);
  assert.deepEqual(q.map((x) => x[4]), ['1/2569', '2/2569', '3/2569']); assert.equal(q[0][11], 'ศูนย์อนามัยที่ 2 พิษณุโลก');
});
test('running it again only adds NEW rows (sync); the next number continues after the imported ones', () => {
  const e = setup(); e.call('admin@x.go.th', 'import', { sheet: URL, plan: PLAN() });
  const again = e.call('admin@x.go.th', 'import', { sheet: URL, plan: PLAN() }); assert.equal(again.imported, 0); assert.equal(again.tabs[0].already, 3);
  e.tabs[0].rows.splice(4, 0, ['4', 'ปกติ', 4, D(2569, 3, 5), 'ชม0033/1', 'แถวใหม่ที่ธุรการเพิ่งพิมพ์', '', '']); e.rebuild();
  const s = e.call('admin@x.go.th', 'impsync', {}); assert.equal(s.imported, 1);
  assert.ok(regRows(e).some((x) => x[10] === 'แถวใหม่ที่ธุรการเพิ่งพิมพ์' && x[4] === '4/2569'));
  const next = e.call('clerk@x.go.th', 'receive', { docNo: 'ศธ 1/ว1', docDate: '2026-10-14', subject: 'หนังสือใหม่หลังนำเข้า', party: 'สสจ.', registry: 'strat' });
  assert.equal(next.doc.reg, '5/2569');
});
test('the register page can read imported rows (list) and nothing breaks for a missing registry', () => {
  const e = setup(); e.call('admin@x.go.th', 'import', { sheet: URL, plan: PLAN() });
  const l = e.call('clerk@x.go.th', 'list', { kind: 'in', registry: 'strat', year: 2569 }); assert.equal(l.total, 3);
  assert.throws(() => e.call('admin@x.go.th', 'import', { sheet: URL, plan: { tabs: [{ gid: 1, registry: 'nope' }] } }), { code: 'BAD_REQUEST' });
  assert.throws(() => e.call('admin@x.go.th', 'import', { sheet: URL, plan: { tabs: [{ gid: 99, registry: 'strat' }] } }), { code: 'BAD_REQUEST' });
});
