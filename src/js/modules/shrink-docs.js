// PDF and Office (docx/pptx/xlsx) shrinking, all in the browser.
import { getJSZip } from './converters/common.js';

const toBlob = (c, q) => new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode'))), 'image/jpeg', q));

/** Office files are ZIPs: re-encode JPEG images in media folders, keep each only if smaller. */
export async function shrinkOffice(file, { maxDim, quality }) {
  const JSZip = await getJSZip(); const zip = await JSZip.loadAsync(file);
  const media = Object.keys(zip.files).filter((n) => /\/media\/[^/]+\.jpe?g$/i.test(n));
  for (const n of media) {
    const orig = await zip.file(n).async('blob');
    const bmp = await createImageBitmap(orig); const k = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const b = await toBlob(c, quality);
    if (b.size < orig.size) zip.file(n, b);
  }
  return { blob: await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 9 } }), images: media.length };
}

/** PDF: render each page to a JPEG and rebuild a PDF from the images. Text becomes an image (no selectable text). */
export async function shrinkPdf(file, { quality, scale = 1.4, onPage }) {
  const pdfjs = await import('../vendor/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, verbosity: 0 }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i); const base = p.getViewport({ scale: 1 }); const vp = p.getViewport({ scale });
    const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await p.render({ canvasContext: ctx, viewport: vp }).promise;
    pages.push({ w: base.width, h: base.height, pw: c.width, ph: c.height, jpg: new Uint8Array(await (await toBlob(c, quality)).arrayBuffer()) });
    if (onPage) onPage(i, doc.numPages);
  }
  return new Blob([buildPdf(pages)], { type: 'application/pdf' });
}

/** Minimal PDF writer: one DCT (JPEG) image per page. */
export function buildPdf(pages) {
  const enc = new TextEncoder(); const parts = []; const offs = []; let len = 0;
  const push = (d) => { const u = typeof d === 'string' ? enc.encode(d) : d; parts.push(u); len += u.length; };
  const obj = (n, body) => { offs[n] = len; push(`${n} 0 obj\n`); push(body); push('\nendobj\n'); };
  push('%PDF-1.4\n');
  const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>'); obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  pages.forEach((p, i) => {
    const n = 3 + i * 3; const content = `q ${p.w.toFixed(2)} 0 0 ${p.h.toFixed(2)} 0 0 cm /Im0 Do Q`;
    obj(n, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${p.w.toFixed(2)} ${p.h.toFixed(2)}] /Resources << /XObject << /Im0 ${n + 1} 0 R >> >> /Contents ${n + 2} 0 R >>`);
    offs[n + 1] = len; push(`${n + 1} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${p.pw} /Height ${p.ph} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpg.length} >>\nstream\n`); push(p.jpg); push('\nendstream\nendobj\n');
    obj(n + 2, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });
  const total = 3 + pages.length * 3; const xref = len;
  push(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let i = 1; i < total; i++) push(`${String(offs[i]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(parts);
}
