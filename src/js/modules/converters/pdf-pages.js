// PDF → positioned page model, for the layout-faithful Word writer (write-docx-layout.js).
// Unlike pdf.js in pdf.js (Markdown), this keeps WHERE things are: every text run with its position, size, font name and weight,
// the ruling lines and filled boxes that form tables, and the pictures. Coordinates are in points, origin top-left, y grows downward.
// No DOM at module level: the caller passes the pdfjs module (the browser build or pdfjs-dist in Node tests).
import { ConversionError, LIMITS } from './common.js';
import { applyActualText, readActualTextSpans } from './pdf-actualtext.js';
import { classifyFont } from './docx-fonts.js';
import { repairThaiIfNeeded } from './pdf-thai.js';
import { encodePng, pdfImageToPixels, shrinkPixels } from './png.js';

const THAI = /[\u0e00-\u0e7f]/;
const MAX_IMAGE_BYTES = 24 * 1024 * 1024;   // total picture data kept per document
const mul = (m, n) => [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const isWhite = (c) => !c || /^#f{6}$/i.test(c) || /^#fefefe$/i.test(c);

/** A page whose text layer is badly garbled (font without a usable Unicode map). Same rule as the Markdown reader. */
export function isGarbledText(t) {
  const n = (t.match(/[\u0000-\u0008\u000e-\u001f\uE000-\uEFFF\uF100-\uF8FF\uFFFD]/g) || []).length;
  return n >= 8 && n > t.length * 0.06;
}

/** Open a PDF with PDF.js; password-protected and broken files get a clear Thai message. */
export async function openPdf(buf, pdfjs) {
  const task = pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 });
  try { return await task.promise; } catch (e) {
    if (e && e.name === 'PasswordException') throw new ConversionError('ENCRYPTED', 'ไฟล์ PDF นี้ถูกป้องกันด้วยรหัสผ่าน กรุณาปลดล็อกก่อนแปลง');
    throw new ConversionError('CORRUPT', 'ไฟล์ PDF เสียหายหรือเปิดไม่ได้', String(e && e.message));
  }
}

/**
 * Walk a page's operator list: ruling lines, filled boxes and image placements (all in top-left page coordinates).
 * @returns {{rules:Array<{x0:number,y0:number,x1:number,y1:number,w:number}>,fills:Array<{x0:number,y0:number,x1:number,y1:number,color:string}>,imgs:Array<{id:string|null,inline:any,x0:number,y0:number,x1:number,y1:number}>}}
 */
export function scanOperators(ol, OPS, view) {
  const [vx, vy, , vy1] = view;
  const toPage = (m, x, y) => { const [px, py] = apply(m, x, y); return [px - vx, vy1 - py]; };
  let st = { ctm: [1, 0, 0, 1, 0, 0], lw: 1, fill: '#000000', stroke: '#000000' };
  const stack = [];
  const rules = []; const fills = []; const imgs = [];
  const scale = (m) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
  const paintPath = (paintOp, subs) => {
    const doFill = [OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke].includes(paintOp);
    const doStroke = [OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke].includes(paintOp);
    if (!doFill && !doStroke) return;
    const lw = Math.max(0.25, st.lw * scale(st.ctm));
    for (const sp of subs) {
      const pts = sp.pts.map(([x, y]) => toPage(st.ctm, x, y));
      if (pts.length < 2) continue;
      const first = pts[0]; const last = pts[pts.length - 1];
      const closed = sp.closed || (Math.abs(first[0] - last[0]) < 0.01 && Math.abs(first[1] - last[1]) < 0.01);
      const ring = closed && pts.length >= 4 && Math.abs(first[0] - last[0]) < 0.01 && Math.abs(first[1] - last[1]) < 0.01 ? pts.slice(0, -1) : pts;
      const xs = ring.map((p) => p[0]); const ys = ring.map((p) => p[1]);
      const bx0 = Math.min(...xs), bx1 = Math.max(...xs), by0 = Math.min(...ys), by1 = Math.max(...ys);
      const isRect = closed && ring.length === 4 && ring.every((p) => (Math.abs(p[0] - bx0) < 0.3 || Math.abs(p[0] - bx1) < 0.3) && (Math.abs(p[1] - by0) < 0.3 || Math.abs(p[1] - by1) < 0.3));
      if (isRect) {
        if (doFill) {
          const thin = Math.min(bx1 - bx0, by1 - by0);
          if (thin <= 1.6 && Math.max(bx1 - bx0, by1 - by0) > 4) {          // a thin filled box is how many programs draw a table line
            if (bx1 - bx0 >= by1 - by0) rules.push({ x0: bx0, x1: bx1, y0: (by0 + by1) / 2, y1: (by0 + by1) / 2, w: Math.max(0.5, thin) });
            else rules.push({ x0: (bx0 + bx1) / 2, x1: (bx0 + bx1) / 2, y0: by0, y1: by1, w: Math.max(0.5, thin) });
          } else if (!isWhite(st.fill) && thin > 1.6) fills.push({ x0: bx0, y0: by0, x1: bx1, y1: by1, color: st.fill });
        }
        if (doStroke) {
          rules.push({ x0: bx0, x1: bx1, y0: by0, y1: by0, w: lw }, { x0: bx0, x1: bx1, y0: by1, y1: by1, w: lw },
            { x0: bx0, x1: bx0, y0: by0, y1: by1, w: lw }, { x0: bx1, x1: bx1, y0: by0, y1: by1, w: lw });
        }
        continue;
      }
      if (!doStroke) continue;
      const segs = []; for (let i = 1; i < pts.length; i++) segs.push([pts[i - 1], pts[i]]); if (closed && pts.length > 2 && ring === pts) segs.push([last, first]);
      for (const [a, b] of segs) {
        if (Math.abs(a[1] - b[1]) <= 0.4 && Math.abs(a[0] - b[0]) > 2) rules.push({ x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]), y0: (a[1] + b[1]) / 2, y1: (a[1] + b[1]) / 2, w: lw });
        else if (Math.abs(a[0] - b[0]) <= 0.4 && Math.abs(a[1] - b[1]) > 2) rules.push({ x0: (a[0] + b[0]) / 2, x1: (a[0] + b[0]) / 2, y0: Math.min(a[1], b[1]), y1: Math.max(a[1], b[1]), w: lw });
      }
    }
  };
  /** pdf.js constructPath data → subpaths of points (curves are reduced to their end point: only straight lines matter here) */
  const parsePath = (data) => {
    const subs = []; let cur = null; let i = 0;
    while (i < data.length) {
      const op = data[i++];
      if (op === 0) { cur = { pts: [[data[i], data[i + 1]]], closed: false }; subs.push(cur); i += 2; }
      else if (op === 1) { if (!cur) { cur = { pts: [], closed: false }; subs.push(cur); } cur.pts.push([data[i], data[i + 1]]); i += 2; }
      else if (op === 2) { if (cur) cur.pts.push([data[i + 4], data[i + 5]]); i += 6; }
      else if (op === 3) { if (cur) cur.pts.push([data[i + 2], data[i + 3]]); i += 4; }
      else if (op === 4) { if (cur) cur.closed = true; }
      else break;
    }
    return subs;
  };
  const place = (m, rec) => {
    const c = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => toPage(m, x, y));
    const xs = c.map((p) => p[0]), ys = c.map((p) => p[1]);
    imgs.push({ ...rec, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) });
  };
  for (let i = 0; i < ol.fnArray.length; i++) {
    const fn = ol.fnArray[i]; const a = ol.argsArray[i];
    switch (fn) {
      case OPS.save: stack.push({ ...st, ctm: st.ctm.slice() }); break;
      case OPS.restore: if (stack.length) st = stack.pop(); break;
      case OPS.transform: st.ctm = mul(a, st.ctm); break;
      case OPS.paintFormXObjectBegin: stack.push({ ...st, ctm: st.ctm.slice() }); if (a && a[0]) st.ctm = mul(a[0], st.ctm); break;
      case OPS.paintFormXObjectEnd: if (stack.length) st = stack.pop(); break;
      case OPS.setLineWidth: st.lw = a[0]; break;
      case OPS.setFillRGBColor: st.fill = a[0]; break;
      case OPS.setStrokeRGBColor: st.stroke = a[0]; break;
      case OPS.constructPath: {
        const paintOp = a[0]; const data = a[1] && a[1][0];
        if (data && data.length) paintPath(paintOp, parsePath(data));
        break;
      }
      case OPS.paintImageXObject: place(st.ctm, { id: a[0], inline: null }); break;
      case OPS.paintInlineImageXObject: place(st.ctm, { id: null, inline: a[0] }); break;
      default: break;
    }
  }
  return { rules, fills, imgs };
}

const getObj = (store, id) => new Promise((res) => {
  let done = false; const t = setTimeout(() => { if (!done) { done = true; res(null); } }, 4000);
  try { store.get(id, (o) => { if (!done) { done = true; clearTimeout(t); res(o || null); } }); } catch { clearTimeout(t); res(null); }
});

async function bitmapToPng(bitmap) {
  const w = bitmap.width, h = bitmap.height;
  const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  const blob = canvas.convertToBlob ? await canvas.convertToBlob({ type: 'image/png' }) : await new Promise((r) => canvas.toBlob(r, 'image/png'));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), pxW: w, pxH: h };
}

/**
 * Read every page of a PDF into the page model.
 * @param {ArrayBuffer} buf
 * @param {{pdfjs:any,pdfLib?:any,ocr?:boolean,deadline?:any,signal?:AbortSignal,onProgress?:(f:number)=>void,onStage?:Function,onStatus?:(s:string)=>void,ocrTimeoutMs?:number}} opts
 * @returns {Promise<{pages:PdfPage[],fontUsage:Record<string,number>,warnings:string[],numPages:number}>}
 * @typedef {{index:number,width:number,height:number,words:PdfWord[],rules:any[],fills:any[],images:any[],ocr:boolean,skipped:number}} PdfPage
 * @typedef {{text:string,x0:number,x1:number,base:number,fs:number,font:string,fid:string|null,b:boolean,i:boolean,ul?:boolean}} PdfWord
 */
export async function readPdfPages(buf, opts) {
  const { pdfjs } = opts;
  let pdf = await openPdf(buf, pdfjs);
  const warnings = []; const fontUsage = {};
  // Thai marks mis-encoded by the PDF producer (Word for Mac …): repair the embedded fonts, then carry on with the repaired file
  try {
    const th = await repairThaiIfNeeded(pdf, {
      open: (bytes) => openPdf(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), pdfjs),
      getPdfLib: async () => opts.pdfLib || (await import('../pdf/engine.js')).getPdfLib()
    });
    pdf = th.pdf; if (th.warning) warnings.push(th.warning);
  } catch { /* the repair is best-effort */ }
  try {
    const total = Math.min(pdf.numPages, LIMITS.maxPdfPages);
    if (pdf.numPages > total) warnings.push(`PDF มี ${pdf.numPages} หน้า แปลงเฉพาะ ${total} หน้าแรก`);
    const OPS = pdfjs.OPS;
    /** @type {PdfPage[]} */ const pages = []; const rawItems = []; const extras = [];
    for (let p = 1; p <= total; p++) {
      if (opts.deadline) opts.deadline.check();
      if (opts.onProgress) opts.onProgress((p / total) * 0.7);
      const page = await pdf.getPage(p);
      const view = page.view; const width = view[2] - view[0]; const height = view[3] - view[1];
      if (page.rotate) warnings.push(`หน้า ${p} ถูกหมุน ${page.rotate}° ใน PDF — ตำแหน่งในไฟล์ Word อาจไม่ตรงต้นฉบับ`);
      const ol = await page.getOperatorList();
      const content = await page.getTextContent({ includeMarkedContent: true });
      const ops = scanOperators(ol, OPS, view);
      const fontNames = new Map();
      const fontOf = (id) => {
        if (fontNames.has(id)) return fontNames.get(id);
        let name = id; try { if (page.commonObjs.has(id)) { const f = page.commonObjs.get(id); if (f && f.name) name = f.name; } } catch { /* keep the id */ }
        fontNames.set(id, name); return name;
      };
      // pictures: fetch pixel data once per object id
      const images = [];
      let imgBytes = 0;
      for (const im of ops.imgs) {
        if (im.x1 - im.x0 < 3 || im.y1 - im.y0 < 3) continue;
        const o = im.inline || (im.id ? (page.objs.has(im.id) ? await getObj(page.objs, im.id) : await getObj(page.commonObjs, im.id)) : null);
        if (!o) continue;
        try {
          let enc;
          if (o.bitmap) enc = await bitmapToPng(o.bitmap);
          else if (o.data && o.width && o.height) { const px = shrinkPixels(pdfImageToPixels(o)); enc = { bytes: await encodePng(px), pxW: px.width, pxH: px.height }; }
          if (!enc) continue;
          imgBytes += enc.bytes.length;
          if (imgBytes > MAX_IMAGE_BYTES) { warnings.push('รูปภาพใน PDF มีขนาดรวมใหญ่มาก จึงไม่คัดลอกรูปที่เหลือ'); break; }
          images.push({ bytes: enc.bytes, x0: im.x0, y0: im.y0, x1: im.x1, y1: im.y1, pxW: enc.pxW, pxH: enc.pxH });
        } catch { /* a picture that cannot be decoded is skipped */ }
      }
      pages.push({ index: p - 1, width, height, words: [], rules: ops.rules, fills: ops.fills, images, ocr: false, skipped: 0 });
      rawItems.push({ items: content.items, view, fontOf });
      page.cleanup();
    }
    // Thai from Type 3 / Cairo-style fonts: the correct text is in /ActualText, not in the glyph codes
    let spansByPage = null;
    if (opts.pdfLib && rawItems.some((r) => r.items.some((it) => typeof it.str === 'string' && THAI.test(it.str)))) {
      try { spansByPage = await readActualTextSpans(await pdf.getData(), opts.pdfLib); } catch { spansByPage = null; }
    }
    let spanMismatch = 0;
    rawItems.forEach((raw, k) => {
      let items = raw.items; const spans = spansByPage && spansByPage[k];
      if (spans && spans.some(Boolean)) { const fixed = applyActualText(items, spans); if (fixed.ok) items = fixed.items; else spanMismatch++; }
      const [vx, , , vy1] = raw.view; const page = pages[k];
      for (const it of items) {
        if (typeof it.str !== 'string' || !it.str.trim() || !it.transform) continue;
        const [a, b] = it.transform;
        if (Math.abs(b) > Math.abs(a) * 0.5) { page.skipped++; continue; }      // rotated / vertical text is not rebuilt
        const fs = Math.hypot(a, b) || it.height || 10; const name = raw.fontOf(it.fontName);
        const cls = classifyFont(name); const x0 = it.transform[4] - vx;
        const w = it.width && it.width > 0 ? it.width : fs * it.str.length * 0.5;
        page.words.push({ text: it.str, x0, x1: x0 + w, base: vy1 - it.transform[5], fs, font: name, fid: cls.font ? cls.font.id : null, b: cls.bold, i: cls.italic });
        fontUsage[name] = (fontUsage[name] || 0) + it.str.length;
      }
    });
    if (spanMismatch) warnings.push(`PDF ${spanMismatch} หน้ามีโครงสร้างข้อความที่อ่านวรรณยุกต์ภาษาไทยไม่ครบ อาจมีวรรณยุกต์หายบางตัว ควรตรวจทานกับต้นฉบับ`);

    // scanned / garbled pages → OCR words with boxes
    const needOcr = pages.filter((pg) => { const t = pg.words.map((w) => w.text).join(''); return !t.trim() || isGarbledText(t); }).map((pg) => pg.index);
    const hasText = pages.some((pg) => pg.words.length && !needOcr.includes(pg.index));
    if (needOcr.length && opts.ocr !== false) {
      try {
        const { ocrPdfPages } = await import('./ocr.js');
        const wordsOut = new Map();
        await ocrPdfPages(pdf, needOcr, { ...opts, onProgress: (f) => opts.onProgress && opts.onProgress(0.7 + f * 0.3) }, warnings, wordsOut);
        for (const [idx, r] of wordsOut) {
          const pg = pages[idx]; const sc = pg.width / (r.width || pg.width);
          pg.words = r.words.map((w) => {
            const h = (w.bbox.y1 - w.bbox.y0) * sc; const fs = Math.max(6, Math.min(40, h * 0.78));
            return { text: w.text, x0: w.bbox.x0 * sc, x1: w.bbox.x1 * sc, base: w.bbox.y1 * sc - h * 0.2, fs, font: '', fid: null, b: false, i: false };
          });
          pg.ocr = true; pg.rules = []; pg.fills = [];
          pg.images = pg.images.filter((im) => (im.x1 - im.x0) * (im.y1 - im.y0) < pg.width * pg.height * 0.6);   // the page scan itself is replaced by its text
        }
      } catch (e) {
        if (!hasText || (e && e.code === 'CANCELLED')) throw e;
        warnings.push(`หน้าที่เป็นภาพสแกน (${needOcr.length} หน้า) อ่านด้วย OCR ไม่สำเร็จ: ${e && e.message ? e.message : e}`);
      }
    }
    if (!pages.some((pg) => pg.words.length)) {
      throw new ConversionError('PDF_NO_TEXT', opts.ocr === false
        ? 'PDF นี้ไม่มีข้อความที่เลือกคัดลอกได้ (อาจเป็นไฟล์สแกน) และปิดการอ่านข้อความจากภาพ (OCR) ไว้'
        : 'ไม่พบข้อความใน PDF นี้ แม้ลองอ่านด้วย OCR แล้ว (ภาพอาจเบลอ เอียง หรือไม่มีตัวอักษร)');
    }
    const skipped = pages.reduce((n, pg) => n + pg.skipped, 0);
    if (skipped) warnings.push(`ข้อความหมุน/แนวตั้ง ${skipped} จุดไม่ถูกคัดลอก`);
    return { pages, fontUsage, warnings, numPages: total };
  } finally { try { await pdf.destroy(); } catch { /* ignore */ } }
}
