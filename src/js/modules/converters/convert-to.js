// Any supported file → a format the user picks. Design: every document is first read into a common model
// (Markdown for text documents, sheets for spreadsheets), then written by the writer for the chosen target. Runs 100% in the browser.
import { ConversionError, Deadline, withTimeout, getJSZip, LIMITS } from './common.js';
import { prepareFile, detectFormat } from './index.js';
import { convertPdf } from './pdf.js';
import { convertDocx } from './docx.js';
import { convertPptx } from './pptx.js';
import { readXlsx } from './xlsx.js';
import { parseCsv } from './csv.js';
import { convertHtml, convertText } from './misc.js';
import { mdTable } from './common.js';
import { markdownToText, markdownTables } from './write-text.js';
import { writeXlsx, writeCsv, writeJson } from './write-sheets.js';
import { writeDocx } from './write-docx.js';
import { DOCX_FONTS, DEFAULT_FONT_CHOICE } from './docx-fonts.js';
import { markdownToHtmlDoc } from './write-html.js';
import { writePdf } from './write-pdf.js';
import { convertImageTo, imageToPdf, pdfToImages } from './raster.js';
import { decodeText, withExt, baseName } from '../../core/download.js';

/** Output formats. kind: 'text' = shown as text in the page, 'file' = binary download, 'image' = image preview. */
export const TARGETS = {
  pdf: { label: 'PDF', ext: 'pdf', mime: 'application/pdf', kind: 'file' },
  docx: { label: 'Word (.docx)', ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'file' },
  xlsx: { label: 'Excel (.xlsx)', ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', kind: 'file' },
  csv: { label: 'CSV', ext: 'csv', mime: 'text/csv', kind: 'text' },
  html: { label: 'HTML', ext: 'html', mime: 'text/html', kind: 'text' },
  txt: { label: 'ข้อความ (.txt)', ext: 'txt', mime: 'text/plain', kind: 'text' },
  md: { label: 'Markdown', ext: 'md', mime: 'text/markdown', kind: 'text' },
  json: { label: 'JSON', ext: 'json', mime: 'application/json', kind: 'text' },
  png: { label: 'รูป PNG', ext: 'png', mime: 'image/png', kind: 'image' },
  jpg: { label: 'รูป JPG', ext: 'jpg', mime: 'image/jpeg', kind: 'image' },
  webp: { label: 'รูป WEBP', ext: 'webp', mime: 'image/webp', kind: 'image' }
};
export const DEFAULT_TARGET = 'pdf';
/** Order in which the format chips are shown before a file has been chosen. */
export const ALL_TARGETS = ['pdf', 'docx', 'xlsx', 'csv', 'html', 'txt', 'md', 'json', 'png', 'jpg', 'webp'];

const BY_SOURCE = {
  pdf: ['docx', 'xlsx', 'txt', 'md', 'html', 'png', 'jpg'],
  docx: ['pdf', 'xlsx', 'html', 'txt', 'md'],
  pptx: ['pdf', 'docx', 'xlsx', 'html', 'txt', 'md'],
  xlsx: ['pdf', 'docx', 'csv', 'json', 'html', 'txt', 'md'],
  xls: ['pdf', 'docx', 'csv', 'json', 'html', 'txt', 'md'],   // listed so the user gets the friendly "save as .xlsx first" message instead of a generic one
  csv: ['xlsx', 'pdf', 'docx', 'json', 'html', 'txt', 'md'],
  html: ['pdf', 'docx', 'xlsx', 'txt', 'md'],
  txt: ['pdf', 'docx', 'html', 'md'],
  md: ['pdf', 'docx', 'html', 'txt', 'xlsx'],
  image: ['pdf', 'png', 'jpg', 'webp', 'txt', 'docx', 'md']   // txt/docx/md read the text in the picture with OCR
};

/** Formats a file can be converted to (never its own format). */
export function targetsFor(name) {
  const id = detectFormat(name);
  if (!id || !BY_SOURCE[id]) return [];
  const own = String(name).toLowerCase().split('.').pop();
  return BY_SOURCE[id].filter((t) => t !== own && !(t === 'jpg' && own === 'jpeg'));
}

/** Plain text → Markdown that keeps every line break and shows markup characters literally. */
function plainToMd(text) {
  const esc = (l) => l.replace(/([\\`*_{}[\]<>#|~])/g, '\\$1').replace(/^(\s*)(\d+)([.)])/, '$1$2\\$3').replace(/^(\s*)([-+])(\s)/, '$1\\$2$3');
  return text.replace(/\r\n?/g, '\n').split(/\n{2,}/).map((p) => p.split('\n').map(esc).join('  \n')).join('\n\n');
}

async function ocrImage(file, o, warnings) {
  const { createOcrEngine } = await import('./ocr.js');
  const { tesseractToMarkdown } = await import('./ocr-layout.js');
  if (o.onStage) o.onStage('ocr');
  const engine = await createOcrEngine({ signal: o.signal, onStatus: o.onStatus });
  try {
    const bmp = await createImageBitmap(file).catch(() => { throw new ConversionError('CORRUPT', 'ไฟล์รูปภาพเสียหายหรืออ่านไม่ได้'); });
    const width = bmp.width; bmp.close();
    const r = tesseractToMarkdown(await engine.recognize(file), { width });
    if (!r.markdown.trim()) throw new ConversionError('PDF_NO_TEXT', 'ไม่พบข้อความในรูปนี้ (ภาพอาจเบลอ เอียง หรือไม่มีตัวอักษร)');
    warnings.push(`อ่านข้อความด้วย OCR (ความมั่นใจเฉลี่ย ${r.confidence}%) กรุณาตรวจทานกับต้นฉบับ`);
    return r.markdown;
  } finally { await engine.terminate(); }
}

/** Font installed note: the .docx names the font but cannot carry it. */
const fontNote = (font, detected, forced) => `ไฟล์ Word ใช้ฟอนต์ “${font.family}”${forced || !detected ? '' : ' ตามที่ใช้ใน PDF'} — ฟอนต์ไม่ได้ฝังไว้ในไฟล์ ต้องติดตั้งฟอนต์นี้ในเครื่องที่เปิดไฟล์ มิฉะนั้น Word จะแสดงด้วย ${font.alt} แทน (ขนาดตัวอักษรและการตัดบรรทัดอาจต่างไปเล็กน้อย)`;

/**
 * PDF → Word that keeps the look of the PDF: one Word section per page, paragraphs with the original indents / alignment, real tables
 * rebuilt from the ruling lines, pictures at their position, and the font of the PDF (TH Sarabun New / TH SarabunPSK ...) written by name.
 * Scanned pages are read with OCR and placed by the position of each recognised word.
 */
async function pdfToDocxLayout(buf, title, o, opts, warnings) {
  const [{ readPdfPages }, { layoutDocument }, { writeDocxLayout }, { getPdfjs }] = await Promise.all([
    import('./pdf-pages.js'), import('./pdf-layout.js'), import('./write-docx-layout.js'), import('./pdf.js')]);
  const pdfjs = await getPdfjs();
  let pdfLib = null;
  try { const { getPdfLib } = await import('../pdf/engine.js'); pdfLib = await getPdfLib(); } catch { pdfLib = null; }   // only needed to repair Thai tone marks (/ActualText)
  const r = await readPdfPages(buf, { ...o, pdfjs, pdfLib });
  warnings.push(...r.warnings);
  if (o.onStage) o.onStage('writing');
  if (o.onProgress) o.onProgress(0);
  const model = layoutDocument(r.pages);
  const w = await writeDocxLayout(model, { title, fontChoice: opts.docxFont || DEFAULT_FONT_CHOICE, fontUsage: r.fontUsage });
  if (o.onProgress) o.onProgress(1);
  const forced = !!opts.docxFont && opts.docxFont !== 'auto';
  warnings.push(fontNote(w.font, w.detected, forced));
  if (forced && w.detected && w.detected.id !== w.font.id) warnings.push(`PDF ใช้ฟอนต์ ${w.detected.label} แต่เลือกแสดงเป็น ${w.font.label} — ความกว้างตัวอักษรอาจต่างจากต้นฉบับเล็กน้อย`);
  if (r.pages.some((pg) => pg.ocr)) warnings.push('หน้าที่เป็นภาพสแกนถูกอ่านด้วย OCR และจัดตามตำแหน่งคำ ไม่มีฟอนต์เดิมให้ใช้ — โปรดตรวจทานข้อความกับต้นฉบับ');
  if (model.dropped) warnings.push(`เส้นหรือกรอบที่ซับซ้อน ${model.dropped} จุดไม่ถูกคัดลอก (เส้นเฉียง กราฟิก)`);
  return { blob: w.blob, pages: w.pages, font: w.font };
}

/** Read any text document or spreadsheet into the common model. @returns {Promise<{markdown:string,sheets?:Array<{name:string,rows:string[][]}>,warnings:string[]}>} */
async function readSource(id, file, buf, target, o) {
  switch (id) {
    case 'pdf': { const r = await convertPdf(buf, { ...o, tables: target === 'docx' || target === 'xlsx' }); return { markdown: r.markdown, warnings: r.warnings }; }
    case 'docx': return convertDocx(buf, o);
    case 'pptx': return convertPptx(buf, o);
    case 'xlsx': {
      const { sheets, warnings } = await readXlsx(buf, o);
      const md = sheets.map((s) => `## ${s.name}\n\n${s.rows.length ? mdTable(s.rows) : '_(ชีตนี้ไม่มีข้อมูล)_'}`).join('\n\n');
      return { markdown: `${md}\n`, sheets, warnings };
    }
    case 'csv': {
      const { rows, truncated } = parseCsv(decodeText(buf), undefined, LIMITS.maxRows);
      if (!rows.length) throw new ConversionError('EMPTY_CONTENT', 'ไฟล์ CSV ว่างเปล่า');
      return { markdown: `${mdTable(rows)}\n`, sheets: [{ name: baseName(file.name).slice(0, 31) || 'Sheet1', rows }], warnings: truncated ? [`ไฟล์มีมากกว่า ${LIMITS.maxRows.toLocaleString('en-US')} แถว แปลงเฉพาะส่วนต้น`] : [] };
    }
    case 'html': return convertHtml(buf);
    case 'txt': { const r = convertText(buf); return { markdown: r.markdown, plain: true, warnings: r.warnings }; }
    case 'md': return { markdown: convertText(buf).markdown, warnings: [] };
    default: throw new ConversionError('UNSUPPORTED', 'ไม่รองรับไฟล์ประเภทนี้');
  }
}

const NOTE_LAYOUT = 'Word/PowerPoint/PDF ถูกอ่านเป็นเนื้อหา (หัวข้อ ข้อความ รายการ ตาราง) แล้วจัดหน้าใหม่ จึงไม่ตรงหน้าตาต้นฉบับทุกจุด และรูปภาพ/กราฟไม่ถูกคัดลอก';

/**
 * Convert a File to the chosen target format.
 * @param {File} file @param {keyof typeof TARGETS} target
 * @param {{maxBytes:number,timeoutMs:number,onStage?:Function,onProgress?:(f:number)=>void,onStatus?:(s:string)=>void,ocr?:boolean,ocrTimeoutMs?:number,
 *   docxFont?:string,docxMode?:'layout'|'flow'}} opts docxFont = 'auto' | key of DOCX_FONTS (Word output); docxMode = PDF → Word: 'layout' keeps the page look (default), 'flow' = re-flowed text
 * @returns {Promise<{blob:Blob,filename:string,target:string,text?:string,markdown?:string,warnings:string[],ms:number,count?:number,pages?:number,font?:string}>}
 */
export async function convertTo(file, target, opts) {
  const t0 = performance.now();
  const T = TARGETS[target];
  if (!T) throw new ConversionError('UNSUPPORTED', 'ไม่รองรับรูปแบบปลายทางนี้');
  if (!targetsFor(file.name).includes(target)) throw new ConversionError('UNSUPPORTED', `ไฟล์ประเภทนี้แปลงเป็น ${T.label} ไม่ได้`);
  const { id, buf } = await prepareFile(file, opts);
  if (opts.onStage) opts.onStage('converting');
  const deadline = new Deadline(opts.timeoutMs);
  const ac = new AbortController();
  const ocrOn = opts.ocr !== false, ocrTimeoutMs = opts.ocrTimeoutMs || 15 * 60 * 1000;
  const o = { deadline, onProgress: opts.onProgress, onStage: opts.onStage, onStatus: opts.onStatus, signal: ac.signal, ocr: ocrOn, ocrTimeoutMs };
  const warnings = [];
  const out = (blob, extra = {}) => ({ blob, filename: withExt(file.name, T.ext), target, warnings, ms: Math.round(performance.now() - t0), ...extra });

  const run = async () => {
    // --- image targets
    if (id === 'image' && T.kind === 'image') return out(await convertImageTo(file, target));
    if (id === 'image' && target === 'pdf') return out(await imageToPdf(file, baseName(file.name)));
    if (id === 'pdf' && T.kind === 'image') { const r = await pdfToImages(buf, target, file.name, o); warnings.push(...r.warnings); return out(r.blob, { filename: r.filename, count: r.count }); }

    // --- PDF → Word keeping the look of the PDF (default); 'flow' falls through to the Markdown route below
    if (id === 'pdf' && target === 'docx' && opts.docxMode !== 'flow') {
      const r = await pdfToDocxLayout(buf, baseName(file.name), o, opts, warnings);
      return out(r.blob, { pages: r.pages, font: r.font.id });
    }

    // --- read into the common model
    let src;
    if (id === 'image') { const md = await ocrImage(file, o, warnings); src = { markdown: md, warnings: [] }; }
    else src = await readSource(id, file, buf, target, o);
    warnings.push(...(src.warnings || []));
    let md = src.markdown;
    if (src.plain && target !== 'md' && target !== 'txt') md = plainToMd(md);
    const title = baseName(file.name);
    if (opts.onStage) opts.onStage('writing');
    if (opts.onProgress) opts.onProgress(0);

    switch (target) {
      case 'md': { const text = md; return out(new Blob([text], { type: 'text/markdown;charset=utf-8' }), { text }); }
      case 'txt': { const text = id === 'txt' ? md : markdownToText(md); return out(new Blob([text], { type: 'text/plain;charset=utf-8' }), { text, markdown: md }); }
      case 'html': { const text = markdownToHtmlDoc(md, { title }); return out(new Blob([text], { type: 'text/html;charset=utf-8' }), { text, markdown: md }); }
      case 'json': { const text = writeJson(src.sheets); return out(new Blob([text], { type: 'application/json;charset=utf-8' }), { text }); }
      case 'csv': {
        const sheets = src.sheets || [];
        if (sheets.length === 1) { const text = writeCsv(sheets[0].rows); return out(new Blob([text], { type: 'text/csv;charset=utf-8' }), { text }); }
        const JSZip = await getJSZip(); const zip = new JSZip(); const used = new Set();
        sheets.forEach((s, i) => { let n = (s.name || `Sheet${i + 1}`).replace(/[\\/:*?"<>|]/g, '_'); while (used.has(n)) n += '_'; used.add(n); zip.file(`${n}.csv`, writeCsv(s.rows)); });
        warnings.push(`สมุดงานมี ${sheets.length} ชีต จึงบันทึกเป็นไฟล์ ZIP ที่มี CSV ชีตละ 1 ไฟล์`);
        return out(await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }), { filename: `${title}-csv.zip`, count: sheets.length });
      }
      case 'xlsx': {
        let sheets = src.sheets;
        if (!sheets) {
          sheets = markdownTables(md);
          if (!sheets.length) {
            warnings.push('ไม่พบตารางในเอกสาร จึงใส่ข้อความทีละบรรทัดลงในชีตเดียว');
            sheets = [{ name: title.slice(0, 31) || 'Sheet1', rows: markdownToText(md).split('\n').filter((l) => l.trim()).map((l) => [l]) }];
          } else if (id === 'pdf') warnings.push('ตารางใน PDF ตรวจจากตำแหน่งตัวอักษร อาจคลาดเคลื่อน โดยเฉพาะตารางที่ไม่มีเส้นหรือมีเซลล์ผสาน — ตรวจทานกับต้นฉบับ');
        }
        return out(await writeXlsx(sheets, { header: !!src.sheets || id !== 'pdf' }));
      }
      case 'docx': {
        const choice = opts.docxFont || DEFAULT_FONT_CHOICE; const forced = choice !== 'auto';
        const font = forced && DOCX_FONTS[choice] ? DOCX_FONTS[choice] : DOCX_FONTS.Tahoma;
        const r = await writeDocx(md, { title, font });
        if (r.images) warnings.push(`รูปภาพ ${r.images} รูปแทนด้วยข้อความ [รูปภาพ]`);
        if (id === 'pdf') warnings.push('โหมดจัดเรียงใหม่: ได้ข้อความ หัวข้อ รายการ และตารางที่จัดเรียงใหม่ ไม่ใช่หน้าตาเดียวกับต้นฉบับ (เลือก “คงหน้าตาเดิม” ถ้าต้องการให้เหมือน PDF)');
        if (font.id !== 'Tahoma') warnings.push(fontNote(font, null, true));
        return out(r.blob, { font: font.id });
      }
      case 'pdf': {
        const r = await writePdf(md, { title, onProgress: opts.onProgress, deadline, signal: ac.signal });
        if (r.truncated) warnings.push(`เอกสารยาว ${r.total} หน้า สร้าง PDF เฉพาะ ${r.pages} หน้าแรก`);
        warnings.push('หน้า PDF ที่สร้างเป็นภาพหน้ากระดาษ (ตัวอักษรไทยถูกต้อง แต่เลือก/ค้นหาข้อความไม่ได้) — ถ้าต้องการข้อความที่เลือกได้ ให้กด “พิมพ์ / บันทึกเป็น PDF”');
        if (id !== 'csv' && id !== 'xlsx' && id !== 'txt' && id !== 'md') warnings.push(NOTE_LAYOUT);
        return out(r.blob, { markdown: md, count: r.pages });
      }
      default: throw new ConversionError('UNSUPPORTED', 'ไม่รองรับรูปแบบปลายทางนี้');
    }
  };
  let r;
  try { r = await withTimeout(run(), (id === 'pdf' || id === 'image') && ocrOn ? opts.timeoutMs + ocrTimeoutMs : opts.timeoutMs); } catch (e) { ac.abort(); throw e; }
  return r;
}
