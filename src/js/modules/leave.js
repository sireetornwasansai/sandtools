import { h } from '../core/dom.js';
import { getSession } from '../core/auth.js';
import { sessionCall, cacheGet, cacheSet } from '../core/ops.js';
import { warmBackend } from '../core/api.js';
import { notice } from '../core/notices.js';
import { toast } from '../core/toast.js';
import { confirmBox } from '../core/layers.js';
import { loadCss } from '../core/css.js';
import { time24Field, toMinutes } from '../core/timefield.js';

/**
 * ลงลา / ไปราชการ / อบรม / ประชุม จากมือถือ — one screen, no calendar library: pick name → pick type → pick day → save.
 * Same backend and same sheet as the HR page (gas/Hr.gs ops saveData / updateRecord / deleteRecord); gas/HrLine.gs adds mobileBoot (one small answer for this page).
 * Deep links (for the LINE rich menu):  #/leave  ·  #/leave?tab=who  ·  #/leave?tab=who&week=next  ·  #/leave?tab=who&date=2026-11-05  ·  #/leave?tab=mine
 *
 * Speed: the stylesheet and the data request start together; the last answer is painted from the device at once; "บันทึก" shows the result as soon as the
 * server accepts the record (the refresh runs behind it); a leave on a public holiday is stopped on the phone before any request is made.
 */

const DOW = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
const GROUPS = [['leave', '🌴 ลา'], ['trip', '🚗 ไปราชการ'], ['train', '🎓 อบรม'], ['meet', '👥 ประชุม'], ['other', '📌 อื่นๆ']];
const LEAVE_BASE = ['ลากิจ', 'ลาป่วย', 'ลาพักผ่อน'];            // these three have a half-day variant
const MAIN_TYPES = [['ลากิจ', '🧳'], ['ลาป่วย', '🤒'], ['ลาพักผ่อน', '🌴'], ['ลาไปเรียน', '📚'], ['ไปราชการ', '🚗'], ['อบรม', '🎓'], ['ประชุม', '👥']];
const CACHE_KEY = 'hr:mboot';
const NAME_KEY = 'sand:leave:name';
// quick times for trips / training / meetings — same defaults as the HR page
const TIME_PRESETS = [['ทั้งวัน 08:00–16:00', '08:00', '16:00'], ['เช้า 08:00–12:00', '08:00', '12:00'], ['บ่าย 13:00–16:00', '13:00', '16:00']];
const TYPE_KEY = 'sand:leave:type';
const DEFAULT_TYPE = 'ลากิจ';

const pad = (n) => String(n).padStart(2, '0');
const parse = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null; };
const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const addDays = (s, n) => { const d = parse(s); if (!d) return s; d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const dow = (s) => { const d = parse(s); return d ? d.getUTCDay() : 0; };
const dm = (s) => { const d = parse(s); return d ? `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}/${d.getUTCFullYear() + 543}` : ''; };   // วว/ดด/ปปปป (พ.ศ.)
const pad2 = (n) => String(n).padStart(2, '0');
const dowDm = (s) => `${DOW[dow(s)]} ${dm(s)}`;
const range = (a, b) => (!b || a === b ? dm(a) : `${dm(a)} – ${dm(b)}`);
const short = (d) => String(d || '').replace(/^กลุ่มงาน/, '');
const baseOf = (t) => String(t || '').replace('ครึ่งวัน', '').trim();
const isLeaveType = (t) => /^ลา/.test(t);
const errText = (e) => (e && e.message) || 'ทำรายการไม่สำเร็จ';
const clock = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const spanDays = (a, b) => Math.max(0, Math.round((parse(b).getTime() - parse(a).getTime()) / 86400000));
const nextMonday = (today) => addDays(today, dow(today) === 0 ? 1 : 8 - dow(today));
const isWeekend = (s) => dow(s) === 0 || dow(s) === 6;

function remembered() { try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; } }
function remember(name) { try { if (name) localStorage.setItem(NAME_KEY, name); } catch { /* private mode */ } }
function rememberedType() { try { const t = localStorage.getItem(TYPE_KEY) || ''; return MAIN_TYPES.some((m) => m[0] === t) ? t : DEFAULT_TYPE; } catch { return DEFAULT_TYPE; } }
function rememberType(t) { try { const b = baseOf(t); if (MAIN_TYPES.some((m) => m[0] === b)) localStorage.setItem(TYPE_KEY, b); } catch { /* private mode */ } }
function buzz(ms = 30) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch { /* not supported */ } }
const reduceMotion = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

export async function mount(root, ctx) {
  const cssP = loadCss('leave');                                    // 1) stylesheet, data and the screen are prepared in parallel
  const params = (ctx && ctx.params) || new URLSearchParams();
  const page = h('div', { class: 'page lv' });
  root.append(page);
  if (!getSession()) { await cssP; page.append(notice('warn', 'ต้องเข้าสู่ระบบก่อน', 'ใช้อีเมลหน่วยงานเพื่อลงลาและดูตารางการลา')); return undefined; }

  const call = (op, args = []) => sessionCall('hr', op, { args }, op === 'saveData' || op === 'updateRecord' ? 90000 : 45000);
  warmBackend();
  const cached = cacheGet(CACHE_KEY, 3 * 86400000);
  const firstP = call('mobileBoot'); firstP.catch(() => {});        // started now, awaited later (no sequential round trips)

  let boot = null;
  const urlDate = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') || '') && parse(params.get('date')) ? /** @type {string} */ (params.get('date')) : '';
  let tab = urlDate ? 'who' : ['add', 'who', 'mine'].includes(params.get('tab') || '') ? /** @type {string} */ (params.get('tab')) : 'add';
  let week = urlDate ? 'day' : params.get('week') === 'next' ? 'nextWeek' : 'thisWeek';     // 'thisWeek' | 'nextWeek' | 'day' (one chosen day)
  let pickDay = urlDate;                                                                       // '' = today (set once boot is known)
  const dayCache = new Map(); const dayFlight = new Map(); let dayTok = 0;       // answers per day (1 min) · requests in flight (a re-render must not ask twice)
  let dayFilter = ''; let deptFilter = '';
  let editId = '';
  let saving = false;
  let showingDone = false;   // the "บันทึกแล้ว" card is on screen: a late background refresh must not replace it
  let syncing = true; let syncedAt = '';
  const f = { name: remembered(), type: rememberedType(), half: '', start: '', end: '', multi: false, st: '', et: '', province: '', mission: '', note: '' };

  const syncEl = h('p', { class: 'lv-sync muted', role: 'status', 'aria-live': 'polite' });
  const head = h('header', { class: 'lv-head' }, h('div', null, h('h1', null, 'ลงลา / ไปราชการ'), h('p', { class: 'muted' }, 'บันทึกจากมือถือ เชื่อมกับระบบบันทึกการปฏิบัติงานทันที')), syncEl);
  const tabs = h('div', { class: 'lv-tabs', role: 'tablist', 'aria-label': 'เมนูลงลา' });
  const body = h('div', { class: 'lv-body' });
  page.append(head, tabs, body);

  function drawSync() {
    syncEl.replaceChildren(h('span', { class: `lv-dot${syncing ? ' is-busy' : ''}`, 'aria-hidden': 'true' }),
      syncing ? (boot ? 'ข้อมูลจากเครื่อง · กำลังอัปเดต…' : 'กำลังเชื่อมต่อ…') : `อัปเดตแล้ว ${syncedAt}`,
      h('button', { class: 'lv-link', type: 'button', disabled: syncing, onclick: () => manualRefresh() }, 'รีเฟรช'));
  }
  function syncUrl() {                                              // the address bar follows the tab, so reload / share / "add to home" keep the view
    try { const q = new URLSearchParams(); if (tab !== 'add') q.set('tab', tab); if (tab === 'who' && week === 'nextWeek') q.set('week', 'next'); if (tab === 'who' && week === 'day' && pickDay) q.set('date', pickDay); history.replaceState(null, '', `#/leave${q.toString() ? `?${q}` : ''}`); } catch { /* ignore */ }
  }
  function drawTabs() {
    const mineN = boot ? boot.mine.length : 0;
    tabs.replaceChildren(...[['add', editId ? 'แก้ไขรายการ' : 'ลงลา'], ['who', 'ใครลา'], ['mine', `ของฉัน${mineN ? ` (${mineN})` : ''}`]].map(([k, label]) =>
      h('button', { class: 'lv-tab', type: 'button', role: 'tab', 'aria-selected': String(tab === k), onclick: () => { if (tab === k) return; tab = k; render(); syncUrl(); } }, label)));
  }
  function render() { showingDone = false; drawTabs(); drawSync(); if (!boot) return; body.replaceChildren(tab === 'add' ? addView() : tab === 'who' ? whoView() : mineView()); }
  /** After a background refresh: never throw away what the person is typing, and never replace the "บันทึกแล้ว" card. */
  function softRender() {
    drawTabs(); drawSync();
    if (saving || showingDone || !boot) return;
    if (tab === 'add' && body.contains(document.activeElement) && document.activeElement !== document.body) return;
    render();
  }

  /* ------------------------------ add / edit ------------------------------ */
  function effectiveType() { return f.half && LEAVE_BASE.includes(f.type) ? `${f.type}ครึ่งวัน` : f.type; }
  function deptOf(name) { const s = boot.staff.find((x) => x.name === name); const d = s && s.department; return boot.config.departments.includes(d) ? d : (boot.config.realDepartments[0] || boot.config.departments[0]); }
  /** What is wrong (or worth knowing) about the chosen day → { bad, text }. Used by the hint line and by the save button, so a holiday is caught before any request. */
  function dayCheck() {
    const day = f.start; const t = effectiveType();
    if (!day) return { bad: false, text: '' };
    const hol = boot.holidays[day];
    if (hol && isLeaveType(t)) return { bad: true, text: `❌ ${dowDm(day)} เป็นวันหยุดราชการ (${hol}) บันทึกการลาไม่ได้` };
    if (hol) return { bad: false, text: `🎌 ${dowDm(day)} เป็นวันหยุดราชการ (${hol})` };
    if (isWeekend(day)) return { bad: false, text: `ℹ️ ${dowDm(day)} เป็นวันหยุดสุดสัปดาห์ — ปฏิทินจะแสดงให้เมื่อเปิดวันเสาร์-อาทิตย์` };
    return { bad: false, text: `${dowDm(day)}${f.multi && f.end > day ? ` ถึง ${dowDm(f.end)}` : ''}` };
  }
  function hint(el) { const c = dayCheck(); el.className = `lv-hint${c.bad ? ' lv-bad' : ''}`; el.textContent = c.text; }

  function addView() {
    if (!f.start) f.start = boot.today;
    const wrap = h('div', { class: 'lv-form' });
    if (editId) wrap.append(h('div', { class: 'lv-editbar' }, h('span', null, '✏️ กำลังแก้ไขรายการที่บันทึกไว้'), h('button', { class: 'btn', type: 'button', onclick: () => { resetForm(); render(); } }, 'ยกเลิกการแก้ไข')));

    const sel = h('select', { id: 'lv-name', 'aria-label': 'ชื่อผู้ลา', onchange: () => { f.name = sel.value; remember(f.name); sel.classList.remove('lv-invalid'); } },
      h('option', { value: '' }, '— เลือกชื่อ —'), ...boot.staff.map((s) => h('option', { value: s.name, selected: s.name === f.name }, `${s.name}${short(s.department) ? ` · ${short(s.department)}` : ''}`)));
    wrap.append(h('div', { class: 'lv-field' }, h('label', { for: 'lv-name' }, 'ชื่อ'), sel));

    // type
    const typeBox = h('div', { class: 'lv-typebox', role: 'group', 'aria-label': 'ประเภท' });
    const others = boot.config.leaveTypes.filter((t) => !MAIN_TYPES.some((m) => m[0] === t) && !t.includes('ครึ่งวัน'));
    const more = h('select', { 'aria-label': 'ประเภทอื่น ๆ', onchange: () => { if (more.value) { f.type = more.value; f.half = ''; render(); } } },
      h('option', { value: '' }, 'ประเภทอื่น ๆ…'), ...others.map((t) => h('option', { value: t, selected: f.type === t }, t)));
    const typeBtn = ([t, ico]) => h('button', { class: 'lv-type', type: 'button', 'aria-pressed': String(f.type === t),
      onclick: () => { f.type = t; if (!LEAVE_BASE.includes(t)) f.half = ''; render(); } }, h('span', { class: 'lv-ico', 'aria-hidden': 'true' }, ico), t);
    typeBox.replaceChildren(h('div', { class: 'lv-types lv-types-4' }, ...MAIN_TYPES.filter(([t]) => isLeaveType(t)).map(typeBtn)),          // 4 kinds of leave
      h('div', { class: 'lv-types lv-types-3' }, ...MAIN_TYPES.filter(([t]) => !isLeaveType(t)).map(typeBtn)));                            // 3 kinds of duty
    wrap.append(h('div', { class: 'lv-field' }, h('label', null, 'ประเภท'), typeBox, others.length ? h('div', { class: 'lv-more' }, more) : null));

    // half day
    if (LEAVE_BASE.includes(f.type)) {
      const seg = h('div', { class: 'lv-seg', role: 'group', 'aria-label': 'ช่วงเวลา' }, ...[['', 'เต็มวัน'], ['เช้า', 'ครึ่งวันเช้า'], ['บ่าย', 'ครึ่งวันบ่าย']].map(([k, label]) =>
        h('button', { type: 'button', 'aria-pressed': String(f.half === k), onclick: () => { f.half = k; if (k) { f.multi = false; f.end = ''; } render(); } }, label)));
      wrap.append(h('div', { class: 'lv-field' }, h('label', null, 'ช่วงเวลา'), seg));
    }

    // date
    const hintEl = h('p', { class: 'lv-hint', role: 'status' });
    let end = null;
    const chips = [];
    const syncChips = () => chips.forEach(([b, d]) => b.setAttribute('aria-pressed', String(f.start === d)));
    const start = h('input', { type: 'date', id: 'lv-start', value: f.start, required: true, onchange: () => { if (!start.value) return; f.start = start.value; if (f.end && f.end < f.start) f.end = f.start; hint(hintEl); syncChips(); if (end) { end.min = f.start; if (end.value < f.start) end.value = f.start; } } });
    end = h('input', { type: 'date', id: 'lv-end', value: f.end || f.start, min: f.start, onchange: () => { f.end = end.value; hint(hintEl); } });
    start._dfMark = (d) => boot.holidays[d] || ''; end._dfMark = start._dfMark;   // the calendar paints official holidays red
    const quick = h('div', { class: 'lv-quick' }, ...[['วันนี้', boot.today], ['พรุ่งนี้', addDays(boot.today, 1)], ['มะรืนนี้', addDays(boot.today, 2)], ['จันทร์หน้า', nextMonday(boot.today)]].map(([label, d]) => {
      const b = h('button', { class: 'chip', type: 'button', 'aria-pressed': String(f.start === d), onclick: () => { f.start = d; if (f.end && f.end < d) f.end = d; start.value = d; end.min = d; if (end.value < d) end.value = d; hint(hintEl); syncChips(); } }, label);
      chips.push([b, d]); return b;
    }));
    const multi = h('input', { type: 'checkbox', id: 'lv-multi', checked: f.multi, disabled: !!f.half, onchange: () => { f.multi = multi.checked; if (!f.multi) f.end = ''; render(); } });
    wrap.append(h('div', { class: 'lv-field' }, h('label', { for: 'lv-start' }, f.multi ? 'ตั้งแต่วันที่' : 'วันที่'), quick, start,
      h('label', { class: 'lv-check', for: 'lv-multi' }, multi, 'หลายวัน')),
    ...(f.multi ? [h('div', { class: 'lv-field' }, h('label', { for: 'lv-end' }, 'ถึงวันที่'), end)] : []), hintEl);
    hint(hintEl);

    // trip / training / meeting details
    if (!isLeaveType(f.type)) {
      // 24-hour time (HH : MM) from two <select>s — a native <input type="time"> shows AM/PM on many phones and a page cannot override that
      const timeHint = h('p', { class: 'lv-hint', role: 'status' });
      const sameDay = () => !f.multi || !f.end || f.end === f.start;
      const checkTimes = () => {
        timeHint.className = 'lv-hint'; timeHint.textContent = '';
        if (!f.st && !f.et) return;
        if (!f.st || !f.et) { timeHint.textContent = 'เลือกให้ครบทั้งเวลาเริ่มและเวลาสิ้นสุด'; return; }
        if (sameDay() && toMinutes(f.et) <= toMinutes(f.st)) { timeHint.className = 'lv-hint lv-bad'; timeHint.textContent = '⚠️ เวลาสิ้นสุดต้องหลังเวลาเริ่ม'; return; }
        const mins = toMinutes(f.et) - toMinutes(f.st);
        if (sameDay()) timeHint.textContent = `รวม ${Math.floor(mins / 60)} ชม.${mins % 60 ? ` ${mins % 60} นาที` : ''}`;
      };
      const stF = time24Field({ value: f.st, label: 'เวลาเริ่ม', onChange: (v) => { f.st = v; checkTimes(); } });
      const etF = time24Field({ value: f.et, label: 'เวลาสิ้นสุด', onChange: (v) => { f.et = v; checkTimes(); } });
      const presets = h('div', { class: 'lv-quick' }, ...TIME_PRESETS.map(([label, a, b]) =>
        h('button', { class: 'chip', type: 'button', onclick: () => { f.st = a; f.et = b; stF.setValue(a); etF.setValue(b); checkTimes(); } }, label)),
        h('button', { class: 'chip', type: 'button', onclick: () => { f.st = ''; f.et = ''; stF.clear(); etF.clear(); checkTimes(); } }, 'ล้างเวลา'));
      wrap.append(h('div', { class: 'lv-field' }, h('label', null, 'เวลา (ถ้ามี) · 24 ชั่วโมง'), presets,
        h('div', { class: 'lv-times' }, stF.el, h('span', null, 'ถึง'), etF.el), timeHint));
      checkTimes();
      if (f.type === 'ไปราชการ') {
        const pv = h('input', { type: 'text', maxlength: 80, value: f.province, placeholder: 'เช่น เชียงใหม่', autocomplete: 'off', enterkeyhint: 'next', oninput: () => { f.province = pv.value; } });
        wrap.append(h('div', { class: 'lv-field' }, h('label', null, 'สถานที่ / จังหวัด'), pv));
      }
      const ms = h('input', { type: 'text', maxlength: 200, value: f.mission, placeholder: f.type === 'ไปราชการ' ? 'ภารกิจ เช่น ประชุมเขตสุขภาพ' : 'เรื่อง / หัวข้อ', autocomplete: 'off', enterkeyhint: 'next', oninput: () => { f.mission = ms.value; } });
      wrap.append(h('div', { class: 'lv-field' }, h('label', null, f.type === 'ไปราชการ' ? 'ภารกิจ' : 'เรื่อง'), ms));
    }

    const note = h('textarea', { rows: 2, maxlength: 480, placeholder: 'หมายเหตุ (ถ้ามี)', oninput: () => { f.note = note.value; } }, f.note);
    wrap.append(h('div', { class: 'lv-field' }, h('label', null, 'หมายเหตุ'), note));
    const msg = h('div', { class: 'lv-msg', role: 'alert' });
    const go = h('button', { class: 'btn btn-primary lv-save', type: 'button', onclick: () => submit(go, msg, note, sel) }, editId ? 'บันทึกการแก้ไข' : 'บันทึก');
    wrap.append(msg, h('div', { class: 'lv-savebar' }, go));
    return wrap;
  }

  function payload() {
    const half = LEAVE_BASE.includes(f.type) ? f.half : '';
    const note = `${half ? `(${half}) ` : ''}${f.note}`.trim();
    const open = !isLeaveType(f.type);
    return { id: editId || undefined, name: f.name, department: deptOf(f.name), type: effectiveType(), startDate: f.start, endDate: f.multi && f.end ? f.end : f.start,
      startTime: open ? f.st : '', endTime: open ? f.et : '', note, province: f.type === 'ไปราชการ' ? f.province : '', mission: open ? f.mission : '' };
  }
  function resetForm(keepDay = false) {
    editId = ''; f.type = rememberedType(); f.half = ''; f.multi = false; f.end = ''; f.st = ''; f.et = ''; f.province = ''; f.mission = ''; f.note = ''; if (!keepDay) f.start = '';
  }
  function fail(msg, text, focusEl) {
    msg.className = 'lv-msg lv-bad'; msg.textContent = text; buzz(80);
    if (focusEl) { focusEl.classList.add('lv-invalid'); try { focusEl.focus({ preventScroll: true }); } catch { /* ignore */ } }
    try { msg.scrollIntoView({ block: 'center', behavior: reduceMotion() ? 'auto' : 'smooth' }); } catch { /* ignore */ }
  }

  async function submit(btn, msg, noteEl, nameEl) {
    if (saving) return;
    msg.className = 'lv-msg'; msg.textContent = '';
    if (!f.name) { fail(msg, 'เลือกชื่อก่อนบันทึก', nameEl); return; }
    if (!f.start) { fail(msg, 'เลือกวันที่ก่อนบันทึก'); return; }
    if (f.multi && f.end && f.end < f.start) { fail(msg, 'วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่ม'); return; }
    const chk = dayCheck(); if (chk.bad) { fail(msg, chk.text); return; }   // holiday: no request needed
    if (!isLeaveType(f.type)) {
      if (!!f.st !== !!f.et) { fail(msg, 'เลือกเวลาให้ครบทั้งเวลาเริ่มและเวลาสิ้นสุด (หรือกด "ล้างเวลา")'); return; }
      if (f.st && f.et && (!f.multi || !f.end || f.end === f.start) && toMinutes(f.et) <= toMinutes(f.st)) { fail(msg, 'เวลาสิ้นสุดต้องหลังเวลาเริ่ม'); return; }
    }
    saving = true; btn.disabled = true; btn.textContent = 'กำลังบันทึก…'; btn.classList.add('is-loading');
    try {
      const r = await call(editId ? 'updateRecord' : 'saveData', [payload()]);
      if (!r || r.status !== 'success') {
        fail(msg, (r && r.message) || 'บันทึกไม่สำเร็จ');
        if (r && r.overQuota) noteEl.focus();
        return;
      }
      buzz(); remember(f.name); rememberType(f.type);
      const extra = [r.workdayWarning, r.overlap ? r.overlapDetail && `⚠️ เวลาทับซ้อนกับ ${r.overlapDetail}` : '', r.weekend ? 'ℹ️ รายการอยู่ในวันเสาร์-อาทิตย์' : ''].filter(Boolean);
      const sum = payload(); const wasEdit = !!editId;
      resetForm(); tab = 'add'; syncUrl(); drawTabs(); showingDone = true;
      body.replaceChildren(doneView(sum, wasEdit, extra));
      window.scrollTo(0, 0);
      refresh().then(softRender, () => { /* the saved record is safe; the list updates next time */ });   // result first, refresh behind it
    } catch (e) { fail(msg, errText(e)); } finally { saving = false; btn.disabled = false; btn.classList.remove('is-loading'); btn.textContent = editId ? 'บันทึกการแก้ไข' : 'บันทึก'; }
  }

  function doneView(sum, wasEdit, extra) {
    return h('div', { class: 'lv-done' }, h('div', { class: 'lv-tick', 'aria-hidden': 'true' }, '✓'), h('h2', null, wasEdit ? 'แก้ไขแล้ว' : 'บันทึกแล้ว'),
      h('p', null, h('b', null, sum.name), ` · ${sum.type}`, h('br'), range(sum.startDate, sum.endDate), sum.startTime && sum.endTime ? ` · ${sum.startTime}–${sum.endTime}` : ''),
      ...extra.map((x) => h('p', { class: 'lv-warn' }, x)),
      h('div', { class: 'lv-doneact' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { tab = 'add'; render(); syncUrl(); } }, 'ลงอีกรายการ'),
        h('button', { class: 'btn', type: 'button', onclick: () => { tab = 'who'; render(); syncUrl(); } }, 'ดูใครลา')));
  }

  /* ------------------------------ who is away ------------------------------ */
  /** Items of one week that touch `day` (a leave on a weekend / holiday does not count there). */
  const touches = (x, day, holidays) => x.start <= day && x.end >= day && (x.group !== 'leave' || (!isWeekend(day) && !holidays[day]));
  const weekSeg = () => h('div', { class: 'lv-seg lv-seg-lg lv-seg-3', role: 'group', 'aria-label': 'ช่วงเวลา' },
    ...[['thisWeek', 'สัปดาห์นี้'], ['nextWeek', 'สัปดาห์หน้า'], ['day', 'เลือกวัน']].map(([k, label]) => h('button', { type: 'button', 'aria-pressed': String(week === k), onclick: () => { if (week === k) return; week = k; dayFilter = ''; if (k === 'day' && !pickDay) pickDay = boot.today; render(); syncUrl(); } }, label)));
  /** The grouped list (🌴 ลา / 🚗 ไปราชการ …) shared by the week view and the one-day view. */
  const groupSections = (rows) => GROUPS.map(([k, title]) => {
    const g = rows.filter((x) => x.group === k); if (!g.length) return null;
    return h('section', { class: 'lv-grp' }, h('h3', null, `${title} (${g.length})`), h('ul', null, ...g.map((x) => h('li', null,
      h('div', null, h('b', null, x.name), x.deptShort ? h('small', null, ` · ${x.deptShort}`) : null),
      h('div', { class: 'lv-li-sub' }, `${x.type}${x.half ? (x.afternoon ? ' (บ่าย)' : ' (เช้า)') : ''} · ${range(x.start, x.end)}${x.st && x.et ? ` ${x.st}–${x.et}` : ''}`,
        x.group !== 'leave' && (x.province || x.mission) ? ` · ${x.province || x.mission}` : '')))));
  });
  const relLabel = (day) => (day === boot.today ? 'วันนี้' : day === addDays(boot.today, 1) ? 'พรุ่งนี้' : day === addDays(boot.today, 2) ? 'มะรืนนี้' : day === addDays(boot.today, -1) ? 'เมื่อวาน' : '');
  const stepDay = (day, dir) => { let d = addDays(day, dir); for (let i = 0; i < 7 && isWeekend(d); i++) d = addDays(d, dir); return d; };    // ‹ › skip Saturday / Sunday, like the LINE buttons
  /** One day, instantly when it lies in the two weeks we already have, otherwise from the server (cached for a minute). */
  function localDay(day) {
    const w = [boot.thisWeek, boot.nextWeek].find((x) => day >= x.from && day <= addDays(x.from, 6)); if (!w) return null;
    const hol = {}; w.holidays.forEach((x) => { hol[x.date] = x.name; });
    return { day, items: w.items.filter((x) => touches(x, day, hol)), over: w.over.filter((o) => o.date === day), holiday: hol[day] || '', weekend: isWeekend(day) };
  }
  function drawDayResult(res, data) {
    const rows = data.items; const people = new Set(rows.map((x) => x.name)).size;
    const parts = [h('p', { class: 'lv-range' }, `${relLabel(data.day) ? `${relLabel(data.day)} · ` : ''}${dowDm(data.day)}`, h('span', null, rows.length ? ` · ${rows.length} รายการ · ${people} คน` : ''))];
    if (data.holiday) parts.push(h('div', { class: 'lv-hol' }, `🎌 วันหยุดราชการ: ${data.holiday}`));
    else if (data.weekend) parts.push(h('div', { class: 'lv-hol' }, 'ℹ️ วันหยุดสุดสัปดาห์ — การลาไม่นับในวันนี้ (ราชการ/อบรม/ประชุมยังแสดง)'));
    if (!rows.length) parts.push(h('div', { class: 'empty' }, h('p', null, '✅ ไม่มีผู้ลา ไปราชการ อบรม หรือประชุมในวันนี้')));
    parts.push(...groupSections(rows).filter(Boolean));
    if (data.over.length) parts.push(h('div', { class: 'lv-hol lv-bad' }, `⚠️ ผู้ลาครบโควต้า ${boot.config.maxLeave} คน/กลุ่มงาน: `, data.over.map((o) => o.deptShort || 'ทุกกลุ่มงาน').join(' · ')));
    res.replaceChildren(...parts);
  }
  async function loadDay(day, res) {
    const local = localDay(day); if (local) { drawDayResult(res, local); return; }
    const hit = dayCache.get(day); if (hit) drawDayResult(res, hit.data);
    if (hit && Date.now() - hit.t < 60000) return;
    if (!hit) res.replaceChildren(h('div', { class: 'lv-skel', role: 'status', 'aria-label': 'กำลังโหลด' }, h('div', { class: 'skeleton lv-skel-1' }), h('div', { class: 'skeleton lv-skel-2' })));
    const tok = ++dayTok;
    try {
      let p = dayFlight.get(day); if (!p) { p = call('mobileWho', [day]); dayFlight.set(day, p); p.then(() => dayFlight.delete(day), () => dayFlight.delete(day)); }
      const data = await p; dayCache.set(day, { t: Date.now(), data });
      if (tok === dayTok && pickDay === day && res.isConnected) drawDayResult(res, data);
    } catch (e) {
      if (tok === dayTok && res.isConnected && !hit) res.replaceChildren(notice('error', 'โหลดวันนี้ไม่สำเร็จ', errText(e)), h('button', { class: 'btn', type: 'button', onclick: () => loadDay(day, res) }, 'ลองใหม่'));
    }
  }
  function dayView() {
    const box = h('div', { class: 'lv-who lv-dayview' }); const res = h('div', { class: 'lv-dayres', 'aria-live': 'polite' });
    const go = (d) => { if (!d || !parse(d)) return; pickDay = d; render(); syncUrl(); };
    const input = h('input', { type: 'date', id: 'lv-pick', value: pickDay, 'aria-label': 'เลือกวันที่', onchange: () => go(input.value) });
    const arrow = (label, text, dir) => h('button', { class: 'lv-arrow', type: 'button', 'aria-label': label, onclick: () => go(stepDay(pickDay, dir)) }, text);
    const quick = h('div', { class: 'lv-quick' }, ...[['วันนี้', boot.today], ['พรุ่งนี้', addDays(boot.today, 1)], ['มะรืนนี้', addDays(boot.today, 2)]].map(([label, d]) =>
      h('button', { class: 'chip', type: 'button', 'aria-pressed': String(pickDay === d), onclick: () => go(d) }, label)));
    box.append(weekSeg(), h('div', { class: 'lv-dayctl' }, arrow('วันก่อนหน้า', '‹', -1), input, arrow('วันถัดไป', '›', 1)), quick, res);
    let sx = 0; let sy = 0;                                                                                       // swipe left / right on the list = next / previous working day
    res.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; sx = t.clientX; sy = t.clientY; }, { passive: true });
    res.addEventListener('touchend', (e) => { const t = e.changedTouches[0]; const dx = t.clientX - sx; if (Math.abs(dx) > 70 && Math.abs(t.clientY - sy) < 45) go(stepDay(pickDay, dx < 0 ? 1 : -1)); }, { passive: true });
    if (boot.me.admin) box.append(h('p', { class: 'lv-admin' }, h('a', { href: '#/hr-line' }, 'ตั้งค่าการแจ้งเตือน LINE →')));
    loadDay(pickDay, res);
    return box;
  }
  function whoView() {
    if (week === 'day') return dayView();
    const d = boot[week]; const box = h('div', { class: 'lv-who' });
    const mon = d.from; const fri = addDays(mon, 4);
    const holMap = {}; d.holidays.forEach((x) => { holMap[x.date] = x.name; });
    if (dayFilter && (dayFilter < mon || dayFilter > fri)) dayFilter = '';
    const depts = [...new Set(d.items.map((x) => x.deptShort).filter(Boolean))];
    if (deptFilter && !depts.includes(deptFilter)) deptFilter = '';
    const rowsAll = d.items.filter((x) => (!deptFilter || x.deptShort === deptFilter));
    const rows = dayFilter ? rowsAll.filter((x) => touches(x, dayFilter, holMap)) : rowsAll;
    const people = new Set(rows.map((x) => x.name)).size;

    box.append(weekSeg(),
      h('p', { class: 'lv-range' }, range(mon, fri), h('span', null, rows.length ? ` · ${rows.length} รายการ · ${people} คน` : '')));

    // Monday–Friday strip: how many people are away each day (tap a day to see just that day)
    const days = [0, 1, 2, 3, 4].map((i) => addDays(mon, i));
    box.append(h('div', { class: 'lv-days', role: 'group', 'aria-label': 'เลือกวัน' }, ...days.map((day) => {
      const n = rowsAll.filter((x) => touches(x, day, holMap)).length; const hol = holMap[day];
      return h('button', { type: 'button', class: `lv-day${day === boot.today ? ' is-today' : ''}${hol ? ' is-hol' : ''}`, 'aria-pressed': String(dayFilter === day), 'aria-label': `${dowDm(day)} ${hol ? `วันหยุด ${hol}` : `${n} รายการ`}`,
        onclick: () => { dayFilter = dayFilter === day ? '' : day; render(); } },
      h('small', null, DOW[dow(day)]), h('b', null, String(parse(day).getUTCDate())), h('span', { class: `lv-count${n ? '' : ' is-zero'}` }, hol ? '🎌' : String(n)));
    })));
    if (depts.length > 1) {
      box.append(h('div', { class: 'chip-row lv-depts', role: 'group', 'aria-label': 'กรองตามกลุ่มงาน' }, ...[['', 'ทุกกลุ่มงาน'], ...depts.map((x) => [x, x])].map(([k, label]) =>
        h('button', { class: 'chip', type: 'button', 'aria-pressed': String(deptFilter === k), onclick: () => { deptFilter = k; render(); } }, label))));
    }
    const hols = dayFilter ? d.holidays.filter((x) => x.date === dayFilter) : d.holidays;
    if (hols.length) box.append(h('div', { class: 'lv-hol' }, '🎌 ', hols.map((x) => `${dowDm(x.date)} ${x.name}`).join(' · ')));
    if (!rows.length) box.append(h('div', { class: 'empty' }, h('p', null, dayFilter || deptFilter ? '✅ ไม่มีรายการตามตัวกรองนี้' : '✅ ยังไม่มีผู้บันทึกลา ไปราชการ อบรม หรือประชุมในช่วงนี้'),
      dayFilter || deptFilter ? h('button', { class: 'btn', type: 'button', onclick: () => { dayFilter = ''; deptFilter = ''; render(); } }, 'ล้างตัวกรอง') : null));
    groupSections(rows).filter(Boolean).forEach((s) => box.append(s));
    const over = d.over.filter((o) => (!dayFilter || o.date === dayFilter) && (!deptFilter || o.deptShort === deptFilter));
    if (over.length) box.append(h('div', { class: 'lv-hol lv-bad' }, `⚠️ ผู้ลาครบโควต้า ${boot.config.maxLeave} คน/กลุ่มงาน: `, over.map((o) => `${dowDm(o.date)} ${o.deptShort || 'ทุกกลุ่มงาน'}`).join(' · ')));
    if (boot.me.admin) box.append(h('p', { class: 'lv-admin' }, h('a', { href: '#/hr-line' }, 'ตั้งค่าการแจ้งเตือน LINE →')));
    return box;
  }

  /* ---------------------------------- mine --------------------------------- */
  function mineView() {
    const box = h('div', { class: 'lv-mine' });
    if (!boot.mine.length) { box.append(h('div', { class: 'empty' }, h('p', null, 'ยังไม่มีรายการที่คุณบันทึกใน 45 วันที่ผ่านมา'), h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { tab = 'add'; render(); syncUrl(); } }, 'ลงลา'))); return box; }
    boot.mine.forEach((r) => {
      const past = r.endDate < boot.today; const now = !past && r.startDate <= boot.today;
      box.append(h('article', { class: `lv-rec${past ? ' is-past' : ''}${now ? ' is-now' : ''}` },
        h('div', { class: 'lv-rec-main' }, h('b', null, r.type), h('span', { class: 'muted' }, ` · ${r.name}`), now ? h('span', { class: 'badge lv-badge' }, 'วันนี้') : null,
          h('div', { class: 'lv-li-sub' }, range(r.startDate, r.endDate) + (r.startTime && r.endTime ? ` ${r.startTime}–${r.endTime}` : '') + (r.province ? ` · ${r.province}` : '') + (r.mission ? ` · ${r.mission}` : ''))),
        h('div', { class: 'lv-rec-act' }, r.canEdit && !past ? [h('button', { class: 'btn', type: 'button', onclick: () => edit(r) }, 'แก้ไข'), h('button', { class: 'btn btn-danger', type: 'button', onclick: () => del(r) }, 'ลบ')] : null,
          h('button', { class: 'btn', type: 'button', title: 'ลงซ้ำโดยใช้รายการนี้เป็นต้นแบบ', onclick: () => dup(r) }, 'ทำซ้ำ'), past ? h('span', { class: 'badge' }, 'ผ่านมาแล้ว') : null)));
    });
    return box;
  }
  function fill(r, forEdit) {
    const base = baseOf(r.type); const half = r.type.includes('ครึ่งวัน');
    const m = /^\((เช้า|บ่าย)\)\s*/.exec(r.note || '');
    const span = r.endDate !== r.startDate;
    Object.assign(f, { name: r.name, type: half ? base : r.type, half: half ? (m ? m[1] : /บ่าย/.test(r.note) ? 'บ่าย' : 'เช้า') : '',
      start: forEdit ? r.startDate : boot.today, end: span ? (forEdit ? r.endDate : addDays(boot.today, spanDays(r.startDate, r.endDate))) : '', multi: span,
      st: r.startTime || '', et: r.endTime || '', province: r.province || '', mission: r.mission || '', note: (r.note || '').replace(/^\((เช้า|บ่าย)\)\s*/, '') });
  }
  function edit(r) { fill(r, true); editId = r.id; tab = 'add'; render(); syncUrl(); window.scrollTo(0, 0); }
  function dup(r) { fill(r, false); editId = ''; tab = 'add'; render(); syncUrl(); window.scrollTo(0, 0); toast('คัดลอกรายการแล้ว — ปรับวันที่แล้วกดบันทึก', 'info'); }
  async function del(r) {
    if (!(await confirmBox({ title: 'ลบรายการนี้?', message: `${r.type} · ${r.name} · ${range(r.startDate, r.endDate)}`, confirm: 'ลบ', danger: true }))) return;
    try {
      const res = await call('deleteRecord', [r.id]);
      if (res && res.status === 'success') { boot.mine = boot.mine.filter((x) => x.id !== r.id); cacheSet(CACHE_KEY, boot); toast('ลบแล้ว', 'success'); render(); refresh().then(softRender, () => {}); } else toast((res && res.message) || 'ลบไม่สำเร็จ', 'error');
    } catch (e) { toast(errText(e), 'error'); }
  }

  /* --------------------------------- loading --------------------------------- */
  const stamp = (b) => { boot = b; cacheSet(CACHE_KEY, b); syncing = false; syncedAt = clock(); return b; };
  async function refresh() { syncing = true; drawSync(); try { return stamp(await call('mobileBoot')); } catch (e) { syncing = false; drawSync(); throw e; } }
  async function manualRefresh() { try { await refresh(); softRender(); } catch (e) { toast(`ใช้ข้อมูลที่เก็บไว้ในเครื่อง — ${errText(e)}`, 'info'); } }

  await cssP;
  drawTabs();
  if (cached && cached.d && cached.d.thisWeek) { boot = cached.d; render(); }                     // 2) last answer from this device, at once
  else { drawSync(); body.append(h('div', { class: 'lv-skel', role: 'status', 'aria-label': 'กำลังโหลด' }, ...[1, 2, 3, 4].map((i) => h('div', { class: `skeleton lv-skel-${i}` })))); }
  try { stamp(await firstP); if (!saving && !showingDone) softRender(); else drawSync(); } catch (e) {   // 3) fresh answer replaces it quietly
    syncing = false;
    if (!boot) { body.replaceChildren(notice('error', 'เปิดหน้าลงลาไม่ได้', `${errText(e)} — ถ้ายังไม่เคยอัปเดตระบบ ให้เพิ่มไฟล์ HrLine.gs แล้ว Deploy เวอร์ชันใหม่`), h('button', { class: 'btn', type: 'button', onclick: () => location.reload() }, 'ลองใหม่')); drawSync(); }
    else { drawSync(); toast('ใช้ข้อมูลที่เก็บไว้ในเครื่อง — เชื่อมต่อไม่ได้ในตอนนี้', 'info'); }
  }
  return undefined;
}
