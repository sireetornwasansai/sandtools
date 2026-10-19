// PDF → Word: font mapping (TH Sarabun New / TH SarabunPSK ...) and the layout writer's .docx output. No browser needed.
import test from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs';
import { classifyFont, chooseFont, stripSubset, DOCX_FONTS, FONT_CHOICES } from '../../src/js/modules/converters/docx-fonts.js';
import { writeDocx, docxPackage } from '../../src/js/modules/converters/write-docx.js';
import { writeDocxLayout, latinFamily } from '../../src/js/modules/converters/write-docx-layout.js';
import { encodePng } from '../../src/js/modules/converters/png.js';

// the vendored UMD build, loaded the way the browser does (as a plain script that sets a global)
(0, eval)(fs.readFileSync(new URL('../../src/js/vendor/jszip.min.js', import.meta.url), 'utf8'));
assert.equal(typeof globalThis.JSZip, 'function');

test('classifyFont: PDF PostScript names map back to the Word family name', () => {
  assert.equal(stripSubset('AAAAAA+THSarabunNew-Bold'), 'THSarabunNew-Bold');
  const a = classifyFont('AAAAAA+THSarabunNew-Bold'); assert.equal(a.font.family, 'TH Sarabun New'); assert.equal(a.bold, true);
  assert.equal(classifyFont('BAAAAA+THSarabunPSK').font.family, 'TH SarabunPSK');
  assert.equal(classifyFont('TH SarabunPSK,Bold').font.family, 'TH SarabunPSK');
  assert.equal(classifyFont('THSarabunNew-BoldItalic').italic, true);
  assert.equal(classifyFont('ABCDEF+THSarabun').font.id, 'THSarabunNew');          // plain "THSarabun" → New
  assert.equal(classifyFont('Tahoma-Bold').font.family, 'Tahoma');
  assert.equal(classifyFont('Helvetica').font, null);
});
test('chooseFont: auto follows the PDF (most characters), a chip overrides it, Tahoma when unknown', () => {
  const usage = { 'AAAAAA+THSarabunPSK': 900, 'AAAAAA+THSarabunNew': 50, 'Helvetica': 5000 };
  assert.equal(chooseFont('auto', usage).font.id, 'THSarabunPSK');
  const forced = chooseFont('THSarabunNew', usage); assert.equal(forced.font.id, 'THSarabunNew'); assert.equal(forced.detected.id, 'THSarabunPSK');
  assert.equal(chooseFont('auto', {}).font.id, 'Tahoma');
  assert.ok(FONT_CHOICES.every((k) => k === 'auto' || DOCX_FONTS[k]));
});
test('latinFamily: common Latin PDF fonts', () => {
  assert.equal(latinFamily('ABCDEF+TimesNewRomanPSMT'), 'Times New Roman'); assert.equal(latinFamily('Arial-BoldMT'), 'Arial'); assert.equal(latinFamily('Foo'), null);
});

const unzip = async (blob) => { const z = await globalThis.JSZip.loadAsync(await blob.arrayBuffer()); return { z, doc: await z.file('word/document.xml').async('string'), fonts: await z.file('word/fontTable.xml').async('string'), styles: await z.file('word/styles.xml').async('string') }; };

test('writeDocx (flow mode): font is a parameter; Thai complex-script slot and size are filled', async () => {
  const r = await writeDocx('# หัวข้อ\n\nข้อความภาษาไทย', { title: 't', font: DOCX_FONTS.THSarabunPSK });
  const { styles, fonts } = await unzip(r.blob);
  assert.ok(styles.includes('w:cs="TH SarabunPSK"') && styles.includes('w:ascii="TH SarabunPSK"'));
  assert.ok(styles.includes('<w:sz w:val="32"/><w:szCs w:val="32"/>'));            // 16 pt body
  assert.ok(fonts.includes('w:name="TH SarabunPSK"') && fonts.includes('w:val="Tahoma"'));   // Tahoma = fallback if font missing
  const d = await writeDocx('x', { title: 't' }); assert.ok((await unzip(d.blob)).styles.includes('w:ascii="Tahoma"'));   // default unchanged
});

const para = (text, over = {}) => ({ type: 'p', tokens: [{ text, fs: 16, font: 'AAAAAA+THSarabunNew', fid: 'THSarabunNew', b: false, i: false, u: false }], tabs: [], indL: 0, indR: 0, first: 28.3, jc: 'both', before: 0, pitch: 23.8, fs: 16, lines: 1, ...over });
const page = (blocks, images = []) => ({ width: 595.3, height: 841.9, margins: { l: 85, t: 68, r: 56, b: 50 }, blocks, images, dropped: 0 });

test('writeDocxLayout: one section per page, TH Sarabun by name with w:cs + w:szCs, bold/underline kept', async () => {
  const model = { ratio: 1, pages: [page([para('ด้วยกลุ่มงาน'), para('หัวข้อ', { tokens: [{ text: 'หัวข้อ', fs: 22, font: 'THSarabunNew-Bold', fid: 'THSarabunNew', b: true, i: false, u: true }], fs: 22, jc: 'center', first: 0 })]), page([para('หน้าสอง')])] };
  const w = await writeDocxLayout(model, { title: 't', fontChoice: 'auto', fontUsage: { 'AAAAAA+THSarabunNew': 100 } });
  assert.equal(w.font.family, 'TH Sarabun New'); assert.equal(w.pages, 2);
  const { doc, fonts } = await unzip(w.blob);
  assert.equal((doc.match(/<w:sectPr>/g) || []).length, 2);
  assert.ok(doc.includes('w:cs="TH Sarabun New"') && doc.includes('<w:szCs w:val="32"/>') && doc.includes('<w:szCs w:val="44"/>'));
  assert.ok(doc.includes('<w:b/><w:bCs/>') && doc.includes('<w:u w:val="single"/>') && doc.includes('<w:jc w:val="both"/>'));
  assert.ok(doc.includes('w:firstLine="566"'));
  assert.ok(fonts.includes('TH Sarabun New'));
});
test('writeDocxLayout: forcing TH SarabunPSK rewrites every run (even though the PDF used New)', async () => {
  const model = { ratio: 1, pages: [page([para('ทดสอบ')])] };
  const w = await writeDocxLayout(model, { fontChoice: 'THSarabunPSK', fontUsage: { 'AAAAAA+THSarabunNew': 10 } });
  assert.equal(w.font.family, 'TH SarabunPSK'); assert.equal(w.detected.id, 'THSarabunNew');
  const { doc } = await unzip(w.blob); assert.ok(doc.includes('w:ascii="TH SarabunPSK"') && !doc.includes('TH Sarabun New'));
});
test('writeDocxLayout: pictures are anchored at their PDF position, carried before the text of the page', async () => {
  const png = await encodePng({ width: 2, height: 2, channels: 3, data: Uint8Array.from({ length: 12 }, (_, i) => i * 20) });
  assert.deepEqual([...png.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const model = { ratio: 1, pages: [page([para('ข้อความ')], [{ x0: 85, y0: 40, x1: 140, y1: 95, bytes: png }])] };
  const w = await writeDocxLayout(model, { fontChoice: 'auto', fontUsage: {} });
  const { z, doc } = await unzip(w.blob);
  assert.equal(w.images, 1); assert.ok(z.file('word/media/image1.png'));
  assert.ok(doc.indexOf('<wp:anchor') < doc.indexOf('ข้อความ'));
  assert.ok(doc.includes('<wp:posOffset>1079500</wp:posOffset>'));     // 85 pt → EMU
});
test('docxPackage is exported for the layout writer', () => { assert.equal(typeof docxPackage, 'function'); });
