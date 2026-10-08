import { ConversionError, LIMITS } from './common.js';
import { layoutToMarkdown } from './ocr-layout.js';

let pdfjsPromise = null;
export function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('../../vendor/pdf.min.mjs').then((m) => {
      m.GlobalWorkerOptions.workerSrc = new URL('../../vendor/pdf.worker.shim.mjs', import.meta.url).href;
      return m;
    });
    pdfjsPromise.catch(() => { pdfjsPromise = null; });
  }
  return pdfjsPromise;
}

const median = (arr) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

/** Group positioned text items of one page into visual lines. */
export function itemsToLines(items) {
  const clean = items
    .filter((it) => typeof it.str === 'string' && it.str !== '')
    .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width || 0, fs: Math.hypot(it.transform[0], it.transform[1]) || it.height || 10 }));
  clean.sort((a, b) => (b.y - a.y) || (a.x - b.x));
  const lines = [];
  for (const it of clean) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - it.y) <= Math.max(2, 0.6 * Math.min(last.fs, it.fs))) { last.items.push(it); last.fs = Math.max(last.fs, it.fs); }
    else lines.push({ y: it.y, fs: it.fs, items: [it] });
  }
  return lines.map((ln) => {
    ln.items.sort((a, b) => a.x - b.x);
    let text = ''; let prevEnd = null;
    for (const it of ln.items) {
      if (prevEnd !== null) {
        const gap = it.x - prevEnd;
        if (gap > 0.25 * ln.fs && !/\s$/.test(text) && !/^\s/.test(it.str)) text += ' ';
      }
      text += it.str;
      prevEnd = prevEnd === null ? it.x + it.w : Math.max(prevEnd, it.x + it.w); // combining marks sit inside the previous glyph
    }
    return { y: ln.y, fs: ln.fs, text: text.replace(/[ \t]+/g, ' ').trim(), chars: text.length };
  }).filter((l) => l.text);
}

const BULLET = /^[•●▪◦‣∙·\uF0B7\uF0A7\uF0D8\uF076–-]\s*/;

/**
 * Convert a PDF into Markdown (paragraphs, headings by font size, bullets).
 * Pages with a text layer are read directly. Pages without one (scans) are read with browser OCR (ocr.js, Thai + English)
 * unless `opts.ocr === false`.
 * @param {ArrayBuffer} buf
 * `opts.tables` (Word/Excel output) rebuilds text pages from the positioned text: tables become Markdown tables, big text becomes headings.
 * @param {{tables?:boolean,deadline?:any,onProgress?:(f:number)=>void,onStage?:(s:string)=>void,onStatus?:(s:string)=>void,signal?:AbortSignal,ocr?:boolean,ocrTimeoutMs?:number}} [opts]
 */
export async function convertPdf(buf, opts = {}) {
  const pdfjs = await getPdfjs();
  const task = pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 });
  let pdf;
  try { pdf = await task.promise; } catch (e) {
    const name = e && e.name;
    if (name === 'PasswordException') throw new ConversionError('ENCRYPTED', 'ไฟล์ PDF นี้ถูกป้องกันด้วยรหัสผ่าน กรุณาปลดล็อกก่อนแปลง');
    throw new ConversionError('CORRUPT', 'ไฟล์ PDF เสียหายหรือเปิดไม่ได้', String(e && e.message));
  }
  const warnings = [];
  try {
    const total = Math.min(pdf.numPages, LIMITS.maxPdfPages);
    if (pdf.numPages > total) warnings.push(`PDF มี ${pdf.numPages} หน้า แปลงเฉพาะ ${total} หน้าแรก`);
    const pages = [];
    /** @type {Array<{width:number,words:any[]}>} */ const wordsByPage = [];
    const sizeChars = new Map();
    for (let p = 1; p <= total; p++) {
      if (opts.deadline) opts.deadline.check();
      if (opts.onProgress) opts.onProgress(p / total);
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const lines = itemsToLines(content.items);
      for (const l of lines) { const k = Math.round(l.fs); sizeChars.set(k, (sizeChars.get(k) || 0) + l.chars); }
      pages.push(lines);
      if (opts.tables) {
        const [vx, vy, vx1, vy1] = page.view; const ph = vy1 - vy;
        wordsByPage[p - 1] = { width: vx1 - vx, words: content.items.filter((it) => typeof it.str === 'string' && it.str.trim()).map((it) => {
          const fs = Math.hypot(it.transform[0], it.transform[1]) || it.height || 10; const x = it.transform[4] - vx; const base = ph - (it.transform[5] - vy);
          return { text: it.str.trim(), bbox: { x0: x, y0: base - fs * 0.8, x1: x + (it.width || fs * it.str.length * 0.5), y1: base + fs * 0.2 }, confidence: 100 };
        }) };
      }
      page.cleanup();
    }
    const allText = pages.flat().map((l) => l.text).join('');
    const hasText = !!allText.trim();
    // pages with no text layer = scans → OCR (all pages of a fully scanned file, or just the image-only pages of a mixed file)
    // pages whose text layer is badly garbled (font without usable Unicode mapping: many control codes / private-use characters) are read with OCR as well
    const garbled = (lines) => { const t = lines.map((l) => l.text).join(''); const n = (t.match(/[\u0000-\u0008\u000e-\u001f\uE000-\uEFFF\uF100-\uF8FF\uFFFD]/g) || []).length; return n >= 8 && n > t.length * 0.06; };   // only badly garbled pages: OCR is slow, mild glitches keep the text layer
    const garbledPages = new Set(pages.map((l, i) => (l.length && garbled(l) ? i : -1)).filter((i) => i >= 0));
    const scanned = pages.map((l, i) => (!l.length || garbledPages.has(i) ? i : -1)).filter((i) => i >= 0);
    /** @type {Map<number,string>} */
    let ocrMd = new Map();
    if (scanned.length && opts.ocr !== false) {
      try {
        const { ocrPdfPages } = await import('./ocr.js');
        ocrMd = await ocrPdfPages(pdf, scanned, opts, warnings);
      } catch (e) {
        if (!hasText || (e && e.code === 'CANCELLED')) throw e;                // nothing else to show: surface the real reason
        warnings.push(`หน้าที่เป็นภาพสแกน (${scanned.length} หน้า) อ่านด้วย OCR ไม่สำเร็จ: ${e && e.message ? e.message : e}`);
      }
    }
    if (!hasText && ![...ocrMd.values()].some((t) => t.trim())) {
      throw new ConversionError('PDF_NO_TEXT', opts.ocr === false
        ? 'PDF นี้ไม่มีข้อความที่เลือกคัดลอกได้ (อาจเป็นไฟล์สแกน) และปิดการอ่านข้อความจากภาพ (OCR) ไว้'
        : 'ไม่พบข้อความใน PDF นี้ แม้ลองอ่านด้วย OCR แล้ว (ภาพอาจเบลอ เอียง หรือไม่มีตัวอักษร)');
    }
    if (scanned.length && opts.ocr === false && hasText) warnings.push(`PDF มี ${scanned.length} หน้าที่เป็นภาพสแกน ซึ่งไม่ได้อ่านข้อความ`);

    let bodyFs = 10; let max = -1;
    for (const [k, v] of sizeChars) if (v > max) { max = v; bodyFs = k; }
    const out = [];
    for (let pi = 0; pi < pages.length; pi++) {
      const lines = pages[pi];
      if (ocrMd.has(pi) && (ocrMd.get(pi).trim() || !garbledPages.has(pi))) { if (ocrMd.get(pi).trim()) out.push(ocrMd.get(pi)); continue; }
      if (opts.tables && wordsByPage[pi] && lines.length) { const m = layoutToMarkdown(wordsByPage[pi].words, { width: wordsByPage[pi].width, headings: true, bullets: true, cellGap: 0.85 }).markdown; if (m.trim()) out.push(m); continue; }
      const gaps = []; for (let i = 1; i < lines.length; i++) gaps.push(lines[i - 1].y - lines[i].y);
      const typical = median(gaps) || bodyFs * 1.3;
      let para = [];
      const flush = () => { if (para.length) { out.push(para.join('\n')); para = []; } };
      lines.forEach((l, i) => {
        const gap = i ? lines[i - 1].y - l.y : 0;
        const ratio = l.fs / bodyFs;
        const headingPrefix = l.text.length <= 120 && ratio >= 1.3 ? (ratio >= 1.8 ? '# ' : ratio >= 1.5 ? '## ' : '### ') : '';
        if (headingPrefix) { flush(); out.push(`${headingPrefix}${l.text}`); return; }
        if (i && gap > typical * 1.6) flush();
        para.push(BULLET.test(l.text) ? l.text.replace(BULLET, '* ') : l.text);
      });
      flush();
    }
    const raw = out.join('\n\n');
    const md = raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ''); // drop unmapped glyph control codes
    const bad = (raw.match(/[\u0000-\u0008\u000e-\u001f\uE000-\uF8FF\uFFFD]/g) || []).length;
    if (bad > Math.max(5, md.length * 0.03)) warnings.push('ข้อความบางส่วนอ่านไม่ออก เนื่องจากฟอนต์ใน PDF ไม่มีข้อมูลแปลงตัวอักษร (พบบ่อยกับภาษาไทย) แนะนำให้ส่งออก PDF ใหม่จากโปรแกรมต้นฉบับ');
    if (!opts.tables && pages.some((l) => l.length)) warnings.push('การแปลง PDF ไม่จัดตารางให้อัตโนมัติ ข้อมูลในตารางจะแสดงเป็นข้อความธรรมดา');
    return { markdown: `${md}\n`, warnings };
  } finally { try { await pdf.destroy(); } catch { /* ignore */ } }
}
