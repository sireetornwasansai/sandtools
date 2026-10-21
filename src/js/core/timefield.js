// ช่องเวลา 24 ชั่วโมง (ชั่วโมง : นาที) — ใช้ทั้งเว็บ ไม่มี AM/PM
//
// ทำไมไม่ใช้ <input type="time">: ช่องเวลาของเบราว์เซอร์แสดงตาม "ภาษา/ภูมิภาคของเครื่อง" (หลายเครื่องเป็น AM/PM) และหน้าเว็บบังคับรูปแบบไม่ได้
//   flatpickr บนมือถือก็สลับไปใช้ช่องเวลาของเครื่องเอง (disableMobile ต้องปิดเอง) จึงกลับมาเป็น AM/PM อีก
// วิธีนี้: <select> ชั่วโมง 00–23 + <select> นาที (ทีละ 5) → ล้อเลือกของมือถือที่คุ้นมือ เป็น 24 ชม. เสมอ พิมพ์ผิดไม่ได้ ใช้ได้ในทุกเบราว์เซอร์/Shadow DOM
//
//   time24Field({ value, label, step, onChange }) → { el, value (get/set), clear() }      สำหรับหน้าที่สร้างฟอร์มด้วยโค้ด (leave.js)
//   upgradeTimeInput(input, { label, step })                                              เปลี่ยน <input> เดิมให้เป็นช่องนี้ โดย .value ยังเป็น "HH:MM" (hr-legacy.js)
const pad = (n) => String(n).padStart(2, '0');

/** "8:5" ✗ · "08:30" ✓ · "8.30" ✓ · "0830" ✓ · "24:00" ✗ → "HH:MM" หรือ "" */
export function normTime(v) {
  const t = String(v == null ? '' : v).trim();
  const m = /^(\d{1,2})\s*[:.]\s*(\d{2})(?:[:.]\d{2})?$/.exec(t) || /^(\d{2})(\d{2})$/.exec(t);
  if (!m) return '';
  const h = Number(m[1]); const mi = Number(m[2]);
  return h < 24 && mi < 60 ? `${pad(h)}:${pad(mi)}` : '';
}
export const toMinutes = (v) => { const t = normTime(v); return t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) : -1; };

const CSS = `.tf24{display:flex;align-items:center;gap:6px;min-width:0}
.tf24 select{flex:1 1 0;min-width:0;text-align:center;text-align-last:center;font-variant-numeric:tabular-nums}
.tf24 b{font-weight:700;opacity:.7}
.tf24.tf24-bad select{border-color:var(--error,#dc2626)}`;
function ensureStyle(node) {
  const root = node && node.getRootNode ? node.getRootNode() : document;
  const host = root instanceof ShadowRoot ? root : document.head;
  if (host.querySelector && host.querySelector('style[data-tf24]')) return;
  const st = document.createElement('style'); st.setAttribute('data-tf24', ''); st.textContent = CSS; host.append(st);
}

/**
 * @param {{value?:string,label?:string,step?:number,onChange?:(v:string)=>void,selectClass?:string}} [o]
 * @returns {{el:HTMLElement,value:string,clear:()=>void,setValue:(v:string)=>void}}
 */
export function time24Field(o = {}) {
  const step = Math.max(1, Math.min(30, Number(o.step) || 5));
  const label = o.label || 'เวลา';
  const cls = o.selectClass || '';
  const wrap = document.createElement('span'); wrap.className = 'tf24'; wrap.setAttribute('role', 'group'); wrap.setAttribute('aria-label', label);
  const hh = document.createElement('select'); const mm = document.createElement('select');
  hh.className = cls; mm.className = cls;
  hh.setAttribute('aria-label', `${label} ชั่วโมง`); mm.setAttribute('aria-label', `${label} นาที`);
  const opt = (v, t) => { const e = document.createElement('option'); e.value = v; e.textContent = t; return e; };
  hh.append(opt('', 'ชม.')); for (let i = 0; i < 24; i += 1) hh.append(opt(pad(i), pad(i)));
  const baseMins = []; for (let i = 0; i < 60; i += step) baseMins.push(pad(i));
  const colon = document.createElement('b'); colon.textContent = ':'; colon.setAttribute('aria-hidden', 'true');
  wrap.append(hh, colon, mm);

  const fillMinutes = (extra) => {
    const list = baseMins.slice(); if (extra && !list.includes(extra)) { list.push(extra); list.sort(); }
    const keep = mm.value; mm.replaceChildren(opt('', 'นาที'), ...list.map((x) => opt(x, x))); mm.value = list.includes(keep) ? keep : '';
  };
  fillMinutes('');

  const api = {
    el: wrap,
    get value() { return hh.value ? `${hh.value}:${mm.value || '00'}` : ''; },
    set value(v) { api.setValue(v); },
    setValue(v) {
      const t = normTime(v);
      if (!t) { hh.value = ''; mm.value = ''; return; }
      fillMinutes(t.slice(3)); hh.value = t.slice(0, 2); mm.value = t.slice(3);
    },
    clear() { hh.value = ''; mm.value = ''; }
  };
  const changed = () => {
    if (!hh.value) mm.value = ''; else if (!mm.value) mm.value = '00';   // choosing an hour is enough: minutes default to :00
    if (o.onChange) o.onChange(api.value);
  };
  hh.addEventListener('change', changed); mm.addEventListener('change', changed);
  api.setValue(o.value || '');
  queueMicrotask(() => ensureStyle(wrap));                                // after it is in the DOM (document or shadow root)
  setTimeout(() => ensureStyle(wrap), 0);
  return api;
}

/**
 * Turn an existing text <input> into the 24-hour field. The input stays in the page (hidden) and keeps the value "HH:MM" / "",
 * so old code that reads `input.value` keeps working; `input._flatpickr` gets a tiny setDate()/clear() shim for the same reason.
 * @param {HTMLInputElement} input @param {{label?:string,step?:number}} [o]
 */
export function upgradeTimeInput(input, o = {}) {
  if (!input || input.dataset.tf24) return null;
  input.dataset.tf24 = '1';
  const nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  const nativeGet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').get;
  const fld = time24Field({
    value: nativeGet.call(input), label: o.label || input.getAttribute('aria-label') || 'เวลา', step: o.step, selectClass: 'form-input',
    onChange: (v) => { nativeSet.call(input, v); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  input.hidden = true; input.style.display = 'none'; input.tabIndex = -1;
  input.after(fld.el);
  Object.defineProperty(input, 'value', {
    configurable: true,
    get() { return nativeGet.call(input); },
    set(v) { const t = normTime(v); nativeSet.call(input, t); fld.setValue(t); }
  });
  input._flatpickr = { setDate(v) { input.value = v; }, clear() { input.value = ''; }, destroy() { /* nothing to free */ } };
  input._tf24 = fld;
  return fld;
}
