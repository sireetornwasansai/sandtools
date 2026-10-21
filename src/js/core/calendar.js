// ปฏิทินเลือกวันที่ของ SAND — เขียนเองทั้งหมด ไม่พึ่งปฏิทินของเบราว์เซอร์/ไลบรารีภายนอก
//
// ทำไมต้องมี: เดิมกดไอคอนปฏิทินแล้วสั่ง <input type="date">.showPicker() ของช่องที่ซ่อนอยู่ (ขนาด 1px โปร่งใส) — เบราว์เซอร์ในแอป LINE / iOS Safari เก่า / WebView หลายตัว
//            ไม่เปิดให้ (หรือเปิดแล้วค่าไม่ถูกส่งกลับ) ผู้ใช้จึงรายงานว่า "กดปฏิทินไม่ได้"
// ปฏิทินนี้: วาดเองด้วย DOM ปกติ → ทำงานเหมือนกันทุกเครื่อง · ทำงานใน Shadow DOM ของหน้า HR · เดสก์ท็อป = ป๊อปอัปใต้ช่อง / มือถือ = แผ่นเลื่อนขึ้นจากด้านล่าง
//            ปีแสดงเป็น พ.ศ. · เลือกเดือน/ปีจากรายการได้ · ปุ่มลูกศรเลื่อนเดือน · วันนี้ · รองรับ min/max · ทำเครื่องหมายวันหยุดได้ · ใช้คีย์บอร์ดได้ (ลูกศร PgUp/PgDn Enter Esc)
//
// ใช้: openCalendar({ anchor, root, value: 'yyyy-mm-dd', min, max, marks: (iso) => 'ชื่อวันหยุด' | '', onPick: (iso) => {} })
//      → { close() }   (เปิดได้ทีละอัน — เปิดอันใหม่จะปิดอันเก่า)
export const MONTHS_TH = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const DOW_TH = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const BE = 543;
const pad = (n) => String(n).padStart(2, '0');

/** @param {string} s */
export function parseIso(s) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '')); return m ? { y: +m[1], m: +m[2] - 1, d: +m[3] } : null; }
export const toIso = (y, m, d) => { const t = new Date(Date.UTC(y, m, d)); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`; };
const addDays = (iso, n) => { const p = parseIso(iso); return p ? toIso(p.y, p.m, p.d + n) : iso; };
const daysIn = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/** วันนี้ตามเวลาไทย (yyyy-mm-dd) */
export function todayIso() {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); } catch { /* old engines */ }
  const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const CSS = `
.cal-back{position:fixed;inset:0;z-index:2147483000;background:transparent}
.cal-back.cal-sheet{background:rgba(15,23,42,.45)}
.cal-pop{position:fixed;z-index:2147483001;box-sizing:border-box;width:304px;max-width:calc(100vw - 16px);padding:10px;border-radius:14px;
  background:var(--surface,#fff);color:var(--text,#111827);border:1px solid var(--border,#d1d5db);box-shadow:0 12px 36px rgba(0,0,0,.25);
  font:14px/1.3 var(--font,'Noto Sans Thai','Sarabun',system-ui,sans-serif);-webkit-user-select:none;user-select:none;touch-action:manipulation}
.cal-pop.cal-sheet{left:0!important;right:0;bottom:0;top:auto!important;width:auto;max-width:none;border-radius:18px 18px 0 0;padding:12px 14px calc(14px + env(safe-area-inset-bottom,0px));animation:cal-up .18s ease-out}
@keyframes cal-up{from{transform:translateY(24px);opacity:.4}to{transform:none;opacity:1}}
@media (prefers-reduced-motion:reduce){.cal-pop.cal-sheet{animation:none}}
.cal-head{display:grid;grid-template-columns:40px 1fr 1fr 40px;gap:6px;align-items:center;margin-bottom:8px}
.cal-sheet .cal-head{grid-template-columns:48px 1fr 1fr 48px}
.cal-pop button{font:inherit;color:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}
.cal-nav{min-height:38px;border:1px solid var(--border,#d1d5db);border-radius:10px;background:var(--surface-2,#f3f4f6);font-size:18px;line-height:1;padding:0}
.cal-sheet .cal-nav{min-height:46px}
.cal-nav:disabled{opacity:.35;cursor:default}
.cal-head select{min-height:38px;width:100%;min-width:0;padding:0 6px;border:1px solid var(--border,#d1d5db);border-radius:10px;background:var(--surface,#fff);color:inherit;font:inherit;font-weight:600}
.cal-sheet .cal-head select{min-height:46px;font-size:16px}
.cal-dow,.cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px}
.cal-dow span{text-align:center;font-size:12px;font-weight:600;color:var(--muted,#6b7280);padding:4px 0}
.cal-dow span:first-child,.cal-dow span:last-child{color:var(--error,#dc2626)}
.cal-day{aspect-ratio:1/1;min-height:36px;border:0;border-radius:10px;background:transparent;padding:0;font-variant-numeric:tabular-nums}
.cal-sheet .cal-day{min-height:44px;font-size:16px}
.cal-day:hover:not(:disabled){background:var(--primary-soft,rgba(37,99,235,.12))}
.cal-day.cal-out{color:var(--muted,#9ca3af);opacity:.55}
.cal-day.cal-we{color:var(--error,#dc2626)}
.cal-day.cal-hol{color:var(--error,#dc2626);font-weight:700;background:var(--error-bg,rgba(220,38,38,.1))}
.cal-day.cal-today{box-shadow:inset 0 0 0 2px var(--primary,#2563eb)}
.cal-day.cal-sel,.cal-day.cal-sel:hover{background:var(--primary,#2563eb);color:var(--primary-contrast,#fff);font-weight:700}
.cal-day:disabled{opacity:.25;cursor:default}
.cal-day:focus-visible,.cal-nav:focus-visible,.cal-foot button:focus-visible,.cal-head select:focus-visible{outline:2px solid var(--focus,var(--primary,#2563eb));outline-offset:1px}
.cal-note{min-height:1.2em;margin:6px 2px 0;font-size:12px;color:var(--error,#dc2626)}
.cal-foot{display:flex;justify-content:space-between;gap:8px;margin-top:6px}
.cal-foot button{flex:1;min-height:40px;border:1px solid var(--border,#d1d5db);border-radius:10px;background:var(--surface-2,#f3f4f6);font-weight:600}
.cal-sheet .cal-foot button{min-height:46px}
.cal-foot .cal-today-btn{background:var(--primary-soft,rgba(37,99,235,.12));color:var(--primary,#2563eb);border-color:transparent}
`;

function ensureStyle(root) {
  const host = root === document ? document.head : root;
  if (host.querySelector && host.querySelector('style[data-calendar]')) return;
  const st = document.createElement('style'); st.setAttribute('data-calendar', ''); st.textContent = CSS; host.append(st);
}

/** @type {{close:()=>void}|null} */
let current = null;

/**
 * @param {{anchor?:HTMLElement, root?:Document|ShadowRoot, value?:string, min?:string, max?:string, marks?:(iso:string)=>string, onPick:(iso:string)=>void, onClose?:()=>void}} o
 */
export function openCalendar(o) {
  if (current) current.close();
  const root = o.root || document;
  ensureStyle(root);
  const mount = root === document ? document.body : root;
  const today = todayIso();
  const min = parseIso(o.min) ? o.min : ''; const max = parseIso(o.max) ? o.max : '';
  const sel = parseIso(o.value) ? o.value : '';
  const start = parseIso(sel || today) || parseIso(today);
  let vy = start.y; let vm = start.m;                     // month on screen
  let focusIso = sel || today;                            // day that owns the keyboard focus
  const sheet = window.innerWidth < 640 || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches && window.innerWidth < 820);
  const opened = Date.now();

  const back = document.createElement('div'); back.className = `cal-back${sheet ? ' cal-sheet' : ''}`;
  const pop = document.createElement('div'); pop.className = `cal-pop${sheet ? ' cal-sheet' : ''}`;
  pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-modal', 'true'); pop.setAttribute('aria-label', 'เลือกวันที่'); pop.tabIndex = -1;

  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const prev = mk('button', 'cal-nav', '‹'); prev.type = 'button'; prev.setAttribute('aria-label', 'เดือนก่อนหน้า');
  const next = mk('button', 'cal-nav', '›'); next.type = 'button'; next.setAttribute('aria-label', 'เดือนถัดไป');
  const monthSel = mk('select'); monthSel.setAttribute('aria-label', 'เดือน');
  MONTHS_TH.forEach((n, i) => { const op = mk('option', '', n); op.value = String(i); monthSel.append(op); });
  const yearSel = mk('select'); yearSel.setAttribute('aria-label', 'ปี (พ.ศ.)');
  const head = mk('div', 'cal-head'); head.append(prev, monthSel, yearSel, next);
  const dow = mk('div', 'cal-dow'); DOW_TH.forEach((n) => dow.append(mk('span', '', n)));
  const grid = mk('div', 'cal-grid'); grid.setAttribute('role', 'grid');
  const note = mk('div', 'cal-note'); note.setAttribute('role', 'status');
  const foot = mk('div', 'cal-foot');
  const todayBtn = mk('button', 'cal-today-btn', 'วันนี้'); todayBtn.type = 'button';
  const closeBtn = mk('button', '', 'ปิด'); closeBtn.type = 'button';
  foot.append(todayBtn, closeBtn);
  pop.append(head, dow, grid, note, foot);

  const out = (iso) => (min && iso < min) || (max && iso > max);

  function fillYears() {
    const from = Math.min(min ? parseIso(min).y : start.y - 6, vy); const to = Math.max(max ? parseIso(max).y : start.y + 6, vy);
    yearSel.replaceChildren();
    for (let y = from; y <= to; y += 1) { const op = mk('option', '', String(y + BE)); op.value = String(y); yearSel.append(op); }
  }

  function draw() {
    monthSel.value = String(vm); yearSel.value = String(vy);
    const firstDow = new Date(Date.UTC(vy, vm, 1)).getUTCDay();
    const first = toIso(vy, vm, 1 - firstDow);
    const prevOk = !min || toIso(vy, vm, 0) >= min; const nextOk = !max || toIso(vy, vm + 1, 1) <= max;
    prev.disabled = !prevOk; next.disabled = !nextOk;
    grid.replaceChildren();
    const inMonth = (iso) => { const p = parseIso(iso); return p.m === vm && p.y === vy; };
    if (!inMonth(focusIso) || out(focusIso)) { const f = toIso(vy, vm, Math.min(parseIso(focusIso).d, daysIn(vy, vm))); focusIso = out(f) ? (min && f < min ? min : max || f) : f; }
    for (let i = 0; i < 42; i += 1) {
      const iso = addDays(first, i); const p = parseIso(iso);
      const b = mk('button', 'cal-day', String(p.d)); b.type = 'button'; b.dataset.iso = iso;
      b.setAttribute('role', 'gridcell');
      if (p.m !== vm) b.classList.add('cal-out');
      const wd = new Date(Date.UTC(p.y, p.m, p.d)).getUTCDay(); if (wd === 0 || wd === 6) b.classList.add('cal-we');
      const hol = o.marks ? o.marks(iso) : '';
      if (hol) { b.classList.add('cal-hol'); b.title = hol; }
      if (iso === today) b.classList.add('cal-today');
      if (iso === sel) { b.classList.add('cal-sel'); b.setAttribute('aria-selected', 'true'); }
      if (out(iso)) b.disabled = true;
      b.setAttribute('aria-label', `${p.d} ${MONTHS_TH[p.m]} ${p.y + BE}${hol ? ` (${hol})` : ''}`);
      b.tabIndex = iso === focusIso ? 0 : -1;
      grid.append(b);
    }
    todayBtn.disabled = !!out(today);
  }

  function go(y, m) { const t = new Date(Date.UTC(y, m, 1)); vy = t.getUTCFullYear(); vm = t.getUTCMonth(); draw(); }
  function focusDay(iso) {
    focusIso = iso; const p = parseIso(iso);
    if (p.y !== vy || p.m !== vm) { vy = p.y; vm = p.m; if (!yearSel.querySelector(`option[value="${vy}"]`)) fillYears(); draw(); }
    else draw();
    const b = grid.querySelector(`[data-iso="${iso}"]`); if (b) b.focus();
  }
  function pick(iso) { if (!iso || out(iso)) return; const cb = o.onPick; close(); try { cb(iso); } catch (e) { console.warn('calendar onPick', e); } }

  function place() {
    if (sheet || !o.anchor) return;
    const r = o.anchor.getBoundingClientRect(); const w = pop.offsetWidth || 304; const h = pop.offsetHeight || 340;
    const vw = window.innerWidth; const vh = window.innerHeight;
    let left = Math.max(8, Math.min(r.left, vw - w - 8));
    let top = r.bottom + 6;
    if (top + h > vh - 8) top = r.top - h - 6 >= 8 ? r.top - h - 6 : Math.max(8, vh - h - 8);
    pop.style.left = `${Math.round(left)}px`; pop.style.top = `${Math.round(top)}px`;
  }

  function close() {
    if (current !== api) return;
    current = null;
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', place);
    window.removeEventListener('scroll', onScroll, true);
    back.remove(); pop.remove();
    if (o.onClose) { try { o.onClose(); } catch { /* ignore */ } }
  }
  const onScroll = (e) => { if (!sheet && !pop.contains(/** @type {Node} */ (e.target))) place(); };   // a floating popup follows its field (closing here made it vanish whenever a phone / modal scrolled on its own)
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    const t = /** @type {HTMLElement} */ (e.target);
    if (!t || !t.classList || !t.classList.contains('cal-day')) return;
    const iso = t.dataset.iso; let n = null;
    if (e.key === 'ArrowLeft') n = addDays(iso, -1); else if (e.key === 'ArrowRight') n = addDays(iso, 1);
    else if (e.key === 'ArrowUp') n = addDays(iso, -7); else if (e.key === 'ArrowDown') n = addDays(iso, 7);
    else if (e.key === 'PageUp') { const p = parseIso(iso); n = toIso(p.y, p.m - 1, Math.min(p.d, daysIn(p.y, p.m - 1 < 0 ? 11 : p.m - 1))); }
    else if (e.key === 'PageDown') { const p = parseIso(iso); n = toIso(p.y, p.m + 1, Math.min(p.d, daysIn(p.y, (p.m + 1) % 12))); }
    else if (e.key === 'Home') n = addDays(iso, -new Date(Date.UTC(...Object.values(parseIso(iso)))).getUTCDay());
    else if (e.key === 'End') n = addDays(iso, 6 - new Date(Date.UTC(...Object.values(parseIso(iso)))).getUTCDay());
    if (n) { e.preventDefault(); if (!out(n)) focusDay(n); }
  };

  grid.addEventListener('click', (e) => {
    const b = /** @type {HTMLElement} */ (e.target).closest ? /** @type {HTMLElement} */ (e.target).closest('.cal-day') : null;
    if (b && !b.disabled) pick(b.dataset.iso);
  });
  prev.addEventListener('click', () => go(vy, vm - 1));
  next.addEventListener('click', () => go(vy, vm + 1));
  monthSel.addEventListener('change', () => go(vy, Number(monthSel.value)));
  yearSel.addEventListener('change', () => go(Number(yearSel.value), vm));
  todayBtn.addEventListener('click', () => pick(today));
  closeBtn.addEventListener('click', () => close());
  back.addEventListener('click', () => { if (Date.now() - opened > 250) close(); });   // ignore the tail of the tap that opened it
  back.addEventListener('contextmenu', (e) => e.preventDefault());

  fillYears(); draw();
  mount.append(back, pop);
  if (!sheet) { pop.style.visibility = 'hidden'; place(); pop.style.visibility = ''; }
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', place);
  window.addEventListener('scroll', onScroll, true);
  const api = { close }; current = api;
  const f = grid.querySelector(`[data-iso="${focusIso}"]`); if (f) f.focus({ preventScroll: true });
  return api;
}

/** ปิดปฏิทินที่เปิดอยู่ (ถ้ามี) */
export function closeCalendar() { if (current) current.close(); }
