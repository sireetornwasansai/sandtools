// QR Code dialog for a short URL (PNG / SVG download). Shared by the links and projects pages.
// When the record's code is given, the picture is also kept in Google Drive (once, automatically) and its URL is shown.
import { h, svgIcon } from './dom.js';
import { ICONS } from './icons.js';
import { downloadBlob } from './download.js';
import { modal } from './layers.js';
import { toast } from './toast.js';
import { buildMatrix, toSvg, drawToCanvas } from '../modules/qr-engine.js';
import { uploadQrImage } from './qrsaved.js';

const keptThisSession = new Set();

/**
 * @param {string} url what the QR encodes · @param {string} [title]
 * @param {{code?: string, hasImg?: boolean, imgUrl?: string}} [opts]
 */
export function showQr(url, title, opts = {}) {
  const canvas = h('canvas', { class: 'lnk-qr', 'aria-label': `QR Code ของ ${url}` });
  const m = buildMatrix(url, 'M'); const o = { size: 360, margin: 2, fg: '#111827', bg: '#ffffff', style: 'square' };
  drawToCanvas(canvas, m, o);
  const png = h('button', { class: 'btn', type: 'button', onclick: () => canvas.toBlob((b) => b && downloadBlob(b, `qr-${url.split('/').pop()}.png`)) }, svgIcon(ICONS.download, 16), 'PNG');
  const svg = h('button', { class: 'btn', type: 'button', onclick: () => downloadBlob(new Blob([toSvg(m, { ...o, logo: null })], { type: 'image/svg+xml' }), `qr-${url.split('/').pop()}.svg`) }, svgIcon(ICONS.download, 16), 'SVG');
  const close = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => mm.close() }, 'ปิด');
  const driveNote = h('p', { class: 'hint qr-drive', 'aria-live': 'polite', hidden: !opts.code });
  const showDrive = (imgUrl) => driveNote.replaceChildren('รูป QR นี้เก็บไว้ใน Google Drive แล้ว ', imgUrl ? h('a', { href: imgUrl, target: '_blank', rel: 'noopener noreferrer' }, 'เปิดไฟล์') : '');
  const keepBtn = h('button', { class: 'btn', type: 'button', hidden: !opts.code, onclick: () => keep(false) }, svgIcon(ICONS.cloud, 16), 'เก็บรูปลง Drive');
  async function keep(auto) {
    if (!opts.code) return;
    keepBtn.disabled = true; driveNote.hidden = false; driveNote.textContent = 'กำลังเก็บรูปลง Drive…';
    try { const r = await uploadQrImage(opts.code, canvas); keptThisSession.add(opts.code); keepBtn.hidden = true; showDrive(r.imgUrl); if (!auto) toast('เก็บรูป QR ลง Drive แล้ว', 'success'); }
    catch (e) { driveNote.textContent = `เก็บรูปลง Drive ไม่สำเร็จ — ${e.message}`; keepBtn.hidden = false; keepBtn.disabled = false; if (!auto) toast(e.message, 'error', 6000); }
  }
  const mm = modal(title || 'QR Code', [h('div', { class: 'lnk-qr-wrap' }, canvas, h('code', { class: 'lnk-qr-url' }, url)), h('p', { class: 'hint' }, 'พิมพ์ลงโปสเตอร์หรือเอกสาร ผู้สแกนจะถูกนับในสถิติของลิงก์นี้'), driveNote], [keepBtn, png, svg, close]);
  if (opts.code) { if (opts.hasImg || keptThisSession.has(opts.code)) { keepBtn.hidden = true; showDrive(opts.imgUrl); } else keep(true); }   // first time this QR is shown: record the picture automatically
}
