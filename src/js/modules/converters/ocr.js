// Browser OCR for scanned PDFs (Thai + English), fully self-hosted: Tesseract compiled to WebAssembly runs in a Web Worker on the
// user's own device. Nothing is uploaded and no CDN is used (see CSP). The engine files live in src/js/vendor/ocr/ and are fetched
// once with `npm run ocr:fetch` (see scripts/fetch-ocr.mjs); they are NOT precached by the service worker (≈8 MB) — the worker
// caches them on first use in its own cache (see sw.js).
import { ConversionError, Deadline } from './common.js';
import { tesseractToMarkdown, wordsFromTesseract } from './ocr-layout.js';
import { preprocess, toGray, toRgba } from './ocr-preprocess.js';

const VENDOR = new URL('../../vendor/ocr/', import.meta.url);
export const OCR_LANGS = ['tha', 'eng'];
export const OCR_MAX_PAGES = 50;          // pages OCR-ed per file (OCR costs ~5–15 s per page)
const OCR_DPI = 300;                       // render resolution; Thai needs ≥ 250 dpi for small tone marks and digits
const OCR_MAX_PIXELS = 24e6;               // memory guard for one page canvas (A4 @ 300 dpi ≈ 8.7 MP)
const INIT_TIMEOUT_MS = 180000;            // first run downloads the model (~4 MB gzip) and compiles the WASM core (~4 MB)

const unavailable = (detail) => new ConversionError('OCR_UNAVAILABLE',
  'ไฟล์นี้เป็นภาพสแกน ต้องใช้ระบบอ่านข้อความจากภาพ (OCR) แต่เว็บยังไม่มีไฟล์ OCR (โฟลเดอร์ src/js/vendor/ocr) — ผู้ดูแลเว็บต้องรัน “npm run ocr:fetch” แล้ว commit โฟลเดอร์นั้นขึ้น GitHub (ดู docs/DEPLOYMENT.md) หรือถ้าไฟล์มีอยู่แล้ว ให้ตรวจสอบการเชื่อมต่อแล้วกด Ctrl+Shift+R ลองใหม่', detail);

/** Quick check that the self-hosted OCR files are really deployed (a missing folder is the usual reason scanned PDFs fail). */
export async function ocrFilesPresent() {
  try { const r = await fetch(new URL('tha.traineddata.gz', VENDOR).href, { method: 'HEAD', cache: 'no-store' }); return r.ok; } catch { return false; }
}

/**
 * Start a Tesseract worker. Resolves with {recognize(blob), terminate()}.
 * @param {{signal?:AbortSignal,onStatus?:(s:string)=>void}} [o]
 */
export async function createOcrEngine(o = {}) {
  let mod;
  if (!(await ocrFilesPresent())) throw unavailable('missing vendor/ocr/tha.traineddata.gz');
  try { mod = await import('../../vendor/ocr/tesseract.esm.min.js'); } catch (e) { throw unavailable(String(e && e.message)); }
  const Tesseract = mod.default || mod;
  let worker = null; let dead = false;
  const kill = async () => { dead = true; if (worker) { const w = worker; worker = null; try { await w.terminate(); } catch { /* already gone */ } } };
  if (o.signal) o.signal.addEventListener('abort', () => { kill(); }, { once: true });
  const say = (s) => { if (o.onStatus && !dead) o.onStatus(s); };
  let timer;
  try {
    say('กำลังเตรียมระบบอ่านข้อความจากภาพ (ครั้งแรกอาจใช้เวลาสักครู่)');
    const init = Tesseract.createWorker(OCR_LANGS, 1, {   // 1 = LSTM only (the bundled core is the LSTM-only build)
      workerPath: new URL('worker.min.js', VENDOR).href,
      corePath: new URL('tesseract-core-simd-lstm.wasm.js', VENDOR).href,
      langPath: VENDOR.href.replace(/\/$/, ''),
      gzip: true,
      workerBlobURL: false,                                // load worker.min.js directly: stays within CSP worker-src 'self'
      logger: (m) => {
        if (!m || typeof m.status !== 'string') return;
        if (/loading tesseract core/.test(m.status)) say('กำลังโหลดระบบ OCR');
        else if (/language/.test(m.status)) say('กำลังโหลดโมเดลภาษาไทย/อังกฤษ');
      }
    });
    const guard = new Promise((_, rej) => { timer = setTimeout(() => rej(unavailable('init timeout')), INIT_TIMEOUT_MS); });
    worker = await Promise.race([init, guard]);
    if (dead) { await kill(); throw new ConversionError('CANCELLED', 'ยกเลิกการแปลงแล้ว'); }
    await worker.setParameters({ preserve_interword_spaces: '1' });
  } catch (e) {
    await kill();
    if (e instanceof ConversionError) throw e;
    throw unavailable(String(e && e.message || e));
  } finally { clearTimeout(timer); }
  let curPsm = 0;
  return {
    /** @param {Blob} image @param {number} [psm] tesseract page-segmentation mode (6 = one block of lines) @returns {Promise<any>} Tesseract.js page data */
    async recognize(image, psm) {
      if (dead || !worker) throw new ConversionError('CANCELLED', 'ยกเลิกการแปลงแล้ว');
      if (psm && psm !== curPsm) { await worker.setParameters({ tessedit_pageseg_mode: String(psm) }); curPsm = psm; }
      const { data } = await worker.recognize(image, {}, { text: true, blocks: true });
      return data;
    },
    terminate: kill
  };
}

/** Render one PDF.js page to a white-backed canvas at ~300 dpi (never above OCR_MAX_PIXELS). */
async function renderPage(pdf, pageNo) {
  const page = await pdf.getPage(pageNo);
  try {
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(OCR_DPI / 72, Math.sqrt(OCR_MAX_PIXELS / (base.width * base.height)));
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(vp.width)); canvas.height = Math.max(1, Math.round(vp.height));
    const ctx = canvas.getContext('2d', { willReadFrequently: false });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    return canvas;
  } finally { page.cleanup(); }
}

const toBlob = (canvas) => new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('canvas.toBlob failed'))), 'image/png'));

/** Clean a rendered page/photo in place (lighting, contrast, tilt, scale — see ocr-preprocess.js). Falls back to the original on any failure. */
export function enhanceCanvas(canvas) {
  try {
    const ctx = canvas.getContext('2d'); const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const r = preprocess(toGray(img.data, img.width, img.height));
    if (!r.steps.length || r.steps[0] === 'bilevel') return { canvas, steps: r.steps, skew: 0 };
    const out = document.createElement('canvas'); out.width = r.plane.w; out.height = r.plane.h;
    out.getContext('2d').putImageData(new ImageData(toRgba(r.plane), r.plane.w, r.plane.h), 0, 0);
    return { canvas: out, steps: r.steps, skew: r.skew };
  } catch { return { canvas, steps: [], skew: 0 }; }
}

function rotatedCanvas(src, quarter) {
  const c = document.createElement('canvas'); const swap = quarter % 2 === 1;
  c.width = swap ? src.height : src.width; c.height = swap ? src.width : src.height;
  const x = c.getContext('2d'); x.translate(c.width / 2, c.height / 2); x.rotate((quarter * Math.PI) / 2); x.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

/** Decode an image Blob to a canvas (EXIF orientation honoured), long side capped so a 48 MP phone photo cannot exhaust memory. */
async function imageToCanvas(blob) {
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  try {
    const k = Math.min(1, 5200 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(bmp, 0, 0, c.width, c.height);
    return c;
  } finally { if (bmp.close) bmp.close(); }
}

/**
 * OCR one photo/scan image directly (no image→PDF round trip, so nothing is lost to re-encoding). Cleans the picture first, reads it, and when the
 * result is poor tries the page turned 90/180/270° (people photograph letters sideways). Page-segmentation 6 (one block of lines) is used: official letters are a single column.
 * @param {Blob} blob
 * @param {{signal?:AbortSignal,onStatus?:(s:string)=>void,engine?:any}} [opts] pass a running `engine` to reuse it
 * @returns {Promise<{markdown:string,confidence:number,words:any[],width:number,height:number,steps:string[],rotated:number}>}
 */
export async function ocrImageBlob(blob, opts = {}) {
  const own = !opts.engine; const engine = opts.engine || await createOcrEngine({ signal: opts.signal, onStatus: opts.onStatus });
  try {
    if (opts.onStatus) opts.onStatus('กำลังปรับภาพให้อ่านง่าย');
    let base = await imageToCanvas(blob); const enh = enhanceCanvas(base); base = enh.canvas;
    const run = async (cv) => { const data = await engine.recognize(await toBlob(cv), 6); const r = tesseractToMarkdown(data, { width: cv.width }); return { data, r, cv }; };
    if (opts.onStatus) opts.onStatus('กำลังอ่านข้อความภาษาไทย');
    let best = await run(base); let rotated = 0;
    const score = (x) => (x.r.markdown ? x.r.confidence * Math.min(1, x.r.markdown.length / 200 + 0.3) : 0);
    if (score(best) < 55) {
      for (const q of [1, 3, 2]) {
        if (opts.signal && opts.signal.aborted) break;
        if (opts.onStatus) opts.onStatus('ลองหมุนภาพเพื่ออ่านให้ถูกทิศ');
        const t = await run(rotatedCanvas(base, q));
        if (score(t) > score(best) + 8) { best = t; rotated = q * 90; }
      }
    }
    return { markdown: best.r.markdown, confidence: best.r.confidence || 0, words: wordsFromTesseract(best.data), width: best.cv.width, height: best.cv.height, steps: enh.steps, rotated };
  } finally { if (own) await engine.terminate(); }
}

/** True when OCR may stop after page n+1 of `total`: more pages are waiting and the caller's enough(textSoFar) says what was read already has everything it needs. */
export function ocrEnough(opts, chunks, n, total) {
  if (!opts || typeof opts.enough !== 'function' || n + 1 >= total) return false;
  try { return !!opts.enough([...chunks.values()].join('\n\n')); } catch { return false; }
}

/**
 * OCR the given pages of an open PDF.js document.
 * @param {any} pdf PDF.js document
 * @param {number[]} indexes zero-based page indexes to read
 * @param {{signal?:AbortSignal,onStage?:Function,onProgress?:(f:number)=>void,onStatus?:(s:string)=>void,ocrTimeoutMs?:number,maxPages?:number,enough?:(text:string)=>boolean}} opts
 *   maxPages — read at most this many of the given pages · enough(textSoFar) — return true to stop after the current page
 * @param {string[]} warnings pushed to
 * @param {Map<number,{words:any[],width:number,height:number}>} [wordsOut] when given, the recognised words (pixel boxes) of every page are stored here too — the Word layout writer needs positions, not just text
 * @returns {Promise<Map<number,string>>} page index → Markdown ('' when the page has no readable text)
 */
export async function ocrPdfPages(pdf, indexes, opts, warnings, wordsOut) {
  const cap = opts.maxPages > 0 ? Math.min(OCR_MAX_PAGES, Math.floor(opts.maxPages)) : OCR_MAX_PAGES;
  const todo = indexes.slice(0, cap);
  if (indexes.length > todo.length && !(opts.maxPages > 0)) warnings.push(`OCR อ่านได้สูงสุด ${OCR_MAX_PAGES} หน้าต่อไฟล์ — ข้ามหน้าที่เหลืออีก ${indexes.length - todo.length} หน้า`);
  if (opts.onStage) opts.onStage('ocr');
  if (opts.onProgress) opts.onProgress(0);
  const engine = await createOcrEngine({ signal: opts.signal, onStatus: opts.onStatus });
  const deadline = new Deadline(opts.ocrTimeoutMs || 15 * 60 * 1000);
  const chunks = new Map(); const conf = [];
  try {
    for (let n = 0; n < todo.length; n++) {
      deadline.check();
      if (opts.signal && opts.signal.aborted) throw new ConversionError('CANCELLED', 'ยกเลิกการแปลงแล้ว');
      if (opts.onStatus) opts.onStatus(`กำลังอ่านข้อความจากภาพ หน้า ${n + 1} จาก ${todo.length}`);
      const rendered = await renderPage(pdf, todo[n] + 1);
      const canvas = opts.enhance === false ? rendered : enhanceCanvas(rendered).canvas;   // scanned PDFs are photos too: flatten light, straighten, size text
      if (canvas !== rendered) { rendered.width = 0; rendered.height = 0; }
      let data; const width = canvas.width, height = canvas.height;
      try { data = await engine.recognize(await toBlob(canvas)); } finally { canvas.width = 0; canvas.height = 0; }
      const r = tesseractToMarkdown(data, { width });
      if (wordsOut) wordsOut.set(todo[n], { words: wordsFromTesseract(data), width, height });
      chunks.set(todo[n], r.markdown);
      if (r.markdown && r.words) conf.push(r.confidence);
      if (opts.onProgress) opts.onProgress((n + 1) / todo.length);
      if (ocrEnough(opts, chunks, n, todo.length)) break;                   // the fields we came for are already read
    }
  } finally { await engine.terminate(); }
  if (conf.length) {
    const avg = Math.round(conf.reduce((a, b) => a + b, 0) / conf.length);
    warnings.push(`อ่านข้อความจากภาพสแกนด้วย OCR (ความมั่นใจเฉลี่ย ${avg}%) — โปรดตรวจทานเทียบกับต้นฉบับ โดยเฉพาะเลขไทย วันที่ ชื่อ-สกุล และเลขที่เอกสาร ซึ่งอาจอ่านผิดได้`);
  }
  return chunks;
}
