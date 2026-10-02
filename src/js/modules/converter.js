import { h, svgIcon, formatBytes } from '../core/dom.js';
import { ICONS } from '../core/icons.js';
import { config, MAX_FILE_BYTES } from '../core/config.js';
import { downloadText, copyText } from '../core/download.js';
import { toast } from '../core/toast.js';
import { takePendingFile } from '../core/handoff.js';
import { privacyNotice, notice } from '../core/notices.js';
import { convertFile, detectFormat, FORMATS, ACCEPT } from './converters/index.js';

const STAGES = [['reading', 'อ่านไฟล์'], ['converting', 'กำลังแปลง'], ['done', 'เสร็จเรียบร้อย']];

/** @param {HTMLElement} root @param {{params?: URLSearchParams, navigate?: Function}} [_ctx] */
export function mount(root, _ctx) {
  let busy = false;
  const zoneHost = h('div');
  const statusHost = h('div', { role: 'status', 'aria-live': 'polite' });
  const resultHost = h('div');

  const input = h('input', { type: 'file', accept: ACCEPT, class: 'sr-only', tabindex: '-1', 'aria-label': 'เลือกไฟล์ที่ต้องการแปลง',
    onchange: () => { const f = input.files && input.files[0]; input.value = ''; if (f) start(f); } });

  function renderZone() {
    const zone = h('div', { class: 'dropzone', role: 'button', tabindex: '0', 'aria-label': 'วางไฟล์ที่นี่ หรือกดเพื่อเลือกไฟล์', 'data-dropzone': '',
      onclick: () => input.click(),
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } },
      ondragover: (e) => { e.preventDefault(); zone.classList.add('over'); },
      ondragleave: () => zone.classList.remove('over'),
      ondrop: (e) => { e.preventDefault(); e.stopPropagation(); zone.classList.remove('over'); document.body.classList.remove('dragging'); const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) start(f); } },
    svgIcon(ICONS.upload, 36), h('div', { class: 'big' }, 'วางไฟล์ที่นี่'), h('div', null, 'หรือ ', h('u', null, 'เลือกไฟล์จากเครื่อง')),
    h('div', { class: 'muted' }, `PDF · Word (.docx) · PowerPoint (.pptx) · Excel (.xlsx) · CSV · HTML · TXT · รูปภาพ — ไม่เกิน ${config.maxFileSizeMB} MB`));
    zoneHost.replaceChildren(zone, input);
  }

  function stepList(active) {
    const idx = STAGES.findIndex((s) => s[0] === active);
    return h('ol', { class: 'steps', 'aria-label': 'ขั้นตอนการแปลง' }, STAGES.map(([id, label], i) => h('li', { class: i < idx || active === 'done' ? 'done' : i === idx ? 'active' : '', 'aria-current': i === idx ? 'step' : null }, `${i + 1}. ${label}`)));
  }

  function friendlyError(e, file) {
    const known = e && e.name === 'ConversionError';
    const title = known && ['UNSUPPORTED', 'TOO_LARGE', 'EMPTY'].includes(e.code) ? e.message : 'ไม่สามารถแปลงไฟล์นี้ได้';
    const reason = known ? (title === e.message ? '' : e.message) : 'ไฟล์อาจไม่รองรับ หรือไฟล์เสียหาย';
    const detail = [`ไฟล์: ${file.name}`, `ขนาด: ${file.size} ไบต์`, `ชนิด: ${file.type || '-'}`, known ? `รหัส: ${e.code}` : `ข้อผิดพลาด: ${e && e.message}`, known && e.detail ? e.detail : ''].filter(Boolean).join('\n');
    return h('div', { class: 'notice notice-error', role: 'alert' }, svgIcon(ICONS.alert),
      h('div', null, h('strong', null, title), reason ? h('p', null, reason) : null,
        h('details', { class: 'tech' }, h('summary', null, 'รายละเอียด'), h('pre', null, detail)),
        h('div', { class: 'btn-row', style: 'margin-top:.5rem' }, h('button', { class: 'btn', type: 'button', onclick: reset }, 'ลองไฟล์อื่น'))));
  }

  function reset() { busy = false; statusHost.replaceChildren(); resultHost.replaceChildren(); renderZone(); zoneHost.querySelector('.dropzone').focus(); }

  async function start(file) {
    if (busy) return;
    const fmt = detectFormat(file.name);
    if (!fmt) { toast('ไม่รองรับไฟล์ประเภทนี้', 'error'); return; }
    busy = true; resultHost.replaceChildren(); zoneHost.replaceChildren();
    const meta = h('div', { class: 'file-meta' }, h('span', null, h('b', null, file.name)), h('span', null, FORMATS[fmt].label), h('span', null, formatBytes(file.size)));
    const bar = h('div', { class: 'progress indeterminate', role: 'progressbar', 'aria-label': 'ความคืบหน้าการแปลง' }, h('span'));
    const steps = h('div'); steps.append(stepList('reading'));
    statusHost.replaceChildren(h('div', { class: 'card' }, meta, steps, bar));
    const setBar = (f) => { bar.classList.remove('indeterminate'); bar.firstElementChild.style.width = `${Math.round(f * 100)}%`; bar.setAttribute('aria-valuenow', String(Math.round(f * 100))); };
    try {
      const r = await convertFile(file, {
        maxBytes: MAX_FILE_BYTES, timeoutMs: Math.max(5, config.conversionTimeoutSec) * 1000,
        onStage: (s) => steps.replaceChildren(stepList(s)), onProgress: setBar
      });
      steps.replaceChildren(stepList('done')); setBar(1);
      showResult(file, r);
    } catch (e) {
      if (!(e && e.name === 'ConversionError')) console.error(e); // expected, user-facing failures are not logged as errors
      statusHost.replaceChildren(h('div', { class: 'card' }, meta), friendlyError(e, file));
    } finally { busy = false; }
  }

  function showResult(file, r) {
    const text = h('textarea', { rows: 16, readonly: true, 'aria-label': 'ผลลัพธ์ Markdown', spellcheck: 'false' }, '');
    text.value = r.markdown;
    const previewBox = h('div', { class: 'md-preview card', hidden: true, 'aria-label': 'ตัวอย่าง Markdown' });
    let rendered = false;
    const previewBtn = h('button', { class: 'btn', type: 'button', onclick: async () => {
      const show = previewBox.hidden;
      if (show && !rendered) { const { renderMarkdown } = await import('./markdown-render.js'); previewBox.innerHTML = renderMarkdown(r.markdown, { remoteImages: false }); rendered = true; }
      previewBox.hidden = !show; text.hidden = show; previewBtn.lastChild.textContent = show ? 'ดูโค้ด Markdown' : 'ดูตัวอย่าง';
    } }, svgIcon(ICONS.eye, 18), h('span', null, 'ดูตัวอย่าง'));
    const empty = !r.markdown.trim();
    statusHost.querySelector('.card') && statusHost.querySelector('.card').append(h('p', { class: 'muted', style: 'margin-top:.5rem' }, `แปลงเสร็จใน ${(r.ms / 1000).toFixed(1)} วินาที · ${r.markdown.length.toLocaleString('th-TH')} ตัวอักษร`));
    resultHost.replaceChildren(
      empty ? notice('warn', 'แปลงเสร็จแต่ไม่พบข้อความ', 'ไฟล์อาจไม่มีข้อความ หรือเป็นรูปภาพ') : notice('success', 'แปลงไฟล์เรียบร้อย', `บันทึกเป็น ${r.filename}`),
      ...r.warnings.map((w) => notice('warn', 'หมายเหตุ', w)),
      h('div', { class: 'btn-row', style: 'margin-bottom:.75rem' }, previewBtn,
        h('button', { class: 'btn', type: 'button', onclick: () => downloadText(r.markdown, r.filename, 'text/markdown') }, svgIcon(ICONS.download, 18), `ดาวน์โหลด ${r.filename}`),
        h('button', { class: 'btn', type: 'button', onclick: async () => toast((await copyText(r.markdown)) ? 'คัดลอก Markdown แล้ว' : 'คัดลอกไม่สำเร็จ', 'info') }, svgIcon(ICONS.copy, 18), 'คัดลอก Markdown'),
        h('button', { class: 'btn', type: 'button', onclick: reset }, svgIcon(ICONS.plus, 18), 'แปลงไฟล์อื่น')),
      text, previewBox);
    resultHost.querySelector('button').focus();
  }

  root.append(h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'File Converter'), h('p', null, 'แปลงเอกสารเป็น Markdown — วางไฟล์ แปลง แล้วดาวน์โหลดหรือคัดลอกได้ทันที'))),
    privacyNotice({ detail: 'การแปลงทำงานในเบราว์เซอร์ของคุณทั้งหมด ไฟล์ไม่ถูกอัปโหลดหรือเก็บไว้ที่เซิร์ฟเวอร์ใด ๆ' }),
    zoneHost, statusHost, resultHost,
    h('details', { class: 'card', style: 'margin-top:1rem' }, h('summary', null, 'ข้อจำกัดของการแปลง'),
      h('ul', null,
        h('li', null, 'PDF: อ่านได้เฉพาะไฟล์ที่มีข้อความ (ไม่ใช่ภาพสแกน) ตารางใน PDF จะเป็นข้อความธรรมดา'),
        h('li', null, 'Word/PowerPoint: แปลงข้อความ หัวข้อ รายการ ตาราง ลิงก์ ไม่รวมกราฟ กล่องข้อความ และรูปภาพ (ระบุเป็นลิงก์รูป)'),
        h('li', null, 'Excel: รองรับ .xlsx (ไฟล์ .xls รุ่นเก่า ให้บันทึกเป็น .xlsx ก่อน) ผลลัพธ์เป็นค่าที่แสดงในเซลล์ ไม่ใช่สูตร'),
        h('li', null, 'รูปภาพ: ให้เฉพาะข้อมูลไฟล์ ไม่มีการอ่านข้อความในรูป (OCR)')))));

  renderZone();
  const pending = takePendingFile();
  if (pending) start(pending);
  return () => { busy = false; };
}
