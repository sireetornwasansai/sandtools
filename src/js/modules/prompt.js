import { h, field, svgIcon } from '../core/dom.js';
import { ICONS } from '../core/icons.js';
import { downloadText, copyText } from '../core/download.js';
import { toast } from '../core/toast.js';
import { record } from '../core/logger.js';
import { loadCss } from '../core/css.js';
import { scanPii, redact } from './skill-engine.js';
import { FULL, LITE, HEALTH, ADDENDA } from './prompt-data.js';

const LINE = (label, v) => (v && v.trim() ? `- ${label}: ${v.trim()}\n` : '');
const SAFE = '\n## ข้อกำหนดด้านข้อมูล\n- ใช้ข้อมูลตัวอย่างสมมติเท่านั้น ห้ามใส่ข้อมูลผู้ป่วยจริง และออกแบบให้สอดคล้อง PDPA (เก็บเท่าที่จำเป็น ระบุสิทธิ์การเข้าถึง)\n';

/* ---------- กลุ่ม 1: Prompt สำหรับงานภาพ/ออกแบบ (คำสั่งหลัก + เนื้อหาที่ผู้ใช้กรอก) ---------- */
// field = [key, label, placeholder, type ('text' | 'multi' | 'select'), options?]   (select: ตัวเลือกแรก = ไม่ระบุ)
const IMG = {
  general: {
    title: 'ทั่วไป', desc: 'ภาพ อินโฟกราฟิก แผนภาพ โลโก้ ฯลฯ', icon: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>',
    detail: 'full', addendum: null, head: 'เนื้อหาที่ต้องออกแบบ',
    fields: [
      ['name', 'ชื่องาน / หัวข้อ', 'เช่น ขั้นตอนขออนุมัติโครงการวิจัย', 'text'],
      ['use', 'นำไปใช้ที่', '', 'select', ['ให้ AI เลือกที่เหมาะสม', 'Presentation', 'Poster', 'Social media', 'Website', 'Infographic', 'Print', 'UI / Dashboard', 'Logo']],
      ['ratio', 'สัดส่วนภาพ', '', 'select', ['ให้ AI เลือกที่เหมาะสม', '16:9', '1:1', '4:5', '9:16', '3:2', '4:3']],
      ['audience', 'กลุ่มเป้าหมาย', 'เช่น เจ้าหน้าที่ รพ.สต., ประชาชนทั่วไป', 'text'],
      ['org', 'หน่วยงาน (สะกดตามต้นฉบับ)', 'พิมพ์ชื่อหน่วยงานให้ถูกต้อง', 'text'],
      ['style', 'สไตล์ / อารมณ์ (ถ้ามี)', 'เช่น สะอาด ทันสมัย เป็นทางการแต่เข้าถึงง่าย', 'text'],
      ['content', 'ข้อความและข้อมูลต้นฉบับ', 'วางข้อความ ขั้นตอน หรือข้อมูลที่ต้องแสดงในภาพ — AI จะไม่เพิ่มหรือแก้ข้อมูล', 'multi'],
      ['notes', 'สิ่งที่ต้องมี / ห้ามมี', 'เช่น เว้นที่วางโลโก้ ห้ามใช้ภาพคน', 'multi']
    ]
  },
  poster: {
    title: 'โปสเตอร์', desc: 'โปสเตอร์ ป้ายประชาสัมพันธ์ ภาพโพสต์', icon: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h4"/>',
    detail: 'lite', addendum: 'poster', head: 'เนื้อหาโปสเตอร์',
    fields: [
      ['name', 'หัวข้อหลัก (Headline)', 'เช่น ฉีดวัคซีนไข้หวัดใหญ่ ฟรี', 'text'],
      ['msg', 'ข้อความสำคัญ (Key message)', 'ประโยคเดียวที่ผู้ชมต้องจำให้ได้', 'text'],
      ['ratio', 'ขนาด / สัดส่วน', '', 'select', ['ให้ AI เลือกที่เหมาะสม', '3:4 แนวตั้ง', '4:5 (โพสต์)', '9:16 (สตอรี่/จอแนวตั้ง)', 'สัดส่วน A4/A3 แนวตั้ง', '1:1 (สี่เหลี่ยมจัตุรัส)']],
      ['audience', 'กลุ่มเป้าหมาย', 'เช่น ประชาชนในพื้นที่, ผู้สูงอายุ', 'text'],
      ['org', 'หน่วยงาน (สะกดตามต้นฉบับ)', 'พิมพ์ชื่อหน่วยงานให้ถูกต้อง', 'text'],
      ['cta', 'ให้ผู้ชมทำอะไร (CTA)', 'เช่น สแกน QR ลงทะเบียน, ติดต่อ รพ.สต.', 'text'],
      ['style', 'สไตล์ / อารมณ์ (ถ้ามี)', 'เช่น อบอุ่น เป็นกันเอง สีฟ้า-เขียว', 'text'],
      ['content', 'รายละเอียด (วัน เวลา สถานที่ ช่องทางติดต่อ)', 'หนึ่งบรรทัดต่อหนึ่งรายการ ใช้ตามที่ให้เท่านั้น', 'multi'],
      ['notes', 'สิ่งที่ต้องมี / ห้ามมี', 'เช่น เว้นที่วาง QR Code และโลโก้จริง', 'multi']
    ]
  },
  slide: {
    title: 'สไลด์', desc: 'ภาพประกอบสไลด์ 16:9 ทั้งชุดหรือรายหน้า', icon: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    detail: 'lite', addendum: 'slide', head: 'เนื้อหาสไลด์',
    fields: [
      ['name', 'ชื่อชุดสไลด์', 'เช่น สรุปผลการดำเนินงานไตรมาส 2', 'text'],
      ['stype', 'ประเภทสไลด์', '', 'select', ['ให้ AI เลือกตามเนื้อหา', 'ปก', 'สารบัญ', 'เนื้อหาหลัก', 'กระบวนการ / Workflow', 'เปรียบเทียบ', 'ตัวเลข / กราฟ', 'สรุป / ข้อเสนอ', 'ปิดท้าย']],
      ['audience', 'ผู้ฟัง', 'เช่น ผู้บริหาร, คณะกรรมการ, บุคลากร', 'text'],
      ['org', 'หน่วยงาน (สะกดตามต้นฉบับ)', 'พิมพ์ชื่อหน่วยงานให้ถูกต้อง', 'text'],
      ['style', 'สไตล์ / อารมณ์ (ถ้ามี)', 'เช่น ทางการ เรียบ สีน้ำเงิน-ฟ้า', 'text'],
      ['content', 'เนื้อหาแต่ละสไลด์', 'หนึ่งสไลด์ต่อหนึ่งช่วง คั่นด้วยบรรทัดว่าง\nเช่น\nสไลด์ 1: ปก — ชื่อเรื่อง...\n\nสไลด์ 2: ...', 'multi'],
      ['notes', 'สิ่งที่ต้องมี / ห้ามมี', 'เช่น เว้นพื้นที่ใส่ข้อความใน PowerPoint', 'multi']
    ]
  },
  web: {
    title: 'ออกแบบเว็บ', desc: 'Mockup หน้าเว็บ/แอป และ Design Tokens', icon: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M7 6.5h.01M10 6.5h.01"/>',
    detail: 'lite', addendum: 'web', head: 'เนื้อหาหน้าเว็บ / UI',
    fields: [
      ['name', 'ชื่อหน้า / ระบบ', 'เช่น หน้าแรกระบบจองห้องประชุม', 'text'],
      ['goal', 'เป้าหมายของหน้านี้', 'ผู้ใช้ทำอะไรได้ และแก้ปัญหาอะไร', 'text'],
      ['users', 'ผู้ใช้งาน', 'เช่น เจ้าหน้าที่ธุรการ ใช้บนมือถือเป็นหลัก', 'text'],
      ['device', 'อุปกรณ์ที่ต้องการภาพ', '', 'select', ['ให้ AI เลือกที่เหมาะสม', 'Mobile', 'Desktop', 'Mobile + Desktop']],
      ['org', 'หน่วยงาน (สะกดตามต้นฉบับ)', 'พิมพ์ชื่อหน่วยงานให้ถูกต้อง', 'text'],
      ['style', 'สไตล์ / โทนสี (ถ้ามี)', 'เช่น สะอาด ขาว-ฟ้า แบบเว็บราชการสมัยใหม่', 'text'],
      ['content', 'ส่วนประกอบ / ฟีเจอร์บนหน้า', 'หนึ่งบรรทัดต่อหนึ่งรายการ', 'multi'],
      ['notes', 'ข้อจำกัด / สิ่งที่ห้ามมี', 'เช่น ต้องอ่านง่ายสำหรับผู้สูงอายุ ใช้เน็ตช้า', 'multi']
    ]
  }
};
const HEAD_LABEL = { ratio: 'สัดส่วนภาพ', use: 'นำไปใช้ที่', stype: 'ประเภทสไลด์', device: 'อุปกรณ์' };

/* ---------- กลุ่ม 2: งานอื่น (เขียนโค้ด / ระดมไอเดีย) ---------- */
const OTHER = {
  code: { title: 'เขียนโค้ดเว็บ/แอป', fields: [
    ['name', 'ชื่อโปรเจกต์', 'เช่น ระบบจองห้องประชุม รพ.สต.'], ['goal', 'เป้าหมายของเว็บ', 'ผู้ใช้ทำอะไรได้บ้าง และแก้ปัญหาอะไร', 1], ['users', 'ผู้ใช้งาน', 'เช่น เจ้าหน้าที่ธุรการ 10 คน ใช้บนมือถือเป็นหลัก'],
    ['features', 'ฟีเจอร์ที่ต้องมี', 'หนึ่งบรรทัดต่อหนึ่งฟีเจอร์', 1], ['style', 'สไตล์/โทนสี', 'เช่น สะอาด ขาว-ฟ้า แบบเว็บราชการสมัยใหม่'],
    ['stack', 'เทคโนโลยี', 'HTML/CSS/JS ล้วน, ฝั่งหลังบ้าน Google Apps Script + Google Sheet, โฮสต์ที่ Vercel'], ['limits', 'ข้อจำกัด', 'เช่น ไม่มีงบ ใช้ภาษาไทย ต้องใช้งานได้ในเน็ตช้า']],
    build: (v) => `# งาน: สร้างเว็บ${v.name ? ` "${v.name}"` : ''}\n\nคุณคือนักพัฒนาเว็บและนักออกแบบ UX/UI ที่ช่วยหน่วยงานสาธารณสุขของไทย\n\n## ข้อมูลโปรเจกต์\n${LINE('เป้าหมาย', v.goal)}${LINE('ผู้ใช้งาน', v.users)}${LINE('สไตล์', v.style)}${LINE('เทคโนโลยี', v.stack)}${LINE('ข้อจำกัด', v.limits)}\n## ฟีเจอร์ที่ต้องมี\n${(v.features || '').split('\n').filter(Boolean).map((x) => `- ${x.replace(/^[-*]\s*/, '')}`).join('\n') || '- (ให้เสนอฟีเจอร์ที่จำเป็น)'}\n${SAFE}\n## วิธีทำงาน\n1. สรุปความเข้าใจและถามคำถามที่จำเป็น (ไม่เกิน 3 ข้อ) ก่อนเริ่ม\n2. เสนอโครงสร้างหน้าและขั้นตอนการใช้งาน\n3. เขียนโค้ดครบทุกไฟล์พร้อมรันได้ รองรับมือถือ ใช้ภาษาไทยในหน้าจอ\n4. ปิดท้ายด้วยวิธีติดตั้ง/ดีพลอย และรายการทดสอบ\n` },
  health: { title: 'ไอเดียระบบสาธารณสุข', fields: [
    ['problem', 'ปัญหาหรืองานที่อยากปรับปรุง', 'เช่น ติดตามนัดฉีดวัคซีนเด็กยังใช้กระดาษ ตกหล่นบ่อย', 1], ['org', 'หน่วยงาน', 'เช่น รพ.สต. / โรงพยาบาลชุมชน / สสอ. / สสจ.'], ['people', 'กลุ่มเป้าหมาย', 'เช่น เด็ก 0-5 ปี, อสม., เจ้าหน้าที่ห้องบัตร'],
    ['data', 'ข้อมูล/เครื่องมือที่มีอยู่', 'เช่น Excel, HosXP, Google Sheet, LINE กลุ่ม', 1], ['outcome', 'ผลลัพธ์ที่อยากเห็น', 'เช่น ลดการตกหล่น 50% ใน 3 เดือน'], ['budget', 'งบประมาณ/กำลังคน', 'เช่น ไม่มีงบ ทำเองได้ 1 คน']],
    build: (v) => `# งาน: ระดมไอเดียระบบสาธารณสุข\n\nคุณคือที่ปรึกษาด้านระบบสารสนเทศสาธารณสุขที่เข้าใจบริบทหน่วยบริการของไทย\n\n## บริบท\n${LINE('ปัญหา', v.problem)}${LINE('หน่วยงาน', v.org)}${LINE('กลุ่มเป้าหมาย', v.people)}${LINE('ข้อมูล/เครื่องมือที่มี', v.data)}${LINE('ผลลัพธ์ที่ต้องการ', v.outcome)}${LINE('ข้อจำกัด', v.budget)}${SAFE}\n## สิ่งที่ต้องการ\n1. เสนอ 5 แนวทางแก้ปัญหา เรียงจากทำง่ายไปยาก พร้อมข้อดี/ข้อเสีย\n2. เลือก 1 แนวทางที่เหมาะที่สุด แล้วเขียน flow การทำงาน (ใครทำอะไรเมื่อไหร่)\n3. ระบุข้อมูลที่ต้องเก็บ ตัวชี้วัดความสำเร็จ และความเสี่ยงด้าน PDPA\n4. วางแผนทดลองใช้ 30 วัน (pilot) และวิธีวัดผล\n5. ตอบเป็นภาษาไทย กระชับ ใช้ตารางเมื่อเปรียบเทียบ\n` }
};

const RETURN_NOTE = '## สิ่งที่ต้องส่งกลับ\n- ตอบเป็น **Final Art Direction Prompt เพียงชุดเดียว** ที่พร้อมวางในเครื่องมือสร้างภาพ ตามโครงสร้างที่กำหนดข้างต้น\n- ข้อความที่ต้องปรากฏบนภาพให้คงเป็นภาษาไทยตามต้นฉบับทุกตัวอักษร\n- สรุปสั้น ๆ 2–3 บรรทัดว่าเลือกแนวทางใดและเพราะอะไร ก่อนส่ง Prompt\n- ถ้ามีข้อมูลที่จำเป็นขาดไป ให้ใช้ Placeholder เช่น [ชื่อหน่วยงาน] อย่าเดาข้อมูล';

/** คำสั่งหลัก = (เต็ม|ย่อ) + โหมดงาน + กฎสาธารณสุข (ไม่รวมเนื้อหาของผู้ใช้) */
function masterOf(kind, detail, health) {
  const def = IMG[kind];
  return [detail === 'full' ? FULL : LITE, def.addendum ? ADDENDA[def.addendum] : '', health ? HEALTH : ''].filter(Boolean).join('\n\n---\n\n');
}
function contentOf(kind, v) {
  const def = IMG[kind]; let meta = ''; let body = '';
  for (const [key, label, , type] of def.fields) {
    const val = (v[key] || '').trim(); if (!val) continue;
    if (type === 'multi') body += `\n## ${label}\n${val}\n`; else meta += `- ${HEAD_LABEL[key] || label}: ${val}\n`;
  }
  const empty = !meta && !body ? '- (ยังไม่ได้ระบุเนื้อหา — ใช้ Placeholder อย่าเดาข้อมูล)\n' : '';
  return `# ${def.head}\nใช้ข้อมูลต่อไปนี้ตามต้นฉบับเท่านั้น ห้ามเพิ่ม ตัด หรือเปลี่ยนความหมาย\n\n${meta}${empty}${body}\n${RETURN_NOTE}\n`;
}

export async function mount(root) {
  await loadCss('prompt');
  let kind = 'general'; const vals = {}; const opt = { detail: {}, health: true };
  const imgKinds = Object.keys(IMG); const isImg = () => kind in IMG;
  const elFor = {};   // `${kind}.${key}` → input element (ใช้ตอนปิดบังข้อมูลส่วนบุคคล)
  const get = (k, key) => vals[`${k}.${key}`] || '';
  const valsOf = (k) => { const v = {}; const defs = (IMG[k] || OTHER[k]).fields; for (const f of defs) v[f[0]] = get(k, f[0]); return v; };

  const cats = h('div', { class: 'pr-cats', role: 'tablist', 'aria-label': 'ประเภทงาน' });
  const other = h('div', { class: 'chip-row pr-other' });
  const opts = h('div', { class: 'pr-opts' });
  const fields = h('div', { class: 'pr-fields' });
  const pii = h('div', { class: 'pr-pii', role: 'alert', hidden: true });
  const out = h('textarea', { rows: 20, readonly: true, 'aria-label': 'Prompt ที่สร้าง', spellcheck: 'false' });
  const meta = h('div', { class: 'chip-row pr-meta' });
  const guide = h('ol', { class: 'pr-steps' });

  const currentMaster = () => masterOf(kind, opt.detail[kind] || IMG[kind].detail, opt.health);
  const build = () => (isImg() ? `${currentMaster()}\n\n---\n\n${contentOf(kind, valsOf(kind))}` : OTHER[kind].build(valsOf(kind)));

  function refresh() {
    out.value = build();
    const text = out.value; const n = text.length;
    const chips = [h('span', { class: 'pill' }, `${n.toLocaleString('th-TH')} ตัวอักษร`)];
    if (isImg()) {
      chips.push(h('span', { class: 'pill' }, (opt.detail[kind] || IMG[kind].detail) === 'full' ? 'คำสั่งหลักฉบับเต็ม' : 'คำสั่งหลักฉบับย่อ'));
      if (IMG[kind].addendum) chips.push(h('span', { class: 'pill' }, `โหมด${IMG[kind].title}`));
      if (opt.health) chips.push(h('span', { class: 'pill pr-pill-health' }, 'กฎองค์กรสุขภาพ/ภาครัฐ'));
    }
    meta.replaceChildren(...chips);
    const hits = scanPii(Object.values(valsOf(kind)).join('\n'));
    pii.hidden = !hits.length;
    if (hits.length) pii.replaceChildren(h('span', null, `พบ${hits.map((x) => `${x.label} ${x.count} จุด`).join(', ')} ในข้อมูลที่กรอก — ไม่ควรวางข้อมูลผู้ป่วยหรือบุคคลจริงลงในเครื่องมือ AI ภายนอก`),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { for (const [key, el] of Object.entries(elFor)) if (key.startsWith(`${kind}.`)) { el.value = redact(el.value); vals[key] = el.value; } refresh(); toast('ปิดบังข้อมูลส่วนบุคคลแล้ว', 'info'); } }, 'ปิดบังให้ทั้งหมด'));
  }

  function renderOpts() {
    if (!isImg()) { opts.replaceChildren(); opts.hidden = true; return; }
    opts.hidden = false;
    const detail = h('select', { 'aria-label': 'ความละเอียดของคำสั่งหลัก' }, h('option', { value: 'full' }, 'ฉบับเต็ม — ครบทุกหัวข้อ (แม่นที่สุด)'), h('option', { value: 'lite' }, 'ฉบับย่อ — สั้นกว่า เหมาะกับแชตที่จำกัดความยาว'));
    detail.value = opt.detail[kind] || IMG[kind].detail; detail.addEventListener('change', () => { opt.detail[kind] = detail.value; refresh(); });
    const health = h('input', { type: 'checkbox', id: 'pr-health' }); health.checked = opt.health; health.addEventListener('change', () => { opt.health = health.checked; refresh(); });
    opts.replaceChildren(field('คำสั่งหลัก', detail).root,
      h('div', { class: 'check pr-health-check' }, health, h('label', { for: 'pr-health' }, h('b', null, 'ใช้กฎองค์กรสุขภาพ / หน่วยงานรัฐ'), h('small', { class: 'muted' }, 'ความถูกต้องมาก่อนความสวย · ห้ามสร้างข้อมูลหรือโลโก้เอง · เว้นที่วางโลโก้จริง'))));
  }

  function renderFields() {
    const defs = (IMG[kind] || OTHER[kind]).fields;
    fields.replaceChildren(...defs.map((f) => {
      const [key, label, ph] = f; const type = IMG[kind] ? f[3] : (f[3] ? 'multi' : 'text'); const id = `${kind}.${key}`;
      let el;
      if (type === 'select') { const o = f[4]; el = h('select', null, o.map((t, i) => h('option', { value: i === 0 ? '' : t }, t))); }
      else if (type === 'multi') el = h('textarea', { rows: 4, placeholder: ph });
      else el = h('input', { type: 'text', placeholder: ph, autocomplete: 'off' });
      el.value = vals[id] || ''; elFor[id] = el;
      el.addEventListener(type === 'select' ? 'change' : 'input', () => { vals[id] = el.value; refresh(); });
      return field(label, el).root;
    }));
  }

  function renderGuide() {
    guide.hidden = !isImg();
    guide.replaceChildren(...['กรอกข้อมูลทางซ้าย แล้วกด “คัดลอก Prompt”', 'วางในแชต ChatGPT, Claude หรือ Gemini — AI จะเขียน Prompt สั่งวาดภาพให้', 'นำ Prompt ที่ AI เขียนไปวางในเครื่องมือสร้างภาพ (ตรวจข้อความไทยบนภาพก่อนใช้งานจริง)'].map((t) => h('li', null, t)));
  }

  function setKind(k) {
    kind = k;
    cats.replaceChildren(...imgKinds.map((id) => h('button', { class: 'pr-cat', role: 'tab', type: 'button', 'aria-selected': String(id === k), onclick: () => setKind(id) },
      svgIcon(IMG[id].icon, 22), h('span', { class: 'pr-cat-t' }, IMG[id].title), h('span', { class: 'pr-cat-d' }, IMG[id].desc))));
    other.replaceChildren(h('span', { class: 'muted pr-other-l' }, 'งานอื่น:'), ...Object.entries(OTHER).map(([id, d]) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(id === k), onclick: () => setKind(id) }, d.title)));
    renderOpts(); renderFields(); renderGuide(); refresh();
  }

  const title = () => (IMG[kind] || OTHER[kind]).title;
  const log = (op) => record('prompt', op, { fileName: title(), sizeOut: out.value.length, extra: { kind } });
  const copy = async (text, msg, op) => { toast((await copyText(text)) ? msg : 'คัดลอกไม่สำเร็จ', 'info'); log(op); };

  root.append(h('div', { class: 'page pr-page' },
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'สร้าง Prompt'), h('p', null, 'เลือกประเภทงาน กรอกรายละเอียดสั้น ๆ ได้ Prompt ระดับ Art Director พร้อมวางใน ChatGPT, Claude หรือ Gemini'))),
    cats, other,
    h('div', { class: 'two-col pr-cols' },
      h('div', null, h('div', { class: 'card' }, opts, fields, pii)),
      h('div', { class: 'pr-result' }, h('div', { class: 'card' },
        h('div', { class: 'pr-result-h' }, h('h2', null, 'Prompt ที่ได้'), meta), guide, out,
        h('div', { class: 'btn-row pr-actions' },
          h('button', { class: 'btn btn-primary', type: 'button', onclick: () => copy(out.value, 'คัดลอก Prompt แล้ว', 'copy') }, svgIcon(ICONS.copy, 18), 'คัดลอก Prompt'),
          h('button', { class: 'btn', type: 'button', onclick: () => { downloadText(out.value, `prompt-${kind}.md`, 'text/markdown'); log('download'); } }, svgIcon(ICONS.download, 18), 'ดาวน์โหลด .md'),
          h('button', { class: 'btn', type: 'button', onclick: () => { if (isImg()) copy(currentMaster(), 'คัดลอกเฉพาะคำสั่งหลักแล้ว', 'copy_master'); else copy(out.value, 'คัดลอก Prompt แล้ว', 'copy'); }, title: 'ใช้เมื่ออยากวางคำสั่งหลักก่อน แล้วค่อยส่งเนื้อหาตามหลัง' }, svgIcon(ICONS.file, 18), 'คัดลอกเฉพาะคำสั่งหลัก')))))));
  setKind('general');
}
