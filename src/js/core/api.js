import { config } from './config.js';

/**
 * Client for the Google Apps Script web app (the backend).
 * Requests use Content-Type text/plain so the browser sends a "simple" CORS request
 * (Apps Script web apps do not answer preflight OPTIONS requests).
 */
export class ApiError extends Error {
  /** @param {string} code @param {string} message @param {number} [status] HTTP status of the backend response, when known */
  constructor(code, message, status) { super(message); this.code = code; this.status = status; }
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
    let json; let text = '';
    try { text = await res.text(); json = JSON.parse(text); } catch {
      // Not JSON: usually an HTML page from Google (sign-in wall, error page) or an expired /macros/echo redirect (404).
      const html = /^\s*</.test(text);
      console.warn('[SAND] unexpected backend response', { action, status: res.status, html, snippet: text.slice(0, 120) });
      if (html && /accounts\.google\.com|ServiceLogin|Sign in/i.test(text)) throw new ApiError('NOT_PUBLIC', 'Apps Script ไม่ได้เปิดให้ทุกคนเข้าถึง (Who has access ต้องเป็น Anyone)', res.status);
      throw new ApiError('BAD_RESPONSE', 'Backend ตอบกลับในรูปแบบที่ไม่ถูกต้อง', res.status);
    }
    if (!json || json.success !== true) {
      const err = (json && json.error) || {};
      throw new ApiError(err.code || 'UNKNOWN', err.message || 'เกิดข้อผิดพลาดจาก Backend', res.status);
    }
    return json;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (e && e.name === 'AbortError') throw new ApiError('TIMEOUT', 'Backend ตอบกลับช้าเกินไป');
    throw new ApiError('NETWORK', 'เชื่อมต่อ Backend ไม่ได้');
  } finally { clearTimeout(timer); }
}

/**
 * gasCall with automatic retries for transient failures (timeout, network, bad/expired redirect response).
 * Only use for idempotent actions such as sign-in.
 * @param {string} action @param {Record<string, any>} [payload] @param {{timeoutMs?:number,retries?:number,onRetry?:(n:number,e:ApiError)=>void}} [opts]
 */
export async function gasCallRetry(action, payload = {}, opts = {}) {
  const { timeoutMs = 30000, retries = 2, onRetry } = opts;
  for (let attempt = 0; ; attempt++) {
    try { return await gasCall(action, payload, timeoutMs); } catch (e) {
      const transient = e instanceof ApiError && ['TIMEOUT', 'NETWORK', 'BAD_RESPONSE'].includes(e.code);
      if (!transient || attempt >= retries) throw e;
      if (onRetry) onRetry(attempt + 1, e);
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
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
