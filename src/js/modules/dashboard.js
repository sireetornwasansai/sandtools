import { h, svgIcon } from '../core/dom.js';
import { TOOLS } from '../core/routes.js';
import { getRecent } from '../core/store.js';
import { privacyNotice } from '../core/notices.js';
import { recording, recordingNote } from '../core/logger.js';
import { openPalette } from '../core/palette.js';

/** Home page: simple tool cards + recent activity (stored only in this browser). */
export function mount(root) {
  const recent = getRecent();
  const tools = recent.filter((r) => r.kind === 'tool');

  const cards = TOOLS.map((t) => h('a', { class: 'tool-card', href: `#${t.path}` },
    svgIcon(t.icon, 28), h('strong', null, t.fullTitle), h('span', { class: 'd' }, t.desc)));

  const chips = (items) => h('ul', { class: 'recent-list' }, items.map((r) =>
    h('li', null, h('a', { href: `#${r.path}` }, r.label))));

  root.append(h('div', { class: 'page' },
    h('section', { class: 'hero' },
      h('h1', null, 'SAND Office Tools'),
      h('p', null, 'เครื่องมือดิจิทัลสำหรับงานสำนักงาน ในที่เดียว'),
      h('button', { class: 'btn', type: 'button', onclick: openPalette }, svgIcon('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>', 18), 'ค้นหาเครื่องมือ (Ctrl+K)')),
    h('div', { class: 'tool-grid' }, cards),
    tools.length ? h('section', { class: 'block' }, h('h2', null, 'ใช้งานล่าสุด'), chips(tools)) : null,
    h('section', { class: 'block' }, privacyNotice({ detail: recording() ? `เครื่องมือทำงานในเบราว์เซอร์ของคุณ · ${recordingNote()}` : 'เครื่องมือทำงานในเบราว์เซอร์ของคุณ ไฟล์ไม่ถูกอัปโหลดไปยังเซิร์ฟเวอร์ใด ๆ' }))));
}
