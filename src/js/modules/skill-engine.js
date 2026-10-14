// เครื่องมือสร้าง skill.md: วิเคราะห์เอกสาร → ตั้งชื่อ/คำอธิบาย → แพ็กเป็นโฟลเดอร์ skill → ตรวจคุณภาพ → ปิดบังข้อมูลส่วนบุคคล
// (ไฟล์นี้เคยถูกทับด้วยโค้ดผัง 3 มิติ ทำให้หน้า "สร้าง Prompt" และ "สร้าง skill.md" เปิดไม่ได้ — เขียนคืนตามที่ skill.js / prompt.js / tests/unit/skill.test.mjs เรียกใช้)
// ทำงานฝั่งเบราว์เซอร์ล้วน ๆ ไม่ส่งข้อมูลออกนอกเครื่อง
export const NAME_MAX = 64;
export const DESC_MAX = 1024;
export const BODY_MAX_LINES = 500;
export const SPLIT_LINES = 300;
export const SPLIT_CHARS = 24000;
export const RESERVED = ['claude', 'anthropic'];
export const KINDS = {
  procedure: { label: 'ขั้นตอนการทำงาน', verb: 'ขั้นตอนและวิธีปฏิบัติงาน' },
  reference: { label: 'ข้อมูลอ้างอิง / ตาราง', verb: 'ข้อมูลอ้างอิงและตารางสำหรับค้นหา' },
  policy: { label: 'ระเบียบ / นโยบาย', verb: 'ระเบียบ ข้อกำหนด และนโยบาย' },
  guide: { label: 'คู่มือ / ความรู้ทั่วไป', verb: 'ความรู้และคำแนะนำ' },
};
const STOP = new Set(['และ', 'หรือ', 'ของ', 'ใน', 'ที่', 'การ', 'ความ', 'เป็น', 'จาก', 'ให้', 'ได้', 'ไม่', 'the', 'and', 'for', 'with', 'this', 'that', 'from', 'are', 'was', 'you', 'your', 'not', 'can', 'will']);
const clean = (s) => String(s || '').replace(/[*_`#>\[\]]/g, '').replace(/\s+/g, ' ').trim();
const short = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/* ---------- ข้อมูลส่วนบุคคล (PDPA) ---------- */
const PII = [
  { id: 'cid', label: 'เลขบัตรประชาชน', re: /(?<![\d-])\d-?\d{4}-?\d{5}-?\d{2}-?\d(?![\d-])/g, mask: '[เลขบัตรประชาชน]' },
  { id: 'phone', label: 'เบอร์โทร', re: /(?<![\d-])0\d{1,2}[- ]?\d{3}[- ]?\d{4}(?![\d-])/g, mask: '[เบอร์โทร]' },
  { id: 'email', label: 'อีเมล', re: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, mask: '[อีเมล]' },
  { id: 'hn', label: 'HN/AN', re: /\b(?:HN|AN|VN)\s*[:#.]?\s*\d{4,}/gi, mask: '[HN/AN]' },
];
/** @returns {{id:string,label:string,count:number}[]} */
export function scanPii(text) {
  const t = String(text || ''); const out = [];
  for (const p of PII) { const m = t.match(p.re); if (m && m.length) out.push({ id: p.id, label: p.label, count: m.length }); }
  return out;
}
export function redact(text) { let t = String(text || ''); for (const p of PII) t = t.replace(p.re, p.mask); return t; }

/* ---------- วิเคราะห์เอกสาร ---------- */
export function analyze(md) {
  const text = String(md || '').replace(/\r\n?/g, '\n'); const lines = text.split('\n');
  const sections = []; let title = ''; let cur = null; const pre = []; let fence = false; let headings = 0; let steps = 0; let tables = 0;
  for (const raw of lines) {
    if (/^\s*(```|~~~)/.test(raw)) fence = !fence;
    const hm = !fence && /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(raw);
    if (hm) { headings += 1; const level = hm[1].length; const ttl = clean(hm[2]); if (level === 1 && !title) { title = ttl; cur = null; continue; } cur = { level, title: ttl, body: [] }; sections.push(cur); continue; }
    if (!fence) { if (/^\s*\d{1,3}[.)]\s+\S/.test(raw)) steps += 1; if (/^\s*\|.*\|\s*$/.test(raw) && !/^\s*\|[\s:|-]+\|\s*$/.test(raw)) tables += 1; }
    (cur ? cur.body : pre).push(raw);
  }
  const secs = sections.map((s) => ({ level: s.level, title: s.title, body: s.body.join('\n').replace(/^\n+|\n+$/g, '') }));
  const latin = (text.match(/[A-Za-z0-9ก-๙][A-Za-z0-9ก-๙'-]*/g) || []).length; const thai = (text.match(/[ก-๙]/g) || []).length;
  const words = Math.max(latin - Math.round(thai / 8), 0) + Math.round(thai / 6);
  const hasProc = secs.some((s) => /ขั้นตอน|วิธี|procedure|steps?|how to/i.test(s.title)) || /ขั้นตอน|procedure/i.test(title);
  const policyRe = /ระเบียบ|ข้อบังคับ|นโยบาย|ประกาศ|หมวด|มาตรา|policy|regulation/i;
  let kind = 'guide';
  if (steps >= 5 || (steps >= 3 && hasProc)) kind = 'procedure'; else if (tables >= 4) kind = 'reference'; else if (policyRe.test(title) || secs.filter((s) => policyRe.test(s.title)).length >= 2) kind = 'policy';
  const topics = []; const add = (t) => { const v = short(clean(t), 40); if (v && !topics.some((x) => x.toLowerCase() === v.toLowerCase())) topics.push(v); };
  if (title) add(title); secs.forEach((s) => add(s.title));
  if (topics.length < 5) { const freq = new Map(); for (const w of text.match(/[A-Za-z][A-Za-z0-9-]{3,}/g) || []) { const k = w.toLowerCase(); if (!STOP.has(k)) freq.set(k, (freq.get(k) || 0) + 1); } [...freq.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 5 - topics.length).forEach(([w]) => add(w)); }
  return { title, kind, lines: lines.length, chars: text.length, words, headings, steps, tables, topics: topics.slice(0, 8), sections: secs, preamble: pre.join('\n').replace(/^\n+|\n+$/g, '') };
}

/* ---------- ชื่อและคำอธิบาย ---------- */
export const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\x00-\x7f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-');
export const cleanName = (s) => slugify(s).slice(0, NAME_MAX).replace(/-+$/g, '');
/** ชื่อ kebab-case: หัวเรื่องอังกฤษ → ชื่อไฟล์ต้นฉบับ → ตั้งตามประเภทเอกสาร */
export function suggestName(a, srcName = '') {
  const fromTitle = cleanName(a && a.title); if (fromTitle.length >= 3) return fromTitle;
  const base = cleanName(String(srcName || '').replace(/\.[^.]+$/, '')); if (base.length >= 3) return base;
  return `${a && a.kind && KINDS[a.kind] ? a.kind : 'knowledge'}-skill`;
}
/** คำอธิบาย = ทำอะไรได้ + ใช้เมื่อไร (AI ใช้ตัดสินว่าจะเปิด skill) */
export function suggestDescription(a, when = '') {
  const k = KINDS[a && a.kind] || KINDS.guide; const topics = ((a && a.topics) || []).slice(0, 6);
  const what = `${k.verb}${a && a.title ? ` เรื่อง “${a.title}”` : ''}${topics.length ? ` ครอบคลุม ${topics.filter((t) => t !== (a && a.title)).slice(0, 5).join(', ') || topics[0]}` : ''}`;
  const w = String(when || '').split('\n').map((x) => x.replace(/^[-*•]\s*/, '').trim()).filter(Boolean);
  const use = w.length ? w.join(' / ') : `ผู้ใช้ถามหรือขอให้ช่วยเกี่ยวกับ ${(topics.slice(0, 3).join(', ')) || (a && a.title) || 'เนื้อหาในเอกสารนี้'}`;
  return short(`${what} ใช้เมื่อ${w.length ? ': ' : ''}${use}`.replace(/\s+/g, ' ').trim(), DESC_MAX);
}

/* ---------- แพ็กเกจ ---------- */
const pad2 = (n) => String(n).padStart(2, '0');
const yamlStr = (s) => JSON.stringify(String(s || '').replace(/\s+/g, ' ').trim());
function refFiles(a) {
  const files = {}; const list = []; let n = 0;
  a.sections.forEach((s, si) => {
    if (s.level > 2) return; n += 1;
    const slug = slugify(s.title).slice(0, 40) || 'section'; const path = `references/${pad2(n)}-${slug}.md`;
    const subs = []; for (let k = si + 1; k < a.sections.length && a.sections[k].level > 2; k++) subs.push(a.sections[k]);
    const body = [s.body, ...subs.map((x) => `${'#'.repeat(Math.max(2, x.level - 1))} ${x.title}\n\n${x.body}`)].filter(Boolean).join('\n\n');
    files[path] = `# ${s.title}\n\n${body}\n`;
    list.push({ path, title: s.title, hint: short(clean(s.body.split('\n').find((l) => l.trim()) || ''), 80) });
  });
  return { files, list };
}
function inlineBody(a, md) {
  if (!a.sections.length) return String(md || '').replace(/^\s*#\s+.+\n?/, '').trim();
  const out = []; if (a.preamble) out.push(a.preamble);
  for (const s of a.sections) out.push(`${'#'.repeat(Math.min(6, Math.max(2, s.level)))} ${s.title}\n\n${s.body}`.trimEnd());
  return out.join('\n\n').trim();
}
/** @returns {{name:string,description:string,split:boolean,files:Record<string,string>}} */
export function buildPackage(o = {}) {
  const md = String(o.md || ''); const a = o.a || analyze(md);
  const name = cleanName(o.name) || suggestName(a);
  const description = (o.description && o.description.trim()) || suggestDescription(a, o.when || '');
  const mode = o.split || 'auto';
  const refsPossible = a.sections.filter((s) => s.level <= 2).length >= 2;
  const split = refsPossible && (mode === 'always' || (mode === 'auto' && (a.lines > SPLIT_LINES || a.chars > SPLIT_CHARS)));
  const title = a.title || name; const k = KINDS[a.kind] || KINDS.guide;
  const when = String(o.when || '').split('\n').map((x) => x.replace(/^[-*•]\s*/, '').trim()).filter(Boolean);
  const useList = when.length ? when : [`ผู้ใช้ถามเกี่ยวกับ ${(a.topics.slice(0, 4).join(', ')) || title}`, `ต้องการ${k.verb}ตามเอกสารนี้`];
  const rules = [`อ่านเนื้อหา${split ? 'ในไฟล์อ้างอิงที่เกี่ยวข้องก่อนตอบ (เปิดเฉพาะหัวข้อที่ต้องใช้)' : 'ด้านล่างก่อนตอบ'}`, 'ตอบตามเอกสารเท่านั้น หากไม่พบข้อมูลให้บอกตรง ๆ ว่าไม่พบ ห้ามเดา', 'อ้างชื่อหัวข้อที่ใช้ตอบ เพื่อให้ผู้ใช้ตรวจสอบต้นฉบับได้', 'ไม่ใส่ข้อมูลส่วนบุคคลของผู้ป่วยหรือบุคคลจริงลงในคำตอบ'];
  const refs = {}; let tail;
  if (split) { const r = refFiles(a); Object.assign(refs, r.files); tail = `## ไฟล์อ้างอิง\n\n${r.list.map((x) => `- [${x.title}](${x.path})${x.hint ? ` — ${x.hint}` : ''}`).join('\n')}`; if (a.preamble) tail = `## ภาพรวม\n\n${a.preamble}\n\n${tail}`; }
  else tail = `## เนื้อหา\n\n${inlineBody(a, md)}`;
  const skill = `---\nname: ${name}\ndescription: ${yamlStr(description)}\n---\n\n# ${title}\n\n${k.label}\n\n## ใช้เมื่อ\n\n${useList.map((x) => `- ${x}`).join('\n')}\n\n## แนวทางการใช้\n\n${rules.map((x, i) => `${i + 1}. ${x}`).join('\n')}\n\n${tail}\n`;
  return { name, description, split, files: { 'SKILL.md': skill, ...refs } };
}

/* ---------- ตรวจคุณภาพ ---------- */
/** @returns {{score:number,issues:{level:'error'|'warn'|'tip'|'ok',msg:string}[]}} */
export function lint(pkg, md = '') {
  const issues = []; const add = (level, msg) => issues.push({ level, msg });
  const name = pkg.name || ''; const desc = pkg.description || '';
  if (!name) add('error', 'ยังไม่มีชื่อ skill');
  else {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) add('error', 'ชื่อต้องเป็นตัวพิมพ์เล็ก ตัวเลข และขีดกลางเท่านั้น (เช่น procurement-guide)');
    if (name.length > NAME_MAX) add('error', `ชื่อยาวเกิน ${NAME_MAX} ตัวอักษร`);
    for (const w of RESERVED) if (name.includes(w)) add('error', `ชื่อห้ามมีคำสงวน “${w}” — ตั้งชื่ออื่น`);
  }
  if (!desc.trim()) add('error', 'ยังไม่มีคำอธิบาย (description) — AI จะไม่รู้ว่าเมื่อไรควรเปิด skill นี้');
  else {
    if (desc.length > DESC_MAX) add('error', `คำอธิบายยาวเกิน ${DESC_MAX} ตัวอักษร (ตอนนี้ ${desc.length})`);
    if (!/ใช้เมื่อ|when|use (this )?(skill )?(for|when)/i.test(desc)) add('warn', 'คำอธิบายควรบอกด้วยว่า “ใช้เมื่อ…” เพื่อให้ AI เปิด skill ถูกจังหวะ');
    if (desc.length < 60) add('tip', 'คำอธิบายสั้นมาก — เพิ่มคำสำคัญของเรื่องที่ผู้ใช้มักถาม');
  }
  const body = pkg.files && pkg.files['SKILL.md'] ? pkg.files['SKILL.md'] : '';
  if (!String(md).trim()) add('error', 'ยังไม่มีเนื้อหาอ้างอิง');
  const nl = body.split('\n').length; if (nl > BODY_MAX_LINES) add('warn', `SKILL.md ยาว ${nl} บรรทัด (ควรไม่เกิน ${BODY_MAX_LINES}) — เลือกแยกไฟล์อ้างอิง`);
  const all = Object.values(pkg.files || {}).join('\n'); const pii = scanPii(all || md);
  if (pii.length) add('error', `พบข้อมูลส่วนบุคคล: ${pii.map((x) => `${x.label} ${x.count} จุด`).join(', ')} — ปิดบังก่อนนำไปใช้ (PDPA)`);
  if (/[A-Za-z]:\\[^\s]+/.test(md)) add('tip', 'พบพาธไฟล์ในเครื่อง — ควรตัดออกเพราะผู้อื่นเปิดตามไม่ได้');
  if (pkg.split && !/\]\(references\//.test(body)) add('warn', 'แยกไฟล์อ้างอิงแล้วแต่ SKILL.md ไม่มีลิงก์ไปยังไฟล์');
  if (!issues.length) add('ok', 'โครงสร้าง ชื่อ และคำอธิบายถูกต้อง พร้อมนำไปใช้');
  const pen = { error: 30, warn: 10, tip: 3, ok: 0 };
  return { score: Math.max(0, 100 - issues.reduce((x, i) => x + pen[i.level], 0)), issues };
}
