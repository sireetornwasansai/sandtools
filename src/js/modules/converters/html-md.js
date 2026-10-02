import { mdTable, escapeInline, escapeLineStart, wrapMarker } from './common.js';

const SKIP = new Set(['script', 'style', 'noscript', 'template', 'iframe', 'object', 'embed', 'head', 'svg', 'canvas', 'link', 'meta', 'title', 'button', 'select', 'option', 'textarea']);
const BLOCK = new Set(['p', 'div', 'section', 'article', 'header', 'footer', 'main', 'aside', 'figure', 'figcaption', 'details', 'summary', 'address', 'form', 'fieldset', 'dl', 'dt', 'dd', 'center', 'body', 'html', 'nav', 'caption']);

/** Collapse whitespace and tidy an inline run. */
function cleanInline(s) { return s.replace(/[ \t\f\v]*\n[ \t\f\v]*/g, (m) => (m.includes('\n') ? '\n' : m)).replace(/ {2,}(?!\n)/g, ' ').trim(); }

/**
 * Convert a DOM node (Document or Element) into Markdown.
 * Output style follows MarkItDown/markdownify: ATX headings, "*" bullets, fenced code, GFM tables.
 * @param {Node} root
 */
export function htmlToMarkdown(root) {
  const body = root.nodeType === 9 ? (/** @type {Document} */ (root).body || /** @type {Document} */ (root).documentElement) : root;
  const md = convChildren(body, { inPre: false });
  return md.replace(/[ \t]+$/gm, (m, off, all) => (m.length >= 2 && all[off + m.length] === '\n' ? '  ' : '')).replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function convChildren(node, ctx) { return Array.from(node.childNodes).map((n) => conv(n, ctx)).join(''); }

function conv(node, ctx) {
  if (node.nodeType === 3) {
    if (ctx.inPre) return node.nodeValue;
    return escapeInline(node.nodeValue.replace(/[ \t\r\n\f]+/g, ' '));
  }
  if (node.nodeType !== 1) return '';
  const el = /** @type {Element} */ (node);
  const tag = el.tagName.toLowerCase();
  if (SKIP.has(tag) || el.hasAttribute('hidden')) return '';

  const inner = () => convChildren(el, ctx);
  const m = tag.match(/^h([1-6])$/);
  if (m) { const t = cleanInline(inner()); return t ? `\n\n${'#'.repeat(Number(m[1]))} ${t.replace(/\n/g, ' ')}\n\n` : ''; }

  switch (tag) {
    case 'br': return '  \n';
    case 'hr': return '\n\n---\n\n';
    case 'strong': case 'b': return wrapMarker('**', inner());
    case 'em': case 'i': return wrapMarker('*', inner());
    case 'del': case 's': case 'strike': return wrapMarker('~~', inner());
    case 'code': {
      if (ctx.inPre) return inner();
      const t = el.textContent || '';
      if (!t.trim()) return '';
      const fence = t.includes('`') ? '``' : '`';
      return `${fence}${t}${fence}`;
    }
    case 'pre': {
      const code = el.querySelector('code');
      const cls = (code && code.getAttribute('class')) || '';
      const lang = (cls.match(/(?:language|lang)-([\w+#-]+)/) || [])[1] || '';
      const text = (el.textContent || '').replace(/\n+$/, '');
      return `\n\n\`\`\`${lang}\n${text}\n\`\`\`\n\n`;
    }
    case 'a': {
      const href = (el.getAttribute('href') || '').trim();
      const text = cleanInline(inner());
      if (!text) return '';
      if (!href || /^\s*javascript:/i.test(href) || href.startsWith('#')) return text;
      const title = el.getAttribute('title');
      return `[${text}](${href.replace(/ /g, '%20').replace(/\)/g, '%29')}${title ? ` "${title.replace(/"/g, '\\"')}"` : ''})`;
    }
    case 'img': {
      const src = el.getAttribute('src') || '';
      const alt = (el.getAttribute('alt') || '').replace(/[\[\]\n]/g, ' ').trim();
      const shown = src.startsWith('data:') ? `${src.slice(0, src.indexOf(',') > 0 ? src.indexOf(',') : 20)}...` : src;
      return src ? `![${alt}](${shown})` : '';
    }
    case 'ul': case 'ol': return `\n\n${list(el, ctx)}\n\n`;
    case 'li': return `\n\n${list(el.parentElement || el, ctx)}\n\n`;
    case 'blockquote': {
      const t = convChildren(el, ctx).replace(/\n{3,}/g, '\n\n').trim();
      return t ? `\n\n${t.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n')}\n\n` : '';
    }
    case 'table': return `\n\n${table(el, ctx)}\n\n`;
    case 'input': {
      const t = (el.getAttribute('type') || '').toLowerCase();
      return t === 'checkbox' ? (el.hasAttribute('checked') ? '[x] ' : '[ ] ') : '';
    }
    case 'p': { const t = escapeLineStart(cleanInline(inner())); return t ? `\n\n${t}\n\n` : ''; }
    case 'dt': return `\n\n${wrapMarker('**', cleanInline(inner()))}\n`;
    case 'dd': return `\n: ${cleanInline(inner())}\n\n`;
    default:
      if (BLOCK.has(tag)) { const t = inner(); return t.trim() ? `\n\n${t.trim()}\n\n` : ''; }
      return inner();
  }
}

function list(listEl, ctx) {
  const ordered = listEl.tagName.toLowerCase() === 'ol';
  let n = ordered ? Number(listEl.getAttribute('start')) || 1 : 0;
  const items = [];
  for (const li of Array.from(listEl.children)) {
    if (li.tagName.toLowerCase() !== 'li') continue;
    const marker = ordered ? `${n++}. ` : '* ';
    const content = Array.from(li.childNodes).map((c) => {
      const tag = c.nodeType === 1 ? /** @type {Element} */ (c).tagName.toLowerCase() : '';
      if (tag === 'ul' || tag === 'ol') return `\n${list(/** @type {Element} */ (c), ctx)}\n`;
      return conv(c, ctx);
    }).join('').replace(/\n{2,}/g, '\n').trim();
    const pad = ' '.repeat(marker.length);
    items.push(marker + content.split('\n').map((l, i) => (i === 0 ? l : (l ? pad + l : l))).join('\n'));
  }
  return items.join('\n');
}

function table(tableEl, ctx) {
  const rows = [];
  for (const tr of Array.from(tableEl.querySelectorAll('tr'))) {
    if (tr.closest('table') !== tableEl) continue; // skip rows of nested tables
    const cells = [];
    for (const td of Array.from(tr.children)) {
      const t = td.tagName.toLowerCase();
      if (t !== 'td' && t !== 'th') continue;
      cells.push(cleanInline(convChildren(td, ctx)).replace(/\n+/g, ' '));
      const span = Math.min(Number(td.getAttribute('colspan')) || 1, 50);
      for (let i = 1; i < span; i++) cells.push('');
    }
    if (cells.length) rows.push(cells);
  }
  return mdTable(rows);
}
