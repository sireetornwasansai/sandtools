/*! sar-ocr-post.js — โพสต์โปรเซสผล OCR หนังสือราชการ สำหรับหน้า "รับหนังสือ" (sandtools / สารบรรณ)
 *  ไม่มี dependency เป็น ES module (import { extract, reconcile, hintsFromFileName } from './sar-ocr-post.js')
 *
 *  ใช้งาน:
 *    var ex = SarOcrPost.extract(ocrTextOfPage1);                    // แยกฟิลด์จากข้อความ OCR หน้าแรก
 *    var hints = SarOcrPost.hintsFromFileName(file.name);            // เลขที่/วันที่/ความเร่งด่วนจากชื่อไฟล์ (หน้าคิวใช้ r.hints จาก queuefile ได้เลย)
 *    var r = SarOcrPost.reconcile(ex, hints);                        // r.fields = ค่าที่ควรเติมฟอร์ม, r.notes = ข้อความเตือนให้เจ้าหน้าที่ตรวจ
 */
const SarOcrPost = (function () {

  var MONTHS = [['มกราคม', 'ม[\\s.]*ค'], ['กุมภาพันธ์', 'ก[\\s.]*พ'], ['มีนาคม', 'มี[\\s.]*ค'], ['เมษายน', 'เม[\\s.]*ย'], ['พฤษภาคม', 'พ[\\s.]*ค'], ['มิถุนายน', 'มิ[\\s.]*ย'],
    ['กรกฎาคม', 'ก[\\s.]*ค'], ['สิงหาคม', 'ส[\\s.]*ค'], ['กันยายน', 'ก[\\s.]*ย'], ['ตุลาคม', 'ต[\\s.]*ค'], ['พฤศจิกายน', 'พ[\\s.]*ย'], ['ธันวาคม', 'ธ[\\s.]*ค']];
  var RANK = { '': 0, normal: 0, urgent: 1, very: 2, most: 3 };
  var ORG_RE = /(สำนักงาน|สำนัก|กรม|กอง|กระทรวง|โรงพยาบาล|สถาบัน|ศูนย์|องค์การ|เทศบาล|มหาวิทยาลัย|วิทยาลัย|ที่ว่าการ|กลุ่มงาน|ฝ่าย|โรงเรียน|บริษัท|สมาคม|มูลนิธิ|ราชวิทยาลัย|คณะ)\S[^\n]*/;
  var BODY_STOP = /^(สิ่งที่ส่งมาด้วย|ตาม|ด้วย|เนื่องจาก|อนุสนธิ|ขอ|จึง)/;

  function digits(s) { return String(s == null ? '' : s).replace(/[๐-๙]/g, function (c) { return String(c.charCodeAt(0) - 0x0E50); }); }
  function clean(s) { return String(s == null ? '' : s).replace(/[\u200b\u200c\u200d\ufeff]/g, '').replace(/[ \t\u00a0]+/g, ' ').trim(); }
  function lines(text) { return digits(text).split(/\r?\n/).map(clean).filter(Boolean); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function norm(s) { return digits(s).toLowerCase().replace(/[\s\u200b"'“”‘’()\[\]{}:;,!?]+/g, ''); }

  /** ปี พ.ศ./ค.ศ./2 หลัก → ค.ศ. หรือ 0 ถ้าไม่สมเหตุสมผล (เช่น 25020 ที่ OCR อ่านเกิน) */
  function yearCE(y) {
    var s = String(y), n = Number(s);
    if (s.length === 2) n += 2500;
    if (s.length > 4 || !(n > 0)) return 0;
    if (n > 2400) n -= 543;
    return n >= 1990 && n <= 2100 ? n : 0;
  }
  function iso(y, m, d) {
    var yy = yearCE(y); m = Number(m); d = Number(d);
    if (!yy || m < 1 || m > 12 || d < 1 || d > 31) return '';
    var dt = new Date(Date.UTC(yy, m - 1, d));
    return dt.getUTCMonth() === m - 1 ? yy + '-' + pad(m) + '-' + pad(d) : '';
  }

  /** วันที่แรกที่พบในข้อความ (ชื่อเดือนเต็ม/ย่อ, ไทย/ค.ศ.) → {iso, raw, index, badYear} หรือ null */
  function parseDate(text) {
    var t = digits(text), best = null;
    MONTHS.forEach(function (mo, i) {
      var re = new RegExp('(\\d{1,2})[\\s.]*(?:' + mo[0] + '|' + mo[1] + ')\\.?[\\s.]*(?:พ\\.?ศ\\.?|ค\\.?ศ\\.?)?[\\s.]*(\\d{2,5})(?!\\d)'), m = re.exec(t);
      if (m && (!best || m.index < best.index)) { var v = iso(m[2], i + 1, m[1]); best = { iso: v, raw: m[0], index: m.index, badYear: !v && !yearCE(m[2]) }; }
    });
    return best;
  }

  /** เลขที่หนังสือ → รูปแบบเดียวกับ Inbox.gs: "สธ 0208.02/ว10440" ('' ถ้าไม่พบ) */
  function parseDocNo(text) {
    var t = digits(text), m = /([ก-ฮ]{2,4})\s*(\d{3,5}(?:\.\d+)*)\s*\/\s*(ว\s*(?:\(ล\))?)?\s*(\d{1,6})(?!\d)/.exec(t);
    var w = m && m[3] ? m[3].replace(/\s+/g, '') : '';
    if (!m) {                                                           // ไม่มี "/" (ชื่อไฟล์): ต้องมี "ว" คั่น และเลขย่อยอาจคั่นด้วยช่องว่างแทน "." (0208_02)
      m = /([ก-ฮ]{2,4})\s*(\d{3,5}(?:[.\s]\d{1,2})*)\s+(ว\s*(?:\(ล\))?)\s*(\d{1,6})(?!\d)/.exec(t);
      if (m) { w = m[3].replace(/\s+/g, ''); m[2] = m[2].replace(/\s+/g, '.'); } else w = '';
    }
    return m ? { raw: m[0], text: m[1] + ' ' + m[2] + '/' + w + m[4] } : null;
  }

  function urgencyOf(s) { s = String(s || '').replace(/\s+/g, ''); return /^ด่วนที่สุด/.test(s) ? 'most' : /^ด่วนมาก/.test(s) ? 'very' : /^ด่วน(?!ที่|มาก)/.test(s) ? 'urgent' : ''; }
  /** ตราด่วนอยู่บรรทัดบนสุดก่อนเลขที่/เรื่อง และขึ้นต้นบรรทัด — ข้อความ "ด่วนที่สุด" ในข้อ อ้างถึง ไม่นับ */
  function detectUrgency(ls) {
    for (var i = 0; i < Math.min(ls.length, 8); i++) { if (/^(เรื่อง|เรียน|อ้างถึง)/.test(ls[i])) break; var u = urgencyOf(ls[i]); if (u) return u; }
    return '';
  }

  function extract(text) {
    var ls = lines(text), out = { docNo: '', docDate: '', subject: '', party: '', salut: '', refs: '', encl: '', urgency: '' }, i;
    var rIdx = ls.findIndex(function (l) { return /^เรื่อง/.test(l); }), head = ls.slice(0, rIdx >= 0 ? rIdx : 15);
    out.urgency = detectUrgency(ls);
    head.some(function (l) { var d = parseDocNo(l); if (d && /ที่|^[ก-ฮ]/.test(l)) { out.docNo = d.text; return true; } return false; });
    if (!out.docNo) { var d0 = parseDocNo(head.join('\n')); if (d0) out.docNo = d0.text; }
    head.some(function (l) { var d = parseDate(l); if (d && d.iso) { out.docDate = d.iso; return true; } return false; });
    head.some(function (l) {                                              // หน่วยงานเจ้าของหนังสือ (ข้างตราครุฑ) — ตัดเลขที่ที่ OCR อ่านติดบรรทัดเดียวกันออก
      var dn = parseDocNo(l), l2 = dn ? l.replace(dn.raw, ' ') : l;
      if (/\d{5}/.test(l2) || /^(ถนน|ถ\.|ตำบล|แขวง|โทร)/.test(l2)) return false;      // บรรทัดที่อยู่/รหัสไปรษณีย์ไม่ใช่ชื่อหน่วยงาน
      var m = ORG_RE.exec(l2); if (m) { out.party = clean(m[0]); return true; } return false;
    });
    if (rIdx >= 0) {
      var s = [ls[rIdx].replace(/^เรื่อง\s*:?\s*/, '')];
      for (i = rIdx + 1; i < ls.length && !/^(เรียน|อ้างถึง|สิ่งที่ส่งมาด้วย)/.test(ls[i]) && s.length < 4; i++) s.push(ls[i]);
      out.subject = clean(s.join(' '));
    }
    var sIdx = ls.findIndex(function (l) { return /^เรียน/.test(l); });
    if (sIdx >= 0) out.salut = clean(ls[sIdx].replace(/^เรียน\s*:?\s*/, ''));
    var aIdx = ls.findIndex(function (l) { return /^อ้างถึง/.test(l); });
    if (aIdx >= 0) {
      var r = [ls[aIdx].replace(/^อ้างถึง\s*:?\s*/, '')];
      for (i = aIdx + 1; i < ls.length && r.length < 8; i++) { if (BODY_STOP.test(ls[i]) && !/^\d+[.)]/.test(ls[i])) break; r.push(ls[i]); }
      out.refs = r.map(function (x) { return x.replace(/^(\d+)[.)]?\s*/, '$1. '); }).join('\n').trim();
    }
    var eIdx = ls.findIndex(function (l) { return /^สิ่งที่ส่งมาด้วย/.test(l); });
    if (eIdx >= 0) {
      var e = [ls[eIdx].replace(/^สิ่งที่ส่งมาด้วย\s*:?\s*/, '')];
      if (ls[eIdx + 1] && /^จำนวน/.test(ls[eIdx + 1])) e.push(ls[eIdx + 1]);
      out.encl = clean(e.join(' '));
    }
    return out;
  }

  /** ชื่อไฟล์ → ค่าช่วยตรวจ. รองรับชื่อที่ถูกแทน "." และช่องว่างด้วย "_" และคำนำหน้า dd-HHmmss_ ที่ Inbox.gs เติมให้ */
  function hintsFromFileName(name) {
    var t = digits(String(name || '')).replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/^\d{2}-\d{6}_/, '').replace(/_+/g, ' ');
    var d = parseDate(t), no = parseDocNo(t);
    return { bookNo: no ? no.text : '', bookDate: d && d.iso ? d.iso : '', urgency: (/ด่วนที่สุด/.test(t) ? 'most' : /ด่วนมาก/.test(t) ? 'very' : /(^|[\s\-(])ด่วน($|[\s\-)])/.test(t) ? 'urgent' : '') };
  }

  /** ตรวจ "อ้างถึง": ปีผิดปกติ (เช่น 25020) และวันที่อ้างถึงที่ใหม่กว่าวันที่หนังสือ */
  function checkRefs(refs, docDateISO) {
    var notes = [];
    String(refs || '').split('\n').forEach(function (l, i) {
      var d = parseDate(l); if (!d) return;
      if (!d.iso) notes.push({ field: 'refs', level: 'warn', msg: 'อ้างถึงรายการที่ ' + (i + 1) + ': วันที่ “' + d.raw + '” ผิดปกติ (ปีอ่านไม่ได้) — ตรวจกับต้นฉบับ' });
      else if (docDateISO && d.iso > docDateISO) notes.push({ field: 'refs', level: 'warn', msg: 'อ้างถึงรายการที่ ' + (i + 1) + ': วันที่อ้างถึงใหม่กว่าวันที่หนังสือ — น่าจะอ่านผิด' });
    });
    return notes;
  }

  /** รวมผล OCR กับค่าช่วยตรวจ (ชื่อไฟล์/ข้อความ Telegram). เมื่อขัดกัน ใช้ค่าจากชื่อไฟล์ + เตือนให้ตรวจ (needsReview) */
  function reconcile(fields, hints, opts) {
    var f = {}, notes = [], k; fields = fields || {}; hints = hints || {};
    for (k in fields) if (Object.prototype.hasOwnProperty.call(fields, k)) f[k] = fields[k];
    var o = parseDocNo(f.docNo || ''); if (o) f.docNo = o.text;
    if (hints.bookNo) {
      if (!f.docNo) { f.docNo = hints.bookNo; notes.push({ field: 'docNo', level: 'info', msg: 'OCR อ่านเลขที่หนังสือไม่ได้ — ใช้ค่าจากชื่อไฟล์' }); }
      else if (norm(f.docNo) !== norm(hints.bookNo)) { notes.push({ field: 'docNo', level: 'warn', msg: 'เลขที่ที่ OCR อ่านได้ (' + f.docNo + ') ไม่ตรงกับชื่อไฟล์ (' + hints.bookNo + ') — ใช้ค่าจากชื่อไฟล์ ตรวจกับต้นฉบับอีกครั้ง' }); f.docNo = hints.bookNo; }
    } else if (f.docNo && !o) notes.push({ field: 'docNo', level: 'warn', msg: 'รูปแบบเลขที่หนังสือผิดปกติ — ตรวจกับต้นฉบับ' });
    if (hints.bookDate) {
      if (!f.docDate) { f.docDate = hints.bookDate; notes.push({ field: 'docDate', level: 'info', msg: 'OCR อ่านวันที่หนังสือไม่ได้ — ใช้ค่าจากชื่อไฟล์' }); }
      else if (f.docDate !== hints.bookDate) { notes.push({ field: 'docDate', level: 'warn', msg: 'วันที่ที่ OCR อ่านได้ (' + f.docDate + ') ไม่ตรงกับชื่อไฟล์ (' + hints.bookDate + ') — ใช้ค่าจากชื่อไฟล์' }); f.docDate = hints.bookDate; }
    }
    var cur = f.urgency || '', hu = hints.urgency || '';
    if (RANK[hu] > RANK[cur]) { f.urgency = hu; notes.push({ field: 'urgency', level: 'info', msg: 'ความเร่งด่วนปรับตามชื่อไฟล์/ข้อความที่แนบมา' }); }
    if (f.party && /[ก-ฮ]{2,4}\s*\d{3,5}/.test(digits(f.party))) notes.push({ field: 'party', level: 'warn', msg: 'ช่อง “จาก” มีเลขที่หนังสือปนอยู่ — ตรวจกับตราหัวหนังสือ' });
    if (!f.party) notes.push({ field: 'party', level: 'warn', msg: 'ยังไม่พบหน่วยงานผู้ส่ง (ต้องกรอก)' });
    notes = notes.concat(checkRefs(f.refs, f.docDate));
    return { fields: f, notes: notes, needsReview: notes.some(function (n) { return n.level === 'warn'; }) };
  }

  return { extract: extract, reconcile: reconcile, hintsFromFileName: hintsFromFileName, parseDocNo: parseDocNo, parseDate: parseDate, detectUrgency: detectUrgency, checkRefs: checkRefs, yearCE: yearCE };
})();

export const { extract, reconcile, hintsFromFileName, parseDocNo, parseDate, detectUrgency, checkRefs, yearCE } = SarOcrPost;
export default SarOcrPost;
