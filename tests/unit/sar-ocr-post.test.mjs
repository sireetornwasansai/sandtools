import { test } from 'node:test';
import assert from 'node:assert';
import P from '../../src/js/modules/sar-ocr-post.js';
const t = (name, fn) => test(name, fn);

// หน้า 1 ของหนังสือจริง (ตามต้นฉบับ PDF) — OCR ที่อ่านถูกทั้งหมด
const GOOD = `ด่วนที่สุด
ที่ สธ ๐๒๐๘.๐๒/ว ๑๐๔๔๐   สำนักงานปลัดกระทรวงสาธารณสุข
ถนนติวานนท์ จังหวัดนนทบุรี ๑๑๐๐๐
๑๔ พฤศจิกายน ๒๕๖๗
เรื่อง มาตรการบริหารอัตราว่างสำนักงานปลัดกระทรวงสาธารณสุข
เรียน ผู้ว่าราชการจังหวัดทุกจังหวัด
อ้างถึง ๑. หนังสือสำนักเลขาธิการคณะรัฐมนตรี ด่วนที่สุด ที่ นร ๐๕๐๕/ว ๑๑๒ ลงวันที่ ๑๖ มีนาคม ๒๕๖๖
๒. หนังสือสำนักเลขาธิการคณะรัฐมนตรี ด่วนที่สุด ที่ นร ๐๕๐๕/ว(ล) ๑๔๕๗๒ ลงวันที่ ๒๗ กรกฎาคม ๒๕๖๗
สิ่งที่ส่งมาด้วย แผนการบริหารอัตราว่างสำนักงานปลัดกระทรวงสาธารณสุข จำนวน ๑ ฉบับ
ตามหนังสือที่อ้างถึง ๑ มติคณะรัฐมนตรีในการประชุมเมื่อวันที่ ๑๔ มีนาคม ๒๕๖๖`;

// ผลที่หน้าจอแสดงจริง: เลขที่อ่านผิด, ไม่เจอตราด่วน/วันที่, เลขที่ปนในช่อง "จาก", ปี อ้างถึงเป็น 25020, ขาดข้อ 2
const BAD = `ที่ สธจ 0205.02/ว 90   สำนักงานปลัดกระทรวงสาธารณสุข
ถนนติวานนท์ จังหวัดนนทบุรี 11000
เรื่อง มาตรการบริหารอัตราว่างสำนักงานปลัดกระทรวงสาธารณสุข
เรียน ผู้ว่าราชการจังหวัดทุกจังหวัด
อ้างถึง 1. หนังสือสำนักเลขาธิการคณะรัฐมนตรี ด่วนที่สุด ที่ นร 0505/ว 112 ลงวันที่ 10 มีนาคม 25020
สิ่งที่ส่งมาด้วย แผนการบริหารอัตราว่างสำนักงานปลัดกระทรวงสาธารณสุข จำนวน 1 ฉบับ`;

const NAME1 = '14-153012_แก้ไข-ด่วนที่สุด ที่ สธ 0208.02 ว 10440 ลว 14 พ.ย.2567 - มาตรการบริหารอัตราว่าง.pdf';
const NAME2 = 'แก้ไข-ด่วนที่สุด_ที่_สธ_0208_02_ว_10440_ลว_14_พ_ย_2567_-_มาตร.pdf';   // ชื่อที่ถูกแทน . ด้วย _

t('extract: หนังสือที่อ่านถูก', () => {
  const e = P.extract(GOOD);
  assert.strictEqual(e.urgency, 'most');
  assert.strictEqual(e.docNo, 'สธ 0208.02/ว10440');
  assert.strictEqual(e.docDate, '2024-11-14');
  assert.strictEqual(e.party, 'สำนักงานปลัดกระทรวงสาธารณสุข');
  assert.strictEqual(e.subject, 'มาตรการบริหารอัตราว่างสำนักงานปลัดกระทรวงสาธารณสุข');
  assert.strictEqual(e.salut, 'ผู้ว่าราชการจังหวัดทุกจังหวัด');
  assert.strictEqual(e.refs.split('\n').length, 2);
  assert.ok(/16 มีนาคม 2566/.test(e.refs) && /27 กรกฎาคม 2567/.test(e.refs));
  assert.strictEqual(e.encl, 'แผนการบริหารอัตราว่างสำนักงานปลัดกระทรวงสาธารณสุข จำนวน 1 ฉบับ');
  assert.deepStrictEqual(P.reconcile(e, P.hintsFromFileName(NAME1)).notes, []);
});
t('ข้อความ "ด่วนที่สุด" ในข้อ อ้างถึง ไม่ทำให้เป็นหนังสือด่วน', () => assert.strictEqual(P.extract(BAD).urgency, ''));
t('hints: ชื่อไฟล์ปกติและชื่อที่แทน . ด้วย _', () => {
  [NAME1, NAME2].forEach(n => assert.deepStrictEqual(P.hintsFromFileName(n), { bookNo: 'สธ 0208.02/ว10440', bookDate: '2024-11-14', urgency: 'most' }));
});
t('reconcile: แก้ 4 จุดที่หน้าจอพลาด (เลขที่ วันที่ ด่วน จาก) และเตือนปี 25020', () => {
  const r = P.reconcile(P.extract(BAD), P.hintsFromFileName(NAME1));
  assert.strictEqual(r.fields.docNo, 'สธ 0208.02/ว10440');
  assert.strictEqual(r.fields.docDate, '2024-11-14');
  assert.strictEqual(r.fields.urgency, 'most');
  assert.strictEqual(r.fields.party, 'สำนักงานปลัดกระทรวงสาธารณสุข');
  assert.ok(r.needsReview);
  assert.ok(r.notes.some(x => x.field === 'docNo' && x.level === 'warn'));
  assert.ok(r.notes.some(x => x.field === 'refs' && /25020/.test(x.msg)));
});
t('reconcile: ไม่มี hint → ไม่แก้มั่ว แต่เตือนรูปแบบเลขที่ผิดปกติ', () => {
  const r = P.reconcile({ docNo: 'ฮ 12', party: 'สำนักงาน', refs: '' }, {});
  assert.strictEqual(r.fields.docNo, 'ฮ 12'); assert.ok(r.notes.some(x => x.field === 'docNo'));
});
t('ปีผิดปกติ', () => { assert.strictEqual(P.yearCE('25020'), 0); assert.strictEqual(P.yearCE('2567'), 2024); assert.strictEqual(P.yearCE('67'), 2024); });
t('ช่อง "จาก" ที่มีเลขที่ปนอยู่ถูกเตือน', () => assert.ok(P.reconcile({ party: 'สธจ 0205.02/ว 90 25ที สำนักงาน', docNo: '' }, {}).notes.some(x => x.field === 'party')));
