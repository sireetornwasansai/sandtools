// Markdown → PDF with correct Thai text, fully in the browser (no fonts to ship, no server).
// The page is laid out by the browser itself (so Thai shaping, stacked vowels and tone marks are always right), cut into A4 pages at
// block boundaries (table rows / list items for long blocks) and drawn into a PDF with pdf-lib. Pages are images: the text looks perfect
// but is not selectable — for selectable text use the "print / save as PDF" button, which hands the same HTML to the browser's own PDF printer.
import { ConversionError } from './common.js';
import { getPdfLib } from '../pdf/engine.js';
import { renderMarkdown } from '../markdown-render.js';
import { docCss } from './write-html.js';

const PAGE_W = 794, PAGE_H = 1123, MARGIN = 56;          // A4 at 96 dpi (CSS px)
const CW = PAGE_W - 2 * MARGIN, CH = PAGE_H - 2 * MARGIN;
const SCALE = 2;                                          // raster scale: ≈ 192 dpi
export const MAX_PAGES = 150;

/** Walk a block into break units: a block taller than a page is split into table rows / list items / children. */
function unitsOf(el, hostTop, out, owner, depth = 0) {
  const r = el.getBoundingClientRect(); const h = r.height;
  const kids = h > CH && depth < 4 ? (el.matches('table') ? [...el.querySelectorAll(':scope > thead > tr, :scope > tbody > tr, :scope > tr')] : el.matches('ul,ol,blockquote,div') ? [...el.children] : []) : [];
  if (!kids.length) { out.push({ top: r.top - hostTop, bottom: r.bottom - hostTop, owner }); return; }
  for (const k of kids) unitsOf(k, hostTop, out, owner, depth + 1);
}

/** @param {string} md @param {{title?:string,onProgress?:(f:number)=>void,deadline?:any,signal?:AbortSignal}} [o] */
export async function writePdf(md, o = {}) {
  const html = renderMarkdown(md, { remoteImages: false });
  const css = docCss('.sand-doc');
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-10000px;top:0;width:${CW}px;visibility:hidden;display:flow-root;pointer-events:none`;
  const st = document.createElement('style'); st.textContent = css;
  const doc = document.createElement('div'); doc.className = 'sand-doc'; doc.style.cssText = 'display:flow-root'; doc.innerHTML = html;
  host.append(st, doc); document.body.append(host);
  try {
    try { await document.fonts.ready; } catch { /* ignore */ }
    const blocks = [...doc.children];
    if (!blocks.length) throw new ConversionError('EMPTY_CONTENT', 'ไม่มีเนื้อหาให้สร้าง PDF');
    const hostTop = doc.getBoundingClientRect().top;
    /** @type {Array<{top:number,bottom:number,owner:number}>} */ const units = [];
    blocks.forEach((b, i) => unitsOf(b, hostTop, units, i));
    const mbs = blocks.map((b) => parseFloat(getComputedStyle(b).marginBottom) || 0);
    // greedy pagination at unit boundaries
    const starts = [0]; let s = 0;
    for (let k = 0; k < units.length; k++) {
      const u = units[k];
      const bottom = u.bottom + (k === units.length - 1 || units[k + 1].owner !== u.owner ? mbs[u.owner] : 0);
      if (bottom - s > CH + 0.5) {
        if (u.top - s > 1) { s = u.top; starts.push(s); }                     // push to next page
        while (bottom - s > CH + 0.5) { s += CH; starts.push(s); }          // a single unit taller than a page: hard slice
      }
    }
    const truncated = starts.length > MAX_PAGES;
    const pageStarts = starts.slice(0, MAX_PAGES);
    const serializer = new XMLSerializer();
    const tops = blocks.map((b) => b.getBoundingClientRect().top - hostTop);
    const bots = blocks.map((b, i) => b.getBoundingClientRect().bottom - hostTop + mbs[i]);
    const blockXml = blocks.map((b) => serializer.serializeToString(b));
    const lib = await getPdfLib();
    const pdf = await lib.PDFDocument.create();
    pdf.setTitle(o.title || 'document'); pdf.setProducer('SAND Office Tools'); pdf.setCreator('SAND Office Tools');
    const canvas = document.createElement('canvas'); canvas.width = PAGE_W * SCALE; canvas.height = PAGE_H * SCALE;
    const ctx = canvas.getContext('2d');
    for (let p = 0; p < pageStarts.length; p++) {
      if (o.deadline) o.deadline.check();
      if (o.signal && o.signal.aborted) throw new ConversionError('CANCELLED', '');
      const y0 = pageStarts[p], y1 = y0 + CH;
      const inc = blocks.map((_, i) => i).filter((i) => bots[i] > y0 + 0.5 && tops[i] < y1 - 0.5);
      const shift = inc.length ? tops[inc[0]] - y0 : 0;                        // first included block starts `shift` px below the page top (negative when sliced)
      const inner = inc.map((i) => blockXml[i]).join('');
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_W}" height="${PAGE_H}" viewBox="0 0 ${PAGE_W} ${PAGE_H}"><rect width="100%" height="100%" fill="#fff"/><foreignObject x="${MARGIN}" y="${MARGIN}" width="${CW}" height="${CH}"><div xmlns="http://www.w3.org/1999/xhtml" style="width:${CW}px;height:${CH}px;overflow:hidden"><style>${css}</style><div class="sand-doc" style="display:flow-root;position:relative;top:${shift}px">${inner}</div></div></foreignObject></svg>`;
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new ConversionError('RENDER_FAILED', 'เบราว์เซอร์นี้วาดหน้า PDF ไม่ได้ ลองใช้ปุ่ม “พิมพ์ / บันทึกเป็น PDF” แทน')); img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; });
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const jpg = await new Promise((res, rej) => { try { canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob'))), 'image/jpeg', 0.9); } catch (e) { rej(e); } })
        .catch(() => { throw new ConversionError('RENDER_FAILED', 'เบราว์เซอร์นี้ไม่อนุญาตให้บันทึกหน้า PDF ลองใช้ปุ่ม “พิมพ์ / บันทึกเป็น PDF” แทน'); });
      const emb = await pdf.embedJpg(new Uint8Array(await jpg.arrayBuffer()));
      const page = pdf.addPage([595.28, 841.89]);
      page.drawImage(emb, { x: 0, y: 0, width: 595.28, height: 841.89 });
      if (o.onProgress) o.onProgress((p + 1) / pageStarts.length);
    }
    canvas.width = 0; canvas.height = 0;
    const bytes = await pdf.save();
    return { blob: new Blob([bytes], { type: 'application/pdf' }), pages: pageStarts.length, truncated, total: starts.length };
  } finally { host.remove(); }
}

/** Open the browser's own print dialog for the document (choose "Save as PDF" → real selectable text). */
export function printDocument(html) {
  const f = document.createElement('iframe');
  f.setAttribute('aria-hidden', 'true'); f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  f.srcdoc = html;
  f.onload = () => { try { f.contentWindow.focus(); f.contentWindow.print(); } finally { setTimeout(() => f.remove(), 60000); } };
  document.body.append(f);
}
