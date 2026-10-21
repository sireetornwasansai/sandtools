// วันที่ทั้งเว็บ = วัน/เดือน/ปี  (เช่น 21/10/2569)
//
// 1) ช่องเลือกวันที่: ช่อง <input type="date"> ของเบราว์เซอร์แสดงรูปแบบตามภาษาของเครื่อง (บางเครื่องเป็น เดือน/วัน/ปี) และเราบังคับไม่ได้
//    ไฟล์นี้จึงเปลี่ยนทุกช่องให้เป็นช่องพิมพ์ "วว/ดด/ปปปป" (เติม / ให้เอง) + ไอคอนปฏิทินด้านขวา กดแล้วเปิดปฏิทินของเบราว์เซอร์เพื่อเลือก
//    - v1.13: ปฏิทินวาดเอง (core/calendar.js) แทนการสั่ง showPicker() ของช่อง date ที่ซ่อนไว้ (ในแอป LINE / iOS บางรุ่นกดไม่ติด) · มือถือแตะช่องไหนก็เปิดปฏิทิน (แผ่นด้านล่างจอ)
//    - ตั้ง el._dfMark = (iso) => 'ชื่อวันหยุด' | '' เพื่อให้ปฏิทินขีดแดงวันหยุดของช่องนั้น
//    - โค้ดของหน้าอื่น ๆ ไม่ต้องแก้: .value ยังอ่าน/เขียนเป็น "yyyy-mm-dd" (ค.ศ.) เหมือนเดิม และยังมีเหตุการณ์ input / change
//    - ทำงานกับช่องที่ถูกสร้างภายหลังอัตโนมัติ (MutationObserver) และกับ Shadow DOM ของหน้า HR (initDates(shadowRoot))
// 2) ฟังก์ชันจัดรูปแบบสำหรับข้อความที่แสดง: fmtDate / fmtDateTime
//
// ปีที่แสดง: พ.ศ. (สอดคล้องกับทะเบียนหนังสือ/HR เดิม) — ถ้าต้องการให้แสดง ค.ศ. เปลี่ยน YEAR_BE เป็น false บรรทัดเดียว
// การพิมพ์รับได้ทั้งสองแบบ: ปี ≥ 2400 ถือเป็น พ.ศ. นอกนั้นเป็น ค.ศ. (พิมพ์ 21/10/2026 หรือ 21/10/2569 ได้ค่าเดียวกัน)
import { openCalendar } from './calendar.js';

export const YEAR_BE = true;

const pad = (n, l = 2) => String(n).padStart(l, '0');
const shownYear = (y) => (YEAR_BE ? Number(y) + 543 : Number(y));

/** "2026-10-21" (หรือ "2026-10-21 10:05:00") → "21/10/2569" ; ค่าที่อ่านไม่ได้ → "" */
export function isoToDisplay(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}/${shownYear(m[1])}` : '';
}

/** "21/10/2569" | "21-10-2026" | "21.10.69"(ไม่รับ) → "2026-10-21" ; วันที่ไม่มีจริง (31/02) หรืออ่านไม่ได้ → "" */
export function displayToIso(text) {
  const m = /^(\d{1,2})[/\-.\s](\d{1,2})[/\-.\s](\d{4})$/.exec(String(text || '').trim());
  if (!m) return '';
  const d = Number(m[1]); const mo = Number(m[2]); let y = Number(m[3]);
  if (y >= 2400) y -= 543;
  if (y < 1900 || y > 2999 || mo < 1 || mo > 12 || d < 1) return '';
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return '';
  return `${pad(y, 4)}-${pad(mo)}-${pad(d)}`;
}

/** วันที่แบบสั้นสำหรับแสดงผล: "yyyy-mm-dd" | Date | timestamp(ms) → "21/10/2569" ; ว่าง/อ่านไม่ได้ → "" */
export function fmtDate(v) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) && !/[T ]\d{2}:\d{2}.*(Z|[+-]\d{2}:?\d{2})$/.test(v)) return isoToDisplay(v);
  const p = bangkokParts(v);
  return p ? `${p.d}/${p.m}/${shownYear(p.y)}` : '';
}

/** วันที่+เวลา: → "21/10/2569 10:05" (เวลาประเทศไทย) ; ว่าง → "-" */
export function fmtDateTime(v) {
  const p = (v === null || v === undefined || v === '') ? null : bangkokParts(v);
  return p ? `${p.d}/${p.m}/${shownYear(p.y)} ${p.h}:${p.i}` : '-';
}

/** @returns {{y:string,m:string,d:string,h:string,i:string}|null} ปี/เดือน/วัน/ชั่วโมง/นาที ตามเวลา Asia/Bangkok */
function bangkokParts(v) {
  const dt = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(dt.getTime())) return null;
  try {
    const o = {};
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(dt).forEach((x) => { o[x.type] = x.value; });
    return { y: o.year, m: o.month, d: o.day, h: o.hour === '24' ? '00' : o.hour, i: o.minute };
  } catch { return null; }
}

/** ข้อความที่กำลังพิมพ์ → วว/ดด/ปปปป  (ตัวเลขล้วนเติม / ให้; พิมพ์ 5/ จะเป็น 05/) */
export function maskDate(raw, deleting = false) {
  let s = String(raw || '');
  if (!deleting) s = s.replace(/(^|\D)(\d)(?=\D)/g, '$10$2');
  const dg = s.replace(/\D/g, '').slice(0, 8);
  let out = dg.slice(0, 2);
  if (dg.length > 2) out += `/${dg.slice(2, 4)}`;
  if (dg.length > 4) out += `/${dg.slice(4, 8)}`;
  return out;
}

/* ------------------------------------------------ ช่องเลือกวันที่ ------------------------------------------------ */
const CAL_ICON = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='4.5' width='18' height='16.5' rx='2.5'/%3E%3Cpath d='M8 2.5v4M16 2.5v4M3 10h18'/%3E%3C/svg%3E\")";
const CSS = `input.df-input{background-image:${CAL_ICON};background-repeat:no-repeat;background-position:right .65rem center;background-size:1.15rem;padding-right:2.4rem!important;font-variant-numeric:tabular-nums}
input.df-input.df-bad{border-color:#dc2626!important;box-shadow:0 0 0 3px rgb(220 38 38/.18)!important}`;
const ZONE = 40;                                                   // ความกว้าง (px) ด้านขวาของช่องที่ถือว่ากดไอคอนปฏิทิน
const SEEN = new WeakSet();
const ROOTS = new WeakSet();

function ensureStyle(root) {
  const host = root === document ? document.head : root;
  if (host.querySelector && host.querySelector('style[data-datefield]')) return;
  const st = document.createElement('style'); st.setAttribute('data-datefield', ''); st.textContent = CSS; host.append(st);
}

/** เปลี่ยน <input type="date"> หนึ่งช่องให้เป็นช่องพิมพ์ วว/ดด/ปปปป (เรียกซ้ำได้ ไม่ทำซ้ำ) */
export function enhanceDate(el) {
  if (!el || SEEN.has(el) || el.tagName !== 'INPUT' || el.type !== 'date') return;
  SEEN.add(el);
  const root = el.getRootNode && el.getRootNode() instanceof ShadowRoot ? el.getRootNode() : document;
  const initial = el.value;                                        // อ่านก่อนเปลี่ยนชนิด (ค่าเป็น yyyy-mm-dd)
  const nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  const nativeGet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').get;
  el.type = 'text';
  el.classList.add('df-input');
  el.setAttribute('inputmode', 'numeric'); el.setAttribute('autocomplete', 'off'); el.setAttribute('maxlength', '10');
  el.setAttribute('placeholder', el.getAttribute('placeholder') || 'วว/ดด/ปปปป');
  if (!el.title) el.title = 'พิมพ์ วว/ดด/ปปปป หรือกดไอคอนปฏิทินเพื่อเลือก';
  let good = isoToDisplay(initial);                                // ข้อความล่าสุดที่ถูกต้อง (ไว้คืนค่าเมื่อพิมพ์ผิด)
  nativeSet.call(el, good);

  // โค้ดอื่นอ่าน/เขียน .value เป็น yyyy-mm-dd เหมือนช่องวันที่เดิม
  Object.defineProperty(el, 'value', {
    configurable: true,
    get() { return displayToIso(nativeGet.call(el)); },
    set(v) { good = isoToDisplay(v); nativeSet.call(el, good); el.classList.remove('df-bad'); }
  });
  Object.defineProperty(el, 'valueAsDate', { configurable: true, get() { const i = el.value; return i ? new Date(`${i}T00:00:00Z`) : null; }, set(d) { el.value = d ? new Date(d).toISOString().slice(0, 10) : ''; } });

  const inRange = (iso) => { const mn = el.getAttribute('min'); const mx = el.getAttribute('max'); return !((mn && iso < mn) || (mx && iso > mx)); };
  const fire = (name) => el.dispatchEvent(new Event(name, { bubbles: true }));
  const commit = () => {                                           // ตรวจข้อความที่พิมพ์ ถ้าไม่ถูกต้องคืนค่าเดิม
    const txt = nativeGet.call(el).trim();
    if (!txt) { good = ''; el.classList.remove('df-bad'); return; }
    const iso = displayToIso(txt);
    if (!iso || !inRange(iso)) {
      el.classList.add('df-bad'); el.title = iso ? 'วันที่อยู่นอกช่วงที่เลือกได้' : 'กรอกวันที่ให้ถูกต้อง เช่น 21/10/2569';
      nativeSet.call(el, good); setTimeout(() => el.classList.remove('df-bad'), 1600);
      return;
    }
    good = isoToDisplay(iso); nativeSet.call(el, good); el.classList.remove('df-bad');
  };

  el.addEventListener('input', (e) => {
    const before = nativeGet.call(el); const m = maskDate(before, !!(e.inputType && e.inputType.startsWith('delete')));
    if (m !== before) nativeSet.call(el, m);
    el.classList.remove('df-bad');                                 // `good` is only updated by commit() (so an out-of-range date can still be reverted)
  });
  el.addEventListener('change', () => commit(), true);             // จังหวะ capture: ตรวจก่อนผู้ฟัง change ของหน้าต่าง ๆ
  el.addEventListener('blur', commit);
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commit();
    if (e.key === 'F4' || (e.altKey && e.key === 'ArrowDown')) { e.preventDefault(); openPicker(); }
  });

  // ปฏิทิน: core/calendar.js — เดสก์ท็อป = ป๊อปอัปใต้ช่อง · มือถือ = แผ่นด้านล่างจอ
  const coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  function openPicker() {
    if (el.disabled || el.readOnly) return;
    commit();
    openCalendar({
      anchor: el, root, value: el.value, min: el.getAttribute('min') || '', max: el.getAttribute('max') || '',
      marks: typeof el._dfMark === 'function' ? el._dfMark : undefined,
      onPick: (iso) => { good = isoToDisplay(iso); nativeSet.call(el, good); el.classList.remove('df-bad'); fire('input'); fire('change'); }
    });
  }
  const inZone = (e) => { const r = el.getBoundingClientRect(); return e.clientX >= r.right - ZONE; };
  if (coarse) { el.setAttribute('inputmode', 'none'); el.setAttribute('aria-haspopup', 'dialog'); }   // phone: tap anywhere on the field → calendar, no on-screen keyboard
  el.addEventListener('mousemove', (e) => { el.style.cursor = coarse || inZone(e) ? 'pointer' : ''; });
  el.addEventListener('click', (e) => { if (coarse || inZone(e)) { e.preventDefault(); openPicker(); } });
  el.addEventListener('keydown', (e) => { if (e.key === ' ' && coarse) { e.preventDefault(); openPicker(); } });
  // label ที่ชี้มาที่ช่องนี้ใช้ได้ตามปกติ (ช่องยังเป็น element เดิม มี id เดิม)
}

/** เปลี่ยนทุกช่องวันที่ใน root (document หรือ shadowRoot) และเฝ้าดูช่องที่เพิ่มเข้ามาภายหลัง */
export function initDates(root = document) {
  if (typeof document === 'undefined') return;
  ensureStyle(root);
  const scan = (node) => {
    if (!node || node.nodeType !== 1) return;
    if (node.matches && node.matches('input[type="date"]')) enhanceDate(node);
    if (node.querySelectorAll) node.querySelectorAll('input[type="date"]').forEach(enhanceDate);
  };
  scan(root === document ? document.documentElement : root);
  if (root.querySelectorAll) root.querySelectorAll('input[type="date"]').forEach(enhanceDate);
  if (ROOTS.has(root)) return;
  ROOTS.add(root);
  new MutationObserver((list) => { for (const m of list) m.addedNodes.forEach(scan); }).observe(root === document ? document.documentElement : root, { childList: true, subtree: true });
}
