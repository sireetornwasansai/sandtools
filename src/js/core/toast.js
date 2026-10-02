import { h } from './dom.js';

let region;
/** @param {string} message @param {'info'|'success'|'error'} [type] @param {number} [ms] */
export function toast(message, type = 'info', ms = 3500) {
  if (!region) {
    region = h('div', { class: 'toast-region', role: 'status', 'aria-live': 'polite' });
    document.body.append(region);
  }
  const t = h('div', { class: `toast toast-${type}` }, message);
  region.append(t);
  setTimeout(() => t.remove(), ms);
}
