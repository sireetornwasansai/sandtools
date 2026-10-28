import { h, svgIcon, debounce, field } from '../core/dom.js';
import { ICONS } from '../core/icons.js';
import { notice, privacyNotice } from '../core/notices.js';
import { toast } from '../core/toast.js';
import { modal } from '../core/layers.js';
import { cameraSupported, openScanner, cameraErrorText } from './saraban-scan.js';
import { URGENCY, SECRECY, RECEIVE_STEPS, SCAN_FIELD_LABELS, READ_MAX_PAGES, ATT_MAX, ATT_LIMIT, ATT_TARGET, attachKind, splitDrop, readEnough, parseLetter, plainText, addDays, newRid, fileToBase64 } from './saraban-engine.js';

const badge = (label, tone = 'muted') => h('span', { class: `sar-badge sar-${tone}` }, label);

/** Receive (ลงรับ) and send (ส่งออก) screens. `X` is the shared context from saraban.js: {call, cfg, go, openDoc, refresh}. */

const opt = (value, label, selected) => h('option', { value, selected: selected ? true : null }, label);
const errText = (e) => (e && e.message) || 'ทำรายการไม่สำเร็จ';

const mbText = (n) => `${(n / 1048576).toFixed(2)} MB`;

/** The letter file → ONE PDF File (the copy that is read and stored): a PDF as is; photos (= its pages) combined — smaller when they would not fit the 10 MB limit. `files` comes from splitDrop().main. */
async function toPdfFile(files) {
  if (files.length === 1 && attachKind(files[0]) === 'pdf') return files[0];
  if (!files.length || files.some((f) => attachKind(f) !== 'image')) throw Object.assign(new Error('ไฟล์ที่ใช้อ่านข้อมูลได้คือ PDF หรือรูปภาพ (JPG/PNG/WebP)'), { fatal: true });
  const { imagesToPdf } = await import('./pdf/engine.js');
  const build = async (quality) => { const r = await imagesToPdf(files.map((file) => ({ file })), { size: 'a4', margin: 0, quality }); return new File([r.bytes], files[0].name.replace(/\.[^.]+$/, '') + '.pdf', { type: 'application/pdf' }); };
  let out = await build('balanced');
  if (out.size > ATT_TARGET) { const small = await build('small'); if (small.size < out.size) out = small; }
  return out;
}

/** A PDF over the storage limit (a 20+ page scan is often 15–40 MB): rebuild it from page images, smaller each round, until it fits. The text layer is lost — what is READ is always the original. */
async function shrinkToFit(file, onStatus) {
  const { shrinkPdf } = await import('./shrink-docs.js');
  let best = file;
  for (const [scale, quality] of [[1.6, 0.72], [1.3, 0.6], [1.0, 0.5]]) {
    const blob = await shrinkPdf(file, { quality, scale, onPage: (i, n) => { if (onStatus) onStatus(`กำลังย่อไฟล์ให้ไม่เกิน 10 MB — หน้า ${i}/${n}`); } });
    best = new File([blob], file.name, { type: 'application/pdf' });
    if (best.size <= ATT_TARGET) return best;
  }
  throw new Error(`ย่อไฟล์แล้วยังใหญ่ ${mbText(best.size)} (เกิน 10 MB) — แบ่งไฟล์เป็นหลายส่วนแล้วแนบแยก`);
}

/**
 * Read the letter on this device — ONLY its first READ_MAX_PAGES pages (เลขที่ · วันที่ · เรื่อง · เรียน are on page 1; a 24-page letter used to be OCR-ed page by page for minutes).
 * A long PDF is first cut to its first pages (pdf/engine.js firstPages), then read from the text layer or by on-device OCR, and OCR stops as soon as เลขที่ + เรื่อง + เรียน are found.
 * Photos are OCR-ed directly (cleaned first — see converters/ocr-preprocess.js). Nothing is sent anywhere.
 * Reading never decides what is stored: the file is attached on its own (see the attachment list in receiveView).
 * @returns {Promise<{text:string,pages:number}>} pages = pages in the whole file (0 when unknown)
 */
async function readLetter(pdf, originals, onStatus) {
  const imgs = originals.filter((f) => attachKind(f) === 'image');
  if (imgs.length && imgs.length === originals.length) {
    const { ocrImageBlob, createOcrEngine } = await import('./converters/ocr.js');
    const engine = await createOcrEngine({ onStatus });
    try {
      const n = Math.min(imgs.length, READ_MAX_PAGES); const parts = [];
      for (let i = 0; i < n; i += 1) {
        if (onStatus && n > 1) onStatus(`กำลังอ่านหน้า ${i + 1} จาก ${n}${imgs.length > n ? ` (อ่านเฉพาะ ${READ_MAX_PAGES} หน้าแรก)` : ''}`);
        const r = await ocrImageBlob(imgs[i], { engine, onStatus: n > 1 ? undefined : onStatus });
        parts.push(r.markdown);
        if (readEnough(plainText(parts.join('\n\n')))) break;                 // the first page carries every field we need
      }
      return { text: plainText(parts.join('\n\n')), pages: imgs.length };
    } finally { await engine.terminate(); }
  }
  let head = { file: pdf, total: 0, trimmed: false };
  try { if (onStatus) onStatus('กำลังเลือกหน้าแรกของหนังสือ'); const { firstPages } = await import('./pdf/engine.js'); head = await firstPages(pdf, READ_MAX_PAGES); } catch { /* encrypted / odd file: the converter below reports it, or reads the start of the whole file */ }
  if (onStatus && head.total > READ_MAX_PAGES) onStatus(`ไฟล์มี ${head.total} หน้า — อ่านเฉพาะ ${READ_MAX_PAGES} หน้าแรก`);
  const named = /\.pdf$/i.test(head.file.name || '') ? head.file : new File([head.file], `${head.file.name || 'letter'}.pdf`, { type: 'application/pdf' });
  const { convertFile } = await import('./converters/index.js');
  const r = await convertFile(named, { maxBytes: 15 * 1024 * 1024, timeoutMs: 90000, ocr: true, ocrTimeoutMs: 3 * 60 * 1000, maxPages: READ_MAX_PAGES, enough: readEnough, onStatus });
  return { text: plainText(r.markdown), pages: head.total };
}

/** Receive stamp on page 1 (top right): หน่วยงาน · เลขรับ · วันที่ · เวลา. Returns a new PDF Blob. */
export async function stampReceive(file, st) {
  const { getPdfLib } = await import('./pdf/engine.js');
  const lib = await getPdfLib(); const doc = await lib.PDFDocument.load(await file.arrayBuffer());
  const page = doc.getPage(0); const size = page.getSize(); const pt = Math.max(9, Math.min(13, size.width / 48)); const K = 3; const px = pt * K;
  const lines = [st.org, `ทะเบียนรับ: ${st.registry}`, `เลขรับ ${st.reg}`, `วันที่ ${st.date}`, `เวลา ${st.time}`];
  const c = document.createElement('canvas'); const g = c.getContext('2d'); const font = `${px}px "Sarabun","Noto Sans Thai","Leelawadee UI","Tahoma",sans-serif`;
  g.font = font; const pad = px * 0.5; const w = Math.ceil(Math.max(...lines.map((l) => g.measureText(l).width)) + pad * 2); const lh = px * 1.35; const hh = Math.ceil(lines.length * lh + pad * 2);
  c.width = w; c.height = hh; g.fillStyle = 'rgba(255,255,255,.88)'; g.fillRect(0, 0, w, hh); g.strokeStyle = '#1d4ed8'; g.fillStyle = '#1d4ed8'; g.lineWidth = Math.max(2, px * 0.1); g.strokeRect(g.lineWidth / 2, g.lineWidth / 2, w - g.lineWidth, hh - g.lineWidth);
  g.font = font; g.textBaseline = 'middle'; g.textAlign = 'center'; lines.forEach((l, i) => { if (i === 2) g.font = `700 ${px * 1.15}px "Sarabun","Noto Sans Thai","Tahoma",sans-serif`; else g.font = font; g.fillText(l, w / 2, pad + lh * (i + 0.5)); });
  const png = await new Promise((res) => c.toBlob(res, 'image/png'));
  const img = await doc.embedPng(new Uint8Array(await png.arrayBuffer())); const dw = w / K; const dh = hh / K;
  page.drawImage(img, { x: size.width - dw - 20, y: size.height - dh - 20, width: dw, height: dh });
  return new Blob([await doc.save()], { type: 'application/pdf' });
}

async function upload(X, file, params, onRetry) {
  const data = await fileToBase64(file);
  // A plain upload only creates a Drive file, so a lost answer may be retried; attaching to a letter (docId) is not repeatable and is sent once.
  for (let i = 1; ; i += 1) {
    try { return (await X.call('upload', { name: file.name, data, ...params }, 120000)).file; } catch (e) {
      const c = e && e.code; if (params.docId || i >= 3 || (c !== 'NETWORK' && c !== 'TIMEOUT' && c !== 'BAD_RESPONSE')) throw e;
      if (onRetry) { try { onRetry(i + 1, 3); } catch { /* notice only */ } }
      await new Promise((r) => setTimeout(r, 1200 * i));
    }
  }
}
function download(blob, name) { const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 30000); }

export function unitPicker(X, state) {
  const list = h('div', { class: 'sar-units' }); const wrap = h('div', { class: 'sar-unit-pick' });
  const units = X.cfg.units.filter((u) => u.active && (u.type === 'internal' || u.type === 'exec'));
  const rows = new Map();
  const count = h('span', { class: 'muted sar-sub', 'aria-live': 'polite' });
  const refreshCount = () => { const n = [...rows.values()].filter((r) => r.cb.checked).length; count.textContent = n ? `เลือกแล้ว ${n} หน่วยงาน` : `${units.length} หน่วยงาน`; };
  units.forEach((u) => {
    const cb = h('input', { type: 'checkbox', 'aria-label': u.name });
    const act = h('select', { 'aria-label': `การปฏิบัติของ ${u.short}` }, opt('perform', 'เพื่อดำเนินการ'), opt('ack', 'เพื่อทราบ'));
    const due = h('input', { type: 'date', 'aria-label': `กำหนดของ ${u.short}` });
    const line = h('div', { class: 'sar-unit-row' }, h('label', { class: 'sar-check' }, cb, h('span', null, u.name)), h('div', { class: 'sar-unit-opts' }, act, due));
    line.hidden = false; cb.addEventListener('change', () => { line.classList.toggle('on', cb.checked); refreshCount(); }); rows.set(u.code, { cb, act, due, line, hay: `${u.name} ${u.short} ${u.code} ${u.keywords || ''}`.toLowerCase() }); list.append(line);
  });
  /* A hospital has dozens of groups: a search box filters them (ticked units always stay visible). */
  const find = h('input', { type: 'search', placeholder: 'ค้นหาหน่วยงาน เช่น พัสดุ บุคคล การเงิน…', 'aria-label': 'ค้นหาหน่วยงานปลายทาง', autocomplete: 'off' });
  find.addEventListener('input', debounce(() => { const q = find.value.trim().toLowerCase(); rows.forEach((r) => { r.line.hidden = !!q && !r.cb.checked && r.hay.indexOf(q) < 0; }); }, 120));
  state.pick = () => [...rows.entries()].filter(([, r]) => r.cb.checked).map(([unit, r]) => ({ unit, action: r.act.value, due: r.due.value }));
  state.tick = (codes) => { rows.forEach((r, code) => { if (codes.includes(code)) { r.cb.checked = true; r.line.hidden = false; r.line.classList.add('on'); } }); refreshCount(); };
  refreshCount();
  wrap.append(units.length > 8 ? find : null, count, list);
  return wrap;
}

/** Leaving the tab while a file is on its way would cut the upload: ask first. */
const leaveGuard = (e) => { e.preventDefault(); e.returnValue = ''; };
const guardLeave = (on) => window[on ? 'addEventListener' : 'removeEventListener']('beforeunload', leaveGuard);
/** Progress shown while a letter is saved: spinner + which step (of n) + what is happening now + a hint when it takes longer than usual. `detail` is a <p> the caller may write to. */
function progressPanel(labels) {
  const ol = h('ol', { class: 'sar-scan-steps sar-up-steps', 'aria-hidden': 'true' }, labels.map((l) => h('li', null, l)));
  const detail = h('p', { class: 'sar-status sar-up-now', role: 'status', 'aria-live': 'polite' });
  const slow = h('p', { class: 'muted sar-sub sar-up-slow', hidden: true }, 'ใช้เวลานานกว่าปกติ — เครือข่ายอาจช้า ระบบยังทำงานอยู่ กรุณาอย่าปิดหน้านี้');
  const root = h('div', { class: 'sar-up', hidden: true }, h('div', { class: 'sar-up-head' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), detail), ol, slow);
  let timer = 0;
  return {
    root, detail,
    show(i, text) {
      root.hidden = false; [...ol.children].forEach((li, j) => { li.classList.toggle('done', j < i); li.classList.toggle('now', j === i); });
      if (text !== undefined) detail.textContent = `ขั้นที่ ${i + 1}/${labels.length} · ${text}`;
      slow.hidden = true; clearTimeout(timer); timer = setTimeout(() => { slow.hidden = false; }, 10000); guardLeave(true);
    },
    note(text) { detail.textContent = text; },
    hide() { root.hidden = true; clearTimeout(timer); slow.hidden = true; detail.textContent = ''; guardLeave(false); }
  };
}

/* ============================== RECEIVE (รับหนังสือ) ==============================
   ขั้นตอน (v1.11):  1 นำเข้า (ไฟล์/กล้อง/คิว)  →  2 อ่านอัตโนมัติบนเครื่อง  →  3 ตรวจซ้ำ + แก้ไขข้อมูล  →  4 ออกเลขรับ (+ประทับตรา)  →  5 ส่งต่อ
   ข้อมูลที่อ่านได้แก้ไขได้ทุกช่องจนกว่าจะกดยืนยัน · เลขรับออกครั้งเดียว (rid กันกดซ้ำ) · การส่งต่อทำหลังมีเลขรับแล้ว (op route) */

export function receiveView(root, X, pre = {}) {
  let pdf = null; let rid = newRid(); const inboxId = pre.inboxId || ''; let busy = false; let step = pre.inboxId ? 'read' : 'import'; let suggestions = []; let previewUrl = ''; let scanRun = 0; let registered = false;
  const today = X.cfg.today; const F = {}; const touched = new Set();
  const mk = (name, label, input, hint) => { F[name] = input; input.addEventListener('input', () => touched.add(name)); return field(label, input, hint); };
  const text = (name, label, ph, max = 300, hint) => mk(name, label, h('input', { type: 'text', maxlength: max, placeholder: ph || '', autocomplete: 'off', value: pre[name] || '' }), hint);
  const sel = (name, label, map, v = 'normal') => mk(name, label, h('select', null, Object.entries(map).map(([k, l]) => opt(k, l, k === (pre[name] || v)))));

  /* ---- stepper ---- */
  const stepper = h('ol', { class: 'sar-wiz', 'aria-label': 'ขั้นตอนการรับหนังสือ' }, RECEIVE_STEPS.map(([k, l], i) => h('li', { dataset: { k } }, h('span', { class: 'sar-wiz-n' }, String(i + 1)), h('span', null, l))));
  const scanCard = h('div', { class: 'card sar-scan' }); const checkCard = h('div', { class: 'card' }); const resultCard = h('div'); const fwdCard = h('div'); const attCard = h('div', { class: 'card sar-att' });
  const showAtt = () => { attCard.hidden = !(step === 'read' || step === 'dup' || (step === 'number' && !resultCard.childNodes.length)); };
  function setStep(k) {
    step = k; const idx = RECEIVE_STEPS.findIndex((s) => s[0] === k);
    [...stepper.children].forEach((li, i) => { li.classList.toggle('on', i === idx); li.classList.toggle('done', i < idx); if (i === idx) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current'); });
    scanCard.hidden = !(k === 'import' || k === 'read'); checkCard.hidden = !(k === 'dup' || (k === 'number' && !resultCard.childNodes.length)); resultCard.hidden = !(k === 'forward' || k === 'number'); fwdCard.hidden = k !== 'forward'; showAtt();
  }

  /* ---- attachments (v1.15): a file given to the page is ATTACHED to the letter, not only read ----
     Every file starts uploading to the register's Drive folder the moment it is dropped (one at a time, in step with reading, not after "ยืนยัน"),
     is listed below with its own status, and can be removed or retried. Confirming waits for all of them, so a letter is never numbered with a file missing.
     The letter file (the one that is read) is `kind: 'main'`; anything else is `extra` (สิ่งที่ส่งมาด้วย). A queue item's own file is already attached by the backend. */
  const atts = []; let attSeq = 0; let chain = Promise.resolve();
  const attBusy = () => atts.some((a) => a.state === 'wait' || a.state === 'prep' || a.state === 'up');
  const discard = (id) => { if (id) Promise.resolve().then(() => X.call('discard', { id }, 30000)).catch(() => { /* an older backend, or already gone: the file just stays in Drive */ }); };
  const extraIn = h('input', { type: 'file', accept: '.pdf,.docx,.xlsx,.pptx,image/jpeg,image/png,image/webp', multiple: true, hidden: true });
  const attList = h('ul', { class: 'sar-att-list', 'aria-live': 'polite' });
  const addBtn = h('label', { class: 'btn btn-sm' }, svgIcon(ICONS.plus, 16), 'แนบไฟล์เพิ่ม', extraIn);
  attCard.append(h('h3', { class: 'sar-h3' }, 'ไฟล์แนบของหนังสือ'), h('p', { class: 'muted sar-sub' }, `ไฟล์ที่วางหรือสแกนจะ “แนบเข้าทะเบียนทันที” ไม่ใช่แค่อ่านข้อมูล · แนบได้สูงสุด ${ATT_MAX} ไฟล์ ไฟล์ละไม่เกิน 10 MB (PDF ที่ใหญ่กว่าระบบย่อให้เอง)`), attList, h('div', { class: 'btn-row' }, addBtn));
  function paintAtt() {
    const rows = atts.map((a) => {
      const st = a.state; const working = st === 'wait' || st === 'prep' || st === 'up';
      const text = st === 'err' ? a.err : working ? (a.note || { wait: 'รอส่ง…', prep: 'กำลังย่อไฟล์…', up: 'กำลังแนบเข้าทะเบียน…' }[st]) : a.from === 'queue' ? '✓ แนบอยู่แล้ว (ไฟล์จากคิว)' : a.shrunk ? `✓ แนบแล้ว (ย่อเหลือ ${mbText(a.file.size)})` : '✓ แนบแล้ว';
      return h('li', { class: `sar-att-row st-${st}` }, svgIcon(ICONS.file, 18),
        h('div', { class: 'sar-att-main' }, h('div', null, h('strong', null, a.name), ` ${mbText(a.size)} `, badge(a.kind === 'main' ? 'หนังสือ (ใช้อ่านข้อมูล)' : 'ไฟล์แนบเพิ่ม', a.kind === 'main' ? 'info' : 'muted')),
          h('div', { class: `sar-att-st ${st}`, role: 'status' }, working ? h('span', { class: 'spinner', 'aria-hidden': 'true' }) : null, text)),
        h('div', { class: 'sar-att-act' },
          st === 'err' ? h('button', { class: 'btn btn-sm', type: 'button', disabled: busy ? true : null, onclick: () => { a.err = ''; schedule(a); } }, 'ลองใหม่') : null,
          a.from === 'queue' ? null : h('button', { class: 'btn btn-sm', type: 'button', disabled: busy ? true : null, 'aria-label': `เอา ${a.name} ออก`, onclick: () => removeAtt(a) }, svgIcon(ICONS.trash, 16), 'เอาออก')));
    });
    attList.replaceChildren(...(rows.length ? rows : [h('li', { class: 'muted sar-sub' }, 'ยังไม่มีไฟล์แนบ — ลงรับโดยไม่มีไฟล์ได้ หรือกด “แนบไฟล์เพิ่ม”')]));
    addBtn.classList.toggle('is-disabled', busy); extraIn.disabled = busy; guardLeave(attBusy() || busy); showAtt();
  }
  /** Queue the upload (one file at a time — the backend answers slowly under parallel uploads, see v1.14.1). */
  function schedule(a) { a.state = 'wait'; paintAtt(); a.job = chain = chain.then(() => runAtt(a)); return a.job; }
  async function runAtt(a) {
    if (a.removed) return;
    try {
      if (a.needsShrink && !a.shrunk) { a.state = 'prep'; a.note = 'กำลังย่อไฟล์ให้ไม่เกิน 10 MB…'; paintAtt(); a.file = await shrinkToFit(a.src, (t) => { a.note = t; paintAtt(); }); a.shrunk = true; }
      if (a.removed) return;
      a.state = 'up'; a.note = `กำลังแนบเข้าทะเบียน (${mbText(a.file.size)})…`; paintAtt();
      const f = await upload(X, a.file, { kind: 'in' }, (n, t) => { a.note = `⚠️ เครือข่ายสะดุด — กำลังส่งไฟล์ใหม่ (ครั้งที่ ${n}/${t})…`; paintAtt(); });
      if (a.removed) { discard(f.id); return; }
      a.ref = f; a.state = 'done'; a.note = '';
    } catch (e) { a.state = 'err'; a.err = errText(e); }
    paintAtt();
  }
  function addAtt(file, kind, o = {}) {
    const a = { id: (attSeq += 1), kind, name: file.name, size: file.size, src: file, file, state: 'wait', ref: null, err: '', note: '', from: o.from || '', needsShrink: false, shrunk: false, removed: false, job: null };
    atts.push(a);
    if (a.from === 'queue') { a.state = 'done'; paintAtt(); return a; }
    a.needsShrink = attachKind(file) === 'pdf' && file.size > ATT_TARGET;
    schedule(a); return a;
  }
  function removeAtt(a) {
    const i = atts.indexOf(a); if (i < 0 || busy) return;
    atts.splice(i, 1); a.removed = true; if (a.ref) discard(a.ref.id);
    if (a.kind === 'main') {
      scanRun += 1; pdf = null; fileLine.replaceChildren(); preview.replaceChildren(); foundBox.replaceChildren();
      if (step === 'read') { status.textContent = ''; scanSteps.hidden = true; drop.hidden = false; scanBtns.hidden = false; setStep('dup'); }
    }
    paintAtt();
  }
  /** Extra attachments (not read). Returns how many were added. */
  function addExtras(list, o = {}) {
    let added = 0;
    for (const f of list) {
      if (atts.length >= ATT_MAX) { toast(`แนบได้สูงสุด ${ATT_MAX} ไฟล์ต่อหนังสือ`, 'info', 5000); break; }
      const k = attachKind(f);
      if (!k) { toast(`“${f.name}” แนบไม่ได้ — รองรับ PDF รูป JPG/PNG/WebP และไฟล์ Word/Excel/PowerPoint`, 'error', 6000); continue; }
      if (k !== 'pdf' && f.size > ATT_LIMIT) { toast(`“${f.name}” ใหญ่เกิน 10 MB`, 'error', 6000); continue; }
      if (atts.some((a) => a.name === f.name && a.size === f.size)) { toast(`“${f.name}” แนบไว้แล้ว`, 'info', 4000); continue; }
      addAtt(f, 'extra', o); added += 1;
    }
    return added;
  }
  extraIn.addEventListener('change', () => { const l = [...(extraIn.files || [])]; extraIn.value = ''; if (!busy && l.length) addExtras(l); });

  /* ---- steps 1–2: import (file / camera) → automatic reading ---- */
  const fileIn = h('input', { type: 'file', accept: '.pdf,.docx,.xlsx,.pptx,image/*', multiple: true, hidden: true });
  const camIn = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true });   // fallback where getUserMedia is unavailable
  const status = h('p', { class: 'muted sar-status', role: 'status', 'aria-live': 'polite' });
  const manual = () => { status.textContent = ''; setStep('dup'); F.subject.focus(); };   // an attached file stays attached
  async function useCamera() {
    if (!cameraSupported()) { camIn.click(); return; }
    try { const shots = await openScanner(); if (shots && shots.length) pickFiles(shots); } catch (e) { toast(cameraErrorText(e), 'error', 7000); if (e && e.name !== 'NotAllowedError') camIn.click(); }
  }
  const pick = h('label', { class: 'btn btn-primary' }, svgIcon(ICONS.upload, 18), 'เลือกไฟล์', fileIn);
  const drop = h('div', { class: 'sar-drop sar-dz', tabindex: '0', role: 'group', 'aria-label': 'นำเข้าหนังสือ' },
    h('div', { class: 'sar-dz-ic' }, svgIcon(ICONS.upload, 34)),
    h('strong', null, 'ลากไฟล์หนังสือมาวางที่นี่'),
    h('span', { class: 'muted' }, 'PDF หรือรูปสแกน/ภาพถ่าย (หลายรูป = หลายหน้า) · แนบเข้าทะเบียนทันที พร้อมอ่านข้อมูลจาก 3 หน้าแรก · ไฟล์ Word/Excel แนบเป็นไฟล์เพิ่มได้'),
    h('div', { class: 'sar-dz-actions' }, h('button', { class: 'btn', type: 'button', dataset: { act: 'scan' }, onclick: useCamera }, 'สแกนด้วยกล้อง'), pick),
    h('button', { class: 'sar-linkbtn', type: 'button', onclick: manual }, 'กรอกข้อมูลเอง (ไม่มีไฟล์)'));
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  drop.addEventListener('dragleave', (e) => { e.preventDefault(); drop.classList.remove('over'); });
  drop.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); drop.classList.remove('over'); document.body.classList.remove('dragging'); if (busy) return; const fs = e.dataTransfer && e.dataTransfer.files; if (fs && fs.length) pickFiles(fs); });
  const bullets = h('ul', { class: 'sar-dz-feat' }, ['แนบไฟล์เข้าทะเบียนทันทีที่วาง (ไม่ใช่แค่อ่าน)', 'อ่านเฉพาะ 3 หน้าแรก — PDF / OCR ภาษาไทย (ในเครื่อง)', 'เติมเลขที่ เรื่อง จาก เรียน กำหนด ให้เอง', 'ตรวจหนังสือซ้ำ · ออกเลขรับและประทับตราบนหน้าจริง'].map((t) => h('li', null, svgIcon(ICONS.check, 16), t)));
  const scanSteps = h('ol', { class: 'sar-scan-steps', hidden: true }, ['เตรียม + แนบไฟล์', 'อ่านข้อความ 3 หน้าแรก (PDF/OCR)', 'จัดข้อมูลลงแบบฟอร์ม'].map((l) => h('li', null, l)));
  const scanBtns = h('div', { class: 'sar-scan-more' }, bullets);
  scanCard.append(drop, scanSteps, status, scanBtns, camIn);
  function markScan(i) { [...scanSteps.children].forEach((li, j) => { li.classList.toggle('done', j < i); li.classList.toggle('now', j === i); }); }

  /* ---- step 2: check / edit ---- */
  const fileLine = h('p', { class: 'sar-fileline' }); const foundBox = h('div', { class: 'sar-found' }); const preview = h('div', { class: 'sar-preview' });
  const dupBox = h('div', { 'aria-live': 'polite' });
  const dupCheck = debounce(async () => {
    const subject = F.subject.value.trim(); if (subject.length < 4) { dupBox.replaceChildren(); return; }
    try {
      const r = await X.call('dup', { subject, docNo: F.docNo.value, party: F.party.value, inboxId });
      dupBox.replaceChildren(r.items.length ? notice('warn', `พบหนังสือที่เหมือนกัน ${r.items.length} รายการ`, r.items.map((d) => `${d.reg ? `เลขรับ ${d.reg}` : 'รออยู่ในคิว'} — ${d.docNo || ''} ${d.subject}`).join(' | ')) : null);
      suggestions = r.suggest || [];
    } catch { /* the check is advisory */ }
  }, 600);
  const autoMark = (found) => Object.entries(F).forEach(([k, el]) => el.classList.toggle('sar-auto', !!found[k] && !!el.value));
  function paintFound(found, note) {
    const keys = ['docNo', 'docDate', 'subject', 'party', 'salut']; const n = keys.filter((k) => found[k]).length;
    foundBox.replaceChildren(h('div', { class: 'sar-found-h' }, h('strong', null, 'ผลการอ่านอัตโนมัติ'), badge(`${n}/${keys.length} รายการหลัก`, n >= 4 ? 'ok' : n >= 2 ? 'warn' : 'bad')),
      h('div', { class: 'sar-found-chips' }, [...keys, 'urgency', 'due', 'refs'].filter((k) => found[k] || keys.includes(k)).map((k) => h('span', { class: `sar-chip ${found[k] ? 'ok' : 'miss'}`, title: found[k] ? 'อ่านได้ — โปรดตรวจทาน' : 'อ่านไม่พบ — กรอกเอง' }, `${found[k] ? '✓' : '–'} ${SCAN_FIELD_LABELS[k]}`))), note ? h('p', { class: 'hint' }, note) : null);
  }
  function setPreview(files) {
    if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = ''; }
    const img = [...files].find((f) => /^image\//.test(f.type));
    if (img) previewUrl = URL.createObjectURL(img);
    preview.replaceChildren(previewUrl ? h('img', { src: previewUrl, alt: 'ตัวอย่างหน้าแรกของหนังสือ', class: 'sar-preview-img' }) : svgIcon(ICONS.file, 40), h('div', { class: 'muted sar-sub' }, pdf ? `${pdf.name} · ${(pdf.size / 1048576).toFixed(2)} MB${files.length > 1 ? ` · ${files.length} หน้า` : ''}` : ''));
  }
  /** @param {File[]|FileList} list @param {{fromQueue?:boolean}} [o] fromQueue: the file is the queue item's own copy (the backend attaches it already, so it is only read) */
  async function pickFiles(list, o = {}) {
    const files = [...(list || [])].filter(Boolean); if (!files.length || busy) return;
    const sp = splitDrop(files); const from = o.fromQueue ? 'queue' : '';
    if (sp.rejected.length) toast(`แนบ ${sp.rejected.map((f) => `“${f.name}”`).slice(0, 2).join(', ')}${sp.rejected.length > 2 ? ` และอีก ${sp.rejected.length - 2} ไฟล์` : ''} ไม่ได้ — รองรับ PDF รูป JPG/PNG/WebP และไฟล์ Word/Excel/PowerPoint`, 'error', 7000);
    if (!sp.main) {                                                   // nothing to read: the files are attached and the clerk types the data
      const n = addExtras(sp.extras, { from });
      if (n) { toast(`แนบไฟล์แล้ว ${n} ไฟล์ — ไฟล์ Word/Excel อ่านข้อมูลอัตโนมัติไม่ได้ กรุณากรอกข้อมูลเอง`, 'success', 6000); if (step === 'import') manual(); }
      return;
    }
    const run = ++scanRun; scanSteps.hidden = false; drop.hidden = true; scanBtns.hidden = true; markScan(0); status.textContent = 'กำลังเตรียมไฟล์…'; setStep('read');
    let found = {}; let note = '';
    try {
      const built = await toPdfFile(sp.main); if (run !== scanRun) return;
      pdf = built;
      const old = atts.find((a) => a.kind === 'main');               // a new letter file replaces the previous one (its upload is discarded; a queue item's own copy stays attached)
      if (old) { if (old.from === 'queue') old.kind = 'extra'; else { atts.splice(atts.indexOf(old), 1); old.removed = true; if (old.ref) discard(old.ref.id); } }
      addAtt(pdf, 'main', { from }); addExtras(sp.extras, { from });   // attached NOW, while the page is still being read
      fileLine.replaceChildren(svgIcon(ICONS.file, 18), `${pdf.name} · ${mbText(pdf.size)}`); setPreview(sp.main);
      markScan(1); status.textContent = `กำลังอ่านข้อมูลจาก ${READ_MAX_PAGES} หน้าแรกของหนังสือ (ในเครื่อง ไม่ส่งออกอินเทอร์เน็ต)…`;
      const rd = await readLetter(pdf, sp.main, (s2) => { if (run === scanRun) status.textContent = s2; }); if (run !== scanRun) return;
      markScan(2); const r = parseLetter(rd.text);
      const set = (k, v) => { if (v && (!F[k].value.trim() || !touched.has(k))) F[k].value = v; };    // a re-scan never overwrites what the clerk typed
      ['docNo', 'docDate', 'subject', 'party', 'salut', 'refs', 'encl', 'due'].forEach((k) => set(k, r[k]));
      if (!r.due && r.dueDays) set('due', addDays(today, r.dueDays));
      if (r.urgency !== 'normal') F.urgency.value = r.urgency; if (r.secrecy !== 'normal') F.secrecy.value = r.secrecy;
      found = r.found; autoMark(found); const n = Object.keys(found).length;
      const pageNote = rd.pages > READ_MAX_PAGES ? `อ่านจาก ${READ_MAX_PAGES} หน้าแรก (ไฟล์มี ${rd.pages} หน้า — แนบครบทุกหน้า) · ` : '';
      note = n ? `${pageNote}ตรวจทานช่องที่ไฮไลต์สีให้ถูกต้อง แก้ไขได้ทุกช่องก่อนกดยืนยัน` : `${pageNote}อ่านข้อความจากไฟล์ไม่ได้ (อาจเป็นภาพไม่ชัด) — กรอกข้อมูลเองได้ ไฟล์ยังแนบอยู่ตามปกติ`;
      if (r.secrecy !== 'normal') toast('พบคำว่าชั้นความลับในหนังสือ — ตรวจสอบและให้เจ้าหน้าที่ที่ได้รับอนุญาตลงรับ', 'error', 6000);
      dupCheck.flush();
    } catch (e) {
      if (run !== scanRun) return;
      if (!pdf) { drop.hidden = false; scanBtns.hidden = false; scanSteps.hidden = true; status.textContent = `${errText(e)}`; setStep('import'); return; }
      note = `${errText(e)} — กรอกข้อมูลเองได้ ไฟล์ยังแนบอยู่ตามปกติ`;           // reading failed, the attachment did not
    }
    status.textContent = ''; scanSteps.hidden = true; drop.hidden = false; scanBtns.hidden = false; paintFound(found, note); setStep('dup');
    checkCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  fileIn.addEventListener('change', () => { const fs = fileIn.files; const l = fs ? [...fs] : []; fileIn.value = ''; pickFiles(l); });
  camIn.addEventListener('change', () => { const fs = camIn.files; const l = fs ? [...fs] : []; camIn.value = ''; pickFiles(l); });
  /* a queue item (Telegram / e-mail copy kept in Drive): fetch its file and read it exactly like an upload */
  async function loadQueueFile() {
    status.textContent = 'กำลังดึงไฟล์จากคิว…'; scanSteps.hidden = false; markScan(0);
    try {
      const r = await X.call('queuefile', { inboxId }, 60000);
      const bin = atob(r.data); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i += 1) u8[i] = bin.charCodeAt(i);
      await pickFiles([new File([u8], r.name || 'queue.pdf', { type: r.mime })], { fromQueue: true });
    } catch (e) {
      status.textContent = ''; scanSteps.hidden = true; paintFound({}, `${errText(e)} — ตรวจข้อมูลจากคิวและแก้ไขได้ หรืออัปโหลดไฟล์เอง`); setStep('dup');
    }
  }

  const grid = h('div', { class: 'sar-grid' },
    text('docNo', 'เลขที่หนังสือ', 'เช่น สธ 0123.4/ว567').root, mk('docDate', 'ลงวันที่', h('input', { type: 'date', value: pre.docDate || '' })).root,
    h('div', { class: 'sar-span' }, mk('subject', 'เรื่อง *', h('textarea', { rows: 2, maxlength: 300, value: pre.subject || '' })).root),
    text('party', 'จาก (หน่วยงานผู้ส่ง) *', 'เช่น สำนักงานสาธารณสุขจังหวัด…', 160).root, text('salut', 'เรียน', 'เช่น ผู้อำนวยการโรงพยาบาล…', 160).root,
    sel('urgency', 'ชั้นความเร็ว', URGENCY).root, sel('secrecy', 'ชั้นความลับ', SECRECY).root,
    mk('due', 'กำหนดเสร็จ / ตอบกลับภายใน', h('input', { type: 'date' }), 'ถ้าไม่ระบุ ระบบกำหนดตามชั้นความเร็ว (นับวันทำการ) เมื่อส่งต่อ').root,
    mk('cat', 'หมวดเรื่อง', h('select', null, opt('', '— ไม่ระบุ —'), X.cfg.categories.map(([k, l]) => opt(k, l)))).root,
    mk('channel', 'ช่องทางที่ได้รับ', h('select', null, X.cfg.channels.map(([k, l]) => opt(k, l, k === (pre.channel || (pdf ? 'scan' : 'esaraban')))))).root,
    text('deliverer', 'ผู้นำส่ง (ถ้ามี)', 'ชื่อผู้นำหนังสือมาส่ง', 80).root,
    h('div', { class: 'sar-span' }, mk('refs', 'อ้างถึง', h('textarea', { rows: 2, maxlength: 400 })).root), h('div', { class: 'sar-span' }, mk('encl', 'สิ่งที่ส่งมาด้วย', h('textarea', { rows: 2, maxlength: 400 })).root),
    h('div', { class: 'sar-span' }, mk('note', 'หมายเหตุ', h('input', { type: 'text', maxlength: 500 })).root));
  if (X.cfg.units.some((u) => u.registry)) {
    const regSel = mk('registry', 'ลงทะเบียนรับของ', h('select', null, opt('central', 'สารบรรณกลาง'), X.cfg.units.filter((u) => u.registry && u.active).map((u) => opt(u.code, u.name))));
    grid.append(regSel.root);
    const want = pre.registry || (X.defaultRegistry ? X.defaultRegistry() : 'central');
    if ([...regSel.input.options].some((o) => o.value === want)) regSel.input.value = want;
    regSel.input.addEventListener('change', () => { if (X.rememberRegistry) X.rememberRegistry(regSel.input.value); });
  }
  ['subject', 'docNo', 'party'].forEach((k) => F[k].addEventListener('input', dupCheck));
  F.docNo.value = pre.docNo || ''; F.subject.value = pre.subject || ''; F.party.value = pre.party || ''; F.docDate.value = pre.docDate || ''; touched.clear();

  const prog = progressPanel(['ตรวจไฟล์แนบ', 'ออกเลขรับ', 'ประทับตราและแนบ']); const status2 = prog.detail;
  const submit = h('button', { class: 'btn btn-primary btn-lg', type: 'button', onclick: () => go(false) }, svgIcon(ICONS.check, 20), 'ยืนยันข้อมูลและออกเลขรับ');
  async function go(dupOk) {
    if (busy) return;
    const v = (k) => (F[k].value || '').trim();
    if (!v('subject')) { F.subject.focus(); toast('กรุณาระบุเรื่อง', 'info'); return; }
    if (!v('party')) { F.party.focus(); toast('กรุณาระบุผู้ส่ง (จาก)', 'info'); return; }
    if (v('secrecy') !== 'normal' && !X.cfg.me.clear) { toast('หนังสือชั้นความลับต้องลงรับโดยเจ้าหน้าที่ที่ได้รับอนุญาตเท่านั้น', 'error', 6000); return; }
    if (atts.some((a) => a.state === 'err')) { toast('มีไฟล์แนบที่แนบไม่สำเร็จ — กด “ลองใหม่” หรือ “เอาออก” ที่รายการไฟล์แนบก่อน', 'error', 7000); attCard.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    busy = true; submit.disabled = true; submit.classList.add('is-loading'); setStep('number'); prog.show(0, attBusy() ? 'กำลังแนบไฟล์ให้เสร็จ…' : 'ไฟล์แนบเรียบร้อย'); drop.classList.add('is-busy'); paintAtt();
    try {
      await chain;                                                     // every file is attached before a number is issued
      const bad = atts.find((a) => a.state !== 'done'); if (bad) throw Object.assign(new Error(`แนบไฟล์ “${bad.name}” ไม่สำเร็จ${bad.err ? ` — ${bad.err}` : ''} · กด “ลองใหม่” หรือ “เอาออก”`), { code: 'ATTACH' });
      const files = atts.filter((a) => a.ref && a.from !== 'queue').map((a) => ({ id: a.ref.id }));
      prog.show(1, 'กำลังออกเลขรับ…');
      const body = { rid, dupOk, inboxId, files, route: { mode: 'none' }, ...Object.fromEntries(Object.keys(F).map((k) => [k, v(k)])) };
      const r = await X.call('receive', body, 40000);
      if (r.needsConfirm) {
        busy = false; submit.disabled = false; submit.classList.remove('is-loading'); prog.hide(); drop.classList.remove('is-busy'); setStep('dup'); paintAtt();
        let m = null;
        m = modal('พบหนังสือที่เหมือนกัน', [h('p', null, 'ระบบพบหนังสือเลขที่/เรื่อง/ผู้ส่งเดียวกันที่ลงรับหรืออยู่ในคิวแล้ว:'), h('ul', null, r.dups.map((d) => h('li', null, `${d.reg ? `เลขรับ ${d.reg}` : 'อยู่ในคิว'} — ${d.docNo || '-'} · ${d.subject}`))), h('p', { class: 'muted' }, 'ถ้าเป็นฉบับเดียวกัน ไม่ควรลงรับซ้ำ — เลขรับจะถูกใช้ไปและยกเลิกได้เฉพาะพร้อมเหตุผล')],
          [h('button', { class: 'btn btn-danger', type: 'button', onclick: () => { m.close(); go(true); } }, 'ลงรับซ้ำจริง ๆ'), h('button', { class: 'btn btn-primary', type: 'button', onclick: () => m.close() }, 'ยกเลิก ไม่ลงรับ')]);
        return;
      }
      await done(r);
    } catch (e) {
      busy = false; submit.disabled = false; submit.classList.remove('is-loading'); prog.hide(); drop.classList.remove('is-busy'); setStep('dup'); paintAtt();
      if (e && (e.code === 'NETWORK' || e.code === 'TIMEOUT' || e.code === 'BAD_RESPONSE')) toast('ไม่แน่ใจว่าบันทึกสำเร็จหรือไม่ — กด “ยืนยัน” อีกครั้งได้เลย ระบบจะไม่ออกเลขซ้ำ', 'error', 8000);
      else toast(errText(e), 'error', 7000);
    }
  }

  /* ---- steps 3 + 4: number issued → stamp → forward ---- */
  async function done(r) {
    registered = true;                                                  // the files now belong to a letter: nothing is discarded any more
    const d = r.doc; let stampBlob = null; let stampMsg = ''; let stampRetry = false;
    const stampName = `${d.reg.replace('/', '-')}_ประทับตรารับ.pdf`;
    const mainAtt = atts.find((a) => a.kind === 'main'); const src = mainAtt ? mainAtt.file : pdf;   // stamp the copy that is stored (≤ 10 MB), not the oversized original
    const attachStamp = () => upload(X, new File([stampBlob], stampName, { type: 'application/pdf' }), { kind: 'in', docId: d.id, label: 'ฉบับประทับตรารับ' });
    if (src && !r.replay) {
      try { prog.show(2, 'กำลังประทับตรารับและแนบไฟล์…'); stampBlob = await stampReceive(src, r.stamp); await attachStamp(); stampMsg = 'แนบฉบับประทับตรารับในทะเบียนแล้ว'; } catch (e) { stampRetry = !!stampBlob; stampMsg = `ประทับตราไม่สำเร็จ: ${errText(e)} (ลงรับเรียบร้อยแล้ว${stampRetry ? ' — กด “ลองแนบฉบับประทับตราอีกครั้ง”' : ' — แนบไฟล์ได้ที่หน้ารายละเอียด'})`; }
    }
    prog.hide(); drop.classList.remove('is-busy'); checkCard.hidden = true;
    const stampLine = h('p', { class: 'muted' }, stampMsg);
    const retryBtn = stampRetry ? h('button', { class: 'btn', type: 'button', onclick: async () => { retryBtn.disabled = true; try { await attachStamp(); stampLine.textContent = 'แนบฉบับประทับตรารับในทะเบียนแล้ว'; retryBtn.remove(); } catch (e) { retryBtn.disabled = false; toast(errText(e), 'error', 7000); } } }, 'ลองแนบฉบับประทับตราอีกครั้ง') : null;
    const nFiles = atts.filter((a) => a.state === 'done').length;
    resultCard.replaceChildren(h('div', { class: 'card sar-done' }, h('div', { class: 'sar-bignum' }, h('span', { class: 'muted' }, r.replay ? 'ลงรับไว้แล้ว (ไม่ออกเลขซ้ำ)' : 'ลงรับสำเร็จ — เลขรับ'), h('strong', null, d.reg)),
      h('p', null, `${r.stamp.registry} · ${r.stamp.date} เวลา ${r.stamp.time}`), h('p', { class: 'muted' }, `รหัสตรวจสอบ ${r.verify} (ใช้ค้นหาในหน้า “ติดตาม”)`),
      nFiles ? h('p', { class: 'muted' }, `แนบไฟล์ในทะเบียนแล้ว ${nFiles} ไฟล์${stampMsg.startsWith('แนบฉบับ') ? ' + ฉบับประทับตรารับ' : ''}`) : null,
      ...(r.warnings || []).map((w) => notice('warn', 'ข้อควรตรวจสอบ', w)), r.jumped ? notice('warn', 'เลขรับข้ามลำดับ', 'เลขที่ระบุข้ามจากเลขล่าสุด — ดูช่องว่างได้ที่หน้า “เลขทะเบียน”') : null,
      stampMsg ? stampLine : null,
      stampBlob || retryBtn ? h('div', { class: 'btn-row' }, stampBlob ? h('button', { class: 'btn', type: 'button', onclick: () => download(stampBlob, stampName) }, svgIcon(ICONS.download, 18), 'ดาวน์โหลดไฟล์ที่ประทับตรา') : null, retryBtn) : null));
    attCard.hidden = true;
    fwdCard.replaceChildren(forwardPanel(d, stampBlob)); setStep('forward');
    resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  /** Step 4: which unit gets the letter next. Uses the normal `route` op on the new letter, so history, due dates and file sharing work as everywhere else. */
  function forwardPanel(d, stampBlob) {
    const st = {}; const picker = unitPicker(X, st); const msg = h('input', { type: 'text', maxlength: 400, placeholder: 'ข้อความถึงผู้รับ (ถ้ามี) เช่น โปรดดำเนินการและรายงานผล' });
    const execs = X.cfg.units.filter((u) => u.type === 'exec' && u.active); const chips = h('div', { class: 'chip-row' });
    const uname = (c) => { const u = X.cfg.units.find((x) => x.code === c); return u ? u.short || u.name : c; };
    suggestions.slice(0, 4).forEach((g) => chips.append(h('button', { class: 'chip sar-sug', type: 'button', title: `พบคำว่า ${g.why.join(', ')} ในเรื่อง`, onclick: () => st.tick([g.unit]) }, `แนะนำ: ${g.name}`)));
    if (execs.length) chips.append(h('button', { class: 'chip', type: 'button', onclick: () => st.tick([execs[0].code]) }, `เสนอ${execs[0].short || 'ผู้บริหาร'}`));
    const out = h('div');
    const next = h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: () => X.refresh('receive') }, 'รับหนังสือฉบับต่อไป'), h('button', { class: 'btn', type: 'button', onclick: () => X.openDoc(d.id) }, 'เปิดรายละเอียด'), stampBlob ? h('button', { class: 'btn', type: 'button', onclick: () => download(stampBlob, `${d.reg.replace('/', '-')}_ประทับตรารับ.pdf`) }, 'ดาวน์โหลดไฟล์ประทับตรา') : null);
    const panel = h('div', { class: 'card sar-fwd' }, h('h3', { class: 'sar-h3' }, `ส่งหนังสือเลขรับ ${d.reg} ต่อให้หน่วยงานใด`), h('p', { class: 'muted' }, 'เลือกหน่วยงานที่จะรับเรื่อง พร้อมเลือก “เพื่อดำเนินการ/เพื่อทราบ” และกำหนดเสร็จ — หน่วยงานจะเห็นในหน้า “งานของฉัน” ถ้ายังไม่แน่ใจ ข้ามไปก่อนแล้วส่งต่อภายหลังได้'), chips.childNodes.length ? chips : null, picker, field('ข้อความถึงผู้รับ', msg).root);
    const sendBtn = h('button', { class: 'btn btn-primary btn-lg', type: 'button', onclick: async () => {
      const toUnits = st.pick(); if (!toUnits.length) { toast('เลือกหน่วยงานอย่างน้อย 1 หน่วย', 'info'); return; }
      try { sendBtn.disabled = true; sendBtn.classList.add('is-loading'); const r = await X.call('route', { id: d.id, kind: 'forward', text: msg.value, toUnits }, 60000);
        panel.replaceChildren(notice('success', 'ส่งต่อหนังสือแล้ว', `เลขรับ ${d.reg} → ${(r.routed || toUnits).map((t) => uname(t.unit || t)).join(', ')}`), next); toast('ส่งต่อแล้ว', 'success');
      } catch (e) { sendBtn.disabled = false; sendBtn.classList.remove('is-loading'); toast(errText(e), 'error', 7000); }
    } }, svgIcon(ICONS.check, 20), 'ส่งต่อหนังสือ');
    const later = h('button', { class: 'btn', type: 'button', onclick: () => panel.replaceChildren(notice('info', 'ลงรับเรียบร้อย — ยังไม่ส่งต่อ', 'ส่งต่อได้ภายหลังที่ “รายละเอียดหนังสือ → ส่งต่อหนังสือ”'), next) }, 'ยังไม่ส่งต่อ ข้ามไปก่อน');
    panel.append(h('div', { class: 'btn-row sar-submit' }, sendBtn, later), out);
    return panel;
  }

  /** Start over: files already uploaded for this unregistered letter are removed from Drive first (a registered letter keeps its files). */
  function clearForm() { if (busy) return; if (!registered) atts.forEach((a) => { a.removed = true; if (a.ref && a.from !== 'queue') discard(a.ref.id); }); X.refresh('receive'); }
  checkCard.append(h('div', { class: 'sar-check-top' }, h('div', { class: 'sar-check-file' }, preview, fileLine, h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { scanRun += 1; drop.hidden = false; scanBtns.hidden = false; scanSteps.hidden = true; status.textContent = ''; setStep('import'); } }, 'เปลี่ยนไฟล์หนังสือ / สแกนใหม่'))), foundBox), dupBox, grid,
    h('div', { class: 'btn-row sar-submit' }, submit, h('button', { class: 'btn', type: 'button', onclick: clearForm }, 'ล้างแบบฟอร์ม')), prog.root);
  root.append(privacyNotice({ detail: 'หนังสือราชการอาจมีชื่อ-ข้อมูลผู้ป่วย ไฟล์ที่วางจะถูกแนบเข้า Google Drive ของหน่วยงาน (โฟลเดอร์ _saraban) เฉพาะเจ้าหน้าที่ที่ได้รับสิทธิ์ — การอ่านข้อความด้วย OCR ทำบนเครื่องของคุณ ไม่ส่งออกอินเทอร์เน็ต' }), stepper, scanCard, attCard, checkCard, resultCard, fwdCard);
  paintAtt();
  if (pre.inboxId) {
    checkCard.prepend(notice('info', 'ลงรับจากคิว', 'ระบบดึงไฟล์จากคิวมาอ่านให้อัตโนมัติ — ตรวจทานและแก้ไขได้ทุกช่องก่อนกดยืนยัน'));
    setTimeout(() => dupCheck.flush(), 50);
    setStep(step); loadQueueFile();
  } else setStep(step);
}

/* ============================== SEND ============================== */

export function sendView(root, X, pre = {}) {
  let rid = newRid(); let busy = false; const parties = []; const F = {};
  const mk = (name, label, input, hint) => { F[name] = input; return field(label, input, hint); };
  const list = h('div', { class: 'sar-parties' }); const dl = h('datalist', { id: 'sar-parties-dl' }); const result = h('div'); const status = h('p', { class: 'muted sar-status', role: 'status' });
  const fetchParties = debounce(async (q, cb) => { if (q.length < 1) return; try { const r = await X.call('parties', { q }); dl.replaceChildren(...r.items.map((p) => h('option', { value: p.name }))); cb(r.items); } catch { /* optional */ } }, 300);
  function addParty(p = {}) {
    const name = h('input', { type: 'text', list: 'sar-parties-dl', maxlength: 160, placeholder: 'ชื่อผู้รับ/หน่วยงาน *', value: p.name || '', autocomplete: 'off' });
    const ch = h('select', { 'aria-label': 'ช่องทางส่ง' }, X.cfg.channels.filter(([k]) => !['scan', 'telegram'].includes(k)).map(([k, l]) => opt(k, l, k === (p.channel || 'esaraban'))));
    const email = h('input', { type: 'email', maxlength: 120, placeholder: 'อีเมลผู้รับ', value: p.email || '' }); const track = h('input', { type: 'text', maxlength: 40, placeholder: 'เลขพัสดุ EMS/ไปรษณีย์ (ถ้ามี)' }); const recv = h('input', { type: 'text', maxlength: 80, placeholder: 'ผู้รับเอกสาร (ส่งด้วยตนเอง)' });
    const rm = h('button', { class: 'btn btn-sm', type: 'button', 'aria-label': 'ลบผู้รับ', onclick: () => { parties.splice(parties.indexOf(ent), 1); row.remove(); } }, svgIcon(ICONS.trash, 16));
    const sync = () => { email.hidden = ch.value !== 'email'; track.hidden = !['ems', 'post'].includes(ch.value); recv.hidden = !['hand', 'messenger'].includes(ch.value); };
    ch.addEventListener('change', sync); sync();
    name.addEventListener('input', () => fetchParties(name.value.trim(), (items) => { const hit = items.find((i) => i.name === name.value); if (hit) { if (hit.email && !email.value) email.value = hit.email; if (hit.channel && [...ch.options].some((o) => o.value === hit.channel)) { ch.value = hit.channel; sync(); } } }));
    const row = h('div', { class: 'sar-party' }, name, ch, email, track, recv, rm); const ent = { name, ch, email, track, recv }; parties.push(ent); list.append(row);
  }
  addParty();

  const typeSel = mk('bookType', 'ประเภทหนังสือ', h('select', null, opt('normal', 'หนังสือภายนอก (ที่ …/เลขส่ง)'), opt('circular', 'หนังสือเวียน (ที่ …/ว …)')));
  const mode = h('div', { class: 'sar-seg' }); let reserveOnly = false; const subjectField = mk('subject', 'เรื่อง *', h('textarea', { rows: 2, maxlength: 300 }));
  const purpose = mk('purpose', 'จองเลขเพื่อเรื่อง *', h('input', { type: 'text', maxlength: 200, placeholder: 'เช่น หนังสือขอทุนวิจัย (ร่างอยู่ระหว่างเสนอ)' }), 'เลขที่จองไว้ต้องใช้หรือยกเลิกพร้อมเหตุผล — ระบบเตือนเมื่อค้างเกินกำหนด');
  const sendBox = h('div'); const reserveBox = h('div', { hidden: true });
  const fileIn = h('input', { type: 'file', accept: 'application/pdf,image/*,.docx,.xlsx,.pptx' });
  const replyIn = h('input', { type: 'text', placeholder: 'เลขรับของหนังสือที่ตอบ เช่น 125 หรือ 125/2569' }); let replyTo = ''; const replyInfo = h('p', { class: 'hint' });
  replyIn.addEventListener('change', async () => { replyTo = ''; replyInfo.textContent = ''; const q = replyIn.value.trim(); if (!q) return; try { const r = await X.call('track', { q }); const hit = r.items.find((i) => i.kind === 'in' && i.exact) || r.items.find((i) => i.kind === 'in'); if (hit) { replyTo = hit.id; replyInfo.textContent = `ตอบหนังสือเลขรับ ${hit.reg}: ${hit.subject}`; if (!F.subject.value && !hit.masked) F.subject.value = `ตอบ ${hit.subject}`.slice(0, 300); } else replyInfo.textContent = 'ไม่พบเลขรับนี้'; } catch (e) { replyInfo.textContent = errText(e); } });
  [['send', 'ออกเลขและส่งหนังสือ'], ['reserve', 'จองเลขไว้ก่อน']].forEach(([k, l]) => {
    const b = h('button', { type: 'button', role: 'radio', class: (k === 'reserve') === reserveOnly ? 'on' : '', 'aria-checked': String((k === 'reserve') === reserveOnly), onclick: () => { reserveOnly = k === 'reserve'; [...mode.children].forEach((x) => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', String(on)); }); sendBox.hidden = reserveOnly; reserveBox.hidden = !reserveOnly; } }, l);
    if (!pre.reserved || k === 'send') mode.append(b);
  });
  sendBox.append(
    h('div', { class: 'sar-grid' }, subjectField.root && h('div', { class: 'sar-span' }, subjectField.root), mk('docDate', 'ลงวันที่', h('input', { type: 'date', value: X.cfg.today })).root, typeSel.root,
      mk('urgency', 'ชั้นความเร็ว', h('select', null, Object.entries(URGENCY).map(([k, l]) => opt(k, l)))).root, mk('secrecy', 'ชั้นความลับ', h('select', null, Object.entries(SECRECY).map(([k, l]) => opt(k, l)))).root,
      mk('cat', 'หมวดเรื่อง', h('select', null, opt('', '— ไม่ระบุ —'), X.cfg.categories.map(([k, l]) => opt(k, l)))).root,
      h('div', { class: 'sar-span' }, field('ตอบหนังสือรับเลขที่ (ถ้ามี)', replyIn, 'ระบบบันทึกว่าตอบแล้ว และโยงประวัติให้').root, replyInfo),
      h('div', { class: 'sar-span' }, mk('refs', 'อ้างถึง', h('input', { type: 'text', maxlength: 400 })).root), h('div', { class: 'sar-span' }, mk('encl', 'สิ่งที่ส่งมาด้วย', h('input', { type: 'text', maxlength: 400 })).root)),
    h('h3', { class: 'sar-h3' }, 'ผู้รับและช่องทางส่ง'), dl, list, h('button', { class: 'btn btn-sm', type: 'button', onclick: () => addParty() }, svgIcon(ICONS.plus, 16), 'เพิ่มผู้รับ'),
    h('h3', { class: 'sar-h3' }, 'ไฟล์หนังสือ (ถ้ามี)'), fileIn);
  const rType = h('select', null, opt('normal', 'หนังสือภายนอก (ที่ …/เลขส่ง)'), opt('circular', 'หนังสือเวียน (ที่ …/ว …)'));
  reserveBox.append(purpose.root, field('ประเภทหนังสือ', rType).root);
  const regSel = X.cfg.units.some((u) => u.registry) ? mk('registry', 'ทะเบียนส่งของ', h('select', null, opt('central', 'สารบรรณกลาง'), X.cfg.units.filter((u) => u.registry && u.active).map((u) => opt(u.code, u.name)))) : null;
  if (regSel) {
    const want = pre.registry || (X.defaultRegistry ? X.defaultRegistry() : 'central');
    if ([...regSel.input.options].some((o) => o.value === want)) regSel.input.value = want;
  }
  /* เลขส่ง — พิมพ์เอง (ค่าเริ่มต้น): ระบบเสนอเลขถัดไปให้ในช่อง แก้เป็นเลขอื่นได้ · ติ๊ก "ให้ระบบออกเลขให้" = เลขถัดไปอัตโนมัติ · เลขที่ซ้ำถูกปฏิเสธที่ backend */
  const regVal = () => (regSel ? regSel.input.value : 'central');
  let nx = null; let touched = false; let circTouched = false; let nxTok = 0;
  const noIn = h('input', { type: 'text', inputmode: 'numeric', maxlength: 12, placeholder: 'เช่น 150', autocomplete: 'off' });
  const circIn = h('input', { type: 'text', maxlength: 12, placeholder: 'เลข ว เช่น 7', autocomplete: 'off' });
  const fullIn = h('input', { type: 'text', maxlength: 80, placeholder: 'เช่น สธ 0312.1/พิเศษ 9 — เว้นว่าง = ใช้รูปแบบปกติ', autocomplete: 'off' }); F.docNo = fullIn;
  const autoCk = h('input', { type: 'checkbox' });
  const noF = field('เลขส่ง (ลำดับในทะเบียนส่ง) *', noIn, 'กำลังตรวจเลขล่าสุด…'); const hintEl = noF.root.querySelector('.hint');
  const circF = field('เลขหนังสือเวียน (ว) *', circIn); circF.root.hidden = true;
  const preview = h('p', { class: 'sar-numprev', 'aria-live': 'polite' });
  function paint() {
    const circ = typeSel.input.value === 'circular', auto = autoCk.checked; circF.root.hidden = !circ || auto;
    const n = auto ? (nx ? String(nx.out) : '…') : (noIn.value.trim() || '…');
    const c = auto ? (nx ? String(nx.circ) : '…') : (circIn.value.trim().replace(/^ว\s*\.?\s*/, '') || '…');
    const tail = circ ? `ว${c}` : n; const full = fullIn.value.trim(); const prefix = nx ? nx.prefix : '';
    preview.textContent = `เลขที่หนังสือที่จะออก: ${full || (prefix ? `${prefix}/${tail}` : tail)} · เลขส่ง ${n}/${X.cfg.year}`;
  }
  async function loadNext() {
    const tok = (nxTok += 1); hintEl.textContent = 'กำลังตรวจเลขล่าสุด…';
    try { const r = await X.call('nextno', { registry: regVal(), year: X.cfg.year }); if (tok !== nxTok) return; nx = r; } catch { if (tok !== nxTok) return; nx = null; hintEl.textContent = 'อ่านเลขล่าสุดไม่ได้ — พิมพ์เลขเอง หรือติ๊ก “ให้ระบบออกเลขให้”'; paint(); return; }
    if (!touched && !autoCk.checked) noIn.value = String(nx.out);
    if (!circTouched && !autoCk.checked) circIn.value = String(nx.circ);
    hintEl.textContent = `เลขส่งถัดไปของทะเบียนนี้คือ ${nx.out} — แก้เป็นเลขอื่นได้ ถ้าเลขนั้นถูกใช้แล้วระบบจะไม่บันทึก`; paint();
  }
  noIn.addEventListener('input', () => { touched = true; paint(); }); circIn.addEventListener('input', () => { circTouched = true; paint(); }); fullIn.addEventListener('input', paint); typeSel.input.addEventListener('change', paint);
  autoCk.addEventListener('change', () => { noIn.disabled = autoCk.checked; circIn.disabled = autoCk.checked; if (autoCk.checked) { noIn.value = ''; circIn.value = ''; } else { touched = false; circTouched = false; if (nx) { noIn.value = String(nx.out); circIn.value = String(nx.circ); } } paint(); });
  if (regSel) regSel.input.addEventListener('change', () => { if (X.rememberRegistry) X.rememberRegistry(regSel.input.value); touched = false; circTouched = false; loadNext(); });
  if (!pre.reserved) {
    sendBox.prepend(h('div', { class: 'sar-numbox' }, h('div', { class: 'sar-grid' }, noF.root, circF.root), h('label', { class: 'sar-check' }, autoCk, h('span', null, 'ให้ระบบออกเลขถัดไปให้เอง (ไม่ต้องพิมพ์)')),
      h('details', { class: 'sar-more' }, h('summary', null, 'พิมพ์เลขที่หนังสือเต็มเอง (รูปแบบพิเศษ)'), field('เลขที่หนังสือ', fullIn, 'ใช้เมื่อเลขที่หนังสือไม่ตรงรูปแบบ “คำนำหน้า/เลขส่ง” — ระบบกันเลขที่ซ้ำให้').root), preview));
    paint(); loadNext();
  }
  const go = h('button', { class: 'btn btn-primary btn-lg', type: 'button', onclick: async () => {
    if (busy) return; const val = (k) => (F[k] ? F[k].value.trim() : '');
    busy = true; go.disabled = true;
    try {
      if (reserveOnly) {
        if (val('purpose').length < 3) { F.purpose.focus(); throw new Error('กรุณาระบุเรื่องที่จองเลข'); }
        const r = await X.call('reserve', { rid, purpose: val('purpose'), bookType: rType.value, registry: regSel ? val('registry') : 'central' });
        return finish(r, true);
      }
      if (!val('subject')) { F.subject.focus(); throw new Error('กรุณาระบุเรื่อง'); }
      const circ = typeSel.input.value === 'circular'; let numbers = {};
      if (!pre.reserved) {
        if (!autoCk.checked) {
          if (!/^\d{1,6}(\/\d{4})?$/.test(noIn.value.trim())) { noIn.focus(); throw new Error('กรุณาพิมพ์เลขส่งเป็นตัวเลข เช่น 150 (หรือติ๊ก “ให้ระบบออกเลขให้”)'); }
          if (circ && !/^(ว\s*\.?\s*)?\d{1,6}$/.test(circIn.value.trim())) { circIn.focus(); throw new Error('กรุณาพิมพ์เลขหนังสือเวียน (ว) เป็นตัวเลข เช่น 7'); }
          numbers = { no: noIn.value.trim(), circNo: circ ? circIn.value.trim() : '' };
        }
        if (fullIn.value.trim()) numbers.docNo = fullIn.value.trim();
      }
      const ps = parties.map((p) => ({ name: p.name.value, channel: p.ch.value, email: p.email.value, trackingNo: p.track.value, receivedBy: p.recv.value })).filter((p) => p.name.trim());
      if (!ps.length) { parties[0].name.focus(); throw new Error('กรุณาระบุผู้รับอย่างน้อย 1 ราย'); }
      const files = []; if (fileIn.files && fileIn.files[0]) { const f = fileIn.files[0]; status.textContent = 'กำลังอัปโหลดไฟล์…'; const u = await upload(X, f, { kind: 'out' }); files.push({ id: u.id }); }
      status.textContent = 'กำลังออกเลข…';
      const r = await X.call('send', { rid, reservedId: pre.reserved ? pre.reserved.id : '', replyTo, files, parties: ps, ...Object.fromEntries(['subject', 'docDate', 'bookType', 'urgency', 'secrecy', 'cat', 'refs', 'encl'].map((k) => [k, val(k)])), ...numbers, registry: regSel ? val('registry') : 'central' }, 40000);
      finish(r, false);
    } catch (e) {
      if (e && (e.code === 'NETWORK' || e.code === 'TIMEOUT' || e.code === 'BAD_RESPONSE')) toast('ไม่แน่ใจว่าบันทึกสำเร็จหรือไม่ — กดอีกครั้งได้ ระบบจะไม่ออกเลขซ้ำ', 'error', 8000); else toast(errText(e), 'error', 7000);
    } finally { busy = false; go.disabled = false; status.textContent = ''; }
  } }, svgIcon(ICONS.check, 20), 'บันทึก');
  function finish(r, reserved) {
    box.hidden = true;
    result.replaceChildren(h('div', { class: 'card sar-done' }, h('div', { class: 'sar-bignum' }, h('span', { class: 'muted' }, reserved ? 'จองเลขแล้ว — เลขส่ง' : r.replay ? 'บันทึกไว้แล้ว — เลขส่ง' : 'ออกเลขสำเร็จ — เลขส่ง'), h('strong', null, r.doc.reg)),
      h('p', null, h('strong', null, 'เลขที่หนังสือ: '), r.docNo), reserved ? h('p', { class: 'muted' }, `ใช้เลขนี้ในร่างหนังสือได้เลย แล้วกลับมาที่หน้า “เลขทะเบียน” เพื่อบันทึกการส่งภายใน ${X.cfg.reserveDays} วัน`) : null, ...((r.warnings || []).map((w) => notice('warn', 'ข้อควรตรวจสอบ', w))),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn', type: 'button', onclick: () => navigator.clipboard && navigator.clipboard.writeText(r.docNo).then(() => toast('คัดลอกเลขที่หนังสือแล้ว', 'success')) }, svgIcon(ICONS.copy, 18), 'คัดลอกเลขที่หนังสือ'), h('button', { class: 'btn', type: 'button', onclick: () => X.openDoc(r.doc.id) }, 'เปิดรายละเอียด'), h('button', { class: 'btn btn-primary', type: 'button', onclick: () => X.refresh('send') }, 'ออกเลขฉบับต่อไป'))));
  }
  const box = h('div', { class: 'card' }, pre.reserved ? notice('info', `ออกหนังสือจากเลขที่จองไว้ ${pre.reserved.reg}`, `เลขที่หนังสือ ${pre.reserved.docNo} — ${pre.reserved.purpose || ''}`) : null, regSel ? regSel.root : null, mode, sendBox, reserveBox, status, h('div', { class: 'btn-row sar-submit' }, go));
  root.append(result, box);
}
