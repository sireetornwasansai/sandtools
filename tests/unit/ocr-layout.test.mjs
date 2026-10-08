import test from 'node:test'; import assert from 'node:assert/strict';
import { normalizeThai, layoutToMarkdown, wordsFromTesseract, tesseractToMarkdown } from '../../src/js/modules/converters/ocr-layout.js';

// Synthetic page geometry modelled on a 300-dpi A4 scan of a Thai hospital order (text height ≈ 55 px, page width 2480 px).
const H = 55, PAGE_W = 2480;
const word = (text, x0, yc, conf = 92) => ({ text, bbox: { x0, y0: yc - H / 2, x1: x0 + [...text].length * 30, y1: yc + H / 2 }, confidence: conf });
const row = (yc, ...cells) => cells.flatMap(([x, ...texts]) => { let cx = x; return texts.map((t) => { const w = word(t, cx, yc); cx = w.bbox.x1 + 22; return w; }); });

test('normalizeThai: sara am, spaces before combining marks, control codes', () => {
  assert.equal(normalizeThai('คํา'), 'คำ');                       // nikhahit + sara aa → sara am
  assert.equal(normalizeThai('น้ํา'), 'น้ำ');                      // nikhahit + tone + sara aa → tone + sara am
  assert.equal(normalizeThai('ที่  ปรึกษา'), 'ที่ ปรึกษา');         // real spaces between words are kept (collapsed)
  assert.equal(normalizeThai('ก ้า'), 'ก้า');                      // stray space before a tone mark
  assert.equal(normalizeThai('a\u0000b\u0007'), 'ab');
});

test('wordsFromTesseract reads v7 blocks, v5 lines and drops boxless/empty words', () => {
  const w = (t) => ({ text: t, bbox: { x0: 1, y0: 2, x1: 30, y1: 40 }, confidence: 80 });
  assert.equal(wordsFromTesseract({ blocks: [{ paragraphs: [{ lines: [{ words: [w('ก'), w(' '), { text: 'x' }] }] }] }] }).length, 1);
  assert.equal(wordsFromTesseract({ lines: [{ words: [w('ก'), w('ข')] }] }).length, 2);
  assert.equal(wordsFromTesseract(null).length, 0);
});

test('layout: letter with centred title, indented paragraph, wide-gap line and two tables', () => {
  const words = [
    ...row(300, [900, 'คำสั่งโรงพยาบาลเชียงราย']),                                   // centred title
    ...row(380, [1180, 'ที่', '๑๓๐/๒๕๖๔']),                                          // centred short line
    ...row(520, [300, 'เรื่อง', 'แต่งตั้งคณะกรรมการบริหารห้องพิเศษ']),
    ...row(700, [420, 'ตามที่ประชุมผู้บริหาร', 'มีมติให้แต่งตั้ง']),                  // indented first line
    ...row(765, [300, 'คณะกรรมการบริหารห้องพิเศษ', 'จึงแต่งตั้งผู้มีรายนาม']),
    ...row(900, [300, 'ที่ปรึกษา']),
    ...row(970, [300, '๑.', 'นายสำเริง'], [900, 'สีแก้ว'], [1450, 'รองผู้อำนวยการ']),
    ...row(1035, [300, '๒.', 'นางวิราวรรณ'], [900, 'เมืองอินทร์'], [1450, 'รองผู้อำนวยการฝ่ายการพยาบาล']),
    ...row(1100, [300, '๓.', 'นางสาวดลฤดี'], [900, 'ขุมภูรัตน์'], [1450, 'ทันตแพทย์ชำนาญการ']),
    ...row(1240, [300, 'คณะกรรมการ']),
    ...row(1310, [300, '๑.', 'นายนัฐวุฒิ'], [900, 'วิวรรธนวรางค์'], [1450, 'นายแพทย์'], [2050, 'ประธานกรรมการ']),
    ...row(1375, [300, '๒.', 'นางวรางคณา'], [900, 'ธุวะคำ'], [1450, 'พยาบาลวิชาชีพ'], [2050, 'รองประธาน']),
    ...row(1440, [300, '๓.', 'หัวหน้ากลุ่มงานโภชนศาสตร์'], [2050, 'กรรมการ']),         // text spans two columns
    ...row(1505, [300, '๔.', 'นายบุญหนา'], [900, 'ก้างยาง'], [1450, 'เจ้าพนักงานธุรการ'], [2050, 'กรรมการ'])
  ];
  const r = layoutToMarkdown(words, { width: PAGE_W });
  const lines = r.markdown.split('\n');
  assert.ok(r.confidence >= 90);
  assert.ok(lines.includes('คำสั่งโรงพยาบาลเชียงราย') && lines.includes('ที่ ๑๓๐/๒๕๖๔'), 'title lines stay plain text');
  // wide gap inside "ที่ ๑๓๐" must not create a table
  assert.ok(!/\|.*ที่.*\|/.test(r.markdown.split('\n').find((l) => l.includes('ที่ ๑๓๐')) || ''));
  // the two-line paragraph is one paragraph (indent only on its first line), the letter body is separate from the title
  const para = r.markdown.split('\n\n').find((p) => p.startsWith('ตามที่ประชุม'));
  assert.ok(para && para.includes('\n') && para.includes('จึงแต่งตั้ง'), 'wrapped lines stay together');
  // table 1: 3 columns, 3 rows
  assert.ok(lines.includes('| ๑. นายสำเริง | สีแก้ว | รองผู้อำนวยการ |'));
  assert.ok(lines.includes('| ๓. นางสาวดลฤดี | ขุมภูรัตน์ | ทันตแพทย์ชำนาญการ |'));
  // table 2: 4 columns; the row whose text spans columns 0–2 puts its role in the last column
  assert.ok(lines.includes('| ๑. นายนัฐวุฒิ | วิวรรธนวรางค์ | นายแพทย์ | ประธานกรรมการ |'));
  assert.ok(lines.includes('| ๓. หัวหน้ากลุ่มงานโภชนศาสตร์ |  |  | กรรมการ |'));
  assert.ok(lines.includes('| ๔. นายบุญหนา | ก้างยาง | เจ้าพนักงานธุรการ | กรรมการ |'));
  // an (empty) header + separator is emitted before each table, section titles stay as text between them
  assert.equal(lines.filter((l) => /^\| --- /.test(l)).length, 2);
  assert.ok(lines.includes('ที่ปรึกษา') && lines.includes('คณะกรรมการ'));
});

test('layout: Tesseract reading a table column-by-column is still rebuilt row by row', () => {
  const col = (x, texts) => ({ paragraphs: [{ lines: texts.map((t, i) => ({ words: [word(t, x, 400 + i * 65)] })) }] });
  const data = { blocks: [col(300, ['ก1', 'ก2', 'ก3']), col(900, ['ข1', 'ข2', 'ข3']), col(1500, ['ค1', 'ค2', 'ค3'])] };
  const r = tesseractToMarkdown(data, { width: PAGE_W });
  assert.ok(r.markdown.includes('| ก2 | ข2 | ค2 |'), r.markdown);
});

test('layout: noise, empty input and a lone scrap of text', () => {
  assert.deepEqual(layoutToMarkdown([]).markdown, '');
  assert.equal(layoutToMarkdown([word('«', 100, 100, 20)]).markdown, '');
  assert.equal(layoutToMarkdown([word('สวัสดี', 100, 100)]).markdown, 'สวัสดี');
});
