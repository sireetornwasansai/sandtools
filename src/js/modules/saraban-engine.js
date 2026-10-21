/**
 * สารบรรณ — pure helpers (no DOM, no network): labels, Thai dates, reading the fields of a Thai official letter from its text
 * (PDF text layer or on-device OCR), CSV export. Everything here runs in the browser; the letter's text never leaves the device.
 */

export const URGENCY = { normal: 'ปกติ', urgent: 'ด่วน', very: 'ด่วนมาก', most: 'ด่วนที่สุด' };
export const SECRECY = { normal: 'ปกติ', secret: 'ลับ', vsecret: 'ลับมาก', tsecret: 'ลับที่สุด' };
export const STAGE = { registered: 'ลงทะเบียนแล้ว', routed: 'ส่งต่อแล้ว รอรับ', inprogress: 'กำลังดำเนินการ', done: 'ดำเนินการแล้ว', returned: 'ส่งคืน รอส่งต่อใหม่', void: 'ยกเลิกเลข', reserved: 'จองเลข', sent: 'ส่งแล้ว' };
export const TO_STATUS = { pending: 'รอรับ', received: 'รับแล้ว', assigned: 'มอบหมายแล้ว', done: 'เสร็จแล้ว', returned: 'ส่งคืน' };
export const ACTION = { perform: 'เพื่อดำเนินการ', ack: 'เพื่อทราบ' };
export const EVENT = { receive: 'ลงรับ', send: 'ออกหนังสือ', reserve: 'จองเลข', void: 'ยกเลิกเลข', route: 'ส่งต่อ', forward: 'ส่งต่อ', command: 'สั่งการ', order: 'ข้อสั่งการ', ack: 'รับทราบ', assign: 'มอบหมาย', done: 'ดำเนินการแล้ว', return: 'ส่งคืน', edit: 'แก้ไขข้อมูล', attach: 'แนบไฟล์', reply: 'ตอบกลับ' };
export const MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
export const MONTH_FULL = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

export const thaiDigitsToArabic = (s) => String(s == null ? '' : s).replace(/[๐-๙]/g, (c) => String(c.charCodeAt(0) - 0x0e50));
export function thaiDate(iso) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${Number(m[1]) + 543}` : ''; }
export function thaiDateTime(stamp) { const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/.exec(stamp || ''); return m ? `${thaiDate(m[1])} ${m[2]}.${m[3]} น.` : thaiDate(stamp); }
export function isoFrom(y, mo, d) {
  y = Number(y); mo = Number(mo); d = Number(d); if (y > 2400) y -= 543;
  if (!(y >= 1990 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return '';
  const dt = new Date(Date.UTC(y, mo - 1, d)); if (dt.getUTCMonth() !== mo - 1) return '';
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
export function monthIndex(word) {
  const w = String(word || '').replace(/\./g, '');
  for (let i = 0; i < 12; i += 1) if (w === MONTHS[i].replace(/\./g, '') || w === MONTH_FULL[i]) return i + 1;
  return 0;
}
/** "9 ตุลาคม 2569" / "๙ ต.ค. ๒๕๖๙" / "09/10/2569" → "2026-10-09" (or ''). */
export function parseThaiDate(text) {
  const t = thaiDigitsToArabic(text);
  let m = /(\d{1,2})\s*(มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม|ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.)\s*(\d{4})/.exec(t);
  if (m) return isoFrom(m[3], monthIndex(m[2]), m[1]);
  m = /(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(t);
  if (m) return isoFrom(m[3], m[2], m[1]);
  m = /(\d{1,2})\s*([ก-๙.]{3,12})\s*(\d{4})/.exec(t);     // OCR-damaged month name
  if (m) { const mo = fuzzyMonth(m[2]); if (mo) return isoFrom(m[3], mo, m[1]); }
  return '';
}

/* ---- OCR-tolerant reading (v1.11): scanned Thai loses/moves tone marks and splits words, so labels are matched by their consonant skeleton ---- */
const MARKS = /[\u0e31\u0e34-\u0e3a\u0e47-\u0e4e]/g;      // vowel marks above/below + tone marks + thanthakhat — the first things OCR drops or swaps
/** "เรื่อง" → "เรอง": remove marks and spaces, keep letters. */
export const skeleton = (s) => String(s || '').replace(MARKS, '').replace(/[\s.:：]/g, '');
export function editDistance(a, b) {
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i += 1) { const cur = [i]; for (let j = 1; j <= n; j += 1) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return prev[n];
}
const LABELS = ['เรื่อง', 'เรียน', 'อ้างถึง', 'สิ่งที่ส่งมาด้วย', 'ลงวันที่'].map((l) => ({ l, k: skeleton(l) }));
/**
 * Put the standard labels (เรื่อง เรียน อ้างถึง สิ่งที่ส่งมาด้วย ลงวันที่) back in place when OCR garbled them ("เรอ่ง", "เร ียน", "อางถึง"…).
 * Only the start of a line is touched, and only when the match is close — body text is never rewritten. Returns the text and what was repaired.
 */
export function repairLabels(text) {
  const fixed = [];
  const out = String(text || '').split('\n').map((line) => {
    const t = line.trim(); if (t.length < 3) return line;
    for (const { l, k } of LABELS) {
      if (t.startsWith(l)) return line;                                  // already right
      const allow = k.length >= 6 ? 2 : k.length >= 4 ? 1 : 0; if (!allow) continue;
      // grow a prefix of the line until its skeleton is as long as the label's, then compare
      let sk = '', i = 0;
      for (; i < t.length && i < k.length + 10; i += 1) { sk += skeleton(t[i]); if (sk.length >= k.length) break; }
      if (!sk.length || editDistance(sk, k) > allow) continue;
      let end = i + 1; while (end < t.length && /[\u0e31\u0e34-\u0e3a\u0e47-\u0e4e]/.test(t[end])) end += 1;   // swallow trailing marks of the last letter
      const rest = t.slice(end).replace(/^[\s:：.]+/, '');
      if (!rest) continue;                                               // a bare word is not a label line
      fixed.push(l); return `${l} ${rest}`;
    }
    return line;
  });
  return { text: out.join('\n'), fixed };
}
/** A month word that OCR damaged ("ตลุาคม", "ตุลาคน") → month number (0 = no match). */
export function fuzzyMonth(word) {
  const w = skeleton(word); if (w.length < 3) return 0; let best = 0, bd = 9;
  for (let i = 0; i < 12; i += 1) for (const name of [MONTH_FULL[i], MONTHS[i]]) {
    const k = skeleton(name), d = editDistance(w, k); if (d < bd && d <= (k.length >= 6 ? 1 : 0)) { bd = d; best = i + 1; }
  }
  return best;
}
/** Digits that OCR confuses with letters, repaired only inside numeric tokens (O→0, l/I→1, S→5, B→8). */
export const fixDigitLook = (s) => String(s || '').replace(/(?<=[\d/.])[OoQ](?=[\d/.])|(?<=\d)[OoQ]\b/g, '0').replace(/(?<=[\d/.])[lI|](?=[\d/.])|(?<=\d)[lI|](?![ก-๙A-Za-z])/g, '1').replace(/(?<=[\d/])S(?=\d)/g, '5');

/** Strip the markdown the converters add, keep line structure. */
export function plainText(md) {
  return String(md || '').replace(/\r/g, '').replace(/^#{1,6}\s*/gm, '').replace(/[*_`>|]/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/[ \t\u00a0]+/g, ' ').replace(/^ +| +$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}
const ORG_RE = /(โรงพยาบาล|รพ\.|สำนักงาน|สำนัก|กระทรวง|กรม|กอง|จังหวัด|สาธารณสุข|มหาวิทยาลัย|วิทยาลัย|องค์การ|องค์กร|สถาบัน|ศูนย์|เทศบาล|องค์การบริหาร|สภา|คณะ|ศาล|อำเภอ|สสจ\.|สสอ\.)/;

/**
 * Read a Thai letter. Returns the fields it could find plus `found` (which ones were actually located) — the clerk always confirms,
 * nothing here is trusted blindly. `dueDays` is "within N days" (counted from the registration day by the caller).
 */
export function parseLetter(raw) {
  const rep = repairLabels(fixDigitLook(thaiDigitsToArabic(plainText(raw))));
  const text = rep.text;
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  // The letterhead = everything above เรื่อง / เรียน / อ้างถึง (date, urgency, secrecy and the sender are printed there).
  let cut = lines.findIndex((l) => /^(เรื่อง|เรียน|อ้างถึง|สิ่งที่ส่งมาด้วย)/.test(l));
  if (cut < 0) cut = Math.min(lines.length, 4);
  const headLines = lines.slice(0, Math.min(cut, 12)); const head = headLines.join('\n');
  const out = { docNo: '', docDate: '', subject: '', party: '', salut: '', refs: '', encl: '', urgency: 'normal', secrecy: 'normal', due: '', dueDays: 0, found: {}, repaired: rep.fixed };
  const tag = (k, ok) => { if (ok) out.found[k] = true; };

  let m = /(?:^|\s)ที่?\s*([ก-ฮ]{1,5}\s?\d[\d.]*\s?\/\s?(?:ว\s?\.?\s?|พิเศษ\s?)?\d+(?:-\d+)?)/.exec(text) || /(?:^|\s)ที่?\s*([ก-ฮ]{1,5}\s?\d[\d.]*\s?\/\s?[ก-ฮ]?\d*)/.exec(text);   // ที่ ชม 0033.002/ว1190 · ที่ อว78.06/ว.20419 · ที่ สธ 0123/พิเศษ 9
  if (m) out.docNo = m[1].replace(/\s*\/\s*/g, '/').replace(/\s+/g, ' ').trim();
  tag('docNo', !!out.docNo);

  const noRefs = text.replace(/(?:อ้างถึง|สิ่งที่ส่งมาด้วย)[\s\S]*?(?=\n\s*(?:ด้วย|ตามที่|เนื่องจาก|เรียน)|\n\s*\n|$)/g, ' ');   // dates quoted from other letters are not this letter's date
  let d = parseThaiDate(head);
  if (!d) { m = /ลงวันที่\s*([^\n]{4,40})/.exec(noRefs); d = m ? parseThaiDate(m[1]) : ''; }
  if (!d) d = parseThaiDate(noRefs.slice(0, 2500));
  out.docDate = d; tag('docDate', !!d);

  m = /เรื่อง\s+([\s\S]+?)(?=\n\s*(?:เรียน|อ้างถึง|สิ่งที่ส่งมาด้วย|ด้วย|ตามที่|เนื่องจาก)|\n\s*\n|$)/.exec(text);
  if (m) out.subject = m[1].replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
  tag('subject', !!out.subject);

  m = /(?:^|\n)\s*เรียน\s+([^\n]+)/.exec(text); if (m) out.salut = m[1].trim().slice(0, 160); tag('salut', !!out.salut);
  m = /อ้างถึง\s+([\s\S]+?)(?=\n\s*(?:สิ่งที่ส่งมาด้วย|ด้วย|ตามที่|เนื่องจาก|เรียน)|\n\s*\n|$)/.exec(text); if (m) out.refs = m[1].replace(/\s*\n\s*/g, ' ').trim().slice(0, 400); tag('refs', !!out.refs);
  m = /สิ่งที่ส่งมาด้วย\s+([\s\S]+?)(?=\n\s*(?:ด้วย|ตามที่|เนื่องจาก|เรียน|อ้างถึง)|\n\s*\n|$)/.exec(text); if (m) out.encl = m[1].replace(/\s*\n\s*/g, ' ').trim().slice(0, 400); tag('encl', !!out.encl);

  const top = head;
  if (/ด่วนที่สุด/.test(top)) out.urgency = 'most'; else if (/ด่วนมาก/.test(top)) out.urgency = 'very'; else if (/(?:^|[\s(])ด่วน(?:$|[\s)])/m.test(top)) out.urgency = 'urgent';
  tag('urgency', out.urgency !== 'normal');
  if (headLines.some((l) => /^ลับที่สุด$/.test(l))) out.secrecy = 'tsecret';
  else if (headLines.some((l) => /^ลับมาก$/.test(l))) out.secrecy = 'vsecret';
  else if (headLines.some((l) => /^ลับ$/.test(l))) out.secrecy = 'secret';
  tag('secrecy', out.secrecy !== 'normal');

  m = /ภายใน(?:วันที่)?\s*(\d{1,2}\s*[^\d\s]+\s*\d{4}|\d{1,2}[/.-]\d{1,2}[/.-]\d{4})/.exec(text);
  if (m) { out.due = parseThaiDate(m[1]); tag('due', !!out.due); }
  if (!out.due) { m = /ภายใน\s*(\d{1,3})\s*วัน/.exec(text); if (m && Number(m[1]) <= 365) { out.dueDays = Number(m[1]); tag('due', true); } }

  const org = lines.slice(0, 12).find((l) => ORG_RE.test(l) && !/^(เรียน|เรื่อง|อ้างถึง|ที่ )/.test(l) && l.length <= 90);
  if (org) out.party = org.replace(/^(ส่วนราชการ|จาก)\s*/, '').trim(); tag('party', !!out.party);
  return out;
}

/** ISO date + n calendar days. */
export function addDays(iso, n) { const t = Date.parse(`${iso}T00:00:00Z`) + n * 86400000; return new Date(t).toISOString().slice(0, 10); }
export function daysUntil(iso, today) { return Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000); }
export function dueLabel(iso, today, closed = false) {
  if (!iso) return '';
  if (closed) return thaiDate(iso);
  const d = daysUntil(iso, today);
  return `${thaiDate(iso)} · ${d < 0 ? `เลยกำหนด ${-d} วัน` : d === 0 ? 'ครบกำหนดวันนี้' : `อีก ${d} วัน`}`;
}

/** RFC-4180 CSV with a BOM (so Excel reads Thai) and a guard against spreadsheet formulas. */
export function toCsv(headers, rows) {
  const esc = (v) => { let s = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return `\ufeff${[headers, ...rows].map((r) => r.map(esc).join(',')).join('\r\n')}`;
}
export function newRid() { return (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : `r${Date.now()}${Math.random().toString(16).slice(2)}`).replace(/[^A-Za-z0-9-]/g, '').slice(0, 40); }
export function fileToBase64(file) {
  return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1] || ''); r.onerror = () => reject(new Error('อ่านไฟล์ไม่สำเร็จ')); r.readAsDataURL(file); });
}
/** Which tab / which row the recipient screen should highlight. */
export function stageTone(stage, overdue) { return overdue ? 'bad' : stage === 'done' || stage === 'sent' ? 'ok' : stage === 'void' ? 'muted' : stage === 'returned' ? 'warn' : stage === 'registered' ? 'plain' : 'info'; }
/** v1.10: the register is a backup of the clerks' own books, so a letter that nobody routed in this system has NO known status — show no status badge for it (and none for plain "sent"). */
export const STAGE_HIDDEN = ['registered', 'sent'];
export const stageLabel = (stage) => (STAGE_HIDDEN.indexOf(stage) >= 0 ? '' : STAGE[stage] || stage || '');

/* ------------------------------ v1.8.0: dates, stages, print sheets ------------------------------ */

const WEEKDAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
/** "2026-10-14" → "วันพุธที่ 14 ตุลาคม พ.ศ. 2569". */
export function thaiDateLong(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); if (!m) return '';
  const wd = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
  return `วัน${WEEKDAYS[wd]}ที่ ${Number(m[3])} ${MONTH_FULL[Number(m[2]) - 1]} พ.ศ. ${Number(m[1]) + 543}`;
}
/** Days waiting → "วันนี้" / "เมื่อวาน" / "3 วันก่อน" ('' when unknown). */
export function ageLabel(n) { n = Number(n); if (!Number.isFinite(n) || n < 0) return ''; return n === 0 ? 'วันนี้' : n === 1 ? 'เมื่อวาน' : `${n} วันก่อน`; }
export const escHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** The four steps a received letter walks through (the progress bar on the tracking page). */
export const STAGE_STEPS = [['registered', 'ลงรับ'], ['routed', 'ส่งต่อ'], ['inprogress', 'ดำเนินการ'], ['done', 'เสร็จสิ้น']];
/** Index (0-3) of the step a letter has reached; returned letters wait at 0; void/unknown → -1. */
export function stageIndex(stage) {
  if (stage === 'returned') return 0;
  return STAGE_STEPS.findIndex((s) => s[0] === stage);
}

const PRINT_CSS = '@page{size:A4 landscape;margin:12mm}body{font:12px/1.45 "TH Sarabun New","Sarabun",Tahoma,sans-serif;color:#000}h1{font-size:18px;margin:0 0 2px;text-align:center}p.sub{margin:0 0 8px;text-align:center}table{width:100%;border-collapse:collapse}th,td{border:1px solid #000;padding:3px 5px;vertical-align:top}th{background:#eee}td.c{text-align:center;white-space:nowrap}.void td{color:#777;text-decoration:line-through}.hint{margin:8px 0;color:#555}@media print{.hint{display:none}}';
/** Printable register (ทะเบียนหนังสือรับ/ส่ง), A4 landscape. rows are the objects returned by the `rows` op. */
export function buildRegisterHtml({ org, kind, year, rows }) {
  const out = kind === 'out'; const list = rows || [];
  const body = list.length ? list.map((d) => `<tr${d.stage === 'void' ? ' class="void"' : ''}><td class="c">${escHtml(d.reg)}</td><td class="c">${escHtml(thaiDate(String(d.at || '').slice(0, 10)))}</td><td>${escHtml(d.docNo)}</td><td class="c">${escHtml(thaiDate(d.docDate))}</td><td>${escHtml(d.party)}</td><td>${escHtml(d.subject)}${d.urgency && d.urgency !== 'normal' ? ` <b>(${escHtml(URGENCY[d.urgency])})</b>` : ''}</td><td>${escHtml(d.action || STAGE[d.stage] || '')}</td><td>${escHtml(d.note)}</td></tr>`).join('') : '<tr><td colspan="8" class="c">ไม่มีรายการ</td></tr>';
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>ทะเบียนหนังสือ${out ? 'ส่ง' : 'รับ'} ${escHtml(year)}</title><style>${PRINT_CSS}</style></head><body><h1>ทะเบียนหนังสือ${out ? 'ส่ง' : 'รับ'} ประจำปี พ.ศ. ${escHtml(year)}</h1><p class="sub">${escHtml(org)}</p><p class="hint">พิมพ์ด้วย A4 landscape — กด Ctrl+P</p><table><thead><tr><th>เลข${out ? 'ส่ง' : 'รับ'}</th><th>วันที่ลงทะเบียน</th><th>ที่หนังสือ</th><th>ลงวันที่</th><th>${out ? 'ถึง' : 'จาก'}</th><th>เรื่อง</th><th>การปฏิบัติ</th><th>หมายเหตุ</th></tr></thead><tbody>${body}</tbody></table></body></html>`;
}
/** ตรารับหนังสือ — the received stamp (box with org, เลขรับ, date, time) printed on a half sheet. */
export function buildReceiptHtml({ org, doc }) {
  const at = String(doc.at || ''); const t = /[ T](\d{2}):(\d{2})/.exec(at);
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>ตรารับ ${escHtml(doc.reg)}</title><style>@page{size:A5 landscape;margin:10mm}body{font:16px/1.7 "TH Sarabun New","Sarabun",Tahoma,sans-serif}.box{width:9cm;border:2px solid #000;padding:.5cm;margin:1cm auto;text-align:center}.box b{font-size:20px}</style></head><body><div class="box"><b>${escHtml(org)}</b><br>เลขรับ ${escHtml(doc.reg)}<br>วันที่ ${escHtml(thaiDate(at.slice(0, 10)))}${t ? `<br>เวลา ${t[1]}.${t[2]} น.` : ''}</div></body></html>`;
}

/* ------------------------------ v1.10: analytics helpers (ศูนย์สารบรรณ) ------------------------------ */

export const WEEKDAY_SHORT = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
/** Change versus last year as a short Thai phrase: "เพิ่มขึ้น 12%" / "ลดลง 5%" / "เท่าเดิม" / "ไม่มีข้อมูลปีก่อน". */
export function changeLabel(now, prev) {
  now = Number(now) || 0; prev = Number(prev) || 0;
  if (!prev) return now ? 'ไม่มีข้อมูลปีก่อนเทียบ' : '';
  const p = Math.round(((now - prev) * 100) / prev);
  return p === 0 ? 'เท่าปีก่อน' : p > 0 ? `เพิ่มขึ้น ${p}% จากปีก่อน` : `ลดลง ${Math.abs(p)}% จากปีก่อน`;
}
/** Share of `n` in `total` as a whole percent (0 when total is 0). */
export const pct = (n, total) => (total ? Math.round((Number(n) * 100) / total) : 0);
/** Steps of the receive wizard (the order the clerk works in). */
export const RECEIVE_STEPS = [['import', 'นำเข้า'], ['read', 'อ่านอัตโนมัติ'], ['dup', 'ตรวจซ้ำ'], ['number', 'ออกเลขรับ'], ['forward', 'ส่งต่อ']];
/** Human names of the fields the on-device reader fills in. */
export const SCAN_FIELD_LABELS = { docNo: 'เลขที่หนังสือ', docDate: 'ลงวันที่', subject: 'เรื่อง', party: 'จาก', salut: 'เรียน', refs: 'อ้างถึง', encl: 'สิ่งที่ส่งมาด้วย', urgency: 'ชั้นความเร็ว', secrecy: 'ชั้นความลับ', due: 'กำหนดเสร็จ' };
