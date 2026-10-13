import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFloor, pickSites, stateOf, trendOf, perFigure, visitors, timeRange, crowdPeak, summarize, insights, sitesCsv, makeSample, MAX_SITES, MAX_FIGURES, DEFAULTS } from '../../src/js/modules/site-engine.js';

const sample = () => makeSample(30);

test('normalizeFloor: rejects other answers, fills missing fields', () => {
  assert.equal(normalizeFloor(null), null);
  assert.equal(normalizeFloor({ items: [] }), null);
  const f = normalizeFloor({ days: 7, sites: [{ key: 'a', name: 'A', pv: '5' }, { name: 'no key' }] });
  assert.equal(f.sites.length, 1); assert.equal(f.sites[0].byHour.length, 24); assert.equal(f.sites[0].pv, 5); assert.equal(f.sites[0].prev, null);
});
test('states: ok / paused / idle / silent', () => {
  const s = sample().sites.map((x) => stateOf(x));
  assert.deepEqual(s, ['ok', 'ok', 'ok', 'ok', 'silent', 'idle']);
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
  const d = sample(); const sm = summarize(d.sites); assert.equal(sm.total, 6); assert.equal(sm.tracking, 6); assert.ok(sm.pv > 0); assert.ok(sm.peakHour >= 8 && sm.peakHour <= 10);
  const txt = insights(d.sites, d.days, d.extra).map((x) => x.text).join('\n');
  assert.match(txt, /เงียบผิดปกติ/); assert.match(txt, /ยังไม่มีข้อมูลเข้ามา/); assert.match(txt, /มือถือ/);
  assert.equal(insights([], 30)[0].tone, 'info');
});
test('csv: formula-injection safe, one row per project', () => {
  const rows = sitesCsv([{ name: '=HYPERLINK("x")', url: 'https://a.b', pv: 1, prev: null, uv: 1, realtime: null, byHour: [], status: 'active', track: true }], 30).split('\r\n');
  assert.equal(rows.length, 2); assert.ok(rows[1].startsWith(`"'=`));
});
