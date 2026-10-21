import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLetter, parseThaiDate, toCsv, thaiDate, thaiDateTime, dueLabel, addDays, plainText } from '../../src/js/modules/saraban-engine.js';

const LETTER = `ด่วนที่สุด
ที่ สธ ๐๑๒๓.๔/ว ๕๖๗
สำนักงานสาธารณสุขจังหวัดทดสอบ
ถนนสาธารณสุข ตำบลในเมือง
๙ ตุลาคม ๒๕๖๙
เรื่อง ขอเชิญเข้าร่วมประชุมชี้แจงแนวทางการดำเนินงาน
ป้องกันและควบคุมโรค ประจำปีงบประมาณ ๒๕๗๐
เรียน ผู้อำนวยการโรงพยาบาลทดสอบ
อ้างถึง หนังสือสำนักงานสาธารณสุขจังหวัด ที่ สธ 0123.4/1000 ลงวันที่ 1 กันยายน 2569
สิ่งที่ส่งมาด้วย 1. กำหนดการประชุม จำนวน 1 ฉบับ
2. แบบตอบรับ จำนวน 1 ฉบับ
ด้วยสำนักงานสาธารณสุขจังหวัด ... ขอให้ตอบรับภายในวันที่ ๑๖ ตุลาคม ๒๕๖๙`;

test('reads the fields of a Thai circular letter (Thai digits, wrapped subject, urgency)', () => {
  const r = parseLetter(LETTER);
  assert.equal(r.docNo, 'สธ 0123.4/ว 567'.replace('ว 567', 'ว 567'));
  assert.equal(r.docDate, '2026-10-09');
  assert.equal(r.subject, 'ขอเชิญเข้าร่วมประชุมชี้แจงแนวทางการดำเนินงาน ป้องกันและควบคุมโรค ประจำปีงบประมาณ 2570');
  assert.equal(r.salut, 'ผู้อำนวยการโรงพยาบาลทดสอบ');
  assert.equal(r.urgency, 'most');
  assert.equal(r.party, 'สำนักงานสาธารณสุขจังหวัดทดสอบ');
  assert.match(r.refs, /ลงวันที่ 1 กันยายน 2569/);
  assert.match(r.encl, /กำหนดการประชุม/);
  assert.equal(r.due, '2026-10-16');
  assert.equal(r.secrecy, 'normal'); assert.ok(r.found.subject && r.found.docNo && r.found.due);
});

test('does not invent: empty / unrelated text finds nothing, "within N days" is relative, secrecy marks are detected', () => {
  const e = parseLetter('สวัสดีครับ ทดสอบ'); assert.deepEqual(Object.keys(e.found), []); assert.equal(e.urgency, 'normal');
  assert.equal(parseLetter('เรื่อง ขอข้อมูล\nเรียน ผอ.\nขอให้ส่งภายใน 7 วัน นับแต่ได้รับหนังสือ').dueDays, 7);
  assert.equal(parseLetter('ลับมาก\nที่ กห 0401/55\nเรื่อง ทดสอบ').secrecy, 'vsecret');
  assert.equal(parseLetter('ลับ\nที่ กห 0401/55\nเรื่อง ทดสอบ').secrecy, 'secret');
  assert.equal(parseLetter('เรื่อง ขอความร่วมมือ ด่วนมาก ในการตอบกลับ').urgency, 'normal', 'urgency only counts at the top of the letter');
});

test('dates: Thai words, abbreviations, numeric, invalid; labels', () => {
  assert.equal(parseThaiDate('๑๒ ก.ย. ๒๕๖๙'), '2026-09-12'); assert.equal(parseThaiDate('05/03/2569'), '2026-03-05');
  assert.equal(parseThaiDate('31 กุมภาพันธ์ 2569'), ''); assert.equal(parseThaiDate('ไม่มีวันที่'), '');
  assert.equal(thaiDate('2026-10-09'), '09/10/2569'); assert.equal(thaiDateTime('2026-10-15 10:05:33'), '15/10/2569 10.05 น.');
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.match(dueLabel('2026-10-10', '2026-10-15'), /เลยกำหนด 5 วัน/); assert.match(dueLabel('2026-10-15', '2026-10-15'), /ครบกำหนดวันนี้/);
});

test('csv: BOM for Excel, quoting, formula guard', () => {
  const c = toCsv(['เลขรับ', 'เรื่อง'], [['1/2569', 'a,"b"'], ['2/2569', '=SUM(A1)']]);
  assert.ok(c.startsWith('\ufeff')); assert.ok(c.includes('"a,""b"""')); assert.ok(c.includes("'=SUM(A1)"));
  assert.equal(plainText('# หัวข้อ\n**ตัวหนา** | ตาราง'), 'หัวข้อ\nตัวหนา ตาราง');
});

import { thaiDateLong, ageLabel, escHtml, stageIndex, STAGE_STEPS, buildRegisterHtml, buildReceiptHtml } from '../../src/js/modules/saraban-engine.js';
test('v1.8.0 dates, age, stage index, escaping', () => {
  assert.equal(thaiDateLong('2026-10-14'), 'วันพุธที่ 14 ตุลาคม พ.ศ. 2569'); assert.equal(thaiDateLong('x'), '');
  assert.equal(ageLabel(0), 'วันนี้'); assert.equal(ageLabel(1), 'เมื่อวาน'); assert.equal(ageLabel(5), '5 วันก่อน'); assert.equal(ageLabel(-1), ''); assert.equal(ageLabel(undefined), '');
  assert.deepEqual(STAGE_STEPS.map((s) => s[0]), ['registered', 'routed', 'inprogress', 'done']);
  assert.equal(stageIndex('registered'), 0); assert.equal(stageIndex('inprogress'), 2); assert.equal(stageIndex('done'), 3); assert.equal(stageIndex('returned'), 0); assert.equal(stageIndex('void'), -1);
  assert.equal(escHtml('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;'); assert.equal(escHtml(null), '');
});
test('v1.8.0 print sheets: register (A4 landscape, escaped, void struck) and received stamp', () => {
  const rows = [{ reg: '5/2569', at: '2026-10-14 09:30:00', docNo: 'ศธ 1/ว2', docDate: '2026-10-09', party: 'สสจ.<x>', subject: 'ขอข้อมูล', urgency: 'very', stage: 'routed', action: '', note: '' }, { reg: '6/2569', at: '2026-10-14 10:00:00', docNo: '', docDate: '', party: 'ก', subject: 'ยกเลิก', urgency: 'normal', stage: 'void', action: '', note: '' }];
  const g = buildRegisterHtml({ org: 'รพ.สันทราย', kind: 'in', year: 2569, rows });
  assert.match(g, /ทะเบียนหนังสือรับ ประจำปี พ.ศ. 2569/); assert.match(g, /A4 landscape/); assert.match(g, /สสจ\.&lt;x&gt;/); assert.match(g, /\(ด่วนมาก\)/); assert.match(g, /class="void"/); assert.ok(!g.includes('<x>'));
  assert.match(buildRegisterHtml({ org: 'o', kind: 'out', year: 2569, rows: [] }), /ทะเบียนหนังสือส่ง[\s\S]*ไม่มีรายการ/);
  const r = buildReceiptHtml({ org: 'รพ.สันทราย', doc: { reg: '5/2569', at: '2026-10-14 09:30:00' } });
  assert.match(r, /เลขรับ 5\/2569/); assert.match(r, /14\/10\/2569/); assert.match(r, /เวลา 09\.30 น\./);
});

test('v1.10 parseLetter: letter numbers with "ว." / "พิเศษ" and a sender from the letterhead', () => {
  const a = parseLetter('ที่ อว78.06/ว.20419\nสำนักงานสาธารณสุขจังหวัดเชียงใหม่\n10 ตุลาคม 2569\nเรื่อง ขอเชิญประชุม\nเรียน ผู้อำนวยการโรงพยาบาลสันทราย');
  assert.equal(a.docNo, 'อว78.06/ว.20419'); assert.equal(a.party, 'สำนักงานสาธารณสุขจังหวัดเชียงใหม่'); assert.equal(a.docDate, '2026-10-10'); assert.equal(a.subject, 'ขอเชิญประชุม');
  assert.equal(parseLetter('ที่ สธ 0123/พิเศษ 9\nกระทรวงสาธารณสุข\nเรื่อง ก').docNo, 'สธ 0123/พิเศษ 9');
});

import { repairLabels, fuzzyMonth, skeleton, editDistance, RECEIVE_STEPS } from '../../src/js/modules/saraban-engine.js';
test('v1.11 OCR-tolerant reading: damaged labels, months and digits are repaired, body text is not', () => {
  assert.equal(skeleton('เรื่อง'), 'เรอง'); assert.equal(editDistance('เรอง', 'เรยน'), 2);
  const r = repairLabels('เรอ่ ง ขอเชิญประชุม\nเร ยีน ผู้อำนวยการ\nอางถึง หนังสือเดิม\nเรื่อง ปกติ\nเรียนรู้ได้ทุกวัน');
  assert.deepEqual(r.fixed, ['เรื่อง', 'เรียน', 'อ้างถึง']);
  assert.match(r.text, /^เรื่อง ขอเชิญประชุม\nเรียน ผู้อำนวยการ\nอ้างถึง หนังสือเดิม\nเรื่อง ปกติ\nเรียนรู้ได้ทุกวัน$/);
  assert.equal(fuzzyMonth('ตลุาคม'), 10); assert.equal(fuzzyMonth('กนั'), 0);
  const p = parseLetter('ที่ สธ 0O12.4/ว 56l\nสำนักงานสาธารณสุขจังหวัดทดสอบ\n๙ ตลุาคม ๒๕๖๙\nเรอ่ ง ขอเชิญประชุม\nเร ยีน ผอ.โรงพยาบาล');
  assert.equal(p.docDate, '2026-10-09'); assert.equal(p.subject, 'ขอเชิญประชุม'); assert.equal(p.salut, 'ผอ.โรงพยาบาล'); assert.match(p.docNo, /^สธ 0012\.4\/ว 561$/);
  assert.deepEqual(RECEIVE_STEPS.map((s) => s[0]), ['import', 'read', 'dup', 'number', 'forward']);
});
