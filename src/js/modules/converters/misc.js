import { ConversionError } from './common.js';
import { htmlToMarkdown } from './html-md.js';
import { decodeText } from '../../core/download.js';

/** @param {ArrayBuffer} buf */
export function convertHtml(buf) {
  const html = decodeText(buf);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const markdown = htmlToMarkdown(doc);
  return { markdown: markdown.trim() ? markdown : '', warnings: markdown.trim() ? [] : ['ไม่พบเนื้อหาข้อความในไฟล์ HTML'] };
}

/** Plain text passes through unchanged (like MarkItDown). */
export function convertText(buf) {
  const text = decodeText(buf);
  if (/\u0000/.test(text.slice(0, 4096))) throw new ConversionError('BINARY', 'ไฟล์นี้ไม่ใช่ไฟล์ข้อความ');
  return { markdown: text, warnings: [] };
}

/** Images: metadata only. No OCR / captioning (MarkItDown needs an external LLM for that). */
export async function convertImage(file) {
  let w = 0; let h = 0;
  try { const bmp = await createImageBitmap(file); w = bmp.width; h = bmp.height; bmp.close(); } catch {
    throw new ConversionError('CORRUPT', 'ไฟล์รูปภาพเสียหายหรืออ่านไม่ได้');
  }
  const kb = (file.size / 1024).toFixed(1);
  const ext = (file.name.split('.').pop() || '').toUpperCase();
  const md = `# ${file.name}\n\n![${file.name}](${file.name})\n\n* ชนิดไฟล์: ${ext}\n* ขนาดภาพ: ${w} × ${h} พิกเซล\n* ขนาดไฟล์: ${kb} KB\n`;
  return { markdown: md, warnings: ['การแปลงรูปภาพให้เฉพาะข้อมูลไฟล์ ไม่มีการอ่านข้อความในรูป (OCR)'] };
}
