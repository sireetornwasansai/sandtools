import { ICONS } from './icons.js';

/**
 * Tool registry. Adding a module = adding one entry here + one file in modules/.
 * `load` is a dynamic import so each module is code-split and lazy-loaded.
 */
export const TOOLS = [
  { id: 'qr', path: '/qr', title: 'QR Code', fullTitle: 'QR Code Generator', desc: 'สร้าง QR จากลิงก์ ข้อความ Wi-Fi อีเมล โทรศัพท์ vCard',
    icon: ICONS.qr, keywords: 'qr qrcode คิวอาร์ barcode wifi vcard url sms email โทรศัพท์', load: () => import('../modules/qr.js') },
  { id: 'converter', path: '/converter', title: 'แปลงไฟล์', fullTitle: 'File Converter', desc: 'แปลง PDF, Word, PowerPoint, Excel, CSV, HTML เป็น Markdown',
    icon: ICONS.file, keywords: 'converter convert pdf docx word pptx powerpoint xlsx excel csv html txt markitdown แปลง ไฟล์', load: () => import('../modules/converter.js') },
  { id: 'compress', path: '/compress', title: 'ย่อไฟล์', fullTitle: 'ย่อไฟล์', desc: 'ลดขนาดรูปภาพ และรวมไฟล์เป็น ZIP เพื่อส่งหรืออัปโหลด',
    icon: ICONS.crop, keywords: 'compress resize shrink zip ย่อ ลดขนาด บีบอัด รูป ภาพ ไฟล์ใหญ่', load: () => import('../modules/compress.js') },
  { id: 'prompt', path: '/prompt', title: 'สร้าง Prompt', fullTitle: 'สร้าง Prompt', desc: 'Prompt สำหรับสร้างเว็บ หรือระดมไอเดียระบบสาธารณสุข',
    icon: ICONS.edit, keywords: 'prompt พรอมต์ เว็บ website ai chatgpt claude ไอเดีย สาธารณสุข สุขภาพ ระบบ', load: () => import('../modules/prompt.js') },
  { id: 'skill', path: '/skill', title: 'skill.md', fullTitle: 'สร้าง skill.md', desc: 'แปลงเอกสารเป็น SKILL.md ให้ AI อ่านง่าย',
    icon: ICONS.markdown, keywords: 'skill md markdown ai agent claude แปลง เอกสาร คู่มือ', load: () => import('../modules/skill.js') }
];
export const LIBRARY_ROUTE = { id: 'library', path: '/library', title: 'คลังข้อมูล', fullTitle: 'คลังข้อมูล', desc: 'ดูไฟล์ล่าสุด และจัดการโฟลเดอร์เก็บข้อมูลใน Google Drive',
  icon: ICONS.cloud, keywords: 'library คลัง คลังข้อมูล โฟลเดอร์ folder drive ไฟล์ล่าสุด เอกสาร จัดการ จัดเก็บ', load: () => import('../modules/library.js') };
export const HISTORY_ROUTE = { id: 'history', path: '/history', title: 'ประวัติ', fullTitle: 'ประวัติการใช้งาน', desc: 'ดูประวัติการใช้งานที่หน่วยงานบันทึกไว้',
  icon: ICONS.list, keywords: 'history log ประวัติ บันทึก การใช้งาน', load: () => import('../modules/history.js') };
export const SETTINGS_ROUTE = { id: 'settings', path: '/settings', title: 'ตั้งค่า', fullTitle: 'Settings', desc: 'ธีม ความเป็นส่วนตัว สถานะระบบ',
  icon: ICONS.settings, keywords: 'settings ตั้งค่า theme ธีม dark light privacy ล้างข้อมูล', load: () => import('../modules/settings.js') };
export const HOME_ROUTE = { id: 'home', path: '/', title: 'หน้าแรก', fullTitle: 'Dashboard', desc: 'หน้าแรก', icon: ICONS.home, keywords: 'home dashboard หน้าแรก', load: () => import('../modules/dashboard.js') };
export const ALL_ROUTES = [HOME_ROUTE, ...TOOLS, LIBRARY_ROUTE, HISTORY_ROUTE, SETTINGS_ROUTE];

/** Parse "#/path?x=1" into {path, params}. */
export function parseHash(hash = location.hash) {
  const raw = hash.replace(/^#/, '') || '/';
  const [p, q = ''] = raw.split('?');
  return { path: p.startsWith('/') ? p : `/${p}`, params: new URLSearchParams(q) };
}
export function findRoute(path) { return ALL_ROUTES.find((r) => r.path === path) || null; }
export function navigate(path, params) {
  const q = params ? `?${new URLSearchParams(params)}` : '';
  location.hash = `#${path}${q}`;
}

/** Score tools against a query (title, id, keywords). Empty query returns everything. */
export function searchTools(query) {
  const q = query.trim().toLowerCase();
  const all = [...TOOLS, LIBRARY_ROUTE, HISTORY_ROUTE, SETTINGS_ROUTE];
  if (!q) return all;
  const scored = all.map((t) => {
    const hay = `${t.title} ${t.fullTitle} ${t.id} ${t.keywords} ${t.desc}`.toLowerCase();
    let score = 0;
    if (t.title.toLowerCase().startsWith(q) || t.id.startsWith(q)) score += 5;
    if (hay.includes(q)) score += 3;
    for (const word of q.split(/\s+/)) if (word && t.keywords.toLowerCase().split(' ').some((k) => k.startsWith(word))) score += 2;
    return { t, score };
  });
  return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).map((s) => s.t);
}
