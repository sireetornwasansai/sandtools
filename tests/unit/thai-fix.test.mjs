// Thai tone-mark repair for PDFs whose fonts map positional variants to stray Latin letters (Word for Mac / Quartz + TH Sarabun).
import test from 'node:test';
import assert from 'node:assert/strict';
import { thaiGarbleScore, parseToUnicode, buildToUnicode, classifyMark } from '../../src/js/modules/converters/thai-fix.js';
import { MARK_SHAPES } from '../../src/js/modules/converters/thai-mark-shapes.js';

test('garble score flags Thai text with stray symbols between Thai letters', () => {
  assert.equal(thaiGarbleScore('ผูZวิจัย ล%างไต เปmน ปUจจัย ยZอนหลัง').garbled, true);
  assert.equal(thaiGarbleScore('ผู้วิจัย ล้างไต เป็น ปัจจัย ย้อนหลัง Clinical (PD) 2569').garbled, false);
  assert.equal(thaiGarbleScore('').garbled, false);
});

test('ToUnicode CMap round-trips', () => {
  const m = new Map([[0x21, 'ก'], [0x26, '\u0e48'], [0x41, 'A']]);
  const back = parseToUnicode(buildToUnicode(m));
  assert.deepEqual([...back.entries()], [...m.entries()]);
});

test('every reference mark classifies as itself', () => {
  const refs = MARK_SHAPES.map(([u, z, flat]) => { const p = []; for (let i = 0; i < flat.length; i += 2) p.push([flat[i], flat[i + 1]]); return { u, z, p }; });
  for (const r of refs) {
    const hit = classifyMark(r.p.map(([x, y]) => [x * 1000 + 50, y * 1000 + 700]), r.z, refs);   // translated + scaled copy
    assert.ok(hit && hit.u === r.u, `U+${r.u.toString(16)} → ${hit && hit.u.toString(16)}`);
  }
});
