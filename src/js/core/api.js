import { config } from './config.js';

/**
 * Client for the Google Apps Script web app (the backend).
 * Requests use Content-Type text/plain so the browser sends a "simple" CORS request
 * (Apps Script web apps do not answer preflight OPTIONS requests).
 */
export class ApiError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) { super(message); this.code = code; }
}

export function backendConfigured() { return Boolean(config.gasUrl); }

let inflight = 0;
/** Tell the shell how many backend calls are running (it shows a thin activity bar while > 0). */
function netBusy(delta) { inflight = Math.max(0, inflight + delta); try { window.dispatchEvent(new CustomEvent('sand:net', { detail: inflight })); } catch { /* ignore */ } }
export const netInflight = () => inflight;

/** @param {string} action @param {Record<string, any>} [payload] @param {number} [timeoutMs] */
export async function gasCall(action, payload = {}, timeoutMs = 20000) {
  if (!config.gasUrl) throw new ApiError('NO_BACKEND', 'ยังไม่ได้ตั้งค่า Backend (GAS URL)');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  netBusy(1);
  try {
    const res = await fetch(config.gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, ...payload }),
      redirect: 'follow', credentials: 'omit', signal: ctrl.signal, referrerPolicy: 'no-referrer'
    });
    let json;
    try { json = await res.json(); } catch { throw new ApiError('BAD_RESPONSE', 'Backend ตอบกลับในรูปแบบที่ไม่ถูกต้อง'); }
    if (!json || json.success !== true) {
      const err = (json && json.error) || {};
      throw new ApiError(err.code || 'UNKNOWN', err.message || 'เกิดข้อผิดพลาดจาก Backend');
    }
    return json;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (e && e.name === 'AbortError') throw new ApiError('TIMEOUT', 'Backend ตอบกลับช้าเกินไป');
    throw new ApiError('NETWORK', 'เชื่อมต่อ Backend ไม่ได้');
  } finally { clearTimeout(timer); netBusy(-1); }
}

let warmed = false;
/** Fire-and-forget request that wakes the (sleeping) Apps Script web app so the first real call is fast. Safe to call many times. */
export function warmBackend() {
  if (warmed || !config.gasUrl) return; warmed = true;
  try { fetch(`${config.gasUrl}${config.gasUrl.includes('?') ? '&' : '?'}action=version`, { redirect: 'follow', credentials: 'omit', referrerPolicy: 'no-referrer', keepalive: true }).catch(() => {}); } catch { /* ignore */ }
}

/** Public health check (GET). Returns {ok, version, ms} or throws. */
export async function backendHealth() {
  if (!config.gasUrl) throw new ApiError('NO_BACKEND', 'ยังไม่ได้ตั้งค่า Backend (GAS URL)');
  const t0 = performance.now();
  const res = await fetch(`${config.gasUrl}${config.gasUrl.includes('?') ? '&' : '?'}action=health`, { redirect: 'follow', credentials: 'omit', referrerPolicy: 'no-referrer' });
  const json = await res.json();
  if (!json || json.success !== true) throw new ApiError('UNHEALTHY', 'Backend ไม่พร้อมใช้งาน');
  return { ...json.data, ms: Math.round(performance.now() - t0) };
}
