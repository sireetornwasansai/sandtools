// Glue between pdf.js and thai-fix.js: look at the text layer of an opened document and, when its Thai tone marks / vowels are mis-encoded
// (PDFs saved by Word for Mac, Quartz PDFContext + TH Sarabun …), repair the embedded fonts' ToUnicode maps and re-open the repaired file.
import { thaiGarbleScore, repairThaiMarks } from './thai-fix.js';

/** Text of up to `maxPages` evenly spaced pages (cheap: the point is only to see whether Thai text is garbled). */
async function sampleText(pdf, maxPages) {
  const n = pdf.numPages; const idx = [];
  if (n <= maxPages) for (let p = 1; p <= n; p++) idx.push(p);
  else for (let k = 0; k < maxPages; k++) idx.push(1 + Math.floor((k * (n - 1)) / (maxPages - 1)));
  let text = '';
  for (const p of idx) {
    try {
      const page = await pdf.getPage(p);
      const c = await page.getTextContent();
      for (const it of c.items) if (typeof it.str === 'string') text += it.str;
      page.cleanup();
    } catch { /* an unreadable page is simply not sampled */ }
  }
  return text;
}

/**
 * @param {any} pdf an opened pdf.js document
 * @param {{open:(bytes:Uint8Array)=>Promise<any>, getPdfLib:()=>Promise<any>, maxPages?:number}} o
 * @returns {Promise<{pdf:any, fixed:boolean, glyphs:number, unresolved:number, warning:string|null}>}
 *   `pdf` is the document to carry on with (a NEW document when repaired — the old one is destroyed).
 */
export async function repairThaiIfNeeded(pdf, o) {
  const none = { pdf, fixed: false, glyphs: 0, unresolved: 0, warning: null };
  let score;
  try { score = thaiGarbleScore(await sampleText(pdf, o.maxPages || 8)); } catch { return none; }
  if (!score.garbled) return none;
  const failed = { ...none, warning: 'ข้อความภาษาไทยใน PDF นี้ถูกเข้ารหัสวรรณยุกต์/สระผิด (พบบ่อยกับไฟล์ที่บันทึกจาก Word บน Mac) และซ่อมอัตโนมัติไม่สำเร็จ — วรรณยุกต์บางตัวอาจเพี้ยน กรุณาตรวจทานกับต้นฉบับ' };
  let r = null;
  try { r = await repairThaiMarks(await pdf.getData(), await o.getPdfLib()); } catch { r = null; }
  if (!r) return failed;
  let pdf2;
  try { pdf2 = await o.open(r.bytes); } catch { return failed; }
  try { await pdf.destroy(); } catch { /* ignore */ }
  return {
    pdf: pdf2, fixed: true, glyphs: r.glyphs, unresolved: r.unresolved,
    warning: `ซ่อมวรรณยุกต์/สระภาษาไทยที่ PDF เข้ารหัสผิด ${r.glyphs} ตัวอักษร (ตรวจจากรูปทรงอักษรในฟอนต์) — ควรตรวจทานข้อความกับต้นฉบับ${r.unresolved ? ` · ยังมี ${r.unresolved} ตัวที่ระบุไม่ได้` : ''}`
  };
}
