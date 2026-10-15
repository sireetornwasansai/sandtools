import { h, svgIcon, debounce, field } from '../core/dom.js';
import { ICONS } from '../core/icons.js';
import { notice, privacyNotice } from '../core/notices.js';
import { toast } from '../core/toast.js';
import { modal } from '../core/layers.js';
import { URGENCY, SECRECY, parseLetter, plainText, addDays, newRid, fileToBase64 } from './saraban-engine.js';

/** Receive (ลงรับ) and send (ส่งออก) screens. `X` is the shared context from saraban.js: {call, cfg, go, openDoc, refresh}. */

const opt = (value, label, selected) => h('option', { value, selected: selected ? true : null }, label);
const errText = (e) => (e && e.message) || 'ทำรายการไม่สำเร็จ';

/** Letter scan → a PDF File (images are converted so the receive stamp can be applied and everything is stored the same way). */
async function toPdfFile(file) {
  if (/pdf$/i.test(file.type) || /\.pdf$/i.test(file.name)) return file;
  if (/^image\//.test(file.type)) {
    const { imagesToPdf } = await import('./pdf/engine.js');
    const r = await imagesToPdf([{ file }], { size: 'a4', margin: 0, quality: 'balanced' });
    return new File([r.bytes], file.name.replace(/\.[^.]+$/, '') + '.pdf', { type: 'application/pdf' });
  }
  throw new Error('ไฟล์ที่ใช้อ่านข้อมูลได้คือ PDF หรือรูปภาพ (JPG/PNG) — ไฟล์อื่นแนบในภายหลังได้');
}
/** Read the letter on this device (PDF text layer, or on-device OCR for scans). Nothing is sent anywhere. */
async function readLetter(file, onStatus) {
  const { convertFile } = await import('./converters/index.js');
  const r = await convertFile(file, { maxBytes: 15 * 1024 * 1024, timeoutMs: 90000, ocr: true, ocrTimeoutMs: 4 * 60 * 1000, onStatus });
  return plainText(r.markdown);
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

async function upload(X, file, params) {
  const data = await fileToBase64(file);
  return (await X.call('upload', { name: file.name, data, ...params }, 120000)).file;
}
function download(blob, name) { const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 30000); }

export function unitPicker(X, state) {
  const box = h('div', { class: 'sar-units' });
  const units = X.cfg.units.filter((u) => u.active && (u.type === 'internal' || u.type === 'exec'));
  const rows = new Map();
  units.forEach((u) => {
    const cb = h('input', { type: 'checkbox', 'aria-label': u.name });
    const act = h('select', { 'aria-label': `การปฏิบัติของ ${u.short}` }, opt('perform', 'เพื่อดำเนินการ'), opt('ack', 'เพื่อทราบ'));
    const due = h('input', { type: 'date', 'aria-label': `กำหนดของ ${u.short}` });
    const line = h('div', { class: 'sar-unit-row' }, h('label', { class: 'sar-check' }, cb, h('span', null, u.name)), h('div', { class: 'sar-unit-opts' }, act, due));
    line.hidden = false; cb.addEventListener('change', () => { line.classList.toggle('on', cb.checked); }); rows.set(u.code, { cb, act, due, line }); box.append(line);
  });
  state.pick = () => [...rows.entries()].filter(([, r]) => r.cb.checked).map(([unit, r]) => ({ unit, action: r.act.value, due: r.due.value }));
  state.tick = (codes) => rows.forEach((r, code) => { if (codes.includes(code)) { r.cb.checked = true; r.line.classList.add('on'); } });
  return box;
}

/* ============================== RECEIVE ============================== */

export function receiveView(root, X, pre = {}) {
  let pdf = null; let pdfBlobForStamp = null; let rid = newRid(); let inboxId = pre.inboxId || ''; let busy = false;
  const today = X.cfg.today;
  const F = {};
  const mk = (name, label, input, hint) => { F[name] = input; return field(label, input, hint); };
  const text = (name, label, ph, max = 300, hint) => mk(name, label, h('input', { type: 'text', maxlength: max, placeholder: ph || '', autocomplete: 'off', value: pre[name] || '' }), hint);
  const sel = (name, label, map, v = 'normal') => mk(name, label, h('select', null, Object.entries(map).map(([k, l]) => opt(k, l, k === (pre[name] || v)))));

  const status = h('p', { class: 'muted sar-status', role: 'status', 'aria-live': 'polite' });
  const fileIn = h('input', { type: 'file', accept: 'application/pdf,image/jpeg,image/png,image/webp,.pdf', hidden: true });
  const drop = h('button', { class: 'sar-drop', type: 'button', onclick: () => fileIn.click() }, svgIcon(ICONS.upload, 26), h('strong', null, 'เลือกไฟล์หนังสือ (PDF หรือรูปสแกน)'), h('span', { class: 'muted' }, 'ระบบอ่านเลขที่ วันที่ เรื่อง ผู้ส่ง ให้อัตโนมัติ บนเครื่องของคุณ แล้วให้ตรวจก่อนลงรับ'));
  const fileLine = h('p', { class: 'sar-fileline' });
  const dupBox = h('div', { 'aria-live': 'polite' }); const sugBox = h('div', { class: 'chip-row' });
  const result = h('div'); const formCard = h('div', { class: 'card' });
  const state = {};
  const routeMode = h('div', { class: 'sar-seg', role: 'radiogroup', 'aria-label': 'การส่งต่อ' });
  let mode = 'none';
  const pickerBox = unitPicker(X, state); const routeText = h('input', { type: 'text', maxlength: 400, placeholder: 'ข้อความถึงผู้รับ (ถ้ามี) เช่น โปรดดำเนินการและรายงานผล' }); const routeWrap = h('div', { class: 'sar-route-wrap' }, routeText, pickerBox);
  [['none', 'ลงรับอย่างเดียว'], ['exec', 'เสนอผู้บริหาร'], ['units', 'ส่งหน่วยงานโดยตรง']].forEach(([k, l]) => {
    const b = h('button', { type: 'button', role: 'radio', 'aria-checked': k === 'none' ? 'true' : 'false', class: k === 'none' ? 'on' : '', onclick: () => { mode = k; [...routeMode.children].forEach((x) => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', String(on)); }); routeWrap.hidden = k === 'none'; pickerBox.hidden = k !== 'units'; } }, l);
    routeMode.append(b);
  });
  routeWrap.hidden = true; pickerBox.hidden = true;

  const dupCheck = debounce(async () => {
    const subject = F.subject.value.trim(); if (subject.length < 4) { dupBox.replaceChildren(); return; }
    try {
      const r = await X.call('dup', { subject, docNo: F.docNo.value, party: F.party.value, inboxId });
      dupBox.replaceChildren(r.items.length ? notice('warn', `พบหนังสือที่เหมือนกัน ${r.items.length} รายการ`, r.items.map((d) => `${d.reg ? `เลขรับ ${d.reg}` : 'รออยู่ในคิว'} — ${d.docNo || ''} ${d.subject}`).join(' | ')) : null);
      sugBox.replaceChildren(...(r.suggest || []).map((s) => h('button', { class: 'chip', type: 'button', title: `พบคำว่า ${s.why.join(', ')}`, onclick: () => { mode = 'units'; routeMode.children[2].click(); state.tick([s.unit]); } }, `แนะนำ: ${s.name}`)));
    } catch { /* the check is advisory */ }
  }, 600);

  const autoMark = (found) => Object.entries(F).forEach(([k, el]) => el.classList.toggle('sar-auto', !!found[k] && !!el.value));
  async function pickFile(f) {
    if (!f) return; status.textContent = 'กำลังเตรียมไฟล์…';
    try {
      pdf = await toPdfFile(f); pdfBlobForStamp = pdf; fileLine.replaceChildren(svgIcon(ICONS.file, 18), `${pdf.name} · ${(pdf.size / 1048576).toFixed(2)} MB`);
      if (pdf.size > 10 * 1024 * 1024) throw new Error('ไฟล์ใหญ่เกิน 10 MB — ลดขนาดด้วยเครื่องมือ “ย่อไฟล์” ก่อน');
      status.textContent = 'กำลังอ่านข้อมูลจากหนังสือ (ในเครื่อง ไม่ส่งออกอินเทอร์เน็ต)…';
      const t = await readLetter(pdf, (s) => { status.textContent = s; }); const r = parseLetter(t);
      const set = (k, v) => { if (v && !F[k].value.trim()) F[k].value = v; };
      ['docNo', 'docDate', 'subject', 'party', 'salut', 'refs', 'encl', 'due'].forEach((k) => set(k, r[k]));
      if (!r.due && r.dueDays) set('due', addDays(today, r.dueDays));
      if (r.urgency !== 'normal') F.urgency.value = r.urgency; if (r.secrecy !== 'normal') F.secrecy.value = r.secrecy;
      autoMark(r.found); const n = Object.keys(r.found).length;
      status.textContent = n ? `อ่านได้ ${n} รายการ — ตรวจทานช่องที่ไฮไลต์ให้ถูกต้องก่อนลงรับ` : 'อ่านข้อความจากไฟล์ไม่ได้ (อาจเป็นภาพไม่ชัด) — กรอกข้อมูลเองได้';
      if (r.secrecy !== 'normal') toast('พบคำว่าชั้นความลับในหนังสือ — ตรวจสอบและให้เจ้าหน้าที่ที่ได้รับอนุญาตลงรับ', 'error', 6000);
      dupCheck.flush();
    } catch (e) { status.textContent = `${errText(e)} — กรอกข้อมูลเองได้`; }
  }
  fileIn.addEventListener('change', () => { const f = fileIn.files && fileIn.files[0]; fileIn.value = ''; pickFile(f); });

  const grid = h('div', { class: 'sar-grid' },
    text('docNo', 'เลขที่หนังสือ', 'เช่น สธ 0123.4/ว567').root, mk('docDate', 'ลงวันที่', h('input', { type: 'date', value: pre.docDate || '' })).root,
    h('div', { class: 'sar-span' }, mk('subject', 'เรื่อง *', h('textarea', { rows: 2, maxlength: 300, value: pre.subject || '' })).root),
    text('party', 'จาก (หน่วยงานผู้ส่ง) *', 'เช่น สำนักงานสาธารณสุขจังหวัด…', 160).root, text('salut', 'เรียน', 'เช่น ผู้อำนวยการโรงพยาบาล…', 160).root,
    sel('urgency', 'ชั้นความเร็ว', URGENCY).root, sel('secrecy', 'ชั้นความลับ', SECRECY).root,
    mk('due', 'กำหนดเสร็จ / ตอบกลับภายใน', h('input', { type: 'date' }), 'ถ้าไม่ระบุ ระบบกำหนดตามชั้นความเร็ว (นับวันทำการ)').root,
    mk('cat', 'หมวดเรื่อง', h('select', null, opt('', '— ไม่ระบุ —'), X.cfg.categories.map(([k, l]) => opt(k, l)))).root,
    mk('channel', 'ช่องทางที่ได้รับ', h('select', null, X.cfg.channels.map(([k, l]) => opt(k, l, k === (pre.channel || 'esaraban'))))).root,
    text('deliverer', 'ผู้นำส่ง (ถ้ามี)', 'ชื่อผู้นำหนังสือมาส่ง', 80).root,
    h('div', { class: 'sar-span' }, mk('refs', 'อ้างถึง', h('textarea', { rows: 2, maxlength: 400 })).root), h('div', { class: 'sar-span' }, mk('encl', 'สิ่งที่ส่งมาด้วย', h('textarea', { rows: 2, maxlength: 400 })).root),
    h('div', { class: 'sar-span' }, mk('note', 'หมายเหตุ', h('input', { type: 'text', maxlength: 500 })).root));
  if (X.cfg.units.some((u) => u.registry)) {
    const regSel = mk('registry', 'ลงทะเบียนรับของ', h('select', null, opt('central', 'สารบรรณกลาง'), X.cfg.units.filter((u) => u.registry && u.active).map((u) => opt(u.code, u.name))));
    grid.append(regSel.root);
  }
  ['subject', 'docNo', 'party'].forEach((k) => F[k].addEventListener('input', dupCheck));
  F.docNo.value = pre.docNo || ''; F.subject.value = pre.subject || ''; F.party.value = pre.party || ''; F.docDate.value = pre.docDate || '';

  const submit = h('button', { class: 'btn btn-primary btn-lg', type: 'button', onclick: () => go(false) }, svgIcon(ICONS.check, 20), 'ลงรับและออกเลขรับ');
  async function go(dupOk) {
    if (busy) return;
    const v = (k) => (F[k].value || '').trim();
    if (!v('subject')) { F.subject.focus(); toast('กรุณาระบุเรื่อง', 'info'); return; }
    if (!v('party')) { F.party.focus(); toast('กรุณาระบุผู้ส่ง (จาก)', 'info'); return; }
    if (v('secrecy') !== 'normal' && !X.cfg.me.clear) { toast('หนังสือชั้นความลับต้องลงรับโดยเจ้าหน้าที่ที่ได้รับอนุญาตเท่านั้น', 'error', 6000); return; }
    const route = mode === 'none' ? { mode } : mode === 'exec' ? { mode, text: routeText.value } : { mode, units: state.pick(), text: routeText.value };
    if (mode === 'units' && !route.units.length) { toast('กรุณาเลือกหน่วยงานที่จะส่งต่อ', 'info'); return; }
    busy = true; submit.disabled = true; status.textContent = 'กำลังบันทึก…';
    try {
      const files = []; if (pdf && !pre._sent) { status.textContent = 'กำลังอัปโหลดไฟล์ต้นฉบับ…'; const f = await upload(X, pdf, { kind: 'in' }); files.push({ id: f.id }); pre._sent = files; } else if (pre._sent) files.push(...pre._sent);
      status.textContent = 'กำลังออกเลขรับ…';
      const body = { rid, dupOk, inboxId, files, route, ...Object.fromEntries(Object.keys(F).map((k) => [k, v(k)])) };
      const r = await X.call('receive', body, 40000);
      if (r.needsConfirm) {
        busy = false; submit.disabled = false; status.textContent = '';
        let m = null;
        m = modal('พบหนังสือที่เหมือนกัน', [h('p', null, 'ระบบพบหนังสือเลขที่/เรื่อง/ผู้ส่งเดียวกันที่ลงรับหรืออยู่ในคิวแล้ว:'), h('ul', null, r.dups.map((d) => h('li', null, `${d.reg ? `เลขรับ ${d.reg}` : 'อยู่ในคิว'} — ${d.docNo || '-'} · ${d.subject}`))), h('p', { class: 'muted' }, 'ถ้าเป็นฉบับเดียวกัน ไม่ควรลงรับซ้ำ — เลขรับจะถูกใช้ไปและยกเลิกได้เฉพาะพร้อมเหตุผล')],
          [h('button', { class: 'btn btn-danger', type: 'button', onclick: () => { m.close(); go(true); } }, 'ลงรับซ้ำจริง ๆ'), h('button', { class: 'btn btn-primary', type: 'button', onclick: () => m.close() }, 'ยกเลิก ไม่ลงรับ')]);
        return;
      }
      await done(r);
    } catch (e) {
      busy = false; submit.disabled = false; status.textContent = '';
      if (e && (e.code === 'NETWORK' || e.code === 'TIMEOUT' || e.code === 'BAD_RESPONSE')) toast('ไม่แน่ใจว่าบันทึกสำเร็จหรือไม่ — กด “ลงรับ” อีกครั้งได้เลย ระบบจะไม่ออกเลขซ้ำ', 'error', 8000);
      else toast(errText(e), 'error', 7000);
    }
  }
  async function done(r) {
    const d = r.doc; let stampBlob = null; let stampMsg = '';
    if (pdfBlobForStamp && !r.replay) {
      try { status.textContent = 'กำลังประทับตรารับและแนบไฟล์…'; stampBlob = await stampReceive(pdfBlobForStamp, r.stamp); const f = new File([stampBlob], `${d.reg.replace('/', '-')}_ประทับตรารับ.pdf`, { type: 'application/pdf' }); await upload(X, f, { kind: 'in', docId: d.id, label: 'ฉบับประทับตรารับ' }); stampMsg = 'แนบฉบับประทับตรารับในทะเบียนแล้ว'; } catch (e) { stampMsg = `ประทับตราไม่สำเร็จ: ${errText(e)} (ลงรับเรียบร้อยแล้ว — แนบไฟล์ได้ที่หน้ารายละเอียด)`; }
    }
    status.textContent = '';
    formCard.hidden = true;
    result.replaceChildren(h('div', { class: 'card sar-done' }, h('div', { class: 'sar-bignum' }, h('span', { class: 'muted' }, r.replay ? 'ลงรับไว้แล้ว (ไม่ออกเลขซ้ำ)' : 'ลงรับสำเร็จ — เลขรับ'), h('strong', null, d.reg)),
      h('p', null, `${r.stamp.registry} · ${r.stamp.date} เวลา ${r.stamp.time}`), h('p', { class: 'muted' }, `รหัสตรวจสอบ ${r.verify} (ใช้ค้นหาในหน้า “ติดตาม”)`),
      ...(r.warnings || []).map((w) => notice('warn', 'ข้อควรตรวจสอบ', w)), r.jumped ? notice('warn', 'เลขรับข้ามลำดับ', 'เลขที่ระบุข้ามจากเลขล่าสุด — ดูช่องว่างได้ที่หน้า “เลขทะเบียน”') : null,
      (r.routed && r.routed.length) ? h('p', null, `ส่งต่อแล้ว ${r.routed.length} หน่วยงาน`) : null, stampMsg ? h('p', { class: 'muted' }, stampMsg) : null,
      h('div', { class: 'btn-row' }, stampBlob ? h('button', { class: 'btn', type: 'button', onclick: () => download(stampBlob, `${d.reg.replace('/', '-')}_ประทับตรารับ.pdf`) }, svgIcon(ICONS.download, 18), 'ดาวน์โหลดไฟล์ที่ประทับตรา') : null,
        h('button', { class: 'btn', type: 'button', onclick: () => X.openDoc(d.id) }, 'เปิดรายละเอียด'), h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { X.refresh('receive'); } }, 'ลงรับฉบับต่อไป'))));
    result.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  formCard.append(drop, fileLine, status, dupBox, grid, h('h3', { class: 'sar-h3' }, 'ส่งต่อ'), routeMode, sugBox, routeWrap,
    h('div', { class: 'btn-row sar-submit' }, submit, h('button', { class: 'btn', type: 'button', onclick: () => X.refresh('receive') }, 'ล้างแบบฟอร์ม')));
  root.append(privacyNotice({ detail: 'หนังสือราชการอาจมีชื่อ-ข้อมูลผู้ป่วย ไฟล์ที่ลงรับจะเก็บใน Google Drive ของหน่วยงานในโฟลเดอร์ _saraban เฉพาะเจ้าหน้าที่ที่ได้รับสิทธิ์ — การอ่านข้อความด้วย OCR ทำบนเครื่องของคุณ ไม่ส่งออกอินเทอร์เน็ต' }), result, formCard);
  if (pre.inboxId) { formCard.prepend(notice('info', 'ลงรับจากคิว Telegram', pre.file ? 'ไฟล์จาก Telegram จะถูกแนบเป็นลิงก์ให้อัตโนมัติ — เลือกไฟล์ซ้ำที่นี่หากต้องการประทับตรารับ' : 'ตรวจข้อมูลที่ระบบดึงมา แล้วกดลงรับ')); setTimeout(() => dupCheck.flush(), 50); }
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
      const ps = parties.map((p) => ({ name: p.name.value, channel: p.ch.value, email: p.email.value, trackingNo: p.track.value, receivedBy: p.recv.value })).filter((p) => p.name.trim());
      if (!ps.length) { parties[0].name.focus(); throw new Error('กรุณาระบุผู้รับอย่างน้อย 1 ราย'); }
      const files = []; if (fileIn.files && fileIn.files[0]) { const f = fileIn.files[0]; status.textContent = 'กำลังอัปโหลดไฟล์…'; const u = await upload(X, f, { kind: 'out' }); files.push({ id: u.id }); }
      status.textContent = 'กำลังออกเลข…';
      const r = await X.call('send', { rid, reservedId: pre.reserved ? pre.reserved.id : '', replyTo, files, parties: ps, ...Object.fromEntries(['subject', 'docDate', 'bookType', 'urgency', 'secrecy', 'cat', 'refs', 'encl'].map((k) => [k, val(k)])), registry: regSel ? val('registry') : 'central' }, 40000);
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
  const box = h('div', { class: 'card' }, pre.reserved ? notice('info', `ออกหนังสือจากเลขที่จองไว้ ${pre.reserved.reg}`, `เลขที่หนังสือ ${pre.reserved.docNo} — ${pre.reserved.purpose || ''}`) : null, mode, sendBox, reserveBox, regSel ? regSel.root : null, status, h('div', { class: 'btn-row sar-submit' }, go));
  root.append(result, box);
}
