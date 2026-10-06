import { h, formatBytes, svgIcon, debounce, field } from '../core/dom.js';
import { ICONS } from '../core/icons.js';
import { getSession, signOut } from '../core/auth.js';
import { gasCall } from '../core/api.js';
import { notice } from '../core/notices.js';
import { toast } from '../core/toast.js';
import { TOOLS } from '../core/routes.js';
import { addLayer, modal, askText, confirmBox, closeAllLayers } from '../core/layers.js';
import { copyText } from '../core/download.js';

/* ------------------------------ small helpers ------------------------------ */

const I = {
  move: '<path d="M3 12h14M13 6l6 6-6 6"/>',
  out: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  home: ICONS.home
};
const TOOL_NAME = { qr: 'QR Code', converter: 'แปลงไฟล์', compress: 'ย่อไฟล์', prompt: 'Prompt', skill: 'skill.md', library: 'คลังข้อมูล' };
TOOLS.forEach((t) => { TOOL_NAME[t.id] = t.title; });
const KIND_LABEL = { pdf: 'PDF', doc: 'เอกสาร Word', sheet: 'ตาราง / Excel', slide: 'สไลด์', image: 'รูปภาพ', text: 'ข้อความ / Markdown', zip: 'ไฟล์บีบอัด', other: 'อื่น ๆ' };
const SUGGEST = ['คู่มือ', 'รายงาน', 'หนังสือราชการ', 'แบบฟอร์ม', 'ข้อมูลสรุป', 'รอตรวจสอบ'];

const ext = (n) => { const m = /\.([A-Za-z0-9]{1,6})$/.exec(n || ''); return m ? m[1].toLowerCase() : ''; };
function kindOf(e) {
  const x = ext(e.name), m = String(e.mime || '').toLowerCase();
  if (x === 'pdf' || m.includes('pdf')) return 'pdf';
  if (['doc', 'docx', 'odt', 'rtf'].includes(x) || m.includes('word') || m.endsWith('google-apps.document')) return 'doc';
  if (['xls', 'xlsx', 'csv', 'ods', 'tsv'].includes(x) || m.includes('spreadsheet') || m.includes('excel') || m.includes('csv')) return 'sheet';
  if (['ppt', 'pptx', 'odp'].includes(x) || m.includes('presentation') || m.includes('powerpoint')) return 'slide';
  if (m.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(x)) return 'image';
  if (['md', 'txt', 'json', 'html', 'xml', 'log'].includes(x) || m.startsWith('text/') || m.includes('json')) return 'text';
  if (['zip', 'rar', '7z', 'gz'].includes(x) || m.includes('zip')) return 'zip';
  return 'other';
}
/** Archived files are saved as "dd-HHmmss_input|output_<name>" — show the clean name and keep the role as a badge. */
function parseName(name) {
  const m = /^\d{2}-\d{6}_(input|output)_(.+)$/s.exec(name || '');
  return m ? { title: m[2], role: m[1] } : { title: name || '', role: '' };
}
const when = (ts) => (ts ? new Date(ts).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '-');
const ago = (ts) => {
  const m = Math.round((Date.now() - new Date(ts).getTime()) / 60000);
  return m < 1 ? 'เมื่อสักครู่' : m < 60 ? `${m} นาทีที่แล้ว` : m < 1440 ? `${Math.round(m / 60)} ชั่วโมงที่แล้ว` : `${Math.round(m / 1440)} วันที่แล้ว`;
};
const memory = {
  get() { try { return JSON.parse(sessionStorage.getItem('sand:library') || '{}'); } catch { return {}; } },
  set(p) { try { sessionStorage.setItem('sand:library', JSON.stringify({ ...memory.get(), ...p })); } catch { /* ignore */ } }
};

function ensureCss() {
  if (document.getElementById('library-css')) return Promise.resolve();
  return new Promise((resolve) => {
    const l = h('link', { id: 'library-css', rel: 'stylesheet', href: 'css/library.css' });
    l.addEventListener('load', () => resolve(), { once: true });
    l.addEventListener('error', () => resolve(), { once: true });
    document.head.append(l);
    setTimeout(resolve, 1500);
  });
}

/** Call the backend "library" action. A dead session signs the user out so the next reload shows the login page. */
async function call(op, params = {}, timeout = 90000) {
  const s = getSession();
  if (!s) { const e = new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่'); e.code = 'INVALID_SESSION'; throw e; }
  try { return (await gasCall('library', { session: s.token, op, ...params }, timeout)).data; }
  catch (e) { if (e && (e.code === 'INVALID_SESSION' || e.code === 'DOMAIN_NOT_ALLOWED')) signOut(); throw e; }
}

/* --------------------------------- the page --------------------------------- */

export async function mount(root) {
  await ensureCss();
  const s = getSession();
  const host = h('div');
  root.append(h('div', { class: 'page' }, h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'คลังข้อมูล'),
    h('p', null, 'ดูไฟล์ล่าสุด และจัดระเบียบโฟลเดอร์ที่เก็บไว้ใน Google Drive ของหน่วยงาน'))), host));
  if (!s) { host.append(notice('warn', 'ต้องเข้าสู่ระบบก่อน', 'คลังข้อมูลแสดงเฉพาะผู้ที่ล็อกอินแล้ว')); return () => {}; }

  const saved = memory.get();
  const st = { view: ['recent', 'search'].includes(saved.view) ? saved.view : 'folders', folderId: typeof saved.folderId === 'string' ? saved.folderId : '', kind: '', tag: '', q: '', search: null, sort: saved.sort || 'new', recent: null, folder: null, admin: false, canTrash: true };
  let seq = 0;

  const tabRecent = h('button', { class: 'tab', type: 'button', role: 'tab', onclick: () => setView('recent') }, 'ล่าสุด');
  const tabFolders = h('button', { class: 'tab', type: 'button', role: 'tab', onclick: () => setView('folders') }, 'โฟลเดอร์');
  const tabSearch = h('button', { class: 'tab', type: 'button', role: 'tab', onclick: () => setView('search') }, 'ค้นหาทั้งคลัง');
  const tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'มุมมองคลังข้อมูล' }, tabRecent, tabFolders, tabSearch);
  const search = h('input', { type: 'search', 'aria-label': 'ค้นหา' });
  search.addEventListener('input', debounce(() => { st.q = search.value.trim().toLowerCase(); if (st.view === 'search') loadSearch(true); else draw(); }, 300));
  const refresh = h('button', { class: 'btn', type: 'button', onclick: () => reload() }, svgIcon(ICONS.rotate, 18), 'รีเฟรช');
  const crumbs = h('nav', { class: 'lib-crumbs', 'aria-label': 'ตำแหน่งโฟลเดอร์' });
  const sortSel = h('select', { 'aria-label': 'เรียงลำดับ', onchange: () => { st.sort = sortSel.value; memory.set({ sort: st.sort }); draw(); } },
    h('option', { value: 'new' }, 'ใหม่สุดก่อน'), h('option', { value: 'name' }, 'ชื่อ ก–ฮ'), h('option', { value: 'size' }, 'ขนาดใหญ่สุดก่อน'));
  sortSel.value = st.sort;
  const newBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => newFolder() }, svgIcon(ICONS.plus, 18), 'โฟลเดอร์ใหม่');
  const folderBar = h('div', { class: 'lib-folderbar' }, crumbs, h('div', { class: 'spacer' }), newBtn, sortSel);
  const tagRow = h('div', { class: 'chip-row', role: 'group', 'aria-label': 'กรองตามแท็ก' });
  const chips = h('div', { class: 'chip-row', role: 'group', 'aria-label': 'กรองตามประเภทไฟล์' });
  const list = h('div', { class: 'hist-list' });
  const foot = h('p', { class: 'hint' });
  const reindexBtn = h('button', { class: 'btn btn-sm', type: 'button', hidden: true, onclick: () => reindex() }, svgIcon(ICONS.rotate, 16), 'สร้างดัชนีค้นหาใหม่');
  host.append(h('div', { class: 'card hist-card' }, tabs, h('div', { class: 'hist-tools' }, search, refresh), folderBar, tagRow, chips, list, h('div', { class: 'btn-row' }, foot, reindexBtn)));

  const skeleton = () => list.replaceChildren(...[1, 2, 3, 4].map(() => h('div', { class: 'skeleton', style: 'height:56px;margin-bottom:.5rem' })));
  const showError = (e) => {
    const expired = e && e.code === 'INVALID_SESSION';
    list.replaceChildren(...[notice('error', expired ? 'เซสชันหมดอายุ' : 'โหลดข้อมูลไม่ได้', e && e.message),
      expired ? h('button', { class: 'btn btn-primary', type: 'button', onclick: () => location.reload() }, 'เข้าสู่ระบบใหม่') : null].filter(Boolean));
  };

  function setView(v) {
    st.view = v; st.kind = ''; st.tag = ''; memory.set({ view: v });
    search.value = ''; st.q = '';
    if (v === 'recent' && !st.recent) loadRecent(); else if (v === 'folders' && !st.folder) loadFolder(st.folderId); else if (v === 'search') loadSearch(true); else draw();
  }
  function reload() { return st.view === 'recent' ? loadRecent() : st.view === 'search' ? loadSearch(true) : loadFolder(st.folderId); }
  /** After a change every view may be stale. */
  async function changed() { st.recent = null; await reload(); }

  async function loadRecent() {
    const my = ++seq; skeleton(); draw(true);
    try { const d = await call('recent', { limit: 30 }); if (my !== seq) return; st.recent = d.items; st.admin = d.admin; st.canTrash = d.canTrash !== false; draw(); } catch (e) { if (my === seq) showError(e); }
  }
  async function loadFolder(id, retried = false) {
    const my = ++seq; skeleton(); draw(true);
    try {
      const d = await call('list', id ? { folderId: id } : {});
      if (my !== seq) return;
      st.folder = d; st.admin = d.admin; st.canTrash = d.canTrash !== false; st.folderId = d.cwd ? d.cwd.id : ''; memory.set({ folderId: st.folderId });
      draw();
    } catch (e) {
      if (my !== seq) return;
      if (id && !retried && (e.code === 'NOT_FOUND' || e.code === 'BAD_REQUEST')) { st.folderId = ''; memory.set({ folderId: '' }); return loadFolder('', true); }
      showError(e);
    }
  }
  async function loadSearch(reset) {
    const my = ++seq;
    if (reset) { skeleton(); draw(true); }
    try {
      const d = await call('search', { q: search.value.trim(), tag: st.tag, offset: reset ? 0 : st.search.next, limit: 20 });
      if (my !== seq) return;
      if (reset) st.search = { items: d.items, next: d.next, total: d.total, tags: d.tags || (st.search ? st.search.tags : []), indexed: d.indexed, builtAt: d.builtAt };
      else { st.search.items.push(...d.items); st.search.next = d.next; st.search.total = d.total; }
      st.admin = d.admin; draw();
    } catch (e) { if (my === seq) showError(e); }
  }
  async function reindex() {
    if (!(await confirmBox({ title: 'สร้างดัชนีค้นหาใหม่?', message: 'ระบบจะสแกนทุกโฟลเดอร์ในคลังเพื่ออัปเดตดัชนี ใช้เวลาตั้งแต่ไม่กี่วินาทีถึงหลายนาที ขึ้นอยู่กับจำนวนไฟล์', confirm: 'เริ่มสร้าง' }))) return;
    reindexBtn.disabled = true; toast('กำลังสร้างดัชนี… อย่าปิดหน้านี้', 'info', 4000);
    try {
      const r = await call('reindex', {}, 330000);
      toast(r.done ? `สร้างดัชนีเสร็จแล้ว (${r.indexed} รายการ)` : `ยังไม่เสร็จ เหลืออีก ${r.remaining} โฟลเดอร์ — กดอีกครั้งเพื่อทำต่อ`, r.done ? 'success' : 'info', 6000);
      await loadSearch(true);
    } catch (e) { toast(e.message, 'error', 6000); } finally { reindexBtn.disabled = false; }
  }
  function openFolder(id) { st.kind = ''; search.value = ''; st.q = ''; st.view = 'folders'; memory.set({ view: 'folders' }); loadFolder(id); }

  /* ---- drawing ---- */
  function filtered(items) {
    return items.filter((e) => (!st.kind || (e.kind === 'file' && kindOf(e) === st.kind)) && (!st.tag || (e.tags || []).some((t) => t.toLowerCase() === st.tag.toLowerCase())) &&
      (st.view === 'search' || !st.q || `${e.name} ${e.note || ''} ${(e.tags || []).join(' ')} ${e.folderName || ''} ${TOOL_NAME[e.tool] || e.tool || ''} ${e.email || ''}`.toLowerCase().includes(st.q)));
  }
  function sorted(items) {
    const byName = (a, b) => a.name.localeCompare(b.name, 'th');
    const by = { new: (a, b) => (a.updated < b.updated ? 1 : -1), name: byName, size: (a, b) => (Number(b.size) || 0) - (Number(a.size) || 0) }[st.sort] || byName;
    return [...items.filter((e) => e.kind === 'folder').sort(byName), ...items.filter((e) => e.kind === 'file').sort(by)];
  }
  function drawChips(items) {
    const counts = {}; items.forEach((e) => { if (e.kind === 'file') { const k = kindOf(e); counts[k] = (counts[k] || 0) + 1; } });
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    if (!total) { chips.replaceChildren(); return; }
    chips.replaceChildren(...[['', 'ทุกประเภท', total], ...Object.keys(counts).map((k) => [k, KIND_LABEL[k], counts[k]])].map(([k, label, n]) =>
      h('button', { class: 'chip', type: 'button', 'aria-pressed': String(st.kind === k), onclick: () => { st.kind = k; draw(); } }, `${label} `, h('span', null, n))));
  }
  /** Tag filter row. In the search view the list comes from the server (whole library), elsewhere from the items on screen. */
  function tagCounts(items) {
    const m = new Map(); items.forEach((e) => (e.tags || []).forEach((t) => { const k = t.toLowerCase(); const c = m.get(k) || { name: t, n: 0 }; c.n += 1; m.set(k, c); }));
    return [...m.values()].sort((a, b) => b.n - a.n);
  }
  function knownTags() {
    const all = [...(st.search ? st.search.tags : []), ...tagCounts([...(st.folder ? st.folder.items : []), ...(st.recent || []), ...(st.search ? st.search.items : [])])];
    const seen = new Set(); return all.filter((t) => { const k = t.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).map((t) => t.name);
  }
  function drawTags(list) {
    if (!list.length) { tagRow.replaceChildren(); return; }
    tagRow.replaceChildren(h('span', { class: 'muted lib-tag-label' }, 'แท็ก'), ...list.slice(0, 24).map((t) =>
      h('button', { class: 'chip lib-tagchip', type: 'button', 'aria-pressed': String(st.tag.toLowerCase() === t.name.toLowerCase()), onclick: () => {
        st.tag = st.tag.toLowerCase() === t.name.toLowerCase() ? '' : t.name; if (st.view === 'search') loadSearch(true); else draw(); } }, `#${t.name} `, h('span', null, t.n))));
  }

  function draw(loadingOnly = false) {
    const v = st.view;
    tabRecent.setAttribute('aria-selected', String(v === 'recent')); tabFolders.setAttribute('aria-selected', String(v === 'folders')); tabSearch.setAttribute('aria-selected', String(v === 'search'));
    folderBar.hidden = v !== 'folders'; sortSel.hidden = v !== 'folders';
    reindexBtn.hidden = !(v === 'search' && st.admin);
    search.placeholder = v === 'recent' ? 'ค้นหาชื่อไฟล์ โฟลเดอร์ หรือเครื่องมือ…' : v === 'search' ? 'ค้นหาชื่อไฟล์ แท็ก หรือหมายเหตุ ทั้งคลัง…' : 'ค้นหาในโฟลเดอร์นี้…';
    if (loadingOnly) { if (v === 'folders') drawCrumbs(); return; }
    if (v === 'recent') { drawTags(tagCounts(st.recent || [])); drawChips(st.recent || []); drawRecent(); foot.textContent = 'แสดงไฟล์ที่ระบบเก็บสำเนาไว้ล่าสุด 30 รายการ (เรียงตามเวลาแก้ไขล่าสุด) — ไฟล์ที่นำมาวางเองใน Drive ให้ดูในมุมมอง "โฟลเดอร์" หรือ "ค้นหาทั้งคลัง"'; return; }
    if (v === 'search') {
      const s = st.search; if (!s) return;
      drawTags(s.tags || []); drawChips(s.items); drawSearch();
      foot.textContent = `ดัชนี ${s.indexed || 0} รายการ · อัปเดตล่าสุด ${s.builtAt ? when(s.builtAt) : 'ยังไม่เคยสร้างทั้งระบบ'} · ไฟล์ที่นำมาวางเองใน Drive จะค้นเจอหลังระบบสร้างดัชนีรอบถัดไป`;
      return;
    }
    drawCrumbs(); drawTags(tagCounts(st.folder.items)); drawChips(st.folder.items); drawFolder();
    foot.textContent = st.folder.truncated ? 'โฟลเดอร์นี้มีรายการมาก แสดงเพียงส่วนแรก — แบ่งไฟล์ออกเป็นโฟลเดอร์ย่อยเพื่อให้ค้นหาง่ายขึ้น' : (st.folder.canTrash ? 'การลบ = ย้ายไปถังขยะของ Drive (กู้คืนได้ภายใน 30 วัน)' : 'การลบไฟล์จำกัดไว้เฉพาะผู้ดูแลระบบ');
  }

  function drawCrumbs() {
    const d = st.folder; if (!d) { crumbs.replaceChildren(); return; }
    const parts = [];
    const crumb = (label, id, last, icon) => last ? h('span', { class: 'lib-crumb lib-crumb-now', 'aria-current': 'page' }, icon ? svgIcon(icon, 16) : null, label)
      : h('button', { class: 'lib-crumb', type: 'button', onclick: () => openFolder(id) }, icon ? svgIcon(icon, 16) : null, label);
    if (!d.admin) parts.push(crumb('คลังของฉัน', '', d.home, I.home));
    d.path.forEach((p, i) => parts.push(crumb(d.admin && i === 0 ? 'คลังทั้งหมด' : p.name, p.id, i === d.path.length - 1, d.admin && i === 0 ? I.home : null)));
    crumbs.replaceChildren(...parts.flatMap((p, i) => (i ? [h('span', { class: 'lib-sep', 'aria-hidden': 'true' }, '/'), p] : [p])));
    newBtn.disabled = !d.canWrite; newBtn.title = d.canWrite ? '' : 'เปิดโฟลเดอร์เดือนก่อน จึงจะสร้างโฟลเดอร์ใหม่ได้';
  }

  function empty(text) { return h('div', { class: 'empty' }, svgIcon(ICONS.find, 28), h('p', null, text)); }

  function drawFolder() {
    const all = st.folder.items;
    const shown = sorted(filtered(all));
    if (!shown.length) { list.replaceChildren(empty(all.length ? 'ไม่พบรายการที่ตรงกับคำค้น' : st.folder.home ? 'ยังไม่มีไฟล์ในคลังของคุณ — เมื่อใช้เครื่องมือที่ล็อกอินไว้ ระบบจะเก็บสำเนาไว้ที่นี่' : 'โฟลเดอร์นี้ว่าง — สร้างโฟลเดอร์ใหม่ หรือย้ายไฟล์เข้ามาได้')); return; }
    list.replaceChildren(...shown.map((e) => row(e, { showWhere: false })));
  }
  function drawRecent() {
    const shown = filtered(st.recent || []);
    if (!shown.length) { list.replaceChildren(empty((st.recent || []).length ? 'ไม่พบรายการที่ตรงกับคำค้น' : 'ยังไม่มีไฟล์ — ลองใช้เครื่องมือสักอย่าง แล้วกลับมาดูที่นี่')); return; }
    list.replaceChildren(...shown.map((e) => row(e, { showWhere: true })));
  }

  function drawSearch() {
    const s = st.search; const shown = filtered(s.items);
    if (!shown.length) {
      list.replaceChildren(empty(!s.indexed ? 'ดัชนีค้นหายังว่าง — ผู้ดูแลระบบต้องรัน setupSearchIndex() ใน Apps Script หรือกด "สร้างดัชนีค้นหาใหม่"'
        : (search.value.trim() || st.tag) ? 'ไม่พบรายการที่ตรงกับคำค้นหรือแท็กนี้' : 'ยังไม่มีรายการในดัชนี'));
      return;
    }
    list.replaceChildren(...[...shown.map((e) => row(e, { showWhere: true })),
      s.next != null ? h('button', { class: 'btn lib-more', type: 'button', onclick: () => loadSearch(false) }, `แสดงเพิ่ม (พบทั้งหมด ${s.total} รายการ)`) : null].filter(Boolean));
  }

  function row(e, { showWhere }) {
    const isFolder = e.kind === 'folder';
    const p = parseName(e.name);
    const kind = isFolder ? 'folder' : kindOf(e);
    const tl = TOOLS.find((t) => t.id === e.tool);
    const meta = isFolder
      ? [showWhere && e.path ? `ใน ${e.path}` : '', e.updated ? `แก้ไข ${ago(e.updated)}` : '', e.note].filter(Boolean).join(' · ')
      : [KIND_LABEL[kind], formatBytes(Number(e.size) || 0), `แก้ไข ${ago(e.updated)}`, showWhere && (e.path || e.folderName) ? `ใน ${e.path || e.folderName}` : '', showWhere && st.admin && e.email ? e.email : '', !showWhere && e.note ? e.note : ''].filter(Boolean).join(' · ');
    const main = h('button', { class: 'lib-main', type: 'button', onclick: () => (isFolder ? openFolder(e.id) : openDrawer(e)) },
      h('span', { class: `hist-ico${isFolder ? ' lib-ico-folder' : ''}` }, svgIcon(isFolder ? ICONS.folder : ICONS.file, 20)),
      h('span', { class: 'hist-main' }, h('b', { title: e.name }, p.title), h('small', { class: 'muted' }, meta)));
    return h('div', { class: 'lib-row' }, main,
      ...(e.tags || []).slice(0, 3).map((t) => h('button', { class: 'pill lib-tag', type: 'button', title: `กรองด้วยแท็ก ${t}`, onclick: () => { st.tag = t; if (st.view === 'search') loadSearch(true); else draw(); } }, `#${t}`)),
      p.role ? h('span', { class: 'pill' }, p.role === 'output' ? 'ผลลัพธ์' : 'ต้นฉบับ') : null,
      tl && showWhere ? h('span', { class: 'pill lib-pill-tool' }, svgIcon(tl.icon, 14), tl.title) : null,
      isFolder ? null : h('a', { class: 'icon-btn lib-act', href: e.url, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `เปิด ${p.title} ใน Drive`, title: 'เปิดใน Drive' }, svgIcon(I.out, 18)),
      e.locked ? null : h('button', { class: 'icon-btn lib-act', type: 'button', 'aria-label': `จัดการ ${p.title}`, title: 'จัดการ', onclick: () => openDrawer(e) }, svgIcon(ICONS.edit, 18)));
  }

  /* ---- actions ---- */
  async function newFolder() {
    const parent = st.folder && st.folder.cwd ? st.folder.cwd.id : '';
    const name = await askText({ title: 'สร้างโฟลเดอร์ใหม่', label: 'ชื่อโฟลเดอร์', confirm: 'สร้าง', hint: 'ใช้แยกประเภทข้อมูล เช่น คู่มือ รายงาน หนังสือราชการ', suggestions: SUGGEST });
    if (!name) return;
    try { await call('mkdir', { parentId: parent, name }); toast('สร้างโฟลเดอร์แล้ว', 'success'); await changed(); } catch (e) { toast(e.message, 'error', 5000); }
  }

  /** Folder picker used by "ย้ายไป…". Resolves with a folder id or null. */
  function pickFolder({ startId, excludeId, title }) {
    return new Promise((resolve) => {
      let cur = startId || '', data = null, done = false;
      const crumbsEl = h('div', { class: 'lib-crumbs' });
      const listEl = h('div', { class: 'lib-pick-list' });
      const okBtn = h('button', { class: 'btn btn-primary', type: 'button', disabled: true }, 'ย้ายมาที่นี่');
      const mk = h('button', { class: 'btn', type: 'button', onclick: async () => {
        if (!data || !data.cwd) return;
        const name = await askText({ title: 'สร้างโฟลเดอร์ใหม่ที่นี่', label: 'ชื่อโฟลเดอร์', confirm: 'สร้าง', suggestions: SUGGEST });
        if (!name) return;
        try { await call('mkdir', { parentId: data.cwd.id, name }); await go(data.cwd.id); } catch (e) { toast(e.message, 'error', 5000); }
      } }, svgIcon(ICONS.plus, 16), 'โฟลเดอร์ใหม่');
      let m = null;
      const finish = (v) => { if (done) return; done = true; resolve(v); if (m) m.close(); };
      okBtn.addEventListener('click', () => { if (data && data.cwd) finish(data.cwd.id); });
      m = modal(title, [crumbsEl, listEl], [okBtn, mk, h('button', { class: 'btn', type: 'button', onclick: () => finish(null) }, 'ยกเลิก')], { wide: true, onDismiss: () => finish(null), onClose: () => finish(null) });
      async function go(id) {
        listEl.replaceChildren(h('div', { class: 'skeleton', style: 'height:40px' }));
        try { data = await call('list', id ? { folderId: id } : {}); } catch (e) {
          if (id) return go('');
          listEl.replaceChildren(notice('error', 'โหลดโฟลเดอร์ไม่ได้', e.message)); return;
        }
        cur = data.cwd ? data.cwd.id : '';
        const parts = [];
        if (!data.admin) parts.push(h('button', { class: 'lib-crumb', type: 'button', onclick: () => go('') }, 'คลังของฉัน'));
        data.path.forEach((pt, i) => parts.push(i === data.path.length - 1 && data.cwd ? h('span', { class: 'lib-crumb lib-crumb-now' }, data.admin && i === 0 ? 'คลังทั้งหมด' : pt.name) : h('button', { class: 'lib-crumb', type: 'button', onclick: () => go(pt.id) }, data.admin && i === 0 ? 'คลังทั้งหมด' : pt.name)));
        crumbsEl.replaceChildren(...parts.flatMap((x, i) => (i ? [h('span', { class: 'lib-sep' }, '/'), x] : [x])));
        const subs = data.items.filter((x) => x.kind === 'folder' && x.id !== excludeId);
        listEl.replaceChildren(...(subs.length ? subs.map((x) => h('button', { class: 'lib-pick-row', type: 'button', onclick: () => go(x.id) }, svgIcon(ICONS.folder, 18), x.name))
          : [h('p', { class: 'muted lib-pick-empty' }, data.home ? 'ไม่มีโฟลเดอร์' : 'ไม่มีโฟลเดอร์ย่อย — กด "ย้ายมาที่นี่" หรือสร้างโฟลเดอร์ใหม่')]));
        okBtn.disabled = !data.cwd || data.cwd.id === excludeId; mk.disabled = !data.cwd || !data.canWrite;
      }
      go(cur);
    });
  }

  let closeDrawer = null;
  function openDrawer(e) {
    if (closeDrawer) closeDrawer();
    const isFolder = e.kind === 'folder';
    const p = parseName(e.name);
    const nameIn = h('input', { type: 'text', maxlength: 120, value: e.name, autocomplete: 'off' });
    const noteIn = h('textarea', { rows: 4, maxlength: 500, placeholder: 'เช่น ใช้ประกอบรายงานประจำเดือน / รอตรวจสอบ' }); noteIn.value = e.note || '';
    const kind = isFolder ? 'folder' : 'file';
    const tl = TOOLS.find((t) => t.id === e.tool);
    let tags = [...(e.tags || [])];
    const tagBox = h('div', { class: 'lib-tagbox' }); const sugg = h('div', { class: 'chip-row' });
    const tagIn = h('input', { type: 'text', maxlength: 24, placeholder: 'พิมพ์แท็ก แล้วกด Enter', autocomplete: 'off', 'aria-label': 'เพิ่มแท็ก' });
    const addTags = (raw) => {
      for (let t of String(raw).split(',')) { t = t.replace(/^#+/, '').replace(/\s+/g, ' ').trim().slice(0, 24); if (t && tags.length < 10 && !tags.some((x) => x.toLowerCase() === t.toLowerCase())) tags.push(t); }
      tagIn.value = ''; drawTagEditor();
    };
    function drawTagEditor() {
      tagBox.replaceChildren(...tags.map((t) => h('span', { class: 'pill lib-tag-edit' }, `#${t}`, h('button', { type: 'button', 'aria-label': `เอาแท็ก ${t} ออก`, onclick: () => { tags = tags.filter((x) => x !== t); drawTagEditor(); } }, '×'))));
      const rest = knownTags().filter((k) => !tags.some((x) => x.toLowerCase() === k.toLowerCase())).slice(0, 8);
      sugg.replaceChildren(...rest.map((k) => h('button', { class: 'chip', type: 'button', onclick: () => addTags(k) }, `+ ${k}`)));
      sugg.hidden = !rest.length || tags.length >= 10;
    }
    tagIn.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ',') { ev.preventDefault(); if (tagIn.value.trim()) addTags(tagIn.value); } else if (ev.key === 'Backspace' && !tagIn.value && tags.length) { tags.pop(); drawTagEditor(); } });
    tagIn.addEventListener('blur', () => { if (tagIn.value.trim()) addTags(tagIn.value); });
    drawTagEditor();
    const saveBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
      const newName = nameIn.value.trim(); const newNote = noteIn.value;
      if (!newName) { nameIn.focus(); return; }
      try {
        if (newName !== e.name) await call('rename', { id: e.id, kind, name: newName });
        if (newNote !== (e.note || '') || JSON.stringify(tags) !== JSON.stringify(e.tags || [])) await call('note', { id: e.id, kind, note: newNote, tags });
        toast('บันทึกแล้ว', 'success'); closeDrawer(); await changed();
      } catch (err) { toast(err.message, 'error', 5000); }
    } }, svgIcon(ICONS.save, 18), 'บันทึก');
    const moveBtn = h('button', { class: 'btn', type: 'button', onclick: async () => {
      const dest = await pickFolder({ startId: e.folderId || st.folderId, excludeId: isFolder ? e.id : '', title: `ย้าย “${p.title}” ไปที่` });
      if (!dest) return;
      try { const r = await call('move', { id: e.id, kind, destId: dest }); toast(r.moved ? 'ย้ายแล้ว' : 'อยู่ในโฟลเดอร์นี้แล้ว', 'success'); if (r.moved) { closeDrawer(); await changed(); } } catch (err) { toast(err.message, 'error', 5000); }
    } }, svgIcon(I.move, 18), 'ย้ายไป…');
    const linkBtn = h('button', { class: 'btn', type: 'button', onclick: async () => {
      linkBtn.disabled = true;
      try {
        const sess = getSession(); const r = (await gasCall('links', { session: sess.token, op: 'create', ref: e.id, refKind: kind, title: p.title }, 60000)).data;
        const full = `${String(r.base || location.origin).replace(/\/+$/, '')}/s/${r.link.code}`; await copyText(full);
        toast(r.existing ? 'มีลิงก์ย่อของรายการนี้อยู่แล้ว คัดลอกให้แล้ว' : 'สร้างลิงก์ย่อแล้ว และคัดลอกไว้ในคลิปบอร์ด — ดูสถิติที่เมนู "ลิงก์ย่อ"', 'success', 5000);
      } catch (err) { toast(err.message, 'error', 5000); } finally { linkBtn.disabled = false; }
    } }, svgIcon(ICONS.copy, 18), 'สร้างลิงก์ย่อ + ติดตามสถิติ');
    const trashBtn = h('button', { class: 'btn btn-danger', type: 'button', onclick: async () => {
      const ok = await confirmBox({ title: isFolder ? 'ลบโฟลเดอร์นี้?' : 'ลบไฟล์นี้?', danger: true, confirm: 'ย้ายไปถังขยะ',
        message: `“${p.title}”${isFolder ? ' และไฟล์ทั้งหมดข้างใน' : ''} จะถูกย้ายไปถังขยะของ Google Drive และกู้คืนได้ภายใน 30 วัน` });
      if (!ok) return;
      try { await call('trash', { id: e.id, kind }); toast('ย้ายไปถังขยะแล้ว', 'success'); closeDrawer(); await changed(); } catch (err) { toast(err.message, 'error', 5000); }
    } }, svgIcon(ICONS.trash, 18), 'ลบ');
    const dl = [['ประเภท', isFolder ? 'โฟลเดอร์' : KIND_LABEL[kindOf(e)]], isFolder ? null : ['ขนาด', formatBytes(Number(e.size) || 0)], ['แก้ไขล่าสุด', `${when(e.updated)} (${ago(e.updated)})`],
      e.folderName ? ['อยู่ใน', e.folderName] : null, tl ? ['สร้างจาก', tl.title] : null, e.email ? ['ผู้ใช้', e.email] : null, p.role ? ['บทบาท', p.role === 'output' ? 'ไฟล์ผลลัพธ์' : 'ไฟล์ต้นฉบับ'] : null].filter(Boolean);
    const aside = h('aside', { class: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'จัดการรายการ' },
      h('div', { class: 'drawer-head' }, h('h2', null, p.title), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'ปิด', onclick: () => closeDrawer() }, svgIcon(I.close))),
      h('dl', { class: 'meta' }, dl.flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)])),
      field('ชื่อ', nameIn, isFolder ? null : 'ถ้าเปลี่ยนชื่อ อย่าลืมนามสกุลไฟล์ เช่น .pdf').root,
      field('แท็ก', h('div', null, tagBox, tagIn, sugg), 'ใช้จัดหมวดหมู่ข้ามโฟลเดอร์ เช่น ด่วน รอลงนาม งบประมาณ (สูงสุด 10 แท็ก)').root,
      field('หมายเหตุ', noteIn, 'บันทึกสั้น ๆ ช่วยให้ค้นหาได้ในภายหลัง (ไม่เกิน 500 ตัวอักษร)').root,
      h('div', { class: 'btn-row' }, saveBtn, isFolder ? null : h('a', { class: 'btn', href: e.url, target: '_blank', rel: 'noopener noreferrer' }, svgIcon(I.out, 18), 'เปิด/แก้ไขใน Drive')),
      h('div', { class: 'btn-row' }, linkBtn), h('p', { class: 'hint' }, 'ลิงก์ย่อจะพาไปที่ไฟล์/โฟลเดอร์นี้ใน Drive — ผู้รับต้องมีสิทธิ์เข้าถึงจึงจะเปิดได้'),
      h('hr', { class: 'lib-hr' }),
      h('div', { class: 'btn-row' }, moveBtn, e.folderId && st.view === 'recent' ? h('button', { class: 'btn', type: 'button', onclick: () => { closeDrawer(); openFolder(e.folderId); } }, svgIcon(ICONS.folder, 18), 'ไปที่โฟลเดอร์') : null,
        st.canTrash !== false ? trashBtn : null));
    const wrap = h('div', { class: 'drawer-wrap lib-drawer-wrap' }, aside);
    closeDrawer = addLayer(wrap, { onClose: () => { closeDrawer = null; } });
  }

  // first paint
  if (st.view === 'recent') loadRecent(); else loadFolder(st.folderId);
  return () => { seq += 1; closeAllLayers(); };
}
