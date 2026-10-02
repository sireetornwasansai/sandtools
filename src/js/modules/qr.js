import { h, field, svgIcon, debounce } from '../core/dom.js';
import { ICONS } from '../core/icons.js';
import { downloadBlob, copyText } from '../core/download.js';
import { toast } from '../core/toast.js';
import { buildMatrix, PAYLOADS, toSvg, drawToCanvas, byteLength, MAX_BYTES, contrastRatio } from './qr-engine.js';

const TYPES = [
  ['url', 'ลิงก์ (URL)'], ['text', 'ข้อความ'], ['wifi', 'Wi-Fi'], ['email', 'อีเมล'], ['phone', 'โทรศัพท์'], ['sms', 'SMS'], ['vcard', 'นามบัตร (vCard)']
];
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

export function mount(root) {
  let type = 'url';
  const form = {};
  let logoImage = null; let logoDataUrl = null;
  let current = null; // {matrix, payload, opts}

  const inp = (key, label, attrs = {}, hint) => {
    const el = attrs.multiline ? h('textarea', { rows: attrs.rows || 4, ...attrs.attrs }) : h('input', { type: attrs.type || 'text', autocomplete: 'off', ...attrs.attrs });
    el.addEventListener('input', () => { form[key] = el.value; schedule(); });
    form[key] = el.value;
    return field(label, el, hint).root;
  };
  const fieldsets = {
    url: () => [inp('url', 'ลิงก์เว็บไซต์', { type: 'text', attrs: { inputmode: 'url', placeholder: 'https://example.com' } }, 'ถ้าไม่พิมพ์ https:// ระบบจะเติมให้อัตโนมัติ')],
    text: () => [inp('text', 'ข้อความ', { multiline: true, rows: 5, attrs: { placeholder: 'พิมพ์ข้อความที่ต้องการ' } })],
    wifi: () => {
      const enc = h('select', { onchange: () => { form.encryption = enc.value; pass.querySelector('input').disabled = enc.value === 'nopass'; schedule(); } },
        h('option', { value: 'WPA' }, 'WPA/WPA2/WPA3'), h('option', { value: 'WEP' }, 'WEP'), h('option', { value: 'nopass' }, 'ไม่มีรหัสผ่าน'));
      form.encryption = 'WPA';
      const pass = inp('password', 'รหัสผ่าน');
      const hid = h('input', { type: 'checkbox', id: 'wifi-hidden', onchange: () => { form.hidden = hid.checked; schedule(); } });
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
    type = id; for (const k of Object.keys(form)) delete form[k];
    fieldHost.replaceChildren(...fieldsets[id]()); renderTabs(); schedule.flush();
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
  function setButtons(on) { [btnPng, btnSvg, btnCopyImg, btnCopyTxt].forEach((b) => { b.disabled = !on; }); }

  const schedule = debounce(generate, 120);
  function generate() {
    warn.replaceChildren();
    const payload = PAYLOADS[type](form);
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
    info.textContent = `${matrix.size}×${matrix.size} โมดูล · ${byteLength(payload).toLocaleString()} ไบต์ · ไฟล์ PNG ${canvas.width}×${canvas.height} px`;
    const cr = contrastRatio(o.fg, o.bg);
    if (cr < 3) warn.append(h('div', { class: 'notice notice-warn', role: 'status' }, svgIcon(ICONS.alert), h('div', null, 'สีตัว QR กับสีพื้นหลังต่างกันน้อยเกินไป อาจสแกนไม่ติด ควรใช้สีเข้มบนพื้นสว่าง')));
    else if (o.fg.toLowerCase() === '#ffffff' || parseInt(o.fg.slice(1), 16) > parseInt(o.bg.slice(1), 16)) warn.append(h('div', { class: 'notice notice-warn', role: 'status' }, svgIcon(ICONS.alert), h('div', null, 'QR แบบสีสว่างบนพื้นเข้ม (กลับสี) บางแอปสแกนไม่ได้ ควรทดสอบสแกนก่อนใช้งานจริง')));
    if (logoImage && ecIn.value !== 'H') warn.append(h('div', { class: 'notice notice-warn' }, svgIcon(ICONS.alert), h('div', null, 'มีโลโก้กลาง QR แนะนำให้ใช้ระดับแก้ไขข้อผิดพลาด H')));
  }

  function fileBase() { return ({ url: 'qr-link', text: 'qr-text', wifi: 'qr-wifi', email: 'qr-email', phone: 'qr-phone', sms: 'qr-sms', vcard: 'qr-contact' })[type]; }
  function downloadPng() {
    if (!current) return;
    canvas.toBlob((b) => { if (b) downloadBlob(b, `${fileBase()}.png`); else toast('สร้างไฟล์ PNG ไม่สำเร็จ', 'error'); }, 'image/png');
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

  root.append(h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'QR Code Generator'), h('p', null, 'สร้าง QR Code ในเบราว์เซอร์ ข้อมูลไม่ถูกส่งออกไปที่ใด'))),
    h('div', { class: 'two-col' },
      h('div', null,
        h('div', { class: 'card' }, tabs, fieldHost),
        h('div', { class: 'card' }, h('h2', null, 'ปรับแต่ง'),
          h('div', { class: 'grid-2' },
            field('ขนาดภาพ (px)', sizeIn).root, field('ขอบขาว (โมดูล)', marginIn).root,
            field('ระดับแก้ไขข้อผิดพลาด', ecIn).root, field('รูปแบบจุด', styleIn).root,
            h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'สี QR'), fgIn), h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'สีพื้นหลัง'), bgIn)),
          field('โลโก้กลาง QR (ไม่บังคับ)', logoIn, 'ใช้ PNG/JPG/WEBP/SVG ไม่เกิน 2 MB').root, logoClear)),
      h('div', { class: 'qr-preview card' }, placeholder, canvasWrap, info, warn,
        h('div', { class: 'btn-row', style: 'justify-content:center' }, btnPng, btnSvg, btnCopyImg, btnCopyTxt)))));
  setType('url');
}
