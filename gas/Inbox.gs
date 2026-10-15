/**
 * SAND Office Tools — Inbox (หนังสือรับเข้า / งานธุรการ): collects circular letters that are posted in a Telegram group — SILENTLY.
 *
 * How it works
 *   Telegram group ──webhook──▶ Vercel /api/telegram (checks Telegram's secret header, allow-list, slims the update)
 *                                 ──POST {action:"tg", secret, u}──▶ inbHook() here ──▶ sheet tab "Inbox" (+ PDF copied to Drive)
 *   Clerks open the page "หนังสือรับเข้า": review the draft rows (สถานะ = pending), fix the fields, press "รับหนังสือ" → the row gets a running
 *   registration number (เลขรับ  n/ปี พ.ศ.) and becomes accepted. Nothing is registered automatically.
 *
 * THE BOT NEVER WRITES IN THE GROUP. This file contains no sendMessage / reply call at all; the only requests made to api.telegram.org are
 * getFile (to download an attached PDF) and the file download itself. The Vercel function answers Telegram with an empty 200.
 *
 * Public part (secret-protected, only the edge function holds EDGE_SECRET):
 *   POST {action:"tg", secret, u:{chat:{id,title}, mid, date, text, urls[], doc?{file_id,file_name,size}}}
 * Signed-in part (staff only = ADMIN_EMAILS + INBOX_STAFF_EMAILS):
 *   POST {action:"inbox", session, op: list | update | accept | ignore | restore | import | add}
 *
 * Script properties
 *   TG_ALLOWED_CHATS    (required)  comma-separated chat ids that may feed the inbox, e.g. -1001234567890. Empty = nothing is accepted.
 *   TG_BOT_TOKEN        (optional)  only needed to copy attached PDFs into Drive. Without it the Telegram message text/links are still stored.
 *   TG_KEYWORDS         (optional)  comma-separated words that mark a message as a letter. Default below.
 *   TG_CAPTURE_ALL      (optional)  "true" = every message with a link or a file is stored (still only from TG_ALLOWED_CHATS)
 *   INBOX_STAFF_EMAILS  (optional)  clerks who may use the page (admins always may)
 * Uses helpers from Code.gs / Links.gs / Library.gs.   Run setupInbox() once from the editor.
 */

var INB_HEADERS = ['รหัส', 'รับเข้าระบบเมื่อ', 'เวลาข้อความ', 'สถานะ', 'เลขรับ', 'วันที่รับ', 'เลขที่หนังสือ', 'ลงวันที่ (หนังสือ)', 'เรื่อง', 'จาก', 'ลิงก์', 'ไฟล์ (Drive)', 'ข้อความต้นฉบับ', 'แท็ก', 'หมายเหตุ', 'ผู้ดำเนินการ', 'แหล่งที่มา', 'dedup'];
var INB_COLS = 18;
var INB_SCAN_ROWS = 4000;
var INB_LIST_MAX = 300;
var INB_FILE_MAX = 10 * 1024 * 1024;
var INB_DEFAULT_KEYWORDS = 'หนังสือเวียน,หนังสือราชการ,หนังสือ,ที่ ศธ,ที่ สธ,ที่ มท,ที่ นร,ลงวันที่,เรื่อง,ขอเชิญ,ประชาสัมพันธ์,แจ้งเวียน';
var INB_MONTHS = [['มกราคม', 'ม.ค.', 'ม.ค'], ['กุมภาพันธ์', 'ก.พ.', 'ก.พ'], ['มีนาคม', 'มี.ค.', 'มี.ค'], ['เมษายน', 'เม.ย.', 'เม.ย'], ['พฤษภาคม', 'พ.ค.', 'พ.ค'], ['มิถุนายน', 'มิ.ย.', 'มิ.ย'],
  ['กรกฎาคม', 'ก.ค.', 'ก.ค'], ['สิงหาคม', 'ส.ค.', 'ส.ค'], ['กันยายน', 'ก.ย.', 'ก.ย'], ['ตุลาคม', 'ต.ค.', 'ต.ค'], ['พฤศจิกายน', 'พ.ย.', 'พ.ย'], ['ธันวาคม', 'ธ.ค.', 'ธ.ค']];
var INB_STATUS = ['pending', 'accepted', 'ignored', 'deleted'];

/* ------------------------------- pure text parsing ------------------------------- */
// (no Google services here, so tests/inbox.test.mjs can run these in plain Node)

/** Thai digits → Arabic digits. */
function inbDigits(s) { return String(s == null ? '' : s).replace(/[๐-๙]/g, function (c) { return String(c.charCodeAt(0) - 0x0E50); }); }

function inbCleanUrl(u) {
  u = String(u || '').trim().replace(/[)\].,;:!?'"”’…]+$/, '');
  return /^https?:\/\/[^\s\/?#]+/i.test(u) && u.length <= 2000 ? u : '';
}
/** Links from the Telegram entities (already extracted by the edge function) plus any found in the text. Max 5, no duplicates. */
function inbUrlsOf(text, given) {
  var out = [], seen = Object.create(null);
  function add(u) { u = inbCleanUrl(u); if (u && !seen[u]) { seen[u] = true; out.push(u); } }
  (Array.isArray(given) ? given : []).forEach(add);
  (String(text || '').match(/https?:\/\/[^\s<>"]+/gi) || []).forEach(add);
  return out.slice(0, 5);
}

/** "ศธ 04010/ว1234", "ที่ มท 0810.3/ว 5678" → "ศธ 04010/ว1234" (digits normalised, spaces tidied). '' when none. */
function inbBookNo(text) {
  var m = /([ก-ฮ]{2,4}\s?\d{3,5}(?:\.\d+)*\s*\/\s*(?:ว\s*)?\d+)/.exec(inbDigits(text));
  return m ? m[1].replace(/\s*\/\s*/, '/').replace(/\s+/g, ' ').replace(/\/ว\s+/, '/ว').trim() : '';
}

function inbMonthRe() {
  var names = [];
  INB_MONTHS.forEach(function (m) { m.forEach(function (n) { names.push(n.replace(/\./g, '\\.')); }); });
  names.sort(function (a, b) { return b.length - a.length; });
  return '(' + names.join('|') + ')';
}
function inbMonthIdx(name) {
  var n = String(name).replace(/\.$/, '');
  for (var i = 0; i < INB_MONTHS.length; i++) for (var j = 0; j < INB_MONTHS[i].length; j++) if (INB_MONTHS[i][j].replace(/\.$/, '') === n) return i + 1;
  return 0;
}
function inbIso(y, mo, d) {
  y = Number(y); mo = Number(mo); d = Number(d);
  if (y < 100) y += 2500;
  if (y > 2400) y -= 543;
  if (!(y >= 1990 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return '';
  var dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1) return '';
  return y + '-' + (mo < 10 ? '0' : '') + mo + '-' + (d < 10 ? '0' : '') + d;
}
/** The letter's date → "yyyy-MM-dd" (Gregorian). Prefers a date written after "ลงวันที่". '' when none. */
function inbBookDate(text) {
  var t = inbDigits(text), mre = inbMonthRe(), m;
  var named = new RegExp('(\\d{1,2})\\s*(?:เดือน\\s*)?' + mre + '\\s*(?:พ\\.ศ\\.?|ค\\.ศ\\.?)?\\s*(\\d{2,4})');
  var after = /ลงวันที่/.exec(t);
  if (after) {
    var tail = t.slice(after.index + 8, after.index + 60);
    m = named.exec(tail); if (m && m.index < 12) return inbIso(m[3], inbMonthIdx(m[2]), m[1]);
    m = /^\s*(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/.exec(tail); if (m) return inbIso(m[3], m[2], m[1]);
  }
  m = named.exec(t); if (m) return inbIso(m[3], inbMonthIdx(m[2]), m[1]);
  return '';
}

function inbSubject(text, docName) {
  var t = String(text || ''), m = /เรื่อง\s*[:：]?\s*([^\n]+)/.exec(t);
  var s = m ? m[1] : '';
  if (!s) {
    var lines = t.split(/\n/).map(function (l) { return l.replace(/https?:\/\/\S+/gi, '').replace(/\s+/g, ' ').trim(); }).filter(function (l) { return l.length >= 4; });
    s = lines[0] || '';
  }
  s = s.replace(/https?:\/\/\S+/gi, '').replace(/\s+/g, ' ').trim();
  if (!s && docName) s = String(docName).replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/[_]+/g, ' ').trim();
  return s.slice(0, 200);
}
function inbFrom(text, chatTitle) {
  var m = /(?:จาก|ผู้ส่ง|ส่งโดย|หน่วยงาน)\s*[:：]\s*([^\n]+)/.exec(String(text || ''));
  return (m ? m[1].trim() : String(chatTitle || '')).slice(0, 120);
}

/** Does this message look like a letter? Needs a link or a file, and (a keyword or a book number) unless captureAll. */
function inbRelevant(text, urls, docName, keywords, captureAll) {
  if (!(urls && urls.length) && !docName) return false;
  if (captureAll) return true;
  var hay = (String(text || '') + ' ' + String(docName || '')).toLowerCase();
  if (inbBookNo(hay)) return true;
  for (var i = 0; i < keywords.length; i++) if (keywords[i] && hay.indexOf(keywords[i]) >= 0) return true;
  return false;
}

/** The fields the clerk starts from. */
function inbParse(text, urls, docName, chatTitle) {
  return { bookNo: inbBookNo(text), bookDate: inbBookDate(text), subject: inbSubject(text, docName) || 'หนังสือจาก Telegram', from: inbFrom(text, chatTitle), urls: inbUrlsOf(text, urls) };
}

/** Same chat key for live updates (-100123…) and Telegram Desktop exports (123…), so an imported history never duplicates live rows. */
function inbChatKey(id) { return String(id == null ? '' : id).replace(/^-100/, '').replace(/^-/, ''); }
function inbUrlKey(u) { return String(u || '').toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/[#].*$/, '').replace(/\/+$/, ''); }

/* ----------------------------------- helpers ----------------------------------- */

function inbStaff(sc) { return sc.admin || listProp('INBOX_STAFF_EMAILS').indexOf(sc.email) >= 0; }
function inbLocked(fn) { return lnkLocked(fn); }
function inbSheet() { return sheetTab('Inbox', INB_HEADERS); }
function inbStampOf(sec) { return sec ? lnkStamp(Number(sec) * 1000) : lnkStamp(Date.now()); }
function inbYearBE() { return Number(Utilities.formatDate(new Date(), LNK_TZ, 'yyyy')) + 543; }

function inbObj(r, row) {
  return { row: row, id: String(r[0]), received: String(r[1] || ''), msgTime: String(r[2] || ''), status: INB_STATUS.indexOf(String(r[3])) >= 0 ? String(r[3]) : 'pending', regNo: String(r[4] || ''), regDate: String(r[5] || ''),
    bookNo: String(r[6] || ''), bookDate: String(r[7] || ''), subject: String(r[8] || ''), from: String(r[9] || ''), urls: String(r[10] || '').split(/\n/).filter(Boolean), file: String(r[11] || ''), text: String(r[12] || ''),
    tags: libTags(String(r[13] || '')), note: String(r[14] || ''), by: String(r[15] || ''), source: String(r[16] || ''), dedup: String(r[17] || '') };
}
function inbRowOf(o) {
  return [o.id, o.received, o.msgTime, o.status, o.regNo, o.regDate, cell(o.bookNo, 60), o.bookDate, cell(o.subject, 300), cell(o.from, 120), o.urls.join('\n'), o.file, cell(o.text, 1500), o.tags.join(', '), cell(o.note, 300), o.by, o.source, o.dedup];
}
function inbPublic(o) {
  return { id: o.id, received: o.received, msgTime: o.msgTime, status: o.status, regNo: o.regNo, regDate: o.regDate, bookNo: o.bookNo, bookDate: o.bookDate, subject: o.subject, from: o.from, urls: o.urls, file: o.file, text: o.text, tags: o.tags, note: o.note, by: o.by, source: o.source.split(':')[0] };
}
/** Write a whole row as TEXT, so Sheets never turns "12/2569" or "2026-10-14" into a date. */
function inbPut(sh, row, vals) {
  var rg = sh.getRange(row, 1, 1, INB_COLS);
  rg.setNumberFormat('@'); rg.setValues([vals]);
}
function inbAll(sh) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  var from = Math.max(2, last - INB_SCAN_ROWS + 1);
  return sh.getRange(from, 1, last - from + 1, INB_COLS).getValues().map(function (r, i) { return inbObj(r, from + i); }).filter(function (o) { return o.id; });
}
function inbLog(email, op, id, extra) {
  try { sheetTab('Logs', LOG_HEADERS).appendRow([new Date(), Utilities.getUuid().slice(0, 8), email, 'inbox', op, 'ok', cell(id, 200), 0, 0, cell(JSON.stringify(extra || {}), 500)]); } catch (x) { console.error('inbLog ' + x); }
}
function inbNewId(taken) {
  for (var n = 0; n < 12; n++) {
    var c = 'i'; for (var i = 0; i < 8; i++) c += LNK_ALPHABET.charAt(Math.floor(Math.random() * LNK_ALPHABET.length));
    if (!taken[c]) return c;
  }
  throw httpError('INTERNAL_RETRY', 'สร้างรหัสไม่สำเร็จ กรุณาลองใหม่');
}
function inbKeywords() {
  var raw = prop('TG_KEYWORDS') || INB_DEFAULT_KEYWORDS;
  return raw.split(',').map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
}

/* ------------------------------- Telegram side (silent) ------------------------------- */

/** Copy an attached file from Telegram into Drive. Returns the Drive URL, or '' (no token, too big, or any error — the row is kept either way). */
function inbFetchDoc(doc, ts) {
  var token = prop('TG_BOT_TOKEN');
  if (!token || !doc || !doc.file_id) return '';
  if (Number(doc.size) > INB_FILE_MAX) return '';
  try {
    var r1 = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/getFile?file_id=' + encodeURIComponent(String(doc.file_id)), { muteHttpExceptions: true });
    var j = JSON.parse(r1.getContentText());
    if (!j || !j.ok || !j.result || !j.result.file_path) return '';
    var r2 = UrlFetchApp.fetch('https://api.telegram.org/file/bot' + token + '/' + j.result.file_path, { muteHttpExceptions: true });
    if (r2.getResponseCode() !== 200) return '';
    var blob = r2.getBlob(); if (blob.getBytes().length > INB_FILE_MAX) return '';
    var name = String(doc.file_name || 'letter.pdf').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '').slice(0, 120) || 'letter.pdf';
    var rootId = prop('DRIVE_FOLDER_ID'); if (!rootId) return '';
    var stamp = Utilities.formatDate(new Date(ts), LNK_TZ, 'yyyy-MM');
    var dir = subFolder(subFolder(DriveApp.getFolderById(rootId), stamp), '_inbox');
    blob.setName(Utilities.formatDate(new Date(ts), LNK_TZ, 'dd-HHmmss') + '_' + name);
    var file = dir.createFile(blob);
    listProp('INBOX_STAFF_EMAILS').concat(listProp('ADMIN_EMAILS')).forEach(function (e) { try { file.addViewer(e); } catch (x) { /* owner already has access */ } });
    libIndexFile(file, '_inbox');
    return file.getUrl();
  } catch (x) { console.error('inbFetchDoc failed'); return ''; }   // never log the exception: its text can contain the bot token
}

/**
 * One message (live from the webhook, or one line of an imported history) → one draft row.
 * item = {chat:{id,title}, mid, date(sec), text, urls[], doc?}.  opts = {download:bool, tag:string, scoped:bool}
 * @returns {{status:'added'|'duplicate'|'ignored', id?:string}}
 */
function inbIngest(item, opts) {
  var text = String(item.text || '').slice(0, 3500), docName = item.doc && item.doc.file_name ? String(item.doc.file_name) : (item.doc ? 'file' : '');
  var urls = inbUrlsOf(text, item.urls);
  if (!inbRelevant(text, urls, docName, inbKeywords(), prop('TG_CAPTURE_ALL') === 'true')) return { status: 'ignored' };
  var chatKey = inbChatKey(item.chat && item.chat.id), mkey = 'm:' + chatKey + ':' + Number(item.mid || 0);
  var ukey = urls.length ? 'u:' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, inbUrlKey(urls[0]))).slice(0, 16) : '';
  function seen(rows) { return rows.some(function (o) { return o.status !== 'deleted' && (o.dedup.indexOf(mkey) >= 0 || (ukey && o.dedup.indexOf(ukey) >= 0)); }); }
  var sh = inbSheet();
  if (seen(inbAll(sh))) return { status: 'duplicate' };
  var p = inbParse(text, urls, docName, item.chat && item.chat.title);
  var tsMs = item.date ? Number(item.date) * 1000 : Date.now();
  var fileUrl = opts && opts.download && item.doc ? inbFetchDoc(item.doc, tsMs) : '';
  return inbLocked(function () {
    var rows = inbAll(sh);
    if (seen(rows)) return { status: 'duplicate' };
    var taken = Object.create(null); rows.forEach(function (o) { taken[o.id] = true; });
    var o = { id: inbNewId(taken), received: lnkStamp(Date.now()), msgTime: inbStampOf(item.date), status: 'pending', regNo: '', regDate: '', bookNo: p.bookNo, bookDate: p.bookDate, subject: p.subject, from: p.from,
      urls: p.urls, file: fileUrl, text: text, tags: [], note: '', by: '', source: (opts && opts.tag || 'tg') + ':' + chatKey + ':' + Number(item.mid || 0), dedup: (mkey + ' ' + ukey).trim() };
    inbPut(sh, sh.getLastRow() + 1, inbRowOf(o));
    return { status: 'added', id: o.id };
  });
}

/** The webhook entry. Only the edge function (which holds EDGE_SECRET) may call it. Always quiet: returns a tiny JSON, nothing is sent to Telegram. */
function inbHook(b) {
  var secret = prop('EDGE_SECRET');
  if (!secret || !safeEqual(String(b.secret || ''), secret)) throw httpError('FORBIDDEN', 'ไม่อนุญาต');
  var u = b.u && typeof b.u === 'object' ? b.u : null;
  if (!u || !u.chat) return { ok: false };
  var allowed = listProp('TG_ALLOWED_CHATS');
  if (!allowed.length || allowed.indexOf(String(u.chat.id).toLowerCase()) < 0) return { ok: false, reason: 'chat' };
  rateLimit('tghook', intProp('TG_LIMIT_PER_MIN', 120));
  var r = inbIngest({ chat: { id: u.chat.id, title: String(u.chat.title || '').slice(0, 120) }, mid: u.mid, date: u.date, text: u.text, urls: u.urls, doc: u.doc }, { download: true, tag: 'tg' });
  if (r.status === 'added') inbLog('telegram', 'capture', r.id, { chat: inbChatKey(u.chat.id), doc: !!u.doc });
  return { ok: r.status === 'added', status: r.status };
}

/* ------------------------------- staff operations ------------------------------- */

function inbox(b) {
  var u = requireUser(b.session), sc = lnkScope(u), op = String(b.op || '');
  if (!inbStaff(sc)) throw httpError('FORBIDDEN', 'เฉพาะเจ้าหน้าที่ธุรการและผู้ดูแลระบบ');
  rateLimit('inbox', intProp('INBOX_LIMIT_PER_MIN', 120));
  switch (op) {
    case 'list':    return inbList(sc, b);
    case 'update':  return inbLocked(function () { return inbUpdate(sc, u, b, false); });
    case 'accept':  return inbLocked(function () { return inbUpdate(sc, u, b, true); });
    case 'ignore':  return inbLocked(function () { return inbSetStatus(sc, u, b, 'ignored'); });
    case 'restore': return inbLocked(function () { return inbSetStatus(sc, u, b, 'pending'); });
    case 'import':  return inbImport(sc, u, b);
    case 'add':     return inbAdd(sc, u, b);
    default: throw httpError('UNKNOWN_ACTION', 'ไม่รู้จักคำสั่งนี้');
  }
}

function inbFind(sh, id) {
  id = String(id || '');
  var all = inbAll(sh);
  for (var i = 0; i < all.length; i++) if (all[i].id === id && all[i].status !== 'deleted') return all[i];
  throw httpError('NOT_FOUND', 'ไม่พบรายการนี้');
}

function inbList(sc, b) {
  var status = INB_STATUS.indexOf(b.status) >= 0 ? b.status : '', q = String(b.q || '').toLowerCase().trim().slice(0, 80), terms = q ? q.split(/\s+/) : [];
  var all = inbAll(inbSheet()).filter(function (o) { return o.status !== 'deleted'; }), counts = { pending: 0, accepted: 0, ignored: 0 };
  all.forEach(function (o) { counts[o.status] = (counts[o.status] || 0) + 1; });
  var items = all.filter(function (o) {
    if (status && o.status !== status) return false;
    if (!terms.length) return true;
    var hay = (o.subject + ' ' + o.bookNo + ' ' + o.regNo + ' ' + o.from + ' ' + o.text + ' ' + o.tags.join(' ') + ' ' + o.note).toLowerCase();
    return terms.every(function (t) { return hay.indexOf(t) >= 0; });
  }).sort(function (a, c) { return a.received < c.received ? 1 : a.received > c.received ? -1 : c.row - a.row; });
  var more = items.length > INB_LIST_MAX;
  return { year: inbYearBE(), counts: counts, items: items.slice(0, INB_LIST_MAX).map(inbPublic), more: more, botConfigured: !!prop('TG_BOT_TOKEN'), chats: listProp('TG_ALLOWED_CHATS').length };
}

function inbCheckUrls(list) {
  var out = [];
  (Array.isArray(list) ? list : String(list || '').split(/\s+/)).forEach(function (x) { x = String(x || '').trim(); if (x) out.push(lnkCheckUrl(x)); });
  return out.slice(0, 5);
}
function inbDateOk(v) {
  v = String(v || '').trim();
  if (!v) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || !inbIso(v.slice(0, 4), v.slice(5, 7), v.slice(8, 10))) throw httpError('BAD_REQUEST', 'วันที่ไม่ถูกต้อง (รูปแบบ ปปปป-ดด-วว)');
  return v;
}
function inbApply(o, b) {
  if (b.subject !== undefined) o.subject = String(b.subject).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 300);
  if (b.bookNo !== undefined) o.bookNo = String(b.bookNo).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 60);
  if (b.bookDate !== undefined) o.bookDate = inbDateOk(b.bookDate);
  if (b.from !== undefined) o.from = String(b.from).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 120);
  if (b.note !== undefined) o.note = String(b.note).slice(0, 300);
  if (b.tags !== undefined) o.tags = libTags(b.tags);
  if (b.urls !== undefined) o.urls = inbCheckUrls(b.urls);
}

/** Next running number of the year: "n/ปี พ.ศ." — highest n already used this year + 1. */
function inbNextNo(rows, yearBE) {
  var max = 0;
  rows.forEach(function (o) {
    var m = /^(\d+)\/(\d{4})$/.exec(o.regNo);
    if (m && Number(m[2]) === yearBE && Number(m[1]) > max) max = Number(m[1]);
  });
  return (max + 1) + '/' + yearBE;
}

function inbUpdate(sc, u, b, accept) {
  var sh = inbSheet(), rows = inbAll(sh), o = null;
  rows.forEach(function (x) { if (x.id === String(b.id || '') && x.status !== 'deleted') o = x; });
  if (!o) throw httpError('NOT_FOUND', 'ไม่พบรายการนี้');
  if (o.status === 'accepted' && typeof sarRegisterFromInbox === 'function') throw httpError('LOCKED', 'หนังสือที่ลงรับแล้วแก้ไขได้ที่หน้า “สารบรรณ” (เพื่อให้ทะเบียนตรงกัน)');
  inbApply(o, b);
  if (accept && o.status !== 'accepted') {
    if (!o.subject) throw httpError('BAD_REQUEST', 'กรุณาระบุเรื่องก่อนรับหนังสือ');
    if (typeof sarRegisterFromInbox === 'function') {
      // Saraban.gs owns the numbering: ONE counter and ONE register for this page and the สารบรรณ page (no duplicate เลขรับ).
      sarRegisterFromInbox(sc, o, b);
    } else {
      var yr = inbYearBE(), no = String(b.no || '').trim();
      if (no) {
        if (!/^\d{1,6}\/\d{4}$/.test(no)) throw httpError('BAD_REQUEST', 'เลขรับต้องอยู่ในรูปแบบ เลข/ปี พ.ศ. เช่น 125/' + yr);
        if (rows.some(function (x) { return x.id !== o.id && x.regNo === no && x.status !== 'deleted'; })) throw httpError('DUPLICATE', 'เลขรับ ' + no + ' ถูกใช้แล้ว');
      } else no = inbNextNo(rows, yr);
      o.regNo = no; o.regDate = Utilities.formatDate(new Date(), LNK_TZ, 'yyyy-MM-dd'); o.status = 'accepted';
    }
  }
  o.by = sc.email;
  inbPut(sh, o.row, inbRowOf(o));
  inbLog(sc.email, accept ? 'accept' : 'update', o.id, { regNo: o.regNo });
  return { item: inbPublic(o) };
}

function inbSetStatus(sc, u, b, status) {
  var sh = inbSheet(), o = inbFind(sh, b.id);
  if (o.status === 'accepted') throw httpError('LOCKED', 'หนังสือที่รับแล้วไม่สามารถยกเลิกได้ (เลขรับถูกใช้ไปแล้ว) — แก้ไขข้อมูลหรือหมายเหตุแทน');
  o.status = status; o.by = sc.email;
  inbPut(sh, o.row, inbRowOf(o));
  inbLog(sc.email, status === 'ignored' ? 'ignore' : 'restore', o.id, {});
  return { item: inbPublic(o) };
}

/** Manual entry (a letter that did not come through Telegram). Goes in as a draft, like the others. */
function inbAdd(sc, u, b) {
  return inbLocked(function () {
    var sh = inbSheet(), rows = inbAll(sh), taken = Object.create(null); rows.forEach(function (x) { taken[x.id] = true; });
    var o = { id: inbNewId(taken), received: lnkStamp(Date.now()), msgTime: '', status: 'pending', regNo: '', regDate: '', bookNo: '', bookDate: '', subject: '', from: '', urls: [], file: '', text: '', tags: [], note: '', by: sc.email, source: 'manual', dedup: '' };
    inbApply(o, b);
    if (!o.subject) throw httpError('BAD_REQUEST', 'กรุณาระบุเรื่อง');
    inbPut(sh, sh.getLastRow() + 1, inbRowOf(o));
    inbLog(sc.email, 'add', o.id, {});
    return { item: inbPublic(o) };
  });
}

/** Older messages: the page reads a Telegram Desktop "Export chat history" file (result.json) and sends the messages in small batches. */
function inbImport(sc, u, b) {
  var items = Array.isArray(b.items) ? b.items.slice(0, 40) : [];
  var res = { added: 0, duplicate: 0, ignored: 0 };
  items.forEach(function (m) {
    var r = inbIngest({ chat: { id: m.chatId, title: String(m.chatTitle || '').slice(0, 120) }, mid: m.mid, date: m.date, text: m.text, urls: m.urls, doc: m.docName ? { file_name: String(m.docName).slice(0, 120) } : null }, { download: false, tag: 'tgx' });
    res[r.status === 'added' ? 'added' : r.status === 'duplicate' ? 'duplicate' : 'ignored']++;
  });
  if (res.added) inbLog(sc.email, 'import', '', res);
  return res;
}

/* ------------------------------------- setup ------------------------------------- */

/** Run ONCE from the editor: creates the Inbox tab. Safe to run again. Then set TG_ALLOWED_CHATS (and TG_BOT_TOKEN) in Script properties. */
function setupInbox() {
  var sh = inbSheet();
  sh.getRange(1, 1, 1, INB_COLS).setFontWeight('bold').setFontColor('#ffffff').setBackground('#0f5c9e');
  sh.setFrozenRows(1); sh.setTabColor('#b45309');
  [90, 150, 150, 80, 90, 100, 150, 120, 320, 180, 320, 260, 320, 140, 220, 200, 160, 220].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.getRange(2, 1, Math.max(sh.getMaxRows() - 1, 1), INB_COLS).setNumberFormat('@');
  var P = PropertiesService.getScriptProperties();
  ['TG_ALLOWED_CHATS', 'TG_BOT_TOKEN', 'INBOX_STAFF_EMAILS'].forEach(function (k) { if (P.getProperty(k) === null) P.setProperty(k, ''); });
  if (!P.getProperty('EDGE_SECRET')) setupLinks();
  console.log('พร้อมใช้งาน — แท็บ Inbox ถูกสร้างแล้ว\nต่อไป: ตั้ง TG_ALLOWED_CHATS (id กลุ่ม เช่น -1001234567890), TG_BOT_TOKEN, INBOX_STAFF_EMAILS ใน Script properties แล้ว Deploy เวอร์ชันใหม่');
}
