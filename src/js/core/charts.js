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
  return h('section', { class: 'lnk-break' }, h('h3', null, title), total
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
