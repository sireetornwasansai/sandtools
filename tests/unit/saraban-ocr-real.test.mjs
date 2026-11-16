// Real Tesseract (tha+eng, 300 dpi) output of page 1 of a scanned MOPH letter ("ด่วนที่สุด ที่ สธ 0208.02/ว 10440 ลว 14 พ.ย. 2567").
// The page uses bold Thai numerals that OCR misreads (๘→๕, ๑๐๔๔๐→"90", ๑๔→"9๕", ๒๕๖๗→๒๕๒๐), so the file name is the reliable copy of number + date.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLetter, stampUrgency } from '../../src/js/modules/saraban-engine.js';
import { reconcile, hintsFromFileName } from '../../src/js/modules/sar-ocr-post.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (n) => fs.readFileSync(path.join(here, '..', 'fixtures', n), 'utf8');
const NAME = 'แก_ไข-ด_วนท__ส_ด_ท___สธ_0208_02_ว_10440_ลว_14_พ_ย_2567_-_มาตร.pdf';   // tone marks / vowels replaced by "_"

for (const f of ['ocr-real-sor10440.psm4.txt', 'ocr-real-sor10440.psm6.txt']) {
  test(`parseLetter on real OCR (${f}): stamp, sender, subject, salutation`, () => {
    const r = parseLetter(read(f));
    assert.strictEqual(r.urgency, 'most');                                     // "ดวนทสด" — tone marks lost
    assert.strictEqual(r.party, 'สำนักงานปลัดกระทรวงสาธารณสุข');                 // not the address line, not the number junk, nikhahit+aa → sara am
    assert.strictEqual(r.subject, 'มาตรการบริหารอัตราว่างสำนักงานปลัดกระทรวงสาธารณสุข');
    assert.strictEqual(r.salut, 'ผู้ว่าราชการจังหวัดทุกจังหวัด');
    assert.ok(/^สธ 0205\.02\/ว/.test(r.docNo));                                // prefix found even though the digits are misread
    assert.strictEqual(r.docDate, '');                                         // an impossible year is left empty, never guessed
  });
  test(`file name completes what OCR cannot read (${f})`, () => {
    const r = parseLetter(read(f)); const h = hintsFromFileName(NAME);
    assert.deepStrictEqual(h, { bookNo: 'สธ 0208.02/ว10440', bookDate: '2024-11-14', urgency: 'most' });
    const rc = reconcile({ docNo: r.docNo, docDate: r.docDate, urgency: r.urgency === 'normal' ? '' : r.urgency, refs: r.refs, party: r.party }, h);
    assert.strictEqual(rc.fields.docNo, 'สธ 0208.02/ว10440'); assert.strictEqual(rc.fields.docDate, '2024-11-14'); assert.strictEqual(rc.fields.urgency, 'most');
    assert.ok(rc.needsReview && rc.notes.some((n) => n.field === 'docNo' && n.level === 'warn'));
    assert.ok(rc.notes.some((n) => n.field === 'refs' && /25020/.test(n.msg)));
  });
}

test('the sender line is cut at the organisation word (letter number and noise before it are dropped)', () => {
  const r = parseLetter('ทชีสธ 0205.02/ว 90EEO 222243 Oy4 สํานักงานปลัดกระทรวงสาธารณสุข\nถนนติวานนท์ จังหวัดนนทบุรี 11000\nเรื่อง ทดสอบ\nเรียน ผู้ว่าราชการจังหวัด');
  assert.strictEqual(r.party, 'สำนักงานปลัดกระทรวงสาธารณสุข');
  assert.ok(/^สธ 0205\.02\/ว/.test(r.docNo));                                   // "ทชีสธ": the garbled "ที่" no longer hides the number
});

test('address line is never taken as the sender', () => {
  const r = parseLetter('ที่ ชม 0033.002/ว1190\nถนนติวานนท์ จังหวัดนนทบุรี 11000\nเรื่อง ทดสอบ\nเรียน ผู้อำนวยการ');
  assert.strictEqual(r.party, '');
});

test('stampUrgency: tolerant of lost tone marks, strict about where it looks', () => {
  assert.strictEqual(stampUrgency(['ดวนทสด   ew']), 'most');
  assert.strictEqual(stampUrgency(['. ด่วนทีสุด']), 'most');
  assert.strictEqual(stampUrgency(['ดวนมาก']), 'very');
  assert.strictEqual(stampUrgency(['ด่วน']), 'urgent');
  assert.strictEqual(stampUrgency(['ที่ สธ 0208.02/ว 10440']), '');
  assert.strictEqual(stampUrgency(['a', 'b', 'c', 'd', 'e', 'f', 'ด่วนที่สุด']), '');          // only the top lines
  assert.strictEqual(stampUrgency(['ด่วนที่สุดตามที่ได้แจ้งไปแล้วในการประชุม']), '');             // a sentence is not a stamp
});

test('Inbox.gs reads urgency from a file name whose marks became "_" (queuefile hints)', () => {
  const ctx = { console, Utilities: {}, CacheService: {}, LNK_TZ: 'Asia/Bangkok' }; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(here, '..', '..', 'gas', 'Inbox.gs'), 'utf8'), ctx);
  const R = (n) => vm.runInContext(`inbUrgencyLoose(${JSON.stringify(n)})`, ctx);
  assert.strictEqual(R(NAME), 'most');
  assert.strictEqual(R('ด_วนมาก_ที่_สธ_0208_02_ว_1.pdf'), 'very');
  assert.strictEqual(R('ด_วน_ที่_นร_0505_ว_1.pdf'), 'urgent');
  assert.strictEqual(R('หนังสือ ที่ นร 0505 ว 112.pdf'), '');
  assert.strictEqual(vm.runInContext(`inbDateLoose(${JSON.stringify(NAME)})`, ctx), '2024-11-14');
  assert.strictEqual(vm.runInContext(`inbBookNoLoose(${JSON.stringify(NAME)})`, ctx), 'สธ 0208.02/ว10440');
});
