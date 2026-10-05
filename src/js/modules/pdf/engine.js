// PDF engine: merge / reorder / rotate / delete / split, images → PDF, watermark + page numbers + stamps.
// Everything runs in the browser with pdf-lib (vendor/pdf-lib.min.js, MIT). Nothing is uploaded.
import { loadScript } from '../../core/dom.js';

export class PdfError extends Error { constructor(code, message) { super(message); this.code = code; } }

let libPromise = null;
export async function getPdfLib() {
  if (globalThis.PDFLib) return globalThis.PDFLib;
  if (!libPromise) {
    libPromise = loadScript(new URL('../../vendor/pdf-lib.min.js', import.meta.url).href).then(() => {
      if (!globalThis.PDFLib) throw new Error('pdf-lib not available');
      return globalThis.PDFLib;
    });
    libPromise.catch(() => { libPromise = null; });
  }
  return libPromise;
}

const PRODUCER = 'SAND Office Tools';
function brand(doc, lib) { try { doc.setProducer(PRODUCER); doc.setCreator(PRODUCER); doc.setModificationDate(new Date()); } catch { /* ignore */ } return doc; }

/** Open a PDF File/Blob. Password-protected and broken files get a clear Thai message. */
export async function openDoc(file, name = file && file.name) {
  const lib = await getPdfLib();
  const bytes = new Uint8Array(await file.arrayBuffer());
  try { return await lib.PDFDocument.load(bytes, { updateMetadata: false }); } catch (e) {
    if ((lib.EncryptedPDFError && e instanceof lib.EncryptedPDFError) || /encrypt/i.test(String(e && e.message))) {
      throw new PdfError('ENCRYPTED', `“${name}” ถูกป้องกันด้วยรหัสผ่าน — ต้องปลดล็อกก่อนจึงจะแก้ไขได้`);
    }
    throw new PdfError('CORRUPT', `เปิด “${name}” ไม่ได้ (ไฟล์อาจเสียหายหรือไม่ใช่ PDF)`);
  }
}
export async function pageCount(file) { return (await openDoc(file)).getPageCount(); }

/* ------------------------------ page ranges ------------------------------ */

const THAI_DIGITS = /[๐-๙]/g;
/** "1-3, 5, 8-" → [0,1,2,4,7,…] (0-based, unique, in the order typed). Empty text → []. */
export function parseRanges(text, max) {
  const s = String(text || '').replace(THAI_DIGITS, (d) => String(d.charCodeAt(0) - 0x0e50)).trim();
  if (!s) return [];
  const out = []; const seen = new Set();
  for (const part of s.split(/[,\s;]+/).filter(Boolean)) {
    const m = /^(\d*)(-?)(\d*)$/.exec(part);
    if (!m || (!m[1] && !m[3])) throw new PdfError('RANGE', `ช่วงหน้า “${part}” ไม่ถูกต้อง ตัวอย่างที่ใช้ได้: 1-3, 5, 8-`);
    const a = m[2] ? (m[1] ? Number(m[1]) : 1) : Number(m[1]);
    const b = m[2] ? (m[3] ? Number(m[3]) : max) : Number(m[1]);
    if (a < 1 || b < a || b > max) throw new PdfError('RANGE', `ช่วงหน้า “${part}” อยู่นอกขอบเขต (เอกสารมี 1–${max} หน้า)`);
    for (let i = a; i <= b; i++) if (!seen.has(i)) { seen.add(i); out.push(i - 1); }
  }
  return out;
}
/** [0,1,2,4] → "1-3, 5" */
export function formatRanges(indices) {
  const a = [...new Set(indices)].sort((x, y) => x - y); const parts = [];
  for (let i = 0; i < a.length;) { let j = i; while (j + 1 < a.length && a[j + 1] === a[j] + 1) j++; parts.push(j > i ? `${a[i] + 1}-${a[j] + 1}` : String(a[i] + 1)); i = j + 1; }
  return parts.join(', ');
}

/* ----------------------------- merge / organize ---------------------------- */

/** @param {File[]} files @returns {Promise<{bytes:Uint8Array,pages:number}>} */
export async function mergePdfs(files, onProgress) {
  const lib = await getPdfLib(); const out = brand(await lib.PDFDocument.create(), lib);
  let i = 0;
  for (const f of files) {
    const src = await openDoc(f);
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
    if (onProgress) onProgress(++i, files.length);
  }
  return { bytes: await out.save(), pages: out.getPageCount() };
}

/** descs: [{src:0-based index in the source, rot:0|90|180|270 extra clockwise rotation}] in the wanted order. */
async function buildFrom(lib, src, descs) {
  const out = brand(await lib.PDFDocument.create(), lib);
  const copied = await out.copyPages(src, descs.map((d) => d.src));
  copied.forEach((p, i) => {
    const extra = ((descs[i].rot || 0) % 360 + 360) % 360;
    if (extra) p.setRotation(lib.degrees((p.getRotation().angle + extra) % 360));
    out.addPage(p);
  });
  return out;
}
export async function organizePdf(file, descs) {
  if (!descs.length) throw new PdfError('EMPTY', 'ไม่มีหน้าเหลืออยู่ในเอกสาร');
  const lib = await getPdfLib(); const src = await openDoc(file);
  return (await buildFrom(lib, src, descs)).save();
}
/** groups: Array<descs[]> → Uint8Array[] (one PDF per group). */
export async function splitPdf(file, groups, onProgress) {
  const lib = await getPdfLib(); const src = await openDoc(file); const res = [];
  for (let i = 0; i < groups.length; i++) { res.push(await (await buildFrom(lib, src, groups[i])).save()); if (onProgress) onProgress(i + 1, groups.length); }
  return res;
}
/** Split into consecutive chunks of `size` pages → [{from,to}] (0-based, inclusive). */
export function chunkRanges(total, size) {
  const n = Math.max(1, Math.floor(size)); const r = [];
  for (let i = 0; i < total; i += n) r.push({ from: i, to: Math.min(total, i + n) - 1 });
  return r;
}

/* ------------------------------- images → PDF ------------------------------ */

export const PAGE_SIZES = { a4: [595.28, 841.89], a3: [841.89, 1190.55], letter: [612, 792], legal: [612, 1008] };

/** EXIF orientation (1–8) of a JPEG, 1 when absent. Phones set it; scanners usually do not. */
export function jpegOrientation(u8) {
  if (!u8 || u8[0] !== 0xff || u8[1] !== 0xd8) return 1;
  let p = 2;
  while (p + 4 < u8.length && u8[p] === 0xff) {
    const mk = u8[p + 1]; const len = (u8[p + 2] << 8) | u8[p + 3];
    if (mk === 0xe1 && u8[p + 4] === 0x45 && u8[p + 5] === 0x78 && u8[p + 6] === 0x69 && u8[p + 7] === 0x66) {
      const t = p + 10; const le = u8[t] === 0x49;
      const r16 = (o) => (le ? u8[o] | (u8[o + 1] << 8) : (u8[o] << 8) | u8[o + 1]);
      const r32 = (o) => (le ? (u8[o] | (u8[o + 1] << 8) | (u8[o + 2] << 16) | (u8[o + 3] << 24)) >>> 0 : ((u8[o] << 24) | (u8[o + 1] << 16) | (u8[o + 2] << 8) | u8[o + 3]) >>> 0);
      const ifd = t + r32(t + 4); const n = r16(ifd);
      for (let i = 0; i < n; i++) { const e = ifd + 2 + i * 12; if (r16(e) === 0x0112) return r16(e + 8) || 1; }
      return 1;
    }
    if (mk === 0xda) break;
    p += 2 + len;
  }
  return 1;
}

/** Natural sort so scan2.jpg comes before scan10.jpg. */
export const naturalCompare = (a, b) => String(a).localeCompare(String(b), 'th', { numeric: true, sensitivity: 'base' });

const toBlob = (c, type, q) => new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode'))), type, q));
async function decode(file) {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* option unsupported or bad file */ }
  try { return await createImageBitmap(file); } catch {
    throw new PdfError('IMAGE', `อ่านรูป “${file.name}” ไม่ได้ — ถ้าเป็นไฟล์ TIFF/HEIC ให้ตั้งเครื่องสแกนหรือมือถือบันทึกเป็น JPEG`);
  }
}
function toGray(ctx, w, h) {
  const img = ctx.getImageData(0, 0, w, h); const d = img.data;
  for (let i = 0; i < d.length; i += 4) { const g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0; d[i] = d[i + 1] = d[i + 2] = g; }
  ctx.putImageData(img, 0, 0);
}

/**
 * items: [{file, rot}]  opts: {size:'a4'|'a3'|'letter'|'legal'|'fit', orient:'auto'|'portrait'|'landscape', margin:mm,
 *   quality:'original'|'balanced'|'small', gray:boolean}
 * 'original' embeds JPEG/PNG bytes untouched (fast, lossless) unless a rotation / EXIF fix / grey is needed.
 */
export async function imagesToPdf(items, opts, onProgress) {
  if (!items.length) throw new PdfError('EMPTY', 'ยังไม่ได้เลือกรูป');
  const lib = await getPdfLib(); const doc = brand(await lib.PDFDocument.create(), lib);
  const margin = Math.max(0, Number(opts.margin) || 0) * 2.8346;
  let n = 0;
  for (const it of items) {
    const file = it.file; const rot = ((it.rot || 0) % 360 + 360) % 360;
    const buf = new Uint8Array(await file.arrayBuffer());
    const isJpg = /jpe?g/i.test(file.type) || /\.jpe?g$/i.test(file.name);
    const isPng = /png/i.test(file.type) || /\.png$/i.test(file.name);
    const raw = opts.quality === 'original' && !opts.gray && !rot && ((isJpg && jpegOrientation(buf) === 1) || isPng);
    let img;
    if (raw) {
      try { img = isJpg ? await doc.embedJpg(buf) : await doc.embedPng(buf); } catch { throw new PdfError('IMAGE', `อ่านรูป “${file.name}” ไม่ได้ (ไฟล์อาจเสียหาย)`); }
    } else {
      const bmp = await decode(file);
      const swap = rot === 90 || rot === 270; const ow = swap ? bmp.height : bmp.width; const oh = swap ? bmp.width : bmp.height;
      const maxDim = { original: Infinity, balanced: 3508, small: 2000 }[opts.quality] || 3508;
      const k = Math.min(1, maxDim / Math.max(ow, oh));
      const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(ow * k)); c.height = Math.max(1, Math.round(oh * k));
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.save(); ctx.translate(c.width / 2, c.height / 2); ctx.rotate((rot * Math.PI) / 180);
      ctx.drawImage(bmp, (-bmp.width * k) / 2, (-bmp.height * k) / 2, bmp.width * k, bmp.height * k); ctx.restore();
      if (bmp.close) bmp.close();
      if (opts.gray) toGray(ctx, c.width, c.height);
      const q = { original: 0.95, balanced: 0.8, small: 0.6 }[opts.quality] || 0.8;
      img = await doc.embedJpg(new Uint8Array(await (await toBlob(c, 'image/jpeg', q)).arrayBuffer()));
      c.width = c.height = 0;
    }
    let pw; let ph;
    if (opts.size === 'fit') { const s = PAGE_SIZES.a4[1] / Math.max(img.width, img.height); pw = img.width * s; ph = img.height * s; } else {
      [pw, ph] = PAGE_SIZES[opts.size] || PAGE_SIZES.a4;
      const land = opts.orient === 'landscape' || (opts.orient !== 'portrait' && img.width > img.height);
      if (land) [pw, ph] = [ph, pw];
    }
    const page = doc.addPage([pw, ph]);
    const m = opts.size === 'fit' ? 0 : margin;
    const s = Math.min((pw - 2 * m) / img.width, (ph - 2 * m) / img.height);
    const dw = img.width * s; const dh = img.height * s;
    page.drawImage(img, { x: (pw - dw) / 2, y: (ph - dh) / 2, width: dw, height: dh });
    if (onProgress) onProgress(++n, items.length);
  }
  return { bytes: await doc.save(), pages: doc.getPageCount() };
}

/* ----------------------- watermark / page numbers / stamp ------------------- */

export const STAMP_PRESETS = ['สำเนา', 'สำเนาถูกต้อง', 'ต้นฉบับ', 'ลับ', 'ลับมาก', 'ด่วน', 'ด่วนที่สุด', 'ห้ามเผยแพร่', 'ตรวจแล้ว', 'ยกเลิก'];
export const NUMBER_FORMATS = [['{n}', '1'], ['{n} / {t}', '1 / 10'], ['หน้า {n}', 'หน้า 1'], ['หน้า {n} จาก {t}', 'หน้า 1 จาก 10'], ['- {n} -', '- 1 -']];
const FONT = '"Sarabun","Noto Sans Thai","Leelawadee UI","Tahoma","Segoe UI",sans-serif';
const TEX_SCALE = 3; // texture pixels per PDF point — keeps small text crisp
const toThaiDigits = (s) => String(s).replace(/[0-9]/g, (d) => String.fromCharCode(0x0e50 + Number(d)));
export const thaiDate = (d = new Date()) => d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });

/** Render text to a transparent PNG with the browser's own Thai shaping. Size is in PDF points. */
async function textTexture(lines, { pt, color, bold, border, pad = 0.4 }) {
  const px = pt * TEX_SCALE; const lh = px * 1.3; const p = px * pad;
  const c = document.createElement('canvas'); const ctx = c.getContext('2d');
  const font = `${bold ? 700 : 400} ${px}px ${FONT}`; ctx.font = font;
  const w = Math.ceil(Math.max(...lines.map((l) => ctx.measureText(l).width)) + 2 * p + (border ? px * 0.3 : 0));
  const h = Math.ceil(lines.length * lh + 2 * p + (border ? px * 0.2 : 0));
  c.width = w; c.height = h; ctx.font = font; ctx.fillStyle = color; ctx.strokeStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (border) { ctx.lineWidth = Math.max(2, px * 0.09); const r = px * 0.25; const x = ctx.lineWidth / 2; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, x, w - 2 * x, h - 2 * x, r) : ctx.rect(x, x, w - 2 * x, h - 2 * x); ctx.stroke(); }
  lines.forEach((l, i) => ctx.fillText(l, w / 2, p + (border ? px * 0.1 : 0) + lh * i + lh / 2));
  const png = new Uint8Array(await (await toBlob(c, 'image/png')).arrayBuffer());
  return { png, w: w / TEX_SCALE, h: h / TEX_SCALE };
}

/** Visual (as-seen) point/angle → user space, honouring the page's /Rotate and crop box origin. */
function placeImage(page, lib, img, wPt, hPt, vcx, vcy, angle, opacity) {
  const box = page.getCropBox ? page.getCropBox() : page.getMediaBox();
  const W = box.width; const H = box.height; const rot = ((page.getRotation().angle % 360) + 360) % 360;
  let ux; let uy;
  if (rot === 90) { ux = W - vcy; uy = vcx; } else if (rot === 180) { ux = W - vcx; uy = H - vcy; } else if (rot === 270) { ux = vcy; uy = H - vcx; } else { ux = vcx; uy = vcy; }
  ux += box.x; uy += box.y;
  const a = ((angle + rot) * Math.PI) / 180;
  const x = ux - ((wPt / 2) * Math.cos(a) - (hPt / 2) * Math.sin(a));
  const y = uy - ((wPt / 2) * Math.sin(a) + (hPt / 2) * Math.cos(a));
  page.drawImage(img, { x, y, width: wPt, height: hPt, rotate: lib.degrees(angle + rot), opacity });
}
const visualSize = (page) => { const b = page.getCropBox ? page.getCropBox() : page.getMediaBox(); const r = ((page.getRotation().angle % 360) + 360) % 360; return r === 90 || r === 270 ? [b.height, b.width] : [b.width, b.height]; };
function anchor(pos, W, H, w, h, m) {
  const x = pos.endsWith('left') ? m + w / 2 : pos.endsWith('right') ? W - m - w / 2 : W / 2;
  const y = pos.startsWith('top') ? H - m - h / 2 : pos.startsWith('bottom') ? m + h / 2 : H / 2;
  return [x, y];
}

/**
 * opts: {
 *  pages: '' | '1-3,5'            (which pages get marks; empty = all)
 *  watermark: {on, text, size(1–40 % of page width), opacity(5–100), color, angle}
 *  stamp:     {on, text, pos, size(pt), color, date:boolean}
 *  numbers:   {on, format, pos, size(pt), color, start, skipFirst, thai:boolean}
 * }
 * only: render just this 0-based page (preview) — numbering still reflects the whole document.
 */
export async function stampPdf(file, opts, { only = null } = {}) {
  const lib = await getPdfLib(); const src = await openDoc(file); const total = src.getPageCount();
  const target = opts.pages && opts.pages.trim() ? new Set(parseRanges(opts.pages, total)) : null;
  const applies = (i) => !target || target.has(i);
  const n = opts.numbers || {};
  const numbered = []; for (let i = 0; i < total; i++) if (applies(i) && !(n.skipFirst && i === 0)) numbered.push(i);
  const start = Math.max(0, Math.floor(Number(n.start))); const firstNo = Number.isFinite(start) && n.start !== '' ? start : 1;
  const lastNo = firstNo + numbered.length - 1;

  let doc = src;
  if (only !== null) { doc = brand(await lib.PDFDocument.create(), lib); const [p] = await doc.copyPages(src, [only]); doc.addPage(p); } else brand(doc, lib);
  const idxOf = (k) => (only !== null ? only : k);
  const cache = new Map();
  const tex = async (key, lines, o) => { if (!cache.has(key)) { const t = await textTexture(lines, o); cache.set(key, { ...t, img: await doc.embedPng(t.png) }); } return cache.get(key); };

  const pages = doc.getPages();
  for (let k = 0; k < pages.length; k++) {
    const i = idxOf(k); const page = pages[k];
    if (!applies(i)) continue;
    const [W, H] = visualSize(page);
    const wm = opts.watermark;
    if (wm && wm.on && wm.text && wm.text.trim()) {
      const pt = Math.max(8, (Number(wm.size) || 14) / 100 * W * 0.9 / Math.max(2, wm.text.trim().length * 0.55));
      const t = await tex(`w:${wm.text}:${pt.toFixed(1)}:${wm.color}`, [wm.text.trim()], { pt, color: wm.color || '#888888', bold: true, pad: 0.1 });
      placeImage(page, lib, t.img, t.w, t.h, W / 2, H / 2, Number(wm.angle) || 0, Math.min(1, Math.max(0.05, (Number(wm.opacity) || 25) / 100)));
    }
    const st = opts.stamp;
    if (st && st.on && st.text && st.text.trim()) {
      const lines = [st.text.trim()]; if (st.date) lines.push(thaiDate());
      const pt = Math.max(8, Number(st.size) || 28);
      const t = await tex(`s:${lines.join('|')}:${pt}:${st.color}`, lines, { pt, color: st.color || '#c62828', bold: true, border: true });
      const [cx, cy] = anchor(st.pos || 'top-right', W, H, t.w, t.h, 36);
      placeImage(page, lib, t.img, t.w, t.h, cx, cy, st.pos === 'center' ? 0 : 6, 0.85);
    }
    if (n.on && numbered.includes(i)) {
      const no = firstNo + numbered.indexOf(i);
      let text = String(n.format || '{n}').replace('{n}', no).replace('{t}', lastNo);
      if (n.thai) text = toThaiDigits(text);
      const pt = Math.max(6, Number(n.size) || 11);
      const t = await tex(`n:${text}:${pt}:${n.color}`, [text], { pt, color: n.color || '#222222', bold: false, pad: 0.2 });
      const [cx, cy] = anchor(n.pos || 'bottom-center', W, H, t.w, t.h, 24);
      placeImage(page, lib, t.img, t.w, t.h, cx, cy, 0, 1);
    }
  }
  return doc.save();
}
