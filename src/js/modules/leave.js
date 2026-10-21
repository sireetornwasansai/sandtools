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
 * Deep links (for the LINE rich menu):  #/leave  ·  #/leave?tab=who  ·  #/leave?tab=who&week=next  ·  #/leave?tab=mine
 */

const DOW = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
const GROUPS = [['leave', '🌴 ลา'], ['trip', '🚗 ไปราชการ'], ['train', '🎓 อบรม'], ['meet', '👥 ประชุม'], ['other', '📌 อื่นๆ']];
const LEAVE_BASE = ['ลากิจ', 'ลาป่วย', 'ลาพักผ่อน'];            // these three have a half-day variant
const MAIN_TYPES = [['ลากิจ', '🧳'], ['ลาป่วย', '🤒'], ['ลาพักผ่อน', '🌴'], ['ลาไปเรียน', '📚'], ['ไปราชการ', '🚗'], ['อบรม', '🎓'], ['ประชุม', '👥']];
const CACHE_KEY = 'hr:mboot';
const NAME_KEY = 'sand:leave:name';
// quick times for trips / training / meetings — same defaults as the HR page
const TIME_PRESETS = [['ทั้งวัน 08:00–16:00', '08:00', '16:00'], ['เช้า 08:00–12:00', '08:00', '12:00'], ['บ่าย 13:00–16:00', '13:00', '16:00']];

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

function remembered() { try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; } }
function remember(name) { try { if (name) localStorage.setItem(NAME_KEY, name); } catch { /* private mode */ } }
function buzz(ms = 30) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch { /* not supported */ } }

export async function mount(root, ctx) {
  await loadCss('leave');
  const params = (ctx && ctx.params) || new URLSearchParams();
  const page = h('div', { class: 'page lv' });
  root.append(page);
  if (!getSession()) { page.append(notice('warn', 'ต้องเข้าสู่ระบบก่อน', 'ใช้อีเมลหน่วยงานเพื่อลงลาและดูตารางการลา')); return undefined; }

  const call = (op, args = []) => sessionCall('hr', op, { args }, op === 'saveData' || op === 'updateRecord' ? 90000 : 45000);
  let boot = null;
  let tab = ['add', 'who', 'mine'].includes(params.get('tab') || '') ? /** @type {string} */ (params.get('tab')) : 'add';
  let week = params.get('week') === 'next' ? 'nextWeek' : 'thisWeek';
  let editId = '';
  let saving = false;
  let showingDone = false;   // the "บันทึกแล้ว" card is on screen: a late background refresh must not replace it
  const f = { name: remembered(), type: 'ลากิจ', half: '', start: '', end: '', multi: false, st: '', et: '', province: '', mission: '', note: '' };

  const head = h('header', { class: 'lv-head' }, h('div', null, h('h1', null, 'ลงลา / ไปราชการ'), h('p', { class: 'muted' }, 'บันทึกจากมือถือ เชื่อมกับระบบบันทึกการปฏิบัติงานทันที')));
  const tabs = h('div', { class: 'lv-tabs', role: 'tablist', 'aria-label': 'เมนูลงลา' });
  const body = h('div', { class: 'lv-body' });
  page.append(head, tabs, body);

  function drawTabs() {
    const mineN = boot ? boot.mine.length : 0;
    tabs.replaceChildren(...[['add', editId ? 'แก้ไขรายการ' : 'ลงลา'], ['who', 'ใครลา'], ['mine', `ของฉัน${mineN ? ` (${mineN})` : ''}`]].map(([k, label]) =>
      h('button', { class: 'lv-tab', type: 'button', role: 'tab', 'aria-selected': String(tab === k), onclick: () => { tab = k; render(); } }, label)));
  }
  function render() { showingDone = false; drawTabs(); if (!boot) return; body.replaceChildren(tab === 'add' ? addView() : tab === 'who' ? whoView() : mineView()); }

  /* ------------------------------ add / edit ------------------------------ */
  function effectiveType() { return f.half && LEAVE_BASE.includes(f.type) ? `${f.type}ครึ่งวัน` : f.type; }
  function deptOf(name) { const s = boot.staff.find((x) => x.name === name); const d = s && s.department; return boot.config.departments.includes(d) ? d : (boot.config.realDepartments[0] || boot.config.departments[0]); }
  function hint(el) {
    const day = f.start; const t = effectiveType(); el.className = 'lv-hint'; el.textContent = '';
    if (!day) return;
    const hol = boot.holidays[day];
    if (hol && isLeaveType(t)) { el.className = 'lv-hint lv-bad'; el.textContent = `❌ ${dowDm(day)} เป็นวันหยุดราชการ (${hol}) บันทึกการลาไม่ได้`; return; }
    if (hol) { el.textContent = `🎌 ${dowDm(day)} เป็นวันหยุดราชการ (${hol})`; return; }
    if (dow(day) === 0 || dow(day) === 6) { el.textContent = `ℹ️ ${dowDm(day)} เป็นวันหยุดสุดสัปดาห์ — ปฏิทินจะแสดงให้เมื่อเปิดวันเสาร์-อาทิตย์`; return; }
    el.textContent = `${dowDm(day)}${f.multi && f.end > day ? ` ถึง ${dowDm(f.end)}` : ''}`;
  }

  function addView() {
    if (!f.start) f.start = boot.today;
    const wrap = h('div', { class: 'lv-form' });
    if (editId) wrap.append(h('div', { class: 'lv-editbar' }, h('span', null, '✏️ กำลังแก้ไขรายการที่บันทึกไว้'), h('button', { class: 'btn', type: 'button', onclick: () => { resetForm(); render(); } }, 'ยกเลิกการแก้ไข')));

    const sel = h('select', { id: 'lv-name', 'aria-label': 'ชื่อผู้ลา', onchange: () => { f.name = sel.value; remember(f.name); } },
      h('option', { value: '' }, '— เลือกชื่อ —'), ...boot.staff.map((s) => h('option', { value: s.name, selected: s.name === f.name }, `${s.name}${short(s.department) ? ` · ${short(s.department)}` : ''}`)));
    wrap.append(h('div', { class: 'lv-field' }, h('label', { for: 'lv-name' }, 'ชื่อ'), sel));

    // type
    const typeBox = h('div', { class: 'lv-types', role: 'group', 'aria-label': 'ประเภท' });
    const others = boot.config.leaveTypes.filter((t) => !MAIN_TYPES.some((m) => m[0] === t) && !t.includes('ครึ่งวัน'));
    const more = h('select', { 'aria-label': 'ประเภทอื่น ๆ', onchange: () => { if (more.value) { f.type = more.value; f.half = ''; render(); } } },
      h('option', { value: '' }, 'ประเภทอื่น ๆ…'), ...others.map((t) => h('option', { value: t, selected: f.type === t }, t)));
    const drawTypes = () => typeBox.replaceChildren(...MAIN_TYPES.map(([t, ico]) => h('button', { class: 'lv-type', type: 'button', 'aria-pressed': String(f.type === t),
      onclick: () => { f.type = t; if (!LEAVE_BASE.includes(t)) f.half = ''; render(); } }, h('span', { class: 'lv-ico' }, ico), t)));
    drawTypes();
    wrap.append(h('div', { class: 'lv-field' }, h('label', null, 'ประเภท'), typeBox, others.length ? h('div', { class: 'lv-more' }, more) : null));

    // half day
    if (LEAVE_BASE.includes(f.type)) {
      const seg = h('div', { class: 'lv-seg', role: 'group', 'aria-label': 'ช่วงเวลา' }, ...[['', 'เต็มวัน'], ['เช้า', 'ครึ่งวันเช้า'], ['บ่าย', 'ครึ่งวันบ่าย']].map(([k, label]) =>
        h('button', { type: 'button', 'aria-pressed': String(f.half === k), onclick: () => { f.half = k; if (k) { f.multi = false; f.end = ''; } render(); } }, label)));
      wrap.append(h('div', { class: 'lv-field' }, h('label', null, 'ช่วงเวลา'), seg));
    }

    // date
    const hintEl = h('p', { class: 'lv-hint', role: 'status' });
    const start = h('input', { type: 'date', id: 'lv-start', value: f.start, required: true, onchange: () => { f.start = start.value; if (f.end && f.end < f.start) f.end = f.start; hint(hintEl); if (end) end.min = f.start; } });
    const end = h('input', { type: 'date', id: 'lv-end', value: f.end || f.start, min: f.start, onchange: () => { f.end = end.value; hint(hintEl); } });
    start._dfMark = (d) => boot.holidays[d] || ''; end._dfMark = start._dfMark;   // the calendar paints official holidays red
    const quick = h('div', { class: 'lv-quick' }, ...[['วันนี้', boot.today], ['พรุ่งนี้', addDays(boot.today, 1)], ['มะรืนนี้', addDays(boot.today, 2)]].map(([label, d]) =>
      h('button', { class: 'chip', type: 'button', onclick: () => { f.start = d; if (f.end && f.end < d) f.end = d; start.value = d; end.min = d; hint(hintEl); } }, label)));
    const multi = h('input', { type: 'checkbox', id: 'lv-multi', checked: f.multi, disabled: !!f.half, onchange: () => { f.multi = multi.checked; if (!f.multi) f.end = ''; render(); } });
    wrap.append(h('div', { class: 'lv-field' }, h('label', { for: 'lv-start' }, f.multi ? 'ตั้งแต่วันที่' : 'วันที่'), quick, start,
      h('label', { class: 'lv-check', for: 'lv-multi' }, multi, 'หลายวัน')),
      ...(f.multi ? [h('div', { class: 'lv-field' }, h('label', { for: 'lv-end' }, 'ถึงวันที่'), end)] : []), hintEl);   // native append() would print the word "null"
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
        const pv = h('input', { type: 'text', maxlength: 80, value: f.province, placeholder: 'เช่น เชียงใหม่', autocomplete: 'off', oninput: () => { f.province = pv.value; } });
        wrap.append(h('div', { class: 'lv-field' }, h('label', null, 'สถานที่ / จังหวัด'), pv));
      }
      const ms = h('input', { type: 'text', maxlength: 200, value: f.mission, placeholder: f.type === 'ไปราชการ' ? 'ภารกิจ เช่น ประชุมเขตสุขภาพ' : 'เรื่อง / หัวข้อ', autocomplete: 'off', oninput: () => { f.mission = ms.value; } });
      wrap.append(h('div', { class: 'lv-field' }, h('label', null, f.type === 'ไปราชการ' ? 'ภารกิจ' : 'เรื่อง'), ms));
    }

    const note = h('textarea', { rows: 2, maxlength: 480, placeholder: 'หมายเหตุ (ถ้ามี)', oninput: () => { f.note = note.value; } }, f.note);
    wrap.append(h('div', { class: 'lv-field' }, h('label', null, 'หมายเหตุ'), note));
    const msg = h('div', { class: 'lv-msg', role: 'alert' });
    const go = h('button', { class: 'btn btn-primary lv-save', type: 'button', onclick: () => submit(go, msg, note) }, editId ? 'บันทึกการแก้ไข' : 'บันทึก');
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
    editId = ''; f.type = 'ลากิจ'; f.half = ''; f.multi = false; f.end = ''; f.st = ''; f.et = ''; f.province = ''; f.mission = ''; f.note = ''; if (!keepDay) f.start = '';
  }

  async function submit(btn, msg, noteEl) {
    if (saving) return;
    msg.className = 'lv-msg'; msg.textContent = '';
    if (!f.name) { msg.className = 'lv-msg lv-bad'; msg.textContent = 'เลือกชื่อก่อนบันทึก'; return; }
    if (f.multi && f.end && f.end < f.start) { msg.className = 'lv-msg lv-bad'; msg.textContent = 'วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่ม'; return; }
    if (!isLeaveType(f.type)) {
      if (!!f.st !== !!f.et) { msg.className = 'lv-msg lv-bad'; msg.textContent = 'เลือกเวลาให้ครบทั้งเวลาเริ่มและเวลาสิ้นสุด (หรือกด "ล้างเวลา")'; return; }
      if (f.st && f.et && (!f.multi || !f.end || f.end === f.start) && toMinutes(f.et) <= toMinutes(f.st)) { msg.className = 'lv-msg lv-bad'; msg.textContent = 'เวลาสิ้นสุดต้องหลังเวลาเริ่ม'; return; }
    }
    saving = true; btn.disabled = true; btn.textContent = 'กำลังบันทึก…';
    try {
      const r = await call(editId ? 'updateRecord' : 'saveData', [payload()]);
      if (!r || r.status !== 'success') {
        msg.className = 'lv-msg lv-bad'; msg.textContent = (r && r.message) || 'บันทึกไม่สำเร็จ';
        if (r && r.overQuota) { noteEl.focus(); }
        buzz(80); return;
      }
      buzz(); remember(f.name);
      const extra = [r.workdayWarning, r.overlap ? r.overlapDetail && `⚠️ เวลาทับซ้อนกับ ${r.overlapDetail}` : '', r.weekend ? 'ℹ️ รายการอยู่ในวันเสาร์-อาทิตย์' : ''].filter(Boolean);
      const sum = payload();
      const wasEdit = !!editId;
      resetForm(); await refresh(); tab = 'add'; drawTabs(); showingDone = true;
      body.replaceChildren(doneView(sum, wasEdit, extra));
    } catch (e) { msg.className = 'lv-msg lv-bad'; msg.textContent = errText(e); } finally { saving = false; btn.disabled = false; btn.textContent = editId ? 'บันทึกการแก้ไข' : 'บันทึก'; }
  }

  function doneView(sum, wasEdit, extra) {
    return h('div', { class: 'lv-done' }, h('div', { class: 'lv-tick', 'aria-hidden': 'true' }, '✓'), h('h2', null, wasEdit ? 'แก้ไขแล้ว' : 'บันทึกแล้ว'),
      h('p', null, h('b', null, sum.name), ` · ${sum.type}`, h('br'), range(sum.startDate, sum.endDate), sum.startTime && sum.endTime ? ` · ${sum.startTime}–${sum.endTime}` : ''),
      ...extra.map((x) => h('p', { class: 'lv-warn' }, x)),
      h('div', { class: 'lv-doneact' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { tab = 'add'; render(); } }, 'ลงอีกรายการ'),
        h('button', { class: 'btn', type: 'button', onclick: () => { tab = 'who'; render(); } }, 'ดูใครลา')));
  }

  /* ------------------------------ who is away ------------------------------ */
  function whoView() {
    const d = boot[week]; const box = h('div', { class: 'lv-who' });
    const mon = d.from; const fri = addDays(mon, 4);
    box.append(h('div', { class: 'lv-seg lv-seg-lg', role: 'group', 'aria-label': 'ช่วงสัปดาห์' },
      ...[['thisWeek', 'สัปดาห์นี้'], ['nextWeek', 'สัปดาห์หน้า']].map(([k, label]) => h('button', { type: 'button', 'aria-pressed': String(week === k), onclick: () => { week = k; render(); } }, label))),
      h('p', { class: 'lv-range' }, range(mon, fri), h('span', null, d.items.length ? ` · ${d.items.length} รายการ · ${d.people} คน` : '')));
    if (d.holidays.length) box.append(h('div', { class: 'lv-hol' }, '🎌 ', d.holidays.map((x) => `${dowDm(x.date)} ${x.name}`).join(' · ')));
    if (!d.items.length) box.append(h('div', { class: 'empty' }, h('p', null, '✅ ยังไม่มีผู้บันทึกลา ไปราชการ อบรม หรือประชุมในช่วงนี้')));
    GROUPS.forEach(([k, title]) => {
      const rows = d.items.filter((x) => x.group === k); if (!rows.length) return;
      box.append(h('section', { class: 'lv-grp' }, h('h3', null, `${title} (${rows.length})`), h('ul', null, ...rows.map((x) => h('li', null,
        h('div', null, h('b', null, x.name), x.deptShort ? h('small', null, ` · ${x.deptShort}`) : null),
        h('div', { class: 'lv-li-sub' }, `${x.type}${x.half ? (x.afternoon ? ' (บ่าย)' : ' (เช้า)') : ''} · ${range(x.start, x.end)}${x.st && x.et ? ` ${x.st}–${x.et}` : ''}`,
          x.group !== 'leave' && (x.province || x.mission) ? ` · ${x.province || x.mission}` : ''))))));
    });
    if (d.over.length) box.append(h('div', { class: 'lv-hol lv-bad' }, `⚠️ ผู้ลาครบโควต้า ${boot.config.maxLeave} คน/กลุ่มงาน: `, d.over.map((o) => `${dowDm(o.date)} ${o.deptShort || 'ทุกกลุ่มงาน'}`).join(' · ')));
    if (boot.me.admin) box.append(h('p', { class: 'lv-admin' }, h('a', { href: '#/hr-line' }, 'ตั้งค่าการแจ้งเตือน LINE →')));
    return box;
  }

  /* ---------------------------------- mine --------------------------------- */
  function mineView() {
    const box = h('div', { class: 'lv-mine' });
    if (!boot.mine.length) { box.append(h('div', { class: 'empty' }, h('p', null, 'ยังไม่มีรายการที่คุณบันทึกใน 45 วันที่ผ่านมา'), h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { tab = 'add'; render(); } }, 'ลงลา'))); return box; }
    boot.mine.forEach((r) => {
      const past = r.endDate < boot.today;
      box.append(h('article', { class: `lv-rec${past ? ' is-past' : ''}` },
        h('div', { class: 'lv-rec-main' }, h('b', null, r.type), h('span', { class: 'muted' }, ` · ${r.name}`), h('div', { class: 'lv-li-sub' }, range(r.startDate, r.endDate) + (r.startTime && r.endTime ? ` ${r.startTime}–${r.endTime}` : '') + (r.province ? ` · ${r.province}` : '') + (r.mission ? ` · ${r.mission}` : ''))),
        r.canEdit && !past ? h('div', { class: 'lv-rec-act' }, h('button', { class: 'btn', type: 'button', onclick: () => edit(r) }, 'แก้ไข'), h('button', { class: 'btn btn-danger', type: 'button', onclick: () => del(r) }, 'ลบ')) : (past ? h('span', { class: 'badge' }, 'ผ่านมาแล้ว') : null)));
    });
    return box;
  }
  function edit(r) {
    const base = baseOf(r.type); const half = r.type.includes('ครึ่งวัน');
    const m = /^\((เช้า|บ่าย)\)\s*/.exec(r.note || '');
    Object.assign(f, { name: r.name, type: half ? base : r.type, half: half ? (m ? m[1] : /บ่าย/.test(r.note) ? 'บ่าย' : 'เช้า') : '', start: r.startDate, end: r.endDate !== r.startDate ? r.endDate : '', multi: r.endDate !== r.startDate,
      st: r.startTime || '', et: r.endTime || '', province: r.province || '', mission: r.mission || '', note: (r.note || '').replace(/^\((เช้า|บ่าย)\)\s*/, '') });
    editId = r.id; tab = 'add'; render(); window.scrollTo(0, 0);
  }
  async function del(r) {
    if (!(await confirmBox({ title: 'ลบรายการนี้?', message: `${r.type} · ${r.name} · ${range(r.startDate, r.endDate)}`, confirm: 'ลบ', danger: true }))) return;
    try {
      const res = await call('deleteRecord', [r.id]);
      if (res && res.status === 'success') { toast('ลบแล้ว', 'success'); await refresh(); render(); } else toast((res && res.message) || 'ลบไม่สำเร็จ', 'error');
    } catch (e) { toast(errText(e), 'error'); }
  }

  /* --------------------------------- loading --------------------------------- */
  async function refresh() { boot = await call('mobileBoot'); cacheSet(CACHE_KEY, boot); }
  warmBackend();
  const cached = cacheGet(CACHE_KEY, 3 * 86400000);
  if (cached && cached.d && cached.d.thisWeek) { boot = cached.d; render(); } else body.append(h('div', { class: 'skeleton', style: 'height:55vh', role: 'status', 'aria-label': 'กำลังโหลด' }));
  drawTabs();
  try { await refresh(); if (!saving && !showingDone) render(); } catch (e) {
    if (!boot) { body.replaceChildren(notice('error', 'เปิดหน้าลงลาไม่ได้', `${errText(e)} — ถ้ายังไม่เคยอัปเดตระบบ ให้เพิ่มไฟล์ HrLine.gs แล้ว Deploy เวอร์ชันใหม่`), h('button', { class: 'btn', type: 'button', onclick: () => location.reload() }, 'ลองใหม่')); }
    else toast('ใช้ข้อมูลที่เก็บไว้ในเครื่อง — เชื่อมต่อไม่ได้ในตอนนี้', 'info');
  }
  return undefined;
}