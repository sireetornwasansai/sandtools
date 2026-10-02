import { h, field, svgIcon } from '../core/dom.js';
import { ICONS } from '../core/icons.js';
import { downloadText, copyText } from '../core/download.js';
import { toast } from '../core/toast.js';
import { record } from '../core/logger.js';

const LINE = (label, v) => (v && v.trim() ? `- ${label}: ${v.trim()}\n` : '');
const SAFE = '\n## ข้อกำหนดด้านข้อมูล\n- ใช้ข้อมูลตัวอย่างสมมติเท่านั้น ห้ามใส่ข้อมูลผู้ป่วยจริง และออกแบบให้สอดคล้อง PDPA (เก็บเท่าที่จำเป็น ระบุสิทธิ์การเข้าถึง)\n';

/** Prompt templates. Each field: [key, label, placeholder, multiline?] */
const KINDS = {
  web: { title: 'สร้างเว็บ/แอป', fields: [
    ['name', 'ชื่อโปรเจกต์', 'เช่น ระบบจองห้องประชุม รพ.สต.'], ['goal', 'เป้าหมายของเว็บ', 'ผู้ใช้ทำอะไรได้บ้าง และแก้ปัญหาอะไร', 1], ['users', 'ผู้ใช้งาน', 'เช่น เจ้าหน้าที่ธุรการ 10 คน ใช้บนมือถือเป็นหลัก'],
    ['features', 'ฟีเจอร์ที่ต้องมี', 'หนึ่งบรรทัดต่อหนึ่งฟีเจอร์', 1], ['style', 'สไตล์/โทนสี', 'เช่น สะอาด ขาว-ฟ้า แบบเว็บราชการสมัยใหม่'],
    ['stack', 'เทคโนโลยี', 'HTML/CSS/JS ล้วน, ฝั่งหลังบ้าน Google Apps Script + Google Sheet, โฮสต์ที่ Vercel'], ['limits', 'ข้อจำกัด', 'เช่น ไม่มีงบ ใช้ภาษาไทย ต้องใช้งานได้ในเน็ตช้า']],
    build: (v) => `# งาน: สร้างเว็บ${v.name ? ` "${v.name}"` : ''}\n\nคุณคือนักพัฒนาเว็บและนักออกแบบ UX/UI ที่ช่วยหน่วยงานสาธารณสุขของไทย\n\n## ข้อมูลโปรเจกต์\n${LINE('เป้าหมาย', v.goal)}${LINE('ผู้ใช้งาน', v.users)}${LINE('สไตล์', v.style)}${LINE('เทคโนโลยี', v.stack)}${LINE('ข้อจำกัด', v.limits)}\n## ฟีเจอร์ที่ต้องมี\n${(v.features || '').split('\n').filter(Boolean).map((x) => `- ${x.replace(/^[-*]\s*/, '')}`).join('\n') || '- (ให้เสนอฟีเจอร์ที่จำเป็น)'}\n${SAFE}\n## วิธีทำงาน\n1. สรุปความเข้าใจและถามคำถามที่จำเป็น (ไม่เกิน 3 ข้อ) ก่อนเริ่ม\n2. เสนอโครงสร้างหน้าและขั้นตอนการใช้งาน\n3. เขียนโค้ดครบทุกไฟล์พร้อมรันได้ รองรับมือถือ ใช้ภาษาไทยในหน้าจอ\n4. ปิดท้ายด้วยวิธีติดตั้ง/ดีพลอย และรายการทดสอบ\n` },
  health: { title: 'ไอเดียระบบสาธารณสุข', fields: [
    ['problem', 'ปัญหาหรืองานที่อยากปรับปรุง', 'เช่น ติดตามนัดฉีดวัคซีนเด็กยังใช้กระดาษ ตกหล่นบ่อย', 1], ['org', 'หน่วยงาน', 'เช่น รพ.สต. / โรงพยาบาลชุมชน / สสอ. / สสจ.'], ['people', 'กลุ่มเป้าหมาย', 'เช่น เด็ก 0-5 ปี, อสม., เจ้าหน้าที่ห้องบัตร'],
    ['data', 'ข้อมูล/เครื่องมือที่มีอยู่', 'เช่น Excel, HosXP, Google Sheet, LINE กลุ่ม', 1], ['outcome', 'ผลลัพธ์ที่อยากเห็น', 'เช่น ลดการตกหล่น 50% ใน 3 เดือน'], ['budget', 'งบประมาณ/กำลังคน', 'เช่น ไม่มีงบ ทำเองได้ 1 คน']],
    build: (v) => `# งาน: ระดมไอเดียระบบสาธารณสุข\n\nคุณคือที่ปรึกษาด้านระบบสารสนเทศสาธารณสุขที่เข้าใจบริบทหน่วยบริการของไทย\n\n## บริบท\n${LINE('ปัญหา', v.problem)}${LINE('หน่วยงาน', v.org)}${LINE('กลุ่มเป้าหมาย', v.people)}${LINE('ข้อมูล/เครื่องมือที่มี', v.data)}${LINE('ผลลัพธ์ที่ต้องการ', v.outcome)}${LINE('ข้อจำกัด', v.budget)}${SAFE}\n## สิ่งที่ต้องการ\n1. เสนอ 5 แนวทางแก้ปัญหา เรียงจากทำง่ายไปยาก พร้อมข้อดี/ข้อเสีย\n2. เลือก 1 แนวทางที่เหมาะที่สุด แล้วเขียน flow การทำงาน (ใครทำอะไรเมื่อไหร่)\n3. ระบุข้อมูลที่ต้องเก็บ ตัวชี้วัดความสำเร็จ และความเสี่ยงด้าน PDPA\n4. วางแผนทดลองใช้ 30 วัน (pilot) และวิธีวัดผล\n5. ตอบเป็นภาษาไทย กระชับ ใช้ตารางเมื่อเปรียบเทียบ\n` }
};

export function mount(root) {
  let kind = 'web'; const vals = {};
  const tabs = h('div', { class: 'tabs', role: 'tablist' }); const fields = h('div');
  const out = h('textarea', { rows: 18, readonly: true, 'aria-label': 'Prompt ที่สร้าง', spellcheck: 'false' });
  const render = () => { const v = {}; for (const [k] of KINDS[kind].fields) v[k] = vals[`${kind}.${k}`] || ''; out.value = KINDS[kind].build(v); };
  function setKind(k) {
    kind = k;
    tabs.replaceChildren(...Object.entries(KINDS).map(([id, d]) => h('button', { class: 'tab', role: 'tab', type: 'button', 'aria-selected': String(id === k), onclick: () => setKind(id) }, d.title)));
    fields.replaceChildren(...KINDS[k].fields.map(([key, label, ph, multi]) => {
      const el = multi ? h('textarea', { rows: 3, placeholder: ph }) : h('input', { type: 'text', placeholder: ph, autocomplete: 'off' });
      el.value = vals[`${k}.${key}`] || ''; el.addEventListener('input', () => { vals[`${k}.${key}`] = el.value; render(); });
      return field(label, el).root;
    }));
    render();
  }
  const log = (op) => record('prompt', op, { fileName: KINDS[kind].title, sizeOut: out.value.length, extra: { kind } });
  root.append(h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'สร้าง Prompt'), h('p', null, 'กรอกรายละเอียดสั้น ๆ ได้ Prompt พร้อมวางใน ChatGPT, Claude หรือ Gemini'))),
    h('div', { class: 'two-col' }, h('div', { class: 'card' }, tabs, fields),
      h('div', { class: 'card' }, h('h2', null, 'Prompt ที่ได้'), out,
        h('div', { class: 'btn-row', style: 'margin-top:.75rem' },
          h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => { toast((await copyText(out.value)) ? 'คัดลอก Prompt แล้ว' : 'คัดลอกไม่สำเร็จ', 'info'); log('copy'); } }, svgIcon(ICONS.copy, 18), 'คัดลอก'),
          h('button', { class: 'btn', type: 'button', onclick: () => { downloadText(out.value, 'prompt.md', 'text/markdown'); log('download'); } }, svgIcon(ICONS.download, 18), 'ดาวน์โหลด .md'))))));
  setKind('web');
}
