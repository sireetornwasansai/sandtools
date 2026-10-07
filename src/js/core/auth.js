import { h, loadScript } from './dom.js';
import { config, APP_NAME } from './config.js';
import { gasCall, ApiError } from './api.js';

const SESSION_KEY = 'sand:session';
/** @typedef {{token:string,exp:number,user:{email:string,name:string,picture?:string}}} Session */

// The session lives in localStorage (not sessionStorage) so staff stay signed in across tabs and browser restarts until it expires (backend SESSION_TTL_MIN).
const store = () => { try { return window.localStorage; } catch { return window.sessionStorage; } };
const REVALIDATE_MS = 10 * 60 * 1000;

/** @returns {(Session & {vAt?:number})|null} */
export function getSession() {
  try {
    const s = JSON.parse(store().getItem(SESSION_KEY) || 'null');
    if (s && s.token && s.exp * 1000 > Date.now()) return s;
  } catch { /* ignore */ }
  return null;
}
function setSession(s) { try { store().setItem(SESSION_KEY, JSON.stringify(s)); } catch { /* ignore */ } }
export function signOut() {
  try { store().removeItem(SESSION_KEY); window.sessionStorage.removeItem(SESSION_KEY); window.localStorage.removeItem('sand:links:list'); Object.keys(window.localStorage).filter((k) => k.startsWith('sand:c:')).forEach((k) => window.localStorage.removeItem(k)); } catch { /* ignore */ }
  if (window.google && window.google.accounts && window.google.accounts.id) window.google.accounts.id.disableAutoSelect();
}
export function loginRequired() { return config.requireLogin; }
export function currentUser() { const s = getSession(); return s ? s.user : null; }

/** Start loading Google's sign-in script right away (called at boot, in parallel with everything else). */
export function preloadLogin() { if (config.googleClientId) loadScript('https://accounts.google.com/gsi/client').catch(() => {}); }

/**
 * Check a stored session with the backend WITHOUT blocking the page: the app opens immediately from the stored session;
 * if the backend later says it is no longer valid, the user is signed out and the login screen appears.
 * Skipped when the session was confirmed in the last 10 minutes.
 */
export function revalidateInBackground() {
  const s = getSession();
  if (!s || Date.now() - (s.vAt || 0) < REVALIDATE_MS) return;
  gasCall('me', { session: s.token }, 15000).then(() => setSession({ ...s, vAt: Date.now() })).catch((e) => {
    if (e instanceof ApiError && ['NETWORK', 'TIMEOUT'].includes(e.code)) return;   // offline / slow backend: keep working
    signOut(); location.reload();
  });
}

/** Validate an existing session with the backend (blocking variant, kept for callers that need the answer). */
export async function validateSession() {
  const s = getSession();
  if (!s) return false;
  try { await gasCall('me', { session: s.token }); return true; } catch (e) {
    if (e instanceof ApiError && ['NETWORK', 'TIMEOUT'].includes(e.code)) return false;
    signOut(); return false;
  }
}

const LOGIN_ERRORS = {
  DOMAIN_NOT_ALLOWED: 'บัญชีนี้ไม่ได้อยู่ในโดเมนที่อนุญาตให้ใช้งาน',
  EMAIL_NOT_VERIFIED: 'อีเมลของบัญชีนี้ยังไม่ได้รับการยืนยัน',
  INVALID_TOKEN: 'ไม่สามารถยืนยันตัวตนกับ Google ได้ กรุณาลองอีกครั้ง',
  RATE_LIMITED: 'มีการพยายามเข้าสู่ระบบบ่อยเกินไป กรุณารอสักครู่',
  NETWORK: 'เชื่อมต่อ Backend ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต',
  TIMEOUT: 'Backend ตอบกลับช้าเกินไป กรุณาลองอีกครั้ง'
};

/** Render the Google sign-in screen into `root`; resolves when the backend accepts the user. */
export function renderLogin(root) {
  return new Promise((resolve) => {
    const status = h('p', { class: 'login-status', role: 'status', 'aria-live': 'polite' });
    const btnHost = h('div', { class: 'login-btn' });
    root.replaceChildren(h('main', { class: 'login', id: 'main' },
      h('div', { class: 'login-card' },
        h('div', { class: 'wordmark wordmark-lg' }, h('span', { class: 'wm-sand' }, 'SAND'), h('span', { class: 'wm-sub' }, 'Office Tools')),
        h('h1', null, 'เข้าสู่ระบบ'),
        h('p', null, 'ใช้บัญชี Google ของหน่วยงานเพื่อเข้าใช้งาน ระบบจะขอเฉพาะชื่อและอีเมลเพื่อยืนยันตัวตนเท่านั้น'),
        btnHost, status,
        h('p', { class: 'hint' }, `${APP_NAME} ไม่เก็บไฟล์หรือเนื้อหาที่คุณใช้งาน เครื่องมือส่วนใหญ่ประมวลผลในเบราว์เซอร์ของคุณ`))));

    const fail = (msg) => { status.textContent = msg; status.className = 'login-status error'; };
    if (!config.googleClientId) { fail('ยังไม่ได้ตั้งค่า GOOGLE_CLIENT_ID ของระบบ'); return; }

    loadScript('https://accounts.google.com/gsi/client').then(() => {
      window.google.accounts.id.initialize({
        client_id: config.googleClientId,
        callback: async (resp) => {
          status.className = 'login-status'; status.textContent = 'กำลังเข้าสู่ระบบ…';
          try {
            const r = await gasCall('login', { idToken: resp.credential }, 30000);
            setSession({ token: r.data.session, exp: r.data.exp, user: r.data.user });
            resolve(undefined);
          } catch (e) { fail(LOGIN_ERRORS[e.code] || e.message || 'เข้าสู่ระบบไม่สำเร็จ'); }
        },
        auto_select: true, ux_mode: 'popup', cancel_on_tap_outside: false
      });
      window.google.accounts.id.renderButton(btnHost, { theme: 'outline', size: 'large', text: 'signin_with', locale: 'th', width: 280 });
      try { window.google.accounts.id.prompt(); } catch { /* One Tap is optional */ }   // one-tap: returning users sign in with a single click
    }).catch(() => fail('โหลดระบบเข้าสู่ระบบของ Google ไม่สำเร็จ'));
  });
}
