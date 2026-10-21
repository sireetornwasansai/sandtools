import { h } from '../core/dom.js';
import { getSession } from '../core/auth.js';
import { sessionCall } from '../core/ops.js';
import { warmBackend } from '../core/api.js';
import { notice } from '../core/notices.js';
import { toast } from '../core/toast.js';
import { confirmBox } from '../core/layers.js';
import { loadCss } from '../core/css.js';

/**
 * แจ้งเตือน LINE (HR) — admin page. Everything here is an op of backend action "hr" implemented in gas/HrLine.gs:
 * lineStatus · lineUsers · lineSetUser · lineSwitch · lineSaveSchedule · linePreview · lineSend   (HR admins only).
 * The page never sees a LINE token: it only shows whether one is configured.
 */

const WD = { MONDAY: 'ทุกวันจันทร์', TUESDAY: 'ทุกวันอังคาร', WEDNESDAY: 'ทุกวันพุธ', THURSDAY: 'ทุกวันพฤหัสบดี', FRIDAY: 'ทุกวันศุกร์', SATURDAY: 'ทุกวันเสาร์', SUNDAY: 'ทุกวันอาทิตย์' };
const MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const pad = (n) => String(n).padStart(2, '0');
const errText = (e) => (e && e.message) || 'ทำรายการไม่สำเร็จ';
const nf = (n) => (n == null ? '–' : Number(n).toLocaleString('th-TH'));

export async function mount(root) {
  await loadCss('hrline');
  const page = h('div', { class: 'page hl' });
  const body = h('div', { class: 'hl-body' });
  page.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'แจ้งเตือน LINE (HR)'),
    h('p', null, 'รายงานลา/ไปราชการ/อบรมเข้า LINE อัตโนมัติ · ตอบคำสั่งจากริชเมนู · กำหนดผู้รับตามบทบาท'))), body);
  root.append(page);
  if (!getSession()) { body.append(notice('warn', 'ต้องเข้าสู่ระบบก่อน', 'หน้านี้ใช้ได้เฉพาะผู้ดูแลระบบ HR')); return undefined; }

  const call = (op, args = []) => sessionCall('hr', op, { args }, /^(lineSend|lineSaveSchedule|lineSetUser|lineSwitch)$/.test(op) ? 60000 : 40000);
  warmBackend();
  body.append(h('div', { class: 'skeleton', style: 'height:40vh', role: 'status', 'aria-label': 'กำลังโหลด' }));

  let st = null; let users = [];
  const sched = {};          // key → working copy of the schedule row
  let kind = 'weekly'; let pvMonth = new Date().getMonth() + 1; let pvYear = new Date().getFullYear();

  async function load() {
    const [s, u] = await Promise.all([call('lineStatus'), call('lineUsers')]);
    st = s; users = u || [];
    (st.schedule || []).forEach((j) => { sched[j.key] = { key: j.key, hour: j.hour, minute: j.minute, weekday: j.weekday, enabled: j.enabled, roles: j.roles.slice() }; });
  }

  /* ------------------------------ status ------------------------------ */
  function stat(label, value, cls = '') { return h('div', { class: `hl-stat ${cls}`.trim() }, h('small', null, label), h('b', null, value)); }
  function statusCard() {
    const q = st.quota || {};
    const quotaText = !q.available ? 'ตรวจไม่ได้' : q.limit == null ? `ใช้ ${nf(q.used)} (ไม่จำกัด)` : `${nf(q.used)} / ${nf(q.limit)}`;
    const over = q.available && q.limit != null && q.used != null && q.used / q.limit >= 0.9;
    const active = st.channel === 'backup' ? 'บัญชีสำรอง' : 'บัญชีหลัก';
    const webhook = `${location.origin}/api/line`;
    const copy = h('button', { class: 'btn', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(webhook); toast('คัดลอกแล้ว', 'success'); } catch { toast('คัดลอกไม่สำเร็จ — เลือกข้อความแล้วคัดลอกเอง', 'error'); } } }, 'คัดลอก');
    const seg = h('div', { class: 'hl-seg', role: 'group', 'aria-label': 'ช่องทาง LINE ที่ใช้ส่ง' }, ...[['primary', 'บัญชีหลัก', st.primaryConfigured], ['backup', 'บัญชีสำรอง', st.backupConfigured]].map(([k, label, on]) =>
      h('button', { type: 'button', disabled: !on, 'aria-pressed': String(st.channel === k), onclick: () => switchChannel(k) }, label)));
    return h('section', { class: 'card hl-card' }, h('h2', null, 'สถานะระบบ'),
      h('div', { class: 'hl-stats' },
        stat('Token ของ LINE OA', st.primaryConfigured ? 'ตั้งแล้ว' : 'ยังไม่ได้ตั้ง', st.primaryConfigured ? 'ok' : 'bad'),
        stat('ตัวกลาง Webhook (EDGE_SECRET)', st.relayReady ? 'พร้อม' : 'ยังไม่ได้ตั้ง', st.relayReady ? 'ok' : 'bad'),
        stat('ช่องทางที่ใช้อยู่', active), stat('โควต้าข้อความเดือนนี้', quotaText, over ? 'bad' : ''),
        stat('กลุ่ม LINE ที่ตั้งไว้', `${nf(st.groups)} กลุ่ม`), stat('ผู้ใช้ที่รอกำหนดบทบาท', `${nf(st.users.pending)} คน`, st.users.pending ? 'bad' : 'ok'),
        stat('คำสั่งที่ตอบ', st.queryScope === 'leave' ? 'เฉพาะการลา' : 'ลา + ราชการ + อบรม + ประชุม'), stat('ตัวตั้งเวลา', `${nf((st.triggers || []).length)} รายการ`, (st.triggers || []).length ? 'ok' : 'bad')),
      h('div', { class: 'hl-row' }, h('b', null, 'สลับบัญชี LINE OA'), seg, h('span', { class: 'muted' }, 'ใช้สำรองเมื่อโควต้าบัญชีหลักหมด')),
      h('label', { class: 'hint', for: 'hl-webhook' }, 'Webhook URL (วางใน LINE Developers ▸ Messaging API ▸ Webhook URL)'),
      h('div', { class: 'hl-url' }, h('code', { id: 'hl-webhook' }, webhook), copy),
      h('details', { class: 'hl-how' }, h('summary', null, 'วิธีตั้งค่าครั้งแรก (Webhook / ริชเมนู)'), h('ol', null,
        h('li', null, 'Apps Script ▸ Project Settings ▸ Script properties: ใส่ ', h('code', null, 'LINE_CHANNEL_ACCESS_TOKEN'), ' (และ ', h('code', null, 'EDGE_SECRET'), ' ถ้ายังไม่มี)'),
        h('li', null, 'Vercel ▸ Environment Variables: ', h('code', null, 'SAND_LINE_CHANNEL_SECRET'), ' (Channel secret) · ', h('code', null, 'SAND_GAS_URL'), ' · ', h('code', null, 'SAND_EDGE_SECRET'), ' แล้ว Redeploy'),
        h('li', null, 'LINE Developers ▸ Messaging API: วาง Webhook URL ด้านบน ▸ Verify ▸ เปิด Use webhook · ปิด Auto-reply ใน LINE OA Manager'),
        h('li', null, 'LINE OA Manager ▸ ริชเมนู: ปุ่มชนิด “ข้อความ” ตั้งข้อความเป็น ', h('code', null, 'ใครลาวันไหน'), ' (ลา + ไปราชการ แยกรายวัน) · เพิ่มได้: ', h('code', null, 'สัปดาห์นี้ใครลา'), ' และ ', h('code', null, 'สัปดาห์หน้าใครลา'), ' · ปุ่มลงลาใช้ชนิด “ลิงก์” = ', h('code', null, `${location.origin}/?openExternalBrowser=1#/leave`)),
        h('li', null, 'เพิ่มบอทเป็นเพื่อน แล้วกำหนด “บทบาท” ให้ทุกคนในรายชื่อด้านล่าง — คนที่ไม่มีบทบาทจะไม่ได้รับรายงานและถามอะไรไม่ได้'))));
  }

  async function switchChannel(target) {
    if (target === st.channel) return;
    if (!(await confirmBox({ title: 'สลับบัญชี LINE OA?', message: `ข้อความถัดไปทั้งหมดจะส่งผ่าน${target === 'backup' ? 'บัญชีสำรอง' : 'บัญชีหลัก'} — Webhook ของบัญชีนั้นต้องชี้มาที่ระบบนี้ด้วย`, confirm: 'สลับ' }))) return;
    try { const r = await call('lineSwitch', [target]); if (r && r.status === 'success') { toast('สลับแล้ว', 'success'); await refresh(); } else toast((r && r.message) || 'สลับไม่สำเร็จ', 'error'); } catch (e) { toast(errText(e), 'error'); }
  }

  /* ------------------------------ schedule ------------------------------ */
  function jobRow(j) {
    const c = sched[j.key]; const isMonth = j.key === 'monthend';
    const on = h('input', { type: 'checkbox', checked: c.enabled, onchange: () => { c.enabled = on.checked; } });
    const time = h('input', { type: 'time', value: `${pad(c.hour)}:${pad(c.minute)}`, 'aria-label': 'เวลาส่ง', required: true, onchange: () => { const m = /^(\d{2}):(\d{2})$/.exec(time.value); if (m) { c.hour = Number(m[1]); c.minute = Number(m[2]); } } });
    const day = isMonth ? h('select', { disabled: true, 'aria-label': 'วันที่ส่ง' }, h('option', null, 'วันทำการสุดท้ายของเดือน'))
      : h('select', { 'aria-label': 'วันที่ส่ง', onchange: () => { c.weekday = day.value; } }, ...st.weekdays.filter(Boolean).map((d) => h('option', { value: d, selected: d === c.weekday }, WD[d])));
    const roles = h('div', { class: 'hl-chks', role: 'group', 'aria-label': 'ผู้รับ' }, ...[...st.roles, 'กลุ่ม'].map((r) => {
      const cb = h('input', { type: 'checkbox', checked: c.roles.includes(r), onchange: () => { c.roles = cb.checked ? [...new Set([...c.roles, r])] : c.roles.filter((x) => x !== r); } });
      return h('label', { class: 'hl-chk' }, cb, r === 'กลุ่ม' ? 'กลุ่ม LINE' : r);
    }));
    return h('div', { class: 'hl-job' }, h('label', { class: 'hl-chk hl-chk-lg' }, on, h('b', null, j.label)),
      h('div', { class: 'hl-job-grid' }, h('div', { class: 'field' }, h('label', null, 'วัน'), day), h('div', { class: 'field' }, h('label', null, 'เวลา'), time), h('div', { class: 'field hl-roles' }, h('label', null, 'ผู้รับ'), roles)));
  }
  function scheduleCard() {
    const save = h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
      const items = Object.values(sched);
      for (const it of items) if (it.enabled && !it.roles.length) { toast('เลือกผู้รับอย่างน้อย 1 กลุ่มสำหรับรายงานที่เปิดใช้งาน', 'error'); return; }
      try { const r = await call('lineSaveSchedule', [items]); if (r && r.status === 'success') { toast('บันทึกและตั้งเวลาใหม่แล้ว', 'success'); await refresh(); } else toast((r && r.message) || 'บันทึกไม่สำเร็จ', 'error'); } catch (e) { toast(errText(e), 'error'); }
    } }, 'บันทึกตารางเวลา');
    return h('section', { class: 'card hl-card' }, h('h2', null, 'ตารางส่งอัตโนมัติ'),
      h('p', { class: 'muted' }, 'ตัวตั้งเวลาของ Google อาจเลื่อนได้ ±15 นาที · รายงานสิ้นเดือนส่งเฉพาะวันทำการสุดท้ายของเดือน และส่งซ้ำไม่ได้ภายในเดือนเดียวกัน'),
      ...st.schedule.map(jobRow), h('div', { class: 'btn-row', style: 'margin-top:.8rem' }, save));
  }

  /* ------------------------------ preview / send ------------------------------ */
  function sendCard() {
    const pre = h('pre', { class: 'hl-preview', hidden: true, 'aria-live': 'polite' });
    const monthBox = h('div', { class: 'hl-month' });
    const drawMonth = () => {
      monthBox.replaceChildren();
      if (kind !== 'month') return;
      const m = h('select', { 'aria-label': 'เดือน', onchange: () => { pvMonth = Number(m.value); } }, ...MONTHS.map((n, i) => h('option', { value: i + 1, selected: i + 1 === pvMonth }, n)));
      const y = h('select', { 'aria-label': 'ปี', onchange: () => { pvYear = Number(y.value); } }, ...[pvYear - 1, pvYear, pvYear + 1].map((v) => h('option', { value: v, selected: v === pvYear }, v + 543)));
      monthBox.append(m, y);
    };
    const sel = h('select', { 'aria-label': 'รายงาน', onchange: () => { kind = sel.value; drawMonth(); pre.hidden = true; } },
      h('option', { value: 'weekly', selected: kind === 'weekly' }, 'รายงานสัปดาห์หน้า'), h('option', { value: 'thisweek', selected: kind === 'thisweek' }, 'สัปดาห์นี้ (ดูตัวอย่างเท่านั้น)'), h('option', { value: 'month', selected: kind === 'month' }, 'สรุปวันลารายเดือนแยกกลุ่มงาน'));
    const args = () => (kind === 'month' ? ['month', pvYear, pvMonth] : [kind]);
    const preview = h('button', { class: 'btn', type: 'button', onclick: async () => {
      try { const r = await call('linePreview', args()); pre.textContent = (r && r.text) || '(ไม่มีข้อความ)'; pre.hidden = false; } catch (e) { toast(errText(e), 'error'); }
    } }, 'ดูตัวอย่างข้อความ');
    const send = h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
      if (kind === 'thisweek') { toast('“สัปดาห์นี้” ใช้ดูตัวอย่างเท่านั้น — ผู้ใช้ถามเองได้จากริชเมนู', 'info'); return; }
      const job = st.schedule.find((j) => j.key === (kind === 'month' ? 'monthend' : 'weekly'));
      if (!(await confirmBox({ title: 'ส่งเข้า LINE ตอนนี้เลย?', message: `จะส่งไปยังผู้รับตามบทบาท: ${job ? job.roles.join(', ') : '–'} (ใช้โควต้าข้อความ 1 ข้อความต่อคน)`, confirm: 'ส่งเลย' }))) return;
      try {
        const r = await call('lineSend', kind === 'month' ? ['month', pvYear, pvMonth] : ['weekly']);
        const res = (r && r.result) || {};
        if (r && r.status === 'success') toast(`ส่งแล้ว ${nf(res.sent)} ราย${res.failed ? ` · ไม่สำเร็จ ${nf(res.failed)}` : ''}`, 'success'); else toast((r && r.message) || 'ส่งไม่สำเร็จ', 'error');
        await refresh();
      } catch (e) { toast(errText(e), 'error'); }
    } }, 'ส่งเข้า LINE ทันที');
    drawMonth();
    return h('section', { class: 'card hl-card' }, h('h2', null, 'ดูตัวอย่าง / ส่งทันที'),
      h('p', { class: 'muted' }, 'ข้อความตัวอย่างตรงกับที่จะส่งจริง · ไม่แสดงหมายเหตุของการลา (อาจมีเรื่องสุขภาพ)'),
      h('div', { class: 'hl-sendrow' }, sel, monthBox, preview, send), pre);
  }

  /* ------------------------------ users ------------------------------ */
  function userRow(u) {
    const role = h('select', { 'aria-label': `บทบาทของ ${u.name || u.userId}`, onchange: () => save() }, h('option', { value: '' }, '— รอกำหนดบทบาท —'), ...st.roles.map((r) => h('option', { value: r, selected: r === u.role }, r)));
    const on = h('input', { type: 'checkbox', checked: u.enabled, onchange: () => save() });
    const row = h('div', { class: `hl-user${u.enabled && u.status !== 'ยกเลิก' ? '' : ' is-off'}` },
      h('div', { class: 'hl-user-main' }, h('b', null, u.name || '(ไม่ทราบชื่อ)'), h('small', { class: 'muted' }, `${u.status === 'ยกเลิก' ? 'เลิกติดตามแล้ว · ' : ''}ลงทะเบียน ${u.registered || '–'}`)),
      role, h('label', { class: 'hl-chk' }, on, 'รับข้อความ'));
    async function save() {
      try { const r = await call('lineSetUser', [u.userId, role.value, on.checked]); if (r && r.status === 'success') { u.role = role.value; u.enabled = on.checked; row.classList.toggle('is-off', !on.checked); toast('บันทึกแล้ว', 'success'); } else toast((r && r.message) || 'บันทึกไม่สำเร็จ', 'error'); } catch (e) { toast(errText(e), 'error'); }
    }
    return row;
  }
  function usersCard() {
    const list = h('div', { class: 'hl-users' }, ...(users.length ? users.map(userRow) : [h('div', { class: 'empty' }, h('p', null, 'ยังไม่มีผู้ใช้ — เมื่อมีคนเพิ่มบอทเป็นเพื่อน จะปรากฏที่นี่'))]));
    return h('section', { class: 'card hl-card' }, h('h2', null, `ผู้ใช้ LINE (${nf(users.length)})`),
      h('p', { class: 'muted' }, 'แอดมิน = ได้ทุกอย่าง · หัวหน้า = รายงานทุกฉบับ + สรุปรายเดือน · บุคลากร = รายงานประจำสัปดาห์ · กลุ่ม LINE ตั้งรหัสกลุ่มใน HR_LINE_GROUP_IDS (พิมพ์ “รหัสกลุ่ม” ในกลุ่มเพื่อรับรหัส)'), list);
  }

  function draw() { body.replaceChildren(statusCard(), scheduleCard(), sendCard(), usersCard()); }
  async function refresh() { await load(); draw(); }

  try { await load(); draw(); } catch (e) {
    body.replaceChildren(notice('error', e && e.code === 'FORBIDDEN' ? 'ไม่มีสิทธิ์ใช้งานหน้านี้' : 'เปิดหน้าตั้งค่า LINE ไม่ได้',
      e && e.code === 'FORBIDDEN' ? 'เฉพาะผู้ดูแลระบบ HR (ADMIN_EMAILS / HR_ADMIN_EMAILS)' : `${errText(e)} — ถ้ายังไม่เคยอัปเดตระบบ ให้เพิ่มไฟล์ HrLine.gs, รัน hrLineSetup() แล้ว Deploy เวอร์ชันใหม่`),
    h('button', { class: 'btn', type: 'button', onclick: () => location.reload() }, 'ลองใหม่'));
  }
  return undefined;
}
