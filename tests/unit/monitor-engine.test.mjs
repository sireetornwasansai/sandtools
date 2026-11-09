import test from 'node:test'; import assert from 'node:assert/strict';
import { sortFleet, stateCounts, fmtDuration, groupByDay, explain, parseFilters, filtersToParams, feedParams, defaultFilters, activeFilterCount, eventText, logSnippets } from '../../src/js/modules/monitor-engine.js';
import { buildHit, scrub } from '../../api/collect.js';
import { findRoute } from '../../src/js/core/routes.js';

const P = (o) => new URLSearchParams(o);
test('fleet: worst first, then more recent errors, then name', () => {
  const r = sortFleet([{ state: 'ok', name: 'b', err24: 0 }, { state: 'down', name: 'z', err24: 0 }, { state: 'error', name: 'a', err24: 1 }, { state: 'error', name: 'c', err24: 5 }]);
  assert.deepEqual(r.map((x) => x.name), ['z', 'c', 'a', 'b']);
  assert.equal(stateCounts(r).error, 2);
});
test('filters: URL ↔ filters round trip; junk falls back; only differences are written', () => {
  assert.deepEqual(filtersToParams(defaultFilters()), {});
  const f = parseFilters(P({ site: 'pabcdefgh1', level: 'problem', kinds: 'er,tk,zz', hours: '168', q: 'timeout', fp: 'a1b2', tab: 'issues' }));
  assert.deepEqual([f.site, f.level, f.kinds.join(), f.hours, f.q, f.fp, f.tab], ['pabcdefgh1', 'problem', 'er,tk', 168, 'timeout', 'a1b2', 'issues']);
  assert.deepEqual(parseFilters(P(filtersToParams(f))), f);
  const bad = parseFilters(P({ site: '<x>', level: 'x', hours: '5', fp: '../' })); assert.deepEqual(bad, defaultFilters());
  assert.equal(activeFilterCount(f), 5);
  assert.equal(feedParams(f).key, 'pabcdefgh1');
});
test('text helpers', () => {
  assert.equal(fmtDuration(900), '900 ms'); assert.equal(fmtDuration(2500), '2.5 วินาที'); assert.equal(fmtDuration(125000), '2 นาที 5 วินาที');
  const now = Date.UTC(2026, 10, 9, 5); assert.deepEqual(groupByDay([{ t: now }, { t: now - 1000 }, { t: now - 86400000 }], now).map((g) => [g.label, g.items.length]), [['วันนี้', 2], ['เมื่อวาน', 1]]);
  assert.ok(explain({ reasons: ['down', 'taskfail'], health: { code: 500 }, fail24: 2 }).length === 2);
  assert.ok(!eventText({ site: 'A', t: now, kind: 'er', level: 'error', msg: 'm', v: 'abcd' }).includes('abcd'));
  const sn = logSnippets('https://x.app/', 'pabcdefgh1', 'h.go.th'); assert.ok(sn.server.includes('https://x.app/api/collect') && sn.server.includes('h.go.th'));
});
test('route registered', () => assert.equal(findRoute('/monitor').id, 'monitor'));
test('edge: scrub removes e-mail, phone, long numbers, query strings, tokens', () => {
  const t = scrub('a@b.go.th 081-234-5678 1234567 https://x.go.th/a?id=1 ' + 'A'.repeat(30));
  assert.ok(!/a@b|5678|1234567|id=1|AAAA/.test(t), t);
});
const req = (method, headers = {}) => ({ method, headers: new Headers(headers) });
test('edge: log lines — POST only, server lines use h, bots/DNT dropped, bad kind → lg', async () => {
  const f = { k: 'pabcdefgh1', t: 'lg', e: 'job', m: 'x@y.com failed', c: 'zz', v: 'error', s: 'fail', d: 1200 };
  assert.equal(await buildHit(req('GET', { origin: 'https://a.go.th' }), f, 's'), null);
  const b = await buildHit(req('POST', { origin: 'https://a.go.th', 'user-agent': 'Mozilla/5.0 Chrome/120' }), f, 's');
  assert.equal(b.kind, 'lg'); assert.equal(b.lv, 'error'); assert.ok(!b.msg.includes('x@y.com')); assert.equal(b.host, 'a.go.th');
  const srv = await buildHit(req('POST', {}), { ...f, h: 'App.Go.Th' }, 's'); assert.equal(srv.host, 'app.go.th'); assert.equal(srv.device, 'server'); assert.equal(srv.vid, '');
  assert.equal(await buildHit(req('POST', { dnt: '1' }), f, 's'), null);
  assert.equal(await buildHit(req('POST', { origin: 'https://a.go.th' }), { k: f.k, t: 'lg' }, 's'), null);
});
