import { h, formatBytes } from '../core/dom.js';
import { getSession } from '../core/auth.js';
import { gasCall } from '../core/api.js';
import { notice } from '../core/notices.js';

const TOOL = { qr: 'QR Code', converter: 'แปลงไฟล์', compress: 'ย่อไฟล์', prompt: 'Prompt', skill: 'skill.md' };

export async function mount(root) {
  const host = h('div', { class: 'card' }, h('div', { class: 'loading', role: 'status' }, h('span', { class: 'bar' }), 'กำลังโหลดประวัติ…'));
  root.append(h('div', { class: 'page' }, h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'ประวัติการใช้งาน'), h('p', null, 'รายการล่าสุด 100 รายการ'))), host));
  const s = getSession();
  if (!s) { host.replaceWith(notice('warn', 'ต้องเข้าสู่ระบบก่อน', 'ประวัติการใช้งานแสดงเฉพาะผู้ที่ล็อกอินแล้ว')); return; }
  try {
    const { rows, admin } = (await gasCall('history', { session: s.token })).data;
    if (!rows.length) { host.replaceChildren(h('p', { class: 'muted' }, 'ยังไม่มีประวัติการใช้งาน')); return; }
    const th = (t) => h('th', null, t);
    host.replaceChildren(admin ? notice('info', 'โหมดผู้ดูแล', 'แสดงประวัติของทุกคน') : null,
      h('div', { style: 'overflow:auto' }, h('table', { class: 'kv hist' },
        h('thead', null, h('tr', null, th('เวลา'), admin ? th('ผู้ใช้') : null, th('เครื่องมือ'), th('ไฟล์'), th('ขนาด'), th('สถานะ'))),
        h('tbody', null, rows.map((r) => h('tr', null,
          h('td', null, new Date(r.ts).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })), admin ? h('td', null, r.email) : null,
          h('td', null, `${TOOL[r.tool] || r.tool} · ${r.op}`), h('td', null, r.fileName || '-'),
          h('td', null, r.sizeIn ? `${formatBytes(r.sizeIn)}${r.sizeOut ? ` → ${formatBytes(r.sizeOut)}` : ''}` : '-'),
          h('td', { class: r.status === 'error' ? 'status-err' : 'status-ok' }, r.status === 'error' ? 'ผิดพลาด' : 'สำเร็จ')))))));
  } catch (e) { host.replaceWith(notice('error', 'โหลดประวัติไม่ได้', e.message)); }
}
