// Thai PDFs from Chrome/Cairo/Skia-style generators draw text with Type 3 fonts whose ToUnicode maps are incomplete:
// tone marks (่ ้ ๊ ๋), ์ and many stacked vowels have no mapping, so pdf.js returns "ผู" for "ผู้" and "ไม" for "ไม่".
// These generators do write the correct text as /ActualText on marked-content spans (`/Span <</ActualText <FEFF…>>> BDC … EMC`).
// pdf.js does not expose ActualText, so we read it from the page content stream ourselves and substitute it for the glyph runs inside the span.
// Everything is defensive: any mismatch between our scan and pdf.js's marked-content items leaves that page untouched.

const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]); // ( ) < > [ ] { } / %

/** Decode a PDF text string given as raw bytes (UTF-16BE with BOM, otherwise Latin-1/PDFDocEncoding approximation). */
export function decodePdfTextString(bytes) {
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let s = '';
    for (let i = 2; i + 1 < bytes.length; i += 2) s += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
    return s;
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes.subarray(3));
  let s = ''; for (const b of bytes) s += String.fromCharCode(b); return s;
}

/**
 * Scan one content stream and list, in order, every BDC (marked content WITH properties). Each entry is the ActualText string or null.
 * BMC (no properties) is not listed, mirroring pdf.js, which reports BMC and BDC as different item types.
 * @param {Uint8Array} data decoded content stream
 * @returns {Array<string|null>}
 */
export function scanMarkedContent(data) {
  const out = [];
  const n = data.length;
  /** @type {any[]} operands collected since the last operator (flattened, dictionaries included) */
  let operands = [];
  let i = 0;
  const readString = () => { // at '(' — returns bytes
    const bytes = []; let depth = 1; i++;
    while (i < n && depth > 0) {
      const c = data[i];
      if (c === 0x5c) { // backslash escape
        const d = data[i + 1];
        if (d === 0x6e) bytes.push(10); else if (d === 0x72) bytes.push(13); else if (d === 0x74) bytes.push(9);
        else if (d === 0x62) bytes.push(8); else if (d === 0x66) bytes.push(12);
        else if (d >= 0x30 && d <= 0x37) { let v = 0, k = 0; while (k < 3 && data[i + 1] >= 0x30 && data[i + 1] <= 0x37) { v = v * 8 + (data[i + 1] - 0x30); i++; k++; } bytes.push(v & 255); i++; continue; }
        else if (d === 10 || d === 13) { if (d === 13 && data[i + 2] === 10) i++; i += 2; continue; }
        else if (d !== undefined) bytes.push(d);
        i += 2; continue;
      }
      if (c === 0x28) depth++;
      else if (c === 0x29) { depth--; if (depth === 0) { i++; break; } }
      bytes.push(c); i++;
    }
    return Uint8Array.from(bytes);
  };
  const readHex = () => { // at '<' (not '<<')
    let hex = ''; i++;
    while (i < n && data[i] !== 0x3e) { const c = data[i]; if (!WS.has(c)) hex += String.fromCharCode(c); i++; }
    i++;
    if (hex.length % 2) hex += '0';
    const b = new Uint8Array(hex.length / 2);
    for (let k = 0; k < b.length; k++) b[k] = parseInt(hex.substr(k * 2, 2), 16) || 0;
    return b;
  };
  while (i < n) {
    const c = data[i];
    if (WS.has(c)) { i++; continue; }
    if (c === 0x25) { while (i < n && data[i] !== 10 && data[i] !== 13) i++; continue; } // comment
    if (c === 0x28) { operands.push({ t: 's', v: readString() }); continue; }
    if (c === 0x3c) {
      if (data[i + 1] === 0x3c) { i += 2; operands.push({ t: 'd<' }); continue; }
      operands.push({ t: 's', v: readHex() }); continue;
    }
    if (c === 0x3e) { i += data[i + 1] === 0x3e ? 2 : 1; operands.push({ t: 'd>' }); continue; }
    if (c === 0x5b || c === 0x5d || c === 0x7b || c === 0x7d || c === 0x29) { i++; continue; }
    if (c === 0x2f) { // name
      let j = i + 1; while (j < n && !WS.has(data[j]) && !DELIM.has(data[j])) j++;
      let name = ''; for (let k = i + 1; k < j; k++) name += String.fromCharCode(data[k]);
      name = name.replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
      operands.push({ t: 'n', v: name }); i = j; continue;
    }
    // number or operator keyword
    let j = i; while (j < n && !WS.has(data[j]) && !DELIM.has(data[j])) j++;
    let word = ''; for (let k = i; k < j; k++) word += String.fromCharCode(data[k]);
    i = j;
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) { operands.push({ t: 'num' }); continue; }
    if (word === 'BDC') {
      let actual = null;
      for (let k = 0; k < operands.length - 1; k++) if (operands[k].t === 'n' && operands[k].v === 'ActualText' && operands[k + 1].t === 's') { actual = decodePdfTextString(operands[k + 1].v); break; }
      out.push(actual);
    } else if (word === 'ID') { // inline image data: skip to EI
      while (i < n) { if (data[i] === 0x45 && data[i + 1] === 0x49 && WS.has(data[i - 1] ?? 32) && (i + 2 >= n || WS.has(data[i + 2]))) { i += 2; break; } i++; }
    }
    operands = [];
  }
  return out;
}

/**
 * Replace the glyph runs inside ActualText spans by the ActualText itself.
 * @param {Array<any>} items pdf.js text content items fetched with `includeMarkedContent: true`
 * @param {Array<string|null>} spans result of scanMarkedContent for the same page
 * @returns {{items: any[], ok: boolean, replaced: number}} ok=false means the scan and pdf.js disagree → caller must keep its original items
 */
export function applyActualText(items, spans) {
  const propsCount = items.filter((it) => it.type === 'beginMarkedContentProps').length;
  if (propsCount !== spans.length) return { items: [], ok: false, replaced: 0 };
  const out = []; let k = 0; let replaced = 0;
  /** @type {Array<{actual:string|null}>} */ const stack = [];
  let active = null; // outermost span that has ActualText: { actual, depth, first, endX }
  for (const it of items) {
    if (it.type === 'beginMarkedContentProps' || it.type === 'beginMarkedContent') {
      const actual = it.type === 'beginMarkedContentProps' ? spans[k++] : null;
      stack.push({ actual });
      if (!active && actual) active = { actual, depth: stack.length, first: null, endX: 0, trail: [] };
      continue;
    }
    if (it.type === 'endMarkedContent') {
      const top = stack.pop();
      if (active && top && stack.length + 1 === active.depth) {
        if (active.first) {
          const f = active.first;
          out.push({ str: active.actual, dir: f.dir, transform: f.transform, width: Math.max(0, active.endX - f.transform[4]), height: f.height, fontName: f.fontName, hasEOL: false });
          replaced++;
          out.push(...active.trail);
        } else out.push({ str: active.actual, dir: 'ltr', transform: [1, 0, 0, 1, 0, 0], width: 0, height: 0, fontName: '', hasEOL: false, orphan: true });
        active = null;
      }
      continue;
    }
    if (typeof it.str !== 'string') continue;
    if (active) {
      // ActualText never contains the spaces drawn inside the span, so keep them: leading ones before the replacement, the rest after it
      if (it.str !== '' && it.str.trim() === '') { (active.first ? active.trail : out).push(it); continue; }
      if (!active.first && it.str !== '') active.first = it;
      if (active.first) active.endX = Math.max(active.endX, it.transform[4] + (it.width || 0));
      continue;
    }
    out.push(it);
  }
  return { items: out.filter((it) => !it.orphan), ok: true, replaced };
}

// Thai "presentation form" glyphs in the Unicode private-use area (Microsoft/Apple Thai PUA). Fonts that map tone marks and stacked vowels to these
// code points make pdf.js return U+F70A, U+F70B … instead of ่ ้ …; they render as boxes or vanish in most fonts, so map them back to standard Thai.
const THAI_PUA = {
  0xf700: 0x0e10, 0xf701: 0x0e34, 0xf702: 0x0e35, 0xf703: 0x0e36, 0xf704: 0x0e37,
  0xf705: 0x0e48, 0xf706: 0x0e49, 0xf707: 0x0e4a, 0xf708: 0x0e4b, 0xf709: 0x0e4c,
  0xf70a: 0x0e48, 0xf70b: 0x0e49, 0xf70c: 0x0e4a, 0xf70d: 0x0e4b, 0xf70e: 0x0e4c,
  0xf70f: 0x0e0d, 0xf710: 0x0e31, 0xf711: 0x0e4d, 0xf712: 0x0e47,
  0xf713: 0x0e48, 0xf714: 0x0e49, 0xf715: 0x0e4a, 0xf716: 0x0e4b, 0xf717: 0x0e4c,
  0xf718: 0x0e38, 0xf719: 0x0e39, 0xf71a: 0x0e3a,
};
const THAI_PUA_RE = /[\uf700-\uf71a]/g;

/** Normalise Thai text artefacts: private-use glyph variants, decomposed SARA AM, stray spaces before combining marks, duplicated marks. */
export function normalizeThai(s) {
  return s
    .replace(THAI_PUA_RE, (c) => String.fromCharCode(THAI_PUA[c.charCodeAt(0)]))
    .replace(/\u0e4d\u0e32/g, '\u0e33')                         // NIKHAHIT + SARA AA → SARA AM
    .replace(/ +([\u0e31\u0e34-\u0e3a\u0e47-\u0e4e])/g, '$1')   // "ผู ้" → "ผู้"
    .replace(/([\u0e48-\u0e4b])\1+/g, '$1');                    // doubled tone mark
}

/**
 * Read ActualText spans for every page of a PDF with pdf-lib (already vendored for the PDF tools).
 * Returns null when the file cannot be parsed by pdf-lib (then the caller just keeps pdf.js's own text).
 * @param {Uint8Array} bytes @param {any} PDFLib
 * @returns {Promise<Array<Array<string|null>> | null>}
 */
export async function readActualTextSpans(bytes, PDFLib) {
  let doc;
  try { doc = await PDFLib.PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true, throwOnInvalidObject: false }); } catch { return null; }
  const pages = doc.getPages();
  const result = [];
  for (const page of pages) {
    try {
      const contents = page.node.Contents();
      const streams = [];
      if (contents instanceof PDFLib.PDFArray) { for (let i = 0; i < contents.size(); i++) streams.push(contents.lookup(i)); } else if (contents) streams.push(contents);
      const chunks = [];
      for (const s of streams) {
        if (s && typeof PDFLib.decodePDFRawStream === 'function' && s instanceof PDFLib.PDFRawStream) chunks.push(PDFLib.decodePDFRawStream(s).decode());
        else if (s && typeof s.getContents === 'function') chunks.push(s.getContents());
        chunks.push(Uint8Array.of(10));
      }
      const total = chunks.reduce((a, c) => a + c.length, 0);
      const data = new Uint8Array(total); let o = 0; for (const c of chunks) { data.set(c, o); o += c.length; }
      result.push(scanMarkedContent(data));
    } catch { result.push([]); }
  }
  return result;
}
