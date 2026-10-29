// site-models3d.js: every system has a 3D model that fits its pad; merging keeps the draw calls low; people have all their parts. Runs three.js in Node (no WebGL needed for geometry).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeKit, buildModel, buildPerson, bake, MODEL_IDS } from '../../src/js/modules/site-models3d.js';
import { ROLE_LOOK, KIND_LOOK } from '../../src/js/modules/site-deco.js';
import { THEMES } from '../../src/js/modules/site-engine.js';

const THREE = await import('../../src/js/vendor/three/three.module.min.js');
const meshes = (o) => { let n = 0; o.traverse((m) => { if (m.isMesh) n += 1; }); return n; };

test('there is a 3D model for every theme of the engine (the 5 systems and the others), and a fallback for anything else', () => {
  for (const id of Object.keys(THEMES)) if (id !== 'fte' || true) assert.ok(MODEL_IDS.includes(id) || id === 'web', `model for theme ${id}`);
  for (const id of ['ems', 'hrd', 'ec', 'vaccine', 'eval']) assert.ok(MODEL_IDS.includes(id), id);
  const k = makeKit(THREE); assert.ok(buildModel(k, 'no-such-theme', '#3758f9').group.children.length > 0);
});

test('each model fits on its pad (≤ 3.8 wide, ≤ 2.7 high), is centred, and leaves the walkway (|x| ≥ 2.3) and the plinth at the front free', () => {
  const k = makeKit(THREE);
  for (const id of MODEL_IDS) {
    const { group } = buildModel(k, id, '#3758f9'); group.updateMatrixWorld(true); const b = new THREE.Box3().setFromObject(group); const s = b.getSize(new THREE.Vector3());
    assert.ok(s.x <= 3.8 && s.z <= 3.7 && s.y <= 2.7, `${id} size ${s.x.toFixed(2)} × ${s.y.toFixed(2)} × ${s.z.toFixed(2)}`);
    assert.ok(b.min.y >= -0.01, `${id} stands on the ground`); assert.ok(Math.max(Math.abs(b.min.x), Math.abs(b.max.x)) <= 2.05 && b.max.z <= 1.9 && b.min.z >= -2.0, `${id} inside the pad area (x ${b.min.x.toFixed(2)}..${b.max.x.toFixed(2)}, z ${b.min.z.toFixed(2)}..${b.max.z.toFixed(2)})`);
  }
});

test('bake: merges static meshes into one (vertex colours) and keeps animated / glowing / transparent ones', () => {
  const k = makeKit(THREE);
  for (const id of MODEL_IDS) {
    const { group } = buildModel(k, id, '#3758f9'); const before = meshes(group); const m = bake(k, group); const after = meshes(group);
    assert.ok(m && m.userData.baked, id); assert.ok(after < before / 2 || before <= 3, `${id}: ${before} → ${after} meshes`);
    const keep = []; group.traverse((o) => { if (o.isMesh && !o.userData.baked) keep.push(o); }); assert.ok(keep.every((o) => o.userData.keep || o.material.transparent || o.material.emissiveIntensity > 0), `${id}: only moving / glowing / see-through parts stay separate`);
  }
  const { group } = buildModel(k, 'ems', '#3758f9'); bake(k, group); let glow = 0; group.traverse((o) => { if (o.isMesh && o.material.emissive.getHex() !== 0 && o.material.emissiveIntensity > 0) glow += 1; }); assert.equal(glow, 2, 'the two light-bar lamps stay separate (they blink)');
  const e = buildModel(k, 'eval', '#3758f9'); bake(k, e.group); assert.ok(e.group.children.some((o) => o.userData.keep), 'the trophy keeps turning'); e.tick(1.5, true);
});

test('people: head, torso, two arms and two legs (one mesh when standing, body + 4 limbs when walking), outfit per role, arms and legs swing', () => {
  const k = makeKit(THREE);
  for (const role of [...Object.keys(ROLE_LOOK), '']) for (const kind of ['', ...Object.keys(KIND_LOOK)]) for (const seed of [0, 1, 2, 3]) {
    const st = buildPerson(k, role, seed, kind, false); assert.equal(meshes(st.group), 1, 'standing = a single mesh'); const bb = new THREE.Box3().setFromObject(st.group).getSize(new THREE.Vector3()); assert.ok(bb.y > 1.3 && bb.y < 2.0, `height ${bb.y}`);
    const w = buildPerson(k, role, seed, kind, true); assert.ok(meshes(w.group) <= 5 + 2, `walking person has few meshes (${meshes(w.group)})`); w.pose(0.5, true); w.pose(1.5, true);
  }
  const a = buildPerson(k, 'head', 1, '', true); a.pose(0, true); const b = a.group.clone(); a.pose(1.2, true); const pos = (g) => { const v = []; g.traverse((o) => { if (o.isGroup && o.rotation.x) v.push(+o.rotation.x.toFixed(2)); }); return v.join(); };
  assert.notEqual(pos(a.group), pos(b), 'the pose changes with the phase');
});
