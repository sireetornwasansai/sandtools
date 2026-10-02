import { h, field, svgIcon, formatBytes } from '../core/dom.js';
import { ICONS } from '../core/icons.js';
import { downloadText, downloadBlob, copyText } from '../core/download.js';
import { toast } from '../core/toast.js';
import { record } from '../core/logger.js';
import { MAX_FILE_BYTES } from '../core/config.js';
import { convertFile, ACCEPT } from './converters/index.js';
import { getJSZip } from './converters/common.js';

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const yamlStr = (s) => JSON.stringify(s.replace(/\s+/g, ' ').trim());

/** Build SKILL.md: YAML front matter (name, description) + instructions for an AI agent. */
export function buildSkill({ name, description, when, body }) {
  const n = slug(name) || 'my-skill';
  return `---\nname: ${n}\ndescription: ${yamlStr(description || `ความรู้และขั้นตอนสำหรับงาน ${name}`)}\n---\n\n# ${name || n}\n\n## ใช้เมื่อ\n${(when || '').split('\n').filter(Boolean).map((x) => `- ${x.replace(/^[-*]\s*/, '')}`).join('\n') || '- ผู้ใช้ถามหรือขอให้ทำงานที่เกี่ยวข้องกับเนื้อหาด้านล่าง'}\n\n## แนวทางการทำงาน\n1. อ่านเนื้อหาอ้างอิงด้านล่างก่อนตอบทุกครั้ง\n2. ตอบตามเนื้อหาอ้างอิงเท่านั้น หากไม่มีข้อมูลให้บอกว่าไม่พบ\n3. ตอบเป็นภาษาไทย กระชับ และระบุหัวข้อที่อ้างอิง\n\n## เนื้อหาอ้างอิง\n\n${(body || '').trim()}\n`;
}

export function mount(root) {
  const nameIn = h('input', { type: 'text', placeholder: 'เช่น คู่มือการเบิกจ่ายพัสดุ' }); const descIn = h('textarea', { rows: 2, placeholder: 'บอก AI ว่า skill นี้ทำอะไรและเมื่อไรควรใช้' });
  const whenIn = h('textarea', { rows: 3, placeholder: 'หนึ่งบรรทัดต่อหนึ่งสถานการณ์ เช่น ถามขั้นตอนเบิกพัสดุ' });
  const bodyIn = h('textarea', { rows: 14, placeholder: 'วางเนื้อหาที่นี่ หรืออัปโหลดไฟล์ (PDF, Word, PowerPoint, Excel, CSV, HTML, TXT) เพื่อแปลงอัตโนมัติ' });
  const out = h('textarea', { rows: 14, readonly: true, 'aria-label': 'SKILL.md', spellcheck: 'false' }); const status = h('p', { class: 'hint', role: 'status' });
  const render = () => { out.value = buildSkill({ name: nameIn.value, description: descIn.value, when: whenIn.value, body: bodyIn.value }); };
  [nameIn, descIn, whenIn, bodyIn].forEach((e) => e.addEventListener('input', render));
  const fileIn = h('input', { type: 'file', accept: ACCEPT, 'aria-label': 'อัปโหลดไฟล์ต้นฉบับ', onchange: async () => {
    const f = fileIn.files && fileIn.files[0]; fileIn.value = ''; if (!f) return;
    status.textContent = `กำลังแปลง ${f.name} (${formatBytes(f.size)})…`;
    try {
      const r = await convertFile(f, { maxBytes: MAX_FILE_BYTES, timeoutMs: 60000, onStage() {}, onProgress() {} });
      bodyIn.value = r.markdown; if (!nameIn.value) nameIn.value = f.name.replace(/\.[^.]+$/, '');
      status.textContent = `แปลงแล้ว ${r.markdown.length.toLocaleString('th-TH')} ตัวอักษร`; render();
      record('skill', 'convert', { fileName: f.name, sizeIn: f.size, sizeOut: r.markdown.length, inputs: [f] });
    } catch (e) { status.textContent = e && e.name === 'ConversionError' ? e.message : 'แปลงไฟล์ไม่สำเร็จ'; }
  } });
  const file = () => `${slug(nameIn.value) || 'my-skill'}`;
  root.append(h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'สร้าง skill.md'), h('p', null, 'แปลงเอกสารเป็นไฟล์ SKILL.md ให้ AI อ่านและนำไปใช้ได้ง่าย'))),
    h('div', { class: 'two-col' },
      h('div', { class: 'card' }, field('ชื่อ skill', nameIn).root, field('คำอธิบาย (description)', descIn).root, field('ใช้เมื่อ', whenIn).root,
        field('อัปโหลดไฟล์ต้นฉบับ', fileIn).root, status, field('เนื้อหาอ้างอิง', bodyIn).root),
      h('div', { class: 'card' }, h('h2', null, 'ตัวอย่าง SKILL.md'), out,
        h('div', { class: 'btn-row', style: 'margin-top:.75rem' },
          h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { downloadText(out.value, 'SKILL.md', 'text/markdown'); record('skill', 'download', { fileName: file(), sizeOut: out.value.length }); } }, svgIcon(ICONS.download, 18), 'ดาวน์โหลด SKILL.md'),
          h('button', { class: 'btn', type: 'button', onclick: async () => { const Z = await getJSZip(); const z = new Z(); z.file(`${file()}/SKILL.md`, out.value); downloadBlob(await z.generateAsync({ type: 'blob' }), `${file()}.zip`); } }, svgIcon(ICONS.download, 18), 'ดาวน์โหลดเป็นโฟลเดอร์ (ZIP)'),
          h('button', { class: 'btn', type: 'button', onclick: async () => toast((await copyText(out.value)) ? 'คัดลอกแล้ว' : 'คัดลอกไม่สำเร็จ', 'info') }, svgIcon(ICONS.copy, 18), 'คัดลอก'))))));
  render();
}
