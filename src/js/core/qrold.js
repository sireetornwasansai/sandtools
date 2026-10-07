// OLD QR codes (made elsewhere) — attach them to the system, show their stored picture, and show thumbnails of any saved QR.
//  • attachOldQr()   dialog: upload the picture of an old QR → it is read in the browser (nothing is uploaded for reading), the address inside is
//                    suggested as the destination, the record (kind 'qrx') is saved and the picture is kept in Drive (<DRIVE_FOLDER_ID>/<month>/<email>/QR).
//  • qrThumb()       small picture of a saved QR (drawn for QR made here, loaded from Drive for attached old QR).
//  • showSavedQr()   dialog with the big picture, the URLs recorded for the row, and the link to the file in Drive.
import { h, field, svgIcon } from './dom.js';
import { ICONS } from './icons.js';
import { toast } from './toast.js';
import { modal } from './layers.js';
import { copyText, downloadBlob, safeFileName } from './download.js';
import { sessionCall } from './ops.js';
import { QR_CATS, linksCall, uploadQrImage, fetchQrImage, renderSavedCanvas, savedDesign, shortUrl, typeLabel } from './qrsaved.js';
import jsQR from '../vendor/jsqr.js';

const MAX_STORE_BYTES = 1_200_000;   // the server accepts up to 1.5 MB per picture
const CODE_ICON = ICONS.qr;

/** Which QR content type a decoded text is (same ids as QR_TYPES). */
export function guessType(text) {
  const t = String(text || '').trim();
  if (/^https?:\/\//i.test(t)) return 'url';
  if (/^WIFI:/i.test(t)) return 'wifi';
  if (/^mailto:/i.test(t)) return 'email';
  if (/^tel:/i.test(t)) return 'phone';
  if (/^smsto?:/i.test(t)) return 'sms';
  if (/^BEGIN:VCARD/i.test(t)) return 'vcard';
  return 'text';
}

/** Draw an image file onto a canvas no larger than `max` px on its longest side. */
async function fileToCanvas(file, max) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('เปิดไฟล์รูปไม่ได้ — ใช้ PNG / JPG / WEBP')); i.src = url; });
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
    const g = c.getContext('2d'); g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally { URL.revokeObjectURL(url); }
}
/** Read the QR inside a canvas. Tries two sizes (large photos decode better when reduced). null when none found. */
function readQr(canvas) {
  for (const max of [1400, 800, 500]) {
    const k = Math.min(1, max / Math.max(canvas.width, canvas.height));
    const c = k < 1 ? Object.assign(document.createElement('canvas'), { width: Math.round(canvas.width * k), height: Math.round(canvas.height * k) }) : canvas;
    if (c !== canvas) c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height);
    const r = jsQR(d.data, d.width, d.height, { inversionAttempts: 'attemptBoth' });
    if (r && r.data) return r.data;
  }
  return null;
}
/** Make the picture small enough to keep in Drive: scale down until the PNG is under the limit. */
async function fitForStorage(canvas) {
  let c = canvas;
  for (let i = 0; i < 6; i += 1) {
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    if (blob && blob.size <= MAX_STORE_BYTES) return c;
    const n = document.createElement('canvas'); n.width = Math.round(c.width * 0.75); n.height = Math.round(c.height * 0.75);
    n.getContext('2d').drawImage(c, 0, 0, n.width, n.height); c = n;
  }
  return c;
}

/**
 * Dialog "แนบ QR เดิม".
 * @param {{project?: string, base?: string, onDone?: (link: any) => void}} [opts]  project = pre-selected project key
 */
export async function attachOldQr({ project = '', onDone } = {}) {
  let canvas = null; let decoded = null; let busy = false; let mm = null;
  const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', 'aria-label': 'เลือกรูป QR เดิม' });
  const preview = h('div', { class: 'qro-preview', hidden: true });
  const status = h('p', { class: 'qro-status', role: 'status', 'aria-live': 'polite' }, 'เลือกรูป QR ที่เคยสร้างจากที่อื่น (ไฟล์รูป หรือภาพถ่าย/แคปหน้าจอของ QR)');
  const title = h('input', { type: 'text', maxlength: 120, placeholder: 'เช่น โปสเตอร์ลงทะเบียนวัคซีน (พิมพ์ปี 2568)' });
  const url = h('input', { type: 'text', inputmode: 'url', placeholder: 'https://… (ที่อยู่ที่ QR นี้พาไป)' });
  const note = h('input', { type: 'text', maxlength: 300, placeholder: 'ติดอยู่ที่ไหน / ใครสร้าง (ไม่บังคับ)' });
  const cat = h('select', { 'aria-label': 'หมวดงาน' }, QR_CATS.map(([v, t]) => h('option', { value: v }, t)));
  const proj = h('select', { 'aria-label': 'โครงการ' }, h('option', { value: '' }, '— ไม่แนบโครงการ —'));
  sessionCall('projects', 'names', {}, 30000).then((d) => { proj.replaceChildren(h('option', { value: '' }, '— ไม่แนบโครงการ —'), ...d.items.map((p) => h('option', { value: p.key }, p.name))); proj.value = project; }).catch(() => { /* optional */ });

  file.addEventListener('change', async () => {
    const f = file.files && file.files[0]; if (!f) return;
    if (f.size > 15 * 1024 * 1024) { toast('ไฟล์รูปใหญ่เกินไป (สูงสุด 15 MB)', 'error'); file.value = ''; return; }
    status.textContent = 'กำลังอ่าน QR จากรูป…'; decoded = null; canvas = null; preview.hidden = true;
    try {
      const full = await fileToCanvas(f, 2000);
      canvas = await fitForStorage(await fileToCanvas(f, 1024));
      decoded = readQr(full);
      const shown = canvas.cloneNode(); shown.getContext('2d').drawImage(canvas, 0, 0); shown.className = 'qro-img';
      preview.replaceChildren(shown); preview.hidden = false;
      if (decoded) {
        const t = guessType(decoded);
        status.replaceChildren(h('b', { class: 'status-ok' }, `✓ อ่าน QR ได้ — ชนิด: ${typeLabel(t)}`), t === 'wifi' ? h('span', { class: 'muted' }, ' (ไม่แสดงรหัสผ่าน Wi-Fi)') : h('code', { class: 'qro-decoded' }, decoded.length > 180 ? `${decoded.slice(0, 180)}…` : decoded));
        if (t === 'url' && !url.value) url.value = decoded;
        if (/^https?:\/\/[^/]*\/s\/[a-z0-9_-]{3,32}\/?$/i.test(decoded)) status.append(h('p', { class: 'hint' }, 'QR นี้ดูเหมือนลิงก์ย่อของระบบนี้อยู่แล้ว — ถ้าสร้างจากหน้า QR Code ไม่ต้องแนบซ้ำ'));
      } else status.replaceChildren(h('b', { class: 'status-err' }, 'อ่าน QR จากรูปนี้ไม่ได้'), h('span', { class: 'muted' }, ' — ยังแนบรูปไว้ได้ และพิมพ์ที่อยู่ปลายทางเอง (ถ้ามี) เพื่อให้ระบบนับสถิติให้'));
    } catch (e) { status.textContent = e.message; file.value = ''; }
  });

  const go = h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
    if (busy) return;
    if (!title.value.trim()) { title.focus(); toast('ตั้งชื่อ QR ก่อน เพื่อให้รู้ว่าเป็น QR ของอะไร', 'error'); return; }
    if (!canvas && !url.value.trim()) { toast('เลือกรูป QR หรือกรอกที่อยู่ปลายทางอย่างน้อยหนึ่งอย่าง', 'error'); return; }
    busy = true; go.disabled = true; go.classList.add('is-loading');
    try {
      const t = decoded ? guessType(decoded) : 'url';
      const d = { fg: '#000000', bg: '#ffffff', style: 'square', ec: 'M', margin: 4, size: 512, cat: cat.value, cap: '' };
      const r = await linksCall('create', { kind: 'qrx', title: title.value.trim(), note: note.value.trim(), url: url.value.trim(), project: proj.value, qr: { t, d } });
      let imgMsg = '';
      if (canvas) { try { await uploadQrImage(r.link.code, canvas); imgMsg = ' และเก็บรูปลง Drive แล้ว'; } catch (e) { imgMsg = ` แต่เก็บรูปลง Drive ไม่สำเร็จ (${e.message})`; } }
      toast(`แนบ QR เดิมแล้ว${imgMsg}`, imgMsg.includes('ไม่สำเร็จ') ? 'error' : 'success', 6000);
      mm.close(); if (onDone) onDone(r.link);
    } catch (e) { toast(e.message || 'แนบไม่สำเร็จ', 'error', 7000); busy = false; go.disabled = false; go.classList.remove('is-loading'); }
  } }, svgIcon(ICONS.upload, 18), 'แนบ QR นี้');
  mm = modal('แนบ QR เดิม', [
    h('p', { class: 'muted' }, 'QR ที่สร้างมาจากที่อื่นและพิมพ์ใช้งานไปแล้ว — แนบเพื่อเก็บรูปไว้ในระบบ (Google Drive) บันทึกที่อยู่ปลายทาง และดูสถิติ'),
    field('รูป QR เดิม', file).root, preview, status,
    field('ชื่อ QR (เป็น QR ของอะไร)', title).root, field('ที่อยู่ปลายทาง', url, 'ถ้า QR เดิมพาไปหน้าเว็บของโครงการที่ติดตั้งตัวนับสถิติแล้ว ระบบจะแสดงจำนวนการเปิดหน้านั้นให้ (QR เดิมนับจำนวนสแกนโดยตรงไม่ได้ เพราะไม่ผ่านลิงก์ย่อของระบบ)').root,
    h('div', { class: 'grid-2' }, field('หมวดงาน', cat).root, field('แนบกับโครงการ', proj).root), field('หมายเหตุ', note).root,
  ], [go, h('button', { class: 'btn', type: 'button', onclick: () => mm.close() }, 'ยกเลิก')], { wide: true });
}

/** Small picture of a saved QR. QR made here are drawn; an attached old QR is loaded from Drive when it scrolls in. */
export function qrThumb(item, base, size = 160) {
  const none = (title) => h('span', { class: 'qrh-nothumb', title }, svgIcon(ICONS.alert, 22));
  if (item.kind !== 'qrx') {
    const c = renderSavedCanvas(item, base, { size });
    if (!c) return none('QR นี้ต้องกรอกรหัสผ่านใหม่');
    c.className = 'qrh-thumb-img'; c.setAttribute('role', 'img'); c.setAttribute('aria-label', `QR Code: ${item.title}`); return c;
  }
  if (!item.hasImg) return h('span', { class: 'qrh-nothumb', title: 'ยังไม่มีรูป QR ที่เก็บไว้' }, svgIcon(CODE_ICON, 24));
  const img = h('img', { class: 'qrh-thumb-img qro-thumb', alt: `QR Code: ${item.title}`, loading: 'lazy', width: size, height: size });
  const load = () => fetchQrImage(item.code).then((u) => { img.src = u; }).catch(() => { img.replaceWith(none('โหลดรูปจาก Drive ไม่ได้')); });
  if ('IntersectionObserver' in window) { const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); load(); } }, { rootMargin: '120px' }); queueMicrotask(() => io.observe(img)); } else load();
  return img;
}

/** Dialog: big picture + every URL recorded for the row + link to the picture in Drive. */
export function showSavedQr(item, base) {
  const wrap = h('div', { class: 'lnk-qr-wrap' }, h('span', { class: 'skeleton', style: 'width:260px;height:260px' }));
  let blobGetter = null;
  if (item.kind === 'qrx') {
    if (!item.hasImg) wrap.replaceChildren(h('p', { class: 'muted' }, 'ยังไม่มีรูป QR ที่เก็บไว้ในระบบ'));
    else fetchQrImage(item.code).then((u) => { wrap.replaceChildren(h('img', { class: 'qro-big', src: u, alt: `QR Code: ${item.title}` })); blobGetter = async () => (await fetch(u)).blob(); }).catch((e) => wrap.replaceChildren(h('p', { class: 'status-err' }, e.message)));
  } else {
    const c = renderSavedCanvas(item, base, { size: Math.max(savedDesign(item).size, 512), caption: true });
    if (!c) wrap.replaceChildren(h('p', { class: 'muted' }, 'QR นี้มีรหัสผ่าน Wi-Fi ซึ่งไม่ได้เก็บไว้ — เปิดแก้ไขแล้วกรอกรหัสผ่านใหม่'));
    else { c.className = 'lnk-qr'; c.style.width = '260px'; wrap.replaceChildren(c); blobGetter = () => new Promise((r) => c.toBlob(r, 'image/png')); }
  }
  const short = item.short || (item.kind === 'qr' ? shortUrl(base, item.code) : '');
  const row = (label, value, href) => (value ? h('div', { class: 'qro-row' }, h('small', null, label), href ? h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, value) : h('span', null, value)) : null);
  const png = h('button', { class: 'btn', type: 'button', onclick: async () => { const b = blobGetter && await blobGetter(); if (b) downloadBlob(b, `${safeFileName(item.title, 'qr')}.png`); else toast('ยังไม่มีรูปให้ดาวน์โหลด', 'error'); } }, svgIcon(ICONS.download, 16), 'PNG');
  const copy = short ? h('button', { class: 'btn', type: 'button', onclick: async () => toast((await copyText(short)) ? 'คัดลอกลิงก์ย่อแล้ว' : 'คัดลอกไม่สำเร็จ', 'info') }, svgIcon(ICONS.copy, 16), 'คัดลอกลิงก์ย่อ') : null;
  const mm = modal(item.title || 'QR Code', [wrap, h('div', { class: 'qro-rows' },
    row('ที่มา', item.origin === 'import' ? 'แนบ QR เดิม (สร้างจากที่อื่น)' : 'สร้างในระบบนี้'), row('ลิงก์ย่อ (ที่ QR ใช้)', short, short), row('ปลายทาง', item.url, item.url),
    row('รูปใน Google Drive', item.imgUrl ? 'เปิดไฟล์ใน Drive' : '', item.imgUrl), row('รหัส', item.code))],
  [png, copy, h('button', { class: 'btn btn-primary', type: 'button', onclick: () => mm.close() }, 'ปิด')].filter(Boolean), { wide: true });
}
