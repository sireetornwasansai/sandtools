import test from 'node:test';
import assert from 'node:assert/strict';
import { toGray, flattenIllumination, stretchContrast, estimateSkew, rotate, preprocess, textBandHeight, isBilevel, otsu } from '../../src/js/modules/converters/ocr-preprocess.js';

/** A fake page: white paper, dark horizontal "text lines" (bands of ink), optional lighting gradient. */
function page(w, h, { band = 14, gap = 22, shade = 0, tilt = 0 } = {}) {
  const d = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const yy = y + Math.round(Math.tan((tilt * Math.PI) / 180) * (x - w / 2));
    const inLine = yy >= 40 && yy < h - 40 && x > 60 && x < w - 60 && (yy - 40) % (band + gap) < band && ((x * 7) % 13) < 9;
    const paper = 235 * (1 - shade * (x / w));
    d[y * w + x] = inLine ? 30 : paper;
  }
  return { w, h, d };
}
const mean = (p, f) => { let s = 0, n = 0; for (let i = 0; i < p.d.length; i += 1) if (f(i)) { s += p.d[i]; n += 1; } return s / n; };

test('flatten + stretch: shaded paper becomes uniformly white, ink stays dark', () => {
  const p = page(600, 800, { shade: 0.4 });
  const left = mean(p, (i) => i % 600 < 40 && p.d[i] > 100), right = mean(p, (i) => i % 600 > 560 && p.d[i] > 100);
  assert.ok(left - right > 60, 'input is unevenly lit');
  const q = stretchContrast(flattenIllumination(p));
  const l2 = mean(q, (i) => i % 600 < 40 && q.d[i] > 100), r2 = mean(q, (i) => i % 600 > 560 && q.d[i] > 100);
  assert.ok(Math.abs(l2 - r2) < 12, `paper level evened out (${l2} vs ${r2})`);
  assert.ok(mean(q, (i) => p.d[i] === 30) < 80, 'ink still dark');
});

test('deskew: finds a 2° tilt and straightens it; level pages are left alone', () => {
  const t = page(700, 900, { tilt: 2 });
  const a = estimateSkew(t); assert.ok(Math.abs(Math.abs(a) - 2) <= 0.75, `skew ${a}`);
  const fixed = rotate(t, a); assert.ok(Math.abs(estimateSkew(fixed)) < 0.75);
  assert.equal(estimateSkew(page(700, 900)), 0);
});

test('scale: small photo is enlarged until the text band is OCR-sized; big scans are not touched', () => {
  const small = page(620, 877, { band: 22, gap: 30 });
  const band0 = textBandHeight(small); assert.ok(band0 >= 20 && band0 <= 24);
  const r = preprocess(small); assert.ok(r.scaled > 2.5 && r.steps.includes('scale'));
  assert.ok(Math.abs(textBandHeight(r.plane) - 70) < 14, `band ${textBandHeight(r.plane)}`);
  const big = page(2480, 3508, { band: 72, gap: 40 }); const r2 = preprocess(big, { deskew: false }); assert.equal(r2.scaled, 1);
});

test('safe on tiny / blank input', () => {
  assert.equal(preprocess({ w: 10, h: 10, d: new Uint8ClampedArray(100) }).steps.length, 0);
  const blank = { w: 200, h: 200, d: new Uint8ClampedArray(40000).fill(255) }; const r = preprocess(blank); assert.equal(r.plane.w >= 200, true);
  assert.equal(isBilevel(blank), true); assert.equal(typeof otsu(blank), 'number');
  assert.equal(toGray(new Uint8ClampedArray([255, 0, 0, 0]), 1, 1).d[0], 255, 'transparent = white');
});
