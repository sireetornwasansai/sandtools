import { h, svgIcon, formatBytes } from '../core/dom.js';
import { ICONS } from '../core/icons.js';
import { config, MAX_FILE_BYTES } from '../core/config.js';
import { downloadBlob, copyText } from '../core/download.js';
import { toast } from '../core/toast.js';
import { takePendingFile } from '../core/handoff.js';
import { privacyNotice, notice } from '../core/notices.js';
import { record, recording, recordingNote } from '../core/logger.js';
import { detectFormat, FORMATS, ACCEPT } from './converters/index.js';
import { convertTo, targetsFor, TARGETS, ALL_TARGETS, DEFAULT_TARGET } from './converters/convert-to.js';

const STAGES = [['reading', 'อ่านไฟล์'], ['converting', 'กำลังแปลง'], ['writing', 'สร้างไฟล์ปลายทาง'], ['done', 'เสร็จเรียบร้อย']];
/** Shown instead when a scanned PDF needs OCR (reading text from the page images). */
const STAGES_OCR = [['reading', 'อ่านไฟล์'], ['ocr', 'อ่านข้อความจากภาพ (OCR)'], ['writing', 'สร้างไฟล์ปลายทาง'], ['done', 'เสร็จเรียบร้อย']];

/** @param {HTMLElement} root @param {{params?: URLSearchParams, navigate?: Function}} [_ctx] */
export function mount(root, _ctx) {
  let busy = false;
  let target = DEFAULT_TARGET;                 // chosen output format (key of TARGETS)
  /** @type {File|null} */ let current = null;  // file being converted: kept so another target can be picked without uploading again
  let convId = 0;                               // ignores the result of a conversion that was replaced by a newer one
  const targetHost = h('div', { class: 'conv-targets' });
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
    h('div', { class: 'muted' }, `PDF · Word (.docx) · PowerPoint (.pptx) · Excel (.xlsx) · CSV · HTML · TXT · Markdown · รูปภาพ — ไม่เกิน ${config.maxFileSizeMB} MB`));
    zoneHost.replaceChildren(zone, input);
  }

  /** "แปลงเป็น" chips: every format before a file is chosen, only the possible ones afterwards. */
  function renderTargets() {
    const list = current ? targetsFor(current.name) : ALL_TARGETS;
    if (current && list.length && !list.includes(target)) target = list.includes(DEFAULT_TARGET) ? DEFAULT_TARGET : list[0];
    targetHost.replaceChildren(
      h('div', { class: 'conv-targets-label' }, current ? `แปลง ${current.name} เป็น` : 'แปลงเป็น'),
      h('div', { class: 'chip-row', role: 'group', 'aria-label': 'รูปแบบไฟล์ปลายทาง' }, list.map((t) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(t === target), disabled: busy ? '' : null,
        onclick: () => { if (busy || t === target) return; target = t; renderTargets(); if (current) start(current); } }, TARGETS[t].label))));
  }

  let stages = STAGES;
  function stepList(active) {
    if (active === 'ocr') stages = STAGES_OCR;
    const idx = stages.findIndex((s) => s[0] === active);
    return h('ol', { class: 'steps', 'aria-label': 'ขั้นตอนการแปลง' }, stages.map(([id, label], i) => h('li', { class: i < idx || active === 'done' ? 'done' : i === idx ? 'active' : '', 'aria-current': i === idx ? 'step' : null }, `${i + 1}. ${label}`)));
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

  function reset() { busy = false; convId += 1; current = null; statusHost.replaceChildren(); resultHost.replaceChildren(); renderTargets(); renderZone(); zoneHost.querySelector('.dropzone').focus(); }

  async function start(file) {
    if (busy) return;
    const fmt = detectFormat(file.name);
    if (!fmt) { toast('ไม่รองรับไฟล์ประเภทนี้', 'error'); return; }
    current = file; busy = true; const my = ++convId; stages = STAGES; resultHost.replaceChildren(); zoneHost.replaceChildren(); renderTargets();
    const meta = h('div', { class: 'file-meta' }, h('span', null, h('b', null, file.name)), h('span', null, FORMATS[fmt].label), h('span', null, '→'), h('span', null, TARGETS[target].label), h('span', null, formatBytes(file.size)));
    const bar = h('div', { class: 'progress indeterminate', role: 'progressbar', 'aria-label': 'ความคืบหน้าการแปลง' }, h('span'));
    const steps = h('div'); steps.append(stepList('reading'));
    const note = h('p', { class: 'muted', style: 'margin-top:.5rem', role: 'status' });   // live detail, e.g. OCR page x of y
    statusHost.replaceChildren(h('div', { class: 'card' }, meta, steps, bar, note));
    const setBar = (f) => { bar.classList.remove('indeterminate'); bar.firstElementChild.style.width = `${Math.round(f * 100)}%`; bar.setAttribute('aria-valuenow', String(Math.round(f * 100))); };
    try {
      const r = await convertTo(file, target, {
        maxBytes: MAX_FILE_BYTES, timeoutMs: Math.max(5, config.conversionTimeoutSec) * 1000,
        onStage: (st) => { if (my === convId) steps.replaceChildren(stepList(st)); }, onProgress: (f) => { if (my === convId) setBar(f); }, onStatus: (t) => { if (my === convId) note.textContent = t; }
      });
      if (my !== convId) return;
      note.textContent = ''; steps.replaceChildren(stepList('done')); setBar(1);
      busy = false; renderTargets();
      showResult(file, r);
      record('converter', `convert:${r.target}`, { fileName: file.name, sizeIn: file.size, sizeOut: r.blob.size, inputs: [file], outputs: [r.blob], outputName: r.filename });
    } catch (e) {
      if (my !== convId) return;
      if (!(e && e.name === 'ConversionError')) console.error(e); // expected, user-facing failures are not logged as errors
      busy = false; renderTargets();
      statusHost.replaceChildren(h('div', { class: 'card' }, meta), friendlyError(e, file));
    } finally { if (my === convId) busy = false; }
  }

  function showResult(file, r) {
    const T = TARGETS[r.target];
    const isText = typeof r.text === 'string';
    const label = r.target === 'md' ? 'Markdown' : T.label;
    const kb = r.blob.size < 1024 * 1024 ? `${(r.blob.size / 1024).toFixed(1)} KB` : `${(r.blob.size / 1024 / 1024).toFixed(1)} MB`;
    statusHost.querySelector('.card') && statusHost.querySelector('.card').append(h('p', { class: 'muted', style: 'margin-top:.5rem' }, `แปลงเสร็จใน ${(r.ms / 1000).toFixed(1)} วินาที · ${isText ? `${r.text.length.toLocaleString('th-TH')} ตัวอักษร` : kb}${r.count > 1 && r.target === 'pdf' ? ` · ${r.count} หน้า` : ''}`));
    const actions = []; let body = [];
    if (isText) {
      const text = h('textarea', { rows: 16, readonly: true, 'aria-label': `ผลลัพธ์ ${label}`, spellcheck: 'false' }, '');
      text.value = r.text; body = [text];
      if (r.target === 'md' || r.target === 'html') {
        const previewBox = h('div', { class: 'md-preview card', hidden: true, 'aria-label': 'ตัวอย่าง' });
        let rendered = false;
        const previewBtn = h('button', { class: 'btn', type: 'button', onclick: async () => {
          const show = previewBox.hidden;
          if (show && !rendered) { const { renderMarkdown } = await import('./markdown-render.js'); previewBox.innerHTML = renderMarkdown(r.markdown || r.text, { remoteImages: false }); rendered = true; }
          previewBox.hidden = !show; text.hidden = show; previewBtn.lastChild.textContent = show ? `ดูโค้ด ${label}` : 'ดูตัวอย่าง';
        } }, svgIcon(ICONS.eye, 18), h('span', null, 'ดูตัวอย่าง'));
        actions.push(previewBtn); body.push(previewBox);
      }
      actions.push(h('button', { class: 'btn', type: 'button', onclick: async () => toast((await copyText(r.text)) ? `คัดลอก ${label} แล้ว` : 'คัดลอกไม่สำเร็จ', 'info') }, svgIcon(ICONS.copy, 18), `คัดลอก ${label}`));
    } else if (T.kind === 'image' && r.blob.type.startsWith('image/')) {
      const url = URL.createObjectURL(r.blob);
      body = [h('div', { class: 'card conv-preview' }, h('img', { src: url, alt: `ตัวอย่าง ${r.filename}`, style: 'max-width:100%;max-height:420px;display:block;margin:auto' }))];
    } else {
      body = [h('div', { class: 'card conv-file' }, svgIcon(ICONS.file, 28), h('div', null, h('b', null, r.filename), h('div', { class: 'muted' }, `${label} · ${kb}${r.count > 1 && r.target !== 'pdf' ? ` · ${r.count} ไฟล์` : ''}`)))];
    }
    if (r.target === 'pdf' && r.markdown) {
      actions.push(h('button', { class: 'btn', type: 'button', onclick: async () => {
        const [{ markdownToHtmlDoc }, { printDocument }] = await Promise.all([import('./converters/write-html.js'), import('./converters/write-pdf.js')]);
        printDocument(markdownToHtmlDoc(r.markdown, { title: file.name }));
      } }, svgIcon(ICONS.file, 18), 'พิมพ์ / บันทึกเป็น PDF (เลือกข้อความได้)'));
    }
    const empty = isText && !r.text.trim();
    resultHost.replaceChildren(
      empty ? notice('warn', 'แปลงเสร็จแต่ไม่พบข้อมูล', 'ไฟล์อาจไม่มีข้อความ หรือเป็นรูปภาพ') : notice('success', 'แปลงไฟล์เรียบร้อย', `บันทึกเป็น ${r.filename}`),
      ...r.warnings.map((w) => notice('warn', 'หมายเหตุ', w)),
      h('div', { class: 'btn-row', style: 'margin-bottom:.75rem' },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => downloadBlob(r.blob, r.filename) }, svgIcon(ICONS.download, 18), `ดาวน์โหลด ${r.filename}`),
        ...actions,
        h('button', { class: 'btn', type: 'button', onclick: reset }, svgIcon(ICONS.plus, 18), 'แปลงไฟล์อื่น')),
      ...body);
    resultHost.querySelector('button').focus();
  }

  root.append(h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'File Converter'), h('p', null, 'แปลงไฟล์ระหว่าง PDF · Word · Excel · PowerPoint · CSV · HTML · ข้อความ · รูปภาพ — เลือกรูปแบบปลายทาง แล้ววางไฟล์'))),
    privacyNotice({ detail: recording() ? `การแปลงทำงานในเบราว์เซอร์ของคุณ · ${recordingNote()}` : 'การแปลงทำงานในเบราว์เซอร์ของคุณทั้งหมด ไฟล์ไม่ถูกอัปโหลดหรือเก็บไว้ที่เซิร์ฟเวอร์ใด ๆ' }),
    targetHost, zoneHost, statusHost, resultHost,
    h('details', { class: 'card', style: 'margin-top:1rem' }, h('summary', null, 'ข้อจำกัดของการแปลง'),
      h('ul', null,
        h('li', null, 'PDF: ไฟล์ที่มีข้อความอ่านได้ตรง ๆ (ตารางจะเป็นข้อความธรรมดา) · ไฟล์ภาพสแกนจะอ่านด้วย OCR ไทย/อังกฤษบนเครื่องของคุณ (ช้ากว่า — ประมาณ 5–15 วินาทีต่อหน้า, ครั้งแรกต้องโหลดตัวอ่านประมาณ 8 MB) ความแม่นยำไม่ถึง 100% โดยเฉพาะเลขไทย กรุณาตรวจทานกับต้นฉบับ'),
        h('li', null, 'Word/PowerPoint: แปลงข้อความ หัวข้อ รายการ ตาราง ลิงก์ ไม่รวมกราฟ กล่องข้อความ และรูปภาพ (ระบุเป็นลิงก์รูป)'),
        h('li', null, 'Excel: รองรับ .xlsx (ไฟล์ .xls รุ่นเก่า ให้บันทึกเป็น .xlsx ก่อน) ผลลัพธ์เป็นค่าที่แสดงในเซลล์ ไม่ใช่สูตร'),
        h('li', null, 'รูปภาพ: แปลงระหว่าง PNG/JPG/WEBP และ PDF ได้ · แปลงเป็นข้อความ/Word/Markdown ด้วย OCR (ต้องติดตั้งไฟล์ OCR)'),
        h('li', null, 'การสร้างไฟล์ปลายทางทำจากเนื้อหาที่อ่านได้ (หัวข้อ ข้อความ รายการ ตาราง) แล้วจัดหน้าใหม่ จึงไม่ใช่การคัดลอกหน้าตาต้นฉบับทุกจุด · PDF ที่สร้างเป็นภาพหน้ากระดาษ ถ้าต้องการข้อความที่เลือกได้ให้ใช้ “พิมพ์ / บันทึกเป็น PDF”')))));

  renderTargets(); renderZone();
  const pending = takePendingFile();
  if (pending) start(pending);
  return () => { busy = false; };
}
