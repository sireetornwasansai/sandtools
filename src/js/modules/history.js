import { h, formatBytes, svgIcon, debounce } from '../core/dom.js';
import { ICONS } from '../core/icons.js';
import { getSession } from '../core/auth.js';
import { gasCall } from '../core/api.js';
import { notice } from '../core/notices.js';
import { TOOLS, navigate } from '../core/routes.js';

const TOOL = { qr: 'QR Code', converter: 'แปลงไฟล์', compress: 'ย่อไฟล์', prompt: 'Prompt', skill: 'skill.md', pdf: 'เครื่องมือ PDF', library: 'คลังข้อมูล' };
const when = (ts) => new Date(ts).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
const ago = (ts) => { const m = Math.round((Date.now() - new Date(ts).getTime()) / 60000); return m < 1 ? 'เมื่อสักครู่' : m < 60 ? `${m} นาทีที่แล้ว` : m < 1440 ? `${Math.round(m / 60)} ชั่วโมงที่แล้ว` : `${Math.round(m / 1440)} วันที่แล้ว`; };

export async function mount(root) {
  const s = getSession();
  const host = h('div');
  root.append(h('div', { class: 'page' }, h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'ประวัติการใช้งาน'), h('p', null, 'ค้นหางานที่ทำไว้ และเปิดไฟล์ที่เก็บไว้ในคลังหน่วยงาน'))), host));
  if (!s) { host.append(notice('warn', 'ต้องเข้าสู่ระบบก่อน', 'ประวัติการใช้งานแสดงเฉพาะผู้ที่ล็อกอินแล้ว')); return; }

  let rows = []; let admin = false; let tool = ''; let query = ''; let drawer = null;
  const list = h('div', { class: 'hist-list' }); const chips = h('div', { class: 'chip-row', role: 'group', 'aria-label': 'กรองตามเครื่องมือ' });
  const search = h('input', { type: 'search', placeholder: 'ค้นหาชื่อไฟล์ ผู้ใช้ หรือเครื่องมือ…', 'aria-label': 'ค้นหาประวัติ' });
  search.addEventListener('input', debounce(() => { query = search.value.trim().toLowerCase(); draw(); }, 150));
  const refresh = h('button', { class: 'btn', type: 'button', onclick: load }, svgIcon(ICONS.rotate, 18), 'รีเฟรช');

  function closeDrawer() { if (drawer) { drawer.remove(); drawer = null; document.removeEventListener('keydown', onKey); } }
  const onKey = (e) => { if (e.key === 'Escape') closeDrawer(); };
  function openDrawer(r) {
    closeDrawer();
    const tl = TOOLS.find((t) => t.id === r.tool);
    drawer = h('div', { class: 'drawer-wrap', onclick: (e) => { if (e.target === drawer) closeDrawer(); } },
      h('aside', { class: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'รายละเอียดงาน' },
        h('div', { class: 'drawer-head' }, h('h2', null, r.fileName || (TOOL[r.tool] || r.tool)), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'ปิด', onclick: closeDrawer }, svgIcon('<path d="M6 6l12 12M18 6L6 18"/>'))),
        h('dl', { class: 'meta' }, h('dt', null, 'เครื่องมือ'), h('dd', null, `${TOOL[r.tool] || r.tool} · ${r.op}`), h('dt', null, 'เวลา'), h('dd', null, `${when(r.ts)} (${ago(r.ts)})`),
          admin ? [h('dt', null, 'ผู้ใช้'), h('dd', null, r.email)] : null, h('dt', null, 'สถานะ'), h('dd', { class: r.status === 'error' ? 'status-err' : 'status-ok' }, r.status === 'error' ? 'ผิดพลาด' : 'สำเร็จ'),
          r.sizeIn ? [h('dt', null, 'ขนาด'), h('dd', null, `${formatBytes(r.sizeIn)}${r.sizeOut ? ` → ${formatBytes(r.sizeOut)}` : ''}`)] : null),
        h('h3', null, 'ไฟล์ที่เก็บไว้'),
        r.files.length ? h('ul', { class: 'file-list' }, r.files.map((f) => h('li', null, svgIcon(ICONS.file, 18),
          h('div', null, h('b', null, f.name), h('span', { class: 'muted' }, ` ${f.role === 'output' ? 'ผลลัพธ์' : 'ไฟล์ต้นฉบับ'} · ${formatBytes(Number(f.size) || 0)}`)),
          h('a', { class: 'btn btn-sm btn-primary', href: f.url, target: '_blank', rel: 'noopener noreferrer' }, 'เปิดใน Drive'))))
          : h('p', { class: 'muted' }, 'ไม่มีสำเนาไฟล์ (ไฟล์ใหญ่เกิน 10 MB หรืองานนี้ไม่มีไฟล์)'),
        tl ? h('div', { class: 'btn-row', style: 'margin-top:1rem' }, h('button', { class: 'btn', type: 'button', onclick: () => { closeDrawer(); navigate(tl.path); } }, svgIcon(tl.icon, 18), `ทำงานนี้ใหม่ใน ${tl.title}`)) : null));
    document.body.append(drawer); document.addEventListener('keydown', onKey);
    drawer.querySelector('button').focus();
  }

  function draw() {
    const counts = {}; rows.forEach((r) => { counts[r.tool] = (counts[r.tool] || 0) + 1; });
    chips.replaceChildren(...[['', 'ทั้งหมด', rows.length], ...Object.keys(counts).map((k) => [k, TOOL[k] || k, counts[k]])].map(([k, label, n]) =>
      h('button', { class: 'chip', type: 'button', 'aria-pressed': String(tool === k), onclick: () => { tool = k; draw(); } }, `${label} `, h('span', null, n))));
    const shown = rows.filter((r) => (!tool || r.tool === tool) && (!query || `${r.fileName} ${r.email} ${TOOL[r.tool] || r.tool} ${r.op}`.toLowerCase().includes(query)));
    if (!shown.length) { list.replaceChildren(h('div', { class: 'empty' }, svgIcon(ICONS.find, 28), h('p', null, rows.length ? 'ไม่พบรายการที่ตรงกับคำค้น' : 'ยังไม่มีประวัติ — ลองใช้เครื่องมือสักอย่าง แล้วกลับมาดูที่นี่'))); return; }
    list.replaceChildren(...shown.map((r) => {
      const t = TOOLS.find((x) => x.id === r.tool);
      return h('button', { class: 'hist-row', type: 'button', onclick: () => openDrawer(r) },
        h('span', { class: 'hist-ico' }, svgIcon(t ? t.icon : ICONS.file, 20)),
        h('span', { class: 'hist-main' }, h('b', null, r.fileName || `${TOOL[r.tool] || r.tool} · ${r.op}`), h('small', { class: 'muted' }, `${TOOL[r.tool] || r.tool} · ${r.op}${admin ? ` · ${r.email}` : ''}`)),
        r.files.length ? h('span', { class: 'pill' }, svgIcon(ICONS.folder, 14), r.files.length) : null,
        r.status === 'error' ? h('span', { class: 'pill pill-err' }, 'ผิดพลาด') : null,
        h('span', { class: 'hist-time muted', title: when(r.ts) }, ago(r.ts)));
    }));
  }

  async function load() {
    list.replaceChildren(...[1, 2, 3, 4].map(() => h('div', { class: 'skeleton', style: 'height:56px;margin-bottom:.5rem' })));
    try { const d = (await gasCall('history', { session: s.token })).data; rows = d.rows; admin = d.admin; draw(); }
    catch (e) { list.replaceChildren(notice('error', 'โหลดประวัติไม่ได้', e.message)); }
  }
  host.append(h('div', { class: 'card hist-card' }, h('div', { class: 'hist-tools' }, search, refresh), chips, list));
  await load();
  return closeDrawer;
}
