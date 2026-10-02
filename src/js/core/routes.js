import { ICONS } from './icons.js';

/**
 * Tool registry. Adding a module = adding one entry here + one file in modules/.
 * `load` is a dynamic import so each module is code-split and lazy-loaded.
 */
export const TOOLS = [
  { id: 'qr', path: '/qr', title: 'QR Code', fullTitle: 'QR Code Generator', desc: 'สร้าง QR จากลิงก์ ข้อความ Wi-Fi อีเมล โทรศัพท์ vCard',
    icon: ICONS.qr, keywords: 'qr qrcode คิวอาร์ barcode wifi vcard url sms email โทรศัพท์', load: () => import('../modules/qr.js') },
  { id: 'converter', path: '/converter', title: 'แปลงไฟล์', fullTitle: 'File Converter', desc: 'แปลง PDF, Word, PowerPoint, Excel, CSV, HTML เป็น Markdown',
    icon: ICONS.file, keywords: 'converter convert pdf docx word pptx powerpoint xlsx excel csv html txt markitdown แปลง ไฟล์', load: () => import('../modules/converter.js') }
];
export const SETTINGS_ROUTE = { id: 'settings', path: '/settings', title: 'ตั้งค่า', fullTitle: 'Settings', desc: 'ธีม ความเป็นส่วนตัว สถานะระบบ',
  icon: ICONS.settings, keywords: 'settings ตั้งค่า theme ธีม dark light privacy ล้างข้อมูล', load: () => import('../modules/settings.js') };
export const HOME_ROUTE = { id: 'home', path: '/', title: 'หน้าแรก', fullTitle: 'Dashboard', desc: 'หน้าแรก', icon: ICONS.home, keywords: 'home dashboard หน้าแรก', load: () => import('../modules/dashboard.js') };
export const ALL_ROUTES = [HOME_ROUTE, ...TOOLS, SETTINGS_ROUTE];

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
  const all = [...TOOLS, SETTINGS_ROUTE];
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
