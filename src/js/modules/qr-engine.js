// QR payload builders + matrix + SVG/Canvas renderers. DOM-free except drawToCanvas().
import QRCodeCore from '../vendor/qrcode-core.js';

/** Error-correction levels → vendored library constants. */
export const EC = { L: 1, M: 0, Q: 3, H: 2 };

/** Max reasonable payload so the code stays scannable (QR v40-L holds 2953 bytes). */
export const MAX_BYTES = 2900;

/** UTF-8 byte length. */
export function byteLength(text) { return new TextEncoder().encode(text).length; }
/** Binary string of UTF-8 bytes (the vendored encoder reads one char = one byte). */
function toByteString(text) { return Array.from(new TextEncoder().encode(text), (b) => String.fromCharCode(b)).join(''); }

/**
 * Build the module matrix for text.
 * @param {string} text @param {'L'|'M'|'Q'|'H'} level
 * @returns {{size:number,modules:boolean[][]}}
 */
export function buildMatrix(text, level = 'M') {
  if (!text) throw new Error('EMPTY');
  if (byteLength(text) > MAX_BYTES) throw new Error('TOO_LONG');
  const qr = new QRCodeCore(-1, EC[level]);
  qr.addData(toByteString(text));
  try { qr.make(); } catch (e) { throw new Error('TOO_LONG'); }
  const size = qr.getModuleCount();
  const modules = Array.from({ length: size }, (_, r) => Array.from({ length: size }, (_, c) => qr.isDark(r, c)));
  return { size, modules };
}

/* ---------------- payload builders ---------------- */
const wifiEsc = (s) => String(s).replace(/([\\;,:"])/g, '\\$1');
const vcEsc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([;,])/g, '\\$1');

/** @param {string} raw */
export function normalizeUrl(raw) {
  const t = raw.trim();
  if (!t) return '';
  return /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`;
}

export const PAYLOADS = {
  url: (f) => normalizeUrl(f.url || ''),
  text: (f) => f.text || '',
  wifi: (f) => {
    if (!f.ssid) return '';
    const enc = f.encryption || 'WPA';
    const pass = enc === 'nopass' ? '' : `P:${wifiEsc(f.password || '')};`;
    return `WIFI:T:${enc};S:${wifiEsc(f.ssid)};${pass}${f.hidden ? 'H:true;' : ''};`;
  },
  email: (f) => {
    if (!f.email) return '';
    const q = [];
    if (f.subject) q.push(`subject=${encodeURIComponent(f.subject)}`);
    if (f.body) q.push(`body=${encodeURIComponent(f.body)}`);
    return `mailto:${f.email.trim()}${q.length ? `?${q.join('&')}` : ''}`;
  },
  phone: (f) => (f.phone ? `tel:${String(f.phone).replace(/[^\d+*#]/g, '')}` : ''),
  sms: (f) => {
    if (!f.phone) return '';
    const num = String(f.phone).replace(/[^\d+]/g, '');
    return f.message ? `sms:${num}?body=${encodeURIComponent(f.message)}` : `sms:${num}`;
  },
  vcard: (f) => {
    if (!(f.firstName || f.lastName || f.org)) return '';
    const lines = ['BEGIN:VCARD', 'VERSION:3.0', `N:${vcEsc(f.lastName)};${vcEsc(f.firstName)};;;`, `FN:${vcEsc([f.firstName, f.lastName].filter(Boolean).join(' ') || f.org)}`];
    if (f.org) lines.push(`ORG:${vcEsc(f.org)}`);
    if (f.title) lines.push(`TITLE:${vcEsc(f.title)}`);
    if (f.phone) lines.push(`TEL;TYPE=WORK,VOICE:${vcEsc(f.phone)}`);
    if (f.email) lines.push(`EMAIL:${vcEsc(f.email)}`);
    if (f.url) lines.push(`URL:${normalizeUrl(f.url)}`);
    if (f.address) lines.push(`ADR;TYPE=WORK:;;${vcEsc(f.address)};;;;`);
    lines.push('END:VCARD');
    return lines.join('\r\n');
  }
};

/* ---------------- renderers ---------------- */
/**
 * @typedef {{size:number,margin:number,fg:string,bg:string,style:'square'|'rounded'|'dots'}} RenderOpts
 */

/** Rounded-rect path for one module cell. */
function cellPath(x, y, s, style) {
  if (style === 'square') return `M${x} ${y}h${s}v${s}h${-s}z`;
  const r = style === 'dots' ? s / 2 : s * 0.32;
  return `M${x + r} ${y}h${s - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${s - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(s - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(s - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}z`;
}
const isFinder = (r, c, n) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);

/**
 * Vector SVG string. Finder patterns always stay square so scanners lock on reliably.
 * @param {{size:number,modules:boolean[][]}} m @param {RenderOpts & {logo?:{dataUrl:string,ratio:number}|null}} o
 */
export function toSvg(m, o) {
  const total = m.size + o.margin * 2;
  const parts = [];
  for (let r = 0; r < m.size; r++) for (let c = 0; c < m.size; c++) {
    if (!m.modules[r][c]) continue;
    parts.push(cellPath(c + o.margin, r + o.margin, 1, isFinder(r, c, m.size) ? 'square' : o.style));
  }
  let logo = '';
  if (o.logo) {
    const w = total * o.logo.ratio; const x = (total - w) / 2; const pad = w * 0.12;
    logo = `<rect x="${x - pad}" y="${x - pad}" width="${w + 2 * pad}" height="${w + 2 * pad}" rx="${w * 0.12}" fill="${o.bg}"/><image href="${o.logo.dataUrl}" x="${x}" y="${x}" width="${w}" height="${w}" preserveAspectRatio="xMidYMid meet"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${o.size}" height="${o.size}" shape-rendering="${o.style === 'square' ? 'crispEdges' : 'geometricPrecision'}"><rect width="${total}" height="${total}" fill="${o.bg}"/><path fill="${o.fg}" d="${parts.join('')}"/>${logo}</svg>`;
}

/**
 * Draw on a canvas at integer module scale (sharp edges).
 * @param {HTMLCanvasElement} canvas @param {{size:number,modules:boolean[][]}} m
 * @param {RenderOpts & {logoImage?:CanvasImageSource|null,logoRatio?:number}} o
 */
export function drawToCanvas(canvas, m, o) {
  const total = m.size + o.margin * 2;
  const scale = Math.max(1, Math.floor(o.size / total));
  const px = total * scale;
  canvas.width = px; canvas.height = px;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = o.bg; ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = o.fg;
  for (let r = 0; r < m.size; r++) for (let c = 0; c < m.size; c++) {
    if (!m.modules[r][c]) continue;
    const x = (c + o.margin) * scale; const y = (r + o.margin) * scale;
    const style = isFinder(r, c, m.size) ? 'square' : o.style;
    if (style === 'square') ctx.fillRect(x, y, scale, scale);
    else ctx.fill(new Path2D(cellPath(x, y, scale, style)));
  }
  if (o.logoImage) {
    const w = px * (o.logoRatio || 0.2); const x = (px - w) / 2; const pad = w * 0.12;
    ctx.fillStyle = o.bg;
    ctx.beginPath(); ctx.roundRect(x - pad, x - pad, w + 2 * pad, w + 2 * pad, w * 0.12); ctx.fill();
    const iw = /** @type {any} */ (o.logoImage).width || w; const ih = /** @type {any} */ (o.logoImage).height || w;
    const k = Math.min(w / iw, w / ih);
    ctx.drawImage(o.logoImage, x + (w - iw * k) / 2, x + (w - ih * k) / 2, iw * k, ih * k);
  }
  return px;
}

/** WCAG relative luminance contrast ratio between two #rrggbb colors. */
export function contrastRatio(a, b) {
  const lum = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
