/**
 * SAND Office Tools — SarImport.gs   นำเข้าทะเบียนหนังสือเดิม (Google Sheet ของธุรการ) เข้าสู่ระบบสารบรรณ   (Saraban.gs, op "impscan" / "import" / "impsync")
 *
 * Reads the clerks' existing registers straight from a Google Sheet (by link or id) and writes them into the Saraban register (tab "Saraban")
 * so the old numbers, dates, subjects and senders are searchable and the NEXT number simply continues after the last imported one.
 *   • one tab of the sheet = one register (รับ / ส่ง) of one registry (งานยุทธศาสตร์ฯ, งานพัฒนาคุณภาพฯ … = the units that have "มีทะเบียนของตนเอง", or the central register)
 *   • columns are found by their HEADER NAMES, so the clerks may add / move columns; the old sheet is never changed
 *   • safe to run again: every imported row remembers its source (tab + row) in column dedup ("imp:<sheet>:<gid>:<row>"), so a second run only adds NEW rows  → this is the "sync"
 *   • numbers: "keep" = use the number written in the sheet (a duplicate or empty number gets the next free number, and the old text is kept in the note);
 *              "new"  = ignore the sheet's numbers and number the rows by date, continuing after what the register already holds
 *   • nothing is lost: columns that are not understood are kept in the row's JSON column (extra.legacy)
 * Admin only (ADMIN_EMAILS).  The Apps Script owner must be able to open the sheet (view access is enough).
 *   Script properties written by a successful import: SAR_IMPORT_SHEET_ID, SAR_IMPORT_PLAN (used by "ซิงก์แถวใหม่" and by the optional trigger syncSarabanLegacy()).
 */

var SARIMP_MAX_ROWS = 5000;

/* ------------------------------------------- pure helpers ------------------------------------------- */

function sarImpId(src) {
  var s = String(src == null ? '' : src).trim(), m = /\/d\/([A-Za-z0-9_-]{20,})/.exec(s);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{20,}$/.test(s) ? s : '';
}
function sarImpNorm(s) { return String(s == null ? '' : s).replace(/[\s\u200b]+/g, ' ').trim(); }
function sarImpHeader(s) { return sarImpNorm(s).replace(/\s+/g, '').toLowerCase(); }
function sarImpText(v, max) { return sarOneLine(sarImpNorm(v), max || 300); }
/** Cell → yyyy-MM-dd (Buddhist or Christian year, Date object or text such as 5/1/2569) or ''. */
function sarImpDate(v, tz) {
  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (isNaN(v.getTime())) return '';
    var t = Utilities.formatDate(v, tz || SAR_TZ, 'yyyy-MM-dd'), m0 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
    return m0 ? sarIso(m0[1], m0[2], m0[3]) : '';
  }
  var s = sarDigits(sarImpNorm(v)); if (!s) return '';
  var m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return sarIso(m[1], m[2], m[3]);
  m = /^(\d{1,2})\s*[\/.\-]+\s*(\d{1,2})\s*[\/.\-]+\s*(\d{4})/.exec(s);
  return m ? sarIso(m[3], m[2], m[1]) : '';
}
function sarImpUrgency(v) {
  var s = sarImpNorm(v);
  if (/ที่สุด/.test(s)) return 'most';
  if (/ด่วนมาก/.test(s)) return 'very';
  if (/ด่วน/.test(s)) return 'urgent';
  return 'normal';
}
/** Number written in a cell: 12, "12", "12.0", "12/2569" → 12; otherwise 0. */
function sarImpNo(v) {
  if (typeof v === 'number') return v > 0 && v === Math.floor(v) && v < 1000000 ? v : 0;
  var m = /^(\d{1,6})(?:\.0+)?(?:\s*\/\s*\d{4})?$/.exec(sarDigits(sarImpNorm(v)));
  return m ? Number(m[1]) : 0;
}
/** "ว.2" / "ว 2" / "ว2" (a circular book number) → 2, else 0. */
function sarImpCircular(v) { var m = /^ว\s*\.?\s*(\d{1,6})$/.exec(sarDigits(sarImpNorm(v))); return m ? Number(m[1]) : 0; }

/**
 * Work out what a tab is: kind (in / out) and which column holds what, from the header row and a look at the data.
 * @returns {{kind:string,col:Object,noIsNumber:boolean,problems:string[],headers:string[]}}
 */
function sarImpLayout(tabName, headerRow, dataRows) {
  var h = headerRow.map(sarImpHeader), name = sarImpNorm(tabName), col = {}, problems = [];
  function idx() { for (var a = 0; a < arguments.length; a++) { var i = h.indexOf(sarImpHeader(arguments[a])); if (i >= 0) return i; } return -1; }
  var kind = h.indexOf('เลขส่ง') >= 0 ? 'out' : h.indexOf('เลขรับ') >= 0 ? 'in' : /ส่ง/.test(name) ? 'out' : /รับ/.test(name) ? 'in' : '';
  if (!kind) problems.push('ไม่ทราบว่าเป็นทะเบียนรับหรือส่ง (ไม่พบคอลัมน์ “เลขรับ” หรือ “เลขส่ง”)');
  col.no = idx('เลขรับ', 'เลขส่ง'); col.date = idx('วันที่รับ', 'วันที่ส่ง', 'วันที่'); col.seq = idx('ที่');
  col.urgency = idx('รายการสำคัญ', 'ชั้นความเร็ว'); col.note = idx('โน้ต', 'หมายเหตุ'); col.subject = idx('เรื่อง');
  col.party = idx('หน่วยงานที่รับ', 'ผู้รับ', 'ผู้ส่ง', 'จาก');
  col.docNo = idx('เลขที่หนังสือ', 'เลขที่หนังสือรับ', 'หน่วยงาน');
  var used = {}; Object.keys(col).forEach(function (k) { if (col[k] >= 0) used[col[k]] = true; });
  function sample(i) { var out = []; for (var r = 0; r < dataRows.length && out.length < 60; r++) { var t = sarImpNorm(dataRows[r][i]); if (t) out.push(t); } return out; }
  function textiness(i) { var s = sample(i), n = 0, len = 0; s.forEach(function (t) { if (!/^[\d.,:\/\-\s]+$/.test(t)) { n++; len += t.length; } }); return { n: n, avg: n ? len / n : 0, total: s.length }; }
  if (col.subject < 0) {   // header missing or unnamed: the unused text column with the longest text
    var best = -1, bestAvg = 0;
    for (var i = 0; i < h.length; i++) { if (used[i] || /^(ส่งได้|โน้ต|หมายเหตุ)$/.test(h[i])) continue; var t = textiness(i); if (t.n >= 3 && t.avg > bestAvg) { best = i; bestAvg = t.avg; } }
    col.subject = best; if (best >= 0) used[best] = true;
  }
  if (col.subject < 0) problems.push('ไม่พบคอลัมน์ “เรื่อง”');
  if (col.date < 0) problems.push('ไม่พบคอลัมน์ “วันที่รับ/ส่ง”');
  var numeric = 0, total = 0;
  if (col.no >= 0) for (var r = 0; r < dataRows.length && total < 80; r++) { var c = dataRows[r][col.no]; if (sarImpNorm(c)) { total++; if (sarImpNo(c) || (kind === 'out' && sarImpCircular(c))) numeric++; } }
  var noIsNumber = col.no >= 0 && total > 0 && numeric / total >= 0.6;
  if (kind === 'in' && col.no >= 0 && !noIsNumber) {   // the "เลขรับ" column really holds the incoming book number
    col.docNo = col.no; col.noFromBook = true;
  }
  if (kind === 'in' && col.party < 0) {   // unnamed ("Column 11") column with sender names
    var bp = -1, bn = 0;
    for (var j = 0; j < h.length; j++) { if (used[j] || j === col.docNo) continue; var tx = textiness(j); if (tx.n > bn && tx.avg >= 4) { bp = j; bn = tx.n; } }
    col.party = bp;
  }
  return { kind: kind, col: col, noIsNumber: noIsNumber, problems: problems, headers: headerRow.map(sarImpNorm) };
}

/**
 * Rows of one tab → register entries (no Google service is touched here, so it is unit-testable).
 * @param {{kind:string,col:Object}} lay  @param {Array<Array>} data rows below the header @param {number} firstRow sheet row number of data[0]
 * @param {{tz?:string,defaultYear:number}} o
 * @returns {{items:Array,skipped:Array}}
 */
function sarImpRows(lay, data, firstRow, o) {
  var c = lay.col, items = [], skipped = [], legacyCols = [];
  lay.headers.forEach(function (hn, i) { if (i !== c.subject && i !== c.date && i !== c.urgency && i !== c.party && i !== c.no && i !== c.seq && i !== c.docNo && i !== c.note && hn) legacyCols.push(i); });
  data.forEach(function (r, k) {
    var row = firstRow + k, subject = c.subject >= 0 ? sarImpText(r[c.subject], 300) : '';
    var rawNo = c.no >= 0 && !c.noFromBook ? sarImpNorm(r[c.no]) : '';
    if (!subject) { if (r.some(function (x) { return sarImpNorm(x) !== ''; }) && (rawNo || (c.docNo >= 0 && sarImpNorm(r[c.docNo])))) skipped.push({ row: row, why: 'ไม่มีเรื่อง' }); return; }
    var date = c.date >= 0 ? sarImpDate(r[c.date], o.tz) : '', warn = [];
    if (c.date >= 0 && sarImpNorm(r[c.date]) && !date) warn.push('วันที่อ่านไม่ได้ (' + sarImpNorm(r[c.date]).slice(0, 20) + ')');
    var legacy = {}; legacyCols.forEach(function (i) { var v = r[i]; if (Object.prototype.toString.call(v) === '[object Date]') v = sarImpDate(v, o.tz) || String(v); v = sarImpNorm(v); if (v) legacy[lay.headers[i] || ('col' + (i + 1))] = v.slice(0, 200); });
    var note = c.note >= 0 ? sarClean(sarImpNorm(r[c.note]), 400) : '';
    var it = { row: row, subject: subject, date: date, year: date ? Number(date.slice(0, 4)) + 543 : 0, urgency: c.urgency >= 0 ? sarImpUrgency(r[c.urgency]) : 'normal',
      docNo: c.docNo >= 0 ? sarImpText(r[c.docNo], 80) : '', party: c.party >= 0 ? sarImpText(r[c.party], 160) : '', note: note, rawNo: rawNo, warn: warn, legacy: legacy, want: 0, circular: 0 };
    if (lay.kind === 'out') { it.circular = sarImpCircular(rawNo); it.want = it.circular || sarImpNo(rawNo); }
    else it.want = lay.noIsNumber ? sarImpNo(rawNo) : 0;
    if (rawNo && !it.want) warn.push('อ่านเลข “' + rawNo.slice(0, 20) + '” ไม่ได้');
    items.push(it);
  });
  return { items: items, skipped: skipped };
}

/**
 * Give every item its register number.
 * @param {string} mode 'keep' | 'new'   @param {Object} used  key "<year>" → {no:true} numbers already taken (existing rows + this run, updated here)
 * @param {Object} top   key "<year>" → highest number so far (updated here)
 */
function sarImpNumber(items, mode, used, top, defaultYear) {
  function yearOf(it) { return it.year || defaultYear; }
  function take(it, no, why) { var y = yearOf(it); used[y] = used[y] || {}; used[y][no] = true; top[y] = Math.max(top[y] || 0, no); it.year = y; it.no = no; if (why) it.warn.push(why); }
  function nextFree(y) { used[y] = used[y] || {}; var n = (top[y] || 0) + 1; while (used[y][n]) n++; return n; }
  var order = items.slice();
  if (mode === 'new') order.sort(function (a, b) { return (a.date || '9999').localeCompare(b.date || '9999') || a.row - b.row; });
  else {   // keep: rows that carry a usable, unused number first (in sheet order), then the others are numbered after the highest
    order.forEach(function (it) {
      var y = yearOf(it);
      if (it.want && !(used[y] && used[y][it.want])) take(it, it.want, '');
    });
  }
  order.forEach(function (it) {
    if (it.no) return;
    var y = yearOf(it), n = nextFree(y);
    take(it, n, mode === 'keep' && it.rawNo ? 'เลขเดิม “' + it.rawNo.slice(0, 20) + '” ซ้ำกับที่มีอยู่ → ออกเลขใหม่ ' + n : (mode === 'keep' ? 'ไม่มีเลขเดิม → ออกเลข ' + n : ''));
  });
  return items;
}

/* ------------------------------------------- Google Sheet access ------------------------------------------- */

function sarImpOpen(src) {
  var id = sarImpId(src);
  if (!id) throw httpError('BAD_REQUEST', 'ลิงก์ Google Sheet ไม่ถูกต้อง (ควรเป็น https://docs.google.com/spreadsheets/d/…)');
  try { return SpreadsheetApp.openById(id); } catch (x) {
    console.error('sarImpOpen ' + x);
    throw httpError('IMPORT_NOACCESS', 'เปิดสเปรดชีตไม่ได้ — แชร์ไฟล์ให้บัญชีที่ Deploy Apps Script นี้ (สิทธิ์ผู้ดูก็พอ) แล้วลองใหม่');
  }
}
function sarImpReadTab(sh) {
  var last = sh.getLastRow(), cols = Math.min(Math.max(sh.getLastColumn(), 1), 40);
  if (last < 1) return { header: [], data: [] };
  if (last - 1 > SARIMP_MAX_ROWS) throw httpError('BAD_REQUEST', 'แท็บ “' + sh.getName() + '” มีมากกว่า ' + SARIMP_MAX_ROWS + ' แถว — แบ่งนำเข้าทีละส่วน');
  var v = sh.getRange(1, 1, last, cols).getValues();
  return { header: v[0], data: v.slice(1) };
}
function sarImpScanTab(sh, tz) {
  var t = sarImpReadTab(sh), lay = sarImpLayout(sh.getName(), t.header, t.data), built = sarImpRows(lay, t.data, 2, { tz: tz });
  var dates = built.items.map(function (x) { return x.date; }).filter(Boolean).sort();
  return { gid: String(sh.getSheetId()), name: sarImpNorm(sh.getName()), kind: lay.kind, rows: built.items.length, skipped: built.skipped.length, problems: lay.problems, noIsNumber: lay.noIsNumber, from: dates[0] || '', to: dates[dates.length - 1] || '',
    columns: lay.headers.filter(Boolean).slice(0, 14), mapped: { subject: lay.headers[lay.col.subject] || '', number: lay.col.noFromBook ? '(ไม่มี — ออกเลขใหม่)' : (lay.headers[lay.col.no] || ''), docNo: lay.headers[lay.col.docNo] || '', party: lay.headers[lay.col.party] || '', date: lay.headers[lay.col.date] || '' },
    sample: built.items.slice(0, 3).map(function (x) { return { row: x.row, no: x.rawNo, docNo: x.docNo, date: x.date, subject: x.subject.slice(0, 80), party: x.party }; }),
    suggest: /ยุทธศาสตร์/.test(sh.getName()) ? 'ยุทธศาสตร์' : /พัฒนาคุณภาพ/.test(sh.getName()) ? 'พัฒนาคุณภาพ' : '' };
}

/* ------------------------------------------- ops ------------------------------------------- */

function sarImpScan(sc, b) {
  sarNeedAdmin(sc);
  var ss = sarImpOpen(b.sheet), tz = ss.getSpreadsheetTimeZone ? ss.getSpreadsheetTimeZone() : SAR_TZ;
  var tabs = ss.getSheets().map(function (sh) { return sarImpScanTab(sh, tz); }).filter(function (t) { return t.rows || t.problems.length < 3; });
  var saved = {}; try { saved = JSON.parse(prop('SAR_IMPORT_PLAN') || '{}'); } catch (x) { saved = {}; }
  return { id: ss.getId ? ss.getId() : sarImpId(b.sheet), name: ss.getName(), tabs: tabs, saved: saved && saved.tabs ? saved : null };
}

/** plan.tabs[] = {gid, registry, numbering:'keep'|'new', include}.  dry=true only counts. */
function sarImpRun(sc, b) {
  sarNeedAdmin(sc);
  var plan = b.plan && typeof b.plan === 'object' ? b.plan : {}, list = Array.isArray(plan.tabs) ? plan.tabs : [];
  if (!list.length) throw httpError('BAD_REQUEST', 'ยังไม่ได้เลือกแท็บที่จะนำเข้า');
  var ss = sarImpOpen(b.sheet), sid = ss.getId ? ss.getId() : sarImpId(b.sheet), tz = ss.getSpreadsheetTimeZone ? ss.getSpreadsheetTimeZone() : SAR_TZ, dry = b.dry === true;
  var byGid = {}; ss.getSheets().forEach(function (sh) { byGid[String(sh.getSheetId())] = sh; });
  var picks = [];
  list.forEach(function (p) {
    if (p.include === false) return;
    var sh = byGid[String(p.gid)]; if (!sh) throw httpError('BAD_REQUEST', 'ไม่พบแท็บที่เลือก (อาจถูกลบหรือเปลี่ยนชื่อ) — กด “ตรวจไฟล์” ใหม่');
    picks.push({ sh: sh, gid: String(p.gid), registry: sarRegistryOk(sc, p.registry), numbering: p.numbering === 'new' ? 'new' : 'keep' });
  });
  if (!picks.length) throw httpError('BAD_REQUEST', 'ยังไม่ได้เลือกแท็บที่จะนำเข้า');
  return sarLocked(function () {
    var reg = sarTab(SAR_TAB), existing = sarAll(reg), seen = Object.create(null), taken = Object.create(null), ev = [], out = [], report = [], now = Date.now(), at0 = sarNowStamp(now), defYear = sarYearBE(now);
    existing.forEach(function (r) { taken[r.id] = true; String(r.dedup || '').split(/\s+/).forEach(function (d) { if (d.indexOf('imp:') === 0) seen[d] = true; }); });
    var counters = Object.create(null);
    picks.forEach(function (p) {
      var t = sarImpReadTab(p.sh), lay = sarImpLayout(p.sh.getName(), t.header, t.data);
      if (!lay.kind || lay.col.subject < 0) { report.push({ tab: sarImpNorm(p.sh.getName()), error: lay.problems.join(' · ') || 'อ่านโครงสร้างตารางไม่ได้' }); return; }
      var built = sarImpRows(lay, t.data, 2, { tz: tz }), fresh = [], dup = 0;
      built.items.forEach(function (it) { var key = 'imp:' + sid.slice(0, 8) + ':' + p.gid + ':' + it.row; it.key = key; if (seen[key]) dup++; else fresh.push(it); });
      var used = {}, top = {};
      existing.forEach(function (r) { if (r.kind === lay.kind && r.registry === p.registry) { var y = r.year; used[y] = used[y] || {}; used[y][r.no] = true; top[y] = Math.max(top[y] || 0, r.no); } });
      out.forEach(function (r) { if (r.kind === lay.kind && r.registry === p.registry) { var y = r.year; used[y] = used[y] || {}; used[y][r.no] = true; top[y] = Math.max(top[y] || 0, r.no); } });
      // a tab that already has rows in the register: a re-run numbers only the new rows (after the highest), never re-uses an old number
      sarImpNumber(fresh, p.numbering, used, top, defYear);
      var circTop = {};
      fresh.forEach(function (it) {
        var id = sarNewId(taken); taken[id] = true;
        var docNo = it.docNo, extra = { imported: { sheet: sid.slice(0, 8), tab: sarImpNorm(p.sh.getName()), row: it.row, at: at0 }, legacy: it.legacy };
        if (lay.kind === 'out') {
          if (it.circular) { docNo = sarBookNo(sc, p.registry, 'circular', it.no, it.circular); circTop[it.year] = Math.max(circTop[it.year] || 0, it.circular); extra.bookType = 'circular'; }
          else { docNo = sarBookNo(sc, p.registry, 'normal', it.no, 0); extra.bookType = 'normal'; }
        }
        var note = it.note; if (lay.kind === 'out' && it.rawNo && String(it.no) !== it.rawNo && !it.circular) note = (note ? note + ' · ' : '') + 'เลขเดิม ' + it.rawNo;
        var o = { row: 0, id: id, kind: lay.kind, year: it.year, no: it.no, reg: sarRegText(it.no, it.year), registry: p.registry, status: lay.kind === 'out' ? 'sent' : 'registered',
          at: (it.date || sarToday(now)) + ' 00:00:00', docNo: docNo, docDate: lay.kind === 'out' ? it.date : '', subject: it.subject, party: lay.kind === 'in' ? (it.party || 'ไม่ระบุผู้ส่ง (ทะเบียนเดิม)') : it.party,
          urgency: it.urgency, secrecy: 'normal', due: '', cat: '', channel: '', files: [], refs: '', encl: '', note: sarClean(note, 500), action: '', by: sc.email, verify: sarVerify(id), inbox: '', dedup: it.key,
          voidWhy: '', salut: '', extra: extra, upd: at0 };
        if (lay.kind === 'out') { var pr = sarImpNorm(it.party); extra.parties = pr ? [{ name: pr.slice(0, 160), channel: 'hand' }] : []; }
        out.push(o); ev.push([at0, id, 'import', sc.email, '', 'นำเข้าจากทะเบียนเดิม ' + o.reg, JSON.stringify({ tab: extra.imported.tab, row: it.row })]);
        var ck = lay.kind + ':' + p.registry + ':' + it.year; counters[ck] = Math.max(counters[ck] || 0, it.no);
        if (circTop[it.year]) counters[ck + ':v'] = Math.max(counters[ck + ':v'] || 0, circTop[it.year]);
        if (it.warn.length) o._warn = it.warn;
      });
      report.push({ tab: sarImpNorm(p.sh.getName()), kind: lay.kind, registry: p.registry, numbering: p.numbering, found: built.items.length, imported: fresh.length, already: dup, skipped: built.skipped.slice(0, 20),
        renumbered: fresh.filter(function (x) { return x.warn.some(function (w) { return /ออกเลข/.test(w); }); }).length,
        warnings: fresh.filter(function (x) { return x.warn.length; }).slice(0, 30).map(function (x) { return { row: x.row, text: x.warn.join(' · ') }; }) });
    });
    if (!dry && out.length) {
      var rows = out.map(function (o) { return sarRow(o); }), start = reg.getLastRow() + 1;
      var rg = reg.getRange(start, 1, rows.length, SAR_COLS); rg.setNumberFormat('@'); rg.setValues(rows);
      var evs = sarTab(SAR_EV), evStart = evs.getLastRow() + 1, er = evs.getRange(evStart, 1, ev.length, EV_COLS); er.setNumberFormat('@'); er.setValues(ev);
      var cnt = sarTab(SAR_CNT), clast = cnt.getLastRow(), have = {};
      if (clast >= 2) cnt.getRange(2, 1, clast - 1, 2).getValues().forEach(function (r, i) { have[String(r[0])] = { row: i + 2, cur: Number(r[1]) || 0 }; });
      Object.keys(counters).forEach(function (k) { var h = have[k], v = [k, Math.max(h ? h.cur : 0, counters[k]), at0, 'นำเข้า']; if (h) sarPut(cnt, h.row, v); else sarAppend(cnt, v); });
      try {
        var props = PropertiesService.getScriptProperties();
        props.setProperty('SAR_IMPORT_SHEET_ID', sid);
        props.setProperty('SAR_IMPORT_PLAN', JSON.stringify({ tabs: picks.map(function (p) { return { gid: p.gid, registry: p.registry, numbering: p.numbering, include: true }; }) }));
      } catch (x) { console.error('sarImport props ' + x); }
      sarLog(sc.email, 'import', sid.slice(0, 8), { rows: out.length, tabs: picks.length });
    }
    return { dry: dry, imported: out.length, tabs: report };
  });
}
function sarImpSync(sc, b) {
  sarNeedAdmin(sc);
  var sid = prop('SAR_IMPORT_SHEET_ID'), plan; try { plan = JSON.parse(prop('SAR_IMPORT_PLAN') || '{}'); } catch (x) { plan = {}; }
  if (!sid || !plan.tabs || !plan.tabs.length) throw httpError('BAD_REQUEST', 'ยังไม่เคยนำเข้า — นำเข้าครั้งแรกก่อน');
  return sarImpRun(sc, { sheet: sid, plan: plan, dry: b.dry === true });
}

/** Optional: Apps Script editor → Triggers → add syncSarabanLegacy (time-driven, e.g. every night) to pull the clerks' new rows automatically. */
function syncSarabanLegacy() {
  var admin = listProp('ADMIN_EMAILS')[0] || 'system';
  var sc = sarScope({ email: admin });
  try { var r = sarImpSync(sc, {}); console.log('syncSarabanLegacy: ' + r.imported + ' แถวใหม่'); } catch (x) { console.error('syncSarabanLegacy ' + x); }
}
