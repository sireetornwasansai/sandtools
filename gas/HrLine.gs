/**
 * SAND Office Tools — HrLine.gs   แจ้งเตือน LINE ของระบบบันทึกการปฏิบัติงาน (HR) + หน้าลงลาบนมือถือ
 *
 * What it does
 *   • Friday (time editable)       → report of NEXT week: who recorded leave / ไปราชการ / อบรม / ประชุม      (job "weekly")
 *   • last working day of a month  → leave days of every person, grouped by กลุ่มงาน                          (job "monthend")
 *   • Rich-menu / typed keywords   → "ใครลาวันไหน" (ลา + ไปราชการ แยกรายวัน), "สัปดาห์นี้ใครลา", "สัปดาห์หน้าใครลา", "วันนี้ใครลา", "สรุปลาเดือนนี้"   (webhook → reply, free of quota)
 *   • mobileBoot                   → one small answer for the phone page /leave (me, staff, holidays, who is away this/next week, my records)
 *
 * It reads the same tabs as Hr.gs (HR_Control · Staff · HolidayOverrides) and adds two tabs: LineUsers · LineReportSchedule.
 * It needs Code.gs + Hr.gs in the same project (prop, listProp, rateLimit, safeEqual, httpError, hrBundle, hrIsWorkday, hrTab …).
 *
 * Script properties
 *   LINE_CHANNEL_ACCESS_TOKEN         (required)  long-lived channel access token of the LINE Official Account
 *   LINE_CHANNEL_ACCESS_TOKEN_BACKUP  (optional)  second account, used after switching channel (lineSwitch)
 *   LINE_ACTIVE_CHANNEL               (set by the page) "primary" | "backup"
 *   EDGE_SECRET                       (existing)  the same secret the Vercel edge functions already use — the webhook relay /api/line sends it
 *   HR_LINE_GROUP_IDS                 (optional)  LINE group / room ids that may receive reports and ask questions (case-sensitive, comma separated).
 *                                                 Type "รหัสกลุ่ม" in a group the OA has joined and it answers with the id.
 *   HR_LINE_QUERY_SCOPE               (optional)  "leave" = the typed keywords list only leave; default "all" (leave + ราชการ + อบรม + ประชุม)
 *   HR_LINE_APP_URL                   (optional)  link added at the bottom of reports, e.g. https://sandtools.vercel.app/#/leave
 *   HR_LINE_LIMIT_PER_MIN             (optional)  webhook requests per minute, default 240
 *   HR_LINE_ALIASES                   (optional)  one person recorded under two names → shown as one, e.g.  ทวีศักดิ์ สายเขียว=เอ;ชื่ออื่น=ชื่อที่ใช้   (built in: ทวีศักดิ์ สายเขียว = เอ)
 *   HR_LINE_GROUP_NAMES               (optional)  extra names that are a กลุ่มงาน / คณะกรรมการ, not a person (comma separated). Names starting with "กลุ่มงาน" · "คกก." · "รวมทุกกลุ่มงาน" are always treated so.
 *   HR_LINE_AUTO_ADMIN                (optional)  "false" = a new friend of the OA gets NO role until an admin sets one (default: friends become แอดมิน)
 *
 * Who receives what (column "บทบาท" of tab LineUsers, set by an HR admin in the page /hr-line or in the sheet)
 *   แอดมิน · หัวหน้า · บุคลากร   — a person with NO role gets nothing and may not ask anything (the OA is public: anybody can add it as a friend)
 *   Each report has its own list of roles in tab LineReportSchedule (column "ผู้รับ"); the word "กลุ่ม" = the groups in HR_LINE_GROUP_IDS.
 *
 * One-time setup: run  hrLineSetup()  from the editor (creates the tabs, seeds the schedule, creates the time triggers), then Deploy a NEW version.
 * Privacy: reports never print the NOTE of a leave record (it may name an illness) — only type, dates and, for non-leave records, place / mission.
 */

var HRL_VERSION = '1.3.0';
var HRL_TZ = 'Asia/Bangkok';
var HRL_ROLES = ['แอดมิน', 'หัวหน้า', 'บุคลากร'];
var HRL_GROUP_WORD = 'กลุ่ม';
var HRL_JOBS = [
  { key: 'weekly', label: 'รายงานสัปดาห์ถัดไป (ส่งทุกวันศุกร์)', fn: 'hrLineWeeklyJob', hour: 15, minute: 0, weekday: 'FRIDAY', enabled: true, roles: ['แอดมิน', 'หัวหน้า', 'บุคลากร', 'กลุ่ม'] },
  { key: 'monthend', label: 'สรุปวันลารายกลุ่มงาน (ส่งวันทำการสุดท้ายของเดือน)', fn: 'hrLineMonthEndJob', hour: 16, minute: 0, weekday: '', enabled: true, roles: ['แอดมิน', 'หัวหน้า'] }
];
var HRL_WEEKDAYS = ['', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
var HRL_MON = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
var HRL_MONTH_FULL = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
var HRL_DOW = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
var HRL_GROUPS = [{ k: 'leave', t: '🌴 ลา' }, { k: 'trip', t: '🚗 ไปราชการ' }, { k: 'train', t: '🎓 อบรม' }, { k: 'meet', t: '👥 ประชุม' }, { k: 'other', t: '📌 อื่นๆ' }];
var HRL_QUICK = [['ใครลาวันไหน', 'ใครลาวันไหน'], ['สัปดาห์นี้', 'สัปดาห์นี้ใครลา'], ['สัปดาห์หน้า', 'สัปดาห์หน้าใครลา'], ['วันนี้', 'วันนี้ใครลา'], ['ประชุม', 'ประชุมสัปดาห์นี้']];
var HRL_QUICK_BOSS = [['เดือนหน้า', 'เดือนหน้าใครลา']];                 // only offered to แอดมิน / หัวหน้า (the monthly summary is theirs)
var HRL_ALIASES = { 'ทวีศักดิ์ สายเขียว': 'เอ' };                       // second name → the one shown
var HRL_GROUP_NAME_RE = /^(กลุ่มงาน|คกก\.?|รวมทุกกลุ่มงาน)/;             // a กลุ่มงาน / คณะกรรมการ in the Staff tab is a body that holds meetings, not a person

/* ------------------------------- LINE API (token, push, reply) ------------------------------ */
function hrlProps() { return PropertiesService.getScriptProperties(); }
function hrlToken(which) { return String(hrlProps().getProperty(which === 'backup' ? 'LINE_CHANNEL_ACCESS_TOKEN_BACKUP' : 'LINE_CHANNEL_ACCESS_TOKEN') || '').replace(/[\s"']+/g, ''); }   // a token never contains spaces / line breaks / quotes — they come from copy-paste
function hrlActiveChannel() { var v = hrlProps().getProperty('LINE_ACTIVE_CHANNEL') || 'primary'; return v === 'backup' && hrlToken('backup') ? 'backup' : 'primary'; }
function hrlActiveToken() { return hrlToken(hrlActiveChannel()); }

/** POST to the LINE API → { ok, code, text }. Never throws (a failed notification must not break a request or a trigger). */
function hrlApi(url, body) {
  var token = hrlActiveToken();
  if (!token) return { ok: false, code: 0, text: 'NO_TOKEN' };
  try {
    var res = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', headers: { Authorization: 'Bearer ' + token }, payload: JSON.stringify(body), muteHttpExceptions: true });
    var code = res.getResponseCode();
    if (code >= 300) console.error('LINE API ' + code + ': ' + String(res.getContentText()).slice(0, 300));
    return { ok: code < 300, code: code, text: String(res.getContentText() || '') };
  } catch (e) { console.error('hrlApi: ' + e.message); return { ok: false, code: 0, text: String(e.message) }; }
}
function hrlGetJson(url) {
  var token = hrlActiveToken();
  if (!token) return null;
  try {
    var res = UrlFetchApp.fetch(url, { method: 'get', headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
    return res.getResponseCode() < 300 ? JSON.parse(res.getContentText() || '{}') : null;
  } catch (e) { return null; }
}
/** A reply costs no message quota (the reply token is single-use and short-lived). ≤ 5 messages. */
function hrlReply(replyToken, messages) { return replyToken ? hrlApi('https://api.line.me/v2/bot/message/reply', { replyToken: replyToken, messages: messages.slice(0, 5) }) : { ok: false, code: 0, text: 'NO_TOKEN' }; }
function hrlPush(to, messages) { return hrlApi('https://api.line.me/v2/bot/message/push', { to: to, messages: messages.slice(0, 5) }); }
function hrlMulticast(userIds, messages) {
  var out = [];
  for (var i = 0; i < userIds.length; i += 500) out.push(hrlApi('https://api.line.me/v2/bot/message/multicast', { to: userIds.slice(i, i + 500), messages: messages.slice(0, 5) }));
  return out;
}
function hrlDisplayName(userId) { var p = hrlGetJson('https://api.line.me/v2/bot/profile/' + encodeURIComponent(userId)); return p && p.displayName ? String(p.displayName).slice(0, 80) : ''; }
/** This month's message quota → { available, type, limit, used }  (limit null = unlimited). */
function hrlQuota() {
  if (!hrlActiveToken()) return { available: false };
  var q = hrlGetJson('https://api.line.me/v2/bot/message/quota'), c = hrlGetJson('https://api.line.me/v2/bot/message/quota/consumption');
  if (!q && !c) return { available: false };
  return { available: true, type: q && q.type || '', limit: q && typeof q.value === 'number' ? q.value : null, used: c && typeof c.totalUsage === 'number' ? c.totalUsage : null };
}
function hrlSplit(text, maxLen) {
  text = String(text == null ? '' : text);
  var parts = [];
  while (text.length > maxLen) { var cut = text.lastIndexOf('\n', maxLen); if (cut <= 0) cut = maxLen; parts.push(text.slice(0, cut)); text = text.slice(cut).replace(/^\n/, ''); }
  if (text) parts.push(text);
  return parts;
}
function hrlTextMessages(text, quick) {
  var msgs = hrlSplit(text, 4500).slice(0, 5).map(function (t) { return { type: 'text', text: t }; });
  if (quick && msgs.length) msgs[msgs.length - 1].quickReply = { items: (Array.isArray(quick) ? quick : HRL_QUICK.map(function (q) { return { type: 'action', action: { type: 'message', label: q[0], text: q[1] } }; })).slice(0, 13) };
  return msgs;
}

/* ------------------------------------- users (tab LineUsers) ------------------------------------ */
function hrlGroupIds() { return prop('HR_LINE_GROUP_IDS').split(/[,\s]+/).map(function (s) { return s.trim(); }).filter(Boolean); }
function hrlIsAllowedGroup(id) { var low = String(id || '').toLowerCase(); return !!low && hrlGroupIds().some(function (g) { return g.toLowerCase() === low; }); }
function hrlNow() { return Utilities.formatDate(new Date(), HRL_TZ, 'dd/MM/yyyy HH:mm:ss'); }
function hrlUsers() {
  var sh = hrTab('LUSERS'), out = [];
  hrRead(sh, 7).forEach(function (r, i) {
    var id = String(r[0] == null ? '' : r[0]).trim();
    if (id) out.push({ row: i + 2, userId: id, name: String(r[1] || ''), registered: String(r[2] || ''), status: String(r[3] || '').trim(), lastSeen: String(r[4] || ''), role: String(r[5] || '').trim(), enabled: String(r[6] == null ? '' : r[6]).trim().toUpperCase() !== 'FALSE' });
  });
  return out;
}
function hrlUser(userId) { var us = hrlUsers(); for (var i = 0; i < us.length; i++) if (us[i].userId === userId) return us[i]; return null; }
/** Everybody who adds the OA as a friend becomes a "แอดมิน" automatically (the owner's decision — it is how the office has been running).
 *  Script property HR_LINE_AUTO_ADMIN = "false" goes back to manual role assignment (page /hr-line or the sheet). */
function hrlAutoAdmin() { return prop('HR_LINE_AUTO_ADMIN') !== 'false'; }
/** Adds / refreshes a friend of the OA. Returns true when the person is new.
 *  onFollow = true (the "follow" event, i.e. the person just added / unblocked the OA): a friend with no role yet is made แอดมิน too. */
function hrlRegister(userId, onFollow) {
  var u = hrlUser(userId), sh = hrTab('LUSERS'), now = hrlNow(), auto = hrlAutoAdmin();
  if (u) {
    sh.getRange(u.row, 4, 1, 2).setValues([['active', now]]);
    if (!u.name) { var n = hrlDisplayName(userId); if (n) sh.getRange(u.row, 2).setValue(cell(n, 80)); }
    if (auto && onFollow && !u.role) sh.getRange(u.row, 6).setValue('แอดมิน');
    return false;
  }
  sh.appendRow([userId, cell(hrlDisplayName(userId), 80), now, 'active', now, auto ? 'แอดมิน' : '', 'TRUE']);
  return true;
}
function hrlSetStatus(userId, status) { var u = hrlUser(userId); if (u) hrTab('LUSERS').getRange(u.row, 4).setValue(status); }
/** userIds that may receive a push: not unfollowed, switch not FALSE, role in `roles`. */
function hrlRecipients(roles) {
  return hrlUsers().filter(function (u) { return u.status !== 'ยกเลิก' && u.enabled && roles.indexOf(u.role) >= 0; }).map(function (u) { return u.userId; });
}

/* -------------------------------- sending (users + groups) -------------------------------- */
/** Sends `text` to everybody whose role is in `roles` (+ the configured groups when the list contains "กลุ่ม"). Counts only what LINE accepted. */
function hrlSend(text, roles) {
  var out = { sent: 0, failed: 0, recipients: 0, groups: 0, chunks: 0, truncated: false, error: '' };
  roles = roles || [];
  var users = hrlRecipients(roles), groups = roles.indexOf(HRL_GROUP_WORD) >= 0 ? hrlGroupIds() : [];
  out.recipients = users.length; out.groups = groups.length;
  if (!users.length && !groups.length) { out.error = 'ไม่มีผู้รับตามบทบาท (' + roles.join(', ') + ') — กำหนดบทบาทในหน้า แจ้งเตือน LINE'; return out; }
  if (!hrlActiveToken()) { out.error = 'ยังไม่ได้ตั้ง LINE_CHANNEL_ACCESS_TOKEN ใน Script properties'; return out; }
  var parts = hrlSplit(text, 4500); out.truncated = parts.length > 5; out.chunks = Math.min(5, parts.length);
  var msgs = parts.slice(0, 5).map(function (t) { return { type: 'text', text: t }; });
  var q = hrlQuota(), need = (users.length + groups.length) * msgs.length;
  if (q.available && q.limit !== null && q.used !== null && q.used + need > q.limit) { out.error = 'โควต้าข้อความ LINE เดือนนี้ไม่พอ (ใช้ ' + q.used + '/' + q.limit + ' ต้องการอีก ' + need + ') จึงไม่ส่ง'; out.skipped = 'quota'; return out; }
  if (users.length) hrlMulticast(users, msgs).forEach(function (res, i) { var n = Math.min(500, users.length - i * 500); if (res.ok) out.sent += n; else out.failed += n; });
  groups.forEach(function (g) { var res = hrlPush(g, msgs); if (res.ok) out.sent += 1; else out.failed += 1; });
  if (out.failed) out.error = 'ส่งไม่สำเร็จ ' + out.failed + ' ราย — ดู Apps Script ▸ Executions';
  return out;
}

/* ------------------------------------------ dates ------------------------------------------ */
function hrlD(day) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day); return m ? Number(m[3]) + ' ' + HRL_MON[Number(m[2]) - 1] : ''; }
function hrlDW(day) { return HRL_DOW[hrDow(day)] + ' ' + hrlD(day); }
function hrlBE(day) { return Number(String(day).slice(0, 4)) + 543; }
function hrlRange(a, b) {
  if (!b || a === b) return hrlD(a);
  if (a.slice(0, 7) === b.slice(0, 7)) return Number(a.slice(8)) + '–' + hrlD(b);
  return hrlD(a) + ' – ' + hrlD(b);
}
function hrlMonday(day) { var w = hrDow(day); return hrAddDays(day, w === 0 ? -6 : 1 - w); }
function hrlNum(n) { n = Math.round(n * 10) / 10; return n % 1 ? n.toFixed(1) : String(n); }
function hrlDeptShort(d) { d = String(d || ''); return d === 'รวมทุกกลุ่มงาน' ? '' : d.replace(/^กลุ่มงาน/, ''); }
function hrlIsLastWorkday(day, holidays) {
  if (!hrIsWorkday(day, holidays)) return false;
  var ym = day.slice(0, 7), d = hrAddDays(day, 1);
  while (d.slice(0, 7) === ym) { if (hrIsWorkday(d, holidays)) return false; d = hrAddDays(d, 1); }
  return true;
}
function hrlHasWorkday(start, end, from, to, holidays) {
  var d = start > from ? start : from, last = end < to ? end : to, g = 0;
  while (d <= last && g++ < 400) { if (hrIsWorkday(d, holidays)) return true; d = hrAddDays(d, 1); }
  return false;
}

/* ---------------------------------- names: alias + กลุ่มงาน ≠ คน ---------------------------------- */
function hrlAliases() {
  var map = {}, k; for (k in HRL_ALIASES) map[k] = HRL_ALIASES[k];
  String(prop('HR_LINE_ALIASES') || '').split(/[;\n]+/).forEach(function (pair) { var i = pair.indexOf('='); if (i > 0) { var a = pair.slice(0, i).trim(), b = pair.slice(i + 1).trim(); if (a && b) map[a] = b; } });
  return map;
}
/** The one name a person is shown under (ทวีศักดิ์ สายเขียว → เอ). */
function hrlCanon(name) { name = String(name == null ? '' : name).trim(); var a = hrlAliases(); return Object.prototype.hasOwnProperty.call(a, name) ? a[name] : name; }
/** True for a กลุ่มงาน / คกก. / รวมทุกกลุ่มงาน — a body that is recorded in meetings, never counted as a person. */
function hrlIsGroupName(name) {
  name = String(name == null ? '' : name).trim(); if (!name) return false;
  if (HRL_GROUP_NAME_RE.test(name)) return true;
  return String(prop('HR_LINE_GROUP_NAMES') || '').split(/[,;\n]+/).some(function (g) { return g.trim() && g.trim() === name; });
}
/** Half day: the note says บ่าย / เช้า (the phone page writes "(บ่าย) …"), otherwise the start time decides (12:00 or later = afternoon). */
function hrlAfternoon(half, note, st) {
  if (!half) return false; note = String(note || '');
  if (note.indexOf('บ่าย') >= 0) return true; if (note.indexOf('เช้า') >= 0) return false;
  return !!st && String(st) >= '12:00';
}

/* ------------------------------------ who is away (data) ------------------------------------ */
function hrlGroupOf(type) {
  if (HR_LEAVE_CATS.indexOf(type) >= 0) return 'leave';
  if (type === 'ไปราชการ') return 'trip';
  if (type === 'อบรม') return 'train';
  if (HR_MEETING_TYPES.indexOf(type) >= 0) return 'meet';
  return 'other';
}
/**
 * Records that touch [from, to] → { from, to, items, holidays, over, people }.
 * A leave that only covers weekends / holidays of the range is left out. The note of a LEAVE is never copied (privacy).
 * opts.only = 'leave' keeps just the leave group.
 */
function hrlRangeData(pre, from, to, opts) {
  opts = opts || {};
  var items = [], names = {}, holidays = [], d, g = 0;
  pre.recs.forEach(function (x) {
    if (!x.name || !x.start || x.end < from || x.start > to) return;
    var group = hrlGroupOf(x.type), nm = hrlCanon(x.name);
    if (opts.only && opts.only !== group) return;
    if (group === 'leave' && !hrlHasWorkday(x.start, x.end, from, to, pre.holidays)) return;
    var half = x.type.indexOf('ครึ่งวัน') >= 0;
    items.push({ name: nm, isGroup: hrlIsGroupName(nm), dept: x.dept, deptShort: hrlDeptShort(x.dept), type: x.type, group: group, start: x.start, end: x.end, st: x.st, et: x.et, half: half, afternoon: hrlAfternoon(half, x.note, x.st),
      province: x.province, mission: x.mission, note: group === 'leave' ? '' : String(x.note || '').slice(0, 80) });
    if (!hrlIsGroupName(nm)) names[nm] = 1;
  });
  var order = {}; HRL_GROUPS.forEach(function (gr, i) { order[gr.k] = i; });
  items.sort(function (a, b) { return order[a.group] - order[b.group] || (a.start < b.start ? -1 : a.start > b.start ? 1 : 0) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0); });
  for (d = from; d <= to && g++ < 62; d = hrAddDays(d, 1)) if (pre.holidays[d]) holidays.push({ date: d, name: pre.holidays[d] });
  var load = hrLeaveLoad(pre.recs, pre.holidays, from), over = [];
  Object.keys(load).forEach(function (k) {
    var p = k.split('|'); if (p[0] > to || p[0] < from || load[k] < HR_MAX_LEAVE) return;
    over.push({ date: p[0], dept: p[1], deptShort: hrlDeptShort(p[1]), n: load[k] });
  });
  over.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  return { from: from, to: to, items: items, holidays: holidays, over: over, people: Object.keys(names).length };
}
function hrlWeekRange(pre, monday, opts) { return hrlRangeData(pre, monday, hrAddDays(monday, 6), opts); }

/* ------------------------------------ report text (LINE) ------------------------------------ */
/** Half day: ◐ (left half filled) = ครึ่งเช้า · ◑ (right half filled) = ครึ่งบ่าย — the circle reads like the day split in two, morning on the left, afternoon on the right. */
function hrlTypeLabel(it) {
  if (!it.half) return it.type;
  return String(it.type).replace('ครึ่งวัน', '').trim() + (it.afternoon ? ' ◑ ครึ่งบ่าย' : ' ◐ ครึ่งเช้า');
}
function hrlItemLine(it) {
  var parts = [it.name + (it.deptShort ? ' (' + it.deptShort + ')' : '')];
  if (it.group !== 'trip' && it.group !== 'train') parts.push(hrlTypeLabel(it));
  parts.push(hrlRange(it.start, it.end) + (it.st && it.et ? ' ' + it.st + '–' + it.et : ''));
  if (it.group === 'trip' && it.province) parts.push(it.province);
  var detail = it.group === 'leave' ? '' : (it.mission || it.note);
  if (detail) parts.push(String(detail).slice(0, 60));
  return '• ' + parts.join(' · ');
}
function hrlFooter() { var u = prop('HR_LINE_APP_URL'); return u ? '\n🔗 ' + u : ''; }
/** title e.g. "สัปดาห์หน้า"; label e.g. "26–30 ต.ค. 2569". */
function hrlRangeText(data, title, label, empty, note) {
  var L = ['📅 ' + [title, label].filter(Boolean).join(' ')];
  if (note) L.push(note);
  if (!data.items.length) { L.push('', empty || '✅ ยังไม่มีผู้บันทึกลา ไปราชการ อบรม หรือประชุมในช่วงนี้'); }
  else L.push('มี ' + data.items.length + ' รายการ · ' + data.people + ' คน');
  if (data.holidays.length) { L.push('', '🎌 วันหยุดราชการ'); data.holidays.forEach(function (h) { L.push('• ' + hrlDW(h.date) + ' — ' + h.name); }); }
  HRL_GROUPS.forEach(function (gr) {
    var rows = data.items.filter(function (it) { return it.group === gr.k; });
    if (!rows.length) return;
    L.push('', gr.t + ' (' + rows.length + ')'); rows.forEach(function (it) { L.push(hrlItemLine(it)); });
  });
  if (data.over.length) { L.push('', '⚠️ ผู้ลาครบโควต้า (' + HR_MAX_LEAVE + ' คน/กลุ่มงาน/วัน)'); data.over.forEach(function (o) { L.push('• ' + hrlDW(o.date) + ' — ' + (o.deptShort || 'ทุกกลุ่มงาน') + ' ' + o.n + ' คน'); }); }
  return L.join('\n') + hrlFooter();
}
/**
 * "ใครลาวันไหน" (rich-menu button) — leave AND official duty (ไปราชการ / อบรม / ประชุม) listed DAY BY DAY.
 * Window: today → Sunday of NEXT week (so it always covers "rest of this week + next week"); Script property HR_LINE_WHO_DAYS (1–60) = a fixed number of days from today instead.
 * Only working days are listed (a leave that touches only weekends / holidays is skipped, like the weekly report). The note of a LEAVE is never shown (privacy).
 */
var HRL_ICON = { leave: '🌴', trip: '🚗', train: '🎓', meet: '👥', other: '📌' };
function hrlWhoWindow(today) {
  var n = Number(prop('HR_LINE_WHO_DAYS'));
  return { from: today, to: isFinite(n) && n >= 1 && n <= 60 ? hrAddDays(today, Math.floor(n) - 1) : hrAddDays(hrlMonday(today), 13) };
}
function hrlByDayLine(it, day) {
  var who = it.name + (it.deptShort ? ' (' + it.deptShort + ')' : ''), what;
  if (it.group === 'leave') what = hrlTypeLabel(it);
  else if (it.group === 'trip') what = 'ไปราชการ' + (it.province ? ' ' + it.province : '') + (it.mission || it.note ? ' · ' + String(it.mission || it.note).slice(0, 60) : '');
  else { var d2 = String(it.mission || it.note || '').slice(0, 60); what = d2 && d2.indexOf(it.type) === 0 ? d2 : it.type + (d2 ? ' · ' + d2 : ''); }
  var tail = (it.st && it.et ? ' ' + it.st + '–' + it.et : '') + (it.end > day ? ' (ถึง ' + hrlD(it.end) + ')' : '');
  return HRL_ICON[it.group] + ' ' + who + ' — ' + what + tail;
}
function hrlByDayText(pre, today, only) {
  var w = hrlWhoWindow(today), data = hrlRangeData(pre, w.from, w.to, { only: only }), L = ['📅 ใครลา / ไปราชการ วันไหน', hrlRange(w.from, w.to) + ' ' + hrlBE(w.to)], shown = 0, g = 0, d, names = {};
  var order = {}; HRL_GROUPS.forEach(function (gr, i) { order[gr.k] = i; });
  var days = [];
  for (d = w.from; d <= w.to && g++ < 62; d = hrAddDays(d, 1)) {
    var day = d, rows = data.items.filter(function (it) {
      if (it.start > day || it.end < day) return false;
      return hrIsWorkday(day, pre.holidays) || (it.group !== 'leave' && it.start === it.end);
    });
    if (!rows.length) continue;
    rows.sort(function (a, b) { return order[a.group] - order[b.group] || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0); });
    rows.forEach(function (it) { if (!it.isGroup) names[it.name] = 1; shown++; });
    days.push({ day: day, rows: rows });
  }
  if (!days.length) L.push('', '✅ ยังไม่มีผู้บันทึกลา ไปราชการ อบรม หรือประชุมในช่วงนี้');
  else L.push('มี ' + Object.keys(names).length + ' คน · ' + data.items.length + ' รายการ');
  if (data.holidays.length) { L.push('', '🎌 วันหยุดราชการ'); data.holidays.forEach(function (h) { L.push('• ' + hrlDW(h.date) + ' — ' + h.name); }); }
  days.forEach(function (x) {
    var n = x.rows.filter(function (it) { return !it.isGroup; }).length;
    L.push('', '🗓 ' + hrlDW(x.day) + (x.day === today ? ' (วันนี้)' : '') + ' — ' + (n || !x.rows.length ? n + ' คน' : x.rows.length + ' รายการ'));
    x.rows.forEach(function (it) { L.push(hrlByDayLine(it, x.day)); });
  });
  if (data.over.length) { L.push('', '⚠️ ผู้ลาครบโควต้า (' + HR_MAX_LEAVE + ' คน/กลุ่มงาน/วัน)'); data.over.forEach(function (o) { L.push('• ' + hrlDW(o.date) + ' — ' + (o.deptShort || 'ทุกกลุ่มงาน') + ' ' + o.n + ' คน'); }); }
  return L.join('\n') + hrlFooter();
}
function hrlQueryOnly() { return prop('HR_LINE_QUERY_SCOPE') === 'leave' ? 'leave' : ''; }
function hrlWeekTextFor(pre, monday, title, opts) {
  var data = hrlWeekRange(pre, monday, opts), fri = hrAddDays(monday, 4);
  return hrlRangeText(data, title, hrlRange(monday, fri) + ' ' + hrlBE(fri));
}

/* ------------------------------ meetings of one week ------------------------------ */
/** "ประชุมสัปดาห์นี้": only meetings, the same meeting (type + day + time + topic) merged into one line, day by day, with who attends. กลุ่มงาน / คกก. are the body, not attendees. */
function hrlMeetText(pre, monday, title) {
  var fri = hrAddDays(monday, 4), today = hrToday(), data = hrlRangeData(pre, monday, hrAddDays(monday, 6), { only: 'meet' }), by = {}, list = [], L, lastDay = '';
  data.items.forEach(function (it) {
    var detail = String(it.mission || it.note || '').slice(0, 60), key = [it.type, it.start, it.end, it.st, it.et, detail].join('|'), m = by[key];
    if (!m) { m = by[key] = { type: it.type, start: it.start, end: it.end, st: it.st, et: it.et, detail: detail, day: it.start > monday ? it.start : monday, people: [], bodies: [] }; list.push(m); }
    var to = it.isGroup ? m.bodies : m.people; if (to.indexOf(it.name) < 0) to.push(it.name);
  });
  list.sort(function (a, b) { return a.day < b.day ? -1 : a.day > b.day ? 1 : (a.st || '') < (b.st || '') ? -1 : (a.st || '') > (b.st || '') ? 1 : a.type < b.type ? -1 : a.type > b.type ? 1 : 0; });
  L = ['👥 ' + title + ' ' + hrlRange(monday, fri) + ' ' + hrlBE(fri)];
  if (!list.length) L.push('', '✅ ยังไม่มีการประชุมที่บันทึกไว้ในช่วงนี้');
  else L.push('มี ' + list.length + ' การประชุม');
  if (data.holidays.length) { L.push('', '🎌 วันหยุดราชการ'); data.holidays.forEach(function (h) { L.push('• ' + hrlDW(h.date) + ' — ' + h.name); }); }
  list.forEach(function (m) {
    if (m.day !== lastDay) { L.push('', '🗓 ' + hrlDW(m.day) + (m.day === today ? ' (วันนี้)' : '')); lastDay = m.day; }
    m.people.sort();
    var who = m.people.length ? ' — ' + m.people.length + ' คน: ' + m.people.slice(0, 6).join(', ') + (m.people.length > 6 ? ' และอีก ' + (m.people.length - 6) + ' คน' : '') : '';
    L.push('• ' + m.type + (m.bodies.length ? ' (' + m.bodies.join(', ') + ')' : '') + (m.st && m.et ? ' · ' + m.st + '–' + m.et : '') + (m.end > m.start ? ' · ' + hrlRange(m.start, m.end) : '') + who);
    if (m.detail) L.push('  ↳ ' + m.detail);
  });
  return L.join('\n') + hrlFooter();
}

/* ------------------------------ month summary (per กลุ่มงาน) ------------------------------ */
var HRL_LEAVE_KEYS = [['ลาป่วย', 'ป่วย'], ['ลากิจ', 'กิจ'], ['ลาพักผ่อน', 'พักผ่อน'], ['ลาไปเรียน', 'เรียน']];
function hrlMonthData(y, m) {
  var rows = hrMonthlySummary(y, m), staff = hrStaffList(), deptOf = {}, people = {}, order = [];
  staff.forEach(function (s) {                                       // a กลุ่มงาน / คกก. in the Staff tab is not a person; a second name of one person is merged
    var n = hrlCanon(s.name); if (hrlIsGroupName(n)) return;
    if (!deptOf[n]) deptOf[n] = s.department;
    if (!people[n]) { people[n] = { name: n, dept: s.department, parts: {}, leave: 0, trip: 0, train: 0, meet: 0 }; order.push(n); }
  });
  rows.forEach(function (r) {
    var n = hrlCanon(r.name); if (hrlIsGroupName(n)) return;
    var p = people[n];
    if (!p) { p = people[n] = { name: n, dept: r.department, parts: {}, leave: 0, trip: 0, train: 0, meet: 0 }; order.push(n); }
    HRL_LEAVE_KEYS.forEach(function (k) { var v = Number(r[k[0]]) || 0; if (v) { p.parts[k[1]] = (p.parts[k[1]] || 0) + v; p.leave += v; } });
    p.trip += Number(r['ไปราชการ']) || 0; p.train += Number(r['อบรม']) || 0;
  });
  var depts = HR_REAL_DEPARTMENTS.slice(), byDept = {};
  order.forEach(function (n) { var p = people[n], d = HR_REAL_DEPARTMENTS.indexOf(deptOf[n]) >= 0 ? deptOf[n] : (HR_REAL_DEPARTMENTS.indexOf(p.dept) >= 0 ? p.dept : 'ไม่ระบุกลุ่มงาน'); if (depts.indexOf(d) < 0) depts.push(d); (byDept[d] = byDept[d] || []).push(p); });
  return { year: y, month: m, depts: depts.filter(function (d) { return (byDept[d] || []).length; }).map(function (d) {
    var list = byDept[d], away = list.filter(function (p) { return p.leave > 0; }).sort(function (a, b) { return b.leave - a.leave || (a.name < b.name ? -1 : 1); });
    var none = list.filter(function (p) { return !(p.leave > 0); }).map(function (p) { return p.name; }).sort();
    return { dept: d, total: away.reduce(function (s, p) { return s + p.leave; }, 0), headcount: list.length, away: away, none: none };
  }) };
}
function hrlMonthText(data, note) {
  var L = ['📊 สรุปวันลาประจำเดือน' + HRL_MONTH_FULL[data.month - 1] + ' ' + (data.year + 543), 'นับเฉพาะวันทำการ · ครึ่งวัน = 0.5 วัน'];
  if (note) L.push(note);
  if (!data.depts.length) L.push('', '✅ ไม่มีบันทึกในเดือนนี้');
  data.depts.forEach(function (d) {
    L.push('', '🏢 ' + (hrlDeptShort(d.dept) ? 'กลุ่มงาน' + hrlDeptShort(d.dept) : d.dept) + ' — ลารวม ' + hrlNum(d.total) + ' วัน (' + d.away.length + ' จาก ' + d.headcount + ' คน)');
    d.away.forEach(function (p) {
      var det = HRL_LEAVE_KEYS.filter(function (k) { return p.parts[k[1]]; }).map(function (k) { return k[1] + ' ' + hrlNum(p.parts[k[1]]); }).join(' · ');
      var extra = (p.trip ? ' · ราชการ ' + hrlNum(p.trip) : '') + (p.train ? ' · อบรม ' + hrlNum(p.train) : '');
      L.push('• ' + p.name + ' — ' + hrlNum(p.leave) + ' วัน (' + det + ')' + extra);
    });
    if (d.none.length) L.push(d.none.length <= 12 ? 'ไม่มีวันลา: ' + d.none.join(', ') : 'ไม่มีวันลา ' + d.none.length + ' คน');
  });
  return L.join('\n') + hrlFooter();
}

/* ---------------------------------- schedule (tab LineReportSchedule) ---------------------------------- */
function hrlRolesIn(s) { return String(s || '').split(/[,،\s]+/).map(function (x) { return x.trim(); }).filter(function (x) { return HRL_ROLES.indexOf(x) >= 0 || x === HRL_GROUP_WORD; }); }
function hrlJobDef(key) { for (var i = 0; i < HRL_JOBS.length; i++) if (HRL_JOBS[i].key === key) return HRL_JOBS[i]; return null; }
function hrlScheduleSheet() {
  var sh = hrTab('LSCHED');
  if (sh.getLastRow() <= 1) HRL_JOBS.forEach(function (j) { sh.appendRow([j.key, j.label, j.hour, j.minute, j.weekday, j.enabled ? 'TRUE' : 'FALSE', j.roles.join(',')]); });
  return sh;
}
function hrlScheduleAll() {
  var rows = hrRead(hrlScheduleSheet(), 7), byKey = {};
  rows.forEach(function (r, i) { byKey[String(r[0]).trim()] = { r: r, row: i + 2 }; });
  return HRL_JOBS.map(function (j) {
    var hit = byKey[j.key], r = hit && hit.r;
    var hour = r ? Number(r[2]) : j.hour, minute = r ? Number(r[3]) : j.minute;
    var roles = r ? hrlRolesIn(r[6]) : j.roles.slice();
    return { key: j.key, label: j.label, fn: j.fn, row: hit ? hit.row : 0, hour: isFinite(hour) && hour >= 0 && hour <= 23 ? hour : j.hour, minute: isFinite(minute) && minute >= 0 && minute <= 59 ? minute : j.minute,
      weekday: r ? (HRL_WEEKDAYS.indexOf(String(r[4]).trim()) >= 0 ? String(r[4]).trim() : j.weekday) : j.weekday, enabled: r ? String(r[5]).trim().toUpperCase() !== 'FALSE' : j.enabled, roles: roles.length || !r ? roles : j.roles.slice() };
  });
}
function hrlSchedule(key) { var all = hrlScheduleAll(); for (var i = 0; i < all.length; i++) if (all[i].key === key) return all[i]; return null; }
/** items: [{ key, hour, minute, weekday, enabled, roles[] }] → saved to the sheet, then the triggers are rebuilt. */
function hrlSaveSchedule(items) {
  if (!Array.isArray(items) || !items.length) throw httpError('BAD_REQUEST', 'ไม่มีข้อมูลตารางเวลา');
  var sh = hrlScheduleSheet();
  items.forEach(function (it) {
    var def = hrlJobDef(String(it && it.key)); if (!def) return;
    var hour = Math.round(Number(it.hour)), minute = Math.round(Number(it.minute)), wd = String(it.weekday || '').trim();
    if (!(hour >= 0 && hour <= 23) || !(minute >= 0 && minute <= 59)) throw httpError('BAD_REQUEST', 'เวลาไม่ถูกต้อง');
    if (HRL_WEEKDAYS.indexOf(wd) < 0) throw httpError('BAD_REQUEST', 'วันไม่ถูกต้อง');
    if (def.key === 'weekly' && !wd) throw httpError('BAD_REQUEST', 'รายงานสัปดาห์ต้องเลือกวันที่ส่ง');
    var roles = hrlRolesIn(Array.isArray(it.roles) ? it.roles.join(',') : it.roles);
    var cur = hrlSchedule(def.key), vals = [[def.key, def.label, hour, minute, def.key === 'monthend' ? '' : wd, it.enabled ? 'TRUE' : 'FALSE', roles.join(',')]];
    if (cur && cur.row) sh.getRange(cur.row, 1, 1, 7).setValues(vals); else sh.appendRow(vals[0]);
  });
  return hrlRebuildTriggers();
}
function hrlRebuildTriggers() {
  var fns = HRL_JOBS.map(function (j) { return j.fn; }), made = [];
  ScriptApp.getProjectTriggers().forEach(function (t) { if (fns.indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t); });
  hrlScheduleAll().forEach(function (cfg) {
    if (!cfg.enabled) return;
    var b = ScriptApp.newTrigger(cfg.fn).timeBased();
    // month-end has no "last day" trigger in Apps Script: it ticks every day and hrLineMonthEndJob decides whether today is the one
    b = cfg.key !== 'monthend' && cfg.weekday && ScriptApp.WeekDay[cfg.weekday] ? b.onWeekDay(ScriptApp.WeekDay[cfg.weekday]) : b.everyDays(1);
    b.atHour(cfg.hour).nearMinute(cfg.minute).create();
    made.push({ key: cfg.key, fn: cfg.fn, hour: cfg.hour, minute: cfg.minute, weekday: cfg.key === 'monthend' ? 'ทุกวัน (ส่งเฉพาะวันทำการสุดท้ายของเดือน)' : cfg.weekday });
  });
  return made;
}
function hrlTriggerList() {
  var fns = HRL_JOBS.map(function (j) { return j.fn; });
  return ScriptApp.getProjectTriggers().filter(function (t) { return fns.indexOf(t.getHandlerFunction()) >= 0; }).map(function (t) { return t.getHandlerFunction(); });
}

/* --------------------------------------- jobs (triggers) --------------------------------------- */
function hrLineWeeklyJob() { return hrlRunJob('weekly', {}); }
function hrLineMonthEndJob() { return hrlRunJob('monthend', {}); }
/**
 * opts.force  = true → send now even when the report is switched off / today is not the day (the "send now" button)
 * opts.year / opts.month → month report of another month
 */
function hrlRunJob(key, opts) {
  opts = opts || {};
  var cfg = hrlSchedule(key);
  if (!cfg) return { status: 'skipped', reason: 'unknown' };
  if (!opts.force && !cfg.enabled) return { status: 'skipped', reason: 'disabled' };
  var today = hrToday(), pre = hrBundle(), text, tag = '';
  if (key === 'weekly') {
    var nextMon = hrAddDays(hrlMonday(today), 7);
    text = hrlWeekTextFor(pre, nextMon, 'รายงานสัปดาห์หน้า', {});
  } else {
    var y = opts.year || Number(today.slice(0, 4)), m = opts.month || Number(today.slice(5, 7)), ym = y + '-' + hrPad(m);
    if (!opts.force) {
      if (!hrlIsLastWorkday(today, pre.holidays)) return { status: 'skipped', reason: 'not-last-workday' };
      if (hrlProps().getProperty('HRL_SENT_MONTH') === ym) return { status: 'skipped', reason: 'already-sent' };
    }
    text = hrlMonthText(hrlMonthData(y, m)); tag = ym;
  }
  var res = hrlSend(text, cfg.roles);
  if (key === 'monthend' && !opts.force && res.sent > 0) hrlProps().setProperty('HRL_SENT_MONTH', tag);
  try { hrAudit({ email: 'system' }, 'line:' + key, 'sent ' + res.sent + '/failed ' + res.failed + (res.error ? ' ' + res.error : '')); } catch (x) { /* logging only */ }
  console.log('hrLine ' + key + ' → ' + JSON.stringify(res));
  return { status: res.error && !res.sent ? 'error' : 'ok', result: res };
}
/** Run once from the editor. */
function hrLineSetup() {
  hrColsReset(); hrTab('LUSERS'); hrlScheduleSheet();
  var made = hrlRebuildTriggers();
  console.log('HrLine พร้อมใช้งาน — triggers: ' + JSON.stringify(made) + ' | webhook: ตั้ง /api/line ใน LINE Developers แล้วดู docs/LINE-HR.md');
  return made;
}
/** Editor test: sends next week's report to the แอดมิน role only. */
function hrLineTestAdmins() { var pre = hrBundle(); var r = hrlSend(hrlWeekTextFor(pre, hrAddDays(hrlMonday(hrToday()), 7), 'ทดสอบ รายงานสัปดาห์หน้า', {}), ['แอดมิน']); console.log(JSON.stringify(r)); return r; }

/* ----------------------------------- webhook (from /api/line) ----------------------------------- */
function hrlSeen(id) {
  var cache = CacheService.getScriptCache(), key = 'hrl:ev:' + id;
  if (cache.get(key)) return true;
  cache.put(key, '1', 600); return false;
}
/** Valid calendar day in 2020–2100 → 'yyyy-MM-dd', else ''. */
function hrlValidDay(s) {
  var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(s || '')); if (!m) return '';
  var y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (y < 2020 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  var dt = new Date(Date.UTC(y, mo - 1, d)); if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return '';
  return y + '-' + ('0' + mo).slice(-2) + '-' + ('0' + d).slice(-2);
}
/** Month name (short with/without dots, or full) → 1..12, else 0. */
function hrlMonthIdx(s) {
  s = String(s || '').replace(/\./g, '').replace(/^เดือน/, '');
  for (var i = 0; i < 12; i++) if (s === HRL_MON[i].replace(/\./g, '') || s === HRL_MONTH_FULL[i]) return i + 1;
  return 0;
}
/** d / m / optional year (พ.ศ. or ค.ศ., 2 or 4 digits) → 'yyyy-MM-dd'. No year = this year, or next year when that would be long past. */
function hrlResolveDay(d, mo, y, today) {
  var ty = Number(today.slice(0, 4)), c;
  if (y === undefined || y === null || y === '') {
    c = hrlValidDay(ty + '-' + mo + '-' + d);
    if (c && c < hrAddDays(today, -120)) c = hrlValidDay((ty + 1) + '-' + mo + '-' + d);
    return c;
  }
  y = Number(y); if (y < 100) y = y >= 50 ? 1957 + y : 2000 + y; else if (y > 2400) y -= 543;
  return hrlValidDay(y + '-' + mo + '-' + d);
}
var HRL_WD_WORDS = [['วันอาทิตย์', 0], ['จันทร์', 1], ['อังคาร', 2], ['พุธ', 3], ['พฤหัสบดี', 4], ['พฤหัส', 4], ['ศุกร์', 5], ['เสาร์', 6]];
/** A day named in the (space-free, lower-case) text → 'yyyy-MM-dd' or ''.
 *  พรุ่งนี้ · มะรืน · เมื่อวาน · วันพุธ (next one; "…หน้า" = that day next week) · 5 พ.ย. · 5 พฤศจิกายน 2569 · 5/11 · 5/11/69 · 2026-11-05 · วันที่ 5 */
function hrlParseDay(t, today) {
  t = String(t).replace(/[๐-๙]/g, function (c) { return String('๐๑๒๓๔๕๖๗๘๙'.indexOf(c)); });
  var m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m) { var yy = Number(m[1]); return hrlValidDay((yy > 2400 ? yy - 543 : yy) + '-' + m[2] + '-' + m[3]); }
  if (/มะรืน/.test(t)) return hrAddDays(today, 2);
  if (/พรุ่ง/.test(t)) return hrAddDays(today, 1);
  if (/เมื่อวาน/.test(t)) return hrAddDays(today, -1);
  var names = HRL_MON.map(function (x) { return x.replace(/\./g, '\\.?'); }).concat(HRL_MONTH_FULL).concat(HRL_MON.map(function (x) { return x.replace(/\./g, ''); }));
  names.sort(function (a, b) { return b.length - a.length; });
  m = new RegExp('(\\d{1,2})(?:วันที่|เดือน)?(' + names.join('|') + ')(?:พ\\.?ศ\\.?|ค\\.?ศ\\.?|ปี)?(\\d{4}|\\d{2})?(?!\\d)').exec(t);
  if (m && hrlMonthIdx(m[2].replace(/\\\./g, ''))) return hrlResolveDay(m[1], hrlMonthIdx(m[2]), m[3], today);
  m = /(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{4}|\d{2}))?(?!\d)/.exec(t);
  if (m) return hrlResolveDay(m[1], m[2], m[3], today);
  for (var i = 0; i < HRL_WD_WORDS.length; i++) {
    if (t.indexOf(HRL_WD_WORDS[i][0]) < 0) continue;
    var wd = HRL_WD_WORDS[i][1], dw = hrDow(today);
    if (/(หน้า|ถัดไป|next)/.test(t)) return hrAddDays(hrlMonday(today), 7 + (wd + 6) % 7);
    return hrAddDays(today, (wd - dw + 7) % 7);
  }
  m = /วันที่(\d{1,2})(?!\d)/.exec(t);
  if (m) return hrlResolveDay(m[1], Number(today.slice(5, 7)), String(today.slice(0, 4)), today);
  return '';
}
/** Text typed (or sent by a rich-menu button) → 'thisweek' | 'nextweek' | 'today' | 'byday' | 'month' | 'dayask' | 'day:yyyy-MM-dd' | 'groupid' | 'help' | ''. */
function hrlParseText(text) {
  var t = String(text == null ? '' : text).replace(/\s+/g, '').toLowerCase();
  if (!t) return '';
  if (/^(รหัสกลุ่ม|ไอดีกลุ่ม|groupid)$/.test(t)) return 'groupid';
  if (/^(เมนู|คำสั่ง|ช่วยเหลือ|help|วิธีใช้)$/.test(t)) return 'help';
  if (/^(ใครลา)?(วันอะไร|วันที่|เลือกวัน|เลือกวันที่)(บ้าง)?$/.test(t)) return 'dayask';
  if (/(เดือนหน้า|เดือนถัดไป|nextmonth)/.test(t) && /(ลา|ใคร|สรุป)/.test(t)) return 'nextmonth';
  if (/เดือนนี้/.test(t) && /(ลา|ใคร)/.test(t) && !/ประชุม/.test(t)) return 'month';
  if (/ประชุม/.test(t) && !/สรุป/.test(t) && (/(สัปดาห์|week)/.test(t) || (/อาทิตย์/.test(t) && !/วันอาทิตย์/.test(t)))) {      // "ประชุมสัปดาห์นี้" · "ประชุมอะไรบ้างในสัปดาห์นี้" · "ประชุมสัปดาห์หน้า"
    if (/(หน้า|ถัดไป|next)/.test(t)) return 'meetnext'; if (/(นี้|this)/.test(t)) return 'meetweek';
  }
  if (/(ใคร|ลา|ราชการ|อบรม|ประชุม|who)/.test(t) && !/(สรุป)/.test(t) && !/(วันนี้|today)/.test(t)) { var day = hrlParseDay(t, hrToday()); if (day) return 'day:' + day; }
  if (/วัน(ไหน|ใด)/.test(t) && /(ลา|ราชการ|ใคร|อบรม)/.test(t)) return 'byday';    // rich-menu button "ใครลาวันไหน": day-by-day list + date picker
  var week = /(สัปดาห์|week)/.test(t) || (/อาทิตย์/.test(t) && !/วันอาทิตย์/.test(t));
  if (week && /(หน้า|ถัดไป|next)/.test(t)) return 'nextweek';
  if (week && /(นี้|this)/.test(t)) return 'thisweek';
  if (/(วันนี้|today)/.test(t) && /(ลา|ใคร|who|ราชการ|อบรม)/.test(t)) return 'today';
  if (/สรุป/.test(t) && /ลา/.test(t)) return 'month';
  return '';
}
/** Postback → same command words as hrlParseText. `date` = what the LINE date picker returned (slimmed by /api/line). */
function hrlParsePostback(data, date) {
  var s = String(data || ''), m = /(?:^|&)action=([a-z_]+)/.exec(s); if (!m) return '';
  if (m[1] === 'leave_day') { var dm = /(?:^|&)date=(\d{4}-\d{2}-\d{2})/.exec(s), d = dm ? hrlValidDay(dm[1]) : ''; return d ? 'day:' + d : ''; }
  if (m[1] === 'leave_pick') { var d2 = hrlValidDay(date); return d2 ? 'day:' + d2 : ''; }
  return { leave_this_week: 'thisweek', leave_next_week: 'nextweek', leave_today: 'today', leave_month: 'month', leave_next_month: 'nextmonth', meet_this_week: 'meetweek', meet_next_week: 'meetnext', leave_dayask: 'dayask', leave_by_day: 'byday', who_when: 'byday' }[m[1]] || '';
}
function hrlHelpText() {
  return 'พิมพ์หรือกดเมนูได้เลย:\n• สัปดาห์นี้ใครลา\n• สัปดาห์หน้าใครลา\n• วันนี้ใครลา\n• ใครลาวันไหน (ลา/ไปราชการ แยกรายวัน + เลือกวันที่จากปฏิทิน)\n• ใครลา 5 พ.ย. · ใครลาวันพุธ · ใครลาพรุ่งนี้\n• ประชุมสัปดาห์นี้ · ประชุมสัปดาห์หน้า\n• สรุปลาเดือนนี้ · เดือนหน้าใครลา (เฉพาะแอดมิน/หัวหน้า)';
}

/* ---------------- one day: "ใครลาวันไหน" ---------------- */
function hrlDayAskText() {
  return '📅 อยากดูว่าใครลาวันไหน?\n• กดปุ่ม “เลือกวันที่” ด้านล่าง\n• หรือพิมพ์ เช่น “ใครลา 5 พ.ย.” · “ใครลาวันพุธ” · “ใครลาพรุ่งนี้” · “ใครลา 5/11”';
}
function hrlDayText(pre, day, today, only) {
  var rel = day === today ? 'วันนี้' : day === hrAddDays(today, 1) ? 'พรุ่งนี้' : day === hrAddDays(today, 2) ? 'มะรืนนี้' : day === hrAddDays(today, -1) ? 'เมื่อวาน' : '';
  var note = (hrDow(day) === 0 || hrDow(day) === 6) ? 'ℹ️ วันหยุดสุดสัปดาห์ (การลาไม่นับในวันนี้)' : '';
  return hrlRangeText(hrlRangeData(pre, day, day, { only: only }), rel, hrlDW(day) + ' ' + hrlBE(day), (only === 'leave' ? '✅ ไม่มีผู้ลาใน' : '✅ ไม่มีผู้ลา ไปราชการ อบรม หรือประชุมใน') + (day === today ? 'วันนี้' : 'วันนั้น'), note);
}
/** Next / previous Monday–Friday around `day` (the quick-reply arrows skip weekends). */
function hrlStepDay(day, dir) { var d = hrAddDays(day, dir), n = 0; while ((hrDow(d) === 0 || hrDow(d) === 6) && n++ < 7) d = hrAddDays(d, dir); return d; }
function hrlQPost(label, date) { return { type: 'action', action: { type: 'postback', label: String(label).slice(0, 20), data: 'action=leave_day&date=' + date, displayText: 'ใครลา ' + hrlDW(date) } }; }
function hrlQPick(label, today) { return { type: 'action', action: { type: 'datetimepicker', label: label, data: 'action=leave_pick', mode: 'date', initial: today, min: hrAddDays(today, -400), max: hrAddDays(today, 800) } }; }
/** Quick-reply buttons under the answer: true = the usual three; a list = buttons for the day questions. */
/** The usual buttons under an answer; แอดมิน / หัวหน้า also get "เดือนหน้า" (the monthly summary is theirs). */
function hrlDefaultQuick(role) {
  return HRL_QUICK.concat(role === 'แอดมิน' || role === 'หัวหน้า' ? HRL_QUICK_BOSS : []).map(function (q) { return { type: 'action', action: { type: 'message', label: q[0], text: q[1] } }; });
}
function hrlQuickFor(cmd, today, role) {
  var items = [];
  if (cmd === 'dayask' || cmd === 'byday') {
    items.push(hrlQPick('📅 เลือกวันที่', today), hrlQPost('วันนี้', today), hrlQPost('พรุ่งนี้', hrAddDays(today, 1)));
    var d = hrAddDays(today, 1), n = 0; while (n < 4) { d = hrlStepDay(d, 1); items.push(hrlQPost(hrlDW(d), d)); n++; }
    return items;
  }
  if (String(cmd).indexOf('day:') === 0) {
    var day = cmd.slice(4);
    items.push(hrlQPost('◀ ' + hrlDW(hrlStepDay(day, -1)), hrlStepDay(day, -1)), hrlQPost(hrlDW(hrlStepDay(day, 1)) + ' ▶', hrlStepDay(day, 1)), hrlQPick('📅 เลือกวันอื่น', today));
    HRL_QUICK.forEach(function (q) { items.push({ type: 'action', action: { type: 'message', label: q[0], text: q[1] } }); });
    return items;
  }
  return hrlDefaultQuick(role);
}
function hrlAnswer(cmd, role, inGroup) {
  var pre = hrBundle(), today = hrToday(), only = hrlQueryOnly();
  if (cmd === 'byday') return hrlByDayText(pre, today, only);
  if (cmd === 'dayask') return hrlDayAskText();
  if (String(cmd).indexOf('day:') === 0) return hrlDayText(pre, cmd.slice(4), today, only);
  if (cmd === 'thisweek') { var mon = hrlMonday(today); return hrlWeekTextFor(pre, mon, 'สัปดาห์นี้', { only: only }); }
  if (cmd === 'nextweek') return hrlWeekTextFor(pre, hrAddDays(hrlMonday(today), 7), 'สัปดาห์หน้า', { only: only });
  if (cmd === 'today') return hrlRangeText(hrlRangeData(pre, today, today, { only: only }), 'วันนี้', hrlDW(today) + ' ' + hrlBE(today));
  if (cmd === 'meetweek' || cmd === 'meetnext') {
    if (only === 'leave') return 'ตอนนี้ระบบตอบเฉพาะเรื่องการลา';
    var mon2 = hrlMonday(today); return cmd === 'meetweek' ? hrlMeetText(pre, mon2, 'ประชุมสัปดาห์นี้') : hrlMeetText(pre, hrAddDays(mon2, 7), 'ประชุมสัปดาห์หน้า');
  }
  if (cmd === 'month' || cmd === 'nextmonth') {
    if (inGroup || (role !== 'แอดมิน' && role !== 'หัวหน้า')) return 'สรุปวันลารายเดือนดูได้เฉพาะแอดมินและหัวหน้า (ทางแชตส่วนตัว)';
    var y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
    if (cmd === 'nextmonth') { m += 1; if (m > 12) { m = 1; y += 1; } }
    return hrlMonthText(hrlMonthData(y, m), cmd === 'nextmonth' ? 'ข้อมูลเท่าที่บันทึกไว้ ณ วันนี้ (อาจยังเพิ่มขึ้นได้)' : '');
  }
  return '';
}
/** One slimmed LINE event { id, type, replyToken, source{type,userId,groupId,roomId}, text, data } → true when something was done. */
function hrlHandleEvent(ev) {
  if (!ev || typeof ev !== 'object') return false;
  var id = String(ev.id || ''); if (id && hrlSeen(id)) return false;
  var src = ev.source || {}, userId = String(src.userId || ''), groupId = String(src.groupId || src.roomId || ''), inGroup = !!groupId, rt = String(ev.replyToken || '');
  if (ev.type === 'unfollow') { if (userId) hrlSetStatus(userId, 'ยกเลิก'); return true; }
  if (ev.type === 'join' && inGroup) { hrlReply(rt, hrlTextMessages('สวัสดีครับ/ค่ะ 👋 พิมพ์ "รหัสกลุ่ม" เพื่อรับรหัสกลุ่ม ให้แอดมินนำไปตั้งค่าการส่งรายงานอัตโนมัติ', false)); return true; }
  if (ev.type === 'follow' && userId) {
    hrlRegister(userId, true); var u = hrlUser(userId);
    hrlReply(rt, hrlTextMessages(u && u.role ? '✅ ลงทะเบียนแล้ว — คุณได้รับสิทธิ์ "' + u.role + '"\n' + hrlHelpText() : '✅ ลงทะเบียนแล้ว\nขั้นต่อไป: รอแอดมินกำหนด "บทบาท" ให้ก่อน จึงจะได้รับรายงานและถามได้', !!(u && u.role)));
    return true;
  }
  var cmd = ev.type === 'postback' ? hrlParsePostback(ev.data, ev.date) : (ev.type === 'message' ? hrlParseText(ev.text) : '');
  if (ev.type !== 'message' && ev.type !== 'postback') return false;
  if (cmd === 'groupid' && inGroup) { hrlReply(rt, hrlTextMessages('รหัสกลุ่มนี้:\n' + groupId, false)); return true; }
  if (inGroup) {                                           // groups: only configured groups, only recognised commands, never chatter
    if (!cmd || cmd === 'help' || !hrlIsAllowedGroup(groupId)) return false;
    hrlReply(rt, hrlTextMessages(hrlAnswer(cmd, '', true), /^(dayask|byday|day:)/.test(cmd) ? hrlQuickFor(cmd, hrToday()) : false)); return true;
  }
  if (!userId) return false;
  hrlRegister(userId);
  var me = hrlUser(userId), role = me ? me.role : '';
  if (HRL_ROLES.indexOf(role) < 0) { hrlReply(rt, hrlTextMessages('ยังไม่ได้รับสิทธิ์ใช้งาน — แจ้งแอดมินให้กำหนดบทบาทของคุณในระบบ แล้วลองใหม่', false)); return true; }
  if (!cmd || cmd === 'help' || cmd === 'groupid') { hrlReply(rt, hrlTextMessages(hrlHelpText(), hrlDefaultQuick(role))); return true; }
  hrlReply(rt, hrlTextMessages(hrlAnswer(cmd, role, false), hrlQuickFor(cmd, hrToday(), role)));
  return true;
}
/** action "line" — called by the Vercel edge function /api/line (which has already checked LINE's X-Line-Signature). */
function hrLineHook(b) {
  var secret = prop('EDGE_SECRET');
  if (!secret || !safeEqual(String(b.secret || ''), secret)) throw httpError('FORBIDDEN', 'ไม่อนุญาต');
  rateLimit('hrline', intProp('HR_LINE_LIMIT_PER_MIN', 240));
  var events = Array.isArray(b.events) ? b.events.slice(0, 20) : [], done = 0;
  events.forEach(function (ev) { try { if (hrlHandleEvent(ev)) done++; } catch (e) { console.error('hrLine event: ' + (e && e.message)); } });
  return { ok: true, handled: done };
}

/* ------------------------------------ page operations (Hr.gs ops) ------------------------------------ */
/** The phone page /leave: everything it needs in one answer. */
function hrlMobileBoot(sc) {
  var pre = hrBundle(), today = hrToday(), mon = hrlMonday(today), mine = [];
  pre.recs.forEach(function (x) {
    if (!x.id || !x.owner || x.owner !== sc.email || x.end < hrAddDays(today, -45)) return;
    mine.push({ id: x.id, name: x.name, dept: x.dept, type: x.type, startDate: x.start, endDate: x.end, startTime: x.st, endTime: x.et, note: x.note, province: x.province, mission: x.mission, canEdit: hrCanEdit(sc, x) });
  });
  mine.sort(function (a, b) { return a.startDate < b.startDate ? 1 : a.startDate > b.startDate ? -1 : 0; });
  return { me: { email: sc.email, admin: sc.admin, dev: sc.dev }, today: today, config: { maxLeave: HR_MAX_LEAVE, departments: HR_DEPARTMENTS, realDepartments: HR_REAL_DEPARTMENTS, leaveTypes: HR_LEAVE_TYPES },
    staff: pre.staff.map(function (s) { return { name: s.name, department: s.department }; }), holidays: pre.holidays,
    thisWeek: hrlWeekRange(pre, mon, {}), nextWeek: hrlWeekRange(pre, hrAddDays(mon, 7), {}), mine: mine.slice(0, 25), version: HRL_VERSION };
}
/** The phone page "ใครลา ▸ เลือกวัน": one day, same data and grouping as the LINE answer. */
function hrlMobileWho(day) {
  var d = hrlValidDay(day); if (!d) throw httpError('BAD_REQUEST', 'วันที่ไม่ถูกต้อง');
  var pre = hrBundle(), data = hrlRangeData(pre, d, d, {});
  return { day: d, items: data.items, over: data.over, holiday: pre.holidays[d] || '', weekend: hrDow(d) === 0 || hrDow(d) === 6 };
}
function hrlOpStatus() {
  var users = hrlUsers(), byRole = {}; HRL_ROLES.forEach(function (r) { byRole[r] = 0; });
  users.forEach(function (u) { if (byRole[u.role] !== undefined && u.status !== 'ยกเลิก') byRole[u.role]++; });
  return { version: HRL_VERSION, channel: hrlActiveChannel(), primaryConfigured: !!hrlToken('primary'), backupConfigured: !!hrlToken('backup'), relayReady: !!prop('EDGE_SECRET'),
    groups: hrlGroupIds().length, queryScope: hrlQueryOnly() || 'all', quota: hrlQuota(), schedule: hrlScheduleAll(), triggers: hrlTriggerList(),
    users: { total: users.length, pending: users.filter(function (u) { return !u.role && u.status !== 'ยกเลิก'; }).length, byRole: byRole }, roles: HRL_ROLES, weekdays: HRL_WEEKDAYS };
}
function hrlOpUsers() { return hrlUsers().map(function (u) { return { userId: u.userId, name: u.name, registered: u.registered, status: u.status, role: u.role, enabled: u.enabled }; }); }
function hrlOpSetUser(userId, role, enabled) {
  userId = hrStr(userId, 60); role = hrStr(role, 20);
  if (role && HRL_ROLES.indexOf(role) < 0) return hrErr('บทบาทไม่ถูกต้อง');
  var u = hrlUser(userId); if (!u) return hrErr('ไม่พบผู้ใช้นี้');
  hrTab('LUSERS').getRange(u.row, 6, 1, 2).setValues([[role, enabled === false || enabled === 'false' ? 'FALSE' : 'TRUE']]);
  return hrOk('บันทึกแล้ว', { id: userId });
}
function hrlOpSwitch(target) {
  if (target !== 'primary' && target !== 'backup') return hrErr('ช่องทางไม่ถูกต้อง');
  if (!hrlToken(target)) return hrErr('ยังไม่ได้ตั้ง token ของช่องทาง ' + target);
  hrlProps().setProperty('LINE_ACTIVE_CHANNEL', target); return hrOk('สลับช่องทางแล้ว', { id: target });
}
function hrlOpSaveSchedule(items) { return hrOk('บันทึกเวลาและสร้างตัวตั้งเวลาใหม่แล้ว', { triggers: hrlSaveSchedule(items) }); }
/** kind: weekly | thisweek | month  (+ year, month) → the text exactly as it would be sent. */
function hrlOpPreview(kind, year, month) {
  var pre = hrBundle(), today = hrToday(), mon = hrlMonday(today);
  if (kind === 'thisweek') return { text: hrlWeekTextFor(pre, mon, 'สัปดาห์นี้', {}) };
  if (kind === 'month') { var y = Number(year) || Number(today.slice(0, 4)), m = Number(month) || Number(today.slice(5, 7)); if (m < 1 || m > 12) throw httpError('BAD_REQUEST', 'เดือนไม่ถูกต้อง'); return { text: hrlMonthText(hrlMonthData(y, m)) }; }
  return { text: hrlWeekTextFor(pre, hrAddDays(mon, 7), 'รายงานสัปดาห์หน้า', {}) };
}
function hrlOpSendNow(sc, kind, year, month) {
  var key = kind === 'month' ? 'monthend' : 'weekly';
  var out = hrlRunJob(key, { force: true, year: Number(year) || 0, month: Number(month) || 0 });
  try { hrAudit({ email: sc.email }, 'lineSend', key); } catch (x) { /* logging only */ }
  return { status: out.status === 'error' ? 'error' : 'success', message: out.result && out.result.error ? out.result.error : 'ส่งแล้ว', result: out.result || out };
}
