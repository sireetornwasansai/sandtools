// "Which OCR model reads my scans?" — a small selector shared by Settings and the สารบรรณ drop-zone (see converters/ocr-cloud.js).
// The choice is kept in this browser only. The cloud options are shown but disabled until the server has a Typhoon key and the person is signed in.
import { h } from '../core/dom.js';
import { getSession } from '../core/auth.js';
import { ENGINES, ENGINE_LABELS, CLOUD_NOTE, getOcrEngine, setOcrEngine, cloudConfigured } from './converters/ocr-cloud.js';

const LOCAL_NOTE = 'ภาพหน้าเอกสารอยู่ในเครื่องของคุณ ไม่ถูกส่งออกอินเทอร์เน็ต (อ่านช้ากว่าและแม่นยำน้อยกว่าสำหรับตัวหนังสือเล็กหรือภาพถ่าย)';

/** @param {{compact?:boolean}} [o] @returns {HTMLElement} */
export function ocrEnginePicker(o = {}) {
  const sel = h('select', { 'aria-label': 'โมเดล OCR', onchange: () => { setOcrEngine(sel.value); paint(); } },
    ENGINES.map((v) => h('option', { value: v, selected: v === getOcrEngine() }, ENGINE_LABELS[v])));
  const note = h('p', { class: 'muted', style: 'margin:.35rem 0 0;font-size:.85em' });
  const warn = h('p', { class: 'muted', style: 'margin:.35rem 0 0;font-size:.85em', hidden: true });
  const root = h('div', { class: 'ocr-picker' }, o.compact ? null : h('label', { for: 'ocr-engine-sel' }, 'โมเดลที่ใช้อ่านข้อความจากภาพสแกน'), sel, note, warn);
  sel.id = 'ocr-engine-sel';
  function paint() { note.textContent = sel.value === 'local' ? LOCAL_NOTE : CLOUD_NOTE; }
  paint();
  const signedIn = Boolean(getSession());
  cloudConfigured().then((ok) => {
    if (ok && signedIn) return;
    [...sel.options].forEach((op) => { if (op.value !== 'local') op.disabled = true; });
    warn.hidden = false;
    warn.textContent = !signedIn ? 'ตัวเลือก Typhoon ใช้ได้เมื่อเข้าสู่ระบบแล้วเท่านั้น' : 'ตัวเลือก Typhoon ยังใช้ไม่ได้ — ผู้ดูแลต้องตั้งค่า TYPHOON_API_KEY บน Vercel';
    if (sel.value !== 'local' && getOcrEngine() !== 'local') { /* keep the saved choice, but readers report why cloud is off */ }
  });
  return root;
}
