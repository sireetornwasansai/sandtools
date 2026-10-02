import { h, field, svgIcon } from '../core/dom.js';
import { ICONS } from '../core/icons.js';
import { config, APP_FULL_NAME } from '../core/config.js';
import { getSettings, setSettings, clearRecent, clearAllLocalData } from '../core/store.js';
import { backendHealth, backendConfigured } from '../core/api.js';
import { toast } from '../core/toast.js';
import { currentUser } from '../core/auth.js';

export function mount(root) {
  const s = getSettings();
  const sel = (opts, value, onChange, label) => {
    const el = h('select', { onchange: () => onChange(el.value) }, opts.map(([v, t]) => h('option', { value: v, selected: String(v) === String(value) }, t)));
    return field(label, el).root;
  };

  const backendOut = h('div', { class: 'result-box', role: 'status' }, backendConfigured() ? 'ยังไม่ได้ตรวจสอบ' : 'ยังไม่ได้ตั้งค่า Backend (ใช้งานโหมดในเครื่องได้ตามปกติ)');
  const engineOut = h('div', { class: 'result-box', role: 'status' }, 'ยังไม่ได้ตรวจสอบ');

  const checkBackend = async () => {
    backendOut.textContent = 'กำลังตรวจสอบ…';
    try { const r = await backendHealth(); backendOut.textContent = `พร้อมใช้งาน · เวอร์ชัน ${r.version} · ตอบกลับ ${r.ms} ms`; }
    catch (e) { backendOut.textContent = `ไม่พร้อมใช้งาน: ${e.message}`; }
  };
  const checkEngine = async () => {
    engineOut.textContent = 'กำลังตรวจสอบ…';
    try {
      const { engineStatus } = await import('./converters/index.js');
      const st = await engineStatus();
      engineOut.textContent = `พร้อมใช้งาน · JSZip ${st.jszip} · pdf.js ${st.pdfjs} · รองรับ: ${st.formats.join(', ')}`;
    } catch (e) { engineOut.textContent = `ไม่พร้อมใช้งาน: ${e.message}`; }
  };

  const user = currentUser();
  root.append(h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'ตั้งค่า'), h('p', null, 'การตั้งค่าทั้งหมดเก็บไว้ในเบราว์เซอร์เครื่องนี้เท่านั้น'))),
    h('div', { class: 'card' }, h('h2', null, 'รูปลักษณ์'),
      sel([['system', 'ตามระบบ'], ['light', 'สว่าง'], ['dark', 'มืด']], s.theme, (v) => setSettings({ theme: v }), 'ธีม')),
    h('div', { class: 'card' }, h('h2', null, 'ความเป็นส่วนตัว'),
      h('p', { class: 'muted' }, 'ล้างข้อมูลที่ระบบเก็บไว้ในเบราว์เซอร์นี้ ได้แก่ รายการล่าสุด และการตั้งค่า'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', type: 'button', onclick: () => { clearRecent(); toast('ล้างรายการล่าสุดแล้ว', 'success'); } }, svgIcon(ICONS.trash, 18), 'ล้างรายการล่าสุด'),
        h('button', { class: 'btn btn-danger', type: 'button', onclick: async () => {
          if (!confirm('ล้างข้อมูลทั้งหมดในเครื่องนี้ (การตั้งค่า รายการล่าสุด)? การกระทำนี้ย้อนกลับไม่ได้')) return;
          await clearAllLocalData(); toast('ล้างข้อมูลในเครื่องแล้ว', 'success'); setTimeout(() => location.reload(), 600);
        } }, svgIcon(ICONS.trash, 18), 'ล้างข้อมูลในเครื่องทั้งหมด'))),
    h('div', { class: 'card' }, h('h2', null, 'สถานะระบบ'),
      h('table', { class: 'kv' }, h('tbody', null,
        h('tr', null, h('th', null, 'ระบบ'), h('td', null, APP_FULL_NAME)),
        h('tr', null, h('th', null, 'เวอร์ชัน'), h('td', null, config.version)),
        h('tr', null, h('th', null, 'ผู้ใช้'), h('td', null, user ? `${user.name || ''} <${user.email}>` : 'โหมดในเครื่อง (ไม่ได้ล็อกอิน)')),
        h('tr', null, h('th', null, 'ขนาดไฟล์สูงสุด'), h('td', null, `${config.maxFileSizeMB} MB`)))),
      h('h3', { style: undefined }, 'Backend (Google Apps Script)'), backendOut,
      h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-sm', type: 'button', disabled: !backendConfigured(), onclick: checkBackend }, 'ตรวจสอบ Backend')),
      h('h3', null, 'เอนจินแปลงไฟล์ (MarkItDown-compatible)'), engineOut,
      h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-sm', type: 'button', onclick: checkEngine }, 'ตรวจสอบเอนจิน')))));
}
