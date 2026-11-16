// Cloud OCR (Typhoon OCR, Thai-specialised) as an OPTIONAL engine next to the on-device Tesseract engine in ocr.js.
//
// The person picks the engine (Settings → การอ่านข้อความจากภาพ, and under the สารบรรณ drop-zone):
//   local   — Tesseract on this device. Nothing leaves the computer. (default)
//   auto    — Typhoon first; when it is full (429), unreachable, not configured or returns nothing, the page quietly reads with local
//   typhoon — Typhoon only; when it fails the error is shown, so nobody believes a page was read by the better model when it was not
//
// Typhoon's limit is 20 requests/minute and 2/second for the whole account, and every page is one request, so this module
//   · spaces requests ≥ MIN_GAP_MS apart (≈ 18/min from this browser),
//   · remembers a 429 (`retryAfter`) and, in auto mode, goes straight to local until the cooldown ends instead of waiting,
//   · in typhoon-only mode waits for the cooldown once (≤ 30 s) and tries again.
// The page image goes to OUR Vercel function (/api/ocr) which holds the key; the key is never in the browser.
import { ConversionError } from './common.js';

export const ENGINE_KEY = 'sand:ocr:engine';
export const ENGINES = /** @type {const} */ (['local', 'auto', 'typhoon']);
export const ENGINE_LABELS = {
  local: 'ในเครื่อง (Tesseract) — ไม่ส่งภาพออกอินเทอร์เน็ต',
  auto: 'อัตโนมัติ — Typhoon ก่อน ถ้าเต็มหรือใช้ไม่ได้ให้อ่านในเครื่อง',
  typhoon: 'Typhoon OCR เท่านั้น — แม่นยำสุดสำหรับภาษาไทย'
};
export const CLOUD_NOTE = 'เมื่อเลือก Typhoon ภาพหน้าเอกสารจะถูกส่งไปประมวลผลที่บริการ Typhoon (SCB 10X) ผ่านเซิร์ฟเวอร์ของหน่วยงาน — อย่าใช้กับเอกสารที่มีข้อมูลผู้ป่วยหรือชั้นความลับ';
const IMG_MAX_SIDE = 1800;       // the size Typhoon OCR is designed for
const MIN_GAP_MS = 3300;         // 60 000 / 3 300 ≈ 18 requests a minute, under Typhoon's 20
const WAIT_MAX_MS = 30000;       // typhoon-only mode waits at most this long for a cooldown

const mem = { engine: 'local' };
const ls = () => { try { return window.localStorage; } catch { return null; } };

/** @returns {'local'|'auto'|'typhoon'} the saved choice ('local' when nothing valid is saved) */
export function getOcrEngine() {
  try { const v = ls() && ls().getItem(ENGINE_KEY); if (ENGINES.includes(v)) return v; } catch { /* storage blocked */ }
  return ENGINES.includes(mem.engine) ? mem.engine : 'local';
}
export function setOcrEngine(v) {
  const e = ENGINES.includes(v) ? v : 'local'; mem.engine = e;
  try { if (ls()) ls().setItem(ENGINE_KEY, e); } catch { /* storage blocked: kept for this page only */ }
  try { window.dispatchEvent(new CustomEvent('sand:ocr-engine', { detail: e })); } catch { /* not in a page */ }
  return e;
}

/* ------------------------------------------------------------------ pure helpers (unit-tested) */

const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };
const unent = (s) => s.replace(/&(amp|lt|gt|quot|nbsp|#39);/g, (m) => ENT[m] || m);
const cellText = (s) => unent(s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

/**
 * Typhoon output → the plain Markdown the rest of the app expects (the same shape the Tesseract path produces).
 * Removes the model's own picture descriptions (<figure>…</figure> would put Thai prose about the emblem into the letter text) and
 * <page_number> tags, turns each HTML table row into one line with " | " between cells, drops stray tags and a surrounding ``` fence.
 * @param {string} raw @returns {string}
 */
export function cleanTyphoonText(raw) {
  let t = String(raw == null ? '' : raw).replace(/\r\n?/g, '\n').trim();
  const fence = /^```[a-zA-Z]*\n([\s\S]*?)\n```$/.exec(t); if (fence) t = fence[1];
  t = t.replace(/<figure>[\s\S]*?<\/figure>/gi, '\n').replace(/<figure>[\s\S]*$/i, '\n');            // an unclosed figure at the end = a cut-off description
  t = t.replace(/<page_number>[\s\S]*?<\/page_number>/gi, '\n');
  t = t.replace(/<table[\s\S]*?<\/table>/gi, (tbl) => {
    const rows = [...tbl.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((m) => [...m[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => cellText(c[1])).join(' | ').replace(/^(\s*\|\s*)+$/, '')).filter((r) => r.trim());
    return `\n${rows.join('\n')}\n`;
  });
  t = t.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|h[1-6]|li)>/gi, '\n').replace(/<\/?[a-zA-Z][a-zA-Z0-9]*(\s[^<>]*)?\/?>/g, '');   // any tag left over (b, i, sup, span …)
  t = unent(t);
  return t.split('\n').map((l) => l.replace(/[ \t]+$/g, '')).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Typhoon answer → true when it is worth using (not empty, not only a refusal-like one-liner). */
export function usableText(t) { return typeof t === 'string' && t.replace(/\s+/g, '').length >= 8; }

/** What to do with an /api/ocr error: 'fallback' (use local, remember a cooldown for RATE_LIMIT) or 'stop' (show the message). */
export function describeFailure(res, status) {
  const code = (res && res.code) || (status === 401 ? 'AUTH' : 'NETWORK');
  const wait = code === 'RATE_LIMIT' ? Math.min(120, Math.max(1, Number(res && res.retryAfter) || 20)) : 0;
  const messages = {
    RATE_LIMIT: 'Typhoon OCR เต็มโควตาชั่วคราว (จำกัด 20 หน้า/นาที ทั้งหน่วยงาน)', NO_KEY: 'ยังไม่ได้ตั้งค่า Typhoon API key บนเซิร์ฟเวอร์',
    KEY_REJECTED: 'Typhoon ไม่รับ API key', QUOTA: 'เครดิต Typhoon หมด', AUTH: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่', TIMEOUT: 'Typhoon ตอบกลับช้าเกินไป',
    NETWORK: 'เชื่อมต่อ Typhoon ไม่ได้', UPSTREAM: 'Typhoon ตอบกลับผิดปกติ', BAD_IMAGE: 'ภาพหน้าเอกสารส่งไม่ได้', TOO_LARGE: 'ภาพหน้าเอกสารใหญ่เกินไป', EMPTY: 'Typhoon อ่านไม่พบข้อความในหน้านี้'
  };
  return { code, wait, message: (res && res.message) || messages[code] || 'Typhoon OCR ใช้งานไม่ได้', fallback: code !== 'AUTH' };
}

/* ------------------------------------------------------------------ state shared by all pages read in this tab */

let lastSentAt = 0;           // when the previous request left (pacing)
let cooldownUntil = 0;        // after a 429: no request before this time
let probe = null;             // {at, cloud}
let chain = Promise.resolve(); // requests go one after another, so the spacing holds even when two readers run

export const cloudCooldownMs = () => Math.max(0, cooldownUntil - Date.now());
export function resetCloudState() { lastSentAt = 0; cooldownUntil = 0; probe = null; chain = Promise.resolve(); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Is the cloud engine set up on the server (key present)? Cached for 5 minutes. Never throws. */
export async function cloudConfigured(fetchFn = fetch) {
  if (probe && Date.now() - probe.at < 300000) return probe.cloud;
  let cloud = false;
  try { const r = await fetchFn('/api/ocr', { method: 'GET', credentials: 'omit', cache: 'no-store' }); const j = await r.json(); cloud = !!(j && j.cloud === true); } catch { cloud = false; }
  probe = { at: Date.now(), cloud }; return cloud;
}

async function toDataUrl(source) {
  const bmp = source instanceof Blob ? await createImageBitmap(source, { imageOrientation: 'from-image' }) : null;
  const w0 = bmp ? bmp.width : source.width; const h0 = bmp ? bmp.height : source.height;
  const k = Math.min(1, IMG_MAX_SIDE / Math.max(w0, h0));
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w0 * k)); c.height = Math.max(1, Math.round(h0 * k));
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(bmp || source, 0, 0, c.width, c.height);
  if (bmp && bmp.close) bmp.close();
  const blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/jpeg', 0.9));
  c.width = 0; c.height = 0;
  return await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = () => rej(fr.error); fr.readAsDataURL(blob); });
}

/**
 * Read ONE page image with Typhoon. Resolves {markdown, engine:'typhoon'}; rejects with ConversionError whose `.code` is
 * 'CLOUD_COOLDOWN' | 'CLOUD_FAILED' | 'CANCELLED' and `.fallback` says whether the caller may read it with the local engine instead.
 * @param {HTMLCanvasElement|Blob} source the rendered page or the photo
 * @param {{token:string, mode?:'auto'|'typhoon', signal?:AbortSignal, onStatus?:(s:string)=>void, fetchFn?:typeof fetch, imageToUrl?:(s:any)=>Promise<string>}} o
 */
export function typhoonRead(source, o) {
  const run = async () => {
    const mode = o.mode === 'auto' ? 'auto' : 'typhoon'; const say = (s) => { if (o.onStatus) o.onStatus(s); };
    const f = o.fetchFn || fetch;
    const cancelled = () => new ConversionError('CANCELLED', 'ยกเลิกการแปลงแล้ว');
    let image = null;
    for (let attempt = 1; ; attempt += 1) {
      const cool = cloudCooldownMs();
      if (cool > 0) {
        if (mode === 'auto' || cool > WAIT_MAX_MS) throw Object.assign(new ConversionError('CLOUD_COOLDOWN', `Typhoon เต็มโควตา — รออีก ${Math.ceil(cool / 1000)} วินาที`), { fallback: true });
        say(`Typhoon เต็มโควตาชั่วคราว รอ ${Math.ceil(cool / 1000)} วินาที…`); await sleep(cool);
      }
      const gap = lastSentAt + MIN_GAP_MS - Date.now(); if (gap > 0) await sleep(gap);
      if (o.signal && o.signal.aborted) throw cancelled();
      say('กำลังอ่านข้อความด้วย Typhoon OCR');
      if (!image) image = await (o.imageToUrl || toDataUrl)(source);
      lastSentAt = Date.now();
      let res = null; let status = 0;
      try {
        const r = await f('/api/ocr', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session: o.token, image }), credentials: 'omit', signal: o.signal });
        status = r.status; try { res = await r.json(); } catch { res = null; }
      } catch (e) {
        if (e && e.name === 'AbortError') throw cancelled();
        res = { code: 'NETWORK' };
      }
      if (res && res.ok === true && typeof res.text === 'string') {
        const markdown = cleanTyphoonText(res.text);
        if (usableText(markdown)) return { markdown, engine: 'typhoon', model: res.model || '' };
        res = { code: 'EMPTY' };
      }
      const d = describeFailure(res, status);
      if (d.wait) cooldownUntil = Date.now() + d.wait * 1000;
      if (d.code === 'RATE_LIMIT' && mode === 'typhoon' && attempt < 2 && d.wait * 1000 <= WAIT_MAX_MS) continue;   // typhoon-only: one patient retry (the loop waits out the cooldown)
      throw Object.assign(new ConversionError('CLOUD_FAILED', `${d.message}${mode === 'typhoon' ? ' — เปลี่ยนเป็นโหมด “อัตโนมัติ” หรือ “ในเครื่อง” เพื่ออ่านต่อ' : ''}`, d.code), { fallback: d.fallback });
    }
  };
  const p = chain.then(run, run); chain = p.catch(() => {});     // requests go one after another, so the spacing holds even when two readers run
  return p;
}
