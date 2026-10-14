import { h, svgIcon, debounce, field } from '../core/dom.js';
import { ICONS } from '../core/icons.js';
import { getSession, signOut } from '../core/auth.js';
import { gasCall } from '../core/api.js';
import { notice } from '../core/notices.js';
import { toast } from '../core/toast.js';
import { modal, confirmBox } from '../core/layers.js';
import { loadCss } from '../core/css.js';

/** หนังสือรับเข้า (ธุรการ): the drafts collected silently from Telegram. Clerks check them and press "รับหนังสือ" to get a running เลขรับ. */

const STATUS = { pending: 'รอตรวจ', accepted: 'รับแล้ว', ignored: 'ไม่นำเข้า' };
const SOURCE = { tg: 'Telegram', tgx: 'Telegram (นำเข้า)', manual: 'เพิ่มเอง' };
const MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const thDate = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${Number(m[1]) + 543}` : ''; };
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

async function call(op, params = {}, timeout = 30000) {
  const s = getSession();
  try { return (await gasCall('inbox', { session: s.token, op, ...params }, timeout)).data; } catch (e) {
    if (e && (e.code === 'INVALID_SESSION' || e.code === 'DOMAIN_NOT_ALLOWED')) signOut();
    throw e;
  }
}

/** Telegram Desktop "Export chat history" (result.json) → the messages that carry a link or a file. */
export function readExport(json, limitChars = 700) {
  const chatId = json && json.id; const chatTitle = (json && json.name) || '';
  const out = [];
  for (const m of (json && json.messages) || []) {
    if (!m || m.type !== 'message') continue;
    const ents = Array.isArray(m.text_entities) ? m.text_entities : [];
    const text = ents.length ? ents.map((e) => e.text || '').join('') : (typeof m.text === 'string' ? m.text : (Array.isArray(m.text) ? m.text.map((x) => (typeof x === 'string' ? x : x.text || '')).join('') : ''));
    const urls = ents.filter((e) => e.type === 'link' || e.type === 'text_link').map((e) => e.href || e.text).filter(Boolean);
    const docName = m.file_name || (m.media_type === 'document' && typeof m.file === 'string' ? m.file.split('/').pop() : '');
    if (!urls.length && !docName && !/https?:\/\//i.test(text)) continue;
    out.push({ chatId, chatTitle, mid: m.id, date: Number(m.date_unixtime) || Math.floor(Date.parse(m.date) / 1000) || 0, text: text.slice(0, limitChars), urls: urls.slice(0, 4).map((u) => String(u).slice(0, 500)), docName: docName ? String(docName).slice(0, 100) : '' });
  }
  return out;
}
/** Group items so each request stays under the backend's 8 KB body limit. */
export function batches(items, maxChars = 6500) {
  const out = []; let cur = []; let size = 0;
  for (const it of items) {
    const n = JSON.stringify(it).length + 1;
    if (cur.length && (size + n > maxChars || cur.length >= 40)) { out.push(cur); cur = []; size = 0; }
    cur.push(it); size += n;
  }
  if (cur.length) out.push(cur);
  return out;
}

export async function mount(root) {
  await loadCss('inbox');
  const s = getSession();
  const body = h('div');
  root.append(h('div', { class: 'page' }, h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'หนังสือรับเข้า'),
    h('p', null, 'หนังสือเวียนที่ระบบเก็บมาจากกลุ่ม Telegram แบบเงียบ ๆ — ตรวจข้อมูล แล้วกด “รับหนังสือ” เพื่อออกเลขรับ'))), body));
  if (!s) { body.append(notice('warn', 'ต้องเข้าสู่ระบบก่อน', 'หน้านี้ใช้ได้เฉพาะเจ้าหน้าที่ธุรการและผู้ดูแลระบบ')); return; }

  let status = 'pending'; let query = ''; let data = { counts: {}, items: [], year: 0 };
  const chips = h('div', { class: 'chip-row', role: 'group', 'aria-label': 'กรองตามสถานะ' });
  const list = h('div', { class: 'inb-list' }); const info = h('div'); const count = h('p', { class: 'muted inb-count' });
  const search = h('input', { type: 'search', placeholder: 'ค้นหาเรื่อง เลขที่หนังสือ เลขรับ หน่วยงาน…', 'aria-label': 'ค้นหาหนังสือ' });
  search.addEventListener('input', debounce(() => { query = search.value.trim(); load(); }, 350));
  const importInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
  importInput.addEventListener('change', () => { const f = importInput.files && importInput.files[0]; importInput.value = ''; if (f) runImport(f); });
  const tools = h('div', { class: 'btn-row inb-tools' }, search,
    h('button', { class: 'btn', type: 'button', onclick: () => edit(null) }, svgIcon(ICONS.plus, 18), 'เพิ่มเอง'),
    h('button', { class: 'btn', type: 'button', title: 'นำเข้าข้อความเก่าจากไฟล์ Export ของ Telegram Desktop (result.json)', onclick: () => importInput.click() }, svgIcon(ICONS.upload, 18), 'นำเข้าย้อนหลัง'),
    h('button', { class: 'btn', type: 'button', onclick: () => load() }, svgIcon(ICONS.rotate, 18), 'รีเฟรช'), importInput);
  body.append(info, tools, chips, count, list);

  async function load() {
    try { data = await call('list', { status, q: query }); } catch (e) {
      info.replaceChildren(notice('error', e.code === 'FORBIDDEN' ? 'ไม่มีสิทธิ์ใช้งานหน้านี้' : 'โหลดข้อมูลไม่สำเร็จ', e.message));
      list.replaceChildren(); chips.replaceChildren(); count.textContent = ''; return;
    }
    const hints = [];
    if (!data.chats) hints.push(notice('warn', 'ยังไม่ได้ตั้งค่ากลุ่ม Telegram', 'ผู้ดูแลระบบต้องตั้ง TG_ALLOWED_CHATS ใน Script properties (ดูคู่มือ docs/TELEGRAM-INBOX.md)'));
    else if (!data.botConfigured) hints.push(notice('info', 'ยังไม่ได้ตั้ง TG_BOT_TOKEN', 'ระบบยังเก็บข้อความและลิงก์ได้ แต่จะไม่คัดลอกไฟล์ PDF ที่แนบมาเก็บไว้ใน Drive'));
    info.replaceChildren(...hints);
    draw();
  }

  function draw() {
    const c = data.counts || {};
    chips.replaceChildren(...[['pending', 'รอตรวจ'], ['accepted', 'รับแล้ว'], ['ignored', 'ไม่นำเข้า'], ['', 'ทั้งหมด']].map(([k, label]) =>
      h('button', { class: 'chip', type: 'button', 'aria-pressed': String(status === k), onclick: () => { status = k; load(); } }, `${label} `,
        h('span', null, k ? (c[k] || 0) : (c.pending || 0) + (c.accepted || 0) + (c.ignored || 0)))));
    count.textContent = data.items.length ? `แสดง ${data.items.length.toLocaleString('th-TH')} รายการ${data.more ? ' (ล่าสุด 300 รายการ — ใช้ช่องค้นหาเพื่อหาเพิ่ม)' : ''} · เลขรับปี พ.ศ. ${data.year}` : '';
    if (!data.items.length) {
      list.replaceChildren(h('div', { class: 'empty' }, svgIcon(ICONS.list, 28), h('p', null, query ? 'ไม่พบรายการที่ตรงกับคำค้น'
        : status === 'pending' ? 'ไม่มีหนังสือที่รอตรวจ — เมื่อมีหนังสือเวียนในกลุ่ม Telegram ระบบจะนำมาไว้ที่นี่เอง' : 'ยังไม่มีรายการ')));
      return;
    }
    list.replaceChildren(...data.items.map((it) => h('button', { class: `inb-row inb-${it.status}`, type: 'button', onclick: () => edit(it) },
      h('span', { class: 'inb-no' }, it.regNo ? h('b', null, it.regNo) : h('span', { class: 'pill' }, STATUS[it.status] || it.status)),
      h('span', { class: 'inb-main' }, h('b', null, it.subject || '(ไม่มีเรื่อง)'),
        h('small', { class: 'muted' }, [it.bookNo, it.bookDate ? `ลงวันที่ ${thDate(it.bookDate)}` : '', it.from].filter(Boolean).join(' · ') || SOURCE[it.source] || '')),
      h('span', { class: 'inb-ico', title: it.file ? 'มีไฟล์แนบ' : it.urls.length ? 'มีลิงก์' : '' }, it.file ? svgIcon(ICONS.file, 16) : it.urls.length ? svgIcon('<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>', 16) : null),
      h('span', { class: 'inb-time muted' }, (it.msgTime || it.received || '').slice(0, 16)))));
  }

  /** The edit / accept dialog. it = null → add a letter by hand. */
  function edit(it) {
    const isNew = !it; const locked = it && it.status === 'accepted';
    const subject = h('input', { type: 'text', maxlength: 300, value: it ? it.subject : '' });
    const bookNo = h('input', { type: 'text', maxlength: 60, value: it ? it.bookNo : '', placeholder: 'เช่น ศธ 04010/ว1234' });
    const bookDate = h('input', { type: 'date', value: it ? it.bookDate : '' });
    const from = h('input', { type: 'text', maxlength: 120, value: it ? it.from : '' });
    const urls = h('textarea', { rows: 3, maxlength: 1500, placeholder: 'ลิงก์หนังสือ (บรรทัดละ 1 ลิงก์)' }); urls.value = it ? it.urls.join('\n') : '';
    const tags = h('input', { type: 'text', maxlength: 120, value: it ? it.tags.join(', ') : '', placeholder: 'เช่น ด่วน, ประชุม' });
    const note = h('textarea', { rows: 2, maxlength: 300 }); note.value = it ? it.note : '';
    const regNo = h('input', { type: 'text', maxlength: 12, placeholder: `อัตโนมัติ (ต่อจากเลขล่าสุดของปี ${data.year})`, inputmode: 'numeric' });
    const fields = () => ({ subject: subject.value.trim(), bookNo: bookNo.value.trim(), bookDate: bookDate.value, from: from.value.trim(), urls: urls.value.split(/\s+/).filter(Boolean), tags: tags.value, note: note.value.trim() });
    let m = null;
    const run = async (fn, msg) => {
      try { const r = await fn(); toast(msg, 'success'); if (m) m.close(); await load(); return r; } catch (e) { toast(e.message || 'ไม่สำเร็จ', 'error', 5000); return null; }
    };
    const buttons = [];
    if (isNew) buttons.push(h('button', { class: 'btn btn-primary', type: 'button', onclick: () => run(() => call('add', fields()), 'เพิ่มรายการแล้ว') }, 'เพิ่มรายการ'));
    else {
      if (!locked) buttons.push(h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
        if (!subject.value.trim()) { subject.focus(); toast('กรุณาระบุเรื่อง', 'error'); return; }
        const no = regNo.value.trim(); const full = no && !no.includes('/') ? `${no}/${data.year}` : no;
        await run(() => call('accept', { id: it.id, ...fields(), no: full }), 'รับหนังสือแล้ว');
      } }, svgIcon(ICONS.check, 18), 'รับหนังสือ (ออกเลขรับ)'));
      buttons.push(h('button', { class: 'btn', type: 'button', onclick: () => run(() => call('update', { id: it.id, ...fields() }), 'บันทึกแล้ว') }, 'บันทึก'));
      if (!locked) buttons.push(h('button', { class: it.status === 'ignored' ? 'btn' : 'btn btn-danger', type: 'button', onclick: async () => {
        if (it.status === 'ignored') { await run(() => call('restore', { id: it.id }), 'นำกลับมาแล้ว'); return; }
        if (await confirmBox({ title: 'ไม่นำเข้าหนังสือนี้?', message: 'รายการจะถูกย้ายไปที่ “ไม่นำเข้า” และนำกลับมาได้ภายหลัง', confirm: 'ไม่นำเข้า' })) await run(() => call('ignore', { id: it.id }), 'ย้ายไปไม่นำเข้าแล้ว');
      } }, it.status === 'ignored' ? 'นำกลับมา' : 'ไม่นำเข้า'));
    }
    buttons.push(h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'ปิด'));
    const links = it ? h('div', { class: 'inb-links' }, it.file ? h('a', { class: 'btn btn-sm', href: it.file, target: '_blank', rel: 'noopener noreferrer' }, svgIcon(ICONS.file, 16), 'ไฟล์ที่เก็บไว้ใน Drive') : null,
      it.urls.map((u) => h('a', { class: 'btn btn-sm', href: u, target: '_blank', rel: 'noopener noreferrer', title: u }, svgIcon(ICONS.eye, 16), `เปิด ${host(u)}`))) : null;
    const original = it && it.text ? h('details', { class: 'inb-orig' }, h('summary', null, 'ข้อความต้นฉบับใน Telegram'), h('pre', null, it.text)) : null;
    const head = it ? h('p', { class: 'muted inb-meta' }, `${SOURCE[it.source] || it.source}${it.msgTime ? ` · ข้อความเมื่อ ${it.msgTime.slice(0, 16)}` : ''}${it.regNo ? ` · เลขรับ ${it.regNo}${it.regDate ? ` (${thDate(it.regDate)})` : ''}` : ''}${it.by ? ` · โดย ${it.by}` : ''}`) : null;
    m = modal(isNew ? 'เพิ่มหนังสือรับเข้า' : locked ? `หนังสือรับเข้า เลขรับ ${it.regNo}` : 'ตรวจหนังสือรับเข้า',
      [head, links, field('เรื่อง', subject).root, h('div', { class: 'inb-two' }, field('เลขที่หนังสือ', bookNo).root, field('ลงวันที่ (หนังสือ)', bookDate).root), field('จาก / หน่วยงาน', from).root,
        field('ลิงก์', urls).root, h('div', { class: 'inb-two' }, field('แท็ก', tags).root, field('หมายเหตุ', note).root),
        !isNew && !locked ? field('เลขรับ (เว้นว่าง = ออกให้อัตโนมัติ)', regNo, 'ใช้ช่องนี้ครั้งแรกเพื่อให้เลขต่อจากทะเบียนเล่มเดิม เช่น 150 → ระบบจะออก 151, 152, … ต่อไป').root : null, original],
      buttons, { wide: true });
  }

  async function runImport(file) {
    let json; try { json = JSON.parse(await file.text()); } catch { toast('อ่านไฟล์ไม่ได้ — ต้องเป็นไฟล์ result.json จาก Telegram Desktop', 'error', 5000); return; }
    const items = readExport(json);
    if (!items.length) { toast('ไม่พบข้อความที่มีลิงก์หรือไฟล์ในไฟล์นี้', 'error', 5000); return; }
    if (!(await confirmBox({ title: 'นำเข้าข้อความย้อนหลัง', message: `พบ ${items.length.toLocaleString('th-TH')} ข้อความที่มีลิงก์/ไฟล์ ระบบจะนำเข้าเฉพาะที่เข้าข่ายหนังสือ (คำว่าหนังสือเวียน เลขที่หนังสือ ฯลฯ) เป็นรายการ “รอตรวจ” โดยไม่ดึงไฟล์แนบ และไม่นำเข้าซ้ำ`, confirm: 'นำเข้า' }))) return;
    const total = { added: 0, duplicate: 0, ignored: 0 }; const bs = batches(items);
    const bar = h('p', { class: 'muted' }, 'กำลังนำเข้า…'); info.append(bar);
    try {
      for (let i = 0; i < bs.length; i += 1) {
        bar.textContent = `กำลังนำเข้า… ${i + 1}/${bs.length}`;
        const r = await call('import', { items: bs[i] }, 60000);
        total.added += r.added; total.duplicate += r.duplicate; total.ignored += r.ignored;
      }
      toast(`นำเข้า ${total.added} รายการ · ซ้ำ ${total.duplicate} · ข้าม ${total.ignored}`, 'success', 6000);
    } catch (e) { toast(`นำเข้าไม่สำเร็จ: ${e.message}`, 'error', 6000); }
    bar.remove(); status = 'pending'; load();
  }

  load();
}
