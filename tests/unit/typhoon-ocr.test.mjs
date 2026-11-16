import test from 'node:test';
import assert from 'node:assert/strict';
import { typhoonToText, createTyphoonReader, canvasToBase64Jpeg } from '../../src/js/modules/typhoon-ocr.js';
import { parseLetter } from '../../src/js/modules/saraban-engine.js';

const SAMPLE = `<figure>
ตราครุฑสีแดงถือพานหนังสือ อยู่กลางหน้า
</figure>

ด่วนที่สุด

ที่ สธ 0208.02/ว 10440          สำนักงานสาธารณสุขจังหวัดเชียงใหม่

14 พฤศจิกายน 2567

เรื่อง ขอเชิญประชุมชี้แจงแนวทางการดำเนินงาน

เรียน ผู้อำนวยการโรงพยาบาลสันทราย

<table><tr><td>ลำดับ</td><td>รายการ</td></tr><tr><td>1</td><td>ประชุม&nbsp;&amp;อบรม</td></tr></table>

<page_number>1</page_number>`;

test('typhoonToText: drops figure descriptions + page numbers, flattens tables, decodes entities', () => {
  const t = typhoonToText(SAMPLE);
  assert.ok(!/ตราครุฑ|figure|page_number|<|>/.test(t));
  assert.match(t, /^ด่วนที่สุด/); assert.match(t, /ลำดับ รายการ\n1 ประชุม &อบรม/);
});

test('typhoonToText: unclosed <figure> (cut-off output), br tags, code fences, picture placeholders, null', () => {
  assert.equal(typhoonToText('เรื่อง ก\n<figure>คำอธิบายที่ถูกตัดกลางคัน'), 'เรื่อง ก');
  assert.equal(typhoonToText('บรรทัดหนึ่ง<br/>บรรทัดสอง'), 'บรรทัดหนึ่ง\nบรรทัดสอง');
  assert.equal(typhoonToText('```markdown\nเรื่อง ทดสอบ\n```'), 'เรื่อง ทดสอบ');
  assert.equal(typhoonToText('![](dummy.png) ข้อความ'), 'ข้อความ');
  assert.equal(typhoonToText(null), '');
});

test('the cleaned Typhoon text is what parseLetter needs: number, date, subject, addressee', () => {
  const r = parseLetter(typhoonToText(SAMPLE), { today: '2024-11-20' });
  assert.equal(r.urgency, 'most'); assert.match(r.docNo, /0208\.02\/ว\s?10440/); assert.equal(r.docDate, '2024-11-14');
  assert.match(r.subject, /ขอเชิญประชุมชี้แจง/); assert.match(r.salut, /ผู้อำนวยการโรงพยาบาลสันทราย/);
});

// --- reader (browser bits faked) ---
function fakeBrowser() {
  globalThis.FileReader = class { readAsDataURL() { this.result = 'data:image/jpeg;base64,QUJD'; setTimeout(() => this.onload(), 0); } };
  const mk = () => ({ width: 0, height: 0, getContext: () => ({ fillRect() {}, drawImage() {} }), toBlob: (cb) => cb(new Blob(['x'])) });
  globalThis.document = { createElement: mk };
  return mk;
}
const canvas = () => ({ width: 2480, height: 3508 });

test('canvasToBase64Jpeg → base64 without the data: prefix', async () => { fakeBrowser(); assert.equal(await canvasToBase64Jpeg(canvas()), 'QUJD'); });

test('reader: returns cleaned text and counts pages; sends only {data}', async () => {
  fakeBrowser(); const sent = [];
  const rd = createTyphoonReader(async (p) => { sent.push(Object.keys(p)); return { text: SAMPLE }; });
  const t = await rd.page(canvas());
  assert.match(t, /^ด่วนที่สุด/); assert.equal(rd.used, 1); assert.deepEqual(sent, [['data']]);
});

test('reader: a permanent problem (not configured / old backend / key rejected) switches it off at once — no repeated calls', async () => {
  for (const code of ['NOT_CONFIGURED', 'UNKNOWN_ACTION', 'OCR_AUTH', 'FORBIDDEN']) {
    fakeBrowser(); let n = 0; const rd = createTyphoonReader(async () => { n += 1; throw Object.assign(new Error('x'), { code }); });
    assert.equal(await rd.page(canvas()), null); assert.equal(rd.active, false); assert.equal(await rd.page(canvas()), null); assert.equal(n, 1, code);
  }
});

test('reader: one hiccup is retried on the next page; two in a row switch it off; a good page resets the count', async () => {
  fakeBrowser(); let n = 0;
  const rd = createTyphoonReader(async () => { n += 1; if (n === 1) throw Object.assign(new Error('t'), { code: 'TIMEOUT' }); return { text: SAMPLE }; });
  assert.equal(await rd.page(canvas()), null); assert.equal(rd.active, true);
  assert.ok(await rd.page(canvas())); assert.equal(rd.used, 1);
  const bad = createTyphoonReader(async () => { throw Object.assign(new Error('t'), { code: 'OCR_BUSY' }); });
  await bad.page(canvas()); await bad.page(canvas()); assert.equal(bad.active, false);
});

test('reader: an answer too short to be a letter page falls back to the device (null) and never throws', async () => {
  fakeBrowser(); const rd = createTyphoonReader(async () => ({ text: '<figure>รูป</figure> ก' }));
  assert.equal(await rd.page(canvas()), null); assert.equal(rd.used, 0);
});
