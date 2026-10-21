/**
 * SAND Office Tools — Hr.gs   ระบบบันทึกการปฏิบัติงาน (HR Control)   (action "hr")
 * Imported from the stand-alone "ระบบบันทึกการปฏิบัติงาน" web app (Code.gs + Index.html). The page now lives inside SAND (src/js/modules/hr.js);
 * this file is its backend. It needs Code.gs (requireUser, sheetTab, cell, prop, listProp, rateLimit, httpError, styleTab, subFolder) — keep them together.
 *
 * Who can do what (the old app had no login at all — anyone with the link could change anything):
 *   • every signed-in user   : see the calendar / report, record leave · meetings · training · official trips, edit or delete THEIR OWN records
 *   • admins                 : staff list, public-holiday list, everyone's records, history per person, CSV export, setup      (ADMIN_EMAILS + HR_ADMIN_EMAILS)
 *   • "dev tools" (บันทึกประจำวัน / โปรเจคที่ดูแล): admins + HR_DEV_EMAILS. Each person only ever sees their own rows (column Owner).
 * Everything is checked here on the server; the page only hides what a person may not use.
 *
 * Script properties (all optional):
 *   HR_SHEET_ID        spreadsheet that holds the five HR tabs. Empty = the LOG_SHEET_ID spreadsheet (tabs are created on first use).
 *                      Set it to the OLD system's spreadsheet to keep using the existing data (tab names are unchanged).
 *   HR_ADMIN_EMAILS    extra HR admins (comma separated), in addition to ADMIN_EMAILS
 *   HR_DEV_EMAILS      people who may use บันทึกประจำวัน / โปรเจคที่ดูแล (admins always may)
 *   HR_EDIT_ALL        "true" = every signed-in user may edit/delete every record (the old behaviour). Default: owner or admin only.
 *   HR_FOLDER_ID       Drive folder for attachments. Default: <DRIVE_FOLDER_ID>/HR_Attachments (or a folder "HR_Attachments" in My Drive)
 *   HR_FILE_SHARING    link (default, same as the old system) · domain (anyone in the organisation with the link; falls back to private) · private (only uploader + owner)
 *   HR_LIMIT_PER_MIN   requests per minute for the whole app, default 600
 *
 * One-time setup: run  setupHr()  from the editor (creates/styles the tabs, adds the new Owner columns), then Deploy a NEW version of the web app.
 * Tabs: HR_Control · Staff · HolidayOverrides · DailyLog · Projects   (same names and column order as the old system; Owner is added at the end)
 *       LineUsers · LineReportSchedule   (added in 1.1.1 — LINE notifications, see HrLine.gs)
 * The ops  mobileBoot · line*  at the end of HR_OPS are implemented in HrLine.gs (keep it in the same project).
 */

var HR_VERSION = '1.1.1';
var HR_T = { CONTROL: 'HR_Control', STAFF: 'Staff', HOLIDAY: 'HolidayOverrides', DLOG: 'DailyLog', PROJ: 'Projects', LUSERS: 'LineUsers', LSCHED: 'LineReportSchedule' };
var HR_H = {
  CONTROL: ['Timestamp', 'Name', 'Department', 'Type', 'StartDate', 'EndDate', 'StartTime', 'EndTime', 'Note', 'FileURL', 'ID', 'Province', 'Mission', 'Owner'],
  STAFF: ['Name', 'Department', 'Color'],
  HOLIDAY: ['Date', 'Name', 'Status', 'Timestamp'],
  DLOG: ['Timestamp', 'Date', 'Project', 'Detail', 'Hours', 'ID', 'Owner'],
  PROJ: ['Timestamp', 'Name', 'URL', 'Status', 'NextAction', 'Notes', 'ID', 'StartDate', 'TargetDate', 'Progress', 'Owner'],
  LUSERS: ['UserId', 'DisplayName', 'ลงทะเบียนเมื่อ', 'สถานะ', 'ข้อความล่าสุดเมื่อ', 'บทบาท', 'เปิดรับข้อความ'],               // HrLine.gs — friends of the LINE OA
  LSCHED: ['Key', 'ชื่อรายงาน', 'ชั่วโมง', 'นาที', 'วัน (ว่าง=ทุกวัน)', 'เปิดใช้งาน', 'ผู้รับ (บทบาท)']                       // HrLine.gs — when each report is sent
};
var HR_MAX_LEAVE = 3;                 // at most 3 people on leave per day per group (more needs a reason in the note)
var HR_MAX_FILE = 10 * 1024 * 1024;   // attachment limit (bytes)
var HR_MAX_SPAN_DAYS = 366;           // longest single record
var HR_KEEP_DAYS = 1100;              // the calendar loads records that ended within the last ~3 years
var HR_DEPARTMENTS = ['กลุ่มงานพัฒนาคุณภาพฯ', 'กลุ่มงานยุทธศาสตร์ฯ', 'กลุ่มงานโสตฯ', 'รวมทุกกลุ่มงาน'];
var HR_REAL_DEPARTMENTS = HR_DEPARTMENTS.slice(0, 3);   // real affiliations of staff ("รวมทุกกลุ่มงาน" is only for records / filters)
var HR_LEAVE_TYPES = ['ลากิจ', 'ลากิจครึ่งวัน', 'ลาป่วย', 'ลาป่วยครึ่งวัน', 'ลาพักผ่อน', 'ลาพักผ่อนครึ่งวัน', 'ลาไปเรียน', 'ไปราชการ', 'อบรม', 'ประชุม', 'ประชุม P4P', 'ประชุม กกบ.',
  'ประชุม HR', 'ประชุมภาพลักษณ์', 'ประชุม IRB', 'ประชุม SMC', 'ประชุมอื่นๆ', 'งานภายใน/ภายนอก', 'Event พิเศษ'];
var HR_LEAVE_CATS = ['ลากิจ', 'ลากิจครึ่งวัน', 'ลาป่วย', 'ลาป่วยครึ่งวัน', 'ลาพักผ่อน', 'ลาพักผ่อนครึ่งวัน', 'ลาไปเรียน'];
var HR_MEETING_TYPES = ['ประชุม', 'ประชุม P4P', 'ประชุม กกบ.', 'ประชุม HR', 'ประชุมภาพลักษณ์', 'ประชุม IRB', 'ประชุม SMC', 'ประชุมอื่นๆ'];
var HR_OVERLAP_TYPES = HR_MEETING_TYPES.concat(['ไปราชการ', 'อบรม']);
var HR_PROJECT_STATUSES = ['วางแผน', 'กำลังพัฒนา', 'ทดสอบ/รีวิว', 'ใช้งานจริง', 'ดูแลรักษา', 'พักไว้'];
var HR_REPORT_KEYS = ['ลากิจ', 'ลาป่วย', 'ลาพักผ่อน', 'ลาไปเรียน', 'ไปราชการ', 'อบรม', 'ประชุม', 'ประชุม P4P', 'ประชุม กกบ.', 'ประชุม HR', 'ประชุมภาพลักษณ์', 'ประชุม IRB', 'ประชุม SMC', 'ประชุมอื่นๆ', 'งานภายใน/ภายนอก', 'Event พิเศษ'];
var HR_PALETTE = ['#c4623d', '#7a8a6f', '#6f8299', '#cf9749', '#a8412a', '#8c6f4a', '#5f7a6b', '#4f6b7a', '#b4823f', '#935e3f', '#6b5c47', '#8a5a63'];
// Official holidays 2025–2026. Later years: an admin adds them in the page (จัดการวันหยุด) — they are kept in the HolidayOverrides tab.
var HR_HOLIDAYS = {
  '2025-01-01': 'วันขึ้นปีใหม่', '2025-02-12': 'วันมาฆบูชา', '2025-04-06': 'วันจักรี (อาทิตย์)', '2025-04-07': 'วันหยุดชดเชยวันจักรี', '2025-04-13': 'วันสงกรานต์', '2025-04-14': 'วันสงกรานต์',
  '2025-04-15': 'วันสงกรานต์', '2025-04-16': 'วันหยุดชดเชยวันสงกรานต์', '2025-05-01': 'วันแรงงานแห่งชาติ', '2025-05-04': 'วันฉัตรมงคล (อาทิตย์)', '2025-05-05': 'วันหยุดชดเชยวันฉัตรมงคล',
  '2025-05-09': 'วันพืชมงคล', '2025-05-11': 'วันวิสาขบูชา (อาทิตย์)', '2025-05-12': 'วันหยุดชดเชยวันวิสาขบูชา', '2025-06-02': 'วันหยุดพิเศษ (ครม.)', '2025-06-03': 'วันเฉลิมพระชนมพรรษา พระบรมราชินี',
  '2025-07-10': 'วันอาสาฬหบูชา', '2025-07-11': 'วันเข้าพรรษา', '2025-07-28': 'วันเฉลิมพระชนมพรรษา ร.10', '2025-08-11': 'วันหยุดพิเศษ (ครม.)', '2025-08-12': 'วันแม่แห่งชาติ',
  '2025-10-13': 'วันคล้ายวันสวรรคต ร.9', '2025-10-23': 'วันปิยมหาราช', '2025-12-05': 'วันพ่อแห่งชาติ', '2025-12-10': 'วันรัฐธรรมนูญ', '2025-12-31': 'วันสิ้นปี',
  '2026-01-01': 'วันขึ้นปีใหม่', '2026-03-03': 'วันมาฆบูชา', '2026-04-06': 'วันจักรี', '2026-04-13': 'วันสงกรานต์', '2026-04-14': 'วันสงกรานต์', '2026-04-15': 'วันสงกรานต์', '2026-05-01': 'วันแรงงานแห่งชาติ',
  '2026-05-04': 'วันฉัตรมงคล', '2026-06-03': 'วันเฉลิมพระชนมพรรษา พระบรมราชินี', '2026-07-28': 'วันเฉลิมพระชนมพรรษา ร.10', '2026-08-12': 'วันแม่แห่งชาติ', '2026-10-13': 'วันคล้ายวันสวรรคต ร.9',
  '2026-10-23': 'วันปิยมหาราช', '2026-12-05': 'วันพ่อแห่งชาติ', '2026-12-10': 'วันรัฐธรรมนูญ', '2026-12-31': 'วันสิ้นปี'
};

/* ------------------------------ entry point ------------------------------- */
// op → { fn(scope, args), write?, admin?, dev? }. `args` is the positional argument list of the old google.script.run call.
var HR_OPS = {
  boot: { fn: function (sc) { return hrBoot(sc); } },
  getAll: { fn: function (sc) { return hrAll(sc); } },
  ping: { fn: function () { return { ok: true, version: HR_VERSION, time: new Date().toISOString() }; } },   // no sheet access — tells the page whether the HR code is deployed at all
  getHolidayMap: { fn: function () { return hrHolidayMap(); } },
  getStaffList: { fn: function () { return hrStaffList(); } },
  getDashboard: { fn: function () { return hrDashboard(); } },
  getEvents: { fn: function (sc) { return hrEvents(sc); } },
  getMonthlySummary: { fn: function (sc, a) { return hrMonthlySummary(a[0], a[1]); } },
  saveData: { fn: function (sc, a) { return hrSaveData(sc, a[0]); }, write: true },
  updateRecord: { fn: function (sc, a) { return hrUpdateRecord(sc, a[0]); }, write: true },
  deleteRecord: { fn: function (sc, a) { return hrDeleteRecord(sc, a[0]); }, write: true },
  addStaff: { fn: function (sc, a) { return hrAddStaff(a[0], a[1], a[2]); }, write: true, admin: true },
  deleteStaff: { fn: function (sc, a) { return hrDeleteStaff(a[0]); }, write: true, admin: true },
  updateStaffDept: { fn: function (sc, a) { return hrUpdateStaffDept(a[0], a[1]); }, write: true, admin: true },
  updateStaffColor: { fn: function (sc, a) { return hrUpdateStaffColor(a[0], a[1]); }, write: true, admin: true },
  getRecordsByName: { fn: function (sc, a) { return hrRecordsByName(a[0]); }, admin: true },
  getHolidayList: { fn: function () { return hrHolidayList(); }, admin: true },
  saveHoliday: { fn: function (sc, a) { return hrSaveHoliday(a[0], a[1]); }, write: true, admin: true },
  deleteHoliday: { fn: function (sc, a) { return hrDeleteHoliday(a[0]); }, write: true, admin: true },
  restoreHoliday: { fn: function (sc, a) { return hrRestoreHoliday(a[0]); }, write: true, admin: true },
  restoreDefaultHolidays: { fn: function () { return hrRestoreDefaultHolidays(); }, write: true, admin: true },
  exportReport: { fn: function () { return hrExportReport(); }, admin: true },
  firstTimeSetup: { fn: function () { return hrSetupNow(); }, admin: true },
  getDailyLogList: { fn: function (sc) { return hrDlogList(sc); }, dev: true },
  addDailyLog: { fn: function (sc, a) { return hrDlogSave(sc, a[0], false); }, write: true, dev: true },
  updateDailyLog: { fn: function (sc, a) { return hrDlogSave(sc, a[0], true); }, write: true, dev: true },
  deleteDailyLog: { fn: function (sc, a) { return hrDlogDelete(sc, a[0]); }, write: true, dev: true },
  getProjectList: { fn: function (sc) { return hrProjList(sc); }, dev: true },
  addProject: { fn: function (sc, a) { return hrProjSave(sc, a[0], false); }, write: true, dev: true },
  updateProject: { fn: function (sc, a) { return hrProjSave(sc, a[0], true); }, write: true, dev: true },
  deleteProject: { fn: function (sc, a) { return hrProjDelete(sc, a[0]); }, write: true, dev: true },
  // ---- HrLine.gs: the phone page (any signed-in user) and the LINE admin page (HR admins only)
  mobileBoot: { fn: function (sc) { return hrlMobileBoot(sc); } },
  lineStatus: { fn: function () { return hrlOpStatus(); }, admin: true },
  lineUsers: { fn: function () { return hrlOpUsers(); }, admin: true },
  lineSetUser: { fn: function (sc, a) { return hrlOpSetUser(a[0], a[1], a[2]); }, write: true, admin: true },
  lineSwitch: { fn: function (sc, a) { return hrlOpSwitch(a[0]); }, write: true, admin: true },
  lineSaveSchedule: { fn: function (sc, a) { return hrlOpSaveSchedule(a[0]); }, write: true, admin: true },
  linePreview: { fn: function (sc, a) { return hrlOpPreview(a[0], a[1], a[2]); }, admin: true },
  lineSend: { fn: function (sc, a) { return hrlOpSendNow(sc, a[0], a[1], a[2]); }, admin: true }   // not under the write lock: it waits for LINE
};

function hr(b) {
  var u = requireUser(b.session);
  rateLimit('hr', intProp('HR_LIMIT_PER_MIN', 600));
  var op = String(b.op || ''), args = Array.isArray(b.args) ? b.args : [];
  var def = Object.prototype.hasOwnProperty.call(HR_OPS, op) ? HR_OPS[op] : null;
  if (!def) throw httpError('UNKNOWN_OP', 'ไม่รู้จักคำสั่งนี้');
  var sc = hrScope(u);
  if (def.admin && !sc.admin) throw httpError('FORBIDDEN', 'ต้องเป็นผู้ดูแลระบบจึงทำรายการนี้ได้');
  if (def.dev && !sc.dev) throw httpError('FORBIDDEN', 'เครื่องมือนี้เปิดให้เฉพาะผู้ที่ได้รับสิทธิ์');
  var out = def.write ? hrLocked(function () { return def.fn(sc, args); }) : def.fn(sc, args);
  if (def.write && out && out.status === 'success') hrAudit(u, op, out.id || '');
  return out;
}

function hrScope(u) {
  var email = String(u.email || '').toLowerCase();
  var admin = listProp('ADMIN_EMAILS').indexOf(email) >= 0 || listProp('HR_ADMIN_EMAILS').indexOf(email) >= 0;
  return { email: email, admin: admin, dev: admin || listProp('HR_DEV_EMAILS').indexOf(email) >= 0, editAll: prop('HR_EDIT_ALL') === 'true' };
}
function hrLocked(fn) {
  var lock = LockService.getScriptLock(); lock.waitLock(15000);
  try { return fn(); } finally { lock.releaseLock(); }
}
function hrAudit(u, op, id) {
  try { sheetTab('Logs', LOG_HEADERS).appendRow([new Date(), Utilities.getUuid().slice(0, 8), u.email, 'hr', op, 'ok', cell(id, 200), 0, 0, '{}']); } catch (x) { /* the audit trail must never break a save */ }
}
function hrOk(message, extra) { var r = { status: 'success', message: message }; for (var k in (extra || {})) r[k] = extra[k]; return r; }
function hrErr(message, extra) { var r = { status: 'error', message: message }; for (var k in (extra || {})) r[k] = extra[k]; return r; }

/* ------------------------------ sheets & cells ----------------------------- */
function hrSs() {
  var id = prop('HR_SHEET_ID');
  if (!id) return null;
  if (!REQ.hrSs) REQ.hrSs = SpreadsheetApp.openById(id);
  return REQ.hrSs;
}
/** The tab for key CONTROL | STAFF | HOLIDAY | DLOG | PROJ (created with its header row when missing; missing trailing columns are added). */
function hrTab(key) {
  var name = HR_T[key], headers = HR_H[key], ss = hrSs(), sh;
  REQ.hrSheets = REQ.hrSheets || {};
  if (REQ.hrSheets[key]) return REQ.hrSheets[key];
  if (!ss) sh = sheetTab(name, headers);
  else {
    sh = ss.getSheetByName(name) || ss.insertSheet(name);
    if (sh.getLastRow() === 0) { sh.appendRow(headers); sh.setFrozenRows(1); }
  }
  if (!hrColsChecked(key)) { hrEnsureCols(sh, headers); hrColsMark(key); }   // 2 extra Sheets calls per tab per request, so it is done once per 6 h
  REQ.hrSheets[key] = sh;
  return sh;
}
function hrColsChecked(key) { try { return CacheService.getScriptCache().get('hrcols:' + HR_VERSION + ':' + key) === '1'; } catch (x) { return false; } }
function hrColsMark(key) { try { CacheService.getScriptCache().put('hrcols:' + HR_VERSION + ':' + key, '1', 21600); } catch (x) { /* ignore */ } }
function hrColsReset() { try { CacheService.getScriptCache().removeAll(Object.keys(HR_T).map(function (k) { return 'hrcols:' + HR_VERSION + ':' + k; })); } catch (x) { /* ignore */ } }
/** Old sheets miss the newest columns (Owner …): add the header cells (never overwrites a header that is already there). */
function hrEnsureCols(sh, headers) {
  if (sh.getMaxColumns() < headers.length) sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
  var cur = sh.getRange(1, 1, 1, headers.length).getValues()[0];
  for (var i = 0; i < headers.length; i++) if (String(cur[i] == null ? '' : cur[i]).trim() === '') sh.getRange(1, i + 1).setValue(headers[i]);
}
function hrTz(sh) { try { return sh.getParent().getSpreadsheetTimeZone() || 'Asia/Bangkok'; } catch (x) { return 'Asia/Bangkok'; } }
function hrRead(sh, ncols) {
  var last = sh.getLastRow();
  return last < 2 ? [] : sh.getRange(2, 1, last - 1, ncols).getValues();
}
function hrFindRow(rows, col, id) {
  for (var i = 0; i < rows.length; i++) if (String(rows[i][col]) === id) return i;
  return -1;
}
function hrStr(v, max) { return String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').trim().slice(0, max || 500); }
function hrPad(n) { return (n < 10 ? '0' : '') + n; }
/** yyyy-MM-dd of a sheet cell (Date, ISO text, or dd/MM/yyyy with a Buddhist or Christian year). '' when unreadable. */
function hrDay(v, tz) {
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, tz || 'Asia/Bangkok', 'yyyy-MM-dd');
  var s = String(v == null ? '' : v).trim(), m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (m) { var y = Number(m[3]); if (y > 2400) y -= 543; return y + '-' + hrPad(Number(m[2])) + '-' + hrPad(Number(m[1])); }
  return '';
}
/** HH:mm of a sheet cell (text such as 08:30 or '08:30, or a time value). '' when empty/unreadable. */
function hrTime(v, tz) {
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, tz || 'Asia/Bangkok', 'HH:mm');
  var m = /(\d{1,2})[:.](\d{2})/.exec(String(v == null ? '' : v).replace(/'/g, ''));
  return m ? hrPad(Number(m[1])) + ':' + m[2] : '';
}
function hrTimeIn(v) {   // user input → HH:mm or '' (throws on garbage)
  var s = hrStr(v, 10); if (!s) return '';
  var m = /^([01]?\d|2[0-3])[:.]([0-5]\d)$/.exec(s);
  if (!m) throw httpError('BAD_TIME', 'รูปแบบเวลาไม่ถูกต้อง (เช่น 08:30)');
  return hrPad(Number(m[1])) + ':' + m[2];
}
function hrMin(t) { var m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; }
function hrDateOk(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '')); if (!m) return false;
  var y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]), t = new Date(Date.UTC(y, mo - 1, d));
  return y >= 2000 && y <= 2100 && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}
function hrAddDays(day, n) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day), t = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n)); return t.getUTCFullYear() + '-' + hrPad(t.getUTCMonth() + 1) + '-' + hrPad(t.getUTCDate()); }
function hrDow(day) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day); return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay(); }
function hrDaysBetween(a, b) { var f = function (s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])); }; return Math.round((f(b) - f(a)) / 86400000); }
function hrToday() { return Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd'); }
function hrColor(c) { var s = String(c == null ? '' : c).trim(); return /^#[0-9a-fA-F]{6}$/.test(s) ? s : ''; }
function hrAutoColor(name) { var idx = 0, s = String(name || ''); for (var i = 0; i < s.length; i++) idx += s.charCodeAt(i); return HR_PALETTE[idx % HR_PALETTE.length]; }
function hrHttpUrl(u) { var s = hrStr(u, 500); if (!s) return ''; if (!/^https?:\/\/[^\s]+$/i.test(s)) throw httpError('BAD_URL', 'URL ต้องขึ้นต้นด้วย http:// หรือ https://'); return s; }
function hrIsWorkday(day, holidays) { var w = hrDow(day); return w !== 0 && w !== 6 && !holidays[day]; }

/* -------------------------------- holidays --------------------------------- */
function hrOverrides() {
  var sh = hrTab('HOLIDAY'), tz = hrTz(sh), rows = hrRead(sh, 3), custom = {}, deleted = {};
  rows.forEach(function (r) {
    var d = hrDay(r[0], tz); if (!d) return;
    var st = String(r[2] || '').trim();
    if (st === 'deleted') deleted[d] = true; else if (st === 'custom') custom[d] = String(r[1] || '');
  });
  return { custom: custom, deleted: deleted };
}
function hrHolidayMap() {
  var ov = hrOverrides(), out = {}, k;
  for (k in HR_HOLIDAYS) if (!ov.deleted[k]) out[k] = HR_HOLIDAYS[k];
  for (k in ov.custom) out[k] = ov.custom[k];
  return out;
}
function hrHolidayList() {
  var ov = hrOverrides(), all = {}, k;
  for (k in HR_HOLIDAYS) all[k] = 1; for (k in ov.custom) all[k] = 1; for (k in ov.deleted) all[k] = 1;
  return Object.keys(all).sort().map(function (d) {
    var isCustom = Object.prototype.hasOwnProperty.call(ov.custom, d), isDefault = Object.prototype.hasOwnProperty.call(HR_HOLIDAYS, d);
    return { date: d, name: isCustom ? ov.custom[d] : (isDefault ? HR_HOLIDAYS[d] : ''), isDeleted: !!ov.deleted[d], isCustom: isCustom };
  });
}
function hrHolidayRow(sh, tz, day) {
  var rows = hrRead(sh, 4);
  for (var i = 0; i < rows.length; i++) if (hrDay(rows[i][0], tz) === day) return i + 2;
  return -1;
}
function hrSaveHoliday(date, name) {
  date = hrStr(date, 10); name = hrStr(name, 120);
  if (!hrDateOk(date)) return hrErr('รูปแบบวันที่ไม่ถูกต้อง');
  if (!name) return hrErr('กรุณากรอกชื่อวันหยุด');
  var sh = hrTab('HOLIDAY'), tz = hrTz(sh), row = hrHolidayRow(sh, tz, date), vals = [[date, cell(name, 120), 'custom', new Date()]];
  if (row > 0) { sh.getRange(row, 1, 1, 4).setValues(vals); return hrOk('บันทึกวันหยุดสำเร็จ ✓', { id: date }); }
  sh.appendRow(vals[0]); return hrOk('เพิ่มวันหยุดสำเร็จ ✓', { id: date });
}
function hrDeleteHoliday(date) {
  date = hrStr(date, 10);
  if (!hrDateOk(date)) return hrErr('ไม่ระบุวันที่');
  var sh = hrTab('HOLIDAY'), tz = hrTz(sh), row = hrHolidayRow(sh, tz, date);
  if (Object.prototype.hasOwnProperty.call(HR_HOLIDAYS, date)) {   // an official holiday is hidden, not removed
    var v = [[date, HR_HOLIDAYS[date], 'deleted', new Date()]];
    if (row > 0) sh.getRange(row, 1, 1, 4).setValues(v); else sh.appendRow(v[0]);
    return hrOk('ซ่อนวันหยุดสำเร็จ ✓', { id: date });
  }
  if (row > 0) { sh.deleteRow(row); return hrOk('ลบวันหยุดสำเร็จ ✓', { id: date }); }
  return hrErr('ไม่พบวันหยุดนี้ในระบบ');
}
function hrRestoreHoliday(date) {
  date = hrStr(date, 10);
  var sh = hrTab('HOLIDAY'), tz = hrTz(sh), rows = hrRead(sh, 4);
  for (var i = 0; i < rows.length; i++) if (hrDay(rows[i][0], tz) === date && String(rows[i][2]).trim() === 'deleted') { sh.deleteRow(i + 2); return hrOk('คืนค่าวันหยุดสำเร็จ ✓', { id: date }); }
  return hrErr('ไม่พบรายการที่ถูกซ่อน');
}
function hrRestoreDefaultHolidays() {
  var sh = hrTab('HOLIDAY'), last = sh.getLastRow();
  if (last > 1) sh.deleteRows(2, last - 1);
  return hrOk('คืนค่าเริ่มต้นสำเร็จ ✓');
}

/* --------------------------------- staff ----------------------------------- */
function hrStaffList() {
  return hrRead(hrTab('STAFF'), 3).filter(function (r) { return String(r[0] == null ? '' : r[0]).trim() !== ''; })
    .map(function (r) { return { name: String(r[0]).trim(), department: String(r[1] || ''), color: hrColor(r[2]) }; });
}
function hrStaffRow(sh, name) {
  var rows = hrRead(sh, 3);
  for (var i = 0; i < rows.length; i++) if (String(rows[i][0]).trim() === name) return i + 2;
  return -1;
}
function hrAddStaff(name, department, color) {
  name = hrStr(name, 100); department = hrStr(department, 60);
  if (!name || !department) return hrErr('กรอกข้อมูลไม่ครบ');
  if (HR_REAL_DEPARTMENTS.indexOf(department) < 0) return hrErr('กลุ่มงานไม่ถูกต้อง');
  var sh = hrTab('STAFF');
  if (hrStaffRow(sh, name) > 0) return hrErr('มีชื่อนี้ในระบบแล้ว');
  sh.appendRow([cell(name, 100), department, hrColor(color) || '#1a56db']);
  return hrOk('เพิ่มเจ้าหน้าที่สำเร็จ', { id: name });
}
function hrDeleteStaff(name) {
  name = hrStr(name, 100); var sh = hrTab('STAFF'), row = hrStaffRow(sh, name);
  if (row < 0) return hrErr('ไม่พบชื่อในระบบ');
  sh.deleteRow(row); return hrOk('ลบเจ้าหน้าที่สำเร็จ', { id: name });
}
function hrUpdateStaffDept(name, dept) {
  name = hrStr(name, 100); dept = hrStr(dept, 60);
  if (HR_REAL_DEPARTMENTS.indexOf(dept) < 0) return hrErr('กลุ่มงานไม่ถูกต้อง');
  var sh = hrTab('STAFF'), row = hrStaffRow(sh, name);
  if (row < 0) return hrErr('ไม่พบชื่อในระบบ');
  sh.getRange(row, 2).setValue(dept); return hrOk('อัปเดตกลุ่มงานสำเร็จ', { id: name });
}
function hrUpdateStaffColor(name, color) {
  name = hrStr(name, 100);
  if (!hrColor(color)) return hrErr('รูปแบบสีไม่ถูกต้อง');
  var sh = hrTab('STAFF'), row = hrStaffRow(sh, name);
  if (row < 0) return hrErr('ไม่พบชื่อในระบบ');
  sh.getRange(row, 3).setValue(hrColor(color)); return hrOk('อัปเดตสีสำเร็จ', { id: name });
}

/* ------------------------- records (the shared calendar) -------------------- */
/** One normalised record from a HR_Control row (day strings, HH:mm times). */
function hrRec(r, tz) {
  var start = hrDay(r[4], tz), end = hrDay(r[5], tz) || start;
  return { name: String(r[1] || '').trim(), dept: String(r[2] || ''), type: String(r[3] || '').trim(), start: start, end: end < start ? start : end,
    st: hrTime(r[6], tz), et: hrTime(r[7], tz), note: String(r[8] || ''), file: String(r[9] || ''), id: String(r[10] || ''), province: String(r[11] || '').trim(),
    mission: String(r[12] || '').trim(), owner: String(r[13] || '').trim().toLowerCase(), created: r[0] instanceof Date ? r[0].getTime() : (Date.parse(String(r[0] || '')) || 0) };
}
function hrCanEdit(sc, rec) { return sc.admin || sc.editAll || (!!rec.owner && rec.owner === sc.email); }

function hrColorMap() { var m = {}; hrStaffList().forEach(function (s) { if (s.color) m[s.name] = s.color; }); return m; }
/** One pass over the three sheets that boot / getAll need (the old code read CONTROL twice, STAFF twice and HOLIDAY twice per page open). */
function hrBundle() {
  var sh = hrTab('CONTROL'), tz = hrTz(sh), staff = hrStaffList(), colors = {};
  staff.forEach(function (s) { if (s.color) colors[s.name] = s.color; });
  return { recs: hrRead(sh, 14).map(function (r) { return hrRec(r, tz); }), staff: staff, colors: colors, holidays: hrHolidayMap() };
}
function hrEvents(sc, pre) {
  pre = pre || hrBundle();
  var colors = pre.colors, events = [], cutoff = hrAddDays(hrToday(), -HR_KEEP_DAYS);
  pre.recs.forEach(function (x) {
    if (!x.name || !x.start || x.end < cutoff) return;
    var half = x.type.indexOf('ครึ่งวัน') >= 0, fcStart, fcEnd;
    if (x.st && x.et) { fcStart = x.start + 'T' + x.st + ':00'; fcEnd = x.end + 'T' + x.et + ':00'; }
    else if (half) {
      if (x.note.toLowerCase().indexOf('บ่าย') >= 0) { fcStart = x.start + 'T13:00:00'; fcEnd = x.start + 'T16:00:00'; } else { fcStart = x.start + 'T08:00:00'; fcEnd = x.start + 'T12:00:00'; }
    } else { fcStart = x.start + 'T08:00:00'; fcEnd = x.end + 'T16:30:00'; }
    var color = colors[x.name] || hrAutoColor(x.name), di = HR_DEPARTMENTS.indexOf(x.dept), vac = x.type === 'ลาพักผ่อน' || x.type === 'ลาพักผ่อนครึ่งวัน';
    events.push({ id: x.id, title: (vac ? '🌴 ' : '') + x.type + (x.province ? ' (' + x.province + ')' : '') + ' · ' + x.name + (x.mission ? ' — ' + x.mission : ''),
      start: fcStart, end: fcEnd, backgroundColor: color, borderColor: color,
      extendedProps: { name: x.name, department: x.dept, deptKey: 'dept' + (di >= 0 ? di + 1 : 1), type: x.type, startDate: x.start, endDate: x.end, startTime: x.st, endTime: x.et, isHalfDay: half,
        note: x.note, file: x.file, recordId: x.id, province: x.province, mission: x.mission, createdAt: x.created, canEdit: hrCanEdit(sc, x) } });
  });
  return events;
}
/** Per-day head count on leave (weekdays that are not holidays, between StartDate and EndDate) → { 'yyyy-MM-dd|dept': n } for days >= from. */
function hrLeaveLoad(recs, holidays, from) {
  var load = {};
  recs.forEach(function (x) {
    if (HR_LEAVE_CATS.indexOf(x.type) < 0 || !x.start) return;
    var day = x.start, guard = 0;
    while (day <= x.end && guard++ < HR_MAX_SPAN_DAYS) {
      if (day >= from && hrIsWorkday(day, holidays)) { var k = day + '|' + x.dept; load[k] = (load[k] || 0) + 1; }
      day = hrAddDays(day, 1);
    }
  });
  return load;
}
function hrDashboard(pre) {
  pre = pre || hrBundle();
  var recs = pre.recs, holidays = pre.holidays, today = hrToday();
  var counts = { total: 0, meetingAll: 0, leaveAll: 0 }; HR_LEAVE_TYPES.forEach(function (t) { counts[t] = 0; });
  var workday = hrIsWorkday(today, holidays);
  recs.forEach(function (x) {
    if (!x.start || x.start > today || x.end < today) return;
    var leave = HR_LEAVE_CATS.indexOf(x.type) >= 0;
    if (leave && !workday && x.start !== today) return;   // a leave that spans a weekend/holiday does not count on that day
    if (counts[x.type] !== undefined) counts[x.type]++;
    counts.total++;
    if (HR_MEETING_TYPES.indexOf(x.type) >= 0) counts.meetingAll++;
    if (leave) counts.leaveAll++;
  });
  var load = hrLeaveLoad(recs, holidays, hrAddDays(today, -14)), over = {};
  Object.keys(load).forEach(function (k) { if (load[k] >= HR_MAX_LEAVE) over[k.split('|')[0]] = 1; });
  return { counts: counts, total: counts.total, overLimitDates: Object.keys(over).sort(), maxLeave: HR_MAX_LEAVE, departments: HR_DEPARTMENTS, leaveTypes: HR_LEAVE_TYPES };
}
function hrAll(sc, pre) { pre = pre || hrBundle(); return { dashboard: hrDashboard(pre), events: hrEvents(sc, pre) }; }
function hrBoot(sc) {
  var pre = hrBundle(), all = hrAll(sc, pre);
  return { me: { email: sc.email, admin: sc.admin, dev: sc.dev, editAll: sc.editAll }, config: { maxLeave: HR_MAX_LEAVE, departments: HR_DEPARTMENTS, leaveTypes: HR_LEAVE_TYPES, projectStatuses: HR_PROJECT_STATUSES },
    staff: pre.staff, holidays: pre.holidays, dashboard: all.dashboard, events: all.events, version: HR_VERSION };
}

/** Validate + normalise the form of saveData / updateRecord. Throws httpError for anything the page could never send. */
function hrCleanForm(f, holidays, isUpdate) {
  if (!f || typeof f !== 'object') throw httpError('BAD_REQUEST', 'รูปแบบคำขอไม่ถูกต้อง');
  var o = { id: hrStr(f.id, 60), name: hrStr(f.name, 100), department: hrStr(f.department, 60), type: hrStr(f.type, 40), startDate: hrStr(f.startDate, 10), endDate: hrStr(f.endDate, 10),
    startTime: hrTimeIn(f.startTime), endTime: hrTimeIn(f.endTime), note: hrStr(f.note, 500), province: hrStr(f.province, 80), mission: hrStr(f.mission, 200) };
  if (isUpdate && !o.id) throw httpError('BAD_REQUEST', 'ไม่ระบุ ID');
  if (!o.name || !o.type || !o.startDate) throw httpError('BAD_REQUEST', isUpdate ? 'กรอกข้อมูลไม่ครบ' : 'กรอกข้อมูลไม่ครบ (ชื่อ / ประเภท / วันที่)');
  if (HR_DEPARTMENTS.indexOf(o.department) < 0) throw httpError('BAD_REQUEST', 'กลุ่มงานไม่ถูกต้อง');
  if (HR_LEAVE_TYPES.indexOf(o.type) < 0) throw httpError('BAD_REQUEST', 'ประเภทการลาไม่ถูกต้อง');
  if (!hrDateOk(o.startDate)) throw httpError('BAD_REQUEST', 'รูปแบบวันที่ไม่ถูกต้อง');
  o.endDate = o.endDate || o.startDate;
  if (!hrDateOk(o.endDate)) throw httpError('BAD_REQUEST', 'รูปแบบวันที่ไม่ถูกต้อง');
  if (o.endDate < o.startDate) throw httpError('BAD_REQUEST', 'วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่ม');
  if (hrDaysBetween(o.startDate, o.endDate) >= HR_MAX_SPAN_DAYS) throw httpError('BAD_REQUEST', 'ช่วงวันที่ยาวเกิน 1 ปี');
  if (o.startDate === o.endDate && o.startTime && o.endTime && hrMin(o.endTime) <= hrMin(o.startTime)) throw httpError('BAD_REQUEST', 'เวลาสิ้นสุดต้องหลังเวลาเริ่ม');
  o.isLeave = HR_LEAVE_CATS.indexOf(o.type) >= 0;
  if (o.isLeave && holidays[o.startDate]) throw httpError('HOLIDAY', '❌ ' + o.startDate + ' เป็นวันหยุดราชการ (' + holidays[o.startDate] + ') ไม่สามารถบันทึกการลาได้');
  return o;
}
function hrBadFormResult(e) { if (e && e.expected && (e.code === 'BAD_REQUEST' || e.code === 'BAD_TIME' || e.code === 'HOLIDAY' || e.code === 'BAD_URL' || e.code === 'BAD_FILE')) return hrErr(e.message); throw e; }

function hrSaveData(sc, f) {
  var sh = hrTab('CONTROL'), tz = hrTz(sh), holidays = hrHolidayMap(), o;
  try { o = hrCleanForm(f, holidays, false); } catch (e) { return hrBadFormResult(e); }
  var recs = hrRead(sh, 14).map(function (r) { return hrRec(r, tz); }), fileUrl = '';
  var noteText = o.note;
  if (o.isLeave) {   // quota: at most HR_MAX_LEAVE people of the group on leave that day
    var onLeave = recs.filter(function (x) { return x.dept === o.department && HR_LEAVE_CATS.indexOf(x.type) >= 0 && x.start <= o.startDate && x.end >= o.startDate && hrIsWorkday(o.startDate, holidays); }).length;
    if (onLeave >= HR_MAX_LEAVE) {
      if (!noteText) return hrErr('⚠️ "' + o.department + '" มีผู้ลาครบ ' + HR_MAX_LEAVE + ' คนแล้ววันนี้ กรุณาระบุเหตุผลในหมายเหตุก่อนบันทึก', { overQuota: true });
      noteText = '⚠️ เกินโควต้า: ' + noteText;
    }
  }
  var overlap = '';
  if (HR_OVERLAP_TYPES.indexOf(o.type) >= 0 && o.startTime && o.endTime) {   // same group, same day, overlapping hours, someone else
    var ns = hrMin(o.startTime), ne = hrMin(o.endTime);
    recs.forEach(function (x) {
      if (!x.name || x.name === o.name || x.dept !== o.department || HR_OVERLAP_TYPES.indexOf(x.type) < 0 || x.start !== o.startDate || !x.st || !x.et) return;
      if (ns < hrMin(x.et) && ne > hrMin(x.st)) overlap += x.name + ' (' + x.st + '-' + x.et + ') ';
    });
  }
  if (f.fileBase64) { try { fileUrl = hrUpload(sc, f); } catch (e) { if (e && e.expected) return hrErr('อัปโหลดไฟล์ไม่สำเร็จ: ' + e.message); throw e; } }
  var id = Utilities.getUuid();
  sh.appendRow([new Date(), cell(o.name, 100), o.department, o.type, o.startDate, o.endDate, o.startTime ? "'" + o.startTime : '', o.endTime ? "'" + o.endTime : '', cell(noteText, 520), fileUrl, id, cell(o.province, 80), cell(o.mission, 200), sc.email]);
  recs.push({ name: o.name, dept: o.department, type: o.type, start: o.startDate, end: o.endDate });
  var msg = 'บันทึกสำเร็จ ✓' + (overlap ? '\n⚠️ มีเวลาทับซ้อนกับ: ' + overlap.trim() : '');
  return hrOk(msg, { overlap: overlap !== '', overlapDetail: overlap.trim(), workdayWarning: o.isLeave ? hrWorkdayWarning(recs, holidays, o.name, o.startDate) : '', id: id });
}
/** Warns when the month would have fewer than 20 working days left for this person (affects the ฉ.11 allowance). */
function hrWorkdayWarning(recs, holidays, name, day) {
  var ym = day.slice(0, 7), first = ym + '-01', total = 0, d = first;
  while (d.slice(0, 7) === ym) { if (hrIsWorkday(d, holidays)) total++; d = hrAddDays(d, 1); }
  var last = hrAddDays(d, -1), away = 0;
  recs.forEach(function (x) {
    if (x.name !== name || HR_LEAVE_CATS.indexOf(x.type) < 0) return;
    if (x.type.indexOf('ครึ่งวัน') >= 0) { if (x.start.slice(0, 7) === ym) away += 0.5; return; }
    var cur = x.start < first ? first : x.start, to = x.end > last ? last : x.end, g = 0;
    while (cur <= to && g++ < 40) { if (hrIsWorkday(cur, holidays)) away++; cur = hrAddDays(cur, 1); }
  });
  var remain = total - away;
  return remain < 20 ? '⚠️ วันทำการในเดือนนี้เหลือ ' + remain + ' วัน (จาก ' + total + ' วัน) — อาจไม่ครบ 20 วันทำการ ส่งผลต่อการรับ ฉ.11 (เบี้ย)' : '';
}
function hrUpdateRecord(sc, f) {
  var sh = hrTab('CONTROL'), tz = hrTz(sh), holidays = hrHolidayMap(), o;
  try { o = hrCleanForm(f, holidays, true); } catch (e) { return hrBadFormResult(e); }
  var rows = hrRead(sh, 14), i = hrFindRow(rows, 10, o.id);
  if (i < 0) return hrErr('ไม่พบรายการที่ต้องการแก้ไข');
  var cur = hrRec(rows[i], tz);
  if (!hrCanEdit(sc, cur)) return hrErr('แก้ไขได้เฉพาะรายการที่คุณบันทึกเองหรือผู้ดูแลระบบ');
  var fileUrl = String(rows[i][9] || '');
  if (f.fileBase64) { try { fileUrl = hrUpload(sc, f); } catch (e) { if (e && e.expected) return hrErr('อัปโหลดไฟล์ไม่สำเร็จ: ' + e.message); throw e; } }
  var row = i + 2;
  sh.getRange(row, 1, 1, 10).setValues([[new Date(), cell(o.name, 100), o.department, o.type, o.startDate, o.endDate, o.startTime ? "'" + o.startTime : '', o.endTime ? "'" + o.endTime : '', cell(o.note, 520), fileUrl]]);
  sh.getRange(row, 12, 1, 2).setValues([[cell(o.province, 80), cell(o.mission, 200)]]);
  var recs = hrRead(sh, 14).map(function (r) { return hrRec(r, tz); });
  return hrOk('แก้ไขรายการสำเร็จ ✓', { workdayWarning: o.isLeave ? hrWorkdayWarning(recs, holidays, o.name, o.startDate) : '', id: o.id });
}
function hrDeleteRecord(sc, id) {
  id = hrStr(id, 60);
  if (!id) return hrErr('ไม่ระบุ ID');
  var sh = hrTab('CONTROL'), tz = hrTz(sh), rows = hrRead(sh, 14), i = hrFindRow(rows, 10, id);
  if (i < 0) return hrErr('ไม่พบรายการ');
  if (!hrCanEdit(sc, hrRec(rows[i], tz))) return hrErr('ลบได้เฉพาะรายการที่คุณบันทึกเองหรือผู้ดูแลระบบ');
  sh.deleteRow(i + 2); return hrOk('ลบรายการสำเร็จ', { id: id });
}
function hrRecordsByName(name) {
  name = hrStr(name, 100); if (!name) return [];
  var sh = hrTab('CONTROL'), tz = hrTz(sh), out = [];
  hrRead(sh, 14).forEach(function (r) {
    var x = hrRec(r, tz);
    if (x.name === name) out.push({ id: x.id, type: x.type, startDate: x.start, endDate: x.end, note: x.note, file: x.file, province: x.province, mission: x.mission });
  });
  return out;
}

/* --------------------------------- attachments ----------------------------- */
function hrMagic(bytes) {   // PDF / JPEG / PNG only, judged by the real bytes (the file name and MIME type come from the browser)
  var b = bytes.slice(0, 4).map(function (x) { return x < 0 ? x + 256 : x; });
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return { mime: 'application/pdf', ext: 'pdf' };
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return { mime: 'image/jpeg', ext: 'jpg' };
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return { mime: 'image/png', ext: 'png' };
  return null;
}
function hrFolder() {
  var id = prop('HR_FOLDER_ID');
  if (id) return DriveApp.getFolderById(id);
  var root = prop('DRIVE_FOLDER_ID');
  if (root) return subFolder(DriveApp.getFolderById(root), 'HR_Attachments');
  var it = DriveApp.getFoldersByName('HR_Attachments');
  return it.hasNext() ? it.next() : DriveApp.createFolder('HR_Attachments');
}
function hrUpload(sc, f) {
  if (typeof f.fileBase64 !== 'string' || !f.fileBase64) throw httpError('BAD_FILE', 'ไม่พบข้อมูลไฟล์');
  if (Math.ceil(f.fileBase64.length * 3 / 4) > HR_MAX_FILE + 4) throw httpError('BAD_FILE', 'ไฟล์ใหญ่เกิน ' + (HR_MAX_FILE / 1048576) + ' MB');
  var bytes = Utilities.base64Decode(f.fileBase64);
  if (bytes.length > HR_MAX_FILE) throw httpError('BAD_FILE', 'ไฟล์ใหญ่เกิน ' + (HR_MAX_FILE / 1048576) + ' MB');
  var kind = hrMagic(bytes);
  if (!kind) throw httpError('BAD_FILE', 'รองรับเฉพาะไฟล์ PDF, JPG, PNG');
  var base = String(f.fileName || 'attachment').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/^\.+/, '').slice(0, 100) || 'attachment';
  var file = hrFolder().createFile(Utilities.newBlob(bytes, kind.mime, Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMdd-HHmmss') + '_' + base + '.' + kind.ext));
  var mode = prop('HR_FILE_SHARING') || 'link';
  if (mode === 'link') file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  else if (mode === 'domain') { try { file.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW); } catch (x) { /* not a Workspace domain: stays private */ } }
  try { file.addViewer(sc.email); } catch (x) { /* the owner already has access */ }
  return file.getUrl();
}

/* ---------------------------------- reports -------------------------------- */
function hrMonthlySummary(yearAD, month) {
  var y = parseInt(yearAD, 10), m = parseInt(month, 10);
  if (!(y >= 2000 && y <= 2100) || !(m >= 1 && m <= 12)) throw httpError('BAD_REQUEST', 'ปี/เดือนไม่ถูกต้อง');
  var sh = hrTab('CONTROL'), tz = hrTz(sh), holidays = hrHolidayMap(), ym = y + '-' + hrPad(m), first = ym + '-01', last = hrAddDays(first, 31).slice(0, 7) === ym ? ym + '-31' : hrAddDays(hrAddDays(first, 31).slice(0, 8) + '01', -1);
  var sum = {}, order = [];
  hrRead(sh, 14).forEach(function (r) {
    var x = hrRec(r, tz);
    if (!x.name || !x.start || x.start > last || x.end < first) return;
    var key = x.name + '|||' + x.dept;
    if (!sum[key]) { sum[key] = { name: x.name, department: x.dept }; HR_REPORT_KEYS.forEach(function (k) { sum[key][k] = 0; }); order.push(key); }
    var half = x.type.indexOf('ครึ่งวัน') >= 0, base = half ? x.type.replace('ครึ่งวัน', '').trim() : x.type;
    if (sum[key][base] === undefined) return;
    if (half) { if (x.start.slice(0, 7) === ym) sum[key][base] += 0.5; return; }
    var cur = x.start < first ? first : x.start, to = x.end > last ? last : x.end, g = 0;   // working days inside this month only
    while (cur <= to && g++ < 40) { if (hrIsWorkday(cur, holidays)) sum[key][base]++; cur = hrAddDays(cur, 1); }
  });
  return order.map(function (k) { return sum[k]; });
}
function hrCsvCell(v) {
  var s = String(v == null ? '' : v).replace(/'/g, '').replace(/\r?\n/g, ' ');
  if (/^[=+\-@]/.test(s)) s = "'" + s;   // spreadsheet-formula injection
  return /[",]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function hrExportReport() {
  var sh = hrTab('CONTROL'), tz = hrTz(sh), th = function (d) { var y = hrDay(d, tz); return y ? y.slice(8) + '/' + y.slice(5, 7) + '/' + (Number(y.slice(0, 4)) + 543) : ''; };
  var rows = [['วันที่บันทึก', 'ชื่อ', 'หน่วยงาน', 'ประเภท', 'วันที่เริ่ม', 'วันที่สิ้นสุด', 'เวลาเริ่ม', 'เวลาสิ้นสุด', 'หมายเหตุ', 'ไฟล์', 'ID', 'จังหวัด', 'ภารกิจ']];
  hrRead(sh, 14).forEach(function (r) { rows.push([th(r[0]), r[1], r[2], r[3], th(r[4]), th(r[5]), hrTime(r[6], tz), hrTime(r[7], tz), r[8], r[9], r[10], r[11], r[12]]); });
  return '\uFEFF' + rows.map(function (r) { return r.map(hrCsvCell).join(','); }).join('\n');
}

/* ------------------- dev tools: บันทึกประจำวัน / โปรเจคที่ดูแล ------------------- */
/** A row is visible to its owner; rows from before the Owner column existed are visible to admins only. */
function hrMine(sc, owner) { owner = String(owner || '').trim().toLowerCase(); return owner ? owner === sc.email : sc.admin; }
function hrDlogList(sc) {
  var sh = hrTab('DLOG'), tz = hrTz(sh), out = [];
  hrRead(sh, 7).forEach(function (r) {
    if (!r[5] || !hrMine(sc, r[6])) return;
    out.push({ id: String(r[5]), date: hrDay(r[1], tz), project: String(r[2] || ''), detail: String(r[3] || ''), hours: r[4] === '' || r[4] == null ? '' : Number(r[4]) || '', timestamp: r[0] instanceof Date ? r[0].getTime() : 0 });
  });
  out.sort(function (a, b) { return a.date !== b.date ? (a.date < b.date ? 1 : -1) : b.timestamp - a.timestamp; });
  return out;
}
function hrDlogForm(f, isUpdate) {
  if (!f || typeof f !== 'object') throw httpError('BAD_REQUEST', 'รูปแบบคำขอไม่ถูกต้อง');
  var o = { id: hrStr(f.id, 60), date: hrStr(f.date, 10), project: hrStr(f.project, 120), detail: hrStr(f.detail, 500), hours: '' };
  if (isUpdate && !o.id) throw httpError('BAD_REQUEST', 'ไม่ระบุ ID');
  if (!o.date || !o.detail) throw httpError('BAD_REQUEST', 'กรุณากรอกวันที่และรายละเอียด');
  if (!hrDateOk(o.date)) throw httpError('BAD_REQUEST', 'รูปแบบวันที่ไม่ถูกต้อง');
  if (f.hours !== '' && f.hours != null) { var n = Number(f.hours); if (!(n >= 0 && n <= 24)) throw httpError('BAD_REQUEST', 'จำนวนชั่วโมงต้องอยู่ระหว่าง 0–24'); o.hours = n; }
  return o;
}
function hrDlogSave(sc, f, isUpdate) {
  var o; try { o = hrDlogForm(f, isUpdate); } catch (e) { return hrBadFormResult(e); }
  var sh = hrTab('DLOG');
  if (!isUpdate) { var id = Utilities.getUuid(); sh.appendRow([new Date(), o.date, cell(o.project, 120), cell(o.detail, 520), o.hours, id, sc.email]); return hrOk('บันทึกประจำวันสำเร็จ', { id: id }); }
  var rows = hrRead(sh, 7), i = hrFindRow(rows, 5, o.id);
  if (i < 0 || !hrMine(sc, rows[i][6])) return hrErr('ไม่พบรายการ');
  sh.getRange(i + 2, 1, 1, 5).setValues([[new Date(), o.date, cell(o.project, 120), cell(o.detail, 520), o.hours]]);
  return hrOk('แก้ไขบันทึกสำเร็จ', { id: o.id });
}
function hrDlogDelete(sc, id) {
  id = hrStr(id, 60); if (!id) return hrErr('ไม่ระบุ ID');
  var sh = hrTab('DLOG'), rows = hrRead(sh, 7), i = hrFindRow(rows, 5, id);
  if (i < 0 || !hrMine(sc, rows[i][6])) return hrErr('ไม่พบรายการ');
  sh.deleteRow(i + 2); return hrOk('ลบบันทึกสำเร็จ', { id: id });
}
function hrProjList(sc) {
  var sh = hrTab('PROJ'), tz = hrTz(sh), out = [];
  hrRead(sh, 11).forEach(function (r) {
    if (!r[6] || !hrMine(sc, r[10])) return;
    out.push({ id: String(r[6]), name: String(r[1] || ''), url: String(r[2] || ''), status: String(r[3] || '') || HR_PROJECT_STATUSES[0], nextAction: String(r[4] || ''), notes: String(r[5] || ''),
      startDate: hrDay(r[7], tz), targetDate: hrDay(r[8], tz), progress: r[9] === '' || r[9] == null ? 0 : (Number(r[9]) || 0), updatedAt: r[0] instanceof Date ? r[0].getTime() : 0 });
  });
  out.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
  return out;
}
function hrProjForm(f, isUpdate) {
  if (!f || typeof f !== 'object') throw httpError('BAD_REQUEST', 'รูปแบบคำขอไม่ถูกต้อง');
  var o = { id: hrStr(f.id, 60), name: hrStr(f.name, 120), url: hrHttpUrl(f.url), status: hrStr(f.status, 30) || HR_PROJECT_STATUSES[0], nextAction: hrStr(f.nextAction, 300), notes: hrStr(f.notes, 500),
    startDate: hrStr(f.startDate, 10), targetDate: hrStr(f.targetDate, 10), progress: 0 };
  if (isUpdate && !o.id) throw httpError('BAD_REQUEST', 'ไม่ระบุ ID');
  if (!o.name) throw httpError('BAD_REQUEST', 'กรุณากรอกชื่อโปรเจค');
  if (HR_PROJECT_STATUSES.indexOf(o.status) < 0) o.status = HR_PROJECT_STATUSES[0];
  if (o.startDate && !hrDateOk(o.startDate)) throw httpError('BAD_REQUEST', 'รูปแบบวันที่ไม่ถูกต้อง');
  if (o.targetDate && !hrDateOk(o.targetDate)) throw httpError('BAD_REQUEST', 'รูปแบบวันที่ไม่ถูกต้อง');
  if (o.startDate && o.targetDate && o.targetDate < o.startDate) throw httpError('BAD_REQUEST', 'กำหนดเสร็จต้องไม่ก่อนวันเริ่มโปรเจค');
  var p = Number(f.progress); o.progress = isFinite(p) ? Math.max(0, Math.min(100, Math.round(p))) : 0;
  return o;
}
function hrProjSave(sc, f, isUpdate) {
  var o; try { o = hrProjForm(f, isUpdate); } catch (e) { return hrBadFormResult(e); }
  var sh = hrTab('PROJ');
  if (!isUpdate) { var id = Utilities.getUuid(); sh.appendRow([new Date(), cell(o.name, 120), o.url, o.status, cell(o.nextAction, 300), cell(o.notes, 520), id, o.startDate, o.targetDate, o.progress, sc.email]); return hrOk('เพิ่มโปรเจคสำเร็จ', { id: id }); }
  var rows = hrRead(sh, 11), i = hrFindRow(rows, 6, o.id);
  if (i < 0 || !hrMine(sc, rows[i][10])) return hrErr('ไม่พบโปรเจค');
  var row = i + 2;
  sh.getRange(row, 1, 1, 6).setValues([[new Date(), cell(o.name, 120), o.url, o.status, cell(o.nextAction, 300), cell(o.notes, 520)]]);
  sh.getRange(row, 8, 1, 3).setValues([[o.startDate, o.targetDate, o.progress]]);
  return hrOk('แก้ไขโปรเจคสำเร็จ', { id: o.id });
}
function hrProjDelete(sc, id) {
  id = hrStr(id, 60); if (!id) return hrErr('ไม่ระบุ ID');
  var sh = hrTab('PROJ'), rows = hrRead(sh, 11), i = hrFindRow(rows, 6, id);
  if (i < 0 || !hrMine(sc, rows[i][10])) return hrErr('ไม่พบโปรเจค');
  sh.deleteRow(i + 2); return hrOk('ลบโปรเจคสำเร็จ', { id: id });
}

/* ----------------------------------- setup --------------------------------- */
/** Creates / repairs the five tabs, styles the headers, adds drop-down validation for Type and Department. Safe to run again. */
function setupHr() {
  hrColsReset();
  var widths = { CONTROL: [150, 160, 170, 130, 100, 100, 80, 80, 260, 260, 260, 120, 220, 200], STAFF: [200, 180, 90], HOLIDAY: [100, 260, 90, 150], DLOG: [150, 100, 180, 380, 70, 260, 200], PROJ: [150, 200, 240, 110, 240, 260, 260, 100, 100, 80, 200],
    LUSERS: [300, 180, 150, 90, 150, 100, 110], LSCHED: [100, 330, 70, 60, 150, 100, 220] };
  Object.keys(HR_T).forEach(function (k) { var sh = hrTab(k); styleTab(sh, HR_H[k], widths[k], k === 'HOLIDAY' ? 4 : (k === 'STAFF' || k === 'LUSERS' || k === 'LSCHED' ? 0 : 1)); });
  var c = hrTab('CONTROL');
  c.getRange('E2:F').setNumberFormat('yyyy-mm-dd');
  c.getRange('D2:D').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(HR_LEAVE_TYPES).setAllowInvalid(false).build());
  c.getRange('C2:C').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(HR_DEPARTMENTS).setAllowInvalid(false).build());
  var ss = hrSs();
  console.log('HR พร้อมใช้งาน (ต่อด้วย hrLineSetup() เพื่อเปิดแจ้งเตือน LINE) — สเปรดชีต: ' + (ss ? ss.getName() + ' (HR_SHEET_ID)' : 'LOG_SHEET_ID') + ' | แท็บ: ' + Object.keys(HR_T).map(function (k) { return HR_T[k]; }).join(', '));
}
function hrSetupNow() { setupHr(); return { status: 'success', message: 'ตั้งค่าระบบเรียบร้อย' }; }