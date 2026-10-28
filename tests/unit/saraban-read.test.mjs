// v1.15 — a long letter is read from its first 3 pages only: cut the PDF, cap the converter, stop OCR early.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

vm.runInThisContext(fs.readFileSync(new URL('../../src/js/vendor/pdf-lib.min.js', import.meta.url), 'utf8'));
globalThis.DOMMatrix = globalThis.DOMMatrix || class { constructor() { Object.assign(this, { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }); } multiplySelf() { return this; } preMultiplySelf() { return this; } translateSelf() { return this; } scaleSelf() { return this; } invertSelf() { return this; } };
globalThis.Path2D = globalThis.Path2D || class {};
globalThis.ImageData = globalThis.ImageData || class {};

const { firstPages } = await import('../../src/js/modules/pdf/engine.js');
const { convertPdf } = await import('../../src/js/modules/converters/pdf.js');
const { ocrEnough } = await import('../../src/js/modules/converters/ocr.js');

async function makePdf(pages) {
  const lib = globalThis.PDFLib; const doc = await lib.PDFDocument.create(); const font = await doc.embedFont(lib.StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i += 1) doc.addPage([595, 842]).drawText(`Page ${i} hello world`, { x: 50, y: 700, font, size: 14 });
  return doc.save();
}
const pageNos = (md) => (md.match(/Page (\d+)/g) || []).map((x) => Number(x.slice(5)));

test('firstPages: a 24-page file becomes a 3-page file, a short file is returned untouched', async () => {
  const big = new File([await makePdf(24)], 'letter.pdf', { type: 'application/pdf' });
  const r = await firstPages(big, 3);
  assert.equal(r.total, 24); assert.equal(r.trimmed, true); assert.ok(r.file.size < big.size);
  assert.equal((await globalThis.PDFLib.PDFDocument.load(new Uint8Array(await r.file.arrayBuffer()))).getPageCount(), 3);
  const again = await firstPages(r.file, 3); assert.equal(again.trimmed, false); assert.equal(again.file, r.file);
});
test('firstPages: a broken file throws (the caller then falls back to the whole file with maxPages)', async () => {
  await assert.rejects(() => firstPages(new File([new Uint8Array([1, 2, 3, 4])], 'x.pdf', { type: 'application/pdf' }), 3));
});
test('convertPdf maxPages: only the first pages are extracted; without it every page is', async () => {
  const bytes = await makePdf(24); const buf = () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const capped = await convertPdf(buf(), { ocr: false, maxPages: 3 });
  assert.deepEqual(pageNos(capped.markdown), [1, 2, 3]);
  assert.ok(!capped.warnings.some((w) => /แปลงเฉพาะ/.test(w)));
  assert.equal(pageNos((await convertPdf(buf(), { ocr: false })).markdown).length, 24);
});
test('ocrEnough: stops only when more pages wait AND enough() is satisfied; a throwing enough() never stops OCR', () => {
  const chunks = new Map([[0, 'หน้าแรก']]);
  assert.equal(ocrEnough({}, chunks, 0, 3), false);
  assert.equal(ocrEnough({ enough: () => true }, chunks, 0, 3), true);
  assert.equal(ocrEnough({ enough: () => false }, chunks, 0, 3), false);
  assert.equal(ocrEnough({ enough: () => true }, chunks, 2, 3), false);
  assert.equal(ocrEnough({ enough: () => { throw new Error('x'); } }, chunks, 0, 3), false);
  let seen = ''; ocrEnough({ enough: (t) => { seen = t; return true; } }, new Map([[0, 'A'], [1, 'B']]), 1, 3); assert.equal(seen, 'A\n\nB');
});
