import { ConversionError, LIMITS } from './common.js';

let pdfjsPromise = null;
export function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('../../vendor/pdf.min.mjs').then((m) => {
      m.GlobalWorkerOptions.workerSrc = new URL('../../vendor/pdf.worker.min.mjs', import.meta.url).href;
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
 * Convert a PDF with a text layer into Markdown (paragraphs, headings by font size, bullets).
 * Scanned PDFs have no text layer and need OCR, which is not supported.
 * @param {ArrayBuffer} buf
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
    const sizeChars = new Map();
    for (let p = 1; p <= total; p++) {
      if (opts.deadline) opts.deadline.check();
      if (opts.onProgress) opts.onProgress(p / total);
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const lines = itemsToLines(content.items);
      for (const l of lines) { const k = Math.round(l.fs); sizeChars.set(k, (sizeChars.get(k) || 0) + l.chars); }
      pages.push(lines);
      page.cleanup();
    }
    const allText = pages.flat().map((l) => l.text).join('');
    if (!allText.trim()) throw new ConversionError('PDF_NO_TEXT', 'PDF นี้ไม่มีข้อความที่เลือกคัดลอกได้ (อาจเป็นไฟล์สแกน) การอ่านข้อความจากภาพ (OCR) ยังไม่รองรับในเวอร์ชันนี้');

    let bodyFs = 10; let max = -1;
    for (const [k, v] of sizeChars) if (v > max) { max = v; bodyFs = k; }
    const out = [];
    for (const lines of pages) {
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
    warnings.push('การแปลง PDF ไม่จัดตารางให้อัตโนมัติ ข้อมูลในตารางจะแสดงเป็นข้อความธรรมดา');
    return { markdown: `${md}\n`, warnings };
  } finally { try { await pdf.destroy(); } catch { /* ignore */ } }
}
