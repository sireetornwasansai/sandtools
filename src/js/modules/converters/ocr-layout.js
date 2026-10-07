// OCR result → Markdown. Pure functions (no DOM, no Tesseract import) so they run and are tested in Node.
//
// Input is what Tesseract reports for one page: words with pixel boxes. We do NOT trust Tesseract's own line/paragraph
// grouping for forms and tables (it often reads a table column by column), so rows are rebuilt from the word boxes:
//   words → visual rows (same baseline) → cells (wide horizontal gaps) → tables (runs of rows whose cells line up) / paragraphs.
import { mdCell } from './common.js';

/** @typedef {{x0:number,y0:number,x1:number,y1:number}} Box */
/** @typedef {{text:string,bbox:Box,confidence?:number}} OcrWord */

const THAI_COMBINING = 'ัิ-ฺ็-๎';

/**
 * Fix the usual Tesseract Thai quirks: sara am written as nikhahit + sara aa, stray spaces before vowels/tone marks, control codes.
 * @param {string} s
 */
export function normalizeThai(s) {
  return String(s == null ? '' : s)
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f�]/g, '')
    .replace(/ํ([่-๋])า/g, '$1ำ')      // ํ + ้ + า  →  ้ + ำ
    .replace(/ํา/g, 'ำ')                          // ํ + า      →  ำ
    .replace(new RegExp(`\\s+([${THAI_COMBINING}])`, 'g'), '$1') // "ก ำ", "ก ้" → no space before a combining mark
    .replace(/[ \t]+/g, ' ')
    .trim();
}

const median = (arr) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

/**
 * Collect words from a Tesseract.js result (v6/v7 `blocks → paragraphs → lines → words`, or the older flat `lines`/`words`).
 * @param {any} data
 * @returns {OcrWord[]}
 */
export function wordsFromTesseract(data) {
  const out = [];
  const push = (w) => {
    const b = w && w.bbox;
    if (!b || ![b.x0, b.y0, b.x1, b.y1].every(Number.isFinite)) return;
    const text = String(w.text == null ? '' : w.text).replace(/\s+/g, ' ').trim();
    if (text) out.push({ text, bbox: { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 }, confidence: Number.isFinite(w.confidence) ? w.confidence : 100 });
  };
  const fromLines = (lines) => { for (const l of lines || []) for (const w of l.words || []) push(w); };
  if (data && Array.isArray(data.blocks)) {
    for (const bl of data.blocks) for (const p of bl.paragraphs || []) fromLines(p.lines);
  } else if (data && Array.isArray(data.lines)) fromLines(data.lines);
  else if (data && Array.isArray(data.words)) data.words.forEach(push);
  return out;
}

/** @param {OcrWord[]} words @param {number} H typical text height */
function buildRows(words, H) {
  const sorted = [...words].sort((a, b) => (a.bbox.y0 + a.bbox.y1) - (b.bbox.y0 + b.bbox.y1));
  const rows = [];
  for (const w of sorted) {
    const yc = (w.bbox.y0 + w.bbox.y1) / 2;
    const row = rows[rows.length - 1];
    if (row && Math.abs(yc - row.yc) <= 0.6 * H) { row.words.push(w); row.yc = mean(row.words.map((x) => (x.bbox.y0 + x.bbox.y1) / 2)); }
    else rows.push({ yc, words: [w] });
  }
  return rows.map((r) => {
    const ws = r.words.sort((a, b) => a.bbox.x0 - b.bbox.x0);
    return { yc: r.yc, words: ws, x0: ws[0].bbox.x0, x1: Math.max(...ws.map((w) => w.bbox.x1)), h: median(ws.map((w) => w.bbox.y1 - w.bbox.y0)) };
  });
}

/** Join the words of one run: a visible gap means a space (Thai writes spaces between phrases), touching words are glued. */
function joinWords(ws, H) {
  let text = '';
  ws.forEach((w, i) => { if (i) text += (w.bbox.x0 - ws[i - 1].bbox.x1) > 0.22 * H ? ' ' : ''; text += w.text; });
  return normalizeThai(text);
}

function splitCells(row, H, gap) {
  const cells = []; let cur = [];
  row.words.forEach((w, i) => {
    if (i && (w.bbox.x0 - row.words[i - 1].bbox.x1) > gap) { cells.push(cur); cur = []; }
    cur.push(w);
  });
  if (cur.length) cells.push(cur);
  return cells.map((ws) => ({ x0: ws[0].bbox.x0, x1: Math.max(...ws.map((w) => w.bbox.x1)), text: joinWords(ws, H) })).filter((c) => c.text);
}

/** A row with no letter or digit at all (ruled lines, stamps, specks). \w is ASCII-only in JS, so Thai must be matched with \p{L}. */
const isNoise = (t) => !/[\p{L}\p{N}]/u.test(t);

/**
 * @param {OcrWord[]} words
 * @param {{width?:number}} [opts] page width in pixels (used to recognise centred lines)
 * @returns {{markdown:string, confidence:number, words:number}}
 */
export function layoutToMarkdown(words, opts = {}) {
  const clean = words.filter((w) => w.bbox.y1 > w.bbox.y0 && w.bbox.x1 > w.bbox.x0);
  if (!clean.length) return { markdown: '', confidence: 0, words: 0 };
  const H = Math.max(8, median(clean.map((w) => w.bbox.y1 - w.bbox.y0)));
  const pageW = opts.width || Math.max(...clean.map((w) => w.bbox.x1));
  const confidence = Math.round(mean(clean.map((w) => w.confidence == null ? 100 : w.confidence)));

  const rows = buildRows(clean, H).map((r) => ({ ...r, cells: splitCells(r, H, 1.6 * H) })).filter((r) => r.cells.length && !isNoise(r.cells.map((c) => c.text).join('')));
  if (!rows.length) return { markdown: '', confidence, words: clean.length };

  // --- find tables: runs of rows that have ≥2 cells whose left edges line up
  const tol = 1.5 * H;
  const blocks = []; // {type:'table', rows} | {type:'row', row}
  for (let i = 0; i < rows.length;) {
    if (rows[i].cells.length < 2) { blocks.push({ type: 'row', row: rows[i] }); i++; continue; }
    let j = i; while (j < rows.length && rows[j].cells.length >= 2 && (rows[j].yc - rows[j - (j > i ? 1 : 0)].yc) < 3.2 * H) j++;
    const run = rows.slice(i, j);
    const starts = columnStarts(run, tol);
    const aligned = run.length >= 3 || (run.length === 2 && run[0].cells.length === run[1].cells.length && run[0].cells.every((c, k) => Math.abs(c.x0 - run[1].cells[k].x0) <= tol));
    if (aligned && starts.length >= 2) blocks.push({ type: 'table', rows: run, starts });
    else run.forEach((r) => blocks.push({ type: 'row', row: r }));
    i = j;
  }

  // --- emit
  const textRows = rows.filter((r) => r.cells.length < 2);
  // normal line pitch = a low quantile of the row-to-row distances (the median would be inflated by paragraph gaps)
  const dists = textRows.slice(1).map((r, k) => r.yc - textRows[k].yc).filter((d) => d > 0.5 * H && d < 4 * H).sort((a, b) => a - b);
  const pitch = Math.max(1.1 * H, dists.length ? dists[Math.floor(dists.length * 0.25)] : 1.6 * H);
  const leftMargin = textRows.length ? median(textRows.map((r) => r.x0)) : 0;   // robust against a few indented lines
  const isCentred = (r) => Math.abs((r.x0 + r.x1) / 2 - pageW / 2) < 0.04 * pageW && (r.x1 - r.x0) < 0.75 * pageW && r.x0 > leftMargin + 3 * H;
  const out = []; let para = []; let prev = null;
  const flush = () => { if (para.length) { out.push(para.join('\n')); para = []; } };
  for (const b of blocks) {
    if (b.type === 'table') { flush(); out.push(tableMd(b.rows, b.starts, tol)); prev = null; continue; }
    const r = b.row; const text = r.cells.map((c) => c.text).join(' ');
    const newPara = !prev || (r.yc - prev.yc) > 1.55 * pitch || r.x0 > leftMargin + 1.6 * H || isCentred(r) || isCentred(prev);
    if (newPara) flush();
    para.push(text); prev = r;
  }
  flush();
  return { markdown: out.join('\n\n'), confidence, words: clean.length };
}

/** Left edges of the columns: cluster the x0 of every cell. */
function columnStarts(rows, tol) {
  const xs = rows.flatMap((r) => r.cells.map((c) => c.x0)).sort((a, b) => a - b);
  const groups = [];
  for (const x of xs) { const g = groups[groups.length - 1]; if (g && x - g.max <= tol) { g.v.push(x); g.max = x; } else groups.push({ v: [x], max: x }); }
  // a column must be used by at least 2 rows (or the table has only 2 rows), otherwise it is a stray cell
  const need = rows.length >= 3 ? 2 : 1;
  return groups.filter((g) => g.v.length >= need).map((g) => Math.min(...g.v));
}

function tableMd(rows, starts, tol) {
  const n = starts.length;
  const grid = rows.map((r) => {
    const cells = Array(n).fill('');
    for (const c of r.cells) {
      let col = 0; for (let k = 0; k < n; k++) if (starts[k] <= c.x0 + tol) col = k;
      cells[col] = cells[col] ? `${cells[col]} ${c.text}` : c.text;
    }
    return cells;
  });
  const line = (cells) => `| ${cells.map(mdCell).join(' | ')} |`;
  // a scan of a table normally has no header row, so the Markdown header line is left empty rather than promoting a data row
  return [line(Array(n).fill('')), line(Array(n).fill('---')), ...grid.map(line)].join('\n');
}

/** Convenience for the browser engine: Tesseract result → Markdown. */
export function tesseractToMarkdown(data, opts) { return layoutToMarkdown(wordsFromTesseract(data), opts); }
