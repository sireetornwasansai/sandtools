import { ConversionError, Deadline, withTimeout, getJSZip } from './common.js';
import { convertDocx } from './docx.js';
import { convertPptx } from './pptx.js';
import { convertXlsx } from './xlsx.js';
import { convertCsv } from './csv.js';
import { convertPdf, getPdfjs } from './pdf.js';
import { convertHtml, convertText, convertImage } from './misc.js';
import { withExt, extOf, decodeText } from '../../core/download.js';

/** Supported input formats. `magic` validates the real content, not just the extension. */
export const FORMATS = {
  pdf: { label: 'PDF', exts: ['pdf'], mimes: ['application/pdf'] },
  docx: { label: 'Word', exts: ['docx'], mimes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'] },
  pptx: { label: 'PowerPoint', exts: ['pptx'], mimes: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'] },
  xlsx: { label: 'Excel', exts: ['xlsx'], mimes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'] },
  xls: { label: 'Excel (เก่า)', exts: ['xls'], mimes: ['application/vnd.ms-excel'] },
  csv: { label: 'CSV', exts: ['csv'], mimes: ['text/csv', 'application/csv', 'application/vnd.ms-excel', 'text/plain'] },
  html: { label: 'HTML', exts: ['html', 'htm'], mimes: ['text/html', 'application/xhtml+xml'] },
  txt: { label: 'ข้อความ', exts: ['txt'], mimes: ['text/plain'] },
  image: { label: 'รูปภาพ', exts: ['jpg', 'jpeg', 'png', 'webp'], mimes: ['image/jpeg', 'image/png', 'image/webp'] }
};
export const ACCEPT = Object.values(FORMATS).flatMap((f) => f.exts.map((e) => `.${e}`)).join(',');

/** @returns {keyof typeof FORMATS|null} */
export function detectFormat(name) {
  const ext = extOf(name);
  return /** @type {any} */ (Object.keys(FORMATS).find((k) => FORMATS[k].exts.includes(ext)) || null);
}

const startsWith = (bytes, sig, offset = 0) => sig.every((b, i) => bytes[offset + i] === b);

/** Verify the file really is what its extension claims. */
function validateMagic(id, bytes) {
  const head = bytes.subarray(0, 1024);
  const ole = startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0]);
  const zip = startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]);
  if (id === 'pdf') { if (!new TextDecoder('latin1').decode(head).includes('%PDF-')) throw new ConversionError('MISMATCH', 'เนื้อหาไฟล์ไม่ใช่ PDF ที่ถูกต้อง'); }
  else if (id === 'docx' || id === 'pptx' || id === 'xlsx') {
    if (ole) throw new ConversionError('ENCRYPTED_OR_LEGACY', 'ไฟล์นี้ถูกป้องกันด้วยรหัสผ่าน หรือเป็นรูปแบบเก่า กรุณาบันทึกเป็น .docx/.pptx/.xlsx ที่ไม่มีรหัสผ่านก่อน');
    if (!zip) throw new ConversionError('MISMATCH', 'เนื้อหาไฟล์ไม่ตรงกับนามสกุลไฟล์ หรือไฟล์เสียหาย');
  } else if (id === 'xls') {
    throw new ConversionError('LEGACY_XLS', 'ยังไม่รองรับไฟล์ Excel รุ่นเก่า (.xls) กรุณาเปิดไฟล์ใน Excel แล้วบันทึกเป็น .xlsx จากนั้นลองใหม่');
  } else if (id === 'image') {
    const ok = startsWith(bytes, [0xff, 0xd8, 0xff]) || startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]) || (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8));
    if (!ok) throw new ConversionError('MISMATCH', 'เนื้อหาไฟล์ไม่ใช่รูปภาพที่รองรับ (JPG, PNG, WEBP)');
  } else if (zip || ole || startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) {
    throw new ConversionError('MISMATCH', 'เนื้อหาไฟล์ไม่ตรงกับนามสกุลไฟล์');
  }
}

function validateMime(id, type) {
  if (!type || type === 'application/octet-stream') return;
  if (!FORMATS[id].mimes.includes(type)) throw new ConversionError('MISMATCH', 'ชนิดไฟล์ (MIME) ไม่ตรงกับนามสกุลไฟล์', `mime=${type}`);
}

/**
 * Convert a File to Markdown entirely in the browser.
 * @param {File} file
 * @param {{maxBytes:number,timeoutMs:number,onStage?:(s:'reading'|'converting')=>void,onProgress?:(f:number)=>void}} opts
 * @returns {Promise<{markdown:string,filename:string,format:string,warnings:string[],ms:number}>}
 */
export async function convertFile(file, opts) {
  const t0 = performance.now();
  const id = detectFormat(file.name);
  if (!id) throw new ConversionError('UNSUPPORTED', 'ไม่รองรับไฟล์ประเภทนี้');
  if (!file.size) throw new ConversionError('EMPTY', 'ไฟล์ว่างเปล่า');
  if (file.size > opts.maxBytes) throw new ConversionError('TOO_LARGE', `ไฟล์ใหญ่เกินไป (สูงสุด ${Math.round(opts.maxBytes / 1024 / 1024)} MB)`);
  validateMime(id, file.type);
  if (opts.onStage) opts.onStage('reading');
  const buf = await file.arrayBuffer();
  validateMagic(id, new Uint8Array(buf, 0, Math.min(buf.byteLength, 2048)));
  if (opts.onStage) opts.onStage('converting');
  const deadline = new Deadline(opts.timeoutMs);
  const o = { deadline, onProgress: opts.onProgress };
  const run = async () => {
    switch (id) {
      case 'pdf': return convertPdf(buf, o);
      case 'docx': return convertDocx(buf, o);
      case 'pptx': return convertPptx(buf, o);
      case 'xlsx': return convertXlsx(buf, o);
      case 'csv': return convertCsv(decodeText(buf));
      case 'html': return convertHtml(buf);
      case 'txt': return convertText(buf);
      case 'image': return convertImage(file);
      default: throw new ConversionError('UNSUPPORTED', 'ไม่รองรับไฟล์ประเภทนี้');
    }
  };
  const r = await withTimeout(run(), opts.timeoutMs);
  return { markdown: r.markdown, filename: withExt(file.name, 'md'), format: id, warnings: r.warnings || [], ms: Math.round(performance.now() - t0) };
}

/** Used by Settings → system status. */
export async function engineStatus() {
  const [JSZip, pdfjs] = await Promise.all([getJSZip(), getPdfjs()]);
  return { jszip: JSZip.version || 'ok', pdfjs: pdfjs.version || 'ok', formats: ['PDF', 'DOCX', 'PPTX', 'XLSX', 'CSV', 'HTML', 'TXT', 'JPG/PNG/WEBP (ข้อมูลไฟล์)'] };
}
