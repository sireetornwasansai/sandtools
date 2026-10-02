import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPdf } from '../../src/js/modules/shrink-docs.js';

test('buildPdf writes a valid structure with correct xref offsets', async () => {
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const buf = Buffer.from(await buildPdf([{ w: 595, h: 842, pw: 10, ph: 10, jpg }, { w: 300, h: 300, pw: 5, ph: 5, jpg }]).arrayBuffer());
  const txt = buf.toString('latin1');
  assert.ok(txt.startsWith('%PDF-1.4') && txt.trimEnd().endsWith('%%EOF'));
  assert.match(txt, /\/Count 2/);
  const xref = Number(/startxref\n(\d+)/.exec(txt)[1]);
  assert.equal(txt.slice(xref, xref + 4), 'xref');
  const first = Number(/xref\n0 \d+\n0000000000 65535 f \n(\d{10})/.exec(txt)[1]);
  assert.equal(txt.slice(first, first + 7), '1 0 obj');
});
