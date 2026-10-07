// Browser OCR for scanned PDFs (Thai + English), fully self-hosted: Tesseract compiled to WebAssembly runs in a Web Worker on the
// user's own device. Nothing is uploaded and no CDN is used (see CSP). The engine files live in src/js/vendor/ocr/ and are fetched
// once with `npm run ocr:fetch` (see scripts/fetch-ocr.mjs); they are NOT precached by the service worker (≈8 MB) — the worker
// caches them on first use in its own cache (see sw.js).
import { ConversionError, Deadline } from './common.js';
import { tesseractToMarkdown } from './ocr-layout.js';

const VENDOR = new URL('../../vendor/ocr/', import.meta.url);
export const OCR_LANGS = ['tha', 'eng'];
export const OCR_MAX_PAGES = 50;          // pages OCR-ed per file (OCR costs ~5–15 s per page)
const OCR_DPI = 300;                       // render resolution; Thai needs ≥ 250 dpi for small tone marks and digits
const OCR_MAX_PIXELS = 24e6;               // memory guard for one page canvas (A4 @ 300 dpi ≈ 8.7 MP)
const INIT_TIMEOUT_MS = 180000;            // first run downloads the model (~4 MB gzip) and compiles the WASM core (~4 MB)

const unavailable = (detail) => new ConversionError('OCR_UNAVAILABLE',
  'ไม่สามารถเปิดระบบอ่านข้อความจากภาพ (OCR) ได้ — ตรวจสอบการเชื่อมต่อแล้วลองใหม่ หรือแจ้งผู้ดูแลระบบให้ติดตั้งไฟล์ OCR (npm run ocr:fetch)', detail);

/**
 * Start a Tesseract worker. Resolves with {recognize(blob), terminate()}.
 * @param {{signal?:AbortSignal,onStatus?:(s:string)=>void}} [o]
 */
export async function createOcrEngine(o = {}) {
  let mod;
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
  return {
    /** @param {Blob} image @returns {Promise<any>} Tesseract.js page data */
    async recognize(image) {
      if (dead || !worker) throw new ConversionError('CANCELLED', 'ยกเลิกการแปลงแล้ว');
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

/**
 * OCR the given pages of an open PDF.js document.
 * @param {any} pdf PDF.js document
 * @param {number[]} indexes zero-based page indexes to read
 * @param {{signal?:AbortSignal,onStage?:Function,onProgress?:(f:number)=>void,onStatus?:(s:string)=>void,ocrTimeoutMs?:number}} opts
 * @param {string[]} warnings pushed to
 * @returns {Promise<Map<number,string>>} page index → Markdown ('' when the page has no readable text)
 */
export async function ocrPdfPages(pdf, indexes, opts, warnings) {
  const todo = indexes.slice(0, OCR_MAX_PAGES);
  if (indexes.length > todo.length) warnings.push(`OCR อ่านได้สูงสุด ${OCR_MAX_PAGES} หน้าต่อไฟล์ — ข้ามหน้าที่เหลืออีก ${indexes.length - todo.length} หน้า`);
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
      const canvas = await renderPage(pdf, todo[n] + 1);
      let data; const width = canvas.width;
      try { data = await engine.recognize(await toBlob(canvas)); } finally { canvas.width = 0; canvas.height = 0; }
      const r = tesseractToMarkdown(data, { width });
      chunks.set(todo[n], r.markdown);
      if (r.markdown && r.words) conf.push(r.confidence);
      if (opts.onProgress) opts.onProgress((n + 1) / todo.length);
    }
  } finally { await engine.terminate(); }
  if (conf.length) {
    const avg = Math.round(conf.reduce((a, b) => a + b, 0) / conf.length);
    warnings.push(`อ่านข้อความจากภาพสแกนด้วย OCR (ความมั่นใจเฉลี่ย ${avg}%) — โปรดตรวจทานเทียบกับต้นฉบับ โดยเฉพาะเลขไทย วันที่ ชื่อ-สกุล และเลขที่เอกสาร ซึ่งอาจอ่านผิดได้`);
  }
  return chunks;
}
