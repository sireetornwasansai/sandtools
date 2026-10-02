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

/** @param {string} action @param {Record<string, any>} [payload] @param {number} [timeoutMs] */
export async function gasCall(action, payload = {}, timeoutMs = 20000) {
  if (!config.gasUrl) throw new ApiError('NO_BACKEND', 'ยังไม่ได้ตั้งค่า Backend (GAS URL)');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
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
  } finally { clearTimeout(timer); }
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
