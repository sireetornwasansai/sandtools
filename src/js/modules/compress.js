import { h, field, svgIcon, formatBytes } from '../core/dom.js';
import { ICONS } from '../core/icons.js';
import { downloadBlob, withExt, baseName } from '../core/download.js';
import { toast } from '../core/toast.js';
import { record, recording, recordingNote } from '../core/logger.js';
import { shrinkOffice, shrinkPdf } from './shrink-docs.js';
import { getJSZip } from './converters/common.js';

const IMG = /\.(jpe?g|png|webp)$/i;

/** Re-encode an image: scale down to maxDim and save as JPEG/WebP at the given quality. */
async function shrinkImage(file, { maxDim, quality, mime }) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode'))), mime, quality));
}

export function mount(root) {
  const q = h('input', { type: 'range', min: '30', max: '95', value: '70', 'aria-label': 'คุณภาพ' });
  const qv = h('b', null, '70%'); q.addEventListener('input', () => { qv.textContent = `${q.value}%`; });
  const dim = h('select', null, [[1280, 'เล็ก — 1280 px (ส่งไลน์/อีเมล)'], [1920, 'กลาง — 1920 px (เอกสารทั่วไป)'], [3000, 'ใหญ่ — 3000 px (พิมพ์)'], [99999, 'ไม่ลดขนาดภาพ']].map(([v, t], i) => h('option', { value: v, selected: i === 1 }, t)));
  const fmt = h('select', null, h('option', { value: 'image/jpeg' }, 'JPEG (เข้ากันได้ทุกที่)'), h('option', { value: 'image/webp' }, 'WebP (เล็กกว่า)'));
  const list = h('div'); const results = [];
  const input = h('input', { type: 'file', multiple: true, class: 'sr-only', tabindex: '-1', accept: '.jpg,.jpeg,.png,.webp,.pdf,.docx,.pptx,.xlsx,.txt,.csv', 'aria-label': 'เลือกไฟล์',
    onchange: () => { const fs = Array.from(input.files || []); input.value = ''; run(fs); } });
  const zone = h('div', { class: 'dropzone', role: 'button', tabindex: '0', onclick: () => input.click(),
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } },
    ondragover: (e) => { e.preventDefault(); zone.classList.add('over'); }, ondragleave: () => zone.classList.remove('over'),
    ondrop: (e) => { e.preventDefault(); e.stopPropagation(); zone.classList.remove('over'); document.body.classList.remove('dragging'); run(Array.from(e.dataTransfer.files)); } },
    svgIcon(ICONS.upload, 36), h('div', { class: 'big' }, 'วางไฟล์ที่ต้องการย่อ'), h('div', null, 'หรือ ', h('u', null, 'เลือกไฟล์จากเครื่อง')),
    h('div', { class: 'muted' }, 'รูปภาพ · PDF (แปลงเป็นภาพ ข้อความจะเลือกไม่ได้) · Word/PowerPoint/Excel (ย่อรูปในไฟล์) · ไฟล์อื่นรวมเป็น ZIP'));
  const zipAll = h('button', { class: 'btn btn-primary', type: 'button', hidden: true, onclick: bundle }, svgIcon(ICONS.download, 18), 'ดาวน์โหลดทั้งหมดเป็น ZIP');

  async function run(files) {
    if (!files.length) return;
    for (const f of files) {
      const row = h('div', { class: 'result-row' }, h('b', null, f.name), h('span', { class: 'muted' }, `${formatBytes(f.size)} → กำลังย่อ…`));
      list.append(row);
      try {
        const isImg = IMG.test(f.name);
        let blob; let name;
        if (isImg) {
          const mime = fmt.value; blob = await shrinkImage(f, { maxDim: Number(dim.value), quality: Number(q.value) / 100, mime });
          name = withExt(f.name, mime === 'image/webp' ? 'webp' : 'jpg');
          if (blob.size >= f.size) { blob = f; name = f.name; }
        } else if (/\.pdf$/i.test(f.name)) {
          blob = await shrinkPdf(f, { quality: Number(q.value) / 100, onPage: (i, n) => { row.lastChild.textContent = `ย่อหน้า ${i}/${n}…`; } }); name = f.name;
          if (blob.size >= f.size) { blob = f; }
          else toast('PDF ที่ย่อแล้วเป็นภาพ — เลือกข้อความในไฟล์ไม่ได้', 'info', 5000);
        } else if (/\.(docx|pptx|xlsx)$/i.test(f.name)) {
          const r = await shrinkOffice(f, { maxDim: Number(dim.value), quality: Number(q.value) / 100 }); blob = r.size === undefined && r.blob.size < f.size ? r.blob : f; name = f.name;
        } else {
          const JSZip = await getJSZip(); const z = new JSZip(); z.file(f.name, f);
          blob = await z.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 9 } }); name = `${baseName(f.name)}.zip`;
          if (blob.size >= f.size * 0.98) { blob = f; name = f.name; }
        }
        const saved = Math.max(0, Math.round((1 - blob.size / f.size) * 100));
        results.push({ name, blob });
        row.replaceChildren(h('b', null, name), h('span', null, `${formatBytes(f.size)} → ${formatBytes(blob.size)}`), h('span', { class: saved ? 'status-ok' : 'muted' }, saved ? `ลดลง ${saved}%` : 'ย่อเพิ่มไม่ได้ (ใช้ไฟล์เดิม)'),
          h('button', { class: 'btn btn-sm', type: 'button', onclick: () => downloadBlob(blob, name) }, svgIcon(ICONS.download, 16), 'ดาวน์โหลด'));
        record('compress', 'shrink', { fileName: f.name, sizeIn: f.size, sizeOut: blob.size, inputs: [f], outputs: [blob], outputName: name }).then((ok) => ok && toast('บันทึกประวัติและสำเนาไฟล์แล้ว', 'info'));
      } catch { row.replaceChildren(h('b', null, f.name), h('span', { class: 'status-err' }, 'ย่อไฟล์นี้ไม่ได้ (ไฟล์อาจเสียหายหรือไม่รองรับ)')); record('compress', 'shrink', { fileName: f.name, sizeIn: f.size, status: 'error' }); }
    }
    zipAll.hidden = results.length < 2;
  }
  async function bundle() {
    const JSZip = await getJSZip(); const z = new JSZip(); const used = new Set();
    for (const r of results) { let n = r.name; for (let i = 2; used.has(n); i++) n = r.name.replace(/(\.[^.]*)?$/, `-${i}$1`); used.add(n); z.file(n, r.blob); }
    downloadBlob(await z.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 9 } }), 'sand-compressed.zip');
  }

  root.append(h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'ย่อไฟล์'), h('p', null, 'ลดขนาดรูปภาพและรวมไฟล์เป็น ZIP เพื่อส่งอีเมล ไลน์ หรืออัปโหลดเข้าระบบ'))),
    recording() ? h('div', { class: 'notice' }, svgIcon(ICONS.eye), h('div', null, recordingNote())) : null,
    h('div', { class: 'card' }, h('div', { class: 'grid-2' }, field('ขนาดภาพสูงสุด', dim).root, field('รูปแบบไฟล์ภาพ', fmt).root,
      h('div', { class: 'field' }, h('label', null, 'คุณภาพภาพ ', qv), q))),
    zone, input, h('div', { class: 'card results' }, list, h('div', { class: 'btn-row' }, zipAll))));
}
