import test from 'node:test'; import assert from 'node:assert/strict';
import { markdownToText, markdownTables } from '../../src/js/modules/converters/write-text.js';
import { writeCsv, writeJson, sheetNames, colName } from '../../src/js/modules/converters/write-sheets.js';
import { targetsFor, TARGETS } from '../../src/js/modules/converters/convert-to.js';

test('markdownToText: no markup, lists, tabs in tables, entities decoded', () => {
  const t = markdownToText('# หัวข้อ\n\nก & ข **หนา** `x<y`\n\n- a\n  - b\n1. x\n\n| h1 | h2 |\n|---|---|\n| 1 | 2 |\n');
  assert.ok(t.startsWith('หัวข้อ\n\nก & ข หนา x<y'));
  assert.ok(t.includes('- a\n  - b') && t.includes('1. x') && t.includes('h1\th2\n1\t2'));
  assert.ok(!/[*`#|]/.test(t));
});
test('markdownTables: name = nearest heading, otherwise "Table n"', () => {
  const r = markdownTables('## งบ\n\n| a | b |\n|--|--|\n| 1 | 2 |\n\n| c |\n|--|\n| 3 |\n');
  assert.deepEqual(r.map((x) => x.name), ['งบ', 'Table 2']); assert.deepEqual(r[0].rows, [['a', 'b'], ['1', '2']]);
});
test('writeCsv: UTF-8 BOM, quoting, CRLF', () => {
  const c = writeCsv([['ชื่อ', 'หมายเหตุ'], ['สมชาย', 'a,"b"\nc']]);
  assert.equal(c, '\uFEFFชื่อ,หมายเหตุ\r\nสมชาย,"a,""b""\nc"\r\n');
});
test('writeJson: header row becomes keys, numbers stay numbers, leading zeros stay text', () => {
  assert.deepEqual(JSON.parse(writeJson([{ name: 's', rows: [['ชื่อ', 'รหัส', 'อายุ'], ['ก', '007', '30']] }])), [{ ชื่อ: 'ก', รหัส: '007', อายุ: 30 }]);
  assert.deepEqual(JSON.parse(writeJson([{ name: 's', rows: [['a', 'a'], ['1', '2']] }])), [['a', 'a'], [1, 2]]);   // duplicate headers → arrays
});
test('Excel sheet names are legal and unique; column letters', () => {
  assert.deepEqual(sheetNames(['a/b', 'A/B', '', 'x'.repeat(40)]).map((n) => n.length <= 31 && !/[:\\/?*[\]]/.test(n)), [true, true, true, true]);
  assert.equal(new Set(sheetNames(['a', 'A'])).size, 2);
  assert.deepEqual([0, 25, 26, 701, 702].map(colName), ['A', 'Z', 'AA', 'ZZ', 'AAA']);
});
test('targetsFor: sensible choices per source, never its own format', () => {
  assert.ok(targetsFor('a.docx').includes('pdf') && !targetsFor('a.docx').includes('docx'));
  assert.ok(targetsFor('a.pdf').includes('docx') && targetsFor('a.pdf').includes('xlsx') && targetsFor('a.pdf').includes('png'));
  assert.ok(targetsFor('a.xlsx').includes('docx') && targetsFor('a.xlsx').includes('csv'));
  assert.ok(targetsFor('a.csv').includes('xlsx') && !targetsFor('a.csv').includes('csv'));
  assert.ok(targetsFor('a.JPG').includes('png') && !targetsFor('a.jpeg').includes('jpg'));
  assert.deepEqual(targetsFor('a.exe'), []);
  for (const f of ['pdf', 'docx', 'pptx', 'xlsx', 'csv', 'html', 'txt', 'md', 'png']) for (const t of targetsFor(`x.${f}`)) assert.ok(TARGETS[t], `${f}→${t}`);
});
