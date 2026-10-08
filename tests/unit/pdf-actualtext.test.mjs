import test from 'node:test'; import assert from 'node:assert/strict';
import { scanMarkedContent, applyActualText, normalizeThai, decodePdfTextString } from '../../src/js/modules/converters/pdf-actualtext.js';

const enc = (s) => new TextEncoder().encode(s);
const hex16 = (s) => 'FEFF' + [...s].map((c) => c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')).join('');

test('decodePdfTextString: UTF-16BE with BOM, UTF-8 BOM, Latin-1', () => {
  assert.equal(decodePdfTextString(Uint8Array.from([0xfe, 0xff, 0x0e, 0x1c, 0x0e, 0x39, 0x0e, 0x49])), 'ผู้');
  assert.equal(decodePdfTextString(Uint8Array.from([0xef, 0xbb, 0xbf, 0xe0, 0xb8, 0x81])), 'ก');
  assert.equal(decodePdfTextString(Uint8Array.from([0x41, 0x42])), 'AB');
});

test('scanMarkedContent: lists BDC in order with ActualText (hex and literal), ignores BMC and text strings that look like operators', () => {
  const stream = enc(`BT /F1 12 Tf (BDC /ActualText (x)) Tj ET
/Span <</ActualText <${hex16('ผู้')}> >> BDC <01> Tj EMC
/Artifact BMC EMC
/P <</MCID 0>> BDC EMC
/Span<</Lang (th)/ActualText (abc\\051d)>> BDC EMC
/OC /MC0 BDC EMC`);
  assert.deepEqual(scanMarkedContent(stream), ['ผู้', null, 'abc)d', null]);
});

test('scanMarkedContent: skips inline image data and comments', () => {
  const stream = Buffer.concat([enc('q BI /W 1 /H 1 ID '), Buffer.from([0x42, 0x44, 0x43, 0x20]), enc(' EI Q % /ActualText (no) BDC\n/Span <</ActualText (ok)>> BDC EMC')]);
  assert.deepEqual(scanMarkedContent(stream), ['ok']);
});

const it = (str, x, w = 5) => ({ str, dir: 'ltr', transform: [10, 0, 0, 10, x, 100], width: w, height: 10, fontName: 'f' });
const begin = (props = true) => ({ type: props ? 'beginMarkedContentProps' : 'beginMarkedContent', tag: 'Span', id: null });
const end = { type: 'endMarkedContent' };

test('applyActualText: glyph runs inside the span are replaced by ActualText, spaces are kept, width covers the run', () => {
  const items = [it('15', 0, 10), begin(), it(' ', 10, 4), it('กั', 14, 5), end, it('น', 19, 5)];
  const r = applyActualText(items, ['กั']);
  assert.equal(r.ok, true); assert.equal(r.replaced, 1);
  assert.deepEqual(r.items.map((x) => x.str), ['15', ' ', 'กั', 'น']);
  assert.equal(r.items[2].transform[4], 14); assert.equal(r.items[2].width, 5);
});

test('applyActualText: tone marks the font could not map come back (ผู → ผู้)', () => {
  const items = [begin(), it('ผู', 0, 10), end, begin(), it('ไ', 10), it('ม', 15), end];
  const r = applyActualText(items, ['ผู้', 'ไม่']);
  assert.deepEqual(r.items.map((x) => x.str), ['ผู้', 'ไม่']);
});

test('applyActualText: spans without ActualText and BMC blocks are left alone; nested spans collapse into the outer ActualText', () => {
  const items = [begin(false), it('a', 0), end, begin(), begin(), it('x', 5), end, it('y', 10), end, begin(), it('b', 15), end];
  const r = applyActualText(items, ['XY', null, null]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.items.map((x) => x.str), ['a', 'XY', 'b']);
});

test('applyActualText: refuses when pdf.js and the content-stream scan disagree', () => {
  const items = [begin(), it('ก', 0), end];
  assert.equal(applyActualText(items, ['ก', 'ข']).ok, false);
  assert.equal(applyActualText(items, []).ok, false);
});

test('normalizeThai: SARA AM recomposed, stray space before a mark removed, doubled tone mark collapsed', () => {
  assert.equal(normalizeThai('ส\u0e4d\u0e32หรับ'), 'สำหรับ');
  assert.equal(normalizeThai('ผู ้มี'), 'ผู้มี');
  assert.equal(normalizeThai('ไม่\u0e48จบ'), 'ไม่จบ');
  assert.equal(normalizeThai('a  b c'), 'a  b c');
});

test('normalizeThai: private-use tone marks (U+F70A/B/E …) become standard Thai, everything else is untouched', () => {
  assert.equal(normalizeThai('ผู\uf70bมี ไม\uf70aจบ สัปดาห\uf70e'), 'ผู้มี ไม่จบ สัปดาห์');
  assert.equal(normalizeThai('ก\uf710\uf70b'), 'กั้');
  assert.equal(normalizeThai('Hello ก ไทย'), 'Hello ก ไทย');
});
