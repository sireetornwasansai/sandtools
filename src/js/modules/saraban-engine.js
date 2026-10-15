/**
 * สารบรรณ — pure helpers (no DOM, no network): labels, Thai dates, reading the fields of a Thai official letter from its text
 * (PDF text layer or on-device OCR), CSV export. Everything here runs in the browser; the letter's text never leaves the device.
 */

export const URGENCY = { normal: 'ปกติ', urgent: 'ด่วน', very: 'ด่วนมาก', most: 'ด่วนที่สุด' };
export const SECRECY = { normal: 'ปกติ', secret: 'ลับ', vsecret: 'ลับมาก', tsecret: 'ลับที่สุด' };
export const STAGE = { registered: 'ลงรับแล้ว รอเสนอ', routed: 'ส่งต่อแล้ว รอรับ', inprogress: 'กำลังดำเนินการ', done: 'ดำเนินการแล้ว', returned: 'ส่งคืน รอส่งต่อใหม่', void: 'ยกเลิกเลข', reserved: 'จองเลข', sent: 'ส่งแล้ว' };
export const TO_STATUS = { pending: 'รอรับ', received: 'รับแล้ว', assigned: 'มอบหมายแล้ว', done: 'เสร็จแล้ว', returned: 'ส่งคืน' };
export const ACTION = { perform: 'เพื่อดำเนินการ', ack: 'เพื่อทราบ' };
export const EVENT = { receive: 'ลงรับ', send: 'ออกหนังสือ', reserve: 'จองเลข', void: 'ยกเลิกเลข', route: 'ส่งต่อ', forward: 'ส่งต่อ', command: 'สั่งการ', order: 'ข้อสั่งการ', ack: 'รับทราบ', assign: 'มอบหมาย', done: 'ดำเนินการแล้ว', return: 'ส่งคืน', edit: 'แก้ไขข้อมูล', attach: 'แนบไฟล์', reply: 'ตอบกลับ' };
export const MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const MONTH_FULL = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

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
  return m ? isoFrom(m[3], m[2], m[1]) : '';
}

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
  const text = thaiDigitsToArabic(plainText(raw));
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  // The letterhead = everything above เรื่อง / เรียน / อ้างถึง (date, urgency, secrecy and the sender are printed there).
  let cut = lines.findIndex((l) => /^(เรื่อง|เรียน|อ้างถึง|สิ่งที่ส่งมาด้วย)/.test(l));
  if (cut < 0) cut = Math.min(lines.length, 4);
  const headLines = lines.slice(0, Math.min(cut, 12)); const head = headLines.join('\n');
  const out = { docNo: '', docDate: '', subject: '', party: '', salut: '', refs: '', encl: '', urgency: 'normal', secrecy: 'normal', due: '', dueDays: 0, found: {} };
  const tag = (k, ok) => { if (ok) out.found[k] = true; };

  let m = /ที่\s*([ก-ฮ]{1,5}\s?\d[\d.]*\s?\/\s?(?:ว\s?)?\d+)/.exec(text) || /ที่\s*([ก-ฮ]{1,5}\s?\d[\d.]*\s?\/\s?[ก-ฮ]?\d*)/.exec(text);
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
export function stageTone(stage, overdue) { return overdue ? 'bad' : stage === 'done' || stage === 'sent' ? 'ok' : stage === 'void' ? 'muted' : stage === 'returned' ? 'warn' : stage === 'registered' ? 'warn' : 'info'; }
