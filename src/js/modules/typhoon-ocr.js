// Typhoon OCR reader for the Saraban "receive letter" screen.
//
// Typhoon OCR (OpenTyphoon / SCB 10X) is a vision-language model trained for Thai + English documents. It reads Thai government letters (tone marks, Thai digits,
// letterhead, tables) much more accurately than the on-device Tesseract engine. The model itself runs on OpenTyphoon's servers, so the page never calls it directly:
// it sends ONE page image to our own Apps Script backend (Saraban op "ocr"), which holds the API key (Script property TYPHOON_API_KEY) and forwards it.
//
// Off by default — the backend reports `cfg.ocr.typhoon` only when the administrator set the key. When it is off, or a page fails, the page is read on the
// clerk's own device with Tesseract exactly as before (see converters/ocr.js), so reading never gets worse than the old behaviour.
// Only the first READ_MAX_PAGES pages are ever sent, and reading stops as soon as เลขที่ + เรื่อง + เรียน are found.

export const TYPHOON_DIM = 1800;          // longest side in px — what the Typhoon OCR package itself renders (target_image_dim)
export const TYPHOON_JPEG_Q = 0.9;
const MAX_UPSCALE = 2;                    // a small photo is enlarged at most 2×
const MIN_TEXT = 20;                      // shorter than this = the model returned nothing useful → read on the device instead
const HARD_OFF = new Set(['NOT_CONFIGURED', 'UNKNOWN_ACTION', 'FORBIDDEN', 'OCR_AUTH', 'BAD_FILE', 'FILE_TOO_LARGE']);   // never worth retrying in this session

const ENTITIES = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'" };

/**
 * Pure: Typhoon OCR v1.5 output → plain letter text that parseLetter() understands.
 * v1.5 returns Markdown with HTML tables, <figure> descriptions of pictures (e.g. the Garuda emblem, in Thai) and <page_number> tags — the figure text
 * is NOT part of the letter and would be mistaken for it, so it is removed; tables become one line per row.
 * @param {string} md
 */
export function typhoonToText(md) {
  let t = String(md == null ? '' : md).replace(/\r/g, '');
  t = t.replace(/<figure[^>]*>[\s\S]*?<\/figure>/gi, '\n').replace(/<figure[^>]*>[\s\S]*$/i, '\n');     // an unclosed <figure> (cut-off output) is dropped to the end
  t = t.replace(/<page_number>[\s\S]*?<\/page_number>/gi, '\n');
  t = t.replace(/<table[\s\S]*?<\/table>/gi, (tb) => tb.replace(/<br\s*\/?>/gi, ' ').replace(/<\/t[dh]>\s*/gi, '  ').replace(/<\/tr>\s*/gi, '\n').replace(/<[^>]+>/g, ''));
  t = t.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|h[1-6]|li)>/gi, '\n').replace(/<\/?[a-z][a-z0-9]*(?:\s[^<>\n]*)?\/?>/gi, '');
  t = t.replace(/&(?:nbsp|amp|lt|gt|quot|apos|#39);/g, (m) => ENTITIES[m] || m);
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');                                                         // ![](dummy.png) picture placeholders
  t = t.replace(/^```[a-z]*\s*$/gim, '').replace(/[ \t\u00a0\u200b]+/g, ' ').replace(/^ +| +$/gm, '').replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

/** Canvas → base64 JPEG (no data: prefix), resized so the longest side is TYPHOON_DIM, on a white background. */
export async function canvasToBase64Jpeg(canvas, dim = TYPHOON_DIM, quality = TYPHOON_JPEG_Q) {
  const long = Math.max(canvas.width, canvas.height) || 1; const k = Math.min(MAX_UPSCALE, dim / long);
  const out = document.createElement('canvas'); out.width = Math.max(1, Math.round(canvas.width * k)); out.height = Math.max(1, Math.round(canvas.height * k));
  const g = out.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, out.width, out.height); g.imageSmoothingQuality = 'high'; g.drawImage(canvas, 0, 0, out.width, out.height);
  const blob = await new Promise((res, rej) => out.toBlob((b) => (b ? res(b) : rej(new Error('canvas.toBlob failed'))), 'image/jpeg', quality));
  out.width = 0; out.height = 0;
  return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1] || ''); r.onerror = () => reject(new Error('อ่านภาพไม่สำเร็จ')); r.readAsDataURL(blob); });
}

/**
 * A page reader bound to the backend. `call(params)` must perform Saraban op "ocr" and resolve with `{text}`.
 * `page(canvas)` resolves with the page text, or null when this page should be read on the device instead (never throws).
 * After a permanent failure (not configured / key rejected / old backend) or two failures in a row the reader switches itself off for the rest of the session.
 * @param {(params:{data:string})=>Promise<{text:string}>} call
 * @param {{onStatus?:(s:string)=>void}} [o]
 */
export function createTyphoonReader(call, o = {}) {
  let off = false; let fails = 0; let used = 0;
  const say = (s) => { if (o.onStatus) { try { o.onStatus(s); } catch { /* status text only */ } } };
  return {
    get active() { return !off; },
    get used() { return used; },
    /** @param {HTMLCanvasElement} canvas */
    async page(canvas) {
      if (off) return null;
      try {
        say('กำลังอ่านด้วย Typhoon OCR');
        const r = await call({ data: await canvasToBase64Jpeg(canvas) });
        const text = typhoonToText(r && r.text);
        if (text.length < MIN_TEXT) throw Object.assign(new Error('empty'), { code: 'OCR_EMPTY' });
        fails = 0; used += 1; return text;
      } catch (e) {
        const code = e && e.code; fails += 1;
        if (HARD_OFF.has(code) || fails >= 2) off = true;
        say('Typhoon OCR ใช้ไม่ได้ในหน้านี้ — อ่านในเครื่องแทน');
        return null;
      }
    }
  };
}
