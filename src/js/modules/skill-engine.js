// DOM-free skill authoring engine: analyse a document, then build and lint a Claude-style skill package.
const STOP = new Set('และ หรือ ของ ที่ ใน การ ความ ให้ เป็น จะ ได้ โดย ตาม กับ แต่ มี นี้ นั้น ต้อง the and of to in for is a on with'.split(' '));
const RESERVED = /anthropic|claude/;
const KIND = {
  policy: { label: 'ระเบียบ/ข้อกำหนด', verb: 'อ้างอิงและตอบคำถามตามระเบียบ/ข้อกำหนด', rules: ['อ้างข้อ/มาตราหรือหัวข้อที่เกี่ยวข้องทุกครั้งที่ตอบ', 'ตอบตามถ้อยคำในเอกสารเท่านั้น ห้ามตีความเกินข้อความ', 'ถ้าข้อกำหนดมีเงื่อนไขหรือข้อยกเว้น ให้ระบุครบ'] },
  procedure: { label: 'ขั้นตอนปฏิบัติงาน', verb: 'แนะนำขั้นตอนการปฏิบัติงานทีละขั้น', rules: ['ตอบเป็นขั้นตอนเรียงลำดับ ระบุเลขขั้นตามเอกสาร', 'ถามข้อมูลที่ขาด (เช่น ประเภทงาน หน่วยงาน) ก่อนเริ่มแนะนำ', 'ระบุเอกสาร/แบบฟอร์ม/ผู้รับผิดชอบในแต่ละขั้นเมื่อมี'] },
  reference: { label: 'ข้อมูลอ้างอิง/ตาราง', verb: 'ค้นข้อมูลอ้างอิงจากตารางและเกณฑ์', rules: ['ค้นจากตารางในเอกสารก่อนตอบ และยกค่าตามที่ระบุตรงตัว', 'บอกชื่อตาราง/หัวข้อที่ใช้อ้างอิง', 'ห้ามคำนวณหรือคาดเดาค่าที่ไม่มีในตาราง'] },
  guide: { label: 'คู่มือทั่วไป', verb: 'อธิบายและช่วยทำงานตามคู่มือ', rules: ['อ่านหัวข้อที่เกี่ยวข้องกับคำถามก่อนตอบ', 'สรุปให้กระชับ แล้วชี้หัวข้อที่ใช้อ้างอิง'] }
};
export const KINDS = KIND;

export function segment(text) {
  const Seg = typeof Intl !== 'undefined' ? /** @type {any} */ (Intl).Segmenter : null;
  if (Seg) return Array.from(new Seg('th', { granularity: 'word' }).segment(text)).filter((x) => /** @type {any} */ (x).isWordLike).map((x) => /** @type {any} */ (x).segment.toLowerCase());
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** Split markdown into sections by # / ## / ### (ignores code fences). */
export function parse(md) {
  const secs = []; let cur = { level: 0, title: '', lines: [] }; let fence = false;
  for (const l of md.replace(/\r/g, '').split('\n')) {
    if (/^```/.test(l)) fence = !fence;
    const m = !fence && /^(#{1,3})\s+(.+?)\s*#*$/.exec(l);
    if (m) { secs.push(cur); cur = { level: m[1].length, title: m[2], lines: [] }; } else cur.lines.push(l);
  }
  secs.push(cur);
  return secs.map((s) => ({ level: s.level, title: s.title, body: s.lines.join('\n').trim() })).filter((s) => s.title || s.body);
}

export function analyze(md) {
  const secs = parse(md); const words = segment(md).length;
  const steps = (md.match(/^\s*\d+[.)]\s+\S/gm) || []).length; const tables = (md.match(/^\|.+\|\s*$/gm) || []).length;
  const legal = (md.match(/มาตรา|ระเบียบ|ประกาศ|กฎกระทรวง|พ\.ร\.บ\./g) || []).length;
  const kind = legal >= 3 ? 'policy' : steps >= 6 ? 'procedure' : tables >= 8 ? 'reference' : 'guide';
  const freq = new Map();
  const add = (t, w) => { for (const x of segment(t)) if (x.length >= 3 && !STOP.has(x) && !/^\d+$/.test(x)) freq.set(x, (freq.get(x) || 0) + w); };
  add(md, 1); secs.forEach((s) => add(s.title, 4));
  const topics = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map((e) => e[0]);
  const title = (secs.find((s) => s.level === 1) || secs.find((s) => s.title) || { title: '' }).title;
  return { secs, words, steps, tables, headings: secs.filter((s) => s.title).length, lines: md.split('\n').length, kind, topics, title };
}

const PII = [['เลขบัตรประชาชน', /\b\d-?\d{4}-?\d{5}-?\d{2}-?\d\b/g], ['เบอร์โทรศัพท์', /\b0[2-9]\d?[- ]?\d{3,4}[- ]?\d{4}\b/g], ['อีเมล', /[\w.+-]+@[\w-]+\.[\w.-]+/g], ['เลข HN/AN', /\b(?:HN|AN)\s*[:.]?\s*\d{3,}\b/gi]];
export const scanPii = (t) => PII.map(([label, re]) => ({ label, count: (String(t).match(re) || []).length })).filter((x) => x.count);
export const redact = (t) => PII.reduce((s, [, re]) => s.replace(re, '[ปิดบังแล้ว]'), String(t));

export function slugify(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60); }
export const suggestName = (a, fileName = '') => slugify(a.title) || slugify(fileName.replace(/\.[^.]+$/, '')) || 'office-guide';

export function suggestDescription(a, when = '') {
  const t = a.topics.slice(0, 6); const ex = when.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 2);
  const d = `${KIND[a.kind].verb}เรื่อง "${a.title || 'เอกสารนี้'}" ครอบคลุม ${t.join(', ')} ใช้เมื่อผู้ใช้ถามหรือขอให้ช่วยงานเกี่ยวกับ ${t.slice(0, 4).join(' ')}${ex.length ? ` เช่น ${ex.join(' / ')}` : ''}`;
  return d.replace(/[<>]/g, '').slice(0, 1000);
}

const bullets = (s) => s.split('\n').map((x) => x.trim().replace(/^[-*]\s*/, '')).filter(Boolean).map((x) => `- ${x}`).join('\n');
const render = (secs, shift) => secs.map((s) => `${s.title ? `${'#'.repeat(Math.min(6, s.level + shift))} ${s.title}\n\n` : ''}${s.body}`).join('\n\n');

/** Build the file set. Large documents are split into references/*.md (progressive disclosure, one level deep). */
export function buildPackage({ name, description, when, md, a, split = 'auto' }) {
  const info = a || analyze(md); const n = slugify(name) || 'office-guide';
  const doSplit = split === 'always' || (split === 'auto' && (info.lines > 350 || info.words > 3500));
  const files = {}; let body;
  if (doSplit) {
    const groups = []; info.secs.forEach((s) => { if (!groups.length || s.level <= 2) groups.push([s]); else groups[groups.length - 1].push(s); });
    const idx = groups.map((g, i) => {
      const t = g[0].title || 'บทนำ'; const path = `references/${String(i + 1).padStart(2, '0')}-${slugify(t) || 'section'}.md`;
      const toc = render(g, 0).split('\n').length > 100 ? `## สารบัญ\n${g.filter((s) => s.level > 0).map((s) => `- ${s.title}`).join('\n')}\n\n` : '';
      files[path] = `${toc}${render(g, 0)}\n`; return `- [${t}](${path})`;
    });
    body = `อ่านเฉพาะไฟล์ที่เกี่ยวข้องกับคำถาม (เนื้อหาแยกตามหัวข้อ):\n\n${idx.join('\n')}`;
  } else body = render(info.secs, 1);
  const examples = info.secs.filter((s) => s.title && s.level > 0).slice(0, 5).map((s) => `- ถามเกี่ยวกับ "${s.title}"`).join('\n');
  const rules = [...KIND[info.kind].rules, 'ถ้าเอกสารไม่มีข้อมูลที่ถาม ให้บอกตรง ๆ ว่าไม่พบ และเสนอผู้ที่ควรสอบถามต่อ', ...(scanPii(md).length ? ['ห้ามนำข้อมูลส่วนบุคคลของผู้ป่วย/บุคลากรมาแสดงในคำตอบ'] : []), 'ตอบเป็นภาษาไทย ใช้ศัพท์เดียวกับเอกสาร'].map((x) => `- ${x}`).join('\n');
  const desc = (description || suggestDescription(info, when)).replace(/\s+/g, ' ').trim();
  files['SKILL.md'] = `---\nname: ${n}\ndescription: ${JSON.stringify(desc)}\n---\n\n# ${info.title || n}\n\n## ใช้เมื่อ\n${bullets(when || '') || `- ผู้ใช้ถามเกี่ยวกับ ${info.topics.slice(0, 4).join(', ')}`}\n\n## หลักการทำงาน\n${rules}\n\n## ตัวอย่างคำถามที่ควรตอบได้\n${examples || '- (เพิ่มตามการใช้งานจริง)'}\n\n## เนื้อหา\n\n${body}\n`;
  const order = ['SKILL.md', ...Object.keys(files).filter((k) => k !== 'SKILL.md').sort()];
  return { name: n, description: desc, files: Object.fromEntries(order.map((k) => [k, files[k]])), split: doSplit };
}

/** Quality check against skill-authoring best practices. */
export function lint(pkg, md) {
  const out = []; const add = (level, msg) => out.push({ level, msg }); const sk = pkg.files['SKILL.md'];
  if (!/^[a-z0-9-]{1,64}$/.test(pkg.name)) add('error', 'ชื่อ skill ต้องเป็นตัวอักษรอังกฤษพิมพ์เล็ก ตัวเลข และขีดกลาง ไม่เกิน 64 ตัว');
  if (RESERVED.test(pkg.name)) add('error', 'ชื่อ skill ห้ามมีคำว่า anthropic หรือ claude');
  if (!pkg.description) add('error', 'ยังไม่มีคำอธิบาย (description)');
  if (pkg.description.length > 1024) add('error', `คำอธิบายยาว ${pkg.description.length} ตัว (สูงสุด 1,024)`);
  if (/<[^>]+>/.test(pkg.description)) add('error', 'คำอธิบายห้ามมีแท็ก XML/HTML');
  if (pkg.description && !/ใช้เมื่อ|use when/i.test(pkg.description)) add('warn', 'คำอธิบายควรบอกว่า "ใช้เมื่อ..." เพื่อให้ AI เลือกใช้ skill ได้ถูกจังหวะ');
  if (pkg.description && pkg.description.length < 80) add('warn', 'คำอธิบายสั้นเกินไป ควรระบุทั้งสิ่งที่ทำและคำสำคัญที่ผู้ใช้จะพูดถึง');
  if (!md.trim()) add('error', 'ยังไม่มีเนื้อหาอ้างอิง');
  if (sk.split('\n').length > 500) add('warn', `SKILL.md ยาว ${sk.split('\n').length} บรรทัด (แนะนำไม่เกิน 500) เปิดโหมดแยกไฟล์อ้างอิง`);
  for (const p of scanPii(md)) add('error', `พบ${p.label} ${p.count} จุด — เปิด "ปิดบังข้อมูลส่วนบุคคล" ก่อนแจกจ่าย`);
  if (/ปัจจุบัน|ล่าสุด|ปีนี้|เดือนนี้|พ\.ศ\.\s*25\d\d/.test(md)) add('tip', 'พบข้อความที่อาจล้าสมัยเร็ว (เช่น "ล่าสุด" ปี พ.ศ.) ควรระบุวันที่มีผลบังคับแทน');
  if (/[A-Za-z]:\\/.test(md)) add('tip', 'พบพาธแบบ Windows (\\) ควรใช้ / เพื่อให้ใช้ข้ามระบบได้');
  const info = analyze(md); if (info.words > 300 && info.headings < 3) add('tip', 'เอกสารยาวแต่มีหัวข้อน้อย AI จะค้นหาส่วนที่ต้องการได้ยาก ลองเพิ่มหัวข้อ');
  if (!out.length) add('ok', 'ผ่านเกณฑ์ทั้งหมด พร้อมใช้งาน');
  const score = Math.max(0, 100 - out.reduce((s, i) => s + ({ error: 25, warn: 8, tip: 3, ok: 0 })[i.level], 0));
  return { score, issues: out };
}
