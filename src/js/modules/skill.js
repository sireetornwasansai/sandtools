import { h, field, svgIcon, formatBytes, debounce } from '../core/dom.js';
import { ICONS } from '../core/icons.js';
import { downloadText, downloadBlob, copyText } from '../core/download.js';
import { toast } from '../core/toast.js';
import { record } from '../core/logger.js';
import { MAX_FILE_BYTES } from '../core/config.js';
import { convertFile, ACCEPT } from './converters/index.js';
import { getJSZip } from './converters/common.js';
import { analyze, buildPackage, lint, scanPii, redact, suggestName, suggestDescription, KINDS } from './skill-engine.js';

const LV = { error: ['ต้องแก้', 'status-err'], warn: ['ควรแก้', ''], tip: ['แนะนำ', 'muted'], ok: ['ผ่าน', 'status-ok'] };

export function mount(root) {
  const touched = { name: false, desc: false }; let srcName = ''; let pkg = null; let selected = 'SKILL.md';
  const nameIn = h('input', { type: 'text', placeholder: 'ชื่อภาษาอังกฤษ เช่น procurement-guide', autocomplete: 'off' });
  const descIn = h('textarea', { rows: 4, placeholder: 'สร้างให้อัตโนมัติจากเนื้อหา — แก้ไขเองได้' });
  const whenIn = h('textarea', { rows: 2, placeholder: 'ตัวอย่างสถานการณ์ หนึ่งบรรทัดต่อหนึ่งข้อ (ไม่บังคับ)' });
  const bodyIn = h('textarea', { rows: 12, placeholder: 'วางเนื้อหา หรืออัปโหลดไฟล์ด้านบน (PDF, Word, PowerPoint, Excel, CSV, HTML, TXT)' });
  const splitIn = h('select', null, h('option', { value: 'auto' }, 'อัตโนมัติ (แยกเมื่อเอกสารยาว)'), h('option', { value: 'always' }, 'แยกไฟล์อ้างอิงเสมอ'), h('option', { value: 'never' }, 'รวมใน SKILL.md ไฟล์เดียว'));
  const redactIn = h('input', { type: 'checkbox', id: 'sk-redact' });
  const status = h('p', { class: 'hint', role: 'status' });
  const analysis = h('div'); const tree = h('div', { class: 'file-list' }); const out = h('textarea', { rows: 16, readonly: true, 'aria-label': 'ตัวอย่างไฟล์', spellcheck: 'false' });
  nameIn.addEventListener('input', () => { touched.name = true; refresh(); }); descIn.addEventListener('input', () => { touched.desc = true; refresh(); });
  [whenIn, splitIn, redactIn].forEach((e) => e.addEventListener('input', () => { if (!touched.desc) descIn.value = ''; refresh(); }));
  bodyIn.addEventListener('input', () => refresh());

  const refresh = debounce(() => {
    let md = bodyIn.value; if (redactIn.checked) md = redact(md);
    const a = analyze(md);
    if (!touched.name) nameIn.value = md.trim() ? suggestName(a, srcName) : '';
    if (!touched.desc) descIn.value = md.trim() ? suggestDescription(a, whenIn.value) : '';
    pkg = buildPackage({ name: nameIn.value, description: descIn.value, when: whenIn.value, md, a, split: splitIn.value });
    const q = lint(pkg, md); if (!pkg.files[selected]) selected = 'SKILL.md';
    const col = q.score >= 85 ? 'var(--success)' : q.score >= 60 ? 'var(--warning)' : 'var(--error)';
    analysis.replaceChildren(
      h('div', { class: 'sk-score' }, h('div', { class: 'sk-num', style: `color:${col}` }, String(q.score)), h('div', null, h('b', null, 'คะแนนคุณภาพ'), h('div', { class: 'progress' }, h('span', { style: `width:${q.score}%;background:${col}` })))),
      md.trim() ? h('div', { class: 'chip-row', style: 'margin:.75rem 0' }, h('span', { class: 'pill' }, `ประเภท: ${KINDS[a.kind].label}`), h('span', { class: 'pill' }, `${a.words.toLocaleString('th-TH')} คำ`), h('span', { class: 'pill' }, `${a.headings} หัวข้อ`), a.steps ? h('span', { class: 'pill' }, `${a.steps} ขั้นตอน`) : null, a.tables ? h('span', { class: 'pill' }, `${a.tables} แถวตาราง`) : null, pkg.split ? h('span', { class: 'pill' }, 'แยกไฟล์อ้างอิงแล้ว') : null) : null,
      a.topics.length ? h('p', { class: 'hint' }, `คำสำคัญที่พบ: ${a.topics.join(', ')}`) : null,
      h('ul', { class: 'sk-issues' }, q.issues.map((i) => h('li', null, h('b', { class: LV[i.level][1] }, `${LV[i.level][0]} `), i.msg))),
      scanPii(bodyIn.value).length && !redactIn.checked ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { redactIn.checked = true; refresh.flush(); } }, 'ปิดบังข้อมูลส่วนบุคคลให้ทั้งหมด') : null);
    tree.replaceChildren(...Object.keys(pkg.files).map((f) => h('button', { class: 'hist-row', type: 'button', 'aria-pressed': String(f === selected), onclick: () => { selected = f; out.value = pkg.files[f]; tree.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.f === f))); }, dataset: { f } },
      svgIcon(ICONS.file, 18), h('span', { class: 'hist-main' }, h('b', null, f), h('small', { class: 'muted' }, formatBytes(new Blob([pkg.files[f]]).size)))))); 
    out.value = pkg.files[selected];
  }, 250);

  const fileIn = h('input', { type: 'file', accept: ACCEPT, 'aria-label': 'อัปโหลดไฟล์ต้นฉบับ', onchange: async () => {
    const f = fileIn.files && fileIn.files[0]; fileIn.value = ''; if (!f) return;
    status.textContent = `กำลังแปลง ${f.name} (${formatBytes(f.size)})…`;
    try {
      const r = await convertFile(f, { maxBytes: MAX_FILE_BYTES, timeoutMs: 60000, onStage() {}, onProgress() {} });
      srcName = f.name; bodyIn.value = r.markdown; touched.name = false; touched.desc = false; status.textContent = `แปลงแล้ว ${r.markdown.length.toLocaleString('th-TH')} ตัวอักษร`; refresh.flush();
      record('skill', 'convert', { fileName: f.name, sizeIn: f.size, sizeOut: r.markdown.length, inputs: [f] });
    } catch (e) { status.textContent = e && e.name === 'ConversionError' ? e.message : 'แปลงไฟล์ไม่สำเร็จ'; }
  } });

  const zip = async () => { const Z = await getJSZip(); const z = new Z(); for (const [p, c] of Object.entries(pkg.files)) z.file(`${pkg.name}/${p}`, c); const b = await z.generateAsync({ type: 'blob', compression: 'DEFLATE' }); downloadBlob(b, `${pkg.name}.zip`); record('skill', 'download_zip', { fileName: pkg.name, sizeOut: b.size, extra: { files: Object.keys(pkg.files).length }, outputs: [b], outputName: `${pkg.name}.zip` }); };
  root.append(h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'สร้าง skill.md'), h('p', null, 'วิเคราะห์เอกสาร สร้างชื่อ คำอธิบาย และโครงสร้างให้ตามหลักเขียน skill ตรวจคุณภาพก่อนนำไปใช้'))),
    h('div', { class: 'two-col' },
      h('div', null, h('div', { class: 'card' }, field('อัปโหลดไฟล์ต้นฉบับ', fileIn).root, status, field('เนื้อหาอ้างอิง', bodyIn).root, field('ใช้เมื่อ (ไม่บังคับ)', whenIn).root),
        h('div', { class: 'card' }, h('h2', null, 'ข้อมูล skill'), field('ชื่อ skill', nameIn).root, field('คำอธิบาย (description)', descIn, 'ข้อความนี้ AI ใช้ตัดสินว่าจะเปิด skill เมื่อไร').root, field('การแบ่งไฟล์', splitIn).root,
          h('div', { class: 'check' }, redactIn, h('label', { for: 'sk-redact' }, 'ปิดบังข้อมูลส่วนบุคคล (เลขบัตร เบอร์โทร อีเมล HN/AN)')))),
      h('div', null, h('div', { class: 'card' }, h('h2', null, 'ผลวิเคราะห์'), analysis),
        h('div', { class: 'card' }, h('h2', null, 'ไฟล์ที่จะได้'), tree, out,
          h('div', { class: 'btn-row', style: 'margin-top:.75rem' },
            h('button', { class: 'btn btn-primary', type: 'button', onclick: zip }, svgIcon(ICONS.download, 18), 'ดาวน์โหลดโฟลเดอร์ (ZIP)'),
            h('button', { class: 'btn', type: 'button', onclick: () => { downloadText(pkg.files['SKILL.md'], 'SKILL.md', 'text/markdown'); record('skill', 'download', { fileName: pkg.name, sizeOut: pkg.files['SKILL.md'].length }); } }, svgIcon(ICONS.download, 18), 'SKILL.md อย่างเดียว'),
            h('button', { class: 'btn', type: 'button', onclick: async () => toast((await copyText(out.value)) ? 'คัดลอกแล้ว' : 'คัดลอกไม่สำเร็จ', 'info') }, svgIcon(ICONS.copy, 18), 'คัดลอก'))))))); 
  refresh.flush();
}
