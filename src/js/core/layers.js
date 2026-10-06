// Shared layer helpers: stacked drawers / modals with Esc + click-outside + focus return, and two ready-made dialogs.
import { h, field } from './dom.js';

const layers = [];
/** Close every open layer (used when a page is left). */
export function closeAllLayers() { layers.slice().reverse().forEach((l) => l.close()); }
function onKey(e) { if (e.key === 'Escape' && layers.length) { e.stopPropagation(); layers[layers.length - 1].dismiss(); } }
/** Show `wrap` as the top layer. Esc / click outside call onDismiss (default: close). Returns close(). */
export function addLayer(wrap, { onClose, onDismiss } = {}) {
  const opener = document.activeElement;
  let closed = false;
  const entry = { dismiss: () => (onDismiss ? onDismiss() : close()), close: () => close() };
  function close() {
    if (closed) return; closed = true;
    const i = layers.indexOf(entry); if (i >= 0) layers.splice(i, 1);
    if (!layers.length) document.removeEventListener('keydown', onKey, true);
    wrap.remove();
    if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus({ preventScroll: true });
    if (onClose) onClose();
  }
  if (!layers.length) document.addEventListener('keydown', onKey, true);
  layers.push(entry);
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) entry.dismiss(); });
  document.body.append(wrap);
  const first = wrap.querySelector('input, textarea, select, button');
  if (first) first.focus({ preventScroll: true });
  return close;
}

export function modal(title, bodyEls, buttons, { wide = false, onDismiss, onClose } = {}) {
  const box = h('div', { class: `modal${wide ? ' modal-wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('h2', null, title), ...bodyEls, h('div', { class: 'btn-row modal-actions' }, buttons));
  const close = addLayer(h('div', { class: 'modal-wrap' }, box), { onDismiss, onClose });
  return { close, box };
}

export function askText({ title, label, value = '', confirm = 'ตกลง', hint, suggestions }) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'text', maxlength: 120, value, autocomplete: 'off' });
    const f = field(label, input, hint);
    const chips = suggestions ? h('div', { class: 'chip-row' }, suggestions.map((s) => h('button', { class: 'chip', type: 'button', onclick: () => { input.value = s; input.focus(); } }, s))) : null;
    let done = false, m = null;
    const finish = (v) => { if (done) return; done = true; resolve(v); if (m) m.close(); };
    const ok = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { const v = input.value.trim(); if (v) finish(v); else input.focus(); } }, confirm);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ok.click(); } });
    m = modal(title, [f.root, chips], [ok, h('button', { class: 'btn', type: 'button', onclick: () => finish(null) }, 'ยกเลิก')], { onDismiss: () => finish(null), onClose: () => finish(null) });
    input.select();
  });
}

export function confirmBox({ title, message, confirm = 'ยืนยัน', danger = false }) {
  return new Promise((resolve) => {
    let done = false, m = null;
    const finish = (v) => { if (done) return; done = true; resolve(v); if (m) m.close(); };
    const ok = h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'button', onclick: () => finish(true) }, confirm);
    m = modal(title, [h('p', null, message)], [ok, h('button', { class: 'btn', type: 'button', onclick: () => finish(false) }, 'ยกเลิก')], { onDismiss: () => finish(false), onClose: () => finish(false) });
    ok.focus();
  });
}

