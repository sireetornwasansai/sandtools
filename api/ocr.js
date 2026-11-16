// Vercel Edge Function: /api/ocr — cloud OCR through Typhoon OCR (Thai-specialised vision model), used only when the person chooses it.
//
//   GET  /api/ocr            → {cloud:true|false, model}                     (no key needed: tells the page whether the cloud engines can be offered)
//   POST /api/ocr  {session, image:"data:image/jpeg;base64,…"}  → {ok:true, text, model, ms}
//                                                                   or {ok:false, code, message, retryAfter?}
//
// Why a relay: the Typhoon API key must never reach the browser. It lives only in the Vercel environment variable TYPHOON_API_KEY.
// Who may call it: only signed-in staff. The session token the page already holds is checked with Apps Script (action "me", which also
// re-checks the allow-list), and an answer is remembered for 60 s inside the edge instance so a 3-page letter costs one check, not three.
// Typhoon's limit is 2 requests/second and 20/minute for the WHOLE account (all staff share it), so a 429 is passed on as
// {code:'RATE_LIMIT', retryAfter} and the page falls back to the on-device engine (see converters/ocr-cloud.js).
// Environment variables: TYPHOON_API_KEY (new), SAND_GAS_URL (already used by the other edge functions),
//                        SAND_TYPHOON_MODEL (optional, default "typhoon-ocr"), SAND_TYPHOON_URL (optional, default https://api.opentyphoon.ai/v1)
export const config = { runtime: 'edge' };

const DEFAULT_MODEL = 'typhoon-ocr';
const DEFAULT_URL = 'https://api.opentyphoon.ai/v1';
const MAX_BODY = 4_000_000;                       // bytes of JSON (Vercel's request-body ceiling is ≈ 4.5 MB)
const MAX_IMAGE_CHARS = 3_400_000;                // base64 text of ONE page image (≈ 2.5 MB of JPEG)
const SESSION_MEMO_MS = 60_000; const SESSION_MEMO_MAX = 300;
const TYPHOON_TIMEOUT_MS = 55_000;

const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra } });
const fail = (code, message, status, more = {}) => json({ ok: false, code, message, ...more }, status);

/** Pure: the model id to call. Only simple ids are accepted so a bad environment value cannot redirect the request. */
export function modelId(env) {
  const m = String((env && env.SAND_TYPHOON_MODEL) || '').trim();
  return /^[A-Za-z0-9._-]{3,60}$/.test(m) ? m : DEFAULT_MODEL;
}

/** Pure: base URL of the Typhoon (OpenAI-compatible) API. https only. */
export function baseUrl(env) {
  const u = String((env && env.SAND_TYPHOON_URL) || '').trim().replace(/\/+$/, '');
  return /^https:\/\/[A-Za-z0-9.-]+(:\d+)?(\/[A-Za-z0-9._~\/-]*)?$/.test(u) ? u : DEFAULT_URL;
}

/** Pure: is `image` a data URL of a JPEG/PNG/WebP of acceptable size? */
export function checkImage(image) {
  if (typeof image !== 'string') return 'ไม่พบรูปภาพ';
  if (image.length > MAX_IMAGE_CHARS) return 'รูปหน้าเอกสารใหญ่เกินไป';
  if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image)) return 'รูปแบบรูปภาพไม่ถูกต้อง';
  return '';
}

/** Pure: the Typhoon OCR 1.5 prompt (the model reads the whole page from the image alone; no anchor text is needed). */
export function ocrPrompt() {
  return `Extract all text from the image.\n\nInstructions:\n- Only return the clean Markdown.\n- Do not include any explanation or extra text.\n- You must include all information on the page.\n\nFormatting Rules:\n- Tables: Render tables using <table>...</table> in clean HTML format.\n- Equations: Render equations using LaTeX syntax with inline ($...$) and block ($$...$$).\n- Images/Charts/Diagrams: Wrap any clearly defined visual areas (e.g. charts, diagrams, pictures) in:\n\n<figure>\nBriefly describe the visual. Describe in Thai.\n</figure>\n\n- Page Numbers: Wrap page numbers in <page_number>...</page_number> (e.g., <page_number>14</page_number>).\n- Checkboxes: Use ☐ for unchecked and ☑ for checked boxes.\n`;
}

/** Pure: request body for the chat-completions endpoint (same sampling the Typhoon OCR package uses for v1.5). */
export function buildRequest(model, image) {
  return {
    model,
    messages: [{ role: 'user', content: [{ type: 'text', text: ocrPrompt() }, { type: 'image_url', image_url: { url: image } }] }],
    max_tokens: 8192,
    temperature: 0.1, top_p: 0.6, repetition_penalty: 1.1
  };
}

/** Pure: seconds to wait before retrying, from a Retry-After header (number of seconds or an HTTP date); 20 s when it is absent (Typhoon's window is 1 minute). */
export function retryAfterSeconds(v, now = Date.now()) {
  if (v == null || v === '') return 20;
  const n = Number(v);
  if (Number.isFinite(n)) return Math.min(120, Math.max(1, Math.round(n)));
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? Math.min(120, Math.max(1, Math.ceil((t - now) / 1000))) : 20;
}

const MEMO = new Map();
async function tokenKey(token) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(buf)].slice(0, 10).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Is this session token valid? Asks Apps Script ("me": signature, expiry and allow-list) and remembers a yes for a minute. */
async function sessionOk(gas, token, fetchFn = fetch) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 3000) return false;
  const k = await tokenKey(token); const hit = MEMO.get(k);
  if (hit && hit > Date.now()) return true;
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetchFn(gas, { method: 'POST', headers: { 'content-type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'me', session: token }), redirect: 'follow', signal: ctrl.signal });
    const j = await r.json();
    if (!j || j.success !== true) return false;
    if (MEMO.size >= SESSION_MEMO_MAX) MEMO.delete(MEMO.keys().next().value);
    MEMO.set(k, Date.now() + SESSION_MEMO_MS);
    return true;
  } catch { return false; } finally { clearTimeout(t); }
}

export default async function handler(request) {
  const env = process.env; const key = env.TYPHOON_API_KEY || ''; const model = modelId(env);
  if (request.method === 'GET') return json({ cloud: Boolean(key && env.SAND_GAS_URL), model });
  if (request.method !== 'POST') return fail('METHOD', 'ไม่รองรับคำขอนี้', 405);
  if (!key) return fail('NO_KEY', 'ยังไม่ได้ตั้งค่า TYPHOON_API_KEY บนเซิร์ฟเวอร์', 503);
  const gas = env.SAND_GAS_URL; if (!gas) return fail('NO_BACKEND', 'ยังไม่ได้ตั้งค่า SAND_GAS_URL', 503);

  const text = await request.text();
  if (text.length > MAX_BODY) return fail('TOO_LARGE', 'คำขอใหญ่เกินไป', 413);
  let body = null; try { body = JSON.parse(text); } catch { body = null; }
  if (!body || typeof body !== 'object') return fail('BAD_REQUEST', 'รูปแบบคำขอไม่ถูกต้อง', 400);
  if (!(await sessionOk(gas, body.session))) return fail('AUTH', 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่', 401);
  const bad = checkImage(body.image); if (bad) return fail('BAD_IMAGE', bad, 400);

  const t0 = Date.now(); const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), TYPHOON_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl(env)}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify(buildRequest(model, body.image)), signal: ctrl.signal });
    if (res.status === 429) return fail('RATE_LIMIT', 'Typhoon OCR เต็มโควตาชั่วคราว (จำกัด 20 ครั้ง/นาที)', 429, { retryAfter: retryAfterSeconds(res.headers.get('retry-after')) });
    if (res.status === 401 || res.status === 403) return fail('KEY_REJECTED', 'Typhoon ไม่รับ API key (ตรวจสอบหรือสร้าง key ใหม่)', 502);
    if (res.status === 402) return fail('QUOTA', 'เครดิต Typhoon หมด', 502);
    if (!res.ok) return fail('UPSTREAM', `Typhoon ตอบกลับผิดปกติ (HTTP ${res.status})`, 502);
    const j = await res.json();
    const out = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    if (typeof out !== 'string') return fail('UPSTREAM', 'Typhoon ตอบกลับในรูปแบบที่ไม่คาดคิด', 502);
    return json({ ok: true, text: out.slice(0, 60000), model, ms: Date.now() - t0 });
  } catch (e) {
    return e && e.name === 'AbortError' ? fail('TIMEOUT', 'Typhoon ตอบกลับช้าเกินไป', 504) : fail('NETWORK', 'เชื่อมต่อ Typhoon ไม่ได้', 502);
  } finally { clearTimeout(timer); }
}
