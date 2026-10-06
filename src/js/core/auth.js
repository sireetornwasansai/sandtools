import { h, loadScript } from './dom.js';
import { config, APP_NAME } from './config.js';
import { gasCall, gasCallRetry, ApiError, backendHealth, backendConfigured } from './api.js';

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
    if (e instanceof ApiError && ['NETWORK', 'TIMEOUT', 'BAD_RESPONSE'].includes(e.code)) return false;
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
  BAD_RESPONSE: 'ระบบหลังบ้านตอบกลับผิดปกติ กรุณาลองอีกครั้ง หากยังเป็นอยู่ให้แจ้งผู้ดูแลระบบ',
  NOT_PUBLIC: 'ระบบหลังบ้านยังไม่เปิดให้เข้าถึง กรุณาแจ้งผู้ดูแลระบบ (Apps Script ต้องตั้งเป็น Anyone)',
  UNKNOWN_ACTION: 'Backend ยังเป็นเวอร์ชันเก่า กรุณา Deploy Apps Script เวอร์ชันใหม่ (v1.5.0)',
  NETWORK: 'เชื่อมต่อ Backend ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต',
  TIMEOUT: 'Backend ตอบกลับช้าเกินไป กรุณาลองอีกครั้ง'
};

/** Messages shown while a sign-in request is in flight, so a slow (cold-starting) backend never looks like a frozen page. */
const WAIT_STAGES = [
  [0, 'กำลังตรวจสอบข้อมูล…'],
  [4000, 'ระบบกำลังเริ่มทำงาน อาจใช้เวลาสักครู่ กรุณาอย่ารีเฟรชหน้านี้'],
  [12000, 'ใช้เวลานานกว่าปกติ ระบบยังทำงานอยู่ กรุณารอสักครู่…'],
  [25000, 'ยังรอการตอบกลับจากระบบอยู่ หากไม่สำเร็จ ระบบจะลองเชื่อมต่อให้อีกครั้งโดยอัตโนมัติ']
];
const HEALTH_TEXT = {
  checking: 'กำลังเตรียมระบบ…',
  waking: 'ระบบกำลังเริ่มทำงาน โปรดรอสักครู่…',
  ready: 'ระบบพร้อมใช้งาน',
  down: 'เชื่อมต่อระบบไม่ได้ในขณะนี้ — ลองเข้าสู่ระบบอีกครั้ง หรือตรวจสอบอินเทอร์เน็ต'
};
/** Friendly message + a short technical reference the user can quote to the administrator. */
const explain = (e) => {
  const msg = LOGIN_ERRORS[e && e.code] || (e && e.message) || 'เข้าสู่ระบบไม่สำเร็จ';
  return e && ['BAD_RESPONSE', 'NOT_PUBLIC', 'TIMEOUT', 'NETWORK', 'UNKNOWN', 'INTERNAL', 'UPSTREAM', 'NOT_CONFIGURED'].includes(e.code) ? `${msg} (รหัส: ${e.code}${e.status ? ` · HTTP ${e.status}` : ''})` : msg;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Full-page splash shown while an existing session is being re-validated on startup. */
export function renderSplash(root, text = 'กำลังตรวจสอบการเข้าสู่ระบบ…') {
  root.replaceChildren(h('main', { class: 'login', id: 'main' },
    h('div', { class: 'splash', role: 'status', 'aria-live': 'polite' },
      h('div', { class: 'wordmark wordmark-lg' }, h('span', { class: 'wm-sand' }, 'SAND'), h('span', { class: 'wm-sub' }, 'Office Tools')),
      h('span', { class: 'spinner', 'aria-hidden': 'true' }), h('p', null, text))));
}

/** Render the sign-in screen (username/password + Google) into `root`; resolves when the backend accepts the user. */
export function renderLogin(root) {
  return new Promise((resolve) => {
    let timers = [];
    const status = h('p', { class: 'login-status', role: 'status', 'aria-live': 'polite' });
    const say = (msg, kind = '') => { status.textContent = msg; status.className = `login-status ${kind}`.trim(); };
    const btnHost = h('div', { class: 'login-btn' }, h('div', { class: 'login-skel skeleton', 'aria-hidden': 'true' }));

    const user = h('input', { type: 'text', id: 'login-user', name: 'username', autocomplete: 'username', required: true, 'aria-label': 'ชื่อผู้ใช้', placeholder: 'ชื่อผู้ใช้', autocapitalize: 'none', spellcheck: 'false' });
    const pass = h('input', { type: 'password', id: 'login-pass', name: 'password', autocomplete: 'current-password', required: true, 'aria-label': 'รหัสผ่าน', placeholder: 'รหัสผ่าน' });
    const reveal = h('button', { type: 'button', class: 'pw-toggle', 'aria-label': 'แสดงรหัสผ่าน', 'aria-pressed': 'false' }, 'แสดง');
    reveal.addEventListener('click', () => {
      const show = pass.type === 'password'; pass.type = show ? 'text' : 'password';
      reveal.textContent = show ? 'ซ่อน' : 'แสดง'; reveal.setAttribute('aria-pressed', String(show)); reveal.setAttribute('aria-label', show ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน');
    });
    const label = h('span', { class: 'btn-label' }, 'เข้าสู่ระบบ');
    const submit = h('button', { type: 'submit', class: 'btn btn-primary login-submit' }, h('span', { class: 'spinner spinner-sm', 'aria-hidden': 'true' }), label);
    const form = h('form', { class: 'login-form', novalidate: true }, user, h('div', { class: 'pw-wrap' }, pass, reveal), submit);
    const health = h('p', { class: 'login-health', 'data-state': 'checking' }, h('span', { class: 'dot', 'aria-hidden': 'true' }), h('span', { class: 'txt', role: 'status', 'aria-live': 'polite' }, HEALTH_TEXT.checking));
    const bar = h('div', { class: 'login-bar', 'aria-hidden': 'true' }, h('span'));
    const card = h('div', { class: 'login-card' }, bar,
      h('div', { class: 'wordmark wordmark-lg' }, h('span', { class: 'wm-sand' }, 'SAND'), h('span', { class: 'wm-sub' }, 'Office Tools')),
      h('h1', null, 'เข้าสู่ระบบ'),
      form,
      h('div', { class: 'login-or' }, h('span', null, 'หรือ')),
      h('p', { class: 'login-lead' }, 'ใช้บัญชี Google ของหน่วยงาน ระบบจะขอเฉพาะชื่อและอีเมลเพื่อยืนยันตัวตนเท่านั้น'),
      btnHost, status, health,
      h('p', { class: 'hint' }, `เครื่องมือส่วนใหญ่ของ ${APP_NAME} ประมวลผลในเบราว์เซอร์ของคุณ เมื่อเข้าสู่ระบบ ระบบจะบันทึกประวัติการใช้งานของคุณ — อ่านรายละเอียดใน `, h('a', { href: '/privacy', target: '_blank', rel: 'noopener' }, 'นโยบายความเป็นส่วนตัว')));
    root.replaceChildren(h('main', { class: 'login', id: 'main' }, card));

    /* ---- busy state: spinner in the button, progress bar, locked inputs, staged reassurance text ---- */
    const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };
    const setBusy = (on) => {
      clearTimers();
      card.classList.toggle('is-busy', on); card.setAttribute('aria-busy', String(on));
      user.readOnly = on; pass.readOnly = on; submit.disabled = on; reveal.disabled = on;
      label.textContent = on ? 'กำลังตรวจสอบ…' : 'เข้าสู่ระบบ';
      if (on) WAIT_STAGES.forEach(([ms, msg]) => { timers.push(setTimeout(() => say(msg), ms)); });
    };
    const fail = (msg) => { setBusy(false); say(msg, 'error'); };
    const succeed = async (r) => {
      setSession({ token: r.data.session, exp: r.data.exp, user: r.data.user });
      clearTimers(); card.classList.add('is-done'); say('เข้าสู่ระบบสำเร็จ กำลังเปิดแอป…', 'ok');
      await sleep(350); resolve(undefined);
    };

    /* ---- backend status chip + warm-up: waking Apps Script now means the first real login is fast ---- */
    const setHealth = (state) => { health.dataset.state = state; health.querySelector('.txt').textContent = HEALTH_TEXT[state]; };
    if (!backendConfigured()) setHealth('down');
    else {
      const wake = setTimeout(() => { if (health.dataset.state === 'checking') setHealth('waking'); }, 2500);
      Promise.race([backendHealth(), sleep(30000).then(() => { throw new Error('timeout'); })])
        .then(() => setHealth('ready')).catch(() => setHealth('down')).finally(() => clearTimeout(wake));
    }

    /* ---- username / password ---- */
    const retryNote = (n) => say(`กำลังลองเชื่อมต่ออีกครั้ง (${n})…`);
    const passLoginWithRetry = (username, password) => gasCallRetry('passlogin', { username, password }, { onRetry: retryNote });

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (card.classList.contains('is-busy')) return;
      if (!user.value.trim() || !pass.value) { say('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน', 'error'); (user.value.trim() ? pass : user).focus(); return; }
      setBusy(true);
      try {
        const r = await passLoginWithRetry(user.value.trim(), pass.value);
        pass.value = ''; await succeed(r);
      } catch (e) { fail(explain(e)); pass.select(); }
    });

    /* ---- Google ---- */
    if (!config.googleClientId) { btnHost.remove(); return; } // password sign-in still works without Google configured
    loadScript('https://accounts.google.com/gsi/client').then(() => {
      window.google.accounts.id.initialize({
        client_id: config.googleClientId,
        callback: async (resp) => {
          setBusy(true);
          try { await succeed(await gasCallRetry('login', { idToken: resp.credential }, { onRetry: retryNote })); }
          catch (e) { fail(explain(e)); }
        },
        auto_select: false, ux_mode: 'popup'
      });
      btnHost.replaceChildren();
      window.google.accounts.id.renderButton(btnHost, { theme: 'outline', size: 'large', text: 'signin_with', locale: 'th', width: 280 });
    }).catch(() => { btnHost.remove(); say('โหลดระบบเข้าสู่ระบบของ Google ไม่สำเร็จ (ยังใช้ชื่อผู้ใช้และรหัสผ่านได้)', 'error'); });
  });
}
