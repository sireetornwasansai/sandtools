// Thai PDFs written by macOS (Quartz PDFContext — e.g. Word for Mac "Save as PDF") with TH Sarabun / Angsana-style fonts.
// Those fonts carry POSITIONAL VARIANTS of the tone marks and upper/lower vowels (low, shifted-left, narrow …). Quartz gives every variant glyph
// a ToUnicode value that is just a stray Latin letter or symbol, so any text extractor (pdf.js, pdftotext, copy-paste) produces
//     “ผูZวิจัย”, “ล%างไต”, “เปmน”, “ปUจจัย”      instead of      “ผู้วิจัย”, “ล้างไต”, “เป็น”, “ปัจจัย”.
// The only reliable information is the SHAPE of the glyph in the embedded font. This module:
//   1. finds the simple TrueType fonts embedded in the PDF (pdf-lib),
//   2. reads their glyph outlines (ttf.js) and keeps the small zero-width marks that sit above / below the baseline,
//   3. identifies each one by comparing its outline with reference marks (TH Sarabun New + marks the PDF itself maps correctly),
//   4. writes a corrected /ToUnicode CMap for those fonts and returns the repaired PDF bytes — pdf.js then extracts the right Thai.
// Nothing is ever changed unless a glyph is matched with a clear margin; unknown glyphs are left alone and reported.
import { parseTtf } from './ttf.js';
import { MARK_SHAPES } from './thai-mark-shapes.js';

const isMarkCp = (c) => c === 0x0e31 || (c >= 0x0e34 && c <= 0x0e3a) || (c >= 0x0e47 && c <= 0x0e4e);
const THAI_FONT_NAME = /sarabun|angsana|cordia|browallia|dilleniaupc|eucrosia|freesia|iris|jasmine|kodchiasan|lilyupc|tahoma|thonburi|krungthep|ayuthaya|norasi|garuda|loma|kinnari|waree|umpush|tlwg|laksaman|thai|kanit|prompt|mitr|pridi|taviraj|athiti|chakra|k2d|maitree|niramit|bai ?jamjuree|krub|srisakdi/i;
const THAI_RE = /[\u0e01-\u0e5b]/g;
// Thai letter + a stray non-Thai symbol/letter + Thai letter, with nothing in between. Real Thai text never looks like this.
const STRAY_RE = /[\u0e01-\u0e3a\u0e40-\u0e46][A-Za-z%+@;?\])}\[{^_~`#$&*=<>|\\\u00a1-\u00ff\u0152\u0153\u0178\u02c6-\u02dc\u2013-\u2122][\u0e01-\u0e4e]/g;

/** How many “Thai letter, stray symbol, Thai letter” sequences a text contains (≥ 3 means the Thai marks are mis-encoded). */
export function thaiGarbleScore(text) {
  const t = String(text || '');
  const thai = (t.match(THAI_RE) || []).length;
  const hits = (t.match(STRAY_RE) || []).length;
  return { hits, thai, garbled: hits >= 3 && hits >= thai * 0.002 };
}

/* ------------------------------ shapes ------------------------------ */
function normalise(points) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of points) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const s = Math.max(x1 - x0, y1 - y0) || 1;
  return points.map(([x, y]) => [(x - x0) / s, (y - y0) / s]);
}
/** Symmetric mean nearest-neighbour distance between two normalised point sets (0 = identical up to translation and scale). */
function shapeDistance(A, B) {
  const one = (X, Y) => { let sum = 0; for (const [a, b] of X) { let m = Infinity; for (const [c, d] of Y) { const e = Math.hypot(a - c, b - d); if (e < m) m = e; } sum += m; } return sum / X.length; };
  return (one(A, B) + one(B, A)) / 2;
}
let builtIn = null;
function builtInRefs() {
  if (!builtIn) builtIn = MARK_SHAPES.map(([u, z, flat]) => { const p = []; for (let i = 0; i < flat.length; i += 2) p.push([flat[i], flat[i + 1]]); return { u, z, p }; });
  return builtIn;
}
const MAX_DIST = 0.085;        // best match must be at least this close
const MIN_MARGIN = 0.008;      // …and clearly closer than the best DIFFERENT mark (or ≥ 25 % closer)

/** Best-matching mark for a glyph outline, or null when unsure. */
export function classifyMark(points, zone, refs) {
  const n = normalise(points); const byU = new Map();
  for (const r of refs) {
    if (r.z !== zone) continue;
    const d = shapeDistance(n, r.p);
    if (!byU.has(r.u) || d < byU.get(r.u)) byU.set(r.u, d);
  }
  const ranked = [...byU.entries()].sort((a, b) => a[1] - b[1]);
  if (!ranked.length) return null;
  const best = ranked[0]; const second = ranked[1];
  if (best[1] > MAX_DIST) return null;
  if (second && !(second[1] - best[1] >= MIN_MARGIN || second[1] >= best[1] * 1.25)) return null;
  return { u: best[0], d: best[1] };
}

/* ------------------------------ ToUnicode CMap ------------------------------ */
function hexToStr(h) { let s = ''; for (let i = 0; i + 3 < h.length + 1; i += 4) s += String.fromCharCode(parseInt(h.substr(i, 4), 16)); return s; }
/** Parse a ToUnicode CMap (single-byte codes only). Returns null when it uses wider codes. */
export function parseToUnicode(text) {
  const map = new Map();
  for (const blk of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of blk[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g)) { if (m[1].length !== 2) return null; map.set(parseInt(m[1], 16), hexToStr(m[2])); }
  }
  for (const blk of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of blk[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<[0-9A-Fa-f]*>|\[[^\]]*\])/g)) {
      if (m[1].length !== 2) return null;
      const lo = parseInt(m[1], 16), hi = parseInt(m[2], 16);
      if (m[3][0] === '[') { const items = [...m[3].matchAll(/<([0-9A-Fa-f]*)>/g)].map((x) => hexToStr(x[1])); for (let c = lo; c <= hi; c++) if (items[c - lo] !== undefined) map.set(c, items[c - lo]); }
      else { const s = hexToStr(m[3].slice(1, -1)); for (let c = lo; c <= hi; c++) map.set(c, s.slice(0, -1) + String.fromCharCode(s.charCodeAt(s.length - 1) + c - lo)); }
    }
  }
  return map;
}
export function buildToUnicode(map) {
  const codes = [...map.keys()].sort((a, b) => a - b);
  const hex4 = (s) => [...s].map((ch) => ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')).join('');
  const chunks = [];
  for (let i = 0; i < codes.length; i += 100) {
    const part = codes.slice(i, i + 100);
    chunks.push(`${part.length} beginbfchar\n${part.map((c) => `<${c.toString(16).toUpperCase().padStart(2, '0')}> <${hex4(map.get(c))}>`).join('\n')}\nendbfchar`);
  }
  return `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<00> <FF>\nendcodespacerange\n${chunks.join('\n')}\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n`;
}

/* ------------------------------ the repair ------------------------------ */
/**
 * Fix mis-encoded Thai marks. Returns null when nothing needed / could be fixed.
 * @param {ArrayBuffer|Uint8Array} buf the PDF  @param {any} pdfLib the pdf-lib module (vendor/pdf-lib.min.js)
 * @returns {Promise<null | {bytes:Uint8Array, glyphs:number, fonts:number, unresolved:number, detail:Array<{font:string,code:number,was:string,now:string,dist:number}>}>}
 */
export async function repairThaiMarks(buf, pdfLib) {
  if (!pdfLib || !pdfLib.PDFDocument || !pdfLib.decodePDFRawStream) return null;
  const { PDFDocument, PDFName, PDFDict, PDFRawStream, decodePDFRawStream } = pdfLib;
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let doc;
  try { doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false }); } catch { return null; }
  const ctx = doc.context;
  const N = (s) => PDFName.of(s);
  const latin1 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return s; };
  const streamBytes = (o) => { try { return o instanceof PDFRawStream ? decodePDFRawStream(o).decode() : null; } catch { return null; } };

  // 1) every simple TrueType font with an embedded program
  const fonts = [];
  for (const [, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    if (String(obj.get(N('Type'))) !== '/Font' || String(obj.get(N('Subtype'))) !== '/TrueType') continue;
    const fd = ctx.lookup(obj.get(N('FontDescriptor'))); if (!(fd instanceof PDFDict)) continue;
    const ff = streamBytes(ctx.lookup(fd.get(N('FontFile2')))); if (!ff) continue;
    const ttf = parseTtf(ff); if (!ttf) continue;
    const code2gid = ttf.cmaps.mac || ttf.cmaps.w30; if (!code2gid || !code2gid.size) continue;
    const tuObj = obj.get(N('ToUnicode')) ? ctx.lookup(obj.get(N('ToUnicode'))) : null;
    const tuBytes = tuObj ? streamBytes(tuObj) : null;
    let tu = new Map();
    if (tuBytes) { tu = parseToUnicode(latin1(tuBytes)); if (!tu) continue; }
    const base = String(obj.get(N('BaseFont')) || '').replace(/^\//, '');
    const marks = [];
    for (const [rawCode, gid] of code2gid) {
      const code = rawCode >= 0xf000 ? rawCode & 0xff : rawCode; if (code > 255) continue;
      const em = ttf.unitsPerEm; if (ttf.advance(gid) > 0.08 * em) continue;      // marks do not advance the pen
      const g = ttf.glyph(gid); if (!g || g.points.length < 3) continue;
      const w = g.xMax - g.xMin, h = g.yMax - g.yMin;
      if (w > 0.5 * em || h > 0.35 * em) continue;
      const zone = g.yMax < 0.15 * em ? 'b' : g.yMin > 0.2 * em ? 'a' : null; if (!zone) continue;
      marks.push({ code, zone, points: g.points, cur: tu.get(code) });
    }
    // only fonts that really are Thai fonts (Thai in their ToUnicode map, or a well-known Thai font name) — never touch accents of other scripts
    const isThaiFont = [...tu.values()].some((v) => /[\u0e00-\u0e7f]/.test(v)) || THAI_FONT_NAME.test(base);
    if (marks.length && isThaiFont) fonts.push({ obj, base, tu, marks, hadTu: !!tuBytes });
  }
  if (!fonts.length) return null;

  // 2) reference shapes: built-in TH Sarabun marks + every mark this PDF already maps correctly
  const refs = builtInRefs().slice();
  for (const f of fonts) for (const m of f.marks) {
    const c = m.cur && m.cur.length === 1 ? m.cur.codePointAt(0) : 0;
    if (isMarkCp(c)) refs.push({ u: c, z: m.zone, p: normalise(m.points) });
  }

  // 3) identify the odd ones
  let glyphs = 0, unresolved = 0, changedFonts = 0; const detail = [];
  for (const f of fonts) {
    let changed = false;
    for (const m of f.marks) {
      const c = m.cur && m.cur.length ? m.cur.codePointAt(0) : 0;
      if (isMarkCp(c) && m.cur.length === 1) continue;            // already right
      if (c >= 0x0e00 && c <= 0x0e7f) continue;                   // some other Thai character — leave it
      const hit = classifyMark(m.points, m.zone, refs);
      if (!hit) { unresolved++; continue; }
      const now = String.fromCodePoint(hit.u);
      f.tu.set(m.code, now); changed = true; glyphs++;
      detail.push({ font: f.base, code: m.code, was: m.cur || '', now, dist: Math.round(hit.d * 1000) / 1000 });
    }
    if (changed) { changedFonts++; f.dirty = true; }
  }
  if (!glyphs) return null;

  // 4) write the corrected ToUnicode maps and save
  for (const f of fonts) {
    if (!f.dirty) continue;
    const text = buildToUnicode(f.tu);
    const ref = ctx.register(ctx.stream(text));
    f.obj.set(N('ToUnicode'), ref);
  }
  let out;
  try { out = await doc.save({ useObjectStreams: false, updateFieldAppearances: false }); } catch { return null; }
  return { bytes: out, glyphs, fonts: changedFonts, unresolved, detail };
}
