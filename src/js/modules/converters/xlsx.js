import { ConversionError, LIMITS, openZip, readXml, readRels, kid, kids, attr, relAttr, descendants, mdTable } from './common.js';

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

/** Excel column letters → zero-based index ("AB" → 27). */
export function colIndex(ref) {
  const m = /^([A-Z]+)/i.exec(ref || '');
  if (!m) return 0;
  let n = 0;
  for (const ch of m[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const pad = (n) => String(n).padStart(2, '0');
/** Excel serial → ISO-like string. */
export function serialToString(serial, date1904) {
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const d = new Date(epoch + Math.round(serial * 86400000));
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  if (serial < 1) return time;
  return Number.isInteger(serial) ? date : `${date} ${time}`;
}
function isDateFormat(code) {
  const c = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
  return /[ymdhs]/i.test(c) && !/^general$/i.test(c.trim());
}
/** Plain number text, avoiding scientific notation surprises for normal values. */
function numText(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  return String(n);
}

/** Read an .xlsx workbook into sheets: [{name, rows: string[][]}] (cell values as displayed; dates as text). */
export async function readXlsx(buf, opts = {}) {
  const zip = await openZip(buf);
  const wb = await readXml(zip, 'xl/workbook.xml');
  if (!wb) throw new ConversionError('CORRUPT', 'ไฟล์นี้ไม่ใช่สมุดงาน Excel (.xlsx) ที่ถูกต้อง');
  const rels = await readRels(zip, 'xl/workbook.xml');
  const date1904 = descendants(wb.documentElement, 'workbookPr').some((e) => ['1', 'true'].includes(attr(e, 'date1904')));
  const warnings = [];

  const shared = [];
  const ss = await readXml(zip, 'xl/sharedStrings.xml');
  if (ss) for (const si of kids(ss.documentElement, 'si')) shared.push(descendants(si, 't').filter((t) => !t.closest || !/rPh$/.test((t.parentElement && t.parentElement.localName) || '')).map((t) => t.textContent).join(''));

  // style index → is date?
  const dateXf = [];
  const styles = await readXml(zip, 'xl/styles.xml');
  if (styles) {
    const custom = new Map();
    for (const nf of descendants(styles.documentElement, 'numFmt')) custom.set(Number(attr(nf, 'numFmtId')), attr(nf, 'formatCode') || '');
    const cellXfs = kids(styles.documentElement, 'cellXfs')[0];
    for (const xf of kids(cellXfs, 'xf')) {
      const id = Number(attr(xf, 'numFmtId') || 0);
      dateXf.push(BUILTIN_DATE_FORMATS.has(id) || (custom.has(id) && isDateFormat(custom.get(id))));
    }
  }

  const out = [];
  const sheets = descendants(wb.documentElement, 'sheet');
  for (let i = 0; i < sheets.length; i++) {
    if (opts.deadline) opts.deadline.check();
    if (opts.onProgress) opts.onProgress((i + 1) / sheets.length);
    const name = attr(sheets[i], 'name') || `Sheet${i + 1}`;
    const rel = rels.get(relAttr(sheets[i], 'id'));
    if (!rel || rel.external) continue;
    const doc = await readXml(zip, rel.target);
    if (!doc) continue;
    const grid = [];
    let maxCol = -1; let truncated = false;
    const sheetData = descendants(doc.documentElement, 'sheetData')[0];
    let rowCounter = 0;
    for (const row of kids(sheetData, 'row')) {
      if (opts.deadline && rowCounter % 500 === 0) opts.deadline.check();
      const r = Number(attr(row, 'r')) ? Number(attr(row, 'r')) - 1 : rowCounter;
      rowCounter = r + 1;
      if (r >= LIMITS.maxRows) { truncated = true; break; }
      let colCounter = 0;
      for (const c of kids(row, 'c')) {
        const ci = attr(c, 'r') ? colIndex(attr(c, 'r')) : colCounter;
        colCounter = ci + 1;
        const t = attr(c, 't'); const v = kid(c, 'v');
        let val = '';
        if (t === 'inlineStr') val = descendants(kid(c, 'is'), 't').map((x) => x.textContent).join('');
        else if (v) {
          const raw = v.textContent || '';
          if (t === 's') val = shared[Number(raw)] ?? '';
          else if (t === 'b') val = raw === '1' ? 'TRUE' : 'FALSE';
          else if (t === 'str' || t === 'e') val = raw;
          else if (raw !== '') {
            const xf = Number(attr(c, 's') || 0);
            val = dateXf[xf] && Number.isFinite(Number(raw)) ? serialToString(Number(raw), date1904) : numText(raw);
          }
        }
        if (val !== '') { (grid[r] = grid[r] || [])[ci] = val; if (ci > maxCol) maxCol = ci; }
      }
    }
    const rows = [];
    for (let r = 0; r < grid.length; r++) { if (!grid[r]) rows.push(Array(maxCol + 1).fill('')); else rows.push(Array.from({ length: maxCol + 1 }, (_, c) => grid[r][c] ?? '')); }
    while (rows.length && rows[rows.length - 1].every((x) => x === '')) rows.pop();
    while (rows.length && rows[0].every((x) => x === '')) rows.shift();
    if (truncated) warnings.push(`ชีต "${name}" มีมากกว่า ${LIMITS.maxRows.toLocaleString('en-US')} แถว แปลงเฉพาะส่วนต้น`);
    out.push({ name, rows });
  }
  if (!out.length) warnings.push('ไม่พบชีตในไฟล์');
  return { sheets: out, warnings };
}

/** Convert an .xlsx workbook: one "## Sheet" section with a table per sheet (like MarkItDown/pandas). */
export async function convertXlsx(buf, opts = {}) {
  const { sheets, warnings } = await readXlsx(buf, opts);
  const sections = sheets.map((s) => `## ${s.name}\n\n${s.rows.length ? mdTable(s.rows) : '_(ชีตนี้ไม่มีข้อมูล)_'}`);
  return { markdown: `${sections.join('\n\n')}\n`, warnings };
}
