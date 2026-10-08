// Markdown → plain text (headings/paragraphs on their own lines, lists with "-", tables tab separated, no markup).
import { Lexer } from '../../vendor/marked.esm.js';

export const ent = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
export const inlineText = (tokens) => (tokens || []).map((t) => {
  if (t.type === 'br') return '\n';
  if (t.type === 'image') return t.text ? `[${ent(t.text)}]` : '';
  if (t.type === 'html') return ent(String(t.text).replace(/<br\s*\/?>/gi, '\n').replace(/<\/?[a-z][^>]*>/gi, ''));
  if (t.type === 'checkbox') return t.checked ? '[x] ' : '[ ] ';
  return t.tokens ? inlineText(t.tokens) : ent(t.text ?? '');
}).join('');

function block(t, depth = 0) {
  switch (t.type) {
    case 'heading': case 'paragraph': case 'text': return `${inlineText(t.tokens || [{ type: 'text', text: t.text }])}\n\n`;
    case 'code': return `${t.text}\n\n`;
    case 'blockquote': return t.tokens.map((x) => block(x, depth)).join('').replace(/^(?=.)/gm, '> ');
    case 'hr': return `${'-'.repeat(24)}\n\n`;
    case 'html': return `${inlineText([t])}\n\n`;
    case 'list': return `${t.items.map((it, i) => {
      const mark = t.ordered ? `${(Number(t.start) || 1) + i}.` : '-';
      const inner = it.tokens.map((k) => (k.type === 'list' ? `\n${block(k, depth + 1)}` : inlineText(k.tokens || [{ type: 'text', text: k.text }]))).join('').replace(/\n+$/, '');
      return `${'  '.repeat(depth)}${mark} ${inner}`;
    }).join('\n')}\n${depth ? '' : '\n'}`;
    case 'table': return `${[t.header, ...t.rows].map((r) => r.map((c) => inlineText(c.tokens).replace(/\n/g, ' ')).join('\t')).join('\n')}\n\n`;
    default: return t.tokens ? `${inlineText(t.tokens)}\n\n` : '';
  }
}

/** @param {string} md */
export function markdownToText(md) {
  const toks = new Lexer({ gfm: true }).lex(md);
  return `${toks.map((t) => block(t)).join('').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

/** Collect every table of a Markdown document: [{name, rows}] (name = nearest heading above, else "Table n"). */
export function markdownTables(md) {
  const out = []; let heading = '';
  const walk = (toks) => {
    for (const t of toks) {
      if (t.type === 'heading') heading = inlineText(t.tokens).trim();
      else if (t.type === 'table') {
        out.push({ name: heading || `Table ${out.length + 1}`, rows: [t.header, ...t.rows].map((r) => r.map((c) => inlineText(c.tokens).replace(/\n/g, ' ').trim())) });
        heading = '';
      } else if (t.type === 'blockquote' && t.tokens) walk(t.tokens);
      else if (t.type === 'list') for (const it of t.items) walk(it.tokens || []);
    }
  };
  walk(new Lexer({ gfm: true }).lex(md));
  return out;
}
