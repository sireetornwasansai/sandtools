// QR Code dialog for a short URL (PNG / SVG download). Shared by the links and projects pages.
import { h, svgIcon } from './dom.js';
import { ICONS } from './icons.js';
import { downloadBlob } from './download.js';
import { modal } from './layers.js';
import { buildMatrix, toSvg, drawToCanvas } from '../modules/qr-engine.js';

export function showQr(url, title) {
  const canvas = h('canvas', { class: 'lnk-qr', 'aria-label': `QR Code ของ ${url}` });
  const m = buildMatrix(url, 'M'); const opts = { size: 360, margin: 2, fg: '#111827', bg: '#ffffff', style: 'square' };
  drawToCanvas(canvas, m, opts);
  const png = h('button', { class: 'btn', type: 'button', onclick: () => canvas.toBlob((b) => b && downloadBlob(b, `qr-${url.split('/').pop()}.png`)) }, svgIcon(ICONS.download, 16), 'PNG');
  const svg = h('button', { class: 'btn', type: 'button', onclick: () => downloadBlob(new Blob([toSvg(m, { ...opts, logo: null })], { type: 'image/svg+xml' }), `qr-${url.split('/').pop()}.svg`) }, svgIcon(ICONS.download, 16), 'SVG');
  const close = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => mm.close() }, 'ปิด');
  const mm = modal(title || 'QR Code', [h('div', { class: 'lnk-qr-wrap' }, canvas, h('code', { class: 'lnk-qr-url' }, url)), h('p', { class: 'hint' }, 'พิมพ์ลงโปสเตอร์หรือเอกสาร ผู้สแกนจะถูกนับในสถิติของลิงก์นี้')], [png, svg, close]);
}

