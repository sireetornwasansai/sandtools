// site-deco.js (floating 3D numbers, base plates, people) + the new "eval" theme of site-engine.js. A recording fake canvas context — no browser needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mix, eased, _resetEase, drawNumber, drawPlate, drawFigure, ROLE_LOOK, KIND_LOOK, HOSPITAL_NAME } from '../../src/js/modules/site-deco.js';
import { themeOf, THEMES, groupOf, HOSP_GROUPS } from '../../src/js/modules/site-engine.js';

function fakeCtx() {
  const log = []; const texts = [];
  const ctx = new Proxy({ font: '700 12px sans-serif' }, {
    get(t, k) {
      if (k === 'log') return log; if (k === 'texts') return texts;
      if (k in t) return t[k];
      if (k === 'measureText') return (s) => ({ width: String(s).length * (parseFloat(/(\d+(\.\d+)?)px/.exec(t.font)?.[1] || '12')) * 0.55 });
      if (k === 'createLinearGradient') return () => ({ addColorStop() {} });
      return (...a) => { log.push(k); if (k === 'fillText' || k === 'strokeText') texts.push({ op: k, text: a[0], font: t.font }); };
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  return ctx;
}
const kit = (over = {}) => { const ctx = fakeCtx(); return { ctx, pal: { wk: 1, pill: 'rgba(255,255,255,.95)', ink: '#1f2937' }, font: 'sans-serif', tw: 60, camZ: 1, width: 900, reduced: false, clampX: true, ...over }; };
const count = (g, k) => g.ctx.log.filter((x) => x === k).length;
const said = (g) => g.ctx.texts.filter((t) => t.op === 'fillText').map((t) => t.text);

test('mix: lighter / darker hex colours; anything else is returned untouched', () => {
  assert.equal(mix('#808080', 1), '#808080'); assert.equal(mix('#ffffff', 0.5), '#808080'); assert.equal(mix('#000000', 1.5), '#808080'); assert.equal(mix('rgb(1,2,3)', 0.5), 'rgb(1,2,3)');
});

test('eased: counts up from 0 to the target and stops exactly on it; reduced motion shows the target at once', () => {
  _resetEase(); const seen = []; for (let t = 0; t <= 1500; t += 16) seen.push(eased('a', 1000, t, false));
  assert.equal(seen[0], 0); assert.ok(seen[5] > seen[1] && seen[5] < 1000); assert.equal(seen.at(-1), 1000); assert.ok(seen.every((v, i) => i === 0 || v >= seen[i - 1]));
  assert.equal(eased('b', 55, 0, true), 55); assert.equal(eased('b', 70, 10, true), 70);
  assert.equal(eased('a', 1200, 1600, false) > 1000, true, 'a changed value runs up, it does not jump');
});

test('number: Thai grouping, ≈ prefix, captions (unit / online) — no white tab', () => {
  _resetEase(); const g = kit({ reduced: true });
  drawNumber(g, { key: 'k', x: 300, y: 200, fx: 300, fy: 260, value: 1234567, approx: true, unit: 'ครั้ง', online: 3, col: '#3758f9' }, 0);
  const t = said(g); assert.ok(t.includes('≈1,234,567'), t.join('|')); assert.ok(t.includes('ครั้ง')); assert.ok(t.includes('ออนไลน์ 3'));
  assert.ok(count(g, 'fillText') >= 8, 'extruded: the digits are drawn in several layers');
  const g2 = kit({ reduced: true }); drawNumber(g2, { key: 'q', x: 300, y: 200, fx: 300, fy: 260, value: 0, approx: false, unit: 'ครั้ง', online: 0, col: '#16a34a' }, 0);
  assert.ok(said(g2).includes('0') && !said(g2).some((x) => x.startsWith('ออนไลน์')), 'zero is a number, and no "online" caption when nobody is online');
});

test('number: a station without data shows its status word instead of a number; very long numbers shrink to fit', () => {
  _resetEase(); const g = kit({ reduced: true });
  drawNumber(g, { key: 's', x: 300, y: 200, fx: 300, fy: 260, value: null, text: 'เงียบผิดปกติ', col: '#ef4444' }, 0); assert.ok(said(g).includes('เงียบผิดปกติ')); assert.ok(!said(g).includes('ครั้ง'));
  const px = (s) => Number(/(\d+(\.\d+)?)px/.exec(s)[1]);
  const a = kit({ reduced: true }); drawNumber(a, { key: 'n1', x: 300, y: 200, fx: 300, fy: 260, value: 12, col: '#3758f9' }, 0);
  const b = kit({ reduced: true }); drawNumber(b, { key: 'n2', x: 300, y: 200, fx: 300, fy: 260, value: 123456789012, col: '#3758f9' }, 0);
  const big = (g) => Math.max(...g.ctx.texts.map((t) => px(t.font)));
  assert.ok(big(b) < big(a), 'longer text, smaller font');
});

test('plate: shows the system name AND the hospital; long names shrink; hover is drawn', () => {
  const g = kit(); drawPlate(g, { x: 200, y: 300, name: '🚑 ระบบยานพาหนะ (SAND)', col: '#3758f9' });
  assert.deepEqual(said(g), ['🚑 ระบบยานพาหนะ (SAND)', HOSPITAL_NAME]); assert.equal(HOSPITAL_NAME, 'โรงพยาบาลสันทราย');
  const px = (s) => Number(/(\d+(\.\d+)?)px/.exec(s)[1]);
  const long = kit(); drawPlate(long, { x: 200, y: 300, name: 'ระบบ'.repeat(30), col: '#3758f9' }); assert.ok(px(long.ctx.texts[0].font) < px(g.ctx.texts[0].font), 'shrinks to fit');
  const custom = kit(); drawPlate(custom, { x: 200, y: 300, name: 'หน้าแรก', sub: 'ระบบ X · โรงพยาบาลสันทราย', col: '#3758f9' }); assert.equal(said(custom)[1], 'ระบบ X · โรงพยาบาลสันทราย');
  const none = kit(); drawPlate(none, { x: 200, y: 300, name: 'x', sub: '', col: '#3758f9' }); assert.deepEqual(said(none), ['x'], 'sub can be switched off');
});

test('figure: head, torso, two arms and two legs for every role and kind, walking or standing, at every size', () => {
  const looks = [...Object.keys(ROLE_LOOK).map((r) => ({ role: r })), ...Object.keys(KIND_LOOK).map((k) => ({ kind: k })), {}];
  for (const lk of looks) for (const walk of [true, false]) for (const s of [1.2, 3, 7]) for (const seed of [0, 1, 2, 3, 7]) {
    const g = kit(); assert.doesNotThrow(() => drawFigure(g, { sx: 100, sy: 100, s, now: 1234, walk, seed, col: '#3758f9', back: seed === 3, dot: lk.role ? '#7c3aed' : '', ...lk }), JSON.stringify([lk, walk, s, seed]));
    assert.ok(count(g, 'arc') >= 1, 'a head');
    if (s >= 1.9) assert.ok(count(g, 'stroke') >= 4, `4 limbs (${JSON.stringify(lk)} s=${s})`);   // two legs + two arms are stroked capsules
  }
  const tiny = kit(); drawFigure(tiny, { sx: 0, sy: 0, s: 1.2, now: 0, seed: 0, col: '#3758f9' }); assert.equal(count(tiny, 'stroke'), 0, 'tiny figures use the cheap capsule');
});

test('figure: the outfit follows the role (colour of the top) and the legs really swing while walking', () => {
  const fills = (o) => { const g = kit(); const seen = []; const set = Object.getOwnPropertyDescriptor; drawFigure(g, { sx: 0, sy: 0, s: 5, now: 0, seed: 0, col: '#abcdef', ...o }); return g; };
  const fillsOf = (o) => { const log = []; const g = kit(); const ctx = g.ctx; const orig = ctx; g.ctx = new Proxy(orig, { set(t, k, v) { if (k === 'fillStyle') log.push(v); t[k] = v; return true; }, get(t, k) { return t[k]; } }); drawFigure(g, { sx: 0, sy: 0, s: 5, now: 0, seed: 0, col: '#abcdef', ...o }); return log; };
  assert.ok(fillsOf({ role: 'admin' }).includes('#7c3aed')); assert.ok(fillsOf({ role: 'head' }).includes('#ea580c')); assert.ok(fillsOf({ role: 'officer' }).includes('#0891b2')); assert.ok(fillsOf({ role: 'committee' }).includes('#16a34a'));
  assert.ok(fillsOf({ role: 'researcher' }).includes('#f8fafc'), 'white lab coat'); assert.ok(fillsOf({ role: 'user' }).includes('#94a3b8'));
  assert.ok(fillsOf({ role: '' }).includes('#abcdef'), 'no role = the colour of the room'); assert.ok(fillsOf({ kind: 'worker' }).includes('#facc15'), 'hard hat');
  const legX = (now) => { const xs = []; const g = kit(); const c = g.ctx; g.ctx = new Proxy(c, { get(t, k) { if (k === 'lineTo') return (x) => { xs.push(Math.round(x * 100)); }; return t[k]; }, set(t, k, v) { t[k] = v; return true; } }); drawFigure(g, { sx: 0, sy: 0, s: 5, now, walk: true, seed: 0, col: '#fff' }); return xs.join(','); };
  assert.notEqual(legX(0), legX(300), 'a walking figure changes pose over time');
  const still = (now) => { const g = kit({ reduced: true }); drawFigure(g, { sx: 0, sy: 0, s: 5, now, walk: true, seed: 0, col: '#fff' }); return g.ctx.log.join(); };
  assert.equal(still(0), still(999), 'reduced motion: no swinging');
});

test('eval theme: ติดตามประเมินผลงาน / ยื่น อวช. gets its own model, without taking over the old themes', () => {
  assert.ok(THEMES.eval && THEMES.eval.icon && THEMES.eval.label);
  const t = (name, extra = {}) => themeOf({ name, url: 'https://x.example/', key: name, tags: [], ...extra });
  assert.equal(t('ระบบติดตามประเมินผลงาน'), 'eval'); assert.equal(t('ยื่น อวช'), 'eval'); assert.equal(t('ติดตามผลงาน บุคลากร'), 'eval', 'wins over the generic HR words'); assert.equal(t('x', { url: 'https://portfolio.example.go.th/' }), 'eval', 'the web address is searched too');
  assert.equal(t('anything', { tags: ['theme:eval'] }), 'eval');
  assert.equal(t('ระบบยานพาหนะ'), 'ems'); assert.equal(t('HRD อบรม'), 'hrd'); assert.equal(t('ระบบวัคซีน'), 'vaccine'); assert.equal(t('จริยธรรมการวิจัย'), 'ec'); assert.equal(t('แผนงาน KPI'), 'plan'); assert.equal(t('เว็บทั่วไป'), 'web');
  assert.equal(groupOf({ tags: [] }, 'eval'), 'quality'); assert.ok(HOSP_GROUPS.find((g) => g.id === 'quality').themes.includes('eval'));
});
