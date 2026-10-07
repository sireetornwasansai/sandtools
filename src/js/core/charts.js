// Shared chart + formatting helpers for the statistics pages (links, projects).
// Markup uses the .lnk-* classes from css/links.css — pages that use these helpers must load that stylesheet (loadCss('links')).
import { h } from './dom.js';

export const fmt = (n) => Number(n || 0).toLocaleString('th-TH');
export const DEVICE = { mobile: 'มือถือ', desktop: 'คอมพิวเตอร์', tablet: 'แท็บเล็ต', bot: 'บอท', other: 'ไม่ทราบ' };
const REGION = (() => { try { return new Intl.DisplayNames(['th'], { type: 'region' }); } catch { return null; } })();
export const countryName = (c) => (c ? (REGION && REGION.of(c)) || c : 'ไม่ทราบ');
export const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
export const bkk = (s) => (s ? new Date(`${String(s).replace(' ', 'T')}+07:00`) : null);
export const when = (ts) => (ts ? new Date(ts).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '-');
export const ago = (ts) => {
  if (!ts) return 'ยังไม่มีคนเข้า';
  const m = Math.round((Date.now() - new Date(ts).getTime()) / 60000);
  return m < 1 ? 'เมื่อสักครู่' : m < 60 ? `${m} นาทีที่แล้ว` : m < 1440 ? `${Math.round(m / 60)} ชั่วโมงที่แล้ว` : `${Math.round(m / 1440)} วันที่แล้ว`;
};
export function barChart(points, label) {
  const max = Math.max(1, ...points.map((p) => p.n)); const total = points.reduce((a, p) => a + p.n, 0);
  return h('figure', { class: 'lnk-chart', role: 'img', 'aria-label': `${label}: รวม ${fmt(total)} คลิก สูงสุด ${fmt(max)} ต่อช่วง` },
    h('div', { class: 'lnk-chart-y' }, h('span', null, fmt(max)), h('span', null, '0')),
    h('div', { class: 'lnk-bars' }, points.map((p) => h('div', { class: 'lnk-bar', title: `${p.label}: ${fmt(p.n)} คลิก` }, h('i', { style: `height:${p.n ? Math.max(4, Math.round((p.n / max) * 100)) : 0}%` })))),
    h('div', { class: 'lnk-chart-x' }, h('span', null, points[0] ? points[0].label : ''), h('span', null, points.length ? points[points.length - 1].label : '')));
}
export function hBars(title, list, labelFn) {
  const total = list.reduce((a, x) => a + x.n, 0);
  return h('section', { class: 'lnk-break' }, title ? h('h3', null, title) : null, total
    ? h('ul', null, list.map((x) => { const pct = Math.round((x.n / total) * 100); return h('li', null, h('span', { class: 'lnk-hb-name', title: labelFn(x.name) }, labelFn(x.name)), h('span', { class: 'lnk-hb-track' }, h('i', { style: `width:${Math.max(2, pct)}%` })), h('span', { class: 'lnk-hb-n' }, `${fmt(x.n)} · ${pct}%`)); }))
    : h('p', { class: 'muted' }, 'ยังไม่มีข้อมูล'));
}
export const dayLabel = (d) => { const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }); };


/** Two series per point (e.g. page views + visitors) drawn side by side. points: [{a, b, label}] */
export function dualBars(points, label, nameA, nameB) {
  const max = Math.max(1, ...points.map((p) => Math.max(p.a, p.b)));
  const pct = (n) => (n ? Math.max(4, Math.round((n / max) * 100)) : 0);
  return h('figure', { class: 'lnk-chart', role: 'img', 'aria-label': `${label}: ${nameA} รวม ${fmt(points.reduce((x, p) => x + p.a, 0))} · ${nameB} รวม ${fmt(points.reduce((x, p) => x + p.b, 0))}` },
    h('div', { class: 'lnk-chart-y' }, h('span', null, fmt(max)), h('span', null, '0')),
    h('div', { class: 'lnk-bars' }, points.map((p) => h('div', { class: 'lnk-bar dual', title: `${p.label}: ${nameA} ${fmt(p.a)} · ${nameB} ${fmt(p.b)}` }, h('i', { style: `height:${pct(p.a)}%` }), h('i', { class: 'b', style: `height:${pct(p.b)}%` })))),
    h('div', { class: 'lnk-chart-x' }, h('span', null, points[0] ? points[0].label : ''), h('span', null, points.length ? points[points.length - 1].label : '')));
}

/* ======================= dashboard helpers (home page) ======================= */
const SVGNS = 'http://www.w3.org/2000/svg';

/** createElementNS helper for SVG (h() makes HTML elements only). */
export function svgEl(tag, attrs, ...children) {
  const el = document.createElementNS(SVGNS, tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null && v !== false) el.setAttribute(k, String(v));
  for (const c of children.flat(Infinity)) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
const reduceMotion = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

/** 1,234 → "1,234" · 12,300 → "12.3K" · 2,500,000 → "2.5M". */
export function compact(n) {
  n = Number(n || 0); const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (a >= 1e4) return `${(n / 1e3).toFixed(a >= 1e5 ? 0 : 1).replace(/\.0$/, '')}K`;
  return fmt(n);
}

/** Change between two periods → {pct, dir}. dir: up | down | flat | new (previous period was empty). */
export function delta(cur, prev) {
  cur = Number(cur || 0); prev = Number(prev || 0);
  if (!prev) return { pct: null, dir: cur ? 'new' : 'flat' };
  const pct = Math.round(((cur - prev) / prev) * 100);
  return { pct, dir: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat' };
}

/** Small "▲ 12%" chip comparing with the previous period of the same length. */
export function deltaChip(cur, prev) {
  const d = delta(cur, prev);
  const text = d.dir === 'new' ? 'ใหม่' : d.dir === 'flat' ? '0%' : `${d.pct > 0 ? '+' : ''}${fmt(d.pct)}%`;
  const arrow = d.dir === 'up' || d.dir === 'new' ? '▲' : d.dir === 'down' ? '▼' : '–';
  return h('span', { class: `dsh-delta ${d.dir === 'new' ? 'up' : d.dir}`, title: d.dir === 'new' ? 'ช่วงก่อนหน้ายังไม่มีข้อมูล' : `เทียบกับช่วงก่อนหน้า (${fmt(prev)} → ${fmt(cur)})` }, h('i', { 'aria-hidden': 'true' }, arrow), text);
}

/** Count the number shown in `el` from `from` to `to` (skipped when the user prefers reduced motion or nothing changes). */
export function countUp(el, to, from = 0, { ms = 650, decimals = 0 } = {}) {
  const fin = (v) => (decimals ? Number(v).toLocaleString('th-TH', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : fmt(Math.round(v)));
  to = Number(to || 0); from = Number(from || 0);
  if (reduceMotion() || from === to || !Number.isFinite(to)) { el.textContent = fin(to); return; }
  const t0 = performance.now();
  const step = (t) => { const k = Math.min(1, (t - t0) / ms); const e = 1 - (1 - k) ** 3; el.textContent = fin(from + (to - from) * e); if (k < 1 && el.isConnected) requestAnimationFrame(step); else el.textContent = fin(to); };
  requestAnimationFrame(step);
}

/** Tiny trend line (no axes). values: number[] */
export function sparkline(values, { w = 92, height = 30, cls = '' } = {}) {
  const v = values.length > 1 ? values : [0, ...values, 0];
  const max = Math.max(1, ...v); const pad = 2;
  const x = (i) => pad + (i * (w - pad * 2)) / (v.length - 1);
  const y = (n) => height - pad - (n / max) * (height - pad * 2);
  const line = v.map((n, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(n).toFixed(1)}`).join('');
  return svgEl('svg', { class: `dsh-spark ${cls}`, viewBox: `0 0 ${w} ${height}`, width: w, height, 'aria-hidden': 'true', focusable: 'false' },
    svgEl('path', { d: `${line}L${x(v.length - 1).toFixed(1)} ${height}L${x(0).toFixed(1)} ${height}Z`, class: 'sp-area' }),
    svgEl('path', { d: line, class: 'sp-line', fill: 'none' }));
}

function niceMax(m) { if (m <= 4) return 4; const p = 10 ** Math.floor(Math.log10(m)); const f = m / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; }

/** Monotone cubic path through points (never dips below the data like Catmull-Rom would). */
function smoothPath(pts) {
  const n = pts.length;
  if (n < 2) return pts.length ? `M${pts[0][0]} ${pts[0][1]}` : '';
  const dx = []; const m = []; const s = [];
  for (let i = 0; i < n - 1; i += 1) { dx[i] = pts[i + 1][0] - pts[i][0] || 1; m[i] = (pts[i + 1][1] - pts[i][1]) / dx[i]; }
  s[0] = m[0]; s[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i += 1) s[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i += 1) {
    if (m[i] === 0) { s[i] = 0; s[i + 1] = 0; } else {
      const a = s[i] / m[i]; const b = s[i + 1] / m[i]; const r = a * a + b * b;
      if (r > 9) { const t = 3 / Math.sqrt(r); s[i] = t * a * m[i]; s[i + 1] = t * b * m[i]; }
    }
  }
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i += 1) { const h3 = dx[i] / 3; d += `C${(pts[i][0] + h3).toFixed(1)} ${(pts[i][1] + s[i] * h3).toFixed(1)} ${(pts[i + 1][0] - h3).toFixed(1)} ${(pts[i + 1][1] - s[i + 1] * h3).toFixed(1)} ${pts[i + 1][0].toFixed(1)} ${pts[i + 1][1].toFixed(1)}`; }
  return d;
}

/**
 * Interactive trend chart (SVG, no library). Hover / touch-drag / ← → keys show a tooltip with every series; legend chips toggle a series.
 * @param {{d:string,[k:string]:any}[]} points one per day · @param {{key:string,label:string,cls:string,off?:boolean}[]} series
 */
export function areaChart(points, series, { height = 250, label = 'กราฟแนวโน้ม' } = {}) {
  const st = series.map((s) => ({ ...s, on: !s.off }));
  const fig = h('figure', { class: 'dsh-chart', tabindex: '0', role: 'group', 'aria-label': `${label}: ${series.map((s) => `${s.label} รวม ${fmt(points.reduce((a, p) => a + (p[s.key] || 0), 0))}`).join(' · ')}` });
  const legend = h('div', { class: 'dsh-legend' });
  const stage = h('div', { class: 'dsh-stage' });
  const tip = h('div', { class: 'dsh-tip', hidden: true, role: 'status' });
  fig.append(legend, stage, tip);
  let W = 0; let active = -1; let svg = null;
  const M = { l: 40, r: 10, t: 10, b: 24 };
  function drawLegend() {
    legend.replaceChildren(...st.map((s) => h('button', { class: `dsh-lg ${s.cls}`, type: 'button', 'aria-pressed': String(s.on), title: s.on ? `ซ่อน ${s.label}` : `แสดง ${s.label}`,
      onclick: () => { if (st.filter((x) => x.on).length === 1 && s.on) return; s.on = !s.on; drawLegend(); draw(); } }, h('i'), s.label, h('b', null, compact(points.reduce((a, p) => a + (p[s.key] || 0), 0))))));
  }
  function scales() {
    const on = st.filter((s) => s.on);
    const max = niceMax(Math.max(1, ...points.flatMap((p) => on.map((s) => p[s.key] || 0))));
    const iw = W - M.l - M.r; const ih = height - M.t - M.b; const n = Math.max(1, points.length - 1);
    return { max, iw, ih, x: (i) => M.l + (points.length > 1 ? (i * iw) / n : iw / 2), y: (v) => M.t + ih - (v / max) * ih };
  }
  function draw() {
    if (W < 120) return;
    const sc = scales(); const g = []; const ticks = 4;
    for (let i = 0; i <= ticks; i += 1) { const v = (sc.max * i) / ticks; const y = sc.y(v); g.push(svgEl('line', { x1: M.l, x2: W - M.r, y1: y, y2: y, class: i ? 'gl' : 'gl base' }), svgEl('text', { x: M.l - 8, y: y + 4, class: 'ax', 'text-anchor': 'end' }, compact(v))); }
    const want = W < 420 ? 4 : 6; const every = Math.max(1, Math.ceil(points.length / want));
    points.forEach((p, i) => {
      if (i % every === 0 || i === points.length - 1) {
        if (i !== points.length - 1 && points.length - 1 - i < every * 0.6) return;
        g.push(svgEl('text', { x: sc.x(i), y: height - 6, class: 'ax', 'text-anchor': i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle' }, dayLabel(p.d)));
      }
    });
    st.forEach((s, si) => {
      if (!s.on) return;
      const pts = points.map((p, i) => [sc.x(i), sc.y(p[s.key] || 0)]); const line = smoothPath(pts);
      const gid = `dg${si}${Math.random().toString(36).slice(2, 6)}`;
      g.push(svgEl('defs', null, svgEl('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 }, svgEl('stop', { offset: '0%', class: `st1 ${s.cls}` }), svgEl('stop', { offset: '100%', class: `st2 ${s.cls}` }))));
      if (pts.length > 1) g.push(svgEl('path', { d: `${line}L${pts[pts.length - 1][0].toFixed(1)} ${sc.y(0)}L${pts[0][0].toFixed(1)} ${sc.y(0)}Z`, fill: `url(#${gid})`, class: `ar ${s.cls}` }));
      g.push(svgEl('path', { d: line, class: `ln ${s.cls}`, fill: 'none' }));
      if (pts.length <= 31) pts.forEach(([x, y]) => g.push(svgEl('circle', { cx: x, cy: y, r: 2.2, class: `pt ${s.cls}` })));
    });
    const cross = svgEl('line', { class: 'cross', y1: M.t, y2: M.t + sc.ih, x1: 0, x2: 0, visibility: 'hidden' });
    const dots = st.map((s) => svgEl('circle', { class: `dot ${s.cls}`, r: 4.5, visibility: 'hidden' }));
    const hit = svgEl('rect', { x: M.l, y: M.t, width: sc.iw, height: sc.ih, fill: 'transparent', class: 'hit' });
    svg = svgEl('svg', { class: 'dsh-svg', width: W, height, viewBox: `0 0 ${W} ${height}`, 'aria-hidden': 'true', focusable: 'false' }, g, cross, dots, hit);
    stage.replaceChildren(svg);
    const idxAt = (clientX) => { const r = svg.getBoundingClientRect(); const rel = (clientX - r.left - M.l) / (sc.iw || 1); return Math.max(0, Math.min(points.length - 1, Math.round(rel * (points.length - 1)))); };
    const show = (i) => {
      active = i; const p = points[i]; const x = sc.x(i);
      cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('visibility', 'visible');
      st.forEach((s, k) => { if (s.on) { dots[k].setAttribute('cx', x); dots[k].setAttribute('cy', sc.y(p[s.key] || 0)); dots[k].setAttribute('visibility', 'visible'); } else dots[k].setAttribute('visibility', 'hidden'); });
      tip.replaceChildren(h('b', null, new Date(`${p.d}T00:00:00+07:00`).toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short', year: '2-digit' })),
        ...st.filter((s) => s.on).map((s) => h('span', { class: `tp ${s.cls}` }, h('i'), s.label, h('strong', null, fmt(p[s.key] || 0)))));
      tip.hidden = false;
      const tw = tip.offsetWidth || 150;
      tip.style.left = `${x + 14 + tw > W ? Math.max(4, x - tw - 14) : Math.max(4, x + 14)}px`; tip.style.top = `${M.t + 6}px`;
    };
    const hide = () => { active = -1; tip.hidden = true; cross.setAttribute('visibility', 'hidden'); dots.forEach((d) => d.setAttribute('visibility', 'hidden')); };
    hit.addEventListener('pointermove', (e) => show(idxAt(e.clientX)));
    hit.addEventListener('pointerdown', (e) => show(idxAt(e.clientX)));
    hit.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
    fig.onkeydown = (e) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); show(Math.min(points.length - 1, active < 0 ? 0 : active + 1)); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); show(Math.max(0, active < 0 ? points.length - 1 : active - 1)); }
      else if (e.key === 'Escape') hide();
    };
    fig.onblur = hide;
  }
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { if (!fig.isConnected) { ro.disconnect(); return; } const w = Math.floor(stage.clientWidth); if (w && w !== W) { W = w; draw(); } }) : null;
  drawLegend();
  if (ro) ro.observe(stage); else { W = 640; draw(); }
  queueMicrotask(() => { if (!W && stage.clientWidth) { W = Math.floor(stage.clientWidth); draw(); } });
  return fig;
}

/** Donut with a legend. items: [{name, n}] · labelFn maps a name to display text. */
export function donut(items, labelFn, { size = 148, centre = null, sub = '' } = {}) {
  const total = items.reduce((a, x) => a + x.n, 0);
  const r = (size - 22) / 2; const c = 2 * Math.PI * r; let off = 0;
  const arcs = total ? items.map((x, i) => {
    const len = (x.n / total) * c;
    const a = svgEl('circle', { cx: size / 2, cy: size / 2, r, class: `dn dn-${i % 6}`, fill: 'none', 'stroke-width': 18, 'stroke-dasharray': `${Math.max(0, len - 2)} ${c - Math.max(0, len - 2)}`, 'stroke-dashoffset': -off, transform: `rotate(-90 ${size / 2} ${size / 2})` }, svgEl('title', null, `${labelFn(x.name)}: ${fmt(x.n)}`));
    off += len; return a;
  }) : [];
  const svg = svgEl('svg', { class: 'dsh-donut', viewBox: `0 0 ${size} ${size}`, width: size, height: size, role: 'img', 'aria-label': total ? items.map((x) => `${labelFn(x.name)} ${Math.round((x.n / total) * 100)}%`).join(', ') : 'ยังไม่มีข้อมูล' },
    svgEl('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', class: 'dn-bg', 'stroke-width': 18 }), arcs,
    svgEl('text', { x: size / 2, y: size / 2 + (sub ? 2 : 7), 'text-anchor': 'middle', class: 'dn-num' }, centre === null ? compact(total) : centre),
    sub ? svgEl('text', { x: size / 2, y: size / 2 + 20, 'text-anchor': 'middle', class: 'dn-sub' }, sub) : null);
  return h('div', { class: 'dsh-donut-wrap' }, svg, total
    ? h('ul', { class: 'dsh-dn-legend' }, items.map((x, i) => h('li', null, h('i', { class: `dn-${i % 6}` }), h('span', { title: labelFn(x.name) }, labelFn(x.name)), h('b', null, `${Math.round((x.n / total) * 100)}%`))))
    : h('p', { class: 'muted' }, 'ยังไม่มีข้อมูล'));
}

/** 24 cells (one per hour) whose colour strength shows when people visit. */
export function hourStrip(byHour) {
  const max = Math.max(1, ...byHour); const peak = byHour.indexOf(Math.max(...byHour));
  return h('div', { class: 'dsh-hours', role: 'img', 'aria-label': `ช่วงเวลาที่มีคนเข้าสูงสุดประมาณ ${String(peak).padStart(2, '0')}:00 น.` },
    h('div', { class: 'hrs' }, byHour.map((n, i) => h('span', { class: 'hr', style: `--k:${(n / max).toFixed(2)}`, title: `${String(i).padStart(2, '0')}:00 — ${fmt(n)} ครั้ง` }))),
    h('div', { class: 'hx' }, ['00', '06', '12', '18', '23'].map((x) => h('span', null, x))),
    byHour.some(Boolean) ? h('p', { class: 'hint' }, `ช่วงที่คนเข้ามากสุด ≈ ${String(peak).padStart(2, '0')}:00–${String((peak + 1) % 24).padStart(2, '0')}:00 น. (${fmt(byHour[peak])} ครั้ง)`) : null);
}
