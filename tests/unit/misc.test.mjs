import test from 'node:test'; import assert from 'node:assert/strict';
import { buildConfig, configJs } from '../../scripts/config-gen.mjs';
import { searchTools, parseHash, findRoute, TOOLS } from '../../src/js/core/routes.js';
import { parseCsv, detectDelimiter, convertCsv } from '../../src/js/modules/converters/csv.js';
import { mdTable, mdCell, resolvePath } from '../../src/js/modules/converters/common.js';
import { colIndex, serialToString } from '../../src/js/modules/converters/xlsx.js';
import { itemsToLines } from '../../src/js/modules/converters/pdf.js';
import { withExt, safeFileName, extOf, decodeText } from '../../src/js/core/download.js';
import { routeForFile } from '../../src/js/core/handoff.js';
import { PRIVACY_SENTENCE } from '../../src/js/core/notices.js';

test('config: only public keys, defaults, booleans and numbers parsed', () => {
  const c = buildConfig({ SAND_GAS_URL: ' https://script.google.com/x/exec ', SAND_REQUIRE_LOGIN: 'TRUE', SAND_MAX_FILE_SIZE_MB: 'abc', GOOGLE_CLIENT_SECRET: 'nope', SESSION_SECRET: 'nope' }, '1.2.3');
  assert.equal(c.gasUrl, 'https://script.google.com/x/exec'); assert.equal(c.requireLogin, true); assert.equal(c.maxFileSizeMB, 25); assert.equal(c.version, '1.2.3');
  const js = configJs({ GOOGLE_CLIENT_SECRET: 'topsecret', SESSION_SECRET: 'x', ALLOWED_EMAIL_DOMAIN: 'secret.go.th' }, 'v'); assert.ok(!js.includes('topsecret') && !js.includes('secret.go.th'));
});
test('tool search: Thai + English keywords per the spec', () => {
  assert.equal(searchTools('PDF')[0].id, 'pdf'); assert.ok(searchTools('PDF').some((t) => t.id === 'converter')); assert.equal(searchTools('QR')[0].id, 'qr'); 
  assert.deepEqual(searchTools('zzzzqq'), []); assert.ok(searchTools('').length >= TOOLS.length);
});
test('routing helpers', () => {
  const r = parseHash('#/qr?doc=abc'); assert.equal(r.path, '/qr'); assert.equal(r.params.get('doc'), 'abc'); assert.equal(parseHash('').path, '/'); assert.equal(findRoute('/nope'), null);
  assert.equal(routeForFile('a.pdf'), '/converter'); assert.equal(routeForFile('a.jpeg'), null); assert.equal(routeForFile('a.md'), null); assert.equal(routeForFile('a.exe'), null);
});
test('csv parsing: quotes, embedded newline, delimiter detection, BOM-free', () => {
  assert.deepEqual(parseCsv('a,b\n"x, y","l1\nl2"\n').rows, [['a', 'b'], ['x, y', 'l1\nl2']]); assert.equal(detectDelimiter('a;b;c\n1;2;3'), ';'); assert.equal(detectDelimiter('a\tb\n1\t2'), '\t');
  assert.deepEqual(parseCsv('a,"he said ""hi"""\r\n').rows, [['a', 'he said "hi"']]); assert.equal(convertCsv('').markdown, ''); assert.equal(convertCsv('a,b\n1,2').markdown, '| a | b |\n| --- | --- |\n| 1 | 2 |\n');
});
test('markdown table helpers', () => { assert.equal(mdCell('a|b\nc'), 'a\\|b<br>c'); assert.equal(mdTable([['h'], ['1', '2']]), '| h |  |\n| --- | --- |\n| 1 | 2 |'); assert.equal(mdTable([]), ''); assert.equal(resolvePath('word/document.xml', '../media/a.png'), 'media/a.png'); assert.equal(resolvePath('ppt/presentation.xml', 'slides/s1.xml'), 'ppt/slides/s1.xml'); });
test('xlsx helpers', () => { assert.equal(colIndex('A1'), 0); assert.equal(colIndex('AB12'), 27); assert.equal(serialToString(45658, false), '2025-01-01'); assert.equal(serialToString(45658.5, false), '2025-01-01 12:00:00'); });
test('pdf line grouping & spacing', () => {
  const mk = (str, x, y, w = 30) => ({ str, transform: [10, 0, 0, 10, x, y], width: w, height: 10 });
  const lines = itemsToLines([mk('World', 50, 700), mk('Hello', 10, 700), mk('Next', 10, 680)]);
  assert.deepEqual(lines.map((l) => l.text), ['Hello World', 'Next']);
});
test('file name helpers keep Thai base names', () => {
  assert.equal(withExt('รายงาน.docx', 'md'), 'รายงาน.md'); assert.equal(withExt('a.b.pdf', '.md'), 'a.b.md'); assert.equal(safeFileName('../../etc/pa:ss*wd'), '.._.._etc_pa_ss_wd'.replace(/^\.+/, '')); assert.equal(safeFileName(''), 'document'); assert.equal(extOf('X.PDF'), 'pdf');
});
test('decodeText: UTF-8, BOM, UTF-16, and Thai TIS-620 fallback', () => {
  assert.equal(decodeText(new TextEncoder().encode('\uFEFFสวัสดี').buffer), 'สวัสดี'); assert.equal(decodeText(Uint8Array.from([0xca, 0xc7, 0xd1, 0xca, 0xb4, 0xd5]).buffer), 'สวัสดี');
  assert.equal(decodeText(Uint8Array.from([0xff, 0xfe, 0x41, 0x00]).buffer), 'A');
});
test('mandatory healthcare privacy sentence is exact', () => { assert.equal(PRIVACY_SENTENCE, 'หลีกเลี่ยงการอัปโหลดข้อมูลผู้ป่วยหรือข้อมูลสุขภาพที่สามารถระบุตัวบุคคลได้ หากระบบไม่ได้รับการอนุมัติให้ใช้กับข้อมูลดังกล่าว'); });
