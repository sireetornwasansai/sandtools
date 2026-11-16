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
export function thaiDate(iso) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? `${m[3]}/${m[2]}/${Number(m[1]) + 543}` : ''; }   // วว/ดด/ปปปป (พ.ศ.) — the long official form is thaiDateLong
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
  let m = /(\d{1,2})\s*(มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม|ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.)\s*(?:พ\.?\s?ศ\.?\s*)?(\d{4})/.exec(t);
  if (m) return isoFrom(m[3], monthIndex(m[2]), m[1]);
  m = /(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(t);
  if (m) return isoFrom(m[3], m[2], m[1]);
  m = /(\d{1,2})\s*([ก-๙.]{3,12}?)\s*(?:พ\.?\s?ศ\.?\s*)?(\d{4})/.exec(t);     // OCR-damaged month name
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

/* ---- v1.18 reading accuracy: OCR junk, garbled years, deadline, stamps, attachment-page cross-check ---- */
const beOf = (iso) => Number(String(iso).slice(0, 4)) + 543;
const monthOfWord = (w) => monthIndex(w) || fuzzyMonth(String(w).replace(/\./g, ''));
const NO_PAT = '[ก-ฮ]{1,5}\\s?\\d[\\d.]*\\s?\\/\\s?(?:ว\\s?\\.?\\s?|พิเศษ\\s?)?\\d+(?:-\\d+)?';
const normNo = (s) => String(s).replace(/\s*\/\s*/g, '/').replace(/\s+/g, ' ').trim();

/**
 * Cut runs of OCR junk out of the text ("v% 33 ส J a 1 5) a จี่ ov a =% o a" between two real words).
 * A run needs at least 2 junk tokens made of Latin letters / symbols; the lone digits and one-consonant tokens beside them go with it.
 * @returns {{text:string, cut:number}} cut = number of tokens removed
 */
export function stripOcrNoise(text) {
  let cut = 0;
  const kind = (t) => {
    const c = t.replace(/[()[\].,;:!?'"“”‘’]/g, '');
    if (!c) return 'p';
    if (/^[A-Z]{2,3}$/.test(c)) return 'k';                                                  // IT, ICT, QR — real acronyms stay
    if (c.length <= 3 && /[A-Za-z%=~|^*_\\<>{}]/.test(c) && !/[ก-๙]/.test(c)) return 'j';   // strong junk
    if (/^\d{1,2}$/.test(c)) return 'n';
    if (/^[ก-ฮ][\u0e31\u0e34-\u0e3a\u0e47-\u0e4e]{0,2}$/.test(c) && !/^(ณ|ที่|ที|นี้|นี่|นี|ก็|ซึ่ง)$/.test(c)) return 't';   // a lone consonant is junk, but ที่ นี้ ก็ are words
    return 'k';
  };
  const out = String(text || '').split('\n').map((line) => {
    const toks = line.split(/\s+/).filter(Boolean); const ks = toks.map(kind); const keep = toks.map(() => true);
    for (let i = 0; i < toks.length;) {
      if (ks[i] === 'k') { i += 1; continue; }
      let j = i; while (j < toks.length && ks[j] !== 'k') j += 1;
      let strong = 0; for (let x = i; x < j; x += 1) if (ks[x] === 'j') strong += 1;
      if (strong >= 2) { for (let x = i; x < j; x += 1) keep[x] = false; cut += j - i; }   // the whole run: lone digits and consonants beside the junk are junk too
      else { let nn = 0; let tt = 0; for (let x = i; x < j; x += 1) { if (ks[x] === 'n') nn += 1; if (ks[x] === 't') tt += 1; }
        if (j - i >= 4 && nn >= 2 && tt >= 1 && nn + tt === j - i) { for (let x = i; x < j; x += 1) keep[x] = false; cut += j - i; } }   // "1 9) 2 3 ซ่": only lone digits and lone consonants, ≥ 4 in a row
      i = j;
    }
    return toks.filter((_, x) => keep[x]).join(' ');
  });
  return { text: out.join('\n'), cut };
}

/**
 * OCR turns Thai digits (๒๕๖๙) into other numbers ("2525", "25001"). Fix only years that cannot be right, from the letter's own date:
 * "ครั้งที่ 2/2525" → the letter's year; "1 ตุลาคม 2525 ถึงวันที่ 31 มีนาคม 25001" → the dates nearest the letter date, a range start never after its end.
 * A year that is plausible is never touched.
 */
export function repairYears(text, docISO) {
  if (!docISO) return String(text || '');
  const be = beOf(docISO); const docT = Date.parse(`${docISO}T00:00:00Z`);
  const okYear = (y) => /^\d{4}$/.test(y) && Number(y) >= be - 3 && Number(y) <= be + 1;
  const s = String(text || '').replace(/(ครั้งที่\s*\d{1,2}\s*\/\s*)(\d{3,5})(?!\d)/g, (m, p, y) => (okYear(y) ? m : p + be));
  const re = /(\d{1,2})\s+([ก-๙.]{3,12})\s*(?:พ\.?\s?ศ\.?\s*)?(\d{3,5})(?!\d)/g; const ms = []; let m;
  while ((m = re.exec(s))) { const mo = monthOfWord(m[2]); if (mo) ms.push({ at: m.index, end: m.index + m[0].length, d: Number(m[1]), mo, y: m[3] }); }
  const pick = (d, mo, hi) => {
    let best = 0; let score = hi == null ? Infinity : -Infinity;
    for (let y = be - 2; y <= be + 1; y += 1) {
      const iso = isoFrom(y, mo, d); if (!iso) continue; const t = Date.parse(`${iso}T00:00:00Z`);
      if (hi == null) { const dist = Math.abs(t - docT); if (dist < score) { score = dist; best = y; } } else if (t <= hi && t > score) { score = t; best = y; }
    }
    return best;
  };
  const res = []; const fixes = [];
  for (let i = ms.length - 1; i >= 0; i -= 1) {
    const x = ms[i]; const next = ms[i + 1];
    const hi = next && res[i + 1] && /ถึง/.test(s.slice(x.end, next.at)) ? res[i + 1] : null;
    const y = okYear(x.y) ? Number(x.y) : pick(x.d, x.mo, hi);
    const iso = y ? isoFrom(y, x.mo, x.d) : ''; res[i] = iso ? Date.parse(`${iso}T00:00:00Z`) : null;
    if (y && !okYear(x.y)) fixes.push({ at: x.end - x.y.length, len: x.y.length, to: String(y) });
  }
  return fixes.reduce((acc, f) => acc.slice(0, f.at) + f.to + acc.slice(f.at + f.len), s);   // fixes run last → first, so earlier offsets stay valid
}

/** Put the digits of a clean copy of the subject (attachment page) into the OCR subject — only when both hold the same count of numbers. */
export function digitsFromRef(subject, ref) {
  const num = /\d+(?:\/\d+)?/g; const a = String(subject).match(num) || []; const b = String(ref).match(num) || [];
  if (!a.length || a.length !== b.length) return subject;
  let i = 0; return String(subject).replace(num, () => b[i++]);
}

const subjectKey = (s) => skeleton(s).replace(/[\d/()\-.,]/g, '');
/** Drop short OCR leftovers ("เขอ่", "TUN") that the clean copy of the subject does not contain; real words and numbers stay. */
export function dropStrays(subject, ref) {
  const hay = subjectKey(ref);
  return String(subject).split(/\s+/).map((t) => { const k = subjectKey(t); return t.length > 4 || /\d/.test(t) || !k || hay.includes(k) ? t : (t[0] === '(' ? '(' : ''); }).join(' ').replace(/\(\s+/g, '(').replace(/\s+/g, ' ').trim();
}
/** Same subject despite OCR damage? (compared on consonant skeletons, first 30 letters) */
export function sameSubject(a, b) {
  const x = subjectKey(a).slice(0, 30); const y = subjectKey(b).slice(0, 30); const n = Math.min(x.length, y.length);
  return n >= 12 && editDistance(x.slice(0, n), y.slice(0, n)) / n <= 0.4;
}

/**
 * Attachment page ("บัญชีแนบท้าย…") that prints this letter again: "หนังสือจังหวัด… ที่ ชม 0017.5/ว 14379 ลงวันที่ 27 เมษายน 2569" + "เรื่อง …".
 * Its text layer holds clean digits, so it is the cross-check for the number, the date and the digits of the subject (tone marks may be missing there).
 */
export function findAttachmentHeader(text) {
  const ls = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const re = new RegExp(`^หนังสือ[^\\d\\n]{0,70}?ที่\\s*(${NO_PAT})\\s*ลงวันที่\\s*([^\\n]{4,40})$`);
  for (let i = 0; i < ls.length - 1; i += 1) {
    const m = re.exec(ls[i]); if (!m || !/^เรื่อง/.test(ls[i + 1])) continue;
    const docDate = parseThaiDate(m[2]); if (!docDate) continue;
    const sub = [ls[i + 1].replace(/^เรื่อง\s*:?\s*/, '')];
    for (let j = i + 2; j < ls.length && sub.length < 4 && !/^(\d+\s|เรียน|อ้างถึง)/.test(ls[j]); j += 1) sub.push(ls[j]);
    return { docNo: normNo(m[1]), docDate, subject: sub.join(' ').replace(/\s+/g, ' ').trim() };
  }
  return null;
}

const ASK_VERB = /ขอให้|โปรด|ส่ง|ตอบ|แจ้ง|รายงาน|ลงทะเบียน|ยืนยัน|นำส่ง|ดำเนินการ|เสนอ|สมัคร/;
/** Thai digits OCR mixes up most (๘→๕ ๙→๕ ๗→๑ ๖→๒ …), as Arabic digits: tried one at a time when a day cannot be right. */
const DIGIT_MIX = { 5: '8693', 8: '53', 9: '501', 1: '794', 7: '1', 6: '52', 3: '8', 0: '96', 2: '6', 4: '1' };
function dayVariants(dd) {
  const out = [String(dd)]; const str = String(dd);
  for (let k = 0; k < str.length; k += 1) for (const c of (DIGIT_MIX[str[k]] || '')) { const v = Number(str.slice(0, k) + c + str.slice(k + 1)); if (v >= 1 && v <= 31 && !out.includes(String(v))) out.push(String(v)); }
  return out;
}
/**
 * The date the sender wants an answer / the work by ("ภายในวันที่ ๒๘ เมษายน ๒๕๖๙", "ไม่เกินวันที่ …", "ก่อนวันที่ …").
 * Several can exist (the meeting day is not a deadline): the one after a request verb wins, one followed by "เวลา / ณ" loses.
 * The year (missing or garbled) comes from the letter date, else from `today`. A deadline can never be before the letter,
 * so a day that comes out earlier is read again with the digits OCR confuses (25 → 28); that guess is added to `notes`.
 * @param {string} text @param {string} docISO letter date or '' @param {string} [today] ISO date used when the letter date is unknown @param {string[]} [notes] receives a warning when a digit was guessed
 * @returns {string} ISO date or ''
 */
export function findDue(text, docISO, today, notes) {
  const t = String(text || ''); const anchor = docISO || today || ''; const be = anchor ? beOf(anchor) : 0; const limit = anchor ? addDays(anchor, 150) : '';
  const re = /(?:ภายใน|ไม่เกิน|ก่อน)\s*(?:วัน[ก-๙]{0,10}?(?:ที่)?)?\s*(\d{1,2})\s*([ก-๙.]{3,12})\s*(?:พ\.?\s?ศ\.?\s*)?(\d{2,5})?(?!\d)/g;
  let best = null; let m;
  while ((m = re.exec(t))) {
    const mo = monthOfWord(m[2]); if (!mo) continue;
    let y = m[3] || ''; if (y.length === 2) y = String(2500 + Number(y));
    const stated = /^\d{4}$/.test(y) && Number(y) >= be - 1 && Number(y) <= be + 2 && be ? Number(y) : 0;     // a sensible printed year is kept
    let iso = ''; let guessed = false;
    for (const dd of dayVariants(m[1])) {
      for (const yy of stated ? [stated] : be ? [be, be + 1] : [Number(y) || 0]) {
        const c = yy ? isoFrom(yy, mo, dd) : '';
        if (c && (!anchor || (c >= anchor && c <= limit))) { iso = c; guessed = dd !== String(Number(m[1])); break; }
      }
      if (iso) break;
    }
    if (!iso) continue;
    const before = t.slice(Math.max(0, m.index - 140), m.index); const after = t.slice(m.index + m[0].length, m.index + m[0].length + 30);
    const score = 1 + (ASK_VERB.test(before) ? 2 : 0) + (/วัน[ก-๙]{0,10}ที่/.test(m[0]) ? 1 : 0) - (/^\s*(เวลา|ณ)/.test(after) ? 2 : 0);
    if (!best || score > best.score) best = { iso, score, guessed, raw: m[1] };
  }
  if (best && best.guessed && notes) notes.push(`กำหนดตอบกลับ: OCR อ่านวันที่เป็น “${best.raw}” ซึ่งเป็นไปไม่ได้ (ก่อนวันที่หนังสือ) — เดาว่าเป็น ${best.iso.slice(8)} ตรวจกับต้นฉบับ`);
  return best ? best.iso : '';
}

/** Letter date when OCR garbled it: day + month are read, the year is the latest one that is not after `today` ("๒๗ เมษายน ๒๕๖๙" → "(๒๕| เมษายน ๒๕๐๕"). */
export function inferDocDate(head, today) {
  if (!today) return '';
  const be = beOf(today); const re = /(\d{1,2})\s*\|?\s*([ก-๙.]{3,12})\s*(?:พ\.?\s?ศ\.?\s*)?(\d{3,5})?(?!\d)/g; let m;
  while ((m = re.exec(String(head || '')))) {
    const mo = monthOfWord(m[2]); if (!mo) continue;
    for (let y = be; y >= be - 1; y -= 1) { const c = isoFrom(y, mo, m[1]); if (c && c <= today) return c; }
  }
  return '';
}

/** Urgency / secrecy stamps at the top of the letter, found on consonant skeletons so lost tone marks ("ดวนทสี่ ุด") still count. */
export function readStamps(headLines) {
  const RK = { normal: 0, urgent: 1, very: 2, most: 3, secret: 1, vsecret: 2, tsecret: 3 }; const out = { urgency: 'normal', secrecy: 'normal' };
  const near = (s, k) => s === k || (s.length >= 4 && s.length <= k.length + 1 && editDistance(s, k) <= 1);
  const up = (u) => { if (RK[u] > RK[out.urgency]) out.urgency = u; };
  headLines.slice(0, 8).forEach((l) => {
    const s = skeleton(l);
    if (s.startsWith('ดวนทสด') || near(s, 'ดวนทสด')) up('most'); else if (s.startsWith('ดวนมาก') || near(s, 'ดวนมาก')) up('very'); else if (s === 'ดวน') up('urgent');
    const sec = s.startsWith('ลบทสด') || near(s, 'ลบทสด') ? 'tsecret' : s.startsWith('ลบมาก') || near(s, 'ลบมาก') ? 'vsecret' : s === 'ลบ' ? 'secret' : '';
    if (sec && RK[sec] > RK[out.secrecy]) out.secrecy = sec;
  });
  return out;
}

const DOCNO_LEAD = new RegExp(`^ที่?\\s*${NO_PAT}\\s*`);
/** Sender from a letterhead line. OCR often joins the letter number (left) and the agency (beside the emblem) into one line. */
function orgFromLine(l) {
  const t0 = stripOcrNoise(l.replace(DOCNO_LEAD, '')).text.trim();
  if (!t0 || /^(เรียน|เรื่อง|อ้างถึง|ที่\s)/.test(t0) || /^(ถนน|ถ\.|ตำบล|แขวง|โทร)/.test(t0) || /\d{5}/.test(t0) || t0.length > 90) return '';
  const m = ORG_RE.exec(t0); if (!m) return '';
  const t = m.index && t0.slice(0, m.index).trim().length <= 3 ? t0.slice(m.index) : t0;
  return t.replace(/^(ส่วนราชการ|จาก)\s*/, '').trim();
}

/**
 * Read a Thai letter. Returns the fields it could find plus `found` (which ones were actually located) — the clerk always confirms,
 * nothing here is trusted blindly. `dueDays` is "within N days" (counted from the registration day by the caller).
 */
export function parseLetter(raw, opts = {}) {
  const today = opts && opts.today ? String(opts.today) : '';
  const rep = repairLabels(fixDigitLook(thaiDigitsToArabic(plainText(raw))));
  const text = rep.text;
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  // The letterhead = everything above เรื่อง / เรียน / อ้างถึง (date, urgency, secrecy and the sender are printed there).
  let cut = lines.findIndex((l) => /^(เรื่อง|เรียน|อ้างถึง|สิ่งที่ส่งมาด้วย)/.test(l));
  if (cut < 0) cut = Math.min(lines.length, 4);
  const headLines = lines.slice(0, Math.min(cut, 12)); const head = headLines.join('\n');
  const out = { docNo: '', docDate: '', subject: '', party: '', salut: '', refs: '', encl: '', urgency: 'normal', secrecy: 'normal', due: '', dueDays: 0, found: {}, repaired: rep.fixed, checks: [], suspect: false };
  const tag = (k, ok) => { if (ok) out.found[k] = true; };

  let m = /(?:^|\s)ที่?\s*([ก-ฮ]{1,5}\s?\d[\d.]*\s?\/\s?(?:ว\s?\.?\s?|พิเศษ\s?)?\d+(?:-\d+)?)/.exec(text) || /(?:^|\s)ที่?\s*([ก-ฮ]{1,5}\s?\d[\d.]*\s?\/\s?[ก-ฮ]?\d*)/.exec(text);   // ที่ ชม 0033.002/ว1190 · ที่ อว78.06/ว.20419 · ที่ สธ 0123/พิเศษ 9
  if (m) out.docNo = m[1].replace(/\s*\/\s*/g, '/').replace(/\s+/g, ' ').trim();
  if (!out.docNo) {   // OCR often drops the small "ที่" at the line start: accept a bare book number in the letterhead
    m = /(?:^|\s)([ก-ฮ]{2,4}\s?\d{3,5}(?:\.\d+)*\s?\/\s?(?:ว\s?\.?\s?|พิเศษ\s?)?\d+(?:-\d+)?)/.exec(head);
    if (m) out.docNo = m[1].replace(/\s*\/\s*/g, '/').replace(/\s+/g, ' ').trim();
  }
  tag('docNo', !!out.docNo);

  const noRefs = text.replace(/(?:อ้างถึง|สิ่งที่ส่งมาด้วย)[\s\S]*?(?=\n\s*(?:ด้วย|ตามที่|เนื่องจาก|เรียน)|\n\s*\n|$)/g, ' ');   // dates quoted from other letters are not this letter's date
  let d = parseThaiDate(head);
  if (!d) { m = /ลงวันที่\s*([^\n]{4,40})/.exec(noRefs); d = m ? parseThaiDate(m[1]) : ''; }
  if (!d) d = parseThaiDate(noRefs.slice(0, 2500));
  if (!d) { d = inferDocDate(head, today); if (d) out.checks.push('วันที่หนังสือ: OCR อ่านปี/ตัวเลขไม่ชัด — ประมาณจากวัน-เดือนที่อ่านได้และวันนี้ ตรวจกับต้นฉบับ'); }
  out.docDate = d; tag('docDate', !!d);

  m = /เรื่อง\s+([\s\S]+?)(?=\n\s*(?:เรียน|อ้างถึง|สิ่งที่ส่งมาด้วย|ด้วย|ตามที่|เนื่องจาก)|\n\s*\n|$)/.exec(text);
  if (m) out.subject = m[1].replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (out.subject) { const c = stripOcrNoise(out.subject); if (c.cut) { out.subject = c.text.replace(/\s+/g, ' ').trim(); out.suspect = true; out.checks.push('เรื่อง: ตัดตัวอักษรขยะจาก OCR ออก — ตรวจกับต้นฉบับ'); } }
  const ref = findAttachmentHeader(text);   // the attachment page prints this letter's number / date / subject again, with clean digits
  if (ref && (!out.subject || sameSubject(out.subject, ref.subject))) {
    if (!out.docNo || out.docNo.replace(/\s/g, '') !== ref.docNo.replace(/\s/g, '')) { if (out.docNo) out.checks.push(`เลขที่หน้าแรกอ่านได้ “${out.docNo}” — ใช้ “${ref.docNo}” ตามหน้าบัญชีแนบท้าย`); out.docNo = ref.docNo; out.suspect = true; tag('docNo', true); }
    if (out.docDate !== ref.docDate) { if (out.docDate) out.checks.push('วันที่หน้าแรกไม่ตรงกับหน้าบัญชีแนบท้าย — ใช้ค่าจากหน้าบัญชีแนบท้าย'); out.docDate = ref.docDate; tag('docDate', true); }
    if (out.subject) { const dropped = dropStrays(out.subject, ref.subject); if (dropped !== out.subject) { out.subject = dropped; out.checks.push('เรื่อง: ตัดคำขยะที่ไม่มีในหน้าบัญชีแนบท้ายออก — ตรวจทาน'); } }
    if (out.subject) { const fixed = digitsFromRef(out.subject, ref.subject); if (fixed !== out.subject) { out.subject = fixed; out.checks.push('เรื่อง: ตัวเลขแก้ตามหน้าบัญชีแนบท้าย — ตรวจทาน'); } } else { out.subject = ref.subject.slice(0, 300); out.checks.push('เรื่องอ่านจากหน้าบัญชีแนบท้าย (วรรณยุกต์อาจขาด) — ตรวจทาน'); }
  }
  if (out.subject) { const y = repairYears(out.subject, out.docDate || today); if (y !== out.subject) { out.subject = y; out.suspect = true; out.checks.push('เรื่อง: แก้ปีที่ OCR อ่านผิดให้ตรงกับวันที่หนังสือ — ตรวจทาน'); } }
  tag('subject', !!out.subject);

  m = /(?:^|\n)\s*เรียน\s+([^\n]+)/.exec(text); if (m) out.salut = m[1].trim().slice(0, 160); tag('salut', !!out.salut);
  m = /อ้างถึง\s+([\s\S]+?)(?=\n\s*(?:สิ่งที่ส่งมาด้วย|ด้วย|ตามที่|เนื่องจาก|เรียน)|\n\s*\n|$)/.exec(text); if (m) out.refs = m[1].replace(/\s*\n\s*/g, ' ').trim().slice(0, 400); tag('refs', !!out.refs);
  m = /สิ่งที่ส่งมาด้วย\s+([\s\S]+?)(?=\n\s*(?:ด้วย|ตามที่|เนื่องจาก|เรียน|อ้างถึง)|\n\s*\n|$)/.exec(text); if (m) out.encl = m[1].replace(/\s*\n\s*/g, ' ').trim().slice(0, 400); tag('encl', !!out.encl);

  const top = head;
  if (/ด่วนที่สุด/.test(top)) out.urgency = 'most'; else if (/ด่วนมาก/.test(top)) out.urgency = 'very'; else if (/(?:^|[\s(])ด่วน(?:$|[\s)])/m.test(top)) out.urgency = 'urgent';
  const st = readStamps(headLines); const RK = ['normal', 'urgent', 'very', 'most'];
  if (RK.indexOf(st.urgency) > RK.indexOf(out.urgency)) out.urgency = st.urgency;
  tag('urgency', out.urgency !== 'normal');
  out.secrecy = st.secrecy;
  tag('secrecy', out.secrecy !== 'normal');

  out.due = findDue(text, out.docDate, today, out.checks); tag('due', !!out.due);
  if (!out.due) { m = /ภายใน\s*(\d{1,3})\s*วัน/.exec(text); if (m && Number(m[1]) <= 365) { out.dueDays = Number(m[1]); tag('due', true); } }

  out.party = lines.slice(0, 12).map(orgFromLine).find(Boolean) || ''; tag('party', !!out.party);
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

/* ------------------------------ v1.15: reading + attaching the letter's file ------------------------------ */

/** Only the first pages of a letter are read: เลขที่ · ลงวันที่ · เรื่อง · เรียน are all on page 1 (a long letter has 20+ pages — reading them all only costs minutes). */
export const READ_MAX_PAGES = 3;
/** Files kept with one letter (the backend keeps 12 per letter; two places are left for the receive stamp copy and one later attachment). */
export const ATT_MAX = 10;
/** Biggest file the backend stores (SAR_FILE_MAX = 10 MB); the page aims a little below it so base64 + headers still fit. */
export const ATT_LIMIT = 10 * 1024 * 1024;
export const ATT_TARGET = Math.floor(9.5 * 1024 * 1024);

/** 'pdf' | 'image' | 'office' | '' (not storable). Mirrors what the backend accepts (sarMagicOk): PDF, JPG/PNG/WebP, docx/xlsx/pptx. */
export function attachKind(f) {
  const n = String((f && f.name) || '').toLowerCase(); const t = String((f && f.type) || '').toLowerCase();
  if (!f || !(f.size > 0)) return '';
  if (/\.pdf$/.test(n) || t === 'application/pdf') return 'pdf';
  if (/\.(jpe?g|png|webp)$/.test(n) || /^image\/(jpeg|png|webp)$/.test(t)) return 'image';
  if (/\.(docx|xlsx|pptx)$/.test(n)) return 'office';
  return '';
}
/**
 * Sort what the clerk dropped: ONE letter file is read (a PDF, or several photos = its pages), everything is attached.
 *   a PDF present → the first PDF is the letter; other PDFs / photos / Office files are extra attachments
 *   photos only   → the photos are the pages of one letter (Office files are extras)
 *   neither       → nothing to read; the files are attached and the clerk types the data
 * @returns {{main: any[]|null, extras: any[], rejected: any[]}}
 */
export function splitDrop(files) {
  const pdfs = [], imgs = [], offs = [], rejected = [];
  [...(files || [])].filter(Boolean).forEach((f) => { const k = attachKind(f); if (k === 'pdf') pdfs.push(f); else if (k === 'image') imgs.push(f); else if (k === 'office') offs.push(f); else rejected.push(f); });
  if (pdfs.length) return { main: [pdfs[0]], extras: [...pdfs.slice(1), ...imgs, ...offs], rejected };
  if (imgs.length) return { main: imgs, extras: offs, rejected };
  return { main: null, extras: offs, rejected };
}
/** Enough read to stop OCR early: เลขที่ + เรื่อง + เรียน are all found (they sit on page 1, so pages 2–3 are only read when page 1 fell short). */
export function readEnough(text) {
  try { const r = parseLetter(text); return !!(r.found.subject && r.found.docNo && r.found.salut && !r.suspect); } catch { return false; }
}

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
/** ตรารับหลายฉบับในไฟล์เดียว (เลือกหลายรายการในทะเบียน) — หนึ่งตราต่อหนึ่งหน้า A5 เรียงตามเลขรับ */
export function buildReceiptsHtml({ org, docs }) {
  const list = (docs || []).slice().sort((a, c) => (a.year - c.year) || (a.no - c.no));
  const box = (doc) => { const at = String(doc.at || ''); const t = /[ T](\d{2}):(\d{2})/.exec(at); return `<div class="box"><b>${escHtml(org)}</b><br>เลขรับ ${escHtml(doc.reg)}<br>วันที่ ${escHtml(thaiDate(at.slice(0, 10)))}${t ? `<br>เวลา ${t[1]}.${t[2]} น.` : ''}</div>`; };
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>ตรารับ ${list.length} ฉบับ</title><style>@page{size:A5 landscape;margin:10mm}body{font:16px/1.7 "TH Sarabun New","Sarabun",Tahoma,sans-serif;margin:0}.box{width:9cm;border:2px solid #000;padding:.5cm;margin:1cm auto;text-align:center;break-after:page;page-break-after:always}.box:last-child{break-after:auto;page-break-after:auto}.box b{font-size:20px}</style></head><body>${list.map(box).join('')}</body></html>`;
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
