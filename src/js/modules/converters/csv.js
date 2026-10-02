import { LIMITS, mdTable } from './common.js';

/** Pick the most likely delimiter from the first lines (outside quotes). */
export function detectDelimiter(text) {
  const sample = text.split(/\r\n|\n|\r/).slice(0, 8).join('\n');
  let best = ','; let bestScore = -1;
  for (const d of [',', ';', '\t', '|']) {
    let count = 0; let q = false;
    for (const ch of sample) { if (ch === '"') q = !q; else if (!q && ch === d) count++; }
    if (count > bestScore) { bestScore = count; best = d; }
  }
  return best;
}

/** RFC 4180 style parser (quotes, escaped quotes, embedded newlines). */
export function parseCsv(text, delim = detectDelimiter(text), maxRows = Infinity) {
  const rows = []; let row = []; let field = ''; let q = false; let truncated = false;
  const push = () => { row.push(field); field = ''; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += ch;
    } else if (ch === '"' && field === '') q = true;
    else if (ch === delim) push();
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      push(); rows.push(row); row = [];
      if (rows.length >= maxRows) { truncated = true; break; }
    } else field += ch;
  }
  if (!truncated && (field !== '' || row.length)) { push(); rows.push(row); }
  return { rows: rows.filter((r) => !(r.length === 1 && r[0] === '')), truncated };
}

/** @param {string} text */
export function convertCsv(text) {
  const { rows, truncated } = parseCsv(text, undefined, LIMITS.maxRows);
  const warnings = truncated ? [`ไฟล์มีมากกว่า ${LIMITS.maxRows.toLocaleString('en-US')} แถว แปลงเฉพาะส่วนต้น`] : [];
  if (!rows.length) return { markdown: '', warnings: ['ไฟล์ CSV ว่างเปล่า'] };
  return { markdown: `${mdTable(rows)}\n`, warnings };
}
