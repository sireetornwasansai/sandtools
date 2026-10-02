import { h, svgIcon, nextId } from './dom.js';
import { ICONS } from './icons.js';
import { TOOLS, SETTINGS_ROUTE, navigate, searchTools } from './routes.js';
import { getSettings, setSettings } from './store.js';

/** @typedef {{id:string,label:string,hint?:string,icon:string,run:()=>void}} Command */

/** @returns {Command[]} commands matching the query: tools first, then actions. */
export function buildCommands(query) {
  const q = query.trim().toLowerCase();
  /** @type {Command[]} */
  const toolCmds = searchTools(query).map((t) => ({ id: `go-${t.id}`, label: t.fullTitle === t.title ? t.title : `${t.title} — ${t.fullTitle}`, hint: t.desc, icon: t.icon, run: () => navigate(t.path) }));
  /** @type {Command[]} */
  const actions = [
    { id: 'toggle-theme', label: 'สลับโหมดมืด/สว่าง', hint: 'Dark / Light', icon: ICONS.moon, run: () => {
      const dark = document.documentElement.getAttribute('data-theme') === 'dark';
      setSettings({ theme: dark ? 'light' : 'dark' });
    } },
    { id: 'settings', label: 'เปิดการตั้งค่า', hint: SETTINGS_ROUTE.desc, icon: ICONS.settings, run: () => navigate(SETTINGS_ROUTE.path) }
  ].filter((a) => !q || `${a.label} ${a.hint} ${a.id}`.toLowerCase().includes(q));
  const seen = new Set(toolCmds.map((c) => c.id));
  return [...toolCmds, ...actions.filter((a) => !seen.has(a.id))];
}

let open = false;
/** Open the command palette modal (Ctrl+K). */
export function openPalette() {
  if (open) return;
  open = true;
  const previouslyFocused = /** @type {HTMLElement|null} */ (document.activeElement);
  const listId = nextId('pal-list');
  let items = buildCommands('');
  let active = 0;
  const input = h('input', { type: 'text', class: 'palette-input', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': listId,
    'aria-autocomplete': 'list', 'aria-label': 'ค้นหาเครื่องมือหรือคำสั่ง', placeholder: 'พิมพ์เพื่อค้นหา เช่น PDF, QR…', autocomplete: 'off', spellcheck: 'false' });
  const list = h('ul', { class: 'palette-list', id: listId, role: 'listbox', 'aria-label': 'ผลการค้นหา' });
  const dialog = h('div', { class: 'palette', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'ค้นหาเครื่องมือ' },
    h('div', { class: 'palette-head' }, svgIcon(ICONS.search), input), list,
    h('div', { class: 'palette-foot' }, '↑↓ เลือก · Enter เปิด · Esc ปิด'));
  const overlay = h('div', { class: 'overlay', onmousedown: (e) => { if (e.target === overlay) close(); } }, dialog);

  function render() {
    list.replaceChildren();
    if (!items.length) list.append(h('li', { class: 'palette-empty', role: 'presentation' }, 'ไม่พบเครื่องมือที่ตรงกับคำค้นหา'));
    items.forEach((c, i) => {
      const li = h('li', { id: `${listId}-${i}`, role: 'option', class: `palette-item${i === active ? ' active' : ''}`, 'aria-selected': i === active ? 'true' : 'false',
        onmousemove: () => { if (active !== i) { active = i; render(); } }, onclick: () => choose(i) },
      svgIcon(c.icon), h('span', { class: 'palette-label' }, c.label), c.hint ? h('span', { class: 'palette-hint' }, c.hint) : null);
      list.append(li);
    });
    input.setAttribute('aria-activedescendant', items.length ? `${listId}-${active}` : '');
    const el = list.children[active]; if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }
  function choose(i) { const c = items[i]; close(false); if (c) c.run(); }
  function close(restore = true) {
    if (!open) return; open = false; overlay.remove(); document.removeEventListener('keydown', onKey, true);
    if (restore && previouslyFocused && previouslyFocused.focus) previouslyFocused.focus();
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); if (items.length) { active = (active + 1) % items.length; render(); } }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (items.length) { active = (active - 1 + items.length) % items.length; render(); } }
    else if (e.key === 'Enter') { e.preventDefault(); if (items.length) choose(active); }
    else if (e.key === 'Tab') { e.preventDefault(); input.focus(); } // keep focus trapped in the dialog
  }
  input.addEventListener('input', () => { items = buildCommands(input.value); active = 0; render(); });
  document.addEventListener('keydown', onKey, true);
  document.body.append(overlay);
  render(); input.focus();
}
export { TOOLS, getSettings };
