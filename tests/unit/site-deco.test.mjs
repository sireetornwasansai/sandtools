// site-deco.js (base plates, signs on posts, overlap placement, people) + the "eval" theme of site-engine.js. A recording fake canvas context — no browser needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mix, eased, _resetEase, layoutPlate, layoutSign, placeSigns, paintSigns, drawFigure, ROLE_LOOK, KIND_LOOK, HOSPITAL_NAME } from '../../src/js/modules/site-deco.js';
import { themeOf, THEMES, groupOf, HOSP_GROUPS } from '../../src/js/modules/site-engine.js';

function fakeCtx() {
  const log = []; const texts = [];
  return new Proxy({ font: '700 12px sans-serif' }, {
    get(t, k) {
      if (k === 'log') return log; if (k === 'texts') return texts; if (k in t) return t[k];
      if (k === 'measureText') return (s) => ({ width: String(s).length * (parseFloat(/(\d+(\.\d+)?)px/.exec(t.font)?.[1] || '12')) * 0.55 });
      if (k === 'createLinearGradient') return () => ({ addColorStop() {} });
      return (...a) => { log.push(k); if (k === 'fillText' || k === 'strokeText') texts.push({ op: k, text: a[0], font: t.font }); };
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}
const kit = (over = {}) => ({ ctx: fakeCtx(), pal: { wk: 1, pill: 'rgba(255,255,255,.95)', ink: '#1f2937', pillLine: '#cbd5e1' }, font: 'sans-serif', tw: 60, camZ: 1, width: 1200, reduced: true, clampX: true, dropWhenCrowded: true, obstacles: [], ...over });
const count = (g, k) => g.ctx.log.filter((x) => x === k).length;
const said = (g) => g.ctx.texts.filter((t) => t.op === 'fillText').map((t) => t.text);
const plateOf = (g, p, now = 0) => placeSigns(g, [layoutPlate(g, { key: 'k', x: 300, y: 300, name: '🚑 ระบบยานพาหนะ (SAND)', col: '#3758f9', value: 1234, approx: true, unit: 'ครั้ง', online: 3, ...p }, now)]);

test('mix: lighter / darker hex colours; anything else is returned untouched', () => {
  assert.equal(mix('#808080', 1), '#808080'); assert.equal(mix('#ffffff', 0.5), '#808080'); assert.equal(mix('#000000', 1.5), '#808080'); assert.equal(mix('rgb(1,2,3)', 0.5), 'rgb(1,2,3)');
});

test('eased: counts up from 0 to the target and stops exactly on it; reduced motion shows the target at once', () => {
  _resetEase(); const seen = []; for (let t = 0; t <= 1500; t += 16) seen.push(eased('a', 1000, t, false));
  assert.equal(seen[0], 0); assert.ok(seen[5] > seen[1] && seen[5] < 1000); assert.equal(seen.at(-1), 1000); assert.ok(seen.every((v, i) => i === 0 || v >= seen[i - 1]));
  assert.equal(eased('b', 55, 0, true), 55); assert.equal(eased('b', 70, 10, true), 70);
});

test('plate: the system name, the number (embossed, Thai grouping, ≈), unit, online and the hospital — all on one plate on the floor', () => {
  _resetEase(); const g = kit(); paintSigns(g, plateOf(g, { value: 1234567 }), 0);
  const t = said(g); assert.ok(t.includes('🚑 ระบบยานพาหนะ (SAND)')); assert.ok(t.includes('≈1,234,567')); assert.ok(t.includes('ครั้ง')); assert.ok(t.includes('ออนไลน์ 3')); assert.ok(t.includes(HOSPITAL_NAME)); assert.equal(HOSPITAL_NAME, 'โรงพยาบาลสันทราย');
  assert.ok(count(g, 'fillText') >= 7, 'the digits are extruded (several layers)');
  const z = kit(); paintSigns(z, plateOf(z, { value: 0, approx: false, online: 0 }), 0); assert.ok(said(z).includes('0') && !said(z).some((x) => String(x).startsWith('ออนไลน์')), 'zero is a number; no online caption when nobody is online');
});

test('plate: no data → the status word instead of a number; custom sub line; sub can be switched off; long names shrink to fit', () => {
  const g = kit(); paintSigns(g, plateOf(g, { value: null, status: 'เงียบผิดปกติ', col: '#ef4444' }), 0); assert.ok(said(g).includes('เงียบผิดปกติ')); assert.ok(!said(g).includes('ครั้ง'));
  const c = kit(); paintSigns(c, plateOf(c, { sub: 'ระบบ X · โรงพยาบาลสันทราย' }), 0); assert.ok(said(c).includes('ระบบ X · โรงพยาบาลสันทราย')); const n = kit(); paintSigns(n, plateOf(n, { sub: '' }), 0); assert.ok(!said(n).includes(HOSPITAL_NAME));
  const px = (s) => Number(/(\d+(\.\d+)?)px/.exec(s)[1]); const a = kit(); paintSigns(a, plateOf(a, { name: 'ระบบ' }), 0); const b = kit(); const lp = layoutPlate(b, { key: 'l', x: 300, y: 300, name: 'ระบบ'.repeat(30), col: '#3758f9', value: 5, unit: 'ครั้ง' }, 0); assert.ok(lp.w <= 3.9 * 60 + 8, `fits its width (${lp.w})`);
  paintSigns(b, placeSigns(b, [lp]), 0); const big = (g2) => Math.max(...g2.ctx.texts.map((x) => px(x.font))); assert.ok(big(b) <= big(a));
});

test('signs stand on a post with a shadow (never floating) and are placed without overlapping each other', () => {
  const g = kit(); const s = layoutSign(g, { text: '🏠 หน้าแรก', x: 200, y: 200, col: null, sc: 1 }); paintSigns(g, [s], 0);
  assert.ok(count(g, 'ellipse') >= 1, 'shadow on the ground'); assert.ok(count(g, 'lineTo') >= 1, 'the post'); assert.deepEqual(said(g), ['🏠 หน้าแรก']);
  const a = layoutSign(g, { text: 'aaaa', x: 200, y: 200, prio: 1 }); const b = layoutSign(g, { text: 'bbbb', x: 205, y: 202, prio: 1 }); const c = layoutSign(g, { text: 'cccc', x: 198, y: 199, prio: 1 });
  const out = placeSigns(g, [a, b, c]); const rect = (i) => ({ x0: i.x - i.w / 2, x1: i.x + i.w / 2, y0: i.y - i.h, y1: i.y + 1 }); const ov = (p, q) => p.x0 < q.x1 && p.x1 > q.x0 && p.y0 < q.y1 && p.y1 > q.y0;
  for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) assert.ok(!ov(rect(out[i]), rect(out[j])), `signs ${i}/${j} overlap`);
});

test('placement: two plates never overlap; a plate steps away from another model; the least important sign is dropped when the screen is crowded; plates are painted last', () => {
  const g = kit(); const p1 = layoutPlate(g, { key: 'a', x: 300, y: 300, name: 'ระบบ ก', col: '#3758f9', value: 1, unit: 'ครั้ง' }, 0); const p2 = layoutPlate(g, { key: 'b', x: 310, y: 305, name: 'ระบบ ข', col: '#16a34a', value: 2, unit: 'ครั้ง' }, 0);
  const sign = layoutSign(g, { text: 'x', x: 300, y: 300, prio: 1 }); const out = placeSigns(g, [sign, p1, p2]); const plates = out.filter((i) => i.kind === 'plate');
  assert.equal(plates.length, 2); const r = (i) => ({ x0: i.x - i.w / 2, x1: i.x + i.w / 2, y0: i.y, y1: i.y + i.h }); assert.ok(!(r(plates[0]).x0 < r(plates[1]).x1 && r(plates[0]).x1 > r(plates[1]).x0 && r(plates[0]).y0 < r(plates[1]).y1 && r(plates[0]).y1 > r(plates[1]).y0));
  assert.equal(out.at(-1).kind, 'plate', 'plates are painted on top');
  // a model (an obstacle) in the way: the plate moves off it, but the model it belongs to (own) may stay under it
  const own = kit({ obstacles: [{ x0: 250, x1: 350, y0: 295, y1: 400, own: 7 }] }); const lp = layoutPlate(own, { key: 'c', own: 7, x: 300, y: 300, name: 'ระบบ ค', col: '#3758f9', value: 1, unit: 'ครั้ง' }, 0); assert.equal(placeSigns(own, [lp])[0].y, 300, 'own model: stays');
  const other = kit({ obstacles: [{ x0: 250, x1: 350, y0: 295, y1: 400, own: 8 }] }); const lq = layoutPlate(other, { key: 'd', own: 7, x: 300, y: 300, name: 'ระบบ ค', col: '#3758f9', value: 1, unit: 'ครั้ง' }, 0); const moved = placeSigns(other, [lq])[0]; assert.ok(moved.x !== 300 || moved.y !== 300, 'another model: the plate steps aside');
  const crowded = kit(); const big = layoutPlate(crowded, { key: 'e', x: 300, y: 300, name: 'ระบบ', col: '#3758f9', value: 1, unit: 'ครั้ง', maxW: 4000 }, 0); const tiny = layoutSign(crowded, { text: 'ก', x: 300, y: 330, prio: 1 });
  assert.ok(placeSigns(crowded, [big, tiny]).length >= 1);
});

test('figure: head, torso, two arms and two legs for every role and kind, walking or standing, at every size', () => {
  const looks = [...Object.keys(ROLE_LOOK).map((r) => ({ role: r })), ...Object.keys(KIND_LOOK).map((k) => ({ kind: k })), {}];
  for (const lk of looks) for (const walk of [true, false]) for (const s of [1.2, 3, 7]) for (const seed of [0, 1, 2, 3, 7]) {
    const g = kit({ reduced: false }); assert.doesNotThrow(() => drawFigure(g, { sx: 100, sy: 100, s, now: 1234, walk, seed, col: '#3758f9', back: seed === 3, dot: lk.role ? '#7c3aed' : '', ...lk }), JSON.stringify([lk, walk, s, seed]));
    assert.ok(count(g, 'arc') >= 1, 'a head'); if (s >= 1.9) assert.ok(count(g, 'stroke') >= 4, `4 limbs (${JSON.stringify(lk)} s=${s})`);
  }
  const tiny = kit(); drawFigure(tiny, { sx: 0, sy: 0, s: 1.2, now: 0, seed: 0, col: '#3758f9' }); assert.equal(count(tiny, 'stroke'), 0, 'tiny figures use the cheap capsule');
});

test('figure: the outfit follows the role and the legs really swing while walking', () => {
  const fillsOf = (o) => { const log = []; const g = kit(); g.ctx = new Proxy(g.ctx, { set(t, k, v) { if (k === 'fillStyle') log.push(v); t[k] = v; return true; }, get(t, k) { return t[k]; } }); drawFigure(g, { sx: 0, sy: 0, s: 5, now: 0, seed: 0, col: '#abcdef', ...o }); return log; };
  assert.ok(fillsOf({ role: 'admin' }).includes('#7c3aed')); assert.ok(fillsOf({ role: 'head' }).includes('#ea580c')); assert.ok(fillsOf({ role: 'officer' }).includes('#0891b2')); assert.ok(fillsOf({ role: 'committee' }).includes('#16a34a'));
  assert.ok(fillsOf({ role: 'researcher' }).includes('#f8fafc')); assert.ok(fillsOf({ role: 'user' }).includes('#94a3b8')); assert.ok(fillsOf({ role: '' }).includes('#abcdef')); assert.ok(fillsOf({ kind: 'worker' }).includes('#facc15'));
  const legX = (now) => { const xs = []; const g = kit({ reduced: false }); const c = g.ctx; g.ctx = new Proxy(c, { get(t, k) { if (k === 'lineTo') return (x) => { xs.push(Math.round(x * 100)); }; return t[k]; }, set(t, k, v) { t[k] = v; return true; } }); drawFigure(g, { sx: 0, sy: 0, s: 5, now, walk: true, seed: 0, col: '#fff' }); return xs.join(','); };
  assert.notEqual(legX(0), legX(300)); const still = (now) => { const g = kit({ reduced: true }); drawFigure(g, { sx: 0, sy: 0, s: 5, now, walk: true, seed: 0, col: '#fff' }); return g.ctx.log.join(); }; assert.equal(still(0), still(999));
});

test('eval theme: ติดตามประเมินผลงาน / ยื่น อวช. gets its own model, without taking over the old themes', () => {
  assert.ok(THEMES.eval && THEMES.eval.icon && THEMES.eval.label);
  const t = (name, extra = {}) => themeOf({ name, url: 'https://x.example/', key: name, tags: [], ...extra });
  assert.equal(t('ระบบติดตามประเมินผลงาน'), 'eval'); assert.equal(t('ยื่น อวช'), 'eval'); assert.equal(t('ติดตามผลงาน บุคลากร'), 'eval'); assert.equal(t('x', { url: 'https://portfolio.example.go.th/' }), 'eval'); assert.equal(t('anything', { tags: ['theme:eval'] }), 'eval');
  assert.equal(t('ระบบยานพาหนะ'), 'ems'); assert.equal(t('HRD อบรม'), 'hrd'); assert.equal(t('ระบบวัคซีน'), 'vaccine'); assert.equal(t('จริยธรรมการวิจัย'), 'ec'); assert.equal(t('แผนงาน KPI'), 'plan'); assert.equal(t('เว็บทั่วไป'), 'web');
  assert.equal(groupOf({ tags: [] }, 'eval'), 'quality'); assert.ok(HOSP_GROUPS.find((g) => g.id === 'quality').themes.includes('eval'));
});
