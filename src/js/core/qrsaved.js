// Shared by the QR generator (modules/qr.js), the QR history page (modules/qr-history.js) and the links page:
// category/type lists, the backend call for saved QR codes, and helpers that rebuild a QR from a saved record.
import { getSession, signOut } from './auth.js';
import { gasCall } from './api.js';
import { PAYLOADS } from '../modules/qr-engine.js';

export const QR_TYPES = [
  ['url', 'ลิงก์ (URL)'], ['text', 'ข้อความ'], ['wifi', 'Wi-Fi'], ['email', 'อีเมล'], ['phone', 'โทรศัพท์'], ['sms', 'SMS'], ['vcard', 'นามบัตร (vCard)']
];
/** [id, label, caption placeholder] */
export const QR_CATS = [['general', 'ทั่วไป', ''], ['vaccine', 'งานวัคซีน', 'ลงทะเบียนรับวัคซีน'], ['hrd', 'งาน HRD / อบรม', 'ลงทะเบียนอบรม'], ['queue', 'ลงทะเบียน / นัดหมาย / คิว', 'จองคิวเข้ารับบริการ'],
  ['survey', 'แบบประเมิน / ความพึงพอใจ', 'ประเมินความพึงพอใจ'], ['asset', 'ครุภัณฑ์ / ทรัพย์สิน', 'ทะเบียนครุภัณฑ์'], ['doc', 'เอกสาร / คู่มือ', 'ดาวน์โหลดเอกสาร']];
export const catLabel = (id) => (QR_CATS.find((c) => c[0] === id) || QR_CATS[0])[1];
export const typeLabel = (id) => (QR_TYPES.find((t) => t[0] === id) || [id, id])[1];
/** kind: 'qr' = tracked (encodes a short link, scans are counted) · 'qrs' = static copy kept only in the history · 'link' = plain short link */
export const KIND_LABEL = { qr: 'ติดตามสถิติ', qrs: 'เก็บประวัติ' };

export const shortUrl = (base, code) => `${String(base || location.origin).replace(/\/+$/, '')}/s/${code}`;

/** Call the backend "links" action (which also stores QR history). Signs the user out when the session is no longer valid. */
export async function linksCall(op, params = {}, timeout = 60000) {
  const s = getSession();
  if (!s) { const e = new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่'); /** @type {any} */ (e).code = 'INVALID_SESSION'; throw e; }
  try { return (await gasCall('links', { session: s.token, op, ...params }, timeout)).data; } catch (e) {
    if (e && (/** @type {any} */ (e).code === 'INVALID_SESSION' || /** @type {any} */ (e).code === 'DOMAIN_NOT_ALLOWED')) signOut();
    throw e;
  }
}

/** The saved form fields with the types the generator expects (the backend stores every value as text). */
export function savedForm(item) {
  const f = { ...((item && item.qr && item.qr.f) || {}) };
  if ('hidden' in f) f.hidden = f.hidden === true || f.hidden === 'true';
  return f;
}
/** What the QR encodes. Tracked QR → the short URL; static QR → rebuilt from the saved fields. '' when it cannot be rebuilt (e.g. Wi-Fi: the password is never stored). */
export function savedPayload(item, base) {
  if (!item) return '';
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
