// Backend helpers shared by pages that read statistics: a session-aware call and a tiny per-user "show the last answer first" cache.
import { getSession, signOut } from './auth.js';
import { gasCall } from './api.js';

/** Call a signed-in backend action (e.g. 'projects' / 'overview'). Signs the user out when the session is no longer valid. */
export async function sessionCall(action, op, params = {}, timeout = 60000) {
  const s = getSession();
  if (!s) { const e = new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่'); /** @type {any} */ (e).code = 'INVALID_SESSION'; throw e; }
  try { return (await gasCall(action, { session: s.token, op, ...params }, timeout)).data; } catch (e) {
    if (e && (/** @type {any} */ (e).code === 'INVALID_SESSION' || /** @type {any} */ (e).code === 'DOMAIN_NOT_ALLOWED')) signOut();
    throw e;
  }
}

const who = () => { const s = getSession(); return (s && s.user && s.user.email) || ''; };

/** Last answer kept in this browser for the signed-in user → {d, t} or null. Lets pages paint instantly, then refresh behind the scenes. */
export function cacheGet(key, maxAgeMs = 7 * 86400000) {
  try { const c = JSON.parse(localStorage.getItem(`sand:c:${key}`) || 'null'); return c && c.u === who() && Date.now() - c.t < maxAgeMs ? { d: c.d, t: c.t } : null; } catch { return null; }
}
export function cacheSet(key, d) {
  try { const t = JSON.stringify({ u: who(), t: Date.now(), d }); if (t.length < 900000) localStorage.setItem(`sand:c:${key}`, t); } catch { /* quota */ }
}
