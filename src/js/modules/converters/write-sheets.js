// Spreadsheet writers: sheets [{name, rows: string[][]}] → .xlsx (written by hand, no library), CSV and JSON.
import { getJSZip } from './common.js';

const bad = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g;
const esc = (s) => String(s).replace(bad, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const NUM = /^-?(0|[1-9]\d{0,14})(\.\d{1,14})?$/;   // "007" and long ids stay text

export function colName(i) { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; }

/** Excel sheet names: ≤31 chars, none of : \ / ? * [ ], unique. */
export function sheetNames(names) {
  const used = new Set();
  return names.map((n, i) => {
    let base = String(n || '').replace(/[:\\/?*[\]]/g, ' ').replace(/^'+|'+$/g, '').trim().slice(0, 31) || `Sheet${i + 1}`;
    let name = base; let k = 2;
    while (used.has(name.toLowerCase())) { const suf = ` (${k++})`; name = base.slice(0, 31 - suf.length) + suf; }
    used.add(name.toLowerCase()); return name;
  });
}

/** Rough display width: Thai combining marks take no space, wide (CJK) chars take two. */
function width(s) {
  let w = 0; for (const ch of String(s)) { const c = ch.codePointAt(0); if ((c >= 0xe31 && c <= 0xe3a && c !== 0xe32 && c !== 0xe33) || (c >= 0xe47 && c <= 0xe4e)) continue; w += c > 0x2e80 && !(c >= 0xe00 && c <= 0xe7f) ? 2 : 1; }
  return w;
}

/** @param {Array<{name:string,rows:string[][]}>} sheets @returns {Promise<Blob>} */
export async function writeXlsx(sheets, { header = true } = {}) {
  const JSZip = await getJSZip();
  const list = sheets.length ? sheets : [{ name: 'Sheet1', rows: [] }];
  const names = sheetNames(list.map((s) => s.name));
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${list.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${list.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  // styles: 0 normal, 1 header (bold, grey fill, border), 2 text wrap, 3 number right-aligned default
  zip.file('xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Tahoma"/><family val="2"/></font><font><b/><sz val="11"/><name val="Tahoma"/><family val="2"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8ECF4"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFBFC5D2"/></left><right style="thin"><color rgb="FFBFC5D2"/></right><top style="thin"><color rgb="FFBFC5D2"/></top><bottom style="thin"><color rgb="FFBFC5D2"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>');
  list.forEach((sh, si) => {
    const rows = (sh.rows || []).slice(0, 1048576);
    const cols = rows.reduce((m, r) => Math.max(m, r.length), 0);
    const widths = Array(cols).fill(8);
    for (const r of rows.slice(0, 2000)) r.forEach((v, c) => { const w = Math.min(60, Math.max(...String(v ?? '').split('\n').map(width)) + 2); if (w > widths[c]) widths[c] = w; });
    const body = rows.map((r, ri) => {
      const cells = [];
      for (let c = 0; c < cols; c++) {
        const v = r[c]; if (v === undefined || v === null || v === '') continue;
        const ref = `${colName(c)}${ri + 1}`; const txt = String(v);
        const isHead = header && ri === 0;
        if (!isHead && NUM.test(txt)) cells.push(`<c r="${ref}"><v>${txt}</v></c>`);
        else cells.push(`<c r="${ref}" t="inlineStr"${isHead ? ' s="1"' : /\n/.test(txt) ? ' s="2"' : ''}><is><t xml:space="preserve">${esc(txt)}</t></is></c>`);
      }
      return cells.length ? `<row r="${ri + 1}">${cells.join('')}</row>` : '';
    }).join('');
    const frozen = header && rows.length > 1 ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
    zip.file(`xl/worksheets/sheet${si + 1}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${frozen}<sheetFormatPr defaultRowHeight="15"/>${cols ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w.toFixed(1)}" customWidth="1"/>`).join('')}</cols>` : ''}<sheetData>${body}</sheetData></worksheet>`);
  });
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', compression: 'DEFLATE' });
}

/** CSV with a UTF-8 BOM so Excel shows Thai correctly. Fields starting with = + - @ are NOT altered (data fidelity); quoted when needed. */
export function writeCsv(rows) {
  const q = (v) => { const s = String(v ?? '').replace(bad, ''); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return `\uFEFF${rows.map((r) => r.map(q).join(',')).join('\r\n')}\r\n`;
}

/** JSON: first row = keys when they are unique and non-empty; numbers stay numbers. */
export function writeJson(sheets) {
  const val = (s) => (NUM.test(s) ? Number(s) : s);
  const out = sheets.map((sh) => {
    const [head = [], ...rest] = sh.rows;
    const keys = head.map((k) => String(k).trim());
    const objectMode = keys.length > 0 && keys.every(Boolean) && new Set(keys).size === keys.length && rest.length > 0;
    return { sheet: sh.name, rows: objectMode ? rest.map((r) => Object.fromEntries(keys.map((k, i) => [k, val(r[i] ?? '')]))) : sh.rows.map((r) => r.map(val)) };
  });
  return `${JSON.stringify(out.length === 1 ? out[0].rows : out, null, 2)}\n`;
}
