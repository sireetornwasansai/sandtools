import test from 'node:test';
import assert from 'node:assert/strict';
import { pageKey, pageKind, pageLabel, normalizePages, pageJourneys, nextPages, pageInsights, pagesCsv, makeSamplePages, pagesFromStats, themeOf, THEMES, normalizeFloor, pickSites, stateOf, trendOf, perFigure, visitors, timeRange, crowdPeak, summarize, insights, sitesCsv, makeSample, MAX_SITES, MAX_FIGURES, DEFAULTS } from '../../src/js/modules/site-engine.js';

const sample = () => makeSample(30);

test('normalizeFloor: rejects other answers, fills missing fields', () => {
  assert.equal(normalizeFloor(null), null);
  assert.equal(normalizeFloor({ items: [] }), null);
  const f = normalizeFloor({ days: 7, sites: [{ key: 'a', name: 'A', pv: '5' }, { name: 'no key' }] });
  assert.equal(f.sites.length, 1); assert.equal(f.sites[0].byHour.length, 24); assert.equal(f.sites[0].pv, 5); assert.equal(f.sites[0].prev, null);
});
test('states: ok / paused / idle / silent', () => {
  const s = sample().sites.map((x) => stateOf(x));
  assert.deepEqual(s, ['ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'silent', 'idle']);
  assert.equal(stateOf({ status: 'paused', pv: 5, prev: 0 }), 'paused');
  assert.equal(stateOf({ status: 'active', track: false, pv: 5, prev: 0 }), 'paused');
});
test('trendOf', () => { assert.equal(trendOf({ pv: 5, prev: null }), null); assert.equal(trendOf({ pv: 5, prev: 0 }), 'new'); assert.equal(trendOf({ pv: 150, prev: 100 }), 50); });
test('pickSites: busiest first, capped, deleted dropped', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ key: 'k' + i, name: 'n' + i, pv: i, status: i === 11 ? 'deleted' : 'active' }));
  const r = pickSites(many); assert.equal(r.sites.length, MAX_SITES); assert.equal(r.sites[0].key, 'k10'); assert.equal(r.more, 3);
});
test('typical day: deterministic, bounded, ordered in time', () => {
  const d = sample(); const { sites } = pickSites(d.sites); const pf = perFigure(sites, d.days);
  const a = visitors(sites, d.days, pf); const b = visitors(sites, d.days, pf);
  assert.deepEqual(a, b); assert.ok(a.length > 0 && a.length < MAX_FIGURES * 3);
  for (const v of a) { assert.ok(v.enter < v.start && v.start < v.end && v.end < v.exit); }
  const r = timeRange(a); assert.ok(r.from <= DEFAULTS.open && r.to >= DEFAULTS.close); assert.ok(crowdPeak(a, r) >= r.from);
  assert.deepEqual(timeRange([]), { from: DEFAULTS.open, to: DEFAULTS.close });
});
test('summarize + insights flag the silent and idle projects', () => {
  const d = sample(); const sm = summarize(d.sites); assert.equal(sm.total, 8); assert.equal(sm.tracking, 8); assert.ok(sm.pv > 0); assert.ok(sm.peakHour >= 8 && sm.peakHour <= 10);
  const txt = insights(d.sites, d.days, d.extra).map((x) => x.text).join('\n');
  assert.match(txt, /เงียบผิดปกติ/); assert.match(txt, /ยังไม่มีข้อมูลเข้ามา/); assert.match(txt, /มือถือ/);
  assert.equal(insights([], 30)[0].tone, 'info');
});
test('csv: formula-injection safe, one row per project', () => {
  const rows = sitesCsv([{ name: '=HYPERLINK("x")', url: 'https://a.b', pv: 1, prev: null, uv: 1, realtime: null, byHour: [], status: 'active', track: true }], 30).split('\r\n');
  assert.equal(rows.length, 2); assert.ok(rows[1].startsWith(`"'=`));
});

test('themeOf: SAND fleet, HRD, EC, vaccine and tag override', () => {
  const T = (name, url = '', tags = []) => themeOf({ name, url, key: 'k', tags });
  assert.equal(T('SAND', 'https://carsystemsansai.example.org'), 'ems'); assert.equal(T('ระบบขอใช้รถ'), 'ems');
  assert.equal(T('HRD training management'), 'hrd'); assert.equal(T('EC Sansai', 'https://ec-sansai.github.io'), 'ec'); assert.equal(T('ระบบจริยธรรมการวิจัย'), 'ec');
  assert.equal(T('งานวัคซีนเด็ก'), 'vaccine'); assert.equal(T('SAND Office Tools'), 'web'); assert.equal(T('เว็บข่าว'), 'web');
  assert.equal(T('อะไรก็ได้', '', ['theme:dental']), 'dental'); assert.equal(T('อะไรก็ได้', '', ['theme:nope']), 'web');
  for (const id of Object.keys(THEMES)) assert.ok(THEMES[id].icon && THEMES[id].label);
});

// ---------------- inside one system (pages as rooms) ----------------
test('pageKey: folds index.html / query / trailing slash, keeps SPA routes', () => {
  assert.equal(pageKey('/carsystemsansai/index.html'), '/carsystemsansai'); assert.equal(pageKey('/CarSystemSansai/'), '/carsystemsansai');
  assert.equal(pageKey('/a/check.html?x=1'), '/a/check.html'); assert.equal(pageKey('/ec/#/submit?z=1'), '/ec#/submit'); assert.equal(pageKey(''), '/');
});
test('pageKind / pageLabel: the vehicle system pages', () => {
  const root = '/carsystemsansai';
  const k = (n) => pageKind(`/carsystemsansai/${n}.html`, root);
  assert.equal(k('startmile'), 'p:mile'); assert.equal(k('editmile'), 'p:mile'); assert.equal(k('check'), 'p:check'); assert.equal(k('EMScheck'), 'p:ems'); assert.equal(k('worktable'), 'p:cal');
  assert.equal(k('dashboard'), 'p:dash'); assert.equal(k('swap'), 'p:swap'); assert.equal(k('routemap'), 'p:map'); assert.equal(pageKind('/carsystemsansai', root), 'p:home');
  assert.equal(pageKind('/carsystemsansai/foo.html', ''), 'p:page', '"ems" inside "carsystemsansai" must not match');
  assert.equal(pageLabel('/carsystemsansai/startmile.html'), 'บันทึกไมล์เริ่มต้น'); assert.equal(pageLabel('/x/SomeNewPage.html'), 'Some New Page');
});
test('normalizePages: your real numbers → 9 rooms, folder = home, flows kept', () => {
  const d = normalizePages(makeSamplePages(sample().sites[0]));
  assert.equal(d.units.length, 9); const home = d.units.find((u) => u.kind === 'p:home');
  assert.equal(home.pv, 253, 'index.html (232) + folder (21)'); assert.equal(d.units[0].pv, 253); assert.equal(d.units.find((u) => u.path === '/carsystemsansai/startmile.html').pv, 240);
  assert.ok(d.flows.length >= 5 && d.flows.every((f) => f.n > 0 && f.from !== f.to));
  assert.equal(normalizePages({ items: [] }), null);
});
test('normalizePages: more than MAX_PAGES → folded into "other"', () => {
  const pages = Array.from({ length: 14 }, (_, i) => ({ path: `/p${i}.html`, pv: 20 - i, uv: 1, realtime: 0, byHour: Array(24).fill(0) }));
  const d = normalizePages({ days: 30, site: { url: 'https://x.org/' }, pages, other: { pv: 5, uv: 1, realtime: 0, byHour: Array(24).fill(0) }, flows: [{ from: '/p0.html', to: '/p1.html', n: 3 }, { from: '/p0.html', to: '/p13.html', n: 9 }] });
  assert.ok(d.units.length <= 10); assert.equal(d.flows.length, 1, 'flows to dropped pages are removed');
});
test('pageJourneys: deterministic, ordered, continuations walk between rooms', () => {
  const d = normalizePages(makeSamplePages(sample().sites[0])); const pf = perFigure(d.units, d.days);
  const a = pageJourneys(d.units, d.flows, d.days, pf); assert.deepEqual(a, pageJourneys(d.units, d.flows, d.days, pf));
  assert.ok(a.some((j) => j.stops.length > 1), 'some visitors move on to a second page');
  for (const j of a) { assert.ok(j.enter < j.stops[0].start); j.stops.forEach((s, i) => { assert.ok(s.start < s.end); if (i) assert.ok(j.stops[i - 1].end < s.start); }); assert.ok(j.stops.at(-1).end < j.exit); }
  const stops = a.reduce((n, j) => n + j.stops.length, 0); const expect = d.units.reduce((n, u) => n + u.pv, 0) / d.days / pf; assert.ok(Math.abs(stops - expect) / expect < 0.25, `stops ${stops} ≈ ${expect}`);
  const r = timeRange(a); assert.ok(r.from <= DEFAULTS.open && r.to >= DEFAULTS.close);
});
test('nextPages / pageInsights / pagesCsv / pagesFromStats', () => {
  const d = normalizePages(makeSamplePages(sample().sites[0])); const nx = nextPages(d.units, d.flows); const home = d.units.find((u) => u.kind === 'p:home');
  assert.equal(nx[home.key][0].n, 120); const ins = pageInsights(d.units, d.flows, d.days); assert.ok(ins.some((x) => /เส้นทางที่เดินบ่อยสุด/.test(x.text)));
  assert.equal(pageInsights([], [], 30)[0].tone, 'info'); assert.match(pagesCsv(d.units, 30, '=evil'), /^"ระบบ"/); assert.match(pagesCsv(d.units, 30, '=evil').split('\r\n')[1], /"'=evil"/);
  const fb = normalizePages(pagesFromStats({ site: { key: 'k', name: 'n', url: 'https://x.org/a/' }, byHour: Array(24).fill(1), pages: [{ name: '/a/', n: 10, u: 5 }, { name: '/a/form.html', n: 5, u: 2 }] }, 30));
  assert.equal(fb.units.length, 2); assert.equal(fb.flows.length, 0);
});
