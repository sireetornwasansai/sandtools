/**
 * SAND Office Tools — สารบรรณอิเล็กทรอนิกส์ (ลงรับ · ส่งออก · ทะเบียน · เลขทะเบียน · ส่งต่อ/สั่งการ · ติดตาม).  v1.8.0
 *
 * ONE register for the whole organisation. The older page "หนังสือรับเข้า" (Inbox.gs) is now only the INTAKE QUEUE:
 * a letter that clerks accept there (or from the Saraban page) gets its เลขรับ from the SAME counter (this file),
 * so the two pages can never issue the same number.
 *
 *   POST {action:"saraban", session, op: ...}
 *     everyone signed in : config | dash | my | get | ack | assign | done | return        (only what concerns their unit)
 *     clerks (staff)     : queue | reject | dup | upload | receive | send | reserve | cancelno | route | update | note |
 *                          list | rows | track | numbers | parties
 *     admins             : units | unitsave | unitdel   (units list is readable by every signed-in user, without e-mails)
 *
 * Roles (Script properties, comma separated e-mails; admins = ADMIN_EMAILS):
 *   SARABAN_STAFF_EMAILS   เจ้าหน้าที่สารบรรณ (INBOX_STAFF_EMAILS are staff too)
 *   SARABAN_EXEC_EMAILS    ผู้บริหาร: เห็นทุกเรื่องรวมชั้นความลับ, สั่งการ.  (members of a unit of type "exec" count as well)
 *   SARABAN_SECRET_EMAILS  เจ้าหน้าที่ที่ได้รับอนุญาตให้ลงทะเบียน/เห็นหนังสือชั้นความลับ
 * Other properties:  SAR_ORG_NAME · SAR_BOOK_PREFIX (e.g. "สธ 0xxx.xxx") · SAR_HOLIDAYS (yyyy-mm-dd, comma) · SAR_SLA_DAYS ("0,1,3,7")
 *                    SAR_RESERVE_DAYS (7) · SARABAN_FOLDER_ID (optional: Drive folder for files; default <DRIVE_FOLDER_ID>/_saraban)
 * Tabs created by setupSaraban():  Saraban (ทะเบียนรวม รับ+ส่ง) · SarTo (ผู้รับ/สถานะรายหน่วย) · SarTrack (ประวัติ — เพิ่มอย่างเดียว) · SarUnits · SarNo (ตัวนับเลข)
 * Rules kept on purpose: numbers are never reused or deleted (cancel = status "void" + reason) · numbers restart each CALENDAR year (Bangkok time)
 * · all number allocation happens under the script lock · a retried request (same rid) returns the first result instead of a 2nd number
 * · the log (Logs tab) holds ids and numbers only — never subjects or file contents.
 * Uses helpers from Code.gs / Links.gs / Library.gs (and Inbox.gs when present).   Run setupSaraban() once from the editor.
 */

var SAR_TZ = 'Asia/Bangkok';
var SAR_TAB = 'Saraban', SAR_TO = 'SarTo', SAR_EV = 'SarTrack', SAR_UN = 'SarUnits', SAR_CNT = 'SarNo';
var SAR_HEADERS = ['รหัส', 'ประเภท', 'ปี พ.ศ.', 'ลำดับ', 'เลขทะเบียน', 'ทะเบียน', 'สถานะ', 'ลงทะเบียนเมื่อ', 'เลขที่หนังสือ', 'ลงวันที่ (หนังสือ)', 'เรื่อง', 'จาก / ถึง', 'ชั้นความเร็ว', 'ชั้นความลับ', 'กำหนดเสร็จ', 'หมวด', 'ช่องทาง', 'ไฟล์ (Drive)', 'อ้างถึง', 'สิ่งที่ส่งมาด้วย', 'หมายเหตุ', 'การปฏิบัติ', 'ผู้ลงทะเบียน', 'รหัสตรวจสอบ', 'รหัสคิว (Inbox)', 'dedup', 'เหตุผลยกเลิก', 'เรียน', 'รายละเอียดเพิ่มเติม (JSON)', 'แก้ไขล่าสุด'];
var SAR_COLS = 30;
var C = { id: 0, kind: 1, year: 2, no: 3, reg: 4, registry: 5, status: 6, at: 7, docNo: 8, docDate: 9, subject: 10, party: 11, urgency: 12, secrecy: 13, due: 14, cat: 15, channel: 16, files: 17, refs: 18, encl: 19, note: 20, action: 21, by: 22, verify: 23, inbox: 24, dedup: 25, voidWhy: 26, salut: 27, extra: 28, upd: 29 };
var TO_HEADERS = ['รหัสหนังสือ', 'หน่วยงาน', 'การปฏิบัติ', 'สถานะ', 'กำหนด', 'ผู้รับผิดชอบ', 'หมายเหตุ', 'อัปเดตเมื่อ', 'อัปเดตโดย', 'สร้างเมื่อ', 'key'];
var TO_COLS = 11;
var EV_HEADERS = ['เวลา', 'รหัสหนังสือ', 'เหตุการณ์', 'โดย', 'หน่วยงาน', 'ข้อความ', 'รายละเอียด'];
var EV_COLS = 7;
var UN_HEADERS = ['รหัส', 'ชื่อหน่วยงาน', 'ชื่อย่อ', 'ชนิด', 'หัวหน้า (อีเมล)', 'สมาชิก (อีเมล)', 'ผู้รักษาราชการแทน', 'แทนถึงวันที่', 'คำนำหน้าเลขที่หนังสือ', 'ใช้งาน', 'อีเมลหน่วย', 'สังกัด', 'คำค้นแนะนำ', 'มีทะเบียนของตนเอง'];
var UN_COLS = 14;
var CNT_HEADERS = ['key', 'ล่าสุด', 'อัปเดตเมื่อ', 'หมายเหตุ'];

var SAR_SCAN = 9000, SAR_SCAN_TO = 24000, SAR_SCAN_EV = 6000, SAR_LIST_MAX = 100, SAR_ROWS_MAX = 5000;
var SAR_FILE_MAX = 10 * 1024 * 1024;
var SAR_URGENCY = ['normal', 'urgent', 'very', 'most'];                    // ปกติ · ด่วน · ด่วนมาก · ด่วนที่สุด
var SAR_SECRECY = ['normal', 'secret', 'vsecret', 'tsecret'];              // ปกติ · ลับ · ลับมาก · ลับที่สุด
var SAR_CHANNELS = [['esaraban', 'ระบบสารบรรณอิเล็กทรอนิกส์ (e-Saraban)'], ['email', 'อีเมลสารบรรณกลาง'], ['scan', 'สแกนจากเครื่องสแกนส่วนกลาง'], ['post', 'ไปรษณีย์ลงทะเบียน'], ['ems', 'ไปรษณีย์ EMS'], ['hand', 'ส่งด้วยตนเอง'], ['messenger', 'พนักงานนำส่งเอกสาร'], ['fax', 'โทรสาร'], ['telegram', 'กลุ่ม Telegram'], ['other', 'อื่น ๆ']];
var SAR_CATEGORIES = [['1', 'ทั่วไป'], ['2', 'นโยบายและแผน/ยุทธศาสตร์'], ['3', 'งบประมาณ'], ['4', 'การเงินและบัญชี'], ['5', 'พัสดุและจัดซื้อจัดจ้าง'], ['6', 'บริหารงานบุคคล'], ['7', 'บริการทางการแพทย์และการพยาบาล'], ['8', 'สาธารณสุขและควบคุมโรค'],
  ['9', 'พัฒนาบุคลากรและการอบรม'], ['10', 'เทคโนโลยีสารสนเทศ'], ['11', 'กฎหมาย วินัยและคดี'], ['12', 'ตรวจสอบภายใน'], ['13', 'การประชุม'], ['14', 'ความปลอดภัยและภัยพิบัติ'], ['15', 'คุณภาพและมาตรฐาน (HA)'], ['16', 'ประชาสัมพันธ์'], ['17', 'เภสัชกรรมและเวชภัณฑ์'], ['18', 'ร้องเรียนและสิทธิผู้ป่วย']];
var SAR_ROUTE_ACTIONS = ['perform', 'ack'];                                // ให้ดำเนินการ · เพื่อทราบ
var SAR_TO_STATUS = ['pending', 'received', 'assigned', 'done', 'returned'];
var SAR_MASK_SUBJECT = '(หนังสือชั้นความลับ)';

/* ------------------------------ pure helpers (no Google services) ------------------------------ */

function sarDigits(s) { return String(s == null ? '' : s).replace(/[๐-๙]/g, function (c) { return String(c.charCodeAt(0) - 0x0E50); }); }
function sarClean(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').replace(/[ \t]+/g, ' ').trim().slice(0, max || 300); }
function sarOneLine(v, max) { return sarClean(String(v == null ? '' : v).replace(/[\r\n]+/g, ' '), max); }
function sarUn(v) { return String(v == null ? '' : v).replace(/^'(?=[=+\-@])/, ''); }
function sarEnum(v, list, dflt) { v = String(v == null ? '' : v); return list.indexOf(v) >= 0 ? v : dflt; }
function sarEmail(v) { v = String(v == null ? '' : v).trim().toLowerCase(); return /^[^\s@,;<>"']+@[^\s@,;<>"']+\.[^\s@,;<>"']+$/.test(v) && v.length <= 120 ? v : ''; }
function sarEmails(v, max) {
  var arr = Array.isArray(v) ? v : String(v == null ? '' : v).split(/[,\s;]+/), out = [], seen = Object.create(null);
  for (var i = 0; i < arr.length && out.length < (max || 60); i++) { var e = sarEmail(arr[i]); if (e && !seen[e]) { seen[e] = true; out.push(e); } }
  return out;
}
/** Key used to compare letter numbers / names / subjects: lower-case, Arabic digits, no spaces or punctuation (keeps / . -). */
function sarNorm(s) { return sarDigits(s).toLowerCase().replace(/[\s\u200b"'“”‘’()\[\]{}:;,!?]+/g, ''); }
function sarIso(y, mo, d) {
  y = Number(y); mo = Number(mo); d = Number(d);
  if (y > 2400) y -= 543;
  if (!(y >= 1990 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return '';
  var dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1) return '';
  return y + '-' + (mo < 10 ? '0' : '') + mo + '-' + (d < 10 ? '0' : '') + d;
}
/** '' or a valid yyyy-MM-dd (a Buddhist-era year is converted). Throws on anything else. */
function sarDateOk(v, label) {
  v = String(v == null ? '' : v).trim();
  if (!v) return '';
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  var iso = m ? sarIso(m[1], m[2], m[3]) : '';
  if (!iso) throw httpError('BAD_REQUEST', (label || 'วันที่') + 'ไม่ถูกต้อง (รูปแบบ ปปปป-ดด-วว)');
  return iso;
}
function sarDayMs(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN; }
function sarDaysBetween(a, b) { return Math.round((sarDayMs(b) - sarDayMs(a)) / 86400000); }   // b - a, in calendar days
function sarAddDays(iso, n) { var t = sarDayMs(iso) + n * 86400000; return new Date(t).toISOString().slice(0, 10); }
/** Working days (Mon–Fri, minus holidays). n = 0 keeps the same day. */
function sarAddWorkdays(iso, n, holidays) {
  var d = iso, left = Math.max(0, n | 0), guard = 0;
  while (left > 0 && guard++ < 400) {
    d = sarAddDays(d, 1);
    var wd = new Date(sarDayMs(d)).getUTCDay();
    if (wd !== 0 && wd !== 6 && (holidays || []).indexOf(d) < 0) left--;
  }
  return d;
}
/** The date an open letter is due: the date written on it, else the registration day + the SLA of its urgency (working days). */
function sarDueFor(due, urgency, regDay, sla, holidays) {
  if (due) return due;
  var days = sla[SAR_URGENCY.indexOf(urgency)];
  return sarAddWorkdays(regDay, days == null ? 7 : days, holidays);
}
function sarParseSla(txt) {
  var a = String(txt || '').split(/[,\s]+/).map(function (x) { return parseInt(x, 10); });
  var d = [7, 3, 1, 0], out = [];                                          // normal, urgent, very, most
  for (var i = 0; i < 4; i++) out.push(isFinite(a[i]) && a[i] >= 0 && a[i] <= 60 ? a[i] : d[i]);
  return out;
}
function sarYearBE(ms) { return Number(Utilities.formatDate(new Date(ms || Date.now()), SAR_TZ, 'yyyy')) + 543; }
function sarToday(ms) { return Utilities.formatDate(new Date(ms || Date.now()), SAR_TZ, 'yyyy-MM-dd'); }
function sarNowStamp(ms) { return Utilities.formatDate(new Date(ms || Date.now()), SAR_TZ, 'yyyy-MM-dd HH:mm:ss'); }
function sarThaiDate(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  var mon = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  return m ? Number(m[3]) + ' ' + mon[Number(m[2]) - 1] + ' ' + (Number(m[1]) + 543) : '';
}
function sarRegText(no, yearBE) { return no + '/' + yearBE; }
function sarParseReg(text) { var m = /^(\d{1,6})\/(\d{4})$/.exec(String(text || '').trim()); return m ? { no: Number(m[1]), year: Number(m[2]) } : null; }
/** Rows that count as "the same letter": same book number from the same sender, or the same subject from the same sender. */
function sarSameLetter(a, b) {
  var pa = sarNorm(a.party).slice(0, 24), pb = sarNorm(b.party).slice(0, 24);
  var na = sarNorm(a.docNo), nb = sarNorm(b.docNo);
  if (na && nb && na === nb && (!pa || !pb || pa === pb || pa.slice(0, 8) === pb.slice(0, 8))) return true;
  var sa = sarNorm(a.subject), sb = sarNorm(b.subject);
  return !!(sa && sb && sa === sb && pa && pb && pa === pb);
}
function sarSuggestUnits(subject, units) {
  var s = sarNorm(subject), out = [];
  units.forEach(function (u) {
    if (u.type === 'external' || !u.active) return;
    var hits = [];
    String(u.keywords || '').split(/[,\n]+/).forEach(function (k) { k = sarNorm(k); if (k.length >= 2 && s.indexOf(k) >= 0) hits.push(k); });
    if (hits.length) out.push({ unit: u.code, name: u.name, score: hits.length, why: hits.slice(0, 3) });
  });
  return out.sort(function (a, b) { return b.score - a.score; }).slice(0, 4);
}

/* ------------------------------------- sheets + rows ------------------------------------- */

function sarTab(name) {
  var h = name === SAR_TAB ? SAR_HEADERS : name === SAR_TO ? TO_HEADERS : name === SAR_EV ? EV_HEADERS : name === SAR_UN ? UN_HEADERS : CNT_HEADERS;
  return sheetTab(name, h);
}
function sarPut(sh, row, vals) { var rg = sh.getRange(row, 1, 1, vals.length); rg.setNumberFormat('@'); rg.setValues([vals]); }
function sarAppend(sh, vals) { sarPut(sh, sh.getLastRow() + 1, vals); }
function sarLocked(fn) { return lnkLocked(fn); }
function sarLog(email, op, id, extra) {
  try { sheetTab('Logs', LOG_HEADERS).appendRow([new Date(), Utilities.getUuid().slice(0, 8), email, 'saraban', op, 'ok', cell(id, 200), 0, 0, cell(JSON.stringify(extra || {}), 500)]); } catch (x) { console.error('sarLog ' + x); }
}
function sarExtra(s) { try { var o = JSON.parse(String(s || '{}')); return o && typeof o === 'object' ? o : {}; } catch (x) { return {}; } }
function sarObj(r, row) {
  return { row: row, id: String(r[C.id] || ''), kind: String(r[C.kind]) === 'out' ? 'out' : 'in', year: Number(r[C.year]) || 0, no: Number(r[C.no]) || 0, reg: String(r[C.reg] || ''), registry: String(r[C.registry] || 'central'),
    status: String(r[C.status] || 'registered'), at: String(r[C.at] || ''), docNo: sarUn(r[C.docNo]), docDate: String(r[C.docDate] || ''), subject: sarUn(r[C.subject]), party: sarUn(r[C.party]),
    urgency: sarEnum(r[C.urgency], SAR_URGENCY, 'normal'), secrecy: sarEnum(r[C.secrecy], SAR_SECRECY, 'normal'), due: String(r[C.due] || ''), cat: String(r[C.cat] || ''), channel: String(r[C.channel] || ''),
    files: String(r[C.files] || '').split(/\n/).filter(Boolean), refs: sarUn(r[C.refs]), encl: sarUn(r[C.encl]), note: sarUn(r[C.note]), action: sarUn(r[C.action]), by: String(r[C.by] || ''), verify: String(r[C.verify] || ''),
    inbox: String(r[C.inbox] || ''), dedup: String(r[C.dedup] || ''), voidWhy: sarUn(r[C.voidWhy]), salut: sarUn(r[C.salut]), extra: sarExtra(r[C.extra]), upd: String(r[C.upd] || '') };
}
function sarRow(o) {
  return [o.id, o.kind, o.year, o.no, o.reg, o.registry, o.status, o.at, cell(o.docNo, 80), o.docDate, cell(o.subject, 300), cell(o.party, 160), o.urgency, o.secrecy, o.due, o.cat, o.channel, o.files.join('\n'), cell(o.refs, 400), cell(o.encl, 400),
    cell(o.note, 500), cell(o.action, 300), o.by, o.verify, o.inbox, o.dedup, cell(o.voidWhy, 300), cell(o.salut, 160), JSON.stringify(o.extra || {}).slice(0, 20000), o.upd];
}
/** The newest SAR_SCAN rows (all columns). */
function sarAll(sh) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  var from = Math.max(2, last - SAR_SCAN + 1);
  return sh.getRange(from, 1, last - from + 1, SAR_COLS).getValues().map(function (r, i) { return sarObj(r, from + i); }).filter(function (o) { return o.id; });
}
function sarFind(sh, id) {
  id = String(id || '');
  var last = sh.getLastRow();
  if (last < 2 || !/^s[a-z0-9]{6,12}$/.test(id)) throw httpError('NOT_FOUND', 'ไม่พบหนังสือนี้');
  var from = Math.max(2, last - SAR_SCAN + 1), ids = sh.getRange(from, 1, last - from + 1, 1).getValues();
  for (var i = ids.length - 1; i >= 0; i--) if (String(ids[i][0]) === id) return sarObj(sh.getRange(from + i, 1, 1, SAR_COLS).getValues()[0], from + i);
  throw httpError('NOT_FOUND', 'ไม่พบหนังสือนี้');
}
function sarNewId(taken) {
  for (var n = 0; n < 12; n++) {
    var c = 's'; for (var i = 0; i < 8; i++) c += LNK_ALPHABET.charAt(Math.floor(Math.random() * LNK_ALPHABET.length));
    if (!taken || !taken[c]) return c;
  }
  throw httpError('INTERNAL_RETRY', 'สร้างรหัสไม่สำเร็จ กรุณาลองใหม่');
}
function sarVerify(id) {
  var h = hmac('sar:' + id).replace(/[^A-Za-z0-9]/g, '').toUpperCase().replace(/[01OIL]/g, '');
  return (h.slice(0, 4) + '-' + h.slice(4, 8));
}
function sarToObj(r, row) {
  return { row: row, docId: String(r[0]), unit: String(r[1]), action: sarEnum(r[2], SAR_ROUTE_ACTIONS, 'perform'), status: sarEnum(r[3], SAR_TO_STATUS, 'pending'), due: String(r[4] || ''), people: sarEmails(String(r[5] || '')), note: sarUn(r[6]), upd: String(r[7] || ''), by: String(r[8] || ''), created: String(r[9] || '') };
}
function sarToRow(t) { return [t.docId, t.unit, t.action, t.status, t.due, t.people.join(','), cell(t.note, 400), t.upd, t.by, t.created, t.docId + '|' + t.unit]; }
function sarToAll(sc) {
  if (sc.memo.tos) return sc.memo.tos;
  var sh = sarTab(SAR_TO), last = sh.getLastRow(), by = Object.create(null), list = [];
  if (last >= 2) {
    var from = Math.max(2, last - SAR_SCAN_TO + 1);
    sh.getRange(from, 1, last - from + 1, TO_COLS).getValues().forEach(function (r, i) { if (r[0]) { var t = sarToObj(r, from + i); list.push(t); (by[t.docId] = by[t.docId] || []).push(t); } });
  }
  return (sc.memo.tos = { list: list, by: by });
}
function sarEvent(docId, type, by, unit, text, meta) {
  sarAppend(sarTab(SAR_EV), [sarNowStamp(), docId, type, by, unit || '', cell(text, 600), meta ? JSON.stringify(meta).slice(0, 1500) : '']);
}

/* ------------------------------------- units + roles ------------------------------------- */

function sarUnitObj(r, row) {
  return { row: row, code: String(r[0] || ''), name: sarUn(r[1]), short: sarUn(r[2]), type: sarEnum(r[3], ['internal', 'exec', 'external'], 'internal'), head: sarEmail(r[4]), members: sarEmails(String(r[5] || '')), delegate: sarEmail(r[6]),
    delegateUntil: String(r[7] || ''), prefix: sarUn(r[8]), active: String(r[9]) !== '0', email: sarEmail(r[10]), parent: String(r[11] || ''), keywords: sarUn(r[12]), registry: String(r[13]) === '1' };
}
function sarUnitRow(u) { return [u.code, cell(u.name, 120), cell(u.short, 30), u.type, u.head, u.members.join(','), u.delegate, u.delegateUntil, cell(u.prefix, 60), u.active ? '1' : '0', u.email, u.parent, cell(u.keywords, 300), u.registry ? '1' : '0']; }
function sarUnits(sc) {
  if (sc.memo.units) return sc.memo.units;
  var sh = sarTab(SAR_UN), last = sh.getLastRow(), list = [];
  if (last >= 2) sh.getRange(2, 1, last - 1, UN_COLS).getValues().forEach(function (r, i) { if (r[0]) list.push(sarUnitObj(r, i + 2)); });
  return (sc.memo.units = list);
}
function sarUnitBy(sc, code) { var l = sarUnits(sc); for (var i = 0; i < l.length; i++) if (l[i].code === code) return l[i]; return null; }
function sarDelegateActive(u, today) { return !!(u.delegate && u.delegateUntil && u.delegateUntil >= today); }
/** Head, members and the acting delegate (while the delegation lasts). */
function sarPeople(u, today) {
  var out = [];
  if (u.head) out.push(u.head);
  u.members.forEach(function (m) { out.push(m); });
  if (sarDelegateActive(u, today)) out.push(u.delegate);
  return out.filter(function (x, i) { return out.indexOf(x) === i; });
}
function sarHeads(u, today) { var o = []; if (u.head) o.push(u.head); if (sarDelegateActive(u, today)) o.push(u.delegate); return o; }
function sarScope(u) {
  var sc = lnkScope(u); sc.memo = {}; sc.today = sarToday();
  var email = u.email, units = sarUnits(sc);
  sc.units = []; sc.headUnits = []; sc.execUnit = false;
  units.forEach(function (x) {
    if (!x.active) return;
    if (sarPeople(x, sc.today).indexOf(email) >= 0) { sc.units.push(x.code); if (x.type === 'exec') sc.execUnit = true; }
    if (sarHeads(x, sc.today).indexOf(email) >= 0) sc.headUnits.push(x.code);
  });
  sc.exec = sc.admin || sc.execUnit || listProp('SARABAN_EXEC_EMAILS').indexOf(email) >= 0;
  sc.staff = sc.admin || listProp('SARABAN_STAFF_EMAILS').indexOf(email) >= 0 || listProp('INBOX_STAFF_EMAILS').indexOf(email) >= 0;
  sc.clear = sc.exec || listProp('SARABAN_SECRET_EMAILS').indexOf(email) >= 0;
  sc.holidays = listProp('SAR_HOLIDAYS'); sc.sla = sarParseSla(prop('SAR_SLA_DAYS'));
  return sc;
}
function sarNeedStaff(sc) { if (!sc.staff) throw httpError('FORBIDDEN', 'เฉพาะเจ้าหน้าที่สารบรรณและผู้ดูแลระบบ'); }
function sarNeedAdmin(sc) { if (!sc.admin) throw httpError('FORBIDDEN', 'เฉพาะผู้ดูแลระบบ'); }
function sarOrg() { return prop('SAR_ORG_NAME') || 'หน่วยงาน'; }
function sarReserveDays() { return intProp('SAR_RESERVE_DAYS', 7); }

/** What this person may see of a letter: 'full' | 'masked' | 'none'. Secret letters: clearance, the registrar, the heads of the units it went to, or a named assignee. */
function sarAccess(sc, o, tos) {
  if (sc.admin || sc.exec) return 'full';
  var mine = false, head = false, named = false;
  (tos || []).forEach(function (t) {
    if (sc.units.indexOf(t.unit) >= 0) mine = true;
    if (sc.headUnits.indexOf(t.unit) >= 0) head = true;
    if (t.people.indexOf(sc.email) >= 0) named = true;
  });
  if (o.secrecy === 'normal') return (sc.staff || mine || named) ? 'full' : 'none';
  if (sc.clear || o.by === sc.email || head || named) return 'full';
  return (sc.staff || mine) ? 'masked' : 'none';
}
function sarStage(o, tos) {
  if (o.status === 'void') return 'void';
  if (o.kind === 'out') return o.status === 'reserved' ? 'reserved' : 'sent';
  if (!tos || !tos.length) return 'registered';
  var open = 0, prog = 0, ret = 0, done = 0;
  tos.forEach(function (t) { if (t.status === 'pending') open++; else if (t.status === 'received' || t.status === 'assigned') prog++; else if (t.status === 'returned') ret++; else done++; });
  if (open) return 'routed';
  if (prog) return 'inprogress';
  if (ret) return 'returned';                       // someone sent it back: the clerk must route it again
  return 'done';
}
function sarOverdueDays(sc, o, stage, tos) {
  if (o.kind !== 'in' || stage === 'done' || stage === 'void') return 0;
  var due = sarDueFor(o.due, o.urgency, String(o.at).slice(0, 10), sc.sla, sc.holidays);
  (tos || []).forEach(function (t) { if (t.due && t.status !== 'done' && t.due < due) due = t.due; });
  var d = sarDaysBetween(due, sc.today);
  return d > 0 ? d : 0;
}
/** One letter as the page needs it (masked when the caller may not read it). */
function sarPublic(sc, o, tos, access) {
  var stage = sarStage(o, tos), full = access === 'full';
  var pub = { id: o.id, kind: o.kind, reg: o.reg, year: o.year, no: o.no, registry: o.registry, status: o.status, stage: stage, at: o.at, docNo: o.docNo, docDate: o.docDate, urgency: o.urgency, secrecy: o.secrecy,
    due: o.due, cat: o.cat, channel: o.channel, masked: !full, overdue: sarOverdueDays(sc, o, stage, tos), voidWhy: full ? o.voidWhy : '' };
  pub.subject = full ? o.subject : SAR_MASK_SUBJECT; pub.party = full ? o.party : ''; pub.action = full ? o.action : ''; pub.note = full ? o.note : ''; pub.by = o.by;
  pub.units = (tos || []).map(function (t) { return { unit: t.unit, status: t.status, action: t.action }; });
  return pub;
}

/* ------------------------------------- numbering (always under the script lock) ------------------------------------- */

/** Highest number already used (void numbers included — a number is never reused) and the set of used numbers. */
function sarScanNos_(kind, registry, yearBE, sub) {
  var sh = sarTab(SAR_TAB), last = sh.getLastRow(), max = 0, set = Object.create(null);
  function see(n) { if (n > 0) { set[n] = true; if (n > max) max = n; } }
  if (last >= 2) {
    var from = Math.max(2, last - SAR_SCAN + 1);
    sh.getRange(from, 2, last - from + 1, 8).getValues().forEach(function (r) {       // kind, year, no, reg, registry, status, at, docNo
      if (String(r[0]) !== kind || Number(r[1]) !== yearBE || String(r[4] || 'central') !== registry) return;
      if (sub === 'v') { var m = /(?:^|\/)\s*ว\s*(\d+)\s*$/.exec(sarDigits(sarUn(r[7]))); if (m) see(Number(m[1])); } else see(Number(r[2]) || 0);
    });
  }
  if (kind === 'in' && registry === 'central' && !sub && typeof inbAll === 'function') {   // letters accepted on the older Inbox page before this register existed
    try { inbAll(inbSheet()).forEach(function (o) { var p = o.status === 'accepted' ? sarParseReg(o.regNo) : null; if (p && p.year === yearBE) see(p.no); }); } catch (x) { console.error('sarScanNos inbox'); }
  }
  return { max: max, set: set };
}
/** Next number (or the number the clerk typed). The counter row only guards against a lost tail; the register itself is the truth. */
function sarAlloc_(kind, registry, yearBE, sub, manual) {
  var sh = sarTab(SAR_CNT), last = sh.getLastRow(), key = kind + ':' + registry + ':' + yearBE + (sub ? ':' + sub : ''), row = 0, cur = 0;
  if (last >= 2) sh.getRange(2, 1, last - 1, 2).getValues().forEach(function (r, i) { if (String(r[0]) === key) { row = i + 2; cur = Number(r[1]) || 0; } });
  var scan = sarScanNos_(kind, registry, yearBE, sub), base = Math.max(cur, scan.max), no, jumped = false;
  if (manual !== undefined && manual !== null && String(manual).trim() !== '') {
    var mm = sarParseReg(String(manual).indexOf('/') > 0 ? manual : manual + '/' + yearBE);
    if (!mm || mm.no < 1) throw httpError('BAD_REQUEST', 'เลขต้องเป็นตัวเลข เช่น 150 หรือ 150/' + yearBE);
    if (mm.year !== yearBE) throw httpError('BAD_REQUEST', 'เลขที่ระบุต้องเป็นของปี พ.ศ. ' + yearBE);
    if (scan.set[mm.no]) throw httpError('DUPLICATE', 'เลข ' + mm.no + '/' + yearBE + ' ถูกใช้แล้ว (เลขที่ยกเลิกแล้วก็ใช้ซ้ำไม่ได้)');
    no = mm.no; jumped = no > base + 1;
  } else no = base + 1;
  if (no > 999999) throw httpError('BAD_REQUEST', 'เลขเกินขอบเขต');
  var vals = [key, Math.max(base, no), sarNowStamp(), ''];
  if (row) sarPut(sh, row, vals); else sarAppend(sh, vals);
  return { no: no, jumped: jumped };
}

/* ------------------------------------- input validation ------------------------------------- */

function sarFields(b, kind) {
  var catKeys = SAR_CATEGORIES.map(function (x) { return x[0]; }), chKeys = SAR_CHANNELS.map(function (x) { return x[0]; });
  var f = { docNo: sarOneLine(b.docNo, 80), docDate: sarDateOk(b.docDate, 'วันที่หนังสือ'), subject: sarOneLine(b.subject, 300), party: sarOneLine(b.party, 160),
    urgency: sarEnum(b.urgency, SAR_URGENCY, 'normal'), secrecy: sarEnum(b.secrecy, SAR_SECRECY, 'normal'), due: sarDateOk(b.due, 'กำหนดเสร็จ'), cat: sarEnum(String(b.cat || ''), catKeys, ''),
    channel: sarEnum(b.channel, chKeys, kind === 'in' ? 'esaraban' : 'hand'), salut: sarOneLine(b.salut, 160), refs: sarClean(b.refs, 400), encl: sarClean(b.encl, 400), note: sarClean(b.note, 500), deliverer: sarOneLine(b.deliverer, 80) };
  if (!f.subject) throw httpError('BAD_REQUEST', 'กรุณาระบุเรื่อง');
  if (f.docDate && f.due && f.due < f.docDate) throw httpError('BAD_REQUEST', 'กำหนดเสร็จต้องไม่เร็วกว่าวันที่หนังสือ');
  return f;
}
function sarWarnings(f, today) {
  var w = [];
  if (f.docDate && sarDaysBetween(today, f.docDate) > 1) w.push('วันที่หนังสือเป็นวันในอนาคต — ตรวจสอบว่าไม่ได้กรอกปีผิด');
  if (f.docDate && sarDaysBetween(f.docDate, today) > 180) w.push('วันที่หนังสือเก่ากว่า 6 เดือน — ตรวจสอบวันที่อีกครั้ง');
  if (f.due && f.due < today) w.push('กำหนดเสร็จผ่านมาแล้ว');
  return w;
}
function sarRid(v) { v = String(v == null ? '' : v); return /^[A-Za-z0-9-]{8,40}$/.test(v) ? v : ''; }
function sarRegistryOk(sc, code) {
  code = String(code || 'central');
  if (code === 'central') return code;
  var u = sarUnitBy(sc, code);
  if (!u || !u.active || !u.registry) throw httpError('BAD_REQUEST', 'ไม่พบทะเบียนที่เลือก');
  return code;
}
function sarRegistryName(sc, code) { var u = code === 'central' ? null : sarUnitBy(sc, code); return u ? u.name : 'สารบรรณกลาง'; }
/** Routing request → [{unit, action, due}] (validated), or [] for "register only". */
function sarRouteIn(sc, route, f) {
  route = route && typeof route === 'object' ? route : {};
  var mode = sarEnum(route.mode, ['none', 'exec', 'units'], 'none'), out = [], units = sarUnits(sc);
  if (mode === 'exec') {
    units.forEach(function (u) { if (u.type === 'exec' && u.active) out.push({ unit: u.code, action: 'perform', due: f.due || '' }); });
    if (!out.length) throw httpError('NOT_CONFIGURED', 'ยังไม่ได้ตั้งหน่วยงานชนิด “ผู้บริหาร” ในหน้าตั้งค่าหน่วยงาน');
    out = out.slice(0, 1);
  } else if (mode === 'units') {
    var seen = Object.create(null);
    (Array.isArray(route.units) ? route.units : []).slice(0, 30).forEach(function (x) {
      var code = String(x && x.unit || ''), u = sarUnitBy(sc, code);
      if (!u || !u.active || u.type === 'external') throw httpError('BAD_REQUEST', 'ไม่พบหน่วยงานปลายทาง: ' + sarClean(code, 20));
      if (seen[code]) return; seen[code] = true;
      out.push({ unit: code, action: sarEnum(x.action, SAR_ROUTE_ACTIONS, 'perform'), due: sarDateOk(x.due, 'กำหนดของ ' + u.short) });
    });
    if (!out.length) throw httpError('BAD_REQUEST', 'กรุณาเลือกหน่วยงานที่จะส่งต่อ');
  }
  out.forEach(function (t) { t.text = sarClean(route.text, 400); });
  return out;
}
function sarPartiesIn(list) {
  var out = [];
  (Array.isArray(list) ? list : []).slice(0, 30).forEach(function (p) {
    if (!p || typeof p !== 'object') return;
    var name = sarOneLine(p.name, 160); if (!name) return;
    var ch = sarEnum(p.channel, SAR_CHANNELS.map(function (x) { return x[0]; }), 'esaraban'), email = sarEmail(p.email);
    if (ch === 'email' && !email) throw httpError('BAD_REQUEST', 'ผู้รับ “' + name + '” ส่งทางอีเมล แต่ยังไม่ได้กรอกอีเมลที่ถูกต้อง');
    out.push({ name: name, unit: sarClean(p.unit, 20), channel: ch, email: email, trackingNo: sarOneLine(p.trackingNo, 40), receivedBy: sarOneLine(p.receivedBy, 80) });
  });
  if (!out.length) throw httpError('BAD_REQUEST', 'กรุณาระบุผู้รับอย่างน้อย 1 ราย');
  return out;
}

/* ------------------------------------- Drive (files) ------------------------------------- */

function sarFileId(url) { var m = /\/d\/([-\w]{10,})/.exec(String(url || '')); return m ? m[1] : ''; }
function sarStaffEmails() { return listProp('ADMIN_EMAILS').concat(listProp('SARABAN_STAFF_EMAILS'), listProp('INBOX_STAFF_EMAILS'), listProp('SARABAN_EXEC_EMAILS')).filter(function (x, i, a) { return a.indexOf(x) === i; }); }
function sarMagicOk(b) {
  function at(i) { return (b[i] || 0) & 255; }
  if (at(0) === 0x25 && at(1) === 0x50 && at(2) === 0x44 && at(3) === 0x46) return 'application/pdf';
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'image/png';
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
  if (at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 && at(8) === 0x57 && at(9) === 0x45) return 'image/webp';
  if (at(0) === 0x50 && at(1) === 0x4b && at(2) === 0x03 && at(3) === 0x04) return 'application/zip';   // docx / xlsx / pptx
  return '';
}
function sarFolder(yearBE, kind) {
  var rootId = prop('SARABAN_FOLDER_ID'), root;
  if (rootId) root = DriveApp.getFolderById(rootId);
  else { if (!prop('DRIVE_FOLDER_ID')) throw httpError('NOT_CONFIGURED', 'ยังไม่ได้ตั้งค่า DRIVE_FOLDER_ID'); root = subFolder(DriveApp.getFolderById(prop('DRIVE_FOLDER_ID')), '_saraban'); }
  return subFolder(subFolder(root, String(yearBE)), kind === 'out' ? 'ส่ง' : 'รับ');
}
function sarSave(kind, name, bytes, mime, email) {
  var yr = sarYearBE(), file = sarFolder(yr, kind).createFile(Utilities.newBlob(bytes, mime, sarNowStamp().slice(8, 10) + '-' + sarNowStamp().slice(11).replace(/:/g, '') + '_' + name));
  try { file.setDescription('sar:' + email); } catch (x) { /* optional */ }
  return { id: file.getId(), url: file.getUrl(), name: file.getName() };
}
function sarFileInfo(id) {
  try { var f = DriveApp.getFileById(id); return { id: id, url: f.getUrl(), name: f.getName(), desc: String(f.getDescription() || '') }; } catch (x) { return null; }
}
function sarGrant(fileId, emails) {
  (emails || []).slice(0, 40).forEach(function (e) {
    try {
      if (typeof Drive !== 'undefined' && Drive.Permissions && Drive.Permissions.create) Drive.Permissions.create({ role: 'reader', type: 'user', emailAddress: e }, fileId, { sendNotificationEmail: false, supportsAllDrives: true });
      else DriveApp.getFileById(fileId).addViewer(e);
    } catch (x) { try { DriveApp.getFileById(fileId).addViewer(e); } catch (y) { /* owner / already has access */ } }
  });
}
function sarRunGrants(r) {
  var g = r && r._grants; if (!g) return r;
  delete r._grants;
  g.forEach(function (x) { var id = sarFileId(x.url); if (id) sarGrant(id, x.emails); });
  return r;
}
/** Files a clerk wants to attach: only files THIS page uploaded for that user (marked in the Drive description) — never an arbitrary Drive id. */
function sarFilesOk(sc, list) {
  var out = [];
  (Array.isArray(list) ? list : []).slice(0, 10).forEach(function (x) {
    var id = String(x && x.id || ''); if (!/^[-\w]{10,100}$/.test(id)) throw httpError('BAD_REQUEST', 'รหัสไฟล์ไม่ถูกต้อง');
    var info = sarFileInfo(id);
    if (!info || (info.desc !== 'sar:' + sc.email && !sc.admin && info.desc.indexOf('sar:') !== 0)) throw httpError('FORBIDDEN', 'ไฟล์แนบไม่ได้มาจากหน้าสารบรรณ');
    out.push({ id: id, url: info.url, name: info.name });
  });
  return out;
}
function sarUpload(sc, b) {
  sarNeedStaff(sc);
  rateLimit('sarupload', intProp('SARABAN_UPLOAD_PER_MIN', 40));
  if (typeof b.data !== 'string' || !b.data) throw httpError('BAD_REQUEST', 'ไม่พบข้อมูลไฟล์');
  var bytes = Utilities.base64Decode(b.data);
  if (bytes.length > SAR_FILE_MAX) throw httpError('FILE_TOO_LARGE', 'ไฟล์ใหญ่เกิน 10 MB');
  var mime = sarMagicOk(bytes);
  if (!mime) throw httpError('BAD_FILE', 'รองรับเฉพาะ PDF รูปภาพ (JPG/PNG/WebP) และไฟล์ Office (docx/xlsx/pptx)');
  var name = String(b.name || 'file').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '').slice(0, 120) || 'file';
  var kind = b.kind === 'out' ? 'out' : 'in', file = sarSave(kind, name, bytes, mime, sc.email);
  var res = { file: { id: file.id, url: file.url, name: file.name, size: bytes.length } }, grants = [{ url: file.url, emails: sarStaffEmails() }];
  if (b.docId) {                                                  // attach to a registered letter (e.g. the copy carrying the receive stamp)
    var r = sarLocked(function () {
      var sh = sarTab(SAR_TAB), o = sarFind(sh, b.docId), tos = sarToAll(sc).by[o.id] || [];
      if (sarAccess(sc, o, tos) !== 'full') throw httpError('FORBIDDEN', 'ไม่มีสิทธิ์แนบไฟล์กับหนังสือนี้');
      if (o.status === 'void') throw httpError('LOCKED', 'หนังสือนี้ยกเลิกเลขแล้ว');
      if (o.files.length >= 12) throw httpError('BAD_REQUEST', 'แนบไฟล์ได้ไม่เกิน 12 ไฟล์ต่อหนังสือ');
      o.files.push(file.url); o.upd = sarNowStamp(); sarPut(sh, o.row, sarRow(o));
      sarEvent(o.id, 'attach', sc.email, '', String(b.label || 'แนบไฟล์').slice(0, 60), { name: file.name });
      return o;
    });
    res.attached = r.id;
  }
  res._grants = grants;
  sarLog(sc.email, 'upload', file.id, { size: bytes.length });
  return sarRunGrants(res);
}

/* ------------------------------------- receive (ลงรับ) ------------------------------------- */

function sarDupFind(rows, f, exceptId, inboxRows) {
  var out = [], probe = { docNo: f.docNo, subject: f.subject, party: f.party };
  rows.forEach(function (o) { if (o.kind === 'in' && o.status !== 'void' && sarSameLetter(probe, o) && o.id !== exceptId) out.push({ type: 'doc', id: o.id, reg: o.reg, docNo: o.docNo, subject: o.subject, party: o.party, at: o.at, secrecy: o.secrecy }); });
  (inboxRows || []).forEach(function (q) {
    if (q.status !== 'pending' || q.id === exceptId) return;
    if (sarSameLetter(probe, { docNo: q.bookNo, subject: q.subject, party: q.from })) out.push({ type: 'queue', id: q.id, reg: '', docNo: q.bookNo, subject: q.subject, party: q.from, at: q.received, secrecy: 'normal' });
  });
  return out.slice(0, 8);
}
function sarInboxRows() { try { return typeof inbAll === 'function' ? inbAll(inbSheet()) : []; } catch (x) { return []; } }
function sarDupPublic(sc, d) { return d.secrecy !== 'normal' && !sc.clear ? { type: d.type, id: d.id, reg: d.reg, docNo: d.docNo, subject: SAR_MASK_SUBJECT, party: '', at: d.at } : { type: d.type, id: d.id, reg: d.reg, docNo: d.docNo, subject: d.subject, party: d.party, at: d.at }; }

/**
 * The one place a received letter gets its number. The CALLER holds the script lock.
 * Returns {doc, jumped, warnings} or {dups:[…]} (nothing written) or {doc, replay:true} when the same rid was already stored.
 */
function sarRegisterIn_(sc, f, opt) {
  opt = opt || {};
  if (!f.party) throw httpError('BAD_REQUEST', 'กรุณาระบุผู้ส่ง (จาก)');
  if (f.secrecy !== 'normal' && !sc.clear) throw httpError('FORBIDDEN', 'หนังสือชั้นความลับต้องลงทะเบียนโดยเจ้าหน้าที่ที่ได้รับอนุญาต (SARABAN_SECRET_EMAILS) หรือผู้บริหาร');
  var registry = sarRegistryOk(sc, opt.registry), sh = sarTab(SAR_TAB), rows = sarAll(sh), rid = sarRid(opt.rid), i;
  if (rid) for (i = rows.length - 1; i >= 0; i--) if (rows[i].dedup.indexOf('r:' + rid) >= 0) return { doc: rows[i], replay: true, warnings: [] };
  if (!opt.dupOk) { var dups = sarDupFind(rows, f, opt.inboxId, sarInboxRows()); if (dups.length) return { dups: dups }; }
  var ms = Date.now(), yr = sarYearBE(ms), al = sarAlloc_('in', registry, yr, '', opt.no), taken = Object.create(null);
  rows.forEach(function (r) { taken[r.id] = true; });
  var id = sarNewId(taken), at = sarNowStamp(ms);
  var o = { row: 0, id: id, kind: 'in', year: yr, no: al.no, reg: sarRegText(al.no, yr), registry: registry, status: 'registered', at: at, docNo: f.docNo, docDate: f.docDate, subject: f.subject, party: f.party, urgency: f.urgency, secrecy: f.secrecy,
    due: f.due, cat: f.cat, channel: f.channel, files: (opt.files || []).map(function (x) { return x.url; }), refs: f.refs, encl: f.encl, note: f.note, action: '', by: sc.email, verify: sarVerify(id), inbox: String(opt.inboxId || ''), dedup: rid ? 'r:' + rid : '',
    voidWhy: '', salut: f.salut, extra: { deliverer: f.deliverer, links: opt.links || [] }, upd: at };
  o.row = sh.getLastRow() + 1; sarPut(sh, o.row, sarRow(o));
  sarEvent(id, 'receive', sc.email, '', 'ลงรับ ' + o.reg, { registry: registry, dupOk: !!opt.dupOk, jumped: al.jumped, via: opt.inboxId ? 'queue' : 'manual' });
  sarLog(sc.email, 'receive', o.reg, { id: id, registry: registry });
  return { doc: o, jumped: al.jumped, warnings: sarWarnings(f, sc.today) };
}
/** Called by Inbox.gs (script lock already held): the page "หนังสือรับเข้า" now takes its numbers from this register. */
function sarRegisterFromInbox(sc, q, b) {
  var sc2 = sarScope({ email: sc.email });
  var f = { docNo: sarOneLine(q.bookNo, 80), docDate: q.bookDate || '', subject: sarOneLine(q.subject, 300), party: sarOneLine(q.from, 160), urgency: /ด่วนที่สุด/.test(q.subject) ? 'most' : 'normal', secrecy: 'normal', due: '', cat: '', channel: 'telegram', salut: '', refs: '', encl: '', note: sarClean(q.note, 500), deliverer: '' };
  if (!f.party) f.party = 'กลุ่ม Telegram';
  var files = q.file ? [{ url: q.file }] : [];
  var r = sarRegisterIn_(sc2, f, { no: b && b.no, inboxId: q.id, files: files, links: q.urls, dupOk: false });
  if (r.dups) { var d = r.dups[0]; throw httpError('DUPLICATE', 'พบหนังสือซ้ำกับที่ลงรับแล้ว' + (d.reg ? ' (เลขรับ ' + d.reg + ')' : ' (รออยู่ในคิว)') + ' — ถ้าเป็นฉบับเดียวกันให้กด “ไม่นำเข้า”'); }
  q.regNo = r.doc.reg; q.regDate = sarToday(); q.status = 'accepted';
  return r.doc;
}
function sarInboxPending_(id) {
  if (typeof inbAll !== 'function') throw httpError('NOT_FOUND', 'ไม่พบคิวหนังสือรับเข้า');
  var all = inbAll(inbSheet()), q = null;
  all.forEach(function (x) { if (x.id === String(id) && x.status !== 'deleted') q = x; });
  if (!q) throw httpError('NOT_FOUND', 'ไม่พบหนังสือในคิว');
  if (q.status === 'accepted') throw httpError('ALREADY', 'หนังสือนี้ถูกลงรับแล้ว (เลขรับ ' + (q.regNo || '-') + ')' + (q.by ? ' โดย ' + q.by : ''));
  if (q.status === 'ignored') throw httpError('ALREADY', 'หนังสือนี้ถูกย้ายไป “ไม่นำเข้า” แล้ว — นำกลับมาที่หน้าหนังสือรับเข้าก่อน');
  return q;
}
function sarInboxMark_(q, doc, email) { q.regNo = doc.reg; q.regDate = sarToday(); q.status = 'accepted'; q.by = email; inbPut(inbSheet(), q.row, inbRowOf(q)); }

/** Add / reopen the recipient rows (lock held). Returns the units that became pending. */
function sarApplyRoute_(sc, o, route, byEmail, evType) {
  var sh = sarTab(SAR_TO), last = sh.getLastRow(), rows = {}, now = sarNowStamp(), done = [];
  if (last >= 2) sh.getRange(2, 1, last - 1, TO_COLS).getValues().forEach(function (r, i) { if (String(r[0]) === o.id) rows[String(r[1])] = { t: sarToObj(r, i + 2) }; });
  route.forEach(function (x) {
    var ex = rows[x.unit];
    if (ex && (ex.t.status === 'pending' || ex.t.status === 'received' || ex.t.status === 'assigned')) { if (x.due && !ex.t.due) { ex.t.due = x.due; ex.t.upd = now; sarPut(sh, ex.t.row, sarToRow(ex.t)); } return; }
    var t = ex ? ex.t : { row: 0, docId: o.id, unit: x.unit, people: [], created: now };
    t.action = x.action; t.status = 'pending'; t.due = x.due || ''; t.note = x.text || ''; t.upd = now; t.by = byEmail;
    if (t.row) sarPut(sh, t.row, sarToRow(t)); else sarAppend(sh, sarToRow(t));
    sarEvent(o.id, evType || 'route', byEmail, x.unit, x.text || '', { action: x.action, due: x.due || '', reopened: !!ex });
    done.push(x.unit);
  });
  sc.memo.tos = null;
  return done;
}
function sarGrantsFor(sc, o, unitCodes) {
  var emails = [];
  unitCodes.forEach(function (c) { var u = sarUnitBy(sc, c); if (u) (o.secrecy === 'normal' ? sarPeople(u, sc.today) : sarHeads(u, sc.today)).forEach(function (e) { if (emails.indexOf(e) < 0) emails.push(e); }); });
  return emails.length ? o.files.map(function (url) { return { url: url, emails: emails }; }) : [];
}
function sarReceipt(sc, r, route, routed) {
  var o = r.doc, ms = Date.now(), pub = sarPublic(sc, o, [], 'full');
  return { doc: pub, replay: !!r.replay, jumped: !!r.jumped, warnings: r.warnings || [], verify: o.verify, routed: routed || [],
    stamp: { reg: o.reg, date: sarThaiDate(String(o.at).slice(0, 10)), time: String(o.at).slice(11, 16).replace(':', '.') + ' น.', org: sarOrg(), registry: sarRegistryName(sc, o.registry) },
    suggest: sarSuggestUnits(o.subject, sarUnits(sc)) };
}
function sarReceive(sc, b) {
  sarNeedStaff(sc);
  var f = sarFields(b, 'in'), route = sarRouteIn(sc, b.route, f), files = sarFilesOk(sc, b.files), grants = [];
  var res = sarLocked(function () {
    var q = b.inboxId ? sarInboxPending_(b.inboxId) : null;
    var all = files.slice(); if (q && q.file && !all.some(function (x) { return x.url === q.file; })) all.push({ id: sarFileId(q.file), url: q.file, name: '' });
    var r = sarRegisterIn_(sc, f, { no: b.no, dupOk: b.dupOk === true, rid: b.rid, registry: b.registry, inboxId: q ? q.id : '', files: all, links: q ? q.urls : [] });
    if (r.dups) return { needsConfirm: true, dups: r.dups.map(function (d) { return sarDupPublic(sc, d); }) };
    var routed = [];
    if (!r.replay) {
      if (q) sarInboxMark_(q, r.doc, sc.email);
      if (route.length) { try { routed = sarApplyRoute_(sc, r.doc, route, sc.email, 'route'); grants = sarGrantsFor(sc, r.doc, routed); } catch (x) { r.warnings.push('ลงรับแล้ว แต่ส่งต่อไม่สำเร็จ — เปิดหนังสือแล้วกด “ส่งต่อ” อีกครั้ง'); console.error('sarApplyRoute ' + x); } }
    }
    var out = sarReceipt(sc, r, route.length ? routed : [], routed);
    out._grants = grants;
    return out;
  });
  return sarRunGrants(res);
}
/** Not accepted into the register: the queue item goes to "ไม่นำเข้า" with the reason in its note. */
function sarReject(sc, b) {
  sarNeedStaff(sc);
  var why = sarClean(b.reason, 200);
  if (why.length < 5) throw httpError('BAD_REQUEST', 'กรุณาระบุเหตุผล (อย่างน้อย 5 ตัวอักษร)');
  return sarLocked(function () {
    var q = sarInboxPending_(b.id);
    q.status = 'ignored'; q.by = sc.email; q.note = ('ส่งคืน/ไม่ลงรับ: ' + why).slice(0, 300);
    inbPut(inbSheet(), q.row, inbRowOf(q));
    sarLog(sc.email, 'reject', q.id, {});
    return { ok: true };
  });
}

/* ------------------------------------- send (ส่งออก) · reserve · cancel ------------------------------------- */

function sarBookNo(sc, registry, bookType, no, m) {
  var u = registry === 'central' ? null : sarUnitBy(sc, registry), prefix = sarOneLine((u && u.prefix) || prop('SAR_BOOK_PREFIX'), 60);
  var tail = bookType === 'circular' ? 'ว' + m : String(no);
  return prefix ? prefix + '/' + tail : tail;
}
function sarSend(sc, b) {
  sarNeedStaff(sc);
  if (!b.docDate) b.docDate = sc.today;
  var f = sarFields(b, 'out'), parties = sarPartiesIn(b.parties), files = sarFilesOk(sc, b.files), bookType = sarEnum(b.bookType, ['normal', 'circular'], 'normal');
  if (f.secrecy !== 'normal' && !sc.clear) throw httpError('FORBIDDEN', 'หนังสือชั้นความลับต้องออกเลขโดยเจ้าหน้าที่ที่ได้รับอนุญาต');
  f.party = parties.map(function (p) { return p.name; }).join(', ').slice(0, 160);
  var res = sarLocked(function () {
    var registry = sarRegistryOk(sc, b.registry), sh = sarTab(SAR_TAB), rows = sarAll(sh), rid = sarRid(b.rid), i;
    if (rid) for (i = rows.length - 1; i >= 0; i--) if (rows[i].dedup.indexOf('r:' + rid) >= 0) return { doc: sarPublic(sc, rows[i], [], 'full'), docNo: rows[i].docNo, verify: rows[i].verify, replay: true, warnings: [], stamp: { reg: rows[i].reg, date: sarThaiDate(sc.today), org: sarOrg(), registry: sarRegistryName(sc, rows[i].registry) } };
    var key = 'o:' + sarNorm(f.subject).slice(0, 60) + '|' + parties.map(function (p) { return sarNorm(p.name).slice(0, 20) + p.channel; }).sort().join(';');
    var nowMs = Date.now();
    rows.forEach(function (o) { if (o.kind === 'out' && o.status === 'sent' && o.dedup.indexOf(key) >= 0 && nowMs - Date.parse(o.at.replace(' ', 'T') + '+07:00') < 600000 && o.id !== b.reservedId) throw httpError('DUPLICATE_SEND', 'หนังสือเรื่องเดียวกันถึงผู้รับและช่องทางเดิมถูกส่งไปแล้วภายใน 10 นาที (เลขส่ง ' + o.reg + ')'); });
    var o = null, yr = sarYearBE(nowMs);
    if (b.reservedId) {
      o = sarFind(sh, b.reservedId);
      if (o.kind !== 'out' || o.status !== 'reserved') throw httpError('BAD_REQUEST', 'เลขนี้ไม่ได้อยู่ในสถานะจอง');
      if (o.by !== sc.email && !sc.admin) throw httpError('FORBIDDEN', 'เลขที่จองไว้เป็นของ ' + o.by);
    } else {
      var al = sarAlloc_('out', registry, yr, '', ''), m = bookType === 'circular' ? sarAlloc_('out', registry, yr, 'v', '').no : 0, taken = Object.create(null);
      rows.forEach(function (r) { taken[r.id] = true; });
      var id = sarNewId(taken);
      o = { row: sh.getLastRow() + 1, id: id, kind: 'out', year: yr, no: al.no, reg: sarRegText(al.no, yr), registry: registry, status: 'sent', at: sarNowStamp(nowMs), docNo: sarBookNo(sc, registry, bookType, al.no, m), docDate: '', subject: '', party: '', urgency: 'normal', secrecy: 'normal',
        due: '', cat: '', channel: '', files: [], refs: '', encl: '', note: '', action: '', by: sc.email, verify: sarVerify(id), inbox: '', dedup: '', voidWhy: '', salut: '', extra: { bookType: bookType }, upd: '' };
    }
    o.status = 'sent'; o.docDate = f.docDate; o.subject = f.subject; o.party = f.party; o.urgency = f.urgency; o.secrecy = f.secrecy; o.due = f.due; o.cat = f.cat; o.channel = parties[0].channel;
    o.refs = f.refs; o.encl = f.encl; o.note = f.note; o.salut = f.salut; o.files = o.files.concat(files.map(function (x) { return x.url; }));
    o.dedup = (rid ? 'r:' + rid + ' ' : '') + key; o.upd = sarNowStamp(nowMs); o.extra.parties = parties;
    var replyTo = null;
    if (b.replyTo) { try { replyTo = sarFind(sh, b.replyTo); } catch (x) { replyTo = null; } if (replyTo && replyTo.kind === 'in') o.extra.replyTo = replyTo.id; else replyTo = null; }
    sarPut(sh, o.row, sarRow(o));
    sarEvent(o.id, 'send', sc.email, '', 'ออกหนังสือ ' + o.docNo, { parties: parties.length, reserved: !!b.reservedId });
    if (replyTo) {
      if (!replyTo.action) replyTo.action = ('ตอบแล้ว ' + o.docNo + ' (ส่ง ' + o.reg + ')').slice(0, 300);
      replyTo.upd = sarNowStamp(nowMs); sarPut(sh, replyTo.row, sarRow(replyTo));
      sarEvent(replyTo.id, 'reply', sc.email, '', 'ตอบกลับด้วยหนังสือ ' + o.docNo, { out: o.id });
    }
    sarLog(sc.email, 'send', o.reg, { id: o.id, parties: parties.length });
    return { doc: sarPublic(sc, o, [], 'full'), docNo: o.docNo, replay: false, warnings: sarWarnings(f, sc.today), verify: o.verify,
      stamp: { reg: o.reg, date: sarThaiDate(sc.today), org: sarOrg(), registry: sarRegistryName(sc, registry) }, _grants: files.map(function (x) { return { url: x.url, emails: sarStaffEmails() }; }) };
  });
  return sarRunGrants(res);
}
function sarReserve(sc, b) {
  sarNeedStaff(sc);
  var purpose = sarOneLine(b.purpose, 200), bookType = sarEnum(b.bookType, ['normal', 'circular'], 'normal');
  if (purpose.length < 3) throw httpError('BAD_REQUEST', 'กรุณาระบุว่าจองเลขเพื่อเรื่องอะไร');
  return sarLocked(function () {
    var registry = sarRegistryOk(sc, b.registry), sh = sarTab(SAR_TAB), rows = sarAll(sh), rid = sarRid(b.rid), i, yr = sarYearBE();
    if (rid) for (i = rows.length - 1; i >= 0; i--) if (rows[i].dedup.indexOf('r:' + rid) >= 0) return { doc: sarPublic(sc, rows[i], [], 'full'), docNo: rows[i].docNo, replay: true };
    var al = sarAlloc_('out', registry, yr, '', ''), m = bookType === 'circular' ? sarAlloc_('out', registry, yr, 'v', '').no : 0, taken = Object.create(null);
    rows.forEach(function (r) { taken[r.id] = true; });
    var id = sarNewId(taken), at = sarNowStamp();
    var o = { row: sh.getLastRow() + 1, id: id, kind: 'out', year: yr, no: al.no, reg: sarRegText(al.no, yr), registry: registry, status: 'reserved', at: at, docNo: sarBookNo(sc, registry, bookType, al.no, m), docDate: '', subject: purpose, party: '', urgency: 'normal', secrecy: 'normal',
      due: '', cat: '', channel: '', files: [], refs: '', encl: '', note: '', action: '', by: sc.email, verify: sarVerify(id), inbox: '', dedup: rid ? 'r:' + rid : '', voidWhy: '', salut: '', extra: { bookType: bookType, reservedFor: purpose }, upd: at };
    sarPut(sh, o.row, sarRow(o));
    sarEvent(id, 'reserve', sc.email, '', 'จองเลข ' + o.reg + ' — ' + purpose, { docNo: o.docNo });
    sarLog(sc.email, 'reserve', o.reg, { id: id });
    return { doc: sarPublic(sc, o, [], 'full'), docNo: o.docNo, replay: false };
  });
}
/** A number is never deleted: it becomes "void" with a reason, and stays in the register. */
function sarCancel(sc, b) {
  sarNeedStaff(sc);
  var why = sarClean(b.reason, 300);
  if (why.length < 5) throw httpError('BAD_REQUEST', 'กรุณาระบุเหตุผลการยกเลิกเลข (อย่างน้อย 5 ตัวอักษร)');
  return sarLocked(function () {
    var sh = sarTab(SAR_TAB), o = sarFind(sh, b.id);
    if (o.status === 'void') throw httpError('LOCKED', 'เลขนี้ยกเลิกไปแล้ว');
    sc.memo.tos = null; var tos = sarToAll(sc).by[o.id] || [], stage = sarStage(o, tos);
    if ((stage === 'inprogress' || stage === 'done') && !sc.admin) throw httpError('FORBIDDEN', 'หนังสือนี้มีการดำเนินการแล้ว — ให้ผู้ดูแลระบบเป็นผู้ยกเลิก');
    if (o.secrecy !== 'normal' && !sc.clear) throw httpError('FORBIDDEN', 'ไม่มีสิทธิ์ยกเลิกหนังสือชั้นความลับ');
    o.status = 'void'; o.voidWhy = why; o.upd = sarNowStamp(); sarPut(sh, o.row, sarRow(o));
    sarEvent(o.id, 'void', sc.email, '', 'ยกเลิกเลข ' + o.reg + ': ' + why, { stage: stage });
    sarLog(sc.email, 'cancelno', o.reg, { id: o.id });
    return { doc: sarPublic(sc, o, tos, 'full') };
  });
}

/* ------------------------------------- routing (ส่งต่อ · สั่งการ · ดำเนินการ) ------------------------------------- */

function sarLoadDoc(sc, id, needFull) {
  var sh = sarTab(SAR_TAB), o = sarFind(sh, id), tos = sarToAll(sc).by[o.id] || [], acc = sarAccess(sc, o, tos);
  if (acc === 'none' || (needFull && acc !== 'full')) throw httpError('FORBIDDEN', 'ไม่มีสิทธิ์ใช้งานหนังสือฉบับนี้');
  if (o.status === 'void') throw httpError('LOCKED', 'หนังสือนี้ยกเลิกเลขแล้ว');
  return { sh: sh, o: o, tos: tos };
}
function sarRoute(sc, b) {
  var kind = b.kind === 'command' ? 'command' : 'forward';
  var res = sarLocked(function () {
    sc.memo.tos = null;
    var d = sarLoadDoc(sc, b.id, true), o = d.o;
    if (o.kind !== 'in') throw httpError('BAD_REQUEST', 'ส่งต่อได้เฉพาะหนังสือรับ');
    var mine = d.tos.some(function (t) { return sc.units.indexOf(t.unit) >= 0; });
    if (!(sc.staff || sc.exec || mine)) throw httpError('FORBIDDEN', 'ไม่มีสิทธิ์ส่งต่อหนังสือฉบับนี้');
    if (kind === 'command' && !sc.exec) throw httpError('FORBIDDEN', 'เฉพาะผู้บริหารที่สั่งการได้');
    var text = sarClean(b.text, 400);
    if (kind === 'command' && !text) throw httpError('BAD_REQUEST', 'กรุณาระบุข้อสั่งการ');
    var route = sarRouteIn(sc, { mode: 'units', units: b.toUnits, text: text }, { due: o.due });
    var routed = sarApplyRoute_(sc, o, route, sc.email, kind);
    sarCloseReturned_(sc, o, routed);
    if (kind === 'command') { sarEvent(o.id, 'order', sc.email, '', text, { units: routed }); o.action = ('สั่งการ: ' + text).slice(0, 300); o.upd = sarNowStamp(); sarPut(d.sh, o.row, sarRow(o)); }
    sarLog(sc.email, kind, o.reg, { id: o.id, units: routed.length });
    return { routed: routed, _grants: sarGrantsFor(sc, o, routed) };
  });
  return sarRunGrants(res);
}
/** After a letter that was sent back is routed again, the old "returned" rows are closed (the history stays in SarTrack). */
function sarCloseReturned_(sc, o, routed) {
  var sh = sarTab(SAR_TO), last = sh.getLastRow();
  if (last < 2) return;
  sh.getRange(2, 1, last - 1, TO_COLS).getValues().forEach(function (r, i) {
    if (String(r[0]) !== o.id || sarEnum(r[3], SAR_TO_STATUS, '') !== 'returned' || routed.indexOf(String(r[1])) >= 0) return;
    var t = sarToObj(r, i + 2); t.status = 'done'; t.note = ((t.note ? t.note + ' · ' : '') + 'ส่งคืนแล้ว — ส่งต่อใหม่').slice(0, 400); t.upd = sarNowStamp(); sarPut(sh, t.row, sarToRow(t));
  });
  sc.memo.tos = null;
}
function sarMyTo(sc, o, tos, unit) {
  var t = null; tos.forEach(function (x) { if (x.unit === unit) t = x; });
  if (!t) throw httpError('NOT_FOUND', 'หนังสือนี้ไม่ได้ส่งถึงหน่วยงานนี้');
  return t;
}
function sarUnitAction(sc, b, kind) {
  return sarLocked(function () {
    sc.memo.tos = null;
    var d = sarLoadDoc(sc, b.id, false), unit = String(b.unit || ''), t = sarMyTo(sc, d.o, d.tos, unit), u = sarUnitBy(sc, unit);
    var isPerson = u && sarPeople(u, sc.today).indexOf(sc.email) >= 0, isHead = u && sarHeads(u, sc.today).indexOf(sc.email) >= 0, named = t.people.indexOf(sc.email) >= 0;
    var now = sarNowStamp(), tsh = sarTab(SAR_TO), text = sarClean(b.note || b.reason, 400);
    if (kind === 'ack') {
      if (!isPerson && !sc.admin) throw httpError('FORBIDDEN', 'เฉพาะบุคลากรของหน่วยงานนี้');
      if (t.status !== 'pending') throw httpError('LOCKED', 'หน่วยงานนี้รับหนังสือไปแล้ว');
      t.status = 'received';
    } else if (kind === 'assign') {
      if (!isHead && !sc.admin) throw httpError('FORBIDDEN', 'เฉพาะหัวหน้าหน่วยงาน/ผู้รักษาราชการแทนที่มอบหมายงานได้');
      var allowed = sarPeople(u, sc.today), people = sarEmails(b.users, 20);
      if (!people.length) throw httpError('BAD_REQUEST', 'กรุณาเลือกผู้รับผิดชอบ');
      people.forEach(function (e) { if (allowed.indexOf(e) < 0) throw httpError('BAD_REQUEST', e + ' ไม่ได้อยู่ในหน่วยงานนี้'); });
      if (t.status === 'done' || t.status === 'returned') throw httpError('LOCKED', 'งานนี้ปิดไปแล้ว');
      t.people = people; t.status = 'assigned'; t.action = sarEnum(b.action, SAR_ROUTE_ACTIONS, t.action); if (b.due) t.due = sarDateOk(b.due, 'กำหนด');
    } else if (kind === 'done') {
      if (!isPerson && !named && !sc.admin) throw httpError('FORBIDDEN', 'เฉพาะบุคลากรของหน่วยงานนี้หรือผู้ที่ได้รับมอบหมาย');
      if (t.status === 'done') throw httpError('LOCKED', 'ปิดงานไปแล้ว');
      if (t.status === 'returned') throw httpError('LOCKED', 'ส่งคืนไปแล้ว');
      t.status = 'done';
    } else {
      if (!isPerson && !sc.admin) throw httpError('FORBIDDEN', 'เฉพาะบุคลากรของหน่วยงานนี้');
      if (text.length < 3) throw httpError('BAD_REQUEST', 'กรุณาระบุเหตุผลที่ส่งคืน');
      if (t.status === 'done') throw httpError('LOCKED', 'ปิดงานไปแล้ว');
      t.status = 'returned';
    }
    if (text) t.note = text; t.upd = now; t.by = sc.email; sarPut(tsh, t.row, sarToRow(t));
    sarEvent(d.o.id, kind === 'ack' ? 'ack' : kind === 'assign' ? 'assign' : kind === 'done' ? 'done' : 'return', sc.email, unit, text, kind === 'assign' ? { people: t.people } : null);
    sarLog(sc.email, kind, d.o.reg, { id: d.o.id, unit: unit });
    var grants = kind === 'assign' && d.o.secrecy === 'normal' ? d.o.files.map(function (url) { return { url: url, emails: t.people }; }) : [];
    return { status: t.status, _grants: grants };
  });
}
function sarUpdate(sc, b) {
  sarNeedStaff(sc);
  return sarLocked(function () {
    sc.memo.tos = null;
    var d = sarLoadDoc(sc, b.id, true), o = d.o, changed = [];
    function set(key, val, label) { if (String(o[key]) !== String(val)) { changed.push(label); o[key] = val; } }
    if (b.subject !== undefined) { var s = sarOneLine(b.subject, 300); if (!s) throw httpError('BAD_REQUEST', 'เรื่องต้องไม่ว่าง'); set('subject', s, 'เรื่อง'); }
    if (b.docNo !== undefined && o.kind === 'in') set('docNo', sarOneLine(b.docNo, 80), 'เลขที่หนังสือ');
    if (b.docDate !== undefined) set('docDate', sarDateOk(b.docDate, 'วันที่หนังสือ'), 'ลงวันที่');
    if (b.party !== undefined && o.kind === 'in') { var p = sarOneLine(b.party, 160); if (!p) throw httpError('BAD_REQUEST', 'ผู้ส่งต้องไม่ว่าง'); set('party', p, 'จาก'); }
    if (b.urgency !== undefined) set('urgency', sarEnum(b.urgency, SAR_URGENCY, o.urgency), 'ชั้นความเร็ว');
    if (b.due !== undefined) set('due', sarDateOk(b.due, 'กำหนดเสร็จ'), 'กำหนดเสร็จ');
    if (b.cat !== undefined) set('cat', sarEnum(String(b.cat), SAR_CATEGORIES.map(function (x) { return x[0]; }), ''), 'หมวด');
    if (b.salut !== undefined) set('salut', sarOneLine(b.salut, 160), 'เรียน');
    if (b.refs !== undefined) set('refs', sarClean(b.refs, 400), 'อ้างถึง');
    if (b.encl !== undefined) set('encl', sarClean(b.encl, 400), 'สิ่งที่ส่งมาด้วย');
    if (b.note !== undefined) set('note', sarClean(b.note, 500), 'หมายเหตุ');
    if (b.action !== undefined) set('action', sarClean(b.action, 300), 'การปฏิบัติ');
    if (b.secrecy !== undefined && sarEnum(b.secrecy, SAR_SECRECY, o.secrecy) !== o.secrecy) {
      var ns = sarEnum(b.secrecy, SAR_SECRECY, o.secrecy), raise = SAR_SECRECY.indexOf(ns) > SAR_SECRECY.indexOf(o.secrecy);
      if (!(sc.admin || (raise && sc.clear))) throw httpError('FORBIDDEN', 'การเปลี่ยนชั้นความลับทำได้เฉพาะผู้ดูแลระบบ (ปรับเพิ่มได้โดยผู้ที่ได้รับอนุญาต)');
      set('secrecy', ns, 'ชั้นความลับ');
    }
    if (o.due && o.docDate && o.due < o.docDate) throw httpError('BAD_REQUEST', 'กำหนดเสร็จต้องไม่เร็วกว่าวันที่หนังสือ');
    if (!changed.length) return { doc: sarPublic(sc, o, d.tos, 'full'), changed: [] };
    o.upd = sarNowStamp(); sarPut(d.sh, o.row, sarRow(o));
    sarEvent(o.id, 'edit', sc.email, '', 'แก้ไข: ' + changed.join(', '), { fields: changed });
    sarLog(sc.email, 'update', o.reg, { id: o.id, n: changed.length });
    return { doc: sarPublic(sc, o, d.tos, 'full'), changed: changed };
  });
}

/* ------------------------------------- reading: list · get · my · track · numbers ------------------------------------- */

function sarMatchQ(o, terms) {
  if (!terms.length) return true;
  var hay = sarNorm(o.reg + ' ' + o.no + ' ' + o.docNo + ' ' + o.subject + ' ' + o.party + ' ' + o.note + ' ' + o.action + ' ' + o.verify);
  return terms.every(function (t) { return hay.indexOf(t) >= 0; });
}
function sarTerms(q) { return String(q || '').trim().slice(0, 80).split(/\s+/).map(sarNorm).filter(Boolean); }
function sarFilterRows(sc, b, rows, tosBy, forExport) {
  var kind = b.kind === 'out' ? 'out' : 'in', year = parseInt(b.year, 10) || sarYearBE(), registry = String(b.registry || ''), terms = sarTerms(b.q);
  var from = String(b.from || '').slice(0, 10), to = String(b.to || '').slice(0, 10), st = String(b.stage || ''), urg = b.urgent === true;
  var out = [], stats = { total: 0, today: 0, last: 0, void: 0 };
  rows.forEach(function (o) {
    if (o.kind !== kind || o.year !== year || (registry && o.registry !== registry)) return;
    var tos = tosBy[o.id] || [], acc = sarAccess(sc, o, tos);
    if (acc === 'none') return;
    if (o.status === 'void') stats.void++; else { stats.total++; if (String(o.at).slice(0, 10) === sc.today) stats.today++; }
    if (o.no > stats.last) stats.last = o.no;
    var day = String(o.at).slice(0, 10);
    if ((from && day < from) || (to && day > to)) return;
    if (!sarMatchQ(acc === 'full' ? o : { reg: o.reg, no: o.no, docNo: o.docNo, subject: '', party: '', note: '', action: '', verify: '' }, terms)) return;
    var pub = sarPublic(sc, o, tos, acc);
    if (st === 'overdue') { if (!pub.overdue) return; } else if (st && pub.stage !== st) return;
    if (urg && !(o.urgency === 'most' || o.urgency === 'very')) return;
    if (forExport) { pub.docDate = o.docDate; pub.refs = acc === 'full' ? o.refs : ''; pub.encl = acc === 'full' ? o.encl : ''; pub.channel = o.channel; pub.salut = acc === 'full' ? o.salut : ''; }
    out.push(pub);
  });
  out.sort(function (a, c) { return b.order === 'asc' ? a.no - c.no : c.no - a.no; });
  return { items: out, stats: stats, kind: kind, year: year };
}
function sarList(sc, b) {
  sarNeedReader(sc);
  var rows = sarAll(sarTab(SAR_TAB)), r = sarFilterRows(sc, b, rows, sarToAll(sc).by, false);
  var off = Math.max(parseInt(b.offset, 10) || 0, 0), lim = Math.min(Math.max(parseInt(b.limit, 10) || 50, 1), SAR_LIST_MAX);
  return { year: r.year, kind: r.kind, total: r.items.length, items: r.items.slice(off, off + lim), more: r.items.length > off + lim, counts: { total: r.stats.total, today: r.stats.today, lastNo: r.stats.last, nextNo: r.stats.last + 1, void: r.stats.void } };
}
function sarNeedReader(sc) { if (!(sc.staff || sc.exec)) throw httpError('FORBIDDEN', 'ทะเบียนเปิดให้เจ้าหน้าที่สารบรรณและผู้บริหาร — บุคลากรทั่วไปดูได้เฉพาะ “งานของฉัน”'); }
function sarRowsOp(sc, b) {
  sarNeedReader(sc);
  var rows = sarAll(sarTab(SAR_TAB)), r = sarFilterRows(sc, { kind: b.kind, year: b.year, registry: b.registry, q: b.q, from: b.from, to: b.to, stage: b.stage, order: 'asc' }, rows, sarToAll(sc).by, true);
  sarLog(sc.email, 'export', r.kind + ':' + r.year, { n: r.items.length });
  return { year: r.year, kind: r.kind, org: sarOrg(), registry: sarRegistryName(sc, String(b.registry || 'central')), rows: r.items.slice(0, SAR_ROWS_MAX), truncated: r.items.length > SAR_ROWS_MAX };
}
function sarGet(sc, b) {
  var sh = sarTab(SAR_TAB), o = sarFind(sh, b.id), tos = sarToAll(sc).by[o.id] || [], acc = sarAccess(sc, o, tos);
  if (acc === 'none') throw httpError('FORBIDDEN', 'ไม่มีสิทธิ์ดูหนังสือฉบับนี้');
  var full = acc === 'full', pub = sarPublic(sc, o, tos, acc), units = sarUnits(sc);
  var out = { doc: pub, access: acc, verify: full ? o.verify : '', stamp: { org: sarOrg() } };
  if (full) {
    pub.docDate = o.docDate; pub.salut = o.salut; pub.refs = o.refs; pub.encl = o.encl; pub.files = o.files; pub.cat = o.cat; pub.channel = o.channel; pub.deliverer = o.extra.deliverer || '';
    pub.parties = o.extra.parties || []; pub.bookType = o.extra.bookType || ''; pub.replyTo = o.extra.replyTo || ''; pub.inbox = o.inbox;
  }
  out.to = tos.map(function (t) {
    var u = sarUnitBy(sc, t.unit), isHead = u && sarHeads(u, sc.today).indexOf(sc.email) >= 0, isPerson = u && sarPeople(u, sc.today).indexOf(sc.email) >= 0;
    return { unit: t.unit, name: u ? u.name : t.unit, short: u ? u.short : t.unit, action: t.action, status: t.status, due: t.due, people: full ? t.people : [], note: full ? t.note : '', upd: t.upd, by: t.by,
      can: { ack: !!(isPerson || sc.admin) && t.status === 'pending', assign: !!(isHead || sc.admin) && (t.status === 'received' || t.status === 'assigned' || t.status === 'pending'), done: !!(isPerson || t.people.indexOf(sc.email) >= 0 || sc.admin) && (t.status === 'received' || t.status === 'assigned' || t.status === 'pending'), ret: !!(isPerson || sc.admin) && t.status !== 'done' && t.status !== 'returned' },
      pool: (isHead || sc.admin) && full && u ? sarPeople(u, sc.today) : [] };
  });
  var evs = [], es = sarTab(SAR_EV), last = es.getLastRow();
  if (last >= 2) { var from = Math.max(2, last - SAR_SCAN_EV + 1); es.getRange(from, 1, last - from + 1, EV_COLS).getValues().forEach(function (r) { if (String(r[1]) === o.id) evs.push({ at: String(r[0]), type: String(r[2]), by: String(r[3]), unit: String(r[4]), text: full ? sarUn(r[5]) : '' }); }); }
  out.events = evs.sort(function (a, c) { return a.at < c.at ? -1 : a.at > c.at ? 1 : 0; });
  out.can = { edit: sc.staff && full && o.status !== 'void', cancel: sc.staff && o.status !== 'void' && (o.secrecy === 'normal' || sc.clear), route: o.kind === 'in' && o.status !== 'void' && full && (sc.staff || sc.exec || out.to.some(function (t) { return sc.units.indexOf(t.unit) >= 0; })), command: sc.exec && o.kind === 'in' && full && o.status !== 'void', attach: sc.staff && full && o.status !== 'void' };
  out.dueDate = o.kind === 'in' ? sarDueFor(o.due, o.urgency, String(o.at).slice(0, 10), sc.sla, sc.holidays) : '';
  return out;
}
function sarMy(sc) {
  var rows = sarAll(sarTab(SAR_TAB)), by = Object.create(null), tosAll = sarToAll(sc), items = [];
  rows.forEach(function (o) { by[o.id] = o; });
  tosAll.list.forEach(function (t) {
    var o = by[t.docId]; if (!o || o.status === 'void') return;
    var u = sarUnitBy(sc, t.unit), mineUnit = sc.units.indexOf(t.unit) >= 0, named = t.people.indexOf(sc.email) >= 0;
    if (!mineUnit && !named) return;
    var acc = sarAccess(sc, o, tosAll.by[o.id]); if (acc === 'none') return;
    if (t.status === 'done' && sarDaysBetween(String(t.upd).slice(0, 10), sc.today) > 14) return;
    var pub = sarPublic(sc, o, tosAll.by[o.id], acc);
    items.push({ id: o.id, reg: o.reg, docNo: pub.docNo, subject: pub.subject, party: pub.party, urgency: o.urgency, secrecy: o.secrecy, masked: pub.masked, unit: t.unit, unitName: u ? u.short || u.name : t.unit, action: t.action, status: t.status, due: t.due || sarDueFor(o.due, o.urgency, String(o.at).slice(0, 10), sc.sla, sc.holidays), mine: named, at: o.at, note: pub.masked ? '' : t.note });
  });
  var rank = { pending: 0, received: 1, assigned: 1, returned: 2, done: 3 };
  items.sort(function (a, c) { return (rank[a.status] - rank[c.status]) || (a.due < c.due ? -1 : a.due > c.due ? 1 : 0); });
  var open = items.filter(function (x) { return x.status === 'pending' || x.status === 'received' || x.status === 'assigned'; });
  return { items: items.slice(0, 200), open: open.length, overdue: open.filter(function (x) { return x.due && x.due < sc.today; }).length, today: sc.today };
}
function sarTrack(sc, b) {
  var q = sarClean(b.q, 80); if (q.length < 2 && !/^\d+$/.test(q)) throw httpError('BAD_REQUEST', 'พิมพ์เลขรับ เลขที่หนังสือ รหัสตรวจสอบ หรือชื่อเรื่องอย่างน้อย 2 ตัวอักษร');
  var rows = sarAll(sarTab(SAR_TAB)), tosBy = sarToAll(sc).by, n = sarNorm(q), terms = sarTerms(q), out = [];
  var asReg = /^\d{1,6}$/.test(n) ? n + '/' + sarYearBE() : (sarParseReg(n) ? n : '');
  for (var i = rows.length - 1; i >= 0 && out.length < 20; i--) {
    var o = rows[i], tos = tosBy[o.id] || [], acc = sarAccess(sc, o, tos); if (acc === 'none') continue;
    var hit = (asReg && o.reg === asReg) || sarNorm(o.verify) === n || sarNorm(o.docNo) === n || (acc === 'full' ? sarMatchQ(o, terms) : sarMatchQ({ reg: o.reg, no: o.no, docNo: o.docNo, subject: '', party: '', note: '', action: '', verify: '' }, terms));
    if (!hit) continue;
    var pub = sarPublic(sc, o, tos, acc);
    pub.exact = !!((asReg && o.reg === asReg) || sarNorm(o.verify) === n || sarNorm(o.docNo) === n);
    pub.steps = tos.map(function (t) { var u = sarUnitBy(sc, t.unit); return { unit: u ? u.short || u.name : t.unit, status: t.status, action: t.action, upd: t.upd }; });
    out.push(pub);
  }
  out.sort(function (a, c) { return (c.exact ? 1 : 0) - (a.exact ? 1 : 0); });                   // an exact เลขรับ / รหัสตรวจสอบ always comes first
  return { q: q, items: out };
}
function sarNumbers(sc, b) {
  sarNeedStaff(sc);
  var year = parseInt(b.year, 10) || sarYearBE(), registry = String(b.registry || 'central'), rows = sarAll(sarTab(SAR_TAB)), kinds = { in: { max: 0, n: 0, set: {} }, out: { max: 0, n: 0, set: {} } }, reserved = [], voids = [], stale = sarReserveDays();
  rows.forEach(function (o) {
    if (o.year !== year || o.registry !== registry) return;
    var k = kinds[o.kind]; k.set[o.no] = true; if (o.no > k.max) k.max = o.no; if (o.status !== 'void') k.n++;
    if (o.status === 'reserved') reserved.push({ id: o.id, reg: o.reg, docNo: o.docNo, purpose: o.subject, by: o.by, at: o.at, stale: sarDaysBetween(String(o.at).slice(0, 10), sc.today) >= stale });
    if (o.status === 'void') voids.push({ id: o.id, kind: o.kind, reg: o.reg, docNo: o.docNo, why: o.voidWhy, by: o.by, at: o.upd || o.at });
  });
  function gaps(k) { var g = []; for (var i = 1; i < k.max && g.length < 50; i++) if (!k.set[i]) g.push(i); return g; }
  return { year: year, registry: registry, in: { last: kinds.in.max, count: kinds.in.n, gaps: gaps(kinds.in) }, out: { last: kinds.out.max, count: kinds.out.n, gaps: gaps(kinds.out) }, reserved: reserved.slice(-50), voids: voids.slice(-50).reverse(), staleDays: stale };
}
function sarParties(sc, b) {
  sarNeedStaff(sc);
  var q = sarNorm(sarClean(b.q, 60)); if (q.length < 1) return { items: [] };
  var seen = Object.create(null), out = [];
  sarUnits(sc).forEach(function (u) { if (u.active && (sarNorm(u.name).indexOf(q) >= 0 || sarNorm(u.short).indexOf(q) >= 0)) { seen[sarNorm(u.name)] = true; out.push({ name: u.name, unit: u.code, channel: u.type === 'external' ? 'esaraban' : 'hand', email: u.email }); } });
  var rows = sarAll(sarTab(SAR_TAB));
  for (var i = rows.length - 1; i >= 0 && out.length < 15; i--) {
    var o = rows[i]; if (o.secrecy !== 'normal') continue;
    (o.extra.parties || (o.kind === 'in' && o.party ? [{ name: o.party, channel: o.channel }] : [])).forEach(function (p) {
      var k = sarNorm(p.name); if (!k || seen[k] || k.indexOf(q) < 0 || out.length >= 15) return;
      seen[k] = true; out.push({ name: p.name, unit: p.unit || '', channel: p.channel || 'esaraban', email: p.email || '' });
    });
  }
  return { items: out };
}
/** v1.8.0 — urgency read from the words of a queued letter ('' when it says nothing). */
function sarGuessUrgency(text) { var t = String(text || ''); return /ด่วนที่สุด/.test(t) ? 'most' : /ด่วนมาก/.test(t) ? 'very' : /(^|[\s(])ด่วน($|[\s)])/.test(t) ? 'urgent' : ''; }
/** v1.8.0 — เลขที่หนังสือ (normalised) → เลขรับ of the live receive entries, so a queued letter that is already registered can be flagged. */
function sarDocNoIndex() { var idx = Object.create(null); sarAll(sarTab(SAR_TAB)).forEach(function (o) { if (o.kind === 'in' && o.status !== 'void' && o.status !== 'reserved' && o.docNo) idx[sarNorm(o.docNo)] = o.reg; }); return idx; }
function sarQueue(sc) {
  sarNeedStaff(sc);
  if (typeof inbAll !== 'function') return { enabled: false, items: [] };
  var units = sarUnits(sc), rows = inbAll(inbSheet()).filter(function (q) { return q.status === 'pending'; }).sort(function (a, c) { return a.received < c.received ? 1 : -1; }).slice(0, 100);
  var dups = sarDocNoIndex();
  return { enabled: true, today: sc.today, items: rows.map(function (q) {
    var urgent = /ด่วน/.test(q.subject + ' ' + q.text), age = sarDaysBetween(String(q.received).slice(0, 10), sc.today);
    return { id: q.id, subject: q.subject, bookNo: q.bookNo, bookDate: q.bookDate, from: q.from, file: q.file, urls: q.urls, received: q.received, msgTime: q.msgTime, urgentHint: urgent, urgency: sarGuessUrgency(q.subject + ' ' + q.text), age: age >= 0 ? age : 0, registered: (q.bookNo && dups[sarNorm(q.bookNo)]) || '', source: q.source, suggest: sarSuggestUnits(q.subject, units) };
  }) };
}
function sarDash(sc) {
  var out = { today: sc.today, year: sarYearBE(), org: sarOrg(), role: { staff: sc.staff, exec: sc.exec, admin: sc.admin, clear: sc.clear } };
  out.my = sarMy(sc); out.my = { open: out.my.open, overdue: out.my.overdue };
  if (!(sc.staff || sc.exec)) return out;
  var rows = sarAll(sarTab(SAR_TAB)), tosBy = sarToAll(sc).by, yr = out.year, k = { inToday: 0, outToday: 0, inYear: 0, outYear: 0, lastIn: 0, lastOut: 0, unrouted: 0, overdue: 0, urgentOpen: 0, returned: 0, inprogress: 0 };
  var ch = {}, perDay = {}, pend = {}, d14 = sarAddDays(sc.today, -13), d30 = sarAddDays(sc.today, -30);
  rows.forEach(function (o) {
    if (o.status === 'void') return;
    var tos = tosBy[o.id] || [], acc = sarAccess(sc, o, tos); if (acc === 'none') return;
    var day = String(o.at).slice(0, 10);
    if (o.year === yr) { if (o.kind === 'in') { k.inYear++; k.lastIn = Math.max(k.lastIn, o.no); } else { k.outYear++; k.lastOut = Math.max(k.lastOut, o.no); } }
    if (day === sc.today) { if (o.kind === 'in') k.inToday++; else k.outToday++; }
    if (day >= d14) { perDay[day] = perDay[day] || { in: 0, out: 0 }; perDay[day][o.kind]++; }
    if (o.kind === 'in' && day >= d30) ch[o.channel || 'other'] = (ch[o.channel || 'other'] || 0) + 1;
    if (o.kind !== 'in') return;
    var pub = sarPublic(sc, o, tos, acc);
    if (pub.stage === 'registered') k.unrouted++;
    if (pub.stage === 'returned') k.returned++;
    if (pub.stage === 'inprogress') k.inprogress++;
    if (pub.overdue) k.overdue++;
    if (pub.stage !== 'done' && (o.urgency === 'most' || o.urgency === 'very')) k.urgentOpen++;
    tos.forEach(function (t) { if (t.status === 'pending' || t.status === 'received' || t.status === 'assigned') pend[t.unit] = (pend[t.unit] || 0) + 1; });
  });
  var days = []; for (var i = 13; i >= 0; i--) { var d = sarAddDays(sc.today, -i); days.push({ day: d, in: (perDay[d] || {}).in || 0, out: (perDay[d] || {}).out || 0 }); }
  var q = typeof inbAll === 'function' ? sarInboxRows().filter(function (x) { return x.status === 'pending'; }) : [];
  out.kpi = k; out.queue = { n: q.length, urgent: q.filter(function (x) { return /ด่วน/.test(x.subject + ' ' + x.text); }).length, enabled: typeof inbAll === 'function' };
  out.days = days; out.channels = Object.keys(ch).map(function (c) { return { channel: c, n: ch[c] }; }).sort(function (a, c) { return c.n - a.n; });
  out.pending = Object.keys(pend).map(function (c) { var u = sarUnitBy(sc, c); return { unit: c, name: u ? u.short || u.name : c, n: pend[c] }; }).sort(function (a, c) { return c.n - a.n; }).slice(0, 8);
  return out;
}
function sarConfig(sc) {
  var units = sarUnits(sc).map(function (u) { return { code: u.code, name: u.name, short: u.short, type: u.type, active: u.active, registry: u.registry, parent: u.parent, prefix: u.prefix }; });
  return { org: sarOrg(), today: sc.today, year: sarYearBE(), me: { email: sc.email, admin: sc.admin, staff: sc.staff, exec: sc.exec, clear: sc.clear, units: sc.units, headOf: sc.headUnits }, channels: SAR_CHANNELS, categories: SAR_CATEGORIES, urgencies: SAR_URGENCY, secrecies: SAR_SECRECY, units: units,
    sla: sc.sla, holidays: sc.holidays, bookPrefix: prop('SAR_BOOK_PREFIX'), reserveDays: sarReserveDays(), queue: typeof inbAll === 'function', driveReady: !!(prop('SARABAN_FOLDER_ID') || prop('DRIVE_FOLDER_ID')) };
}

/* ------------------------------------- units (admin) ------------------------------------- */

function sarUnitsOp(sc) {
  var list = sarUnits(sc).map(function (u) {
    var base = { code: u.code, name: u.name, short: u.short, type: u.type, active: u.active, registry: u.registry, parent: u.parent, prefix: u.prefix, keywords: sc.admin ? u.keywords : '', email: sc.staff ? u.email : '' };
    if (sc.admin) { base.head = u.head; base.members = u.members; base.delegate = u.delegate; base.delegateUntil = u.delegateUntil; }
    return base;
  });
  return { units: list };
}
function sarUnitSave(sc, b) {
  sarNeedAdmin(sc);
  var code = String(b.code || '').trim();
  if (!/^[A-Za-z0-9_-]{2,20}$/.test(code) || code === 'central') throw httpError('BAD_REQUEST', 'รหัสหน่วยงานใช้ได้เฉพาะ a-z 0-9 _ - ยาว 2–20 ตัว (และห้ามใช้ central)');
  var name = sarOneLine(b.name, 120); if (!name) throw httpError('BAD_REQUEST', 'กรุณาระบุชื่อหน่วยงาน');
  var type = sarEnum(b.type, ['internal', 'exec', 'external'], 'internal');
  var u = { code: code, name: name, short: sarOneLine(b.short, 30) || name.slice(0, 20), type: type, head: sarEmail(b.head), members: sarEmails(b.members, 80), delegate: sarEmail(b.delegate), delegateUntil: sarDateOk(b.delegateUntil, 'วันที่สิ้นสุดการรักษาราชการแทน'),
    prefix: sarOneLine(b.prefix, 60), active: b.active !== false, email: sarEmail(b.email), parent: sarClean(b.parent, 20), keywords: sarOneLine(b.keywords, 300), registry: b.registry === true && type !== 'external' };
  if (String(b.head || '').trim() && !u.head) throw httpError('BAD_REQUEST', 'อีเมลหัวหน้าไม่ถูกต้อง');
  if (u.delegate && !u.delegateUntil) throw httpError('BAD_REQUEST', 'ผู้รักษาราชการแทนต้องระบุวันที่สิ้นสุด');
  if (u.delegate && u.delegateUntil < sc.today) throw httpError('BAD_REQUEST', 'วันที่สิ้นสุดการรักษาราชการแทนผ่านมาแล้ว');
  return sarLocked(function () {
    var sh = sarTab(SAR_UN), last = sh.getLastRow(), row = 0;
    if (last >= 2) sh.getRange(2, 1, last - 1, 1).getValues().forEach(function (r, i) { if (String(r[0]) === code) row = i + 2; });
    if (u.parent && u.parent === code) throw httpError('BAD_REQUEST', 'หน่วยงานเป็นสังกัดของตัวเองไม่ได้');
    if (row) sarPut(sh, row, sarUnitRow(u)); else sarAppend(sh, sarUnitRow(u));
    sarLog(sc.email, row ? 'unitedit' : 'unitadd', code, { type: type });
    return { ok: true, created: !row };
  });
}

/* ------------------------------------- entry point ------------------------------------- */

function saraban(b) {
  var u = requireUser(b.session), op = String(b.op || '');
  rateLimit('saraban', intProp('SARABAN_LIMIT_PER_MIN', 240));
  var sc = sarScope(u);
  switch (op) {
    case 'config':   return sarConfig(sc);
    case 'dash':     return sarDash(sc);
    case 'my':       return sarMy(sc);
    case 'get':      return sarGet(sc, b);
    case 'units':    return sarUnitsOp(sc);
    case 'queue':    return sarQueue(sc);
    case 'reject':   return sarReject(sc, b);
    case 'dup':      sarNeedStaff(sc); { var f = sarFields(b, 'in'); return { items: sarDupFind(sarAll(sarTab(SAR_TAB)), f, String(b.inboxId || ''), sarInboxRows()).map(function (d) { return sarDupPublic(sc, d); }), suggest: sarSuggestUnits(f.subject, sarUnits(sc)) }; }
    case 'upload':   return sarUpload(sc, b);
    case 'receive':  return sarReceive(sc, b);
    case 'send':     return sarSend(sc, b);
    case 'reserve':  return sarReserve(sc, b);
    case 'cancelno': return sarCancel(sc, b);
    case 'route':    return sarRoute(sc, b);
    case 'ack':      return sarUnitAction(sc, b, 'ack');
    case 'assign':   return sarUnitAction(sc, b, 'assign');
    case 'done':     return sarUnitAction(sc, b, 'done');
    case 'return':   return sarUnitAction(sc, b, 'return');
    case 'update':   return sarUpdate(sc, b);
    case 'list':     return sarList(sc, b);
    case 'rows':     return sarRowsOp(sc, b);
    case 'track':    return sarTrack(sc, b);
    case 'numbers':  return sarNumbers(sc, b);
    case 'parties':  return sarParties(sc, b);
    case 'unitsave': return sarUnitSave(sc, b);
    default: throw httpError('UNKNOWN_ACTION', 'ไม่รู้จักคำสั่งนี้');
  }
}

/* ------------------------------------- setup ------------------------------------- */

/** Run ONCE from the editor (safe to repeat): creates the five tabs, seeds a starter list of hospital units, and the script-property placeholders. Edit the units on the page "สารบรรณ → หน่วยงาน" afterwards. */
function setupSaraban() {
  var tabs = [[SAR_TAB, SAR_HEADERS, [90, 60, 70, 60, 100, 90, 90, 150, 150, 110, 340, 220, 80, 80, 100, 60, 90, 300, 200, 200, 220, 220, 200, 100, 90, 200, 220, 160, 300, 150], '#0f5c9e'],
    [SAR_TO, TO_HEADERS, [90, 90, 90, 90, 100, 220, 260, 150, 200, 150, 140], '#0b7a7c'], [SAR_EV, EV_HEADERS, [150, 90, 90, 200, 90, 420, 300], '#6d28d9'],
    [SAR_UN, UN_HEADERS, [90, 260, 120, 80, 200, 320, 200, 100, 160, 60, 200, 90, 320, 100], '#b45309'], [SAR_CNT, CNT_HEADERS, [160, 80, 150, 200], '#64748b']];
  tabs.forEach(function (t) {
    var sh = sarTab(t[0]);
    sh.getRange(1, 1, 1, t[1].length).setValues([t[1]]).setFontWeight('bold').setFontColor('#ffffff').setBackground('#0f5c9e');
    sh.setFrozenRows(1); sh.setTabColor(t[3]);
    t[2].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
    sh.getRange(2, 1, Math.max(sh.getMaxRows() - 1, 1), t[1].length).setNumberFormat('@');
  });
  var us = sarTab(SAR_UN);
  if (us.getLastRow() < 2) {
    var seed = [
      ['exec', 'ผู้บริหาร (ผู้อำนวยการ/รองผู้อำนวยการ)', 'ผู้บริหาร', 'exec', '', '', '', '', '', '1', '', '', 'นโยบาย,ผู้บริหาร,ข้อสั่งการ,ประชุมผู้บริหาร', '0'],
      ['admin', 'กลุ่มงานบริหารทั่วไป (งานสารบรรณ)', 'บริหารทั่วไป', 'internal', '', '', '', '', '', '1', '', '', 'สารบรรณ,อาคารสถานที่,ยานพาหนะ,ธุรการ,ซ่อมบำรุง', '0'],
      ['nurse', 'กลุ่มงานการพยาบาล', 'การพยาบาล', 'internal', '', '', '', '', '', '1', '', '', 'พยาบาล,การพยาบาล,ผู้ป่วยใน,ห้องผ่าตัด,ฉุกเฉิน', '0'],
      ['med', 'กลุ่มงานการแพทย์', 'การแพทย์', 'internal', '', '', '', '', '', '1', '', '', 'แพทย์,การแพทย์,ผู้ป่วยนอก,ส่งต่อ,รักษา', '0'],
      ['pharm', 'กลุ่มงานเภสัชกรรมและคุ้มครองผู้บริโภค', 'เภสัชกรรม', 'internal', '', '', '', '', '', '1', '', '', 'ยา,เภสัช,เวชภัณฑ์,เวชภัณฑ์มิใช่ยา,คุ้มครองผู้บริโภค', '0'],
      ['fin', 'งานการเงินและบัญชี', 'การเงิน', 'internal', '', '', '', '', '', '1', '', '', 'งบประมาณ,การเงิน,บัญชี,เบิกจ่าย,ค่าตอบแทน,ค่าใช้จ่าย', '0'],
      ['supply', 'งานพัสดุ', 'พัสดุ', 'internal', '', '', '', '', '', '1', '', '', 'จัดซื้อ,จัดจ้าง,พัสดุ,ครุภัณฑ์,ราคากลาง,e-GP', '0'],
      ['hr', 'งานทรัพยากรบุคคล', 'ทรัพยากรบุคคล', 'internal', '', '', '', '', '', '1', '', '', 'บุคคล,บรรจุ,ลาศึกษา,เลื่อนระดับ,วินัย,เครื่องราชอิสริยาภรณ์,พนักงานราชการ', '0'],
      ['plan', 'กลุ่มงานนโยบายและยุทธศาสตร์', 'นโยบายและแผน', 'internal', '', '', '', '', '', '1', '', '', 'แผน,ยุทธศาสตร์,ตัวชี้วัด,KPI,โครงการ,ประเมินผล', '0'],
      ['it', 'กลุ่มงานเทคโนโลยีสารสนเทศ', 'IT', 'internal', '', '', '', '', '', '1', '', '', 'ระบบสารสนเทศ,ดิจิทัล,เครือข่าย,ไซเบอร์,PDPA,ข้อมูลส่วนบุคคล,HIS', '0'],
      ['qa', 'ศูนย์พัฒนาคุณภาพ', 'คุณภาพ', 'internal', '', '', '', '', '', '1', '', '', 'คุณภาพ,HA,รับรองคุณภาพ,มาตรฐาน,ความเสี่ยง', '0'],
      ['ipc', 'งานป้องกันและควบคุมการติดเชื้อ', 'IC', 'internal', '', '', '', '', '', '1', '', '', 'ติดเชื้อ,ควบคุมโรค,วัคซีน,โรคระบาด,อุบัติการณ์', '0'],
      ['hrd', 'งานพัฒนาบุคลากร', 'พัฒนาบุคลากร', 'internal', '', '', '', '', '', '1', '', '', 'อบรม,สัมมนา,ประชุมวิชาการ,หลักสูตร,ศึกษาดูงาน', '0'],
      ['pr', 'งานประชาสัมพันธ์', 'ประชาสัมพันธ์', 'internal', '', '', '', '', '', '1', '', '', 'ประชาสัมพันธ์,เผยแพร่,สื่อ,ข่าว,ร้องเรียน', '0'],
      ['law', 'งานนิติการ', 'นิติการ', 'internal', '', '', '', '', '', '1', '', '', 'กฎหมาย,คดี,ฟ้อง,สัญญา,ร้องเรียน,สิทธิผู้ป่วย', '0']
    ];
    seed.forEach(function (r) { sarAppend(us, r); });
  }
  var P = PropertiesService.getScriptProperties();
  ['SAR_ORG_NAME', 'SAR_BOOK_PREFIX', 'SARABAN_STAFF_EMAILS', 'SARABAN_EXEC_EMAILS', 'SARABAN_SECRET_EMAILS', 'SAR_HOLIDAYS'].forEach(function (k) { if (P.getProperty(k) === null) P.setProperty(k, ''); });
  console.log('พร้อมใช้งาน — สร้างแท็บ Saraban, SarTo, SarTrack, SarUnits, SarNo แล้ว\nต่อไป: ตั้ง SAR_ORG_NAME, SAR_BOOK_PREFIX (เช่น สธ 0xxx.xxx), SARABAN_STAFF_EMAILS, SARABAN_EXEC_EMAILS ใน Script properties แล้ว Deploy เวอร์ชันใหม่');
}
