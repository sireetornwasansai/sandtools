import '../core/polyfills.js';
import { h, field, svgIcon, formatBytes, debounce } from '../core/dom.js';
import { ICONS } from '../core/icons.js';
import { downloadBlob, baseName, safeFileName } from '../core/download.js';
import { toast } from '../core/toast.js';
import { privacyNotice } from '../core/notices.js';
import { record, recording, recordingNote } from '../core/logger.js';
import { getPdfjs } from './converters/pdf.js';
import { getJSZip } from './converters/common.js';
import * as E from './pdf/engine.js';

/* ------------------------------- shared helpers ------------------------------- */

const I = {
  up: '<path d="M12 19V5M5 12l7-7 7 7"/>', down: '<path d="M12 5v14M19 12l-7 7-7-7"/>', close: '<path d="M6 6l12 12M18 6L6 18"/>',
  cw: '<path d="M21 12a9 9 0 11-3-6.7L21 8"/><path d="M21 3v5h-5"/>', ccw: '<path d="M3 12a9 9 0 103-6.7L3 8"/><path d="M3 3v5h5"/>',
  left: '<path d="M15 18l-6-6 6-6"/>', right: '<path d="M9 18l6-6-6-6"/>'
};
const isPdf = (f) => /pdf/i.test(f.type) || /\.pdf$/i.test(f.name);
const isImage = (f) => /^image\//i.test(f.type) || /\.(jpe?g|png|webp|bmp|gif|tiff?)$/i.test(f.name);
const stampDay = () => { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; };
const errText = (e) => (e && e.message) || 'เกิดข้อผิดพลาด';
let uid = 0;

function ensureCss() {
  if (document.getElementById('pdf-css')) return Promise.resolve();
  return new Promise((resolve) => {
    const l = h('link', { id: 'pdf-css', rel: 'stylesheet', href: 'css/pdf.css' });
    l.addEventListener('load', () => resolve(), { once: true }); l.addEventListener('error', () => resolve(), { once: true });
    document.head.append(l); setTimeout(resolve, 1500);
  });
}

function dropzone({ title, hint, accept, multiple, filter, onFiles }) {
  const input = h('input', { type: 'file', class: 'sr-only', tabindex: '-1', accept, multiple: !!multiple, 'aria-label': title,
    onchange: () => { const fs = Array.from(input.files || []); input.value = ''; take(fs); } });
  const take = (fs) => {
    const ok = fs.filter(filter); if (fs.length > ok.length) toast(`ข้ามไฟล์ที่ไม่รองรับ ${fs.length - ok.length} ไฟล์`, 'info');
    if (ok.length) onFiles(multiple ? ok : ok.slice(0, 1));
  };
  const zone = h('div', { class: 'dropzone pdf-zone', role: 'button', tabindex: '0', onclick: () => input.click(),
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } },
    ondragover: (e) => { e.preventDefault(); zone.classList.add('over'); }, ondragleave: () => zone.classList.remove('over'),
    ondrop: (e) => { e.preventDefault(); e.stopPropagation(); zone.classList.remove('over'); document.body.classList.remove('dragging'); take(Array.from(e.dataTransfer.files)); } },
    svgIcon(ICONS.upload, 32), h('div', { class: 'big' }, title), h('div', { class: 'muted' }, hint), input);
  return zone;
}

/** Result list: downloads immediately, keeps a row to download again, and logs/archives through record(). */
function results() {
  const el = h('div', { class: 'pdf-results' });
  return {
    el,
    add(blob, name, { op, inputs = [], sizeIn, auto = true }) {
      const dl = () => downloadBlob(blob, name);
      el.prepend(h('div', { class: 'result-row' }, h('b', null, name), h('span', { class: 'muted' }, formatBytes(blob.size)),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: dl }, svgIcon(ICONS.download, 16), 'ดาวน์โหลดอีกครั้ง')));
      if (auto) dl();
      // not awaited: the result is ready immediately; the history/copy is uploaded in the background
      record('pdf', op, { fileName: name, sizeIn: sizeIn ?? inputs.reduce((a, f) => a + (f.size || 0), 0), sizeOut: blob.size, inputs: inputs.slice(0, 5), outputs: [blob], outputName: name })
        .then((ok) => { if (ok) toast('บันทึกประวัติและสำเนาไว้ในคลังข้อมูลแล้ว', 'info'); }).catch(() => {});
    }
  };
}
const pdfBlob = (bytes) => new Blob([bytes], { type: 'application/pdf' });
const run = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(errText(e), 'error', 6000); } };

/* --------------------------------- pdf.js bits --------------------------------- */

async function openForRender(blobOrBytes) {
  const pdfjs = await getPdfjs();
  const data = blobOrBytes instanceof Uint8Array ? blobOrBytes.slice() : new Uint8Array(await blobOrBytes.arrayBuffer());
  return pdfjs.getDocument({ data, isEvalSupported: false, verbosity: 0 }).promise;
}
async function renderPage(canvas, doc, pageNo, cssWidth) {
  const page = await doc.getPage(pageNo); const base = page.getViewport({ scale: 1 });
  const dpr = Math.min(2, window.devicePixelRatio || 1); const vp = page.getViewport({ scale: (cssWidth / base.width) * dpr });
  canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
  canvas.style.aspectRatio = `${base.width} / ${base.height}`;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return { w: base.width, h: base.height };
}

/* ---------------------------------- the page ---------------------------------- */

export async function mount(root) {
  await ensureCss();
  const cleanups = [];
  const TABS = [
    ['merge', 'รวมไฟล์', mergePanel], ['pages', 'จัดการหน้า', pagesPanel], ['images', 'รูปสแกน → PDF', imagesPanel], ['stamp', 'ลายน้ำ · เลขหน้า · ตราประทับ', stampPanel]
  ];
  const panels = {}; const btns = {};
  const bar = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'เครื่องมือ PDF' });
  const body = h('div');
  function show(id) {
    for (const [k, , make] of TABS) {
      if (k === id && !panels[k]) { panels[k] = make(cleanups); body.append(panels[k]); }
      if (panels[k]) panels[k].hidden = k !== id;
      btns[k].setAttribute('aria-selected', String(k === id));
    }
    try { sessionStorage.setItem('sand:pdf-tab', id); } catch { /* ignore */ }
  }
  for (const [k, label] of TABS) { btns[k] = h('button', { class: 'tab', type: 'button', role: 'tab', onclick: () => show(k) }, label); bar.append(btns[k]); }

  root.append(h('div', { class: 'page page-wide' },
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'เครื่องมือ PDF'), h('p', null, 'รวม แยก หมุน ลบหน้า · แปลงรูปจากเครื่องสแกนเป็น PDF · ใส่ลายน้ำ เลขหน้า และตราประทับ'))),
    privacyNotice({ detail: recording() ? `ไฟล์ถูกประมวลผลในเบราว์เซอร์ของคุณ · ${recordingNote()}` : 'ไฟล์ถูกประมวลผลในเบราว์เซอร์ของคุณทั้งหมด ไม่ถูกอัปโหลดไปที่ใด' }),
    h('div', { class: 'card' }, bar, body)));
  let first = 'merge'; try { const s = sessionStorage.getItem('sand:pdf-tab'); if (TABS.some((t) => t[0] === s)) first = s; } catch { /* ignore */ }
  show(first);
  return () => cleanups.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
}

/* ------------------------------------ merge ------------------------------------ */

function mergePanel() {
  /** @type {{id:number,file:File,pages:number|null}[]} */
  let items = [];
  const list = h('div', { class: 'pdf-list' });
  const out = results();
  const name = h('input', { type: 'text', value: 'รวมเอกสาร.pdf', maxlength: 100 });
  const go = h('button', { class: 'btn btn-primary', type: 'button', onclick: run(merge) }, svgIcon(ICONS.check, 18), 'รวมไฟล์');
  const sortBtn = h('button', { class: 'btn', type: 'button', onclick: () => { items.sort((a, b) => E.naturalCompare(a.file.name, b.file.name)); draw(); } }, 'เรียงตามชื่อ');
  const clearBtn = h('button', { class: 'btn', type: 'button', onclick: () => { items = []; draw(); } }, 'ล้างทั้งหมด');
  const summary = h('p', { class: 'hint' });

  async function add(files) {
    for (const f of files) {
      const it = { id: ++uid, file: f, pages: null }; items.push(it);
      E.pageCount(f).then((n) => { it.pages = n; draw(); }, (e) => { it.pages = -1; it.err = errText(e); draw(); });
    }
    draw();
  }
  function draw() {
    const total = items.reduce((a, i) => a + Math.max(0, i.pages || 0), 0);
    list.replaceChildren(...items.map((it, i) => h('div', { class: 'pdf-row' },
      h('span', { class: 'pdf-no' }, i + 1),
      h('div', { class: 'pdf-main' }, h('b', { title: it.file.name }, it.file.name), h('small', { class: it.pages === -1 ? 'status-err' : 'muted' },
        it.pages === -1 ? it.err : `${formatBytes(it.file.size)} · ${it.pages == null ? 'กำลังนับหน้า…' : `${it.pages} หน้า`}`)),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'เลื่อนขึ้น', disabled: i === 0, onclick: () => { [items[i - 1], items[i]] = [items[i], items[i - 1]]; draw(); } }, svgIcon(I.up, 18)),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'เลื่อนลง', disabled: i === items.length - 1, onclick: () => { [items[i + 1], items[i]] = [items[i], items[i + 1]]; draw(); } }, svgIcon(I.down, 18)),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': `เอา ${it.file.name} ออก`, onclick: () => { items = items.filter((x) => x !== it); draw(); } }, svgIcon(I.close, 18)))));
    summary.textContent = items.length ? `${items.length} ไฟล์ · รวม ${total} หน้า` : '';
    go.disabled = items.length < 2 || items.some((i) => i.pages === -1); sortBtn.disabled = items.length < 2; clearBtn.disabled = !items.length;
  }
  async function merge() {
    const files = items.map((i) => i.file); const n = safeFileName(name.value.trim() || 'รวมเอกสาร.pdf').replace(/(\.pdf)?$/i, '.pdf');
    const r = await E.mergePdfs(files);
    await out.add(pdfBlob(r.bytes), n, { op: 'merge', inputs: files });
    toast(`รวมแล้ว ${r.pages} หน้า`, 'success');
  }
  draw();
  return h('section', { role: 'tabpanel' },
    dropzone({ title: 'วางไฟล์ PDF ที่ต้องการรวม', hint: 'เลือกได้หลายไฟล์ แล้วจัดลำดับด้านล่าง', accept: '.pdf,application/pdf', multiple: true, filter: isPdf, onFiles: add }),
    list, summary, h('div', { class: 'btn-row pdf-actions' }, field('ชื่อไฟล์ผลลัพธ์', name).root, go, sortBtn, clearBtn), out.el);
}

/* ------------------------------------ pages ------------------------------------ */

function pagesPanel(cleanups) {
  let file = null; let doc = null; let total = 0;
  /** @type {{key:number,src:number,rot:number}[]} */
  let pages = []; const sel = new Set(); let lastClicked = -1;
  const out = results();
  const grid = h('div', { class: 'pdf-grid', role: 'list' });
  const info = h('p', { class: 'hint' });
  const holder = h('div');
  const rangeIn = h('input', { type: 'text', placeholder: 'เช่น 1-3, 5, 8-', 'aria-label': 'เลือกหน้าตามช่วง' });
  const chunkIn = h('input', { type: 'number', min: '1', value: '5', 'aria-label': 'จำนวนหน้าต่อไฟล์' });
  cleanups.push(() => { if (doc) doc.destroy(); });

  /* lazy thumbnails — one canvas per source page, reused across redraws */
  const thumbs = new Map(); const queue = []; let busy = false;
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { io.unobserve(e.target); const c = e.target.firstElementChild; if (c) { queue.push(c); pump(); } } }), { rootMargin: '300px' }) : null;
  cleanups.push(() => io && io.disconnect());
  async function pump() {
    if (busy) return; busy = true;
    while (queue.length) {
      const cv = queue.shift(); if (cv.dataset.done || !doc) continue;
      try { await renderPage(cv, doc, Number(cv.dataset.src) + 1, 160); cv.dataset.done = '1'; fit(cv); } catch (e) { console.warn('thumb', e && e.message); }
    }
    busy = false;
  }
  function fit(cv) {
    const rot = Number(cv.dataset.rot) || 0; const box = cv.parentElement; if (!box) return;
    const bw = box.clientWidth || 150; const bh = box.clientHeight || 190; const ar = cv.width / cv.height || 0.7;
    const w = Math.min(bw, bh * ar); const hh = w / ar; cv.style.width = `${w}px`; cv.style.height = `${hh}px`;
    cv.style.transform = rot % 180 ? `rotate(${rot}deg) scale(${Math.min(bw / hh, bh / w, 1)})` : `rotate(${rot}deg)`;
  }

  async function load(f) {
    try {
      total = await E.pageCount(f);
      if (doc) doc.destroy();
      doc = await openForRender(f); file = f; thumbs.clear(); queue.length = 0; sel.clear(); lastClicked = -1;
      pages = Array.from({ length: total }, (_, i) => ({ key: ++uid, src: i, rot: 0 }));
      holder.replaceChildren(workbench()); draw();
    } catch (e) { toast(errText(e), 'error', 6000); }
  }

  function draw() {
    grid.replaceChildren(...pages.map((p, i) => {
      let cv = thumbs.get(p.src);
      if (!cv) { cv = h('canvas', { class: 'pdf-thumb', dataset: { src: p.src }, 'aria-hidden': 'true' }); thumbs.set(p.src, cv); if (!io) { queue.push(cv); pump(); } }
      cv.dataset.rot = p.rot;
      const card = h('div', { class: 'pdf-card', role: 'listitem', draggable: 'true', dataset: { i }, 'aria-selected': String(sel.has(p.key)) },
        h('button', { class: 'pdf-pick', type: 'button', 'aria-pressed': String(sel.has(p.key)), 'aria-label': `หน้า ${i + 1} (ต้นฉบับหน้า ${p.src + 1})`, onclick: (e) => pick(i, e) },
          h('span', { class: 'pdf-box' }, cv), h('span', { class: 'pdf-label' }, `${i + 1}`, p.src !== i ? h('small', null, ` (เดิม ${p.src + 1})`) : null, p.rot ? h('small', null, ` ↻${p.rot}°`) : null)));
      card.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', String(i)); e.dataTransfer.effectAllowed = 'move'; card.classList.add('drag'); });
      card.addEventListener('dragend', () => card.classList.remove('drag'));
      card.addEventListener('dragover', (e) => { e.preventDefault(); card.classList.add('over'); });
      card.addEventListener('dragleave', () => card.classList.remove('over'));
      card.addEventListener('drop', (e) => { e.preventDefault(); card.classList.remove('over'); const from = Number(e.dataTransfer.getData('text/plain')); if (Number.isInteger(from)) dropMove(from, i); });
      requestAnimationFrame(() => { if (cv.dataset.done) fit(cv); else if (io) io.observe(card.querySelector('.pdf-box')); });
      return card;
    }));
    const n = sel.size;
    info.textContent = `${pages.length} หน้า${pages.length !== total ? ` (จากเดิม ${total})` : ''} · เลือกอยู่ ${n} หน้า — คลิกเพื่อเลือก กด Shift เพื่อเลือกต่อเนื่อง ลากเพื่อสลับลำดับ`;
    for (const b of document.querySelectorAll('[data-needs-sel]')) b.disabled = !n;
  }
  function pick(i, e) {
    const k = pages[i].key;
    if (e.shiftKey && lastClicked >= 0) { const [a, b] = [Math.min(lastClicked, i), Math.max(lastClicked, i)]; for (let j = a; j <= b; j++) sel.add(pages[j].key); }
    else if (sel.has(k)) sel.delete(k); else sel.add(k);
    lastClicked = i; refreshSel();
  }
  function refreshSel() {
    grid.querySelectorAll('.pdf-card').forEach((c, i) => { const on = sel.has(pages[i].key); c.setAttribute('aria-selected', String(on)); c.querySelector('.pdf-pick').setAttribute('aria-pressed', String(on)); });
    info.textContent = info.textContent.replace(/เลือกอยู่ \d+ หน้า/, `เลือกอยู่ ${sel.size} หน้า`);
    for (const b of holder.querySelectorAll('[data-needs-sel]')) b.disabled = !sel.size;
  }
  function dropMove(from, to) {
    const dragged = pages[from]; const moving = sel.has(dragged.key) ? pages.filter((p) => sel.has(p.key)) : [dragged];
    const target = pages[to]; if (moving.includes(target)) return;
    const rest = pages.filter((p) => !moving.includes(p)); const at = rest.indexOf(target);
    pages = [...rest.slice(0, at), ...moving, ...rest.slice(at)]; draw();
  }
  const selected = () => pages.filter((p) => sel.has(p.key));
  const mutate = (fn) => { fn(); draw(); };
  const rotate = (deg) => mutate(() => { const t = sel.size ? selected() : pages; t.forEach((p) => { p.rot = (p.rot + deg + 360) % 360; }); });
  const nudge = (dir) => mutate(() => {
    const idx = pages.map((p, i) => (sel.has(p.key) ? i : -1)).filter((i) => i >= 0); if (!idx.length) return;
    if (dir < 0 && idx[0] === 0) return; if (dir > 0 && idx[idx.length - 1] === pages.length - 1) return;
    const order = dir < 0 ? idx : [...idx].reverse();
    for (const i of order) { [pages[i + dir], pages[i]] = [pages[i], pages[i + dir]]; }
  });
  const descs = (list) => list.map((p) => ({ src: p.src, rot: p.rot }));
  const outName = (suffix) => `${baseName(file.name)}${suffix}.pdf`;

  const exportAll = run(async () => { const b = pdfBlob(await E.organizePdf(file, descs(pages))); await out.add(b, outName('_แก้ไข'), { op: 'organize', inputs: [file] }); });
  const exportSel = run(async () => {
    const sp = selected(); const b = pdfBlob(await E.organizePdf(file, descs(sp)));
    await out.add(b, outName(`_หน้า${E.formatRanges(sp.map((p) => pages.indexOf(p))).replace(/, /g, '_')}`), { op: 'extract', inputs: [file] });
  });
  const zipOut = async (parts, names, op) => {
    const JSZip = await getJSZip(); const z = new JSZip(); parts.forEach((u8, i) => z.file(names[i], u8));
    const blob = await z.generateAsync({ type: 'blob', compression: 'STORE' });
    await out.add(blob, `${baseName(file.name)}_แยกไฟล์.zip`, { op, inputs: [file] }); toast(`แยกเป็น ${parts.length} ไฟล์`, 'success');
  };
  const splitEach = run(async () => { const parts = await E.splitPdf(file, pages.map((p) => [{ src: p.src, rot: p.rot }])); const w = String(pages.length).length; await zipOut(parts, pages.map((_, i) => `${baseName(file.name)}_หน้า${String(i + 1).padStart(w, '0')}.pdf`), 'split-pages'); });
  const splitChunks = run(async () => {
    const n = Math.max(1, Math.floor(Number(chunkIn.value) || 0)); const rs = E.chunkRanges(pages.length, n);
    const parts = await E.splitPdf(file, rs.map((r) => descs(pages.slice(r.from, r.to + 1))));
    await zipOut(parts, rs.map((r) => `${baseName(file.name)}_${r.from + 1}-${r.to + 1}.pdf`), 'split-chunks');
  });
  const selectRange = run(async () => { const idx = E.parseRanges(rangeIn.value, pages.length); sel.clear(); idx.forEach((i) => sel.add(pages[i].key)); lastClicked = idx.length ? idx[idx.length - 1] : -1; refreshSel(); if (!idx.length) toast('พิมพ์ช่วงหน้าที่ต้องการเลือก', 'info'); });
  const btn = (label, icon, fn, o = {}) => h('button', { class: `btn btn-sm${o.primary ? ' btn-primary' : ''}${o.danger ? ' btn-danger' : ''}`, type: 'button', onclick: fn, 'data-needs-sel': o.needsSel ? '' : null, title: o.title }, icon ? svgIcon(icon, 16) : null, label);

  function workbench() {
    return h('div', null,
      h('div', { class: 'pdf-toolbar' },
        h('b', { class: 'pdf-fname', title: file.name }, file.name),
        btn('เปลี่ยนไฟล์', null, () => { doc && doc.destroy(); doc = null; file = null; holder.replaceChildren(zone); }),
        h('div', { class: 'spacer' }),
        btn('เลือกทั้งหมด', null, () => { pages.forEach((p) => sel.add(p.key)); refreshSel(); }), btn('ล้างการเลือก', null, () => { sel.clear(); refreshSel(); }),
        btn('หน้าคี่', null, () => { sel.clear(); pages.forEach((p, i) => { if (i % 2 === 0) sel.add(p.key); }); refreshSel(); }), btn('หน้าคู่', null, () => { sel.clear(); pages.forEach((p, i) => { if (i % 2 === 1) sel.add(p.key); }); refreshSel(); }),
        rangeIn, btn('เลือกช่วง', null, selectRange)),
      h('div', { class: 'pdf-toolbar' },
        btn('หมุนซ้าย', I.ccw, () => rotate(-90), { title: 'หมุนหน้าที่เลือก (ถ้าไม่เลือก = ทุกหน้า)' }), btn('หมุนขวา', I.cw, () => rotate(90), { title: 'หมุนหน้าที่เลือก (ถ้าไม่เลือก = ทุกหน้า)' }),
        btn('เลื่อนไปก่อน', I.left, () => nudge(-1), { needsSel: true }), btn('เลื่อนไปหลัง', I.right, () => nudge(1), { needsSel: true }),
        btn('ลบหน้าที่เลือก', ICONS.trash, () => { if (sel.size >= pages.length) { toast('ลบทุกหน้าไม่ได้', 'error'); return; } mutate(() => { pages = pages.filter((p) => !sel.has(p.key)); sel.clear(); }); }, { needsSel: true, danger: true }),
        btn('คืนค่าเดิม', ICONS.rotate, () => { pages = Array.from({ length: total }, (_, i) => ({ key: ++uid, src: i, rot: 0 })); sel.clear(); draw(); })),
      info, grid,
      h('div', { class: 'pdf-export card' },
        h('b', null, 'บันทึกผลลัพธ์'),
        h('div', { class: 'btn-row' },
          btn('ดาวน์โหลด PDF ที่จัดแล้ว', ICONS.download, exportAll, { primary: true }),
          btn('แยกเฉพาะหน้าที่เลือกเป็นไฟล์ใหม่', ICONS.download, exportSel, { needsSel: true }),
          btn('แยกทุกหน้า (ZIP)', ICONS.download, splitEach)),
        h('div', { class: 'btn-row' }, h('span', null, 'แบ่งไฟล์ละ'), chunkIn, h('span', null, 'หน้า'), btn('แบ่งเป็น ZIP', ICONS.download, splitChunks))),
      out.el);
  }
  const zone = dropzone({ title: 'วางไฟล์ PDF ที่ต้องการจัดการหน้า', hint: 'ดูตัวอย่างทุกหน้า แล้วหมุน ลบ สลับลำดับ หรือแยกไฟล์', accept: '.pdf,application/pdf', filter: isPdf, onFiles: (fs) => load(fs[0]) });
  holder.append(zone);
  return h('section', { role: 'tabpanel' }, holder);
}

/* ------------------------------------ images ------------------------------------ */

function imagesPanel(cleanups) {
  /** @type {{id:number,file:File,rot:number,url:string}[]} */
  let items = [];
  const out = results();
  const grid = h('div', { class: 'pdf-grid pdf-grid-img' });
  const summary = h('p', { class: 'hint' });
  const sel = (opts, v) => { const s = h('select', null, opts.map(([val, label]) => h('option', { value: val }, label))); s.value = v; return s; };
  const size = sel([['a4', 'A4'], ['a3', 'A3'], ['letter', 'Letter'], ['legal', 'Legal'], ['fit', 'ตามสัดส่วนรูป (ไม่มีขอบขาว)']], 'a4');
  const orient = sel([['auto', 'อัตโนมัติตามรูป'], ['portrait', 'แนวตั้ง'], ['landscape', 'แนวนอน']], 'auto');
  const margin = sel([['0', 'ไม่มี'], ['5', '5 มม.'], ['10', '10 มม.'], ['15', '15 มม.']], '0');
  const quality = sel([['balanced', 'สมดุล — ชัดพอสำหรับเอกสาร (ประมาณ 300 dpi)'], ['original', 'ต้นฉบับ — ไม่ย่อ (ไฟล์ใหญ่)'], ['small', 'เล็ก — เหมาะส่งอีเมลหรือระบบที่จำกัดขนาด']], 'balanced');
  const gray = h('input', { type: 'checkbox', id: 'img-gray' });
  const name = h('input', { type: 'text', value: `สแกน_${stampDay()}.pdf`, maxlength: 100 });
  const go = h('button', { class: 'btn btn-primary', type: 'button', onclick: run(convert) }, svgIcon(ICONS.check, 18), 'สร้าง PDF');
  const bar = h('div', { class: 'btn-row' },
    h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { items.sort((a, b) => E.naturalCompare(a.file.name, b.file.name)); draw(); } }, 'เรียงตามชื่อไฟล์'),
    h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { items.reverse(); draw(); }, title: 'เครื่องสแกนบางรุ่นวางหน้าสุดท้ายก่อน' }, 'กลับลำดับ'),
    h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { items.forEach((i) => { i.rot = (i.rot + 90) % 360; }); draw(); } }, 'หมุนทุกรูป'),
    h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { items.forEach((i) => URL.revokeObjectURL(i.url)); items = []; draw(); } }, 'ล้างทั้งหมด'));
  cleanups.push(() => items.forEach((i) => URL.revokeObjectURL(i.url)));

  function add(files) {
    files.sort((a, b) => E.naturalCompare(a.name, b.name));
    for (const f of files) items.push({ id: ++uid, file: f, rot: 0, url: URL.createObjectURL(f) });
    draw();
  }
  function draw() {
    grid.replaceChildren(...items.map((it, i) => h('div', { class: 'pdf-card pdf-card-img' },
      h('span', { class: 'pdf-box' }, h('img', { src: it.url, alt: it.file.name, style: `transform:rotate(${it.rot}deg)${it.rot % 180 ? ' scale(.72)' : ''}`, draggable: 'false' })),
      h('span', { class: 'pdf-label' }, `${i + 1}`, h('small', { title: it.file.name }, ` ${it.file.name}`)),
      h('div', { class: 'pdf-mini' },
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'ย้ายไปก่อน', disabled: i === 0, onclick: () => { [items[i - 1], items[i]] = [items[i], items[i - 1]]; draw(); } }, svgIcon(I.left, 16)),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'หมุนขวา', onclick: () => { it.rot = (it.rot + 90) % 360; draw(); } }, svgIcon(I.cw, 16)),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'ย้ายไปหลัง', disabled: i === items.length - 1, onclick: () => { [items[i + 1], items[i]] = [items[i], items[i + 1]]; draw(); } }, svgIcon(I.right, 16)),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': `เอา ${it.file.name} ออก`, onclick: () => { URL.revokeObjectURL(it.url); items = items.filter((x) => x !== it); draw(); } }, svgIcon(I.close, 16))))));
    const bytes = items.reduce((a, i) => a + i.file.size, 0);
    summary.textContent = items.length ? `${items.length} รูป · ${formatBytes(bytes)} → จะได้ PDF ${items.length} หน้า` : '';
    go.disabled = !items.length; bar.hidden = !items.length;
  }
  async function convert() {
    const files = items.map((i) => i.file);
    const r = await E.imagesToPdf(items.map((i) => ({ file: i.file, rot: i.rot })), { size: size.value, orient: orient.value, margin: Number(margin.value), quality: quality.value, gray: gray.checked });
    const n = safeFileName(name.value.trim() || 'สแกน.pdf').replace(/(\.pdf)?$/i, '.pdf');
    await out.add(pdfBlob(r.bytes), n, { op: 'images-to-pdf', inputs: files.slice(0, 3), sizeIn: files.reduce((a, f) => a + f.size, 0) });
    toast(`สร้าง PDF ${r.pages} หน้าแล้ว`, 'success');
  }
  draw();
  return h('section', { role: 'tabpanel' },
    dropzone({ title: 'วางรูปจากเครื่องสแกน (JPG, PNG)', hint: 'เลือกได้หลายรูป ระบบเรียงตามชื่อไฟล์ให้ (scan2 มาก่อน scan10) — ไฟล์ TIFF/HEIC ให้ตั้งเครื่องสแกนบันทึกเป็น JPEG', accept: 'image/*,.jpg,.jpeg,.png,.webp,.bmp', multiple: true, filter: isImage, onFiles: add }),
    bar, grid, summary,
    h('div', { class: 'card pdf-opts' }, h('div', { class: 'grid-2' },
      field('ขนาดกระดาษ', size).root, field('ทิศทางกระดาษ', orient).root, field('ขอบกระดาษ', margin).root, field('คุณภาพไฟล์', quality).root,
      h('div', { class: 'field' }, h('label', { for: 'img-gray' }, 'โหมดสี'), h('label', { class: 'pdf-check' }, gray, 'ขาวดำ (เกรย์สเกล) — ไฟล์เล็กลงมากสำหรับเอกสารตัวอักษร')))),
    h('div', { class: 'btn-row pdf-actions' }, field('ชื่อไฟล์ผลลัพธ์', name).root, go), out.el);
}

/* ------------------------------------ stamp ------------------------------------ */

function stampPanel(cleanups) {
  let file = null; let total = 0; let pv = 0; let pvDoc = null; let seq = 0;
  const out = results();
  const holder = h('div');
  const canvas = h('canvas', { class: 'pdf-preview', 'aria-label': 'ตัวอย่างหน้าเอกสาร' });
  const pvLabel = h('span', { class: 'muted' });
  const pvNote = h('p', { class: 'hint' }, 'ตัวอย่างแสดงผลจริงของหน้าที่เลือก');
  cleanups.push(() => { if (pvDoc) pvDoc.destroy(); });
  const toggle = (id, label, on) => { const cb = h('input', { type: 'checkbox', id, checked: !!on }); cb.addEventListener('change', () => { body.hidden = !cb.checked; refresh(); }); const body = h('div', { class: 'pdf-sec-body', hidden: !on }); return { cb, body, head: h('label', { class: 'pdf-sec-head', for: id }, cb, h('b', null, label)) }; };
  const sel = (opts, v) => { const s = h('select', null, opts.map(([val, label]) => h('option', { value: val }, label))); s.value = v; return s; };
  const rng = (min, max, v) => h('input', { type: 'range', min, max, value: v });
  const chips = (list, input) => h('div', { class: 'chip-row' }, list.map((t) => h('button', { class: 'chip', type: 'button', onclick: () => { input.value = t; refresh(); } }, t)));
  const COLORS = [['#888888', 'เทา'], ['#c62828', 'แดง'], ['#1d4ed8', 'น้ำเงิน'], ['#111111', 'ดำ']];
  const POS = [['top-right', 'มุมขวาบน'], ['top-left', 'มุมซ้ายบน'], ['bottom-right', 'มุมขวาล่าง'], ['bottom-left', 'มุมซ้ายล่าง'], ['center', 'กลางหน้า']];

  const W = toggle('st-wm', 'ลายน้ำตัวอักษรเฉียงกลางหน้า', false);
  const wmText = h('input', { type: 'text', value: 'สำเนา', maxlength: 40 }); const wmSize = rng(10, 40, 24); const wmOp = rng(8, 80, 22);
  const wmAngle = sel([['45', 'เฉียงขึ้น 45°'], ['0', 'แนวนอน'], ['-45', 'เฉียงลง 45°']], '45'); const wmColor = sel(COLORS, '#888888');
  W.body.append(field('ข้อความลายน้ำ', wmText).root, chips(E.STAMP_PRESETS, wmText), h('div', { class: 'grid-2' }, field('ขนาด', wmSize).root, field('ความเข้ม', wmOp).root, field('มุม', wmAngle).root, field('สี', wmColor).root));

  const S = toggle('st-st', 'ตราประทับกรอบสี่เหลี่ยม (เช่น สำเนา ลับ ด่วน)', false);
  const stText = h('input', { type: 'text', value: 'สำเนาถูกต้อง', maxlength: 40 }); const stPos = sel(POS, 'top-right'); const stColor = sel(COLORS.slice(1), '#c62828'); const stSize = rng(14, 60, 26);
  const stDate = h('input', { type: 'checkbox', id: 'st-date' });
  S.body.append(field('ข้อความตราประทับ', stText).root, chips(E.STAMP_PRESETS, stText), h('div', { class: 'grid-2' }, field('ตำแหน่ง', stPos).root, field('สี', stColor).root, field('ขนาด', stSize).root,
    h('div', { class: 'field' }, h('label', { for: 'st-date' }, 'วันที่'), h('label', { class: 'pdf-check' }, stDate, 'แนบวันที่วันนี้ (พ.ศ.) ใต้ข้อความ'))));

  const N = toggle('st-n', 'เลขหน้า', true);
  const nFmt = sel(E.NUMBER_FORMATS, '{n} / {t}'); const nPos = sel([['bottom-center', 'กลางล่าง'], ['bottom-right', 'ขวาล่าง'], ['bottom-left', 'ซ้ายล่าง'], ['top-center', 'กลางบน'], ['top-right', 'ขวาบน'], ['top-left', 'ซ้ายบน']], 'bottom-center');
  const nSize = rng(8, 20, 11); const nStart = h('input', { type: 'number', min: '0', value: '1' });
  const nSkip = h('input', { type: 'checkbox', id: 'n-skip' }); const nThai = h('input', { type: 'checkbox', id: 'n-thai' });
  N.body.append(h('div', { class: 'grid-2' }, field('รูปแบบ', nFmt).root, field('ตำแหน่ง', nPos).root, field('ขนาดตัวอักษร', nSize).root, field('เริ่มนับที่เลข', nStart).root,
    h('div', { class: 'field' }, h('label', { class: 'pdf-check' }, nSkip, 'ไม่ใส่เลขหน้าแรก (ปก)')), h('div', { class: 'field' }, h('label', { class: 'pdf-check' }, nThai, 'ใช้เลขไทย (๑ ๒ ๓)'))));
  N.cb.checked = true; N.body.hidden = false;

  const pagesIn = h('input', { type: 'text', placeholder: 'เว้นว่าง = ทุกหน้า หรือเช่น 1-3, 5', 'aria-label': 'หน้าที่ใช้' });
  const name = h('input', { type: 'text', maxlength: 100 });
  const go = h('button', { class: 'btn btn-primary', type: 'button', onclick: run(apply) }, svgIcon(ICONS.check, 18), 'ใส่กับทั้งเอกสารและดาวน์โหลด');

  const opts = () => ({
    pages: pagesIn.value,
    watermark: { on: W.cb.checked, text: wmText.value, size: Number(wmSize.value), opacity: Number(wmOp.value), angle: Number(wmAngle.value), color: wmColor.value },
    stamp: { on: S.cb.checked, text: stText.value, pos: stPos.value, color: stColor.value, size: Number(stSize.value), date: stDate.checked },
    numbers: { on: N.cb.checked, format: nFmt.value, pos: nPos.value, size: Number(nSize.value), start: nStart.value, skipFirst: nSkip.checked, thai: nThai.checked, color: '#222222' }
  });
  const anyOn = () => W.cb.checked || S.cb.checked || N.cb.checked;

  const refresh = debounce(async () => {
    if (!file) return; const my = ++seq;
    pvLabel.textContent = `หน้า ${pv + 1} / ${total}`;
    try {
      const bytes = anyOn() ? await E.stampPdf(file, opts(), { only: pv }) : null;
      const d = await openForRender(bytes || (await E.organizePdf(file, [{ src: pv, rot: 0 }])));
      if (my !== seq) { d.destroy(); return; }
      await renderPage(canvas, d, 1, 420); d.destroy(); pvNote.textContent = 'ตัวอย่างแสดงผลจริงของหน้าที่เลือก';
    } catch (e) { if (my === seq) pvNote.textContent = errText(e); }
  }, 250);
  [wmText, wmSize, wmOp, wmAngle, wmColor, stText, stPos, stColor, stSize, stDate, nFmt, nPos, nSize, nStart, nSkip, nThai, pagesIn].forEach((el) => { el.addEventListener('input', refresh); el.addEventListener('change', refresh); });

  async function apply() {
    if (!anyOn()) { toast('เปิดใช้อย่างน้อยหนึ่งอย่าง: ลายน้ำ ตราประทับ หรือเลขหน้า', 'error'); return; }
    if (S.cb.checked && !stText.value.trim() && !W.cb.checked && !N.cb.checked) { toast('พิมพ์ข้อความตราประทับก่อน', 'error'); return; }
    const bytes = await E.stampPdf(file, opts());
    const n = safeFileName(name.value.trim() || `${baseName(file.name)}_ประทับ.pdf`).replace(/(\.pdf)?$/i, '.pdf');
    await out.add(pdfBlob(bytes), n, { op: 'stamp', inputs: [file] }); toast('เสร็จแล้ว', 'success');
  }
  async function load(f) {
    try {
      total = await E.pageCount(f); file = f; pv = 0; name.value = `${baseName(f.name)}_ประทับ.pdf`;
      holder.replaceChildren(editor()); refresh();
    } catch (e) { toast(errText(e), 'error', 6000); }
  }
  const step = (d) => { pv = Math.min(total - 1, Math.max(0, pv + d)); refresh(); };
  function editor() {
    return h('div', { class: 'pdf-two' },
      h('div', null,
        h('div', { class: 'pdf-toolbar' }, h('b', { class: 'pdf-fname', title: file.name }, file.name), h('span', { class: 'muted' }, `${total} หน้า`), h('div', { class: 'spacer' }),
          h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { file = null; holder.replaceChildren(zone); } }, 'เปลี่ยนไฟล์')),
        h('div', { class: 'pdf-sec card' }, W.head, W.body), h('div', { class: 'pdf-sec card' }, S.head, S.body), h('div', { class: 'pdf-sec card' }, N.head, N.body),
        field('ใช้กับหน้า', pagesIn, 'เลขหน้าจะนับเฉพาะหน้าที่เลือก').root,
        h('div', { class: 'btn-row pdf-actions' }, field('ชื่อไฟล์ผลลัพธ์', name).root, go), out.el),
      h('aside', { class: 'pdf-preview-wrap' }, h('div', { class: 'btn-row' }, h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'หน้าก่อนหน้า', onclick: () => step(-1) }, svgIcon(I.left, 18)), pvLabel,
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'หน้าถัดไป', onclick: () => step(1) }, svgIcon(I.right, 18))), canvas, pvNote));
  }
  const zone = dropzone({ title: 'วางไฟล์ PDF ที่ต้องการใส่ลายน้ำ เลขหน้า หรือตราประทับ', hint: 'ดูตัวอย่างก่อนดาวน์โหลด · ใช้ตัวอักษรไทยได้', accept: '.pdf,application/pdf', filter: isPdf, onFiles: (fs) => load(fs[0]) });
  holder.append(zone);
  return h('section', { role: 'tabpanel' }, holder);
}
