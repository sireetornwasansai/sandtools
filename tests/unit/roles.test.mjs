import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_IDS, roleOf, roleText, normalizePages, makeSample, makeSamplePages, themeOf, hospitalLayout, hospDoor, hospRoute, HOSP } from '../../src/js/modules/site-engine.js';

test('roleOf: counts per role never exceed the views, the rest is "not stated"', () => {
  const q = roleOf({ pv: 10, rl: { admin: 3, committee: 4, user: 9 } });
  assert.deepEqual(q.by, { admin: 3, committee: 4, user: 3 }); assert.equal(q.known, 10); assert.equal(q.none, 0);
  assert.equal(roleOf({ pv: 5, rl: {} }).known, 0); assert.equal(roleOf({ pv: 5, rl: { nobody: 4 } }).none, 5, 'unknown words are not roles');
  assert.match(roleText({ pv: 4, rl: { admin: 1, user: 3 } }), /75%/);
});

test('normalizePages keeps the role counts per page and names the real HRD / EC screens', () => {
  const pg = normalizePages({ days: 7, site: { key: 'pabcdefghi', name: 'ระบบจริยธรรมการวิจัย (EC)', url: 'https://ec.example.go.th/app.html' }, uv: 3, realtime: 0,
    pages: [{ path: '/#/evaluate', pv: 5, uv: 3, rl: { committee: 4, admin: 1 } }, { path: '/#/submit', pv: 2, uv: 2, rl: { researcher: 2 } }], flows: [] });
  const ev = pg.units.find((u) => u.path === '/#/evaluate'); assert.deepEqual(ev.rl, { committee: 4, admin: 1 }); assert.equal(ev.kind, 'p:check');
  assert.equal(pg.units.find((u) => u.path === '/#/submit').rl.researcher, 2);
});

test('sample data: HRD and EC are single-file apps with role mixes; every sample page carries valid role words only', () => {
  const d = makeSample(30);
  for (const th of ['hrd', 'ec']) { const s = d.sites.find((x) => themeOf(x) === th); if (!s) continue; const pg = makeSamplePages(s, 30); assert.ok(pg.pages.every((p) => p.path.startsWith('/#/')), th); assert.ok(pg.pages.some((p) => Object.keys(p.rl).length), th); for (const p of pg.pages) for (const k of Object.keys(p.rl)) assert.ok(ROLE_IDS.includes(k)); }
});

test('hospital: people come out of the front door of the main building (back of the campus), down the avenue, then along the spine to their building', () => {
  const L = hospitalLayout([{ group: 'admin', pv: 5 }, { group: 'quality', pv: 9 }, { group: 'quality', pv: 2 }]); const { GX, GY } = L.world;
  for (const r of L.rooms) {
    const e = hospDoor(L, r); assert.ok(e[0] >= L.avenue.x0 && e[0] <= L.avenue.x1); assert.ok(e[1] >= L.bld.y1 && e[1] < L.rows.back[0]);
    const route = hospRoute(L, r); assert.equal(route[0][0], e[0]); assert.equal(route[0][1], L.sy); assert.equal(route[1][1], L.sy); assert.deepEqual(route[2], r.door);
    for (const q of route) assert.ok(q[0] >= 0 && q[0] <= GX && q[1] >= 0 && q[1] <= GY);
  }
});
