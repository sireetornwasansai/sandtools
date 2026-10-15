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
  assert.equal(thaiDate('2026-10-09'), '9 ต.ค. 2569'); assert.equal(thaiDateTime('2026-10-15 10:05:33'), '15 ต.ค. 2569 10.05 น.');
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.match(dueLabel('2026-10-10', '2026-10-15'), /เลยกำหนด 5 วัน/); assert.match(dueLabel('2026-10-15', '2026-10-15'), /ครบกำหนดวันนี้/);
});

test('csv: BOM for Excel, quoting, formula guard', () => {
  const c = toCsv(['เลขรับ', 'เรื่อง'], [['1/2569', 'a,"b"'], ['2/2569', '=SUM(A1)']]);
  assert.ok(c.startsWith('\ufeff')); assert.ok(c.includes('"a,""b"""')); assert.ok(c.includes("'=SUM(A1)"));
  assert.equal(plainText('# หัวข้อ\n**ตัวหนา** | ตาราง'), 'หัวข้อ\nตัวหนา ตาราง');
});
