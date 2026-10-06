/**
 * SAND Office Tools — Library (คลังข้อมูล): browse and manage the archive folder in Google Drive.
 *
 * One action, "library", with op = list | recent | search | mkdir | rename | move | note | trash | reindex.
 * The archive folder (DRIVE_FOLDER_ID) is laid out by archive() as   <root>/<yyyy-MM>/<email>/…
 *
 * Rules (all enforced HERE, never in the browser):
 *   • Every id sent by the client is resolved by walking its parents up to the root; anything outside the root is refused.
 *   • Ordinary users reach only  <root>/<month>/<their own email>/…   Emails in ADMIN_EMAILS reach everything.
 *   • The root, month folders and e-mail folders are "system folders": ordinary users cannot rename/move/trash them
 *     (archive() looks them up by name).
 *   • "Delete" = move to the Drive bin (recoverable ~30 days). Set LIBRARY_USER_DELETE=false to make deleting admin-only.
 *   • Every change is written to the Logs sheet (tool = library) so the audit trail survives renames and deletes.
 *
 *   • Tags live in the file/folder description as a last line  "แท็ก: ด่วน, รอลงนาม"  (readable and editable in Drive too).
 *   • Library-wide search reads a search index kept in the sheet tab "Index" (updated on every change made here, rebuilt
 *     hourly-if-needed by libReindexJob). Hits are re-checked against Drive before they are returned.
 *
 * Optional script properties:  LIBRARY_USER_DELETE ("false" = admin-only delete),  LIBRARY_LIMIT_PER_MIN (default 120).
 * Needs the Drive scope (https://www.googleapis.com/auth/drive) — see appsscript.json.
 */

var LIB_NAME_MAX = 120;
var LIB_NOTE_MAX = 500;
var LIB_LIST_MAX = 300;      // max folders + max files returned per folder
var LIB_RECENT_ROWS = 600;   // how many of the newest rows of the Files tab are scanned for "recent"
var LIB_MAX_DEPTH = 10;      // deepest allowed folder nesting (root counts as 1)
var LIB_TAG_MAX = 10;        // tags per item
var IDX_HEADERS = ['รหัส', 'ชนิด', 'ชื่อ', 'เจ้าของ', 'แท็ก', 'หมายเหตุ', 'mime', 'ขนาด', 'แก้ไขล่าสุด (ms)', 'โฟลเดอร์แม่'];
var IDX_COLS = 10;
var IDXQ_HEADERS = ['รหัสโฟลเดอร์', 'ระดับ', 'เจ้าของ'];

/* --------------------------------- entry --------------------------------- */

function library(b) {
  var u = requireUser(b.session);
  rateLimit('library', intProp('LIBRARY_LIMIT_PER_MIN', 120));
  var rootId = prop('DRIVE_FOLDER_ID');
  if (!rootId) throw httpError('NOT_CONFIGURED', 'ยังไม่ได้ตั้งค่า DRIVE_FOLDER_ID');
  var sc = { email: u.email, admin: listProp('ADMIN_EMAILS').indexOf(u.email) >= 0, rootId: rootId, memo: {} };
  switch (String(b.op || '')) {
    case 'list':   return libList(sc, b);
    case 'recent': return libRecent(sc, b);
    case 'search': return libSearch(sc, b);
    case 'reindex':
      if (!sc.admin) throw httpError('FORBIDDEN', 'เฉพาะผู้ดูแลระบบ');
      return libReindex(240000, true);
    case 'mkdir':  return libMkdir(sc, u, b);
    case 'rename': return libRename(sc, u, b);
    case 'move':   return libMove(sc, u, b);
    case 'note':   return libNote(sc, u, b);
    case 'trash':  return libTrash(sc, u, b);
    default: throw httpError('UNKNOWN_ACTION', 'ไม่รู้จักคำสั่งนี้');
  }
}

/* ------------------------------ ancestry guard ----------------------------- */

function libId(v) {
  var s = String(v == null ? '' : v);
  if (!/^[-\w]{10,100}$/.test(s)) throw httpError('BAD_REQUEST', 'รหัสรายการไม่ถูกต้อง');
  return s;
}

/** Folder metadata (memoised per request). null when missing, trashed or unreadable. */
function libFolder(sc, id) {
  if (Object.prototype.hasOwnProperty.call(sc.memo, id)) return sc.memo[id];
  var m = null;
  try {
    var f = DriveApp.getFolderById(id);
    if (!f.isTrashed()) {
      var ps = f.getParents();
      m = { id: id, name: f.getName(), parent: ps.hasNext() ? ps.next().getId() : null };
    }
  } catch (x) { m = null; }
  sc.memo[id] = m;
  return m;
}

/** [item, parent, …, root]. null if the folder is not inside the root (or cannot be read). */
function libChain(sc, id) {
  var out = [], cur = id, guard = 0;
  while (cur && guard++ < 20) {
    var m = libFolder(sc, cur);
    if (!m) return null;
    out.push(m);
    if (cur === sc.rootId) return out;
    cur = m.parent;
  }
  return null;
}

/** Owner e-mail = the folder two levels below the root. Only that exact position counts, so a look-alike folder
 *  somebody creates deeper down can never grant access to another user. */
/** Owner for something newly created inside the folder `parentChain`. */
function libOwnerNew(parentChain, name) {
  return parentChain.length === 2 ? String(name).toLowerCase() : (parentChain.length >= 3 ? libOwner(parentChain) : '');
}
function libOwner(chain) { return chain.length >= 3 ? String(chain[chain.length - 3].name).toLowerCase() : ''; }
function libAllowed(sc, chain) { return !!chain && (sc.admin || libOwner(chain) === sc.email); }

/** Name to show for chain[i]: ordinary users see their e-mail folder as the month (yyyy-MM). */
function libLabel(sc, chain, i) {
  return (!sc.admin && i === chain.length - 3) ? chain[i + 1].name : chain[i].name;
}

function libFolderChain(sc, id) {
  var chain = libChain(sc, id);
  if (!libAllowed(sc, chain)) throw httpError('NOT_FOUND', 'ไม่พบรายการนี้ หรือไม่มีสิทธิ์เข้าถึง');
  return chain;
}

/** Returns {file, chain of its parent folder}. */
function libFile(sc, id) {
  var file = null, chain = null;
  try {
    file = DriveApp.getFileById(id);
    if (file.isTrashed()) file = null;
  } catch (x) { file = null; }
  if (file) {
    var ps = file.getParents();
    if (ps.hasNext()) chain = libChain(sc, ps.next().getId());
  }
  if (!file || !libAllowed(sc, chain)) throw httpError('NOT_FOUND', 'ไม่พบรายการนี้ หรือไม่มีสิทธิ์เข้าถึง');
  return { file: file, chain: chain };
}

/** System folders: root always; for ordinary users also month and e-mail folders (chain length <= 3). */
function libProtected(sc, chain) { return chain.length === 1 || (!sc.admin && chain.length <= 3); }

function libTarget(sc, b) {
  var id = libId(b.id);
  if (b.kind === 'folder') {
    var chain = libFolderChain(sc, id);
    return { kind: 'folder', id: id, chain: chain, item: DriveApp.getFolderById(id), prot: libProtected(sc, chain), parentId: chain.length > 1 ? chain[1].id : null };
  }
  if (b.kind === 'file') {
    var x = libFile(sc, id);
    return { kind: 'file', id: id, chain: x.chain, item: x.file, prot: false, parentId: x.chain[0].id };
  }
  throw httpError('BAD_REQUEST', 'ชนิดรายการไม่ถูกต้อง');
}

/* -------------------------------- text rules ------------------------------- */

function libName(v) {
  var s = String(v == null ? '' : v).replace(/[\\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  if (!s) throw httpError('BAD_REQUEST', 'กรุณาระบุชื่อ');
  return s.slice(0, LIB_NAME_MAX);
}
function libNoteText(v) { return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').slice(0, LIB_NOTE_MAX); }
function libIso(d) { return d instanceof Date ? d.toISOString() : ''; }

/* --------------------------------- entries --------------------------------- */

function libEntryFolder(f, name) {
  var d = libParseDesc(f.getDescription());
  return { id: f.getId(), kind: 'folder', name: name || f.getName(), updated: libIso(f.getLastUpdated()), note: d.note, tags: d.tags };
}
function libEntryFile(f) {
  var d = libParseDesc(f.getDescription());
  return { id: f.getId(), kind: 'file', name: f.getName(), mime: f.getMimeType(), size: f.getSize(), updated: libIso(f.getLastUpdated()), url: f.getUrl(), note: d.note, tags: d.tags };
}
function libEntryOf(t) { return t.kind === 'folder' ? libEntryFolder(t.item) : libEntryFile(t.item); }

/* ------------------------------ notes and tags ----------------------------- */

var LIB_TAG_LINE = /(?:^|\n)แท็ก: ([^\n]*)$/;
function libParseDesc(desc) {
  var d = String(desc || ''), m = LIB_TAG_LINE.exec(d), tags = [];
  if (m) { tags = libTags(m[1]); d = d.slice(0, m.index); }
  return { note: d.replace(/\s+$/, ''), tags: tags };
}
function libBuildDesc(note, tags) {
  var s = libNoteText(note).replace(LIB_TAG_LINE, '').replace(/\s+$/, '');
  return tags.length ? (s ? s + '\n' : '') + 'แท็ก: ' + tags.join(', ') : s;
}
/** Accepts an array or a comma-separated string. Trims, drops #, removes duplicates (case-insensitive), max 10 × 24 chars. */
function libTags(v) {
  var arr = Array.isArray(v) ? v : String(v == null ? '' : v).split(','), out = [], seen = Object.create(null);
  for (var i = 0; i < arr.length && out.length < LIB_TAG_MAX; i++) {
    var t = String(arr[i] == null ? '' : arr[i]).replace(/[,\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^#+/, '').trim().slice(0, 24);
    var k = t.toLowerCase();
    if (t && !seen[k]) { seen[k] = true; out.push(t); }
  }
  return out;
}

/** Breadcrumb: admins see root → … → here; ordinary users see their month folder → … → here. */
function libPath(sc, chain) {
  var rev = chain.slice().reverse(), out = [];
  var start = sc.admin ? 0 : 2;
  for (var i = start; i < rev.length; i++) {
    var ci = chain.length - 1 - i;
    out.push({ id: rev[i].id, name: libLabel(sc, chain, ci) });
  }
  return out;
}

/* ----------------------------------- list ---------------------------------- */

function libList(sc, b) {
  var id = b.folderId ? libId(b.folderId) : '';
  if (!id && !sc.admin) return libHome(sc);
  if (!id) id = sc.rootId;
  var chain = libFolderChain(sc, id);
  var folder = DriveApp.getFolderById(id);
  var items = [], truncated = false, n = 0, it = folder.getFolders();
  while (it.hasNext()) { if (n++ >= LIB_LIST_MAX) { truncated = true; break; } items.push(libEntryFolder(it.next())); }
  n = 0; it = folder.getFiles();
  while (it.hasNext()) { if (n++ >= LIB_LIST_MAX) { truncated = true; break; } items.push(libEntryFile(it.next())); }
  return {
    admin: sc.admin, home: false, cwd: { id: id, name: libLabel(sc, chain, 0) }, path: libPath(sc, chain),
    items: items, truncated: truncated, canWrite: chain.length < LIB_MAX_DEPTH, canTrash: libCanTrash(sc)
  };
}

/** Ordinary users start at "my space": one entry per month in which they have a folder. */
function libHome(sc) {
  var months = [], it = DriveApp.getFolderById(sc.rootId).getFolders();
  while (it.hasNext() && months.length < 120) months.push(it.next());
  months.sort(function (a, c) { return a.getName() < c.getName() ? 1 : -1; });
  var items = [];
  months.forEach(function (m) {
    var s = m.getFoldersByName(sc.email);
    if (!s.hasNext()) return;
    var f = s.next(), e = libEntryFolder(f, m.getName());
    e.locked = true;
    items.push(e);
  });
  return { admin: false, home: true, cwd: null, path: [], items: items, truncated: false, canWrite: false, canTrash: libCanTrash(sc) };
}

function libCanTrash(sc) { return sc.admin || prop('LIBRARY_USER_DELETE') !== 'false'; }

/* ---------------------------------- recent --------------------------------- */

/** Newest archived files (from the Files tab), re-checked against Drive so renames, moves and deletes are honoured. */
function libRecent(sc, b) {
  var limit = Math.min(Math.max(parseInt(b.limit, 10) || 30, 1), 50);
  var fs = sheetTab('Files', FILE_HEADERS), last = fs.getLastRow();
  if (last < 2) return { admin: sc.admin, items: [] };
  var from = Math.max(2, last - LIB_RECENT_ROWS + 1);
  var vals = fs.getRange(from, 1, last - from + 1, 8).getValues();
  var seen = Object.create(null), items = [];
  for (var i = vals.length - 1; i >= 0 && items.length < limit; i--) {
    var r = vals[i];
    if (!sc.admin && String(r[2]).toLowerCase() !== sc.email) continue;
    var m = /\/d\/([-\w]{10,})/.exec(String(r[7]));
    if (!m || seen[m[1]]) continue;
    seen[m[1]] = true;
    var x;
    try { x = libFile(sc, m[1]); } catch (e) { continue; } // trashed, deleted or moved out of scope
    var e2 = libEntryFile(x.file);
    e2.tool = String(r[3]); e2.role = String(r[4]); e2.logId = String(r[1]);
    e2.folderId = x.chain[0].id; e2.folderName = libLabel(sc, x.chain, 0);
    if (sc.admin) e2.email = String(r[2]);
    items.push(e2);
  }
  items.sort(function (a, c) { return a.updated < c.updated ? 1 : -1; });
  return { admin: sc.admin, items: items, canTrash: libCanTrash(sc) };
}

/* --------------------------------- changes --------------------------------- */

function libLog(u, op, name, extra) {
  try {
    sheetTab('Logs', LOG_HEADERS).appendRow([new Date(), Utilities.getUuid().slice(0, 8), u.email, 'library', op, 'ok', cell(name, 200), 0, 0, cell(JSON.stringify(extra || {}), 500)]);
  } catch (x) { console.error('libLog ' + x); }
}

function libMkdir(sc, u, b) {
  var pid = b.parentId ? libId(b.parentId) : (sc.admin ? sc.rootId : '');
  if (!pid) throw httpError('BAD_REQUEST', 'เลือกโฟลเดอร์ก่อนสร้างโฟลเดอร์ใหม่');
  var chain = libFolderChain(sc, pid);
  if (chain.length >= LIB_MAX_DEPTH) throw httpError('TOO_DEEP', 'ซ้อนโฟลเดอร์ลึกเกินไป');
  var name = libName(b.name), parent = DriveApp.getFolderById(pid);
  if (parent.getFoldersByName(name).hasNext()) throw httpError('DUPLICATE', 'มีโฟลเดอร์ชื่อนี้อยู่แล้ว');
  var f = parent.createFolder(name), entry = libEntryFolder(f);
  idxUpsert(idxRow(entry, libOwnerNew(chain, name), pid));
  libLog(u, 'mkdir', name, { id: f.getId(), parent: pid });
  return entry;
}

function libRename(sc, u, b) {
  var t = libTarget(sc, b);
  if (t.prot) throw httpError('FORBIDDEN', 'โฟลเดอร์ระบบ ไม่สามารถเปลี่ยนชื่อได้');
  var name = libName(b.name), old = t.item.getName();
  if (name === old) return { id: t.id, name: name };
  if (t.kind === 'folder' && t.parentId && DriveApp.getFolderById(t.parentId).getFoldersByName(name).hasNext()) throw httpError('DUPLICATE', 'มีโฟลเดอร์ชื่อนี้อยู่แล้ว');
  t.item.setName(name);
  idxUpsert(idxRow(libEntryOf(t), libOwner(t.chain), t.parentId));
  libLog(u, 'rename', name, { id: t.id, kind: t.kind, from: old });
  return { id: t.id, name: name };
}

function libMove(sc, u, b) {
  var t = libTarget(sc, b);
  if (t.prot) throw httpError('FORBIDDEN', 'โฟลเดอร์ระบบ ไม่สามารถย้ายได้');
  var destId = libId(b.destId), dest = libFolderChain(sc, destId);
  if (dest.length >= LIB_MAX_DEPTH) throw httpError('TOO_DEEP', 'ซ้อนโฟลเดอร์ลึกเกินไป');
  if (t.kind === 'folder') {
    for (var i = 0; i < dest.length; i++) if (dest[i].id === t.id) throw httpError('BAD_REQUEST', 'ย้ายโฟลเดอร์เข้าไปในตัวเองไม่ได้');
  }
  if (destId === t.parentId) return { id: t.id, moved: false };
  var target = DriveApp.getFolderById(destId), name = t.item.getName();
  if (t.kind === 'folder' && target.getFoldersByName(name).hasNext()) throw httpError('DUPLICATE', 'ปลายทางมีโฟลเดอร์ชื่อเดียวกันอยู่แล้ว');
  t.item.moveTo(target);
  idxUpsert(idxRow(libEntryOf(t), t.kind === 'folder' ? libOwnerNew(dest, name) : libOwner(dest), destId));
  libLog(u, 'move', name, { id: t.id, kind: t.kind, from: t.parentId, to: destId });
  return { id: t.id, moved: true };
}

function libNote(sc, u, b) {
  var t = libTarget(sc, b);
  if (t.chain.length === 1 && t.kind === 'folder') throw httpError('FORBIDDEN', 'โฟลเดอร์ระบบ ไม่สามารถแก้ไขได้');
  var cur = libParseDesc(t.item.getDescription());
  var note = b.note === undefined ? cur.note : libNoteText(b.note);
  var tags = b.tags === undefined ? cur.tags : libTags(b.tags);
  t.item.setDescription(libBuildDesc(note, tags));
  idxUpsert(idxRow(libEntryOf(t), libOwner(t.chain), t.parentId));
  libLog(u, 'note', t.item.getName(), { id: t.id, kind: t.kind, tags: tags.length });
  return { id: t.id, tags: tags };
}

function libTrash(sc, u, b) {
  if (!libCanTrash(sc)) throw httpError('FORBIDDEN', 'หน่วยงานจำกัดการลบไว้เฉพาะผู้ดูแลระบบ');
  var t = libTarget(sc, b);
  if (t.prot) throw httpError('FORBIDDEN', 'โฟลเดอร์ระบบ ไม่สามารถลบได้');
  var name = t.item.getName();
  t.item.setTrashed(true);
  idxRemove(t.id);
  libLog(u, 'trash', name, { id: t.id, kind: t.kind });
  return { id: t.id };
}

/* ------------------------------ search index ------------------------------- */
// Sheet tab "Index" = one row per file/folder: id, kind, name, owner (e-mail folder), tags, note, mime, size, updated(ms), parent.
// It only generates candidates; every hit is re-verified against Drive (exists, not trashed, still in scope) before it is returned,
// so a stale row can never expose anything.

function idxSheet(name) { return sheetTab(name || 'Index', IDX_HEADERS); }
function idxText(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').slice(0, max); }
function idxRow(e, owner, parent) {
  return [e.id, e.kind, idxText(e.name, 200), String(owner || ''), idxText((e.tags || []).join(', '), 250), idxText(e.note, 200), e.mime || '',
    Number(e.size) || 0, new Date(e.updated).getTime() || 0, String(parent || '')];
}
/** Text-format the target cells first so Sheets never turns "2026-10" into a date or "1e5" into a number. */
function idxPut(sh, row, rows) {
  var rg = sh.getRange(row, 1, rows.length, IDX_COLS);
  rg.setNumberFormat('@'); rg.setValues(rows);
}
function idxLocked(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(8000);
  try { return fn(); } finally { lock.releaseLock(); }
}
function idxFind(sh, id) {
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === id) return i + 2;
  return 0;
}
function idxUpsert(row) {
  try {
    idxLocked(function () {
      var sh = idxSheet(), at = idxFind(sh, row[0]);
      idxPut(sh, at || sh.getLastRow() + 1, [row]);
    });
  } catch (x) { console.error('idxUpsert ' + x); }
}
function idxRemove(id) {
  try { idxLocked(function () { var sh = idxSheet(), at = idxFind(sh, id); if (at) sh.deleteRow(at); }); } catch (x) { console.error('idxRemove ' + x); }
}
/** Called by archive() for each newly archived file. */
function libIndexFile(file, email) {
  try {
    var ps = file.getParents();
    idxUpsert(idxRow(libEntryFile(file), String(email || '').toLowerCase(), ps.hasNext() ? ps.next().getId() : ''));
  } catch (x) { console.error('libIndexFile ' + x); }
}

/** Fresh data + readable path for one candidate, or null when it is gone / trashed / out of scope. */
function libVerify(sc, id, kind) {
  try {
    var e, parentChain;
    if (kind === 'folder') {
      var chain = libFolderChain(sc, id);
      if (chain.length < 2) return null;
      e = libEntryFolder(DriveApp.getFolderById(id), libLabel(sc, chain, 0));
      parentChain = chain.slice(1);
    } else {
      var x = libFile(sc, id);
      e = libEntryFile(x.file); parentChain = x.chain;
    }
    var names = libPath(sc, parentChain).map(function (p) { return p.name; });
    if (sc.admin) names.shift();
    e.folderId = parentChain[0].id; e.folderName = libLabel(sc, parentChain, 0); e.path = names.join(' / ');
    return e;
  } catch (x2) { return null; }
}

function libSearch(sc, b) {
  var q = String(b.q == null ? '' : b.q).toLowerCase().trim().slice(0, 80), terms = q ? q.split(/\s+/) : [];
  var tag = (libTags([b.tag])[0] || '').toLowerCase();
  var offset = Math.max(parseInt(b.offset, 10) || 0, 0), limit = Math.min(Math.max(parseInt(b.limit, 10) || 20, 1), 40);
  var sh = idxSheet(), last = sh.getLastRow(), builtAt = prop('IDX_BUILT_AT');
  if (last < 2) return { admin: sc.admin, items: [], next: null, total: 0, tags: [], indexed: 0, builtAt: builtAt };
  var vals = sh.getRange(2, 1, last - 1, IDX_COLS).getValues(), scoped = [], tagN = Object.create(null);
  vals.forEach(function (r) {
    if (!r[0]) return;
    if (!sc.admin && String(r[3]).toLowerCase() !== sc.email) return;
    scoped.push(r);
    if (offset === 0 && r[4]) String(r[4]).split(',').forEach(function (t) {
      t = t.trim(); if (!t) return;
      var k = t.toLowerCase(); (tagN[k] = tagN[k] || { name: t, n: 0 }).n++;
    });
  });
  var hits = scoped.filter(function (r) {
    if (tag && String(r[4]).toLowerCase().split(',').map(function (t) { return t.trim(); }).indexOf(tag) < 0) return false;
    if (!terms.length) return true;
    var hay = (r[2] + ' ' + r[4] + ' ' + r[5]).toLowerCase();
    return terms.every(function (t) { return hay.indexOf(t) >= 0; });
  });
  hits.sort(function (a, c) { return (Number(c[8]) || 0) - (Number(a[8]) || 0); });
  var out = [], tried = 0, j = offset;
  for (; j < hits.length && out.length < limit && tried < 100; j++, tried++) {
    var e = libVerify(sc, String(hits[j][0]), String(hits[j][1]));
    if (e) out.push(e);
  }
  var tags = offset === 0 ? Object.keys(tagN).map(function (k) { return tagN[k]; }).sort(function (a, c) { return c.n - a.n; }).slice(0, 40) : undefined;
  return { admin: sc.admin, items: out, next: j < hits.length ? j : null, total: hits.length, tags: tags, indexed: scoped.length, builtAt: builtAt };
}

/**
 * Walk the whole archive and rebuild the index into the tab "IndexNew", then swap it into "Index".
 * Resumable: the folders still to visit are kept in the tab "IndexQueue", so a library too big for one run just continues
 * on the next run. force=false (the hourly trigger) only starts a new build when the last one is older than 20 hours.
 * @returns {{done:boolean, indexed:number, remaining:number, skipped?:boolean}}
 */
function libReindex(budgetMs, force) {
  var P = PropertiesService.getScriptProperties(), t0 = Date.now(), running = Number(prop('IDX_RUNNING')) || 0;
  if (running && t0 - running < 6 * 60 * 1000) throw httpError('BUSY', 'กำลังสร้างดัชนีอยู่ กรุณารอสักครู่แล้วลองใหม่');
  var rootId = prop('DRIVE_FOLDER_ID');
  if (!rootId) throw httpError('NOT_CONFIGURED', 'ยังไม่ได้ตั้งค่า DRIVE_FOLDER_ID');
  var qs = sheetTab('IndexQueue', IDXQ_HEADERS), nw = idxSheet('IndexNew'), qLast = qs.getLastRow(), queue = [];
  if (qLast > 1) {
    queue = qs.getRange(2, 1, qLast - 1, 3).getValues().map(function (r) { return { id: String(r[0]), level: Number(r[1]) || 0, owner: String(r[2] || '') }; });
  } else {
    var built = Date.parse(prop('IDX_BUILT_AT')) || 0;
    if (!force && t0 - built < 20 * 3600 * 1000) return { done: true, indexed: 0, remaining: 0, skipped: true };
    var nl = nw.getLastRow(); if (nl > 1) nw.getRange(2, 1, nl - 1, IDX_COLS).clearContent();
    queue = [{ id: rootId, level: 0, owner: '' }];
  }
  P.setProperty('IDX_RUNNING', String(t0));
  var buf = [], count = 0;
  function flush() {
    if (!buf.length) return;
    idxPut(nw, nw.getLastRow() + 1, buf); count += buf.length; buf = [];
  }
  try {
    while (queue.length && Date.now() - t0 < budgetMs) {
      var cur = queue.shift(), folder;
      try { folder = DriveApp.getFolderById(cur.id); if (folder.isTrashed()) continue; } catch (x) { continue; }
      var it = folder.getFolders();
      while (it.hasNext()) {
        var f = it.next(), lvl = cur.level + 1, own = lvl === 2 ? f.getName().toLowerCase() : cur.owner;
        queue.push({ id: f.getId(), level: lvl, owner: own });
        buf.push(idxRow(libEntryFolder(f), own, cur.id));
      }
      var fi = folder.getFiles();
      while (fi.hasNext()) buf.push(idxRow(libEntryFile(fi.next()), cur.level >= 2 ? cur.owner : '', cur.id));
      if (buf.length >= 400) flush();
    }
    flush();
    var ql = qs.getLastRow(); if (ql > 1) qs.getRange(2, 1, ql - 1, 3).clearContent();
    if (queue.length) {
      var qr = qs.getRange(2, 1, queue.length, 3); qr.setNumberFormat('@');
      qr.setValues(queue.map(function (x) { return [x.id, x.level, x.owner]; }));
    } else {
      var n2 = nw.getLastRow();
      idxLocked(function () {
        var idx = idxSheet(), il = idx.getLastRow();
        if (il > 1) idx.getRange(2, 1, il - 1, IDX_COLS).clearContent();
        if (n2 > 1) { var vals = nw.getRange(2, 1, n2 - 1, IDX_COLS).getValues(); idxPut(idx, 2, vals); }
      });
      if (n2 > 1) nw.getRange(2, 1, n2 - 1, IDX_COLS).clearContent();
      P.setProperty('IDX_BUILT_AT', new Date().toISOString());
    }
  } finally { P.deleteProperty('IDX_RUNNING'); }
  return { done: !queue.length, indexed: count, remaining: queue.length };
}

/** Time-driven trigger target (hourly): resumes an unfinished build, or rebuilds when the index is older than 20 h. */
function libReindexJob() {
  try { console.log(JSON.stringify(libReindex(270000, false))); } catch (x) { console.error('libReindexJob ' + x); }
}

/** Run ONCE from the editor: creates the Index tab, installs the hourly trigger and builds the first index. */
function setupSearchIndex() {
  idxSheet();
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'libReindexJob') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('libReindexJob').timeBased().everyHours(1).create();
  console.log(JSON.stringify(libReindex(270000, true)) + ' — ถ้า done=false ให้รันซ้ำอีกครั้ง หรือรอให้ทริกเกอร์ทำต่อ');
}

/* ------------------------ link archived files to Logs ----------------------- */

/** Called by archive(): puts the Drive link in the Logs row (col K = input file, col L = output file). */
function linkToLog(logId, role, url) {
  try {
    if (!logId) return;
    var sh = sheetTab('Logs', LOG_HEADERS), last = sh.getLastRow();
    if (last < 2) return;
    var from = Math.max(2, last - 499);
    var ids = sh.getRange(from, 2, last - from + 1, 1).getValues();
    for (var i = ids.length - 1; i >= 0; i--) {
      if (String(ids[i][0]) !== String(logId)) continue;
      var rg = sh.getRange(from + i, role === 'output' ? 12 : 11), cur = String(rg.getValue() || '');
      rg.setValue(cur ? cur + '\n' + url : url);
      return;
    }
  } catch (x) { console.error('linkToLog ' + x); }
}
