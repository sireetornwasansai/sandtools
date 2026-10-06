import { h, loadScript } from './dom.js';
import { config, APP_NAME } from './config.js';
import { gasCall, ApiError } from './api.js';

const SESSION_KEY = 'sand:session';
/** @typedef {{token:string,exp:number,user:{email:string,name:string,picture?:string}}} Session */

/** @returns {Session|null} */
export function getSession() {
  try {
    const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    if (s && s.token && s.exp * 1000 > Date.now()) return s;
  } catch { /* ignore */ }
  return null;
}
function setSession(s) { try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch { /* ignore */ } }
export function signOut() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
  if (window.google && window.google.accounts && window.google.accounts.id) window.google.accounts.id.disableAutoSelect();
}
export function loginRequired() { return config.requireLogin; }
export function currentUser() { const s = getSession(); return s ? s.user : null; }

/** Validate an existing session with the backend (the backend is the authority, not the browser). */
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
  BAD_CREDENTIALS: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง',
  LOCAL_DISABLED: 'ยังไม่เปิดใช้การเข้าสู่ระบบด้วยรหัสผ่าน',
  UNKNOWN_ACTION: 'Backend ยังเป็นเวอร์ชันเก่า กรุณา Deploy Apps Script เวอร์ชันใหม่ (v1.5.0)',
  NETWORK: 'เชื่อมต่อ Backend ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต',
  TIMEOUT: 'Backend ตอบกลับช้าเกินไป กรุณาลองอีกครั้ง'
};

/** Render the sign-in screen (username/password + Google) into `root`; resolves when the backend accepts the user. */
export function renderLogin(root) {
  return new Promise((resolve) => {
    const status = h('p', { class: 'login-status', role: 'status', 'aria-live': 'polite' });
    const btnHost = h('div', { class: 'login-btn' });
    const user = h('input', { type: 'text', id: 'login-user', name: 'username', autocomplete: 'username', required: true, 'aria-label': 'ชื่อผู้ใช้', placeholder: 'ชื่อผู้ใช้', autocapitalize: 'none', spellcheck: 'false' });
    const pass = h('input', { type: 'password', id: 'login-pass', name: 'password', autocomplete: 'current-password', required: true, 'aria-label': 'รหัสผ่าน', placeholder: 'รหัสผ่าน' });
    const submit = h('button', { type: 'submit', class: 'btn btn-primary login-submit' }, 'เข้าสู่ระบบ');
    const form = h('form', { class: 'login-form', novalidate: true }, user, pass, submit);

    const fail = (msg) => { status.textContent = msg; status.className = 'login-status error'; };
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (!user.value.trim() || !pass.value) { fail('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน'); return; }
      submit.disabled = true; status.className = 'login-status'; status.textContent = 'กำลังตรวจสอบ…';
      try {
        const r = await gasCall('passlogin', { username: user.value.trim(), password: pass.value });
        pass.value = '';
        setSession({ token: r.data.session, exp: r.data.exp, user: r.data.user });
        resolve(undefined);
      } catch (e) { fail(LOGIN_ERRORS[e.code] || e.message || 'เข้าสู่ระบบไม่สำเร็จ'); submit.disabled = false; }
    });

    root.replaceChildren(h('main', { class: 'login', id: 'main' },
      h('div', { class: 'login-card' },
        h('div', { class: 'wordmark wordmark-lg' }, h('span', { class: 'wm-sand' }, 'SAND'), h('span', { class: 'wm-sub' }, 'Office Tools')),
        h('h1', null, 'เข้าสู่ระบบ'),
        form,
        h('div', { class: 'login-or' }, h('span', null, 'หรือ')),
        h('p', { class: 'login-lead' }, 'ใช้บัญชี Google ของหน่วยงาน ระบบจะขอเฉพาะชื่อและอีเมลเพื่อยืนยันตัวตนเท่านั้น'),
        btnHost, status,
        h('p', { class: 'hint' }, `เครื่องมือส่วนใหญ่ของ ${APP_NAME} ประมวลผลในเบราว์เซอร์ของคุณ เมื่อเข้าสู่ระบบ ระบบจะบันทึกประวัติการใช้งานของคุณ — อ่านรายละเอียดใน `, h('a', { href: '/privacy', target: '_blank', rel: 'noopener' }, 'นโยบายความเป็นส่วนตัว')))));

    if (!config.googleClientId) { btnHost.remove(); return; } // password sign-in still works without Google configured
    loadScript('https://accounts.google.com/gsi/client').then(() => {
      window.google.accounts.id.initialize({
        client_id: config.googleClientId,
        callback: async (resp) => {
          status.className = 'login-status'; status.textContent = 'กำลังตรวจสอบ…';
          try {
            const r = await gasCall('login', { idToken: resp.credential });
            setSession({ token: r.data.session, exp: r.data.exp, user: r.data.user });
            resolve(undefined);
          } catch (e) { fail(LOGIN_ERRORS[e.code] || e.message || 'เข้าสู่ระบบไม่สำเร็จ'); }
        },
        auto_select: false, ux_mode: 'popup'
      });
      window.google.accounts.id.renderButton(btnHost, { theme: 'outline', size: 'large', text: 'signin_with', locale: 'th', width: 280 });
    }).catch(() => { btnHost.remove(); fail('โหลดระบบเข้าสู่ระบบของ Google ไม่สำเร็จ (ยังใช้ชื่อผู้ใช้และรหัสผ่านได้)'); });
  });
}
