// Shared by the QR generator (modules/qr.js), the QR history page (modules/qr-history.js) and the links page:
// category/type lists, the backend call for saved QR codes, and helpers that rebuild a QR from a saved record.
import { getSession, signOut } from './auth.js';
import { gasCall } from './api.js';
import { PAYLOADS, buildMatrix, drawToCanvas } from '../modules/qr-engine.js';

export const QR_TYPES = [
  ['url', 'ลิงก์ (URL)'], ['text', 'ข้อความ'], ['wifi', 'Wi-Fi'], ['email', 'อีเมล'], ['phone', 'โทรศัพท์'], ['sms', 'SMS'], ['vcard', 'นามบัตร (vCard)']
];
/** [id, label, caption placeholder] */
export const QR_CATS = [['general', 'ทั่วไป', ''], ['vaccine', 'งานวัคซีน', 'ลงทะเบียนรับวัคซีน'], ['hrd', 'งาน HRD / อบรม', 'ลงทะเบียนอบรม'], ['queue', 'ลงทะเบียน / นัดหมาย / คิว', 'จองคิวเข้ารับบริการ'],
  ['survey', 'แบบประเมิน / ความพึงพอใจ', 'ประเมินความพึงพอใจ'], ['asset', 'ครุภัณฑ์ / ทรัพย์สิน', 'ทะเบียนครุภัณฑ์'], ['doc', 'เอกสาร / คู่มือ', 'ดาวน์โหลดเอกสาร']];
export const catLabel = (id) => (QR_CATS.find((c) => c[0] === id) || QR_CATS[0])[1];
export const typeLabel = (id) => (QR_TYPES.find((t) => t[0] === id) || [id, id])[1];
/** kind: 'qr' = tracked (encodes a short link, scans are counted) · 'qrs' = static copy kept only in the history · 'qrx' = an OLD QR made elsewhere and attached (its picture is kept in Drive) · 'link' = plain short link */
export const KIND_LABEL = { qr: 'ติดตามสถิติ', qrs: 'เก็บประวัติ', qrx: 'QR เดิม (แนบ)' };
export const isQrKind = (k) => k === 'qr' || k === 'qrs' || k === 'qrx';

export const shortUrl = (base, code) => `${String(base || location.origin).replace(/\/+$/, '')}/s/${code}`;

/** Call the backend "links" action (which also stores QR history). Signs the user out when the session is no longer valid. */
export async function linksCall(op, params = {}, timeout = 60000) {
  if (op === 'create' || op === 'update' || op === 'saveimg') params = { origin: location.origin, ...params };   // lets the backend record the short URL when SHORT_BASE is not set
  const s = getSession();
  if (!s) { const e = new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่'); /** @type {any} */ (e).code = 'INVALID_SESSION'; throw e; }
  try { return (await gasCall('links', { session: s.token, op, ...params }, timeout)).data; } catch (e) {
    if (e && (/** @type {any} */ (e).code === 'INVALID_SESSION' || /** @type {any} */ (e).code === 'DOMAIN_NOT_ALLOWED')) signOut();
    throw e;
  }
}

const LIST_KEY = 'sand:links:list';
/** The last "list" answer kept in this browser, so pages can paint instantly and refresh behind the scenes. null when none / another user's. */
export function cachedLinksList() {
  try {
    const s = getSession(); const c = JSON.parse(localStorage.getItem(LIST_KEY) || 'null');
    return c && s && s.user && c.u === s.user.email && c.d && Array.isArray(c.d.items) ? c.d : null;   // ignore a cache entry that has no list (older/odd answer)
  } catch { return null; }
}
/** Fresh "list" from the backend (also stored for the next visit). */
export async function fetchLinksList() {
  const d = await linksCall('list');
  if (!d || !Array.isArray(d.items)) { const e = new Error('Backend ตอบรายการลิงก์/QR ไม่ครบ — Deploy Apps Script เวอร์ชันใหม่ (Code.gs, Links.gs, Analytics.gs) แล้วลองอีกครั้ง'); /** @type {any} */ (e).code = 'BAD_RESPONSE'; throw e; }
  try { const s = getSession(); const t = JSON.stringify({ u: s && s.user && s.user.email, d }); if (t.length < 1_500_000) localStorage.setItem(LIST_KEY, t); } catch { /* quota */ }
  return d;
}

/** The saved form fields with the types the generator expects (the backend stores every value as text). */
export function savedForm(item) {
  const f = { ...((item && item.qr && item.qr.f) || {}) };
  if ('hidden' in f) f.hidden = f.hidden === true || f.hidden === 'true';
  return f;
}
/** What the QR encodes. Tracked QR → the short URL; static QR → rebuilt from the saved fields. '' when it cannot be rebuilt (e.g. Wi-Fi: the password is never stored). */
export function savedPayload(item, base) {
  if (!item || item.kind === 'qrx') return '';   // an old QR is shown from its stored picture, never rebuilt
  if (item.kind === 'qr') return shortUrl(base, item.code);
  const q = item.qr || {}; const make = PAYLOADS[/** @type {keyof typeof PAYLOADS} */ (q.t)];
  if (!make) return '';
  if (q.t === 'wifi' && (savedForm(item).encryption || 'WPA') !== 'nopass') return '';
  return make(savedForm(item));
}
/** Render options saved with the QR (without the logo, which is never stored). */
export function savedDesign(item) {
  const d = (item && item.qr && item.qr.d) || {};
  return { size: d.size || 512, margin: d.margin ?? 4, fg: d.fg || '#000000', bg: d.bg || '#ffffff', style: d.style || 'square', ec: d.ec || 'M', cat: d.cat || 'general', cap: d.cap || '' };
}

/** Normalise whatever the backend answered for one record: {link, base} (current) · {item|data} wrappers · or the record itself (older deployments). null when nothing usable. */
function pickLink(d) {
  if (!d || typeof d !== 'object') return null;
  const c = d.link || d.item || d.data || (d.code ? d : null);
  return c && typeof c === 'object' && c.code ? c : null;
}

/**
 * One saved QR / link by code, for "open to edit". Tries the fast `get` op first; if the backend is older (no `get`, or an unexpected answer)
 * it falls back to the list (cached copy first, then a fresh one) so editing never depends on a particular Apps Script version.
 * @returns {Promise<{link: any, base: string}>}
 */
export async function fetchSavedItem(code) {
  let base = '';
  let lastErr = null;
  try {
    const d = await linksCall('get', { code });
    const link = pickLink(d);
    base = (d && d.base) || '';
    if (link) return { link: { ...link, kind: link.kind || 'link' }, base: base || (cachedLinksList() || {}).base || '' };
  } catch (e) {
    lastErr = e;
    const c = e && /** @type {any} */ (e).code;
    if (['NOT_FOUND', 'INVALID_SESSION', 'DOMAIN_NOT_ALLOWED', 'NETWORK', 'TIMEOUT'].includes(c)) throw e;
  }
  const pool = [];
  try { const c = cachedLinksList(); if (c) pool.push(c); } catch { /* ignore */ }
  for (let i = 0; i < 2; i += 1) {
    const hit = pool.map((l) => ({ l, it: (l.items || []).find((x) => x.code === code) })).find((x) => x.it);
    if (hit) return { link: { ...hit.it, kind: hit.it.kind || 'link' }, base: base || hit.l.base || '' };
    if (i === 0) pool.unshift(await fetchLinksList());
  }
  const err = new Error((lastErr && lastErr.message) || 'ไม่พบ QR นี้ หรือไม่มีสิทธิ์เข้าถึง');
  /** @type {any} */ (err).code = (lastErr && /** @type {any} */ (lastErr).code) || 'NOT_FOUND';
  throw err;
}

/* ------------------------- QR pictures (kept in Drive) ------------------------- */

/** The picture of a saved QR as a canvas (optionally with the caption bar). null when it cannot be rebuilt (Wi-Fi with a password, or an attached old QR → use fetchQrImage). */
export function renderSavedCanvas(item, base, { size, caption = false } = {}) {
  const payload = savedPayload(item, base); if (!payload) return null;
  const d = savedDesign(item); let matrix;
  try { matrix = buildMatrix(payload, d.ec); } catch { return null; }
  const qrCanvas = document.createElement('canvas');
  drawToCanvas(qrCanvas, matrix, { size: size || d.size, margin: d.margin, fg: d.fg, bg: d.bg, style: d.style, logoImage: null, logoRatio: 0 });
  if (!caption || !d.cap) return qrCanvas;
  const bar = Math.round(qrCanvas.width * 0.11); const out = document.createElement('canvas'); out.width = qrCanvas.width; out.height = qrCanvas.height + bar;
  const g = out.getContext('2d'); g.fillStyle = d.bg; g.fillRect(0, 0, out.width, out.height); g.drawImage(qrCanvas, 0, 0); g.fillStyle = d.fg;
  g.font = `600 ${Math.round(bar * 0.5)}px "Noto Sans Thai", Tahoma, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(d.cap, out.width / 2, qrCanvas.height + bar / 2, out.width * 0.92);
  return out;
}

/** base64 (no prefix) of a canvas as PNG. */
export function canvasToPngBase64(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob((b) => {
    if (!b) { reject(new Error('สร้างไฟล์ PNG ไม่สำเร็จ')); return; }
    const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1] || ''); r.onerror = () => reject(new Error('อ่านรูปไม่สำเร็จ')); r.readAsDataURL(b);
  }, 'image/png'));
}

const imgCache = new Map();
const NEEDS_DEPLOY = 'ฝั่ง Apps Script ยังเป็นเวอร์ชันเก่า (ยังไม่รองรับเก็บรูป QR) — วางไฟล์ Code.gs / Links.gs / Analytics.gs ใหม่ แล้ว Deploy เวอร์ชันใหม่';
/** Keep the picture in Drive (<DRIVE_FOLDER_ID>/<month>/<email>/QR) and record its URL in the Links sheet. Resolves to {link, imgUrl}. */
export async function uploadQrImage(code, canvas) {
  const data = await canvasToPngBase64(canvas);
  try { const r = await linksCall('saveimg', { code, data }, 120000); imgCache.delete(code); return r; } catch (e) {
    if (e && /** @type {any} */ (e).code === 'UNKNOWN_ACTION') e.message = NEEDS_DEPLOY;
    throw e;
  }
}
/** The stored picture of a record as a data: URL (preview of an attached old QR). Cached for the session. */
export async function fetchQrImage(code) {
  if (imgCache.has(code)) return imgCache.get(code);
  const d = await linksCall('getimg', { code });
  imgCache.set(code, d.dataUrl); return d.dataUrl;
}
