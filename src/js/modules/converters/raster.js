// Image helpers: PDF pages → PNG/JPG, image ↔ image, image → PDF, canvas → Blob.
import { ConversionError, getJSZip } from './common.js';
import { getPdfjs } from './pdf.js';
import { getPdfLib } from '../pdf/engine.js';
import { baseName } from '../../core/download.js';

export const IMAGE_MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };
const MAX_PIXELS = 36e6;

export const canvasToBlob = (canvas, mime, q = 0.92) => new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new ConversionError('ENCODE_FAILED', `เบราว์เซอร์นี้บันทึกเป็น ${mime} ไม่ได้`))), mime, q));

/** Decode an image File/Blob. Throws a friendly error for broken files. */
async function decode(blob) {
  try { return await createImageBitmap(blob); } catch { throw new ConversionError('CORRUPT', 'ไฟล์รูปภาพเสียหายหรืออ่านไม่ได้'); }
}

/** PNG/JPG/WEBP → PNG/JPG/WEBP (JPG gets a white background instead of black where the image is transparent). */
export async function convertImageTo(file, ext) {
  const bmp = await decode(file);
  try {
    const canvas = document.createElement('canvas'); canvas.width = bmp.width; canvas.height = bmp.height;
    const ctx = canvas.getContext('2d');
    if (ext === 'jpg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    ctx.drawImage(bmp, 0, 0);
    return await canvasToBlob(canvas, IMAGE_MIME[ext], 0.92);
  } finally { bmp.close(); }
}

/** One image → a one-page PDF (A4, image fitted inside a 10 mm margin; page turns landscape for wide images). */
export async function imageToPdf(file, title) {
  const lib = await getPdfLib();
  const bmp = await decode(file);
  const { width: w, height: h } = bmp; bmp.close();
  let bytes; let kind;
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (head[0] === 0xff && head[1] === 0xd8) { kind = 'jpg'; bytes = new Uint8Array(await file.arrayBuffer()); }
  else if (head[0] === 0x89 && head[1] === 0x50) { kind = 'png'; bytes = new Uint8Array(await file.arrayBuffer()); }
  else { kind = 'png'; bytes = new Uint8Array(await (await convertImageTo(file, 'png')).arrayBuffer()); }   // webp → png
  const pdf = await lib.PDFDocument.create(); pdf.setTitle(title || 'image'); pdf.setProducer('SAND Office Tools');
  let emb;
  try { emb = kind === 'jpg' ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes); } catch { throw new ConversionError('CORRUPT', 'ไฟล์รูปภาพเสียหายหรืออ่านไม่ได้'); }
  const landscape = w > h; const [pw, ph] = landscape ? [841.89, 595.28] : [595.28, 841.89]; const m = 28.35;
  const k = Math.min((pw - 2 * m) / w, (ph - 2 * m) / h, 1 * (72 / 96) * 4);   // never enlarge a small picture beyond 4× its 96-dpi size
  const dw = w * k, dh = h * k;
  const page = pdf.addPage([pw, ph]);
  page.drawImage(emb, { x: (pw - dw) / 2, y: (ph - dh) / 2, width: dw, height: dh });
  return new Blob([await pdf.save()], { type: 'application/pdf' });
}

/**
 * Render PDF pages to images. One page → one file; several → a ZIP of numbered files.
 * @param {ArrayBuffer} buf @param {'png'|'jpg'} ext @param {string} name source file name
 */
export async function pdfToImages(buf, ext, name, o = {}) {
  const pdfjs = await getPdfjs();
  let pdf;
  try { pdf = await pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise; } catch (e) {
    if (e && e.name === 'PasswordException') throw new ConversionError('ENCRYPTED', 'ไฟล์ PDF นี้ถูกป้องกันด้วยรหัสผ่าน กรุณาปลดล็อกก่อนแปลง');
    throw new ConversionError('CORRUPT', 'ไฟล์ PDF เสียหายหรือเปิดไม่ได้', String(e && e.message));
  }
  const warnings = [];
  try {
    const total = Math.min(pdf.numPages, 200);
    if (pdf.numPages > total) warnings.push(`PDF มี ${pdf.numPages} หน้า แปลงเฉพาะ ${total} หน้าแรก`);
    const files = [];
    for (let p = 1; p <= total; p++) {
      if (o.deadline) o.deadline.check();
      const page = await pdf.getPage(p);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(150 / 72, Math.sqrt(MAX_PIXELS / (base.width * base.height)));   // 150 dpi
      const vp = page.getViewport({ scale });
      const canvas = document.createElement('canvas'); canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      files.push(await canvasToBlob(canvas, IMAGE_MIME[ext], 0.9));
      canvas.width = 0; canvas.height = 0; page.cleanup();
      if (o.onProgress) o.onProgress(p / total);
    }
    if (files.length === 1) return { blob: files[0], filename: `${baseName(name)}.${ext}`, count: 1, warnings };
    const JSZip = await getJSZip(); const zip = new JSZip(); const pad = String(files.length).length;
    files.forEach((b, i) => zip.file(`${baseName(name)}-${String(i + 1).padStart(pad, '0')}.${ext}`, b));
    warnings.push(`PDF มีหลายหน้า จึงบันทึกเป็นไฟล์ ZIP ที่มีรูปหน้าละ 1 ไฟล์ (${files.length} ไฟล์)`);
    return { blob: await zip.generateAsync({ type: 'blob', compression: 'STORE' }), filename: `${baseName(name)}-${ext}.zip`, count: files.length, warnings };
  } finally { try { await pdf.destroy(); } catch { /* ignore */ } }
}
