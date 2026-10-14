import test from 'node:test';
import assert from 'node:assert/strict';
import { pageKey, pageKind, pageLabel, normalizePages, pageJourneys, nextPages, pageInsights, pagesCsv, makeSamplePages, pagesFromStats, themeOf, THEMES, normalizeFloor, pickSites, stateOf, trendOf, perFigure, visitors, timeRange, crowdPeak, summarize, insights, sitesCsv, makeSample, MAX_SITES, MAX_FIGURES, DEFAULTS,
  usageRank, asJourneys, busiestDay, normalizeReplay, replayVisitors, replayRange, cumViews, dayStats, compareToPeak, replayInsights, replayCsv, makeSampleReplay, dayLabel, addDays, MODES, MODE_IDS, MAX_DAY_FIGURES, REPLAY_PRIVACY,
  WING_MAX, wingOf, normalizeWings, makeSampleWings, wingPick, wingNext,
  DEPT, deptWorld, deptLayout, deptStand, headStand, HOSP, HOSP_GROUPS, groupOf, hospitalLayout, hospStand, hospRoute, VIEW_IDS } from '../../src/js/modules/site-engine.js';

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
  assert.equal(T('ระบบรายงาน FTE'), 'fte'); assert.equal(T('FTE report', 'https://fte.example.org'), 'fte'); assert.equal(T('งานวัคซีนเด็ก'), 'vaccine'); assert.equal(T('SAND Office Tools'), 'web'); assert.equal(T('เว็บข่าว'), 'web');
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

test('usageRank / pickSites: people online now outrank busier projects; silent, idle, paused last', () => {
  const mk = (key, pv, extra = {}) => ({ key, name: key, pv, prev: 0, realtime: 0, status: 'active', track: true, ...extra });
  const all = [mk('busy', 500), mk('live-small', 3, { realtime: 2 }), mk('silent', 0, { prev: 40 }), mk('idle', 0), mk('paused', 900, { status: 'paused' }), mk('ok', 20)];
  assert.deepEqual(all.map(usageRank), [1, 0, 2, 3, 4, 1]);
  assert.deepEqual(pickSites(all).sites.map((x) => x.key), ['live-small', 'busy', 'ok', 'silent', 'idle', 'paused']);
  const many = Array.from({ length: 12 }, (_, i) => mk('k' + i, 100 - i, i === 11 ? { realtime: 1, pv: 1 } : {}));
  assert.equal(pickSites(many).sites[0].key, 'k11');
});
const DAY = '2026-10-07'; const TODAY = '2026-10-13';
const rawReplay = (o = {}) => ({ mode: 'peak', day: DAY, today: TODAY, scale: 1,
  byDay: [{ d: '2026-10-05', pv: 10 }, { d: DAY, pv: 40 }, { d: '2026-10-09', pv: 40 }, { d: '2026-10-12', pv: 0 }, { d: TODAY, pv: 12 }],
  sites: [{ key: 'a', n: 6, uv: 3, fresh: 3, back: 1, ev: [[600, 1, 0], [602, 1, 2], [605, 2, 0], [700, 3, 0], [760, 1, 1], [762, 1, 2]] }, { key: 'b', ev: [[610, 1, 0]] }], ...o });
const drawn = [{ key: 'a' }, { key: 'b' }];
test('busiestDay: ties → latest, empty never wins', () => {
  assert.deepEqual(busiestDay(rawReplay().byDay), { d: '2026-10-09', pv: 40 });
  assert.equal(busiestDay([{ d: '2026-10-01', pv: 0 }]), null); assert.equal(busiestDay(null), null);
});
test('normalizeReplay: rejects other answers, derives counts, clamps events', () => {
  for (const bad of [null, {}, { sites: [] }, { day: 'x', sites: [] }, { day: DAY }]) assert.equal(normalizeReplay(bad), null);
  const r = normalizeReplay(rawReplay()); assert.equal(r.sites.a.back, 1);
  assert.deepEqual(r.sites.b, { n: 1, uv: 1, fresh: 1, back: 0, ev: [{ m: 610, v: 1, f: 0, p: -1 }], pg: [] });
  const odd = normalizeReplay(rawReplay({ mode: 'x', scale: 0, sites: [{ key: 'z', ev: [[-1, 1, 0], [1440, 1, 0], [30, 2, 9], [20, 3, 'x']] }, { n: 5 }] }));
  assert.equal(odd.mode, 'today'); assert.equal(odd.scale, 1); assert.deepEqual(odd.sites.z.ev, [{ m: 20, v: 3, f: 0, p: -1 }, { m: 30, v: 2, f: 2, p: -1 }]);
});
test('replayVisitors: one person per VISIT, new vs returning flagged', () => {
  const rep = normalizeReplay(rawReplay()); const v = replayVisitors(rep, drawn);
  assert.equal(v.length, 5); assert.equal(v.filter((x) => x.back).length, 1);
  for (const x of v) assert.ok(x.enter < x.start && x.start < x.end && x.end < x.exit);
  assert.deepEqual(v, replayVisitors(rep, drawn)); assert.equal(replayVisitors(null, drawn).length, 0);
  assert.equal(replayVisitors(rep, [{ key: 'b' }])[0].site, 0);
  assert.equal(asJourneys(v).filter((x) => x.back).length, 1);
  const d = sample(); const ss = pickSites(d.sites).sites; assert.ok(asJourneys(visitors(ss, d.days, perFigure(ss, d.days))).every((x) => x.back === false));
});
test('replayRange: past day spans its activity, today stops near now', () => {
  const past = normalizeReplay(rawReplay()); const r = replayRange(replayVisitors(past, drawn), past, 900); assert.ok(r.from <= 590 && r.to >= 780 && r.to - r.from >= 180);
  const now = normalizeReplay(rawReplay({ day: TODAY })); const rn = replayRange(replayVisitors(now, drawn), now, 650); assert.ok(rn.to <= 720 && rn.to > 650);
  assert.deepEqual(replayRange([], now, 30), { from: 0, to: 180 }); assert.deepEqual(replayRange([], past, 0), { from: DEFAULTS.open, to: DEFAULTS.close });
});
test('cumViews + dayStats', () => {
  const rep = normalizeReplay(rawReplay()); assert.equal(cumViews(rep, 'a', 599), 0); assert.equal(cumViews(rep, 'a', 605), 3); assert.equal(cumViews(rep, 'nope', 900), 0);
  const st = dayStats(rep); assert.deepEqual([st.views, st.fresh, st.back, st.visits, st.backPct], [7, 4, 1, 5, 20]); assert.equal(st.peakHour, 10); assert.equal(st.top.key, 'a');
  const sc = normalizeReplay(rawReplay({ scale: 3 })); assert.equal(cumViews(sc, 'a', 1439), 18);
  const e = dayStats(normalizeReplay(rawReplay({ sites: [] }))); assert.deepEqual([e.views, e.peakHour, e.top, e.backPct], [0, -1, null, 0]);
});
test('compareToPeak + replayInsights', () => {
  assert.deepEqual(compareToPeak(rawReplay().byDay, TODAY), { peakDay: '2026-10-09', peakPv: 40, today: TODAY, todayPv: 12, pct: 30, isPeak: false });
  assert.equal(compareToPeak([], TODAY), null);
  const today = normalizeReplay(rawReplay({ day: TODAY })); const t = replayInsights(today, dayStats(today), { a: 'ระบบ A' }).map((x) => x.text).join('\n');
  assert.match(t, /ผู้ใช้ใหม่ 4/); assert.match(t, /ระบบ A มีคนเปิดมากสุด/); assert.match(t, /≈ 30% ของวันที่คนใช้มากสุด/); assert.ok(t.includes(REPLAY_PRIVACY));
  assert.deepEqual(replayInsights(null, {}), []);
});
test('replayCsv + sample replay + helpers', () => {
  const rep = normalizeReplay(rawReplay()); const rows = replayCsv(rep, [{ key: 'a', name: '=evil()' }, { key: 'zz', name: 'x' }]).split('\r\n'); assert.equal(rows.length, 2); assert.match(rows[1], /^"2026-10-07","'=evil\(\)"/);
  const d = sample(); const t = normalizeReplay(makeSampleReplay(d.sites, 'today', TODAY, 600)); const p = normalizeReplay(makeSampleReplay(d.sites, 'peak', TODAY, 600));
  assert.deepEqual(makeSampleReplay(d.sites, 'today', TODAY, 600), makeSampleReplay(d.sites, 'today', TODAY, 600));
  assert.equal(p.busiest.d, p.day); assert.ok(Object.values(t.sites).every((s) => s.ev.every((e) => e.m <= 600))); assert.equal(Object.keys(t.sites).length, 6);
  assert.ok(dayStats(p).views > dayStats(t).views); assert.ok(replayVisitors(p, pickSites(d.sites).sites).length <= MAX_DAY_FIGURES);
  assert.deepEqual(MODE_IDS, ['typical', 'today', 'peak']); assert.match(dayLabel('2026-10-13'), /2569/); assert.equal(addDays('2026-10-31', 1), '2026-11-01');
});

/* ---------------------------------------- wings: the pages behind each station ---------------------------------------- */
test('wingOf / normalizeWings: busiest pages only, never the "other" bucket, answers of other shapes are rejected', () => {
  const d = sample(); const s = pickSites(d.sites).sites[0]; const pg = normalizePages(makeSamplePages(s, 30)); const w = wingOf(pg);
  assert.ok(w.units.length > 0 && w.units.length <= WING_MAX); assert.ok(w.units.every((u) => u.kind !== 'p:other'));
  assert.ok(w.units.every((u, i) => i === 0 || w.units[i - 1].pv >= u.pv)); assert.ok(w.flows.every((f) => w.units.some((u) => u.key === f.from) && w.units.some((u) => u.key === f.to)));
  assert.equal(wingOf(null), null); assert.equal(normalizeWings(null), null); assert.equal(normalizeWings({ sites: 1 }), null);
  const raw = { days: 30, sites: [{ site: { key: 'a', name: 'A', url: 'https://x.test/' }, uv: 3, realtime: 0, pages: [{ path: '/', pv: 5, uv: 3 }, { path: '/form.html', pv: 2, uv: 2 }], other: { pv: 4, uv: 2 }, flows: [{ from: '/', to: '/form.html', n: 2 }] }, { pages: [] }] };
  const m = normalizeWings(raw); assert.deepEqual(Object.keys(m), ['a']); assert.equal(m.a.units.length, 2); assert.equal(m.a.hasMore, true); assert.equal(m.a.tot, 11); assert.deepEqual(wingNext(m.a, m.a.units[0].key), { to: m.a.units[1].key, n: 2 });
  assert.equal(wingNext(m.a, m.a.units[1].key), null);
});
test('makeSampleWings: one wing per sample project', () => {
  const ss = pickSites(sample().sites).sites; const m = makeSampleWings(ss, 30); assert.equal(Object.keys(m).length, ss.length); assert.ok(ss.every((s) => m[s.key].units.length >= 1));
});
test('wingPick: deterministic, follows the page views, -1 when there is nothing to pick', () => {
  const w = { units: [{ pv: 90 }, { pv: 10 }, { pv: 0 }] }; const pick = (id) => wingPick(w, id);
  assert.equal(pick(5), pick(5)); const n = Array.from({ length: 400 }, (_, i) => pick(i + 1)); const c0 = n.filter((x) => x === 0).length;
  assert.ok(c0 > 300 && c0 < 390); assert.ok(n.every((x) => x === 0 || x === 1)); assert.equal(wingPick({ units: [] }, 1), -1); assert.equal(wingPick(null, 1), -1); assert.equal(wingPick({ units: [{ pv: 0 }] }, 1), -1);
});
test('deptLayout: rooms inside their department, beside the hall, below the head office; busiest nearest the corridor', () => {
  for (const n of [1, 2, 3, 5, 8]) {
    const W = deptWorld(n); const L = deptLayout(Array.from({ length: n }, (_, i) => (i % 2 ? 6 : 3))); assert.equal(L.length, n); assert.ok(W.GX >= 9.6 && W.GX <= 17); assert.ok(Math.abs(W.GY - 12.5) < 1e-9);
    L.forEach((d, i) => {
      assert.equal(d.top, i < W.top); assert.equal(d.rooms.length, i % 2 ? 6 : 3); assert.ok(d.pad.x0 >= 0 && d.pad.x1 <= W.GX + 1e-9);
      assert.ok(d.top ? d.mouth[1] <= W.CY - DEPT.CORR / 2 + 1e-9 : d.mouth[1] >= W.CY + DEPT.CORR / 2 - 1e-9, 'hall opens on the corridor edge');
      d.rooms.forEach((r, k) => {
        assert.equal(r.p, k); assert.ok(r.c.every(Number.isFinite)); assert.ok(r.x0 >= d.pad.x0 - 1e-9 && r.x1 <= d.pad.x1 + 1e-9 && r.y0 >= d.pad.y0 - 1e-9 && r.y1 <= d.pad.y1 + 1e-9, 'inside the pad');
        assert.ok(r.side < 0 ? r.x1 <= d.hall.x0 + 1e-9 : r.x0 >= d.hall.x1 - 1e-9, 'beside the hall'); assert.ok(d.top ? r.y0 >= d.head.y1 - 1e-9 : r.y1 <= d.head.y0 + 1e-9, 'not in the head office');
        if (k >= 2) assert.ok(d.top ? r.y1 < d.rooms[k - 2].y1 : r.y0 > d.rooms[k - 2].y0, 'busiest nearest the corridor');
        const s = deptStand(r, k); assert.ok(s[0] > r.x0 && s[0] < r.x1 && s[1] > r.y0 && s[1] < r.y1, 'standing place inside the room');
      });
      const hs = headStand(d, 4); assert.ok(hs.every(Number.isFinite));
    });
  }
  assert.equal(deptLayout([0, 0])[0].rooms.length, 0);
});
test('groupOf: vehicle + FTE → general administration, HRD / EC / vaccine → quality development, tag overrides', () => {
  const g = (name, tags = []) => groupOf({ name, url: '', key: 'k', tags });
  assert.equal(g('ระบบยานพาหนะ (SAND)'), 'admin'); assert.equal(g('ระบบรายงาน FTE'), 'admin');
  assert.equal(g('HRD training'), 'quality'); assert.equal(g('จริยธรรมการวิจัย EC'), 'quality'); assert.equal(g('ห้องวัคซีน'), 'quality');
  assert.equal(g('ห้องวัคซีน', ['group:admin']), 'admin'); assert.equal(HOSP_GROUPS.length, 2);
});
test('hospitalLayout: wings by group, busiest nearest the lobby, rooms inside the building, routes stay on the floor', () => {
  for (const n of [1, 3, 8]) {
    const items = Array.from({ length: n }, (_, i) => ({ group: i % 3 ? 'quality' : 'admin', pv: 100 - i })); const L = hospitalLayout(items);
    assert.equal(L.rooms.length, n);
    L.rooms.forEach((r, i) => {
      assert.ok(r && r.group === items[i].group); assert.ok(r.x0 >= HOSP.X0 - 1e-9 && r.x1 <= HOSP.GX && r.y0 >= HOSP.Y0 - 1e-9 && r.y1 <= L.lobby.y1 + 1e-9);
      assert.ok(r.group === 'admin' ? r.x1 <= HOSP.LOB[0] + 1e-9 : r.x0 >= HOSP.LOB[1] - 1e-9, 'wing side'); assert.ok(r.front ? r.door[1] === r.y0 : r.door[1] === r.y1, 'door faces the spine');
      const st = hospStand(r, i); assert.ok(st[0] > r.x0 && st[0] < r.x1 && st[1] > r.y0 && st[1] < r.y1);
      for (const [x, y] of hospRoute(L, r)) assert.ok(x >= 0 && x <= HOSP.GX && y >= 0 && y <= HOSP.GY);
    });
  }
  const L2 = hospitalLayout([{ group: 'admin', pv: 1 }, { group: 'admin', pv: 9 }]); assert.ok(L2.rooms[1].x1 >= L2.rooms[0].x1, 'busiest nearest the lobby'); assert.deepEqual(VIEW_IDS, ['dept', 'hospital']);
});
test('replay events carry the page: normalizeReplay → replayVisitors → asJourneys', () => {
  const rep = normalizeReplay(rawReplay({ sites: [{ key: 'a', n: 3, fresh: 2, back: 1, pgs: ['/Form.html?x=1', '/'], ev: [[600, 1, 0, 0], [605, 2, 0, 1], [700, 1, 1, 7], [710, 3, 0]] }] }));
  assert.deepEqual(rep.sites.a.pg, ['/form.html', '/']); assert.deepEqual(rep.sites.a.ev.map((e) => e.p), [0, 1, 7, -1]);
  const v = replayVisitors(rep, [{ key: 'a' }]); assert.deepEqual(v.map((x) => x.pk), ['/form.html', '/', '', '']); assert.deepEqual(asJourneys(v).map((x) => x.pk), ['/form.html', '/', '', '']);
  assert.ok(asJourneys(visitors(pickSites(sample().sites).sites, 30, 5)).every((x) => x.pk === ''));
});
