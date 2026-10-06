import { h, field, svgIcon, debounce } from '../core/dom.js';
import { ICONS } from '../core/icons.js';
import { downloadBlob, copyText } from '../core/download.js';
import { toast } from '../core/toast.js';
import { record } from '../core/logger.js';
import { getSession } from '../core/auth.js';
import { backendConfigured } from '../core/api.js';
import { notice } from '../core/notices.js';
import { QR_TYPES, QR_CATS, linksCall, shortUrl, savedForm, savedDesign } from '../core/qrsaved.js';
import { buildMatrix, PAYLOADS, toSvg, drawToCanvas, byteLength, MAX_BYTES, contrastRatio } from './qr-engine.js';

const TYPES = QR_TYPES;
const CATS = QR_CATS;
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

export function mount(root, ctx) {
  let type = 'url';
  const form = {};
  /** @type {Record<string, any>} the input element of every form field (used to fill the form from a saved QR) */
  const inputs = {};
  /** When a tracked QR has been saved, the picture shows the short URL instead of the typed link (valid while the link is unchanged). */
  let override = null;
  /** The saved QR being edited: {code, kind, title} */
  let editing = null;
  let logoImage = null; let logoDataUrl = null;
  let current = null; // {matrix, payload, opts}

  const inp = (key, label, attrs = {}, hint) => {
    const el = attrs.multiline ? h('textarea', { rows: attrs.rows || 4, ...attrs.attrs }) : h('input', { type: attrs.type || 'text', autocomplete: 'off', ...attrs.attrs });
    el.addEventListener('input', () => { form[key] = el.value; schedule(); });
    form[key] = el.value; inputs[key] = el;
    return field(label, el, hint).root;
  };
  const fieldsets = {
    url: () => [inp('url', 'ลิงก์เว็บไซต์', { type: 'text', attrs: { inputmode: 'url', placeholder: 'https://example.com' } }, 'ถ้าไม่พิมพ์ https:// ระบบจะเติมให้อัตโนมัติ')],
    text: () => [inp('text', 'ข้อความ', { multiline: true, rows: 5, attrs: { placeholder: 'พิมพ์ข้อความที่ต้องการ' } })],
    wifi: () => {
      const enc = h('select', { onchange: () => { form.encryption = enc.value; pass.querySelector('input').disabled = enc.value === 'nopass'; schedule(); } },
        h('option', { value: 'WPA' }, 'WPA/WPA2/WPA3'), h('option', { value: 'WEP' }, 'WEP'), h('option', { value: 'nopass' }, 'ไม่มีรหัสผ่าน'));
      form.encryption = 'WPA'; inputs.encryption = enc;
      const pass = inp('password', 'รหัสผ่าน');
      const hid = h('input', { type: 'checkbox', id: 'wifi-hidden', onchange: () => { form.hidden = hid.checked; schedule(); } }); inputs.hidden = hid;
      return [inp('ssid', 'ชื่อเครือข่าย (SSID)'), pass, field('การเข้ารหัส', enc).root, h('div', { class: 'check' }, hid, h('label', { for: 'wifi-hidden' }, 'เครือข่ายซ่อนชื่อ'))];
    },
    email: () => [inp('email', 'อีเมลผู้รับ', { type: 'email', attrs: { inputmode: 'email' } }), inp('subject', 'หัวข้อ'), inp('body', 'เนื้อหา', { multiline: true, rows: 3 })],
    phone: () => [inp('phone', 'หมายเลขโทรศัพท์', { type: 'tel', attrs: { inputmode: 'tel', placeholder: '0812345678' } })],
    sms: () => [inp('phone', 'หมายเลขโทรศัพท์', { type: 'tel', attrs: { inputmode: 'tel' } }), inp('message', 'ข้อความ', { multiline: true, rows: 3 })],
    vcard: () => [h('div', { class: 'grid-2' }, inp('firstName', 'ชื่อ'), inp('lastName', 'นามสกุล')), inp('org', 'หน่วยงาน/องค์กร'), inp('title', 'ตำแหน่ง'),
      h('div', { class: 'grid-2' }, inp('phone', 'โทรศัพท์', { type: 'tel' }), inp('email', 'อีเมล', { type: 'email' })), inp('url', 'เว็บไซต์'), inp('address', 'ที่อยู่', { multiline: true, rows: 2 })]
  };

  const fieldHost = h('div');
  const tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'ประเภทข้อมูลใน QR' });
  function renderTabs() {
    tabs.replaceChildren(...TYPES.map(([id, label]) => h('button', { class: 'tab', role: 'tab', type: 'button', 'aria-selected': String(id === type), onclick: () => setType(id) }, label)));
  }
  function setType(id) {
    type = id; for (const k of Object.keys(form)) delete form[k]; for (const k of Object.keys(inputs)) delete inputs[k];
    fieldHost.replaceChildren(...fieldsets[id]()); renderTabs(); syncPanel(); schedule.flush();
  }
  function fillForm(values) {
    for (const [k, v] of Object.entries(values)) {
      const el = inputs[k]; if (!el) continue;
      if (el.type === 'checkbox') { el.checked = v === true; el.dispatchEvent(new Event('change')); }
      else { el.value = String(v == null ? '' : v); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input')); }
    }
  }

  /* options */
  const sizeIn = h('input', { type: 'number', min: '128', max: '2048', step: '32', value: '512', oninput: () => schedule() });
  const marginIn = h('input', { type: 'number', min: '0', max: '16', value: '4', oninput: () => schedule() });
  const ecIn = h('select', { onchange: () => schedule() }, [['L', 'L — ต่ำ (7%)'], ['M', 'M — ปานกลาง (15%)'], ['Q', 'Q — สูง (25%)'], ['H', 'H — สูงมาก (30%)']].map(([v, t]) => h('option', { value: v, selected: v === 'M' }, t)));
  const fgIn = h('input', { type: 'color', value: '#000000', 'aria-label': 'สีของ QR', oninput: () => schedule() });
  const bgIn = h('input', { type: 'color', value: '#ffffff', 'aria-label': 'สีพื้นหลัง', oninput: () => schedule() });
  const styleIn = h('select', { onchange: () => schedule() }, [['square', 'สี่เหลี่ยม'], ['rounded', 'มุมมน'], ['dots', 'จุดกลม']].map(([v, t]) => h('option', { value: v }, t)));
  const logoIn = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/svg+xml', 'aria-label': 'เลือกโลโก้', onchange: onLogo });
  const logoClear = h('button', { class: 'btn btn-sm', type: 'button', hidden: true, onclick: () => { logoImage = null; logoDataUrl = null; logoIn.value = ''; logoClear.hidden = true; schedule(); } }, 'เอาโลโก้ออก');
  async function onLogo() {
    const f = logoIn.files && logoIn.files[0]; if (!f) return;
    if (f.size > MAX_LOGO_BYTES) { toast('ไฟล์โลโก้ใหญ่เกินไป (สูงสุด 2 MB)', 'error'); logoIn.value = ''; return; }
    const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
    const img = new Image();
    img.onload = () => { logoImage = img; logoDataUrl = url; logoClear.hidden = false; if (ecIn.value !== 'H') { ecIn.value = 'H'; toast('ปรับระดับแก้ไขข้อผิดพลาดเป็น H เพื่อให้สแกนได้เมื่อมีโลโก้'); } schedule(); };
    img.onerror = () => toast('อ่านไฟล์โลโก้ไม่ได้', 'error');
    img.src = url;
  }

  const catIn = h('select', { 'aria-label': 'หมวดงาน', onchange: () => { capIn.placeholder = (CATS.find((c) => c[0] === catIn.value) || [])[2] || 'เช่น สแกนเพื่อลงทะเบียน'; schedule(); } }, CATS.map(([v, t]) => h('option', { value: v }, t)));
  const capIn = h('input', { type: 'text', maxlength: '40', placeholder: 'เช่น สแกนเพื่อลงทะเบียน', oninput: () => schedule() });
  /* output */
  const canvas = h('canvas', { role: 'img', 'aria-label': 'ตัวอย่าง QR Code' });
  const placeholder = h('p', { class: 'muted', style: 'padding:2rem;text-align:center' }, 'กรอกข้อมูลทางซ้ายเพื่อสร้าง QR Code');
  const canvasWrap = h('div', { class: 'qr-canvas-wrap', hidden: true }, canvas);
  const info = h('p', { class: 'qr-info', role: 'status', 'aria-live': 'polite' });
  const warn = h('div', { role: 'status', 'aria-live': 'polite' });
  const btnPng = h('button', { class: 'btn btn-primary', type: 'button', disabled: true, onclick: downloadPng }, svgIcon(ICONS.download, 18), 'ดาวน์โหลด PNG');
  const btnSvg = h('button', { class: 'btn', type: 'button', disabled: true, onclick: downloadSvg }, svgIcon(ICONS.download, 18), 'ดาวน์โหลด SVG');
  const btnCopyImg = h('button', { class: 'btn', type: 'button', disabled: true, onclick: copyImage }, svgIcon(ICONS.copy, 18), 'คัดลอกรูป');
  const btnCopyTxt = h('button', { class: 'btn', type: 'button', disabled: true, onclick: async () => toast((await copyText(current.payload)) ? 'คัดลอกเนื้อหาแล้ว' : 'คัดลอกไม่สำเร็จ', 'info') }, svgIcon(ICONS.copy, 18), 'คัดลอกเนื้อหา');

  function opts() {
    return { size: Math.min(2048, Math.max(128, Number(sizeIn.value) || 512)), margin: Math.min(16, Math.max(0, Number(marginIn.value) || 0)), fg: fgIn.value, bg: bgIn.value, style: styleIn.value };
  }
  function setButtons(on) { [btnPng, btnSvg, btnCopyImg, btnCopyTxt].forEach((b) => { b.disabled = !on; }); if (typeof syncPanel === 'function') syncPanel(); }

  const schedule = debounce(generate, 120);
  function activePayload() {
    if (override) {
      if (type === 'url' && (form.url || '') === override.forUrl) return override.payload;
      override = null; syncPanel();   // the link was changed after saving: back to a plain QR of the typed link
    }
    return PAYLOADS[type](form);
  }
  function generate() {
    warn.replaceChildren();
    const payload = activePayload();
    if (!payload) { current = null; canvasWrap.hidden = true; placeholder.hidden = false; info.textContent = ''; setButtons(false); return; }
    let matrix;
    try { matrix = buildMatrix(payload, ecIn.value); } catch (e) {
      current = null; canvasWrap.hidden = true; placeholder.hidden = false; setButtons(false);
      warn.append(h('div', { class: 'notice notice-error', role: 'alert' }, svgIcon(ICONS.alert), h('div', null, e.message === 'TOO_LONG'
        ? `ข้อมูลยาวเกินกว่าที่ QR จะรองรับ (${byteLength(payload).toLocaleString()} ไบต์ จาก ${MAX_BYTES.toLocaleString()}) กรุณาตัดข้อมูลให้สั้นลง หรือลดระดับแก้ไขข้อผิดพลาด` : 'สร้าง QR ไม่สำเร็จ')));
      return;
    }
    const o = opts();
    const logoRatio = logoImage ? 0.2 : 0;
    drawToCanvas(canvas, matrix, { ...o, logoImage, logoRatio });
    canvasWrap.hidden = false; placeholder.hidden = true;
    canvas.style.width = `${Math.min(o.size, 360)}px`;
    current = { matrix, payload, opts: o, logoRatio };
    setButtons(true);
    info.textContent = `${matrix.size}×${matrix.size} โมดูล · ${byteLength(payload).toLocaleString()} ไบต์ · ไฟล์ PNG ${canvas.width}×${canvas.height} px${override ? ' · QR ติดตามสถิติ (ชี้ไปที่ลิงก์ย่อ)' : ''}`;
    const cr = contrastRatio(o.fg, o.bg);
    if (cr < 3) warn.append(h('div', { class: 'notice notice-warn', role: 'status' }, svgIcon(ICONS.alert), h('div', null, 'สีตัว QR กับสีพื้นหลังต่างกันน้อยเกินไป อาจสแกนไม่ติด ควรใช้สีเข้มบนพื้นสว่าง')));
    else if (o.fg.toLowerCase() === '#ffffff' || parseInt(o.fg.slice(1), 16) > parseInt(o.bg.slice(1), 16)) warn.append(h('div', { class: 'notice notice-warn', role: 'status' }, svgIcon(ICONS.alert), h('div', null, 'QR แบบสีสว่างบนพื้นเข้ม (กลับสี) บางแอปสแกนไม่ได้ ควรทดสอบสแกนก่อนใช้งานจริง')));
    if (logoImage && ecIn.value !== 'H') warn.append(h('div', { class: 'notice notice-warn' }, svgIcon(ICONS.alert), h('div', null, 'มีโลโก้กลาง QR แนะนำให้ใช้ระดับแก้ไขข้อผิดพลาด H')));
  }

  function fileBase() { return (catIn.value !== 'general' ? `${catIn.value}-` : '') + ({ url: 'qr-link', text: 'qr-text', wifi: 'qr-wifi', email: 'qr-email', phone: 'qr-phone', sms: 'qr-sms', vcard: 'qr-contact' })[type]; }
  function downloadPng() {
    if (!current) return;
    const cap = capIn.value.trim(); let src = canvas;
    if (cap) { const o = current.opts; const bar = Math.round(o.size * 0.11); src = document.createElement('canvas'); src.width = canvas.width; src.height = canvas.height + bar;
      const g = src.getContext('2d'); g.fillStyle = o.bg; g.fillRect(0, 0, src.width, src.height); g.drawImage(canvas, 0, 0); g.fillStyle = o.fg; g.font = `600 ${Math.round(bar * 0.5)}px "Noto Sans Thai", Tahoma, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(cap, src.width / 2, canvas.height + bar / 2, src.width * 0.92); }
    record('qr', 'download_png', { fileName: `${fileBase()}.png`, extra: { type, category: catIn.value, caption: cap } });
    src.toBlob((b) => { if (b) downloadBlob(b, `${fileBase()}.png`); else toast('สร้างไฟล์ PNG ไม่สำเร็จ', 'error'); }, 'image/png');
  }
  function downloadSvg() {
    if (!current) return;
    const svg = toSvg(current.matrix, { ...current.opts, logo: logoDataUrl ? { dataUrl: logoDataUrl, ratio: current.logoRatio } : null });
    downloadBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), `${fileBase()}.svg`);
  }
  async function copyImage() {
    if (!current) return;
    try {
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
      if (!blob || !navigator.clipboard || !window.ClipboardItem) throw new Error('unsupported');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast('คัดลอกรูป QR แล้ว', 'success');
    } catch { toast('เบราว์เซอร์นี้คัดลอกรูปไม่ได้ กรุณาใช้ปุ่มดาวน์โหลด PNG แทน', 'error', 5000); }
  }


  /* ---------- save to history (backend) ---------- */
  const nameIn = h('input', { type: 'text', maxlength: '120', placeholder: 'เช่น QR ลงทะเบียนวัคซีนไข้หวัดใหญ่ 2569', autocomplete: 'off' });
  const noteIn = h('input', { type: 'text', maxlength: '300', placeholder: 'ใช้ติดที่ไหน / ใครรับผิดชอบ (ไม่บังคับ)', autocomplete: 'off' });
  const modeStatic = h('input', { type: 'radio', name: 'qr-mode', id: 'qr-mode-static', value: 'qrs', checked: true, onchange: () => syncPanel() });
  const modeTracked = h('input', { type: 'radio', name: 'qr-mode', id: 'qr-mode-tracked', value: 'qr', onchange: () => syncPanel() });
  const modeHint = h('p', { class: 'hint', 'aria-live': 'polite' });
  const editBar = h('div', { class: 'notice notice-info', hidden: true, role: 'status' });
  const saveBtn = h('button', { class: 'btn btn-primary', type: 'button', disabled: true, onclick: () => saveQr(false) }, svgIcon(ICONS.save, 18), 'บันทึกลงประวัติ QR');
  const saveNewBtn = h('button', { class: 'btn', type: 'button', hidden: true, onclick: () => saveQr(true) }, 'บันทึกเป็นรายการใหม่');
  const cancelEditBtn = h('button', { class: 'btn btn-sm', type: 'button', hidden: true, onclick: () => { editing = null; override = null; modeStatic.checked = true; nameIn.value = noteIn.value = ''; syncPanel(); schedule.flush(); } }, 'เลิกแก้ไข');
  const saveResult = h('div', { class: 'qr-saved', hidden: true, 'aria-live': 'polite' });
  const canSave = () => backendConfigured() && !!getSession();
  function syncPanel() {
    const isUrl = type === 'url';
    modeTracked.disabled = !isUrl;
    if (!isUrl && modeTracked.checked) modeStatic.checked = true;
    const tracked = modeTracked.checked && isUrl;
    modeHint.textContent = tracked
      ? 'QR จะชี้ไปที่ลิงก์ย่อของระบบ (…/s/รหัส) ทุกครั้งที่มีคนสแกนจะถูกนับ และแก้ลิงก์ปลายทางทีหลังได้โดยไม่ต้องพิมพ์ QR ใหม่'
      : isUrl ? 'เก็บ QR และข้อมูลไว้ในประวัติเท่านั้น ไม่นับจำนวนผู้สแกน (QR จะชี้ไปที่ลิงก์เดิมตรง ๆ)' : 'ชนิดนี้เก็บประวัติได้อย่างเดียว — การนับผู้สแกนทำได้เฉพาะ QR ชนิดลิงก์ (URL)';
    if (editing) {
      editBar.hidden = false; editBar.replaceChildren(svgIcon(ICONS.edit), h('div', null, h('strong', null, 'กำลังแก้ไข QR ที่บันทึกไว้'), h('p', null, `“${editing.title}” — กด “อัปเดต” เพื่อบันทึกทับรายการเดิม หรือ “บันทึกเป็นรายการใหม่”`)));
    } else editBar.hidden = true;
    const canUpdate = !!editing && (editing.kind === 'qr' ? tracked : !tracked);
    saveBtn.replaceChildren(svgIcon(ICONS.save, 18), canUpdate ? 'อัปเดตรายการเดิม' : 'บันทึกลงประวัติ QR');
    saveBtn.dataset.update = canUpdate ? '1' : '';
    saveNewBtn.hidden = !canUpdate; cancelEditBtn.hidden = !editing;
    saveBtn.disabled = !current || !canSave();
  }
  function staticFields() {
    const f = {}; for (const [k, v] of Object.entries(form)) { if (v === '' || v === false || v == null) continue; f[k] = String(v); }
    return f;
  }
  async function saveQr(asNew) {
    if (!current) { toast('สร้าง QR ก่อนแล้วจึงบันทึก', 'error'); return; }
    const title = nameIn.value.trim();
    if (!title) { nameIn.focus(); toast('ตั้งชื่อ QR ก่อนบันทึก เพื่อให้รู้ว่าเป็น QR ของอะไร', 'error'); return; }
    const tracked = modeTracked.checked && type === 'url';
    if (!tracked && type === 'wifi' && form.password && form.encryption !== 'nopass') { toast('ไม่บันทึกรหัสผ่าน Wi-Fi ลงในประวัติ — ลบรหัสผ่านออกจากช่องก่อนกดบันทึก (QR ที่ดาวน์โหลดยังมีรหัสผ่านตามปกติ)', 'error', 7000); return; }
    const o = current.opts;
    const d = { fg: o.fg, bg: o.bg, style: o.style, ec: ecIn.value, margin: o.margin, size: o.size, cat: catIn.value, cap: capIn.value.trim() };
    const qr = tracked ? { t: 'url', d } : { t: type, d, f: staticFields() };
    const update = !asNew && saveBtn.dataset.update === '1' && editing;
    saveBtn.disabled = true; saveNewBtn.disabled = true;
    try {
      let link; let base = '';
      if (update) {
        const body = { code: editing.code, title, note: noteIn.value.trim(), qr };
        if (tracked) body.url = PAYLOADS.url(form) || form.url;
        const r = await linksCall('update', body); link = r.link; base = (await linksCall('get', { code: link.code })).base;
      } else {
        const body = { kind: tracked ? 'qr' : 'qrs', title, note: noteIn.value.trim(), qr };
        if (tracked) body.url = PAYLOADS.url(form) || form.url;
        const r = await linksCall('create', body); link = r.link; base = r.base;
      }
      editing = { code: link.code, kind: link.kind, title: link.title };
      const doneMsg = update ? 'อัปเดต QR แล้ว' : 'บันทึก QR ลงประวัติแล้ว';
      if (tracked) {
        override = { payload: shortUrl(base, link.code), forUrl: form.url || '' };
        schedule.flush();
        const full = override.payload;
        saveResult.hidden = false;
        saveResult.replaceChildren(h('b', null, 'QR นี้นับจำนวนผู้สแกนแล้ว'), h('p', { class: 'muted' }, 'รูป QR ด้านขวาเปลี่ยนเป็นลิงก์ย่อ ', h('code', null, full.replace(/^https?:\/\//, '')), ' — ดาวน์โหลดรูปนี้ไปใช้งาน อย่าใช้รูปที่ดาวน์โหลดก่อนบันทึก'),
          h('a', { class: 'btn btn-sm', href: `#/links?stats=${encodeURIComponent(link.code)}` }, 'ดูสถิติ'), ' ', h('a', { class: 'btn btn-sm', href: '#/qrs' }, 'ไปที่ประวัติ QR'));
      } else {
        saveResult.hidden = false;
        saveResult.replaceChildren(h('b', null, 'เก็บไว้ในประวัติแล้ว'), h('p', { class: 'muted' }, 'เปิดกลับมาแก้ไขหรือดาวน์โหลดใหม่ได้จากหน้า ประวัติ QR (ไม่เก็บโลโก้กลาง QR)'), h('a', { class: 'btn btn-sm', href: '#/qrs' }, 'ไปที่ประวัติ QR'));
      }
      toast(doneMsg, 'success');
      record('qr', update ? 'update_saved' : 'save', { fileName: title, extra: { type, tracked, category: catIn.value } });
    } catch (e) { toast(e.message || 'บันทึกไม่สำเร็จ', 'error', 7000); } finally { saveNewBtn.disabled = false; syncPanel(); }
  }
  async function loadSaved(code) {
    try {
      const d = await linksCall('get', { code }); const it = d.link;
      if (it.kind === 'link') { toast('รายการนี้เป็นลิงก์ย่อ ไม่ใช่ QR', 'error'); return; }
      const dz = savedDesign(it);
      sizeIn.value = String(dz.size); marginIn.value = String(dz.margin); ecIn.value = dz.ec; fgIn.value = dz.fg; bgIn.value = dz.bg; styleIn.value = dz.style; catIn.value = dz.cat; capIn.value = dz.cap;
      capIn.placeholder = (CATS.find((c) => c[0] === catIn.value) || [])[2] || 'เช่น สแกนเพื่อลงทะเบียน';
      nameIn.value = it.title; noteIn.value = it.note || '';
      editing = { code: it.code, kind: it.kind, title: it.title };
      if (it.kind === 'qr') {
        modeTracked.checked = true; setType('url'); fillForm({ url: it.url });
        override = { payload: shortUrl(d.base, it.code), forUrl: it.url };
      } else {
        modeStatic.checked = true; setType((it.qr && it.qr.t) || 'url'); fillForm(savedForm(it));
        if (type === 'wifi') toast('ไม่ได้เก็บรหัสผ่าน Wi-Fi ไว้ กรุณากรอกรหัสผ่านใหม่ก่อนดาวน์โหลด', 'info', 6000);
      }
      schedule.flush(); syncPanel();
    } catch (e) { toast(e.message || 'เปิด QR ที่บันทึกไว้ไม่ได้', 'error', 6000); }
  }
  const savePanel = h('div', { class: 'card qr-save' }, h('h2', null, 'บันทึกลงประวัติ QR'),
    canSave() ? h('div', null, editBar,
      field('ชื่อ QR (เป็น QR ของอะไร)', nameIn, 'ใช้ค้นหาในหน้า ประวัติ QR — หมวดงานเลือกจากการ์ดด้านบน').root, field('หมายเหตุ', noteIn).root,
      h('div', { class: 'qr-modes', role: 'radiogroup', 'aria-label': 'รูปแบบการบันทึก' },
        h('label', { class: 'qr-mode', for: 'qr-mode-static' }, modeStatic, h('span', null, h('b', null, 'เก็บประวัติอย่างเดียว'), h('small', null, 'ไม่นับผู้สแกน'))),
        h('label', { class: 'qr-mode', for: 'qr-mode-tracked' }, modeTracked, h('span', null, h('b', null, 'ติดตามสถิติการสแกน'), h('small', null, 'เฉพาะ QR ชนิดลิงก์')))),
      modeHint, h('div', { class: 'btn-row' }, saveBtn, saveNewBtn, cancelEditBtn), saveResult)
      : notice('info', 'เข้าสู่ระบบเพื่อบันทึกประวัติและนับผู้สแกน', backendConfigured() ? 'เมื่อล็อกอินแล้ว ระบบจะเก็บ QR ที่สร้างไว้พร้อมชื่อและหมวดงาน และนับจำนวนผู้สแกนของ QR ชนิดลิงก์ได้' : 'ยังไม่ได้ตั้งค่า Backend (GAS) จึงใช้งานส่วนนี้ไม่ได้'));

  root.append(h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'QR Code Generator'), h('p', null, 'สร้าง QR Code ในเบราว์เซอร์ ข้อมูลไม่ถูกส่งออกไปที่ใด เว้นแต่คุณกดบันทึกลงประวัติเอง')),
      canSave() ? h('a', { class: 'btn', href: '#/qrs' }, svgIcon(ICONS.list, 18), 'ประวัติ QR') : null),
    h('div', { class: 'two-col' },
      h('div', null,
        h('div', { class: 'card' }, tabs, fieldHost),
        h('div', { class: 'card' }, h('h2', null, 'หมวดงานและข้อความใต้ QR'), h('div', { class: 'grid-2' }, field('หมวดงาน', catIn, 'ตั้งชื่อไฟล์ตามหมวด เช่น vaccine-qr-link.png').root, field('ข้อความใต้ QR (ไม่บังคับ)', capIn).root)),
        savePanel,
        h('div', { class: 'card' }, h('h2', null, 'ปรับแต่ง'),
          h('div', { class: 'grid-2' },
            field('ขนาดภาพ (px)', sizeIn).root, field('ขอบขาว (โมดูล)', marginIn).root,
            field('ระดับแก้ไขข้อผิดพลาด', ecIn).root, field('รูปแบบจุด', styleIn).root,
            h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'สี QR'), fgIn), h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'สีพื้นหลัง'), bgIn)),
          field('โลโก้กลาง QR (ไม่บังคับ)', logoIn, 'ใช้ PNG/JPG/WEBP/SVG ไม่เกิน 2 MB').root, logoClear)),
      h('div', { class: 'qr-preview card' }, placeholder, canvasWrap, info, warn,
        h('div', { class: 'btn-row', style: 'justify-content:center' }, btnPng, btnSvg, btnCopyImg, btnCopyTxt)))));
  setType('url');
  const loadCode = ctx && ctx.params && ctx.params.get('load');
  if (loadCode && canSave()) loadSaved(loadCode);
}
