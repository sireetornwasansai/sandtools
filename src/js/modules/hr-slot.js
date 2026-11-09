// ปฏิทินปฏิบัติงาน (มุมมองเดือน): รายการที่มี "ช่วงเวลา" แยกซีกของวันให้ชัด — ช่วงเช้า (เช่น 08:00–12:00) = ซีกซ้ายครึ่งช่อง · ช่วงบ่าย (เช่น 13:00–16:00) = ซีกขวาครึ่งช่อง
// Pure helpers (slotOf · slotText) + one DOM helper (pairSlotRows) — no Google / FullCalendar dependency, so they can be unit-tested.

const NOON = 12 * 60; const AM_END_MAX = 12 * 60 + 30;   // an item that ends by 12:30 is "morning"; one that starts at 12:00 or later is "afternoon"
const mins = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t == null ? '' : t)); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };

/** 'am' | 'pm' | '' — which half of the day an item occupies in the month grid. '' = the whole day (multi-day, no times, or a range that spans noon). */
export function slotOf(ep) {
  if (!ep || ep.isHoliday) return '';
  const s = mins(ep.startTime); const e = mins(ep.endTime);
  const single = !ep.endDate || !ep.startDate || ep.endDate === ep.startDate;
  if (single && Number.isFinite(s) && Number.isFinite(e) && e > s) {
    if (e <= AM_END_MAX) return 'am';
    if (s >= NOON) return 'pm';
  }
  if (ep.isHalfDay && single) {   // "ลา…ครึ่งวัน": the note says which half; otherwise the start time; otherwise the morning
    const note = String(ep.note || '');
    if (note.indexOf('บ่าย') >= 0) return 'pm';
    if (note.indexOf('เช้า') >= 0) return 'am';
    return Number.isFinite(s) && s >= NOON ? 'pm' : 'am';
  }
  return '';
}
/** "08:00–12:00" for the tooltip (a half-day leave without times shows the standard hours). */
export function slotText(ep) {
  const slot = slotOf(ep); if (!slot) return '';
  const s = String(ep.startTime || '').slice(0, 5); const e = String(ep.endTime || '').slice(0, 5);
  if (s && e) return `${s}–${e}`;
  return slot === 'pm' ? '13:00–16:00' : '08:00–12:00';
}

/** Put a morning bar and an afternoon bar of the SAME day on ONE row (left | right) instead of two stacked rows.
 *  FullCalendar stacks every event of a day; here the afternoon harness is pulled up over the morning row with a negative margin and both get the same height.
 *  Only DOM styles are touched (never moved), so FullCalendar can re-render safely; call again after any (re)render or resize. */
export function pairSlotRows(root) {
  if (!root) return;
  // multi-day bars are absolutely positioned by FullCalendar: if it did not reserve their height, the week row ends under them and they cover the next week.
  root.querySelectorAll('.fc-daygrid-day-events').forEach((c) => { c.style.minHeight = ''; });
  root.querySelectorAll('.fc-daygrid-body tr').forEach((tr) => {
    let need = 0;
    tr.querySelectorAll('.fc-daygrid-event-harness-abs').forEach((a) => { const c = a.parentElement; need = Math.max(need, a.offsetHeight + (a.offsetTop || 0)); void c; });
    if (need) tr.querySelectorAll('.fc-daygrid-day-events').forEach((c) => { c.style.minHeight = `${need + 4}px`; });
  });
  root.querySelectorAll('.fc-daygrid-day-events').forEach((cell) => {
    const kids = [...cell.children];
    // FullCalendar reserves room under a multi-day (absolute) bar with an inline margin-top on the harnesses below it, and re-writes it whenever it re-lays out.
    // So: only undo what WE set last time (and only if FC has not rewritten it since); never blank or cache FC's own value.
    kids.forEach((k) => {
      if (k.dataset.pairSet !== undefined && k.style.marginTop === k.dataset.pairSet) k.style.marginTop = k.dataset.pairBase || '';
      delete k.dataset.pairSet; delete k.dataset.pairBase;
      k.style.order = ''; const b = k.querySelector('.slot-bar'); if (b) b.style.minHeight = '';
    });
    cell.classList.remove('has-slot-pair');
    const first = (cls) => kids.find((k) => k.querySelector && k.querySelector(`.${cls}`));
    const am = first('slot-am'); const pm = first('slot-pm');
    if (!am || !pm) return;
    cell.classList.add('has-slot-pair');
    kids.forEach((k, i) => { k.style.order = String(i * 10); });
    const lead = kids.indexOf(am) < kids.indexOf(pm) ? am : pm; const tail = lead === am ? pm : am;
    tail.style.order = String(kids.indexOf(lead) * 10 + 1);
    const a = lead.querySelector('.slot-bar'); const b = tail.querySelector('.slot-bar');
    const h = Math.max(lead.offsetHeight, tail.offsetHeight);
    if (a) a.style.minHeight = `${h}px`; if (b) b.style.minHeight = `${h}px`;
    tail.dataset.pairBase = tail.style.marginTop || '';
    tail.style.marginTop = `${-lead.offsetHeight + (parseFloat(tail.dataset.pairBase) || 0)}px`;
    tail.dataset.pairSet = tail.style.marginTop;
  });
}
