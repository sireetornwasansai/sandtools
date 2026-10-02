// Shared helpers for the file → Markdown conversion engine.
// The engine mirrors MarkItDown's pipeline (parse format → HTML/structure → Markdown) but runs in the browser.

export class ConversionError extends Error {
  /** @param {string} code machine readable @param {string} message Thai, user-facing @param {string} [detail] technical detail */
  constructor(code, message, detail) { super(message); this.name = 'ConversionError'; this.code = code; this.detail = detail || ''; }
}

/** Hard limits that protect the browser tab from malicious or oversized files. */
export const LIMITS = Object.freeze({
  maxZipEntries: 5000,
  maxTotalUncompressed: 300 * 1024 * 1024,
  maxPartBytes: 60 * 1024 * 1024,
  maxRows: 20000,
  maxPdfPages: 1000
});

/** Cooperative timeout: converters call check() inside their loops. */
export class Deadline {
  /** @param {number} ms */
  constructor(ms) { this.end = Date.now() + ms; this.ms = ms; }
  check() {
    if (Date.now() > this.end) throw new ConversionError('TIMEOUT', 'การแปลงใช้เวลานานเกินไป จึงยกเลิกการแปลง ลองใช้ไฟล์ที่เล็กลง');
  }
}

/** Race a promise against a timeout (unblocks the UI even if a library hangs). */
export function withTimeout(promise, ms) {
  let t;
  const timeout = new Promise((_, reject) => { t = setTimeout(() => reject(new ConversionError('TIMEOUT', 'การแปลงใช้เวลานานเกินไป จึงยกเลิกการแปลง ลองใช้ไฟล์ที่เล็กลง')), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

/** Escape a table cell. */
export function mdCell(value) {
  return String(value ?? '').replace(/\r\n|\r|\n/g, '<br>').replace(/\|/g, '\\|').trim();
}

/**
 * Render a 2-D array as a GitHub-flavoured Markdown table. First row is the header.
 * @param {string[][]} rows
 */
export function mdTable(rows) {
  const cols = rows.reduce((m, r) => Math.max(m, r.length), 0);
  if (!rows.length || !cols) return '';
  const norm = rows.map((r) => Array.from({ length: cols }, (_, i) => mdCell(r[i] ?? '')));
  const line = (cells) => `| ${cells.join(' | ')} |`;
  return [line(norm[0]), line(Array(cols).fill('---')), ...norm.slice(1).map(line)].join('\n');
}

/** Escape characters that would create unintended emphasis. */
export function escapeInline(text) { return text.replace(/([*_])/g, '\\$1'); }
/** Escape a leading block marker (heading, quote, bullet, ordered list) in plain paragraph text. */
export function escapeLineStart(text) {
  return text.replace(/^(\s*)(#{1,6}\s|[-+>]\s|\d+[.)]\s)/, (m, sp, mark) => `${sp}\\${mark}`);
}

/** Wrap text with an emphasis marker while keeping surrounding whitespace outside the markers. */
export function wrapMarker(marker, text) {
  const m = text.match(/^(\s*)([\s\S]*?)(\s*)$/);
  if (!m || !m[2]) return text;
  return `${m[1]}${marker}${m[2]}${marker}${m[3]}`;
}

let jszipPromise = null;
/** Load JSZip (UMD build) once. In Node tests, globalThis.JSZip may be pre-set. */
export async function getJSZip() {
  if (globalThis.JSZip) return globalThis.JSZip;
  if (!jszipPromise) {
    jszipPromise = import('../../core/dom.js').then(({ loadScript }) => loadScript(new URL('../../vendor/jszip.min.js', import.meta.url).href)).then(() => {
      if (!globalThis.JSZip) throw new Error('JSZip not available');
      return globalThis.JSZip;
    });
    jszipPromise.catch(() => { jszipPromise = null; });
  }
  return jszipPromise;
}

/**
 * Open an OOXML package safely (zip-bomb, entry-count and path checks).
 * @param {ArrayBuffer} buf
 */
export async function openZip(buf) {
  const JSZip = await getJSZip();
  let zip;
  try { zip = await JSZip.loadAsync(buf); } catch (e) {
    throw new ConversionError('CORRUPT', 'ไฟล์เสียหาย หรือไม่ใช่ไฟล์ Office ที่ถูกต้อง', String(e && e.message));
  }
  const names = Object.keys(zip.files);
  if (names.length > LIMITS.maxZipEntries) throw new ConversionError('TOO_COMPLEX', 'โครงสร้างไฟล์ซับซ้อนเกินกว่าที่รองรับ', `entries=${names.length}`);
  let total = 0;
  for (const n of names) {
    if (/(^|\/)\.\.(\/|$)/.test(n) || n.startsWith('/') || n.includes('\\')) throw new ConversionError('UNSAFE_FILE', 'ไฟล์มีโครงสร้างที่ไม่ปลอดภัย', `entry=${n}`);
    const size = (zip.files[n]._data && zip.files[n]._data.uncompressedSize) || 0;
    if (size > LIMITS.maxPartBytes) throw new ConversionError('TOO_LARGE', 'ไฟล์มีส่วนประกอบที่ขนาดใหญ่เกินไป', `entry=${n} size=${size}`);
    total += size;
  }
  if (total > LIMITS.maxTotalUncompressed) throw new ConversionError('ZIP_BOMB', 'ไฟล์ขยายขนาดใหญ่ผิดปกติ จึงไม่ปลอดภัยที่จะเปิด', `total=${total}`);
  return zip;
}

/** Parse an XML part from a zip. Returns null if the part does not exist. */
export async function readXml(zip, path) {
  const f = zip.file(path);
  if (!f) return null;
  const text = await f.async('string');
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new ConversionError('UNSAFE_FILE', 'ไฟล์มีโครงสร้าง XML ที่ไม่ปลอดภัย', `part=${path}`);
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new ConversionError('CORRUPT', 'ไฟล์เสียหาย (อ่านโครงสร้างภายในไม่ได้)', `part=${path}`);
  return doc;
}

/* ---------- tiny XML helpers (namespace-prefix agnostic) ---------- */
/** Direct child elements with the given local name. */
export function kids(el, local) { return el ? Array.from(el.children).filter((c) => c.localName === local) : []; }
export function kid(el, local) { return kids(el, local)[0] || null; }
/** Attribute by local name (ignores namespace prefix). */
export function attr(el, local) {
  if (!el) return null;
  for (const a of Array.from(el.attributes)) if (a.localName === local) return a.value;
  return null;
}
export const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
/** Relationship id attribute (r:id / r:embed ...), looked up by namespace so it never collides with plain `id`. */
export function relAttr(el, local) { return el ? el.getAttributeNS(NS_R, local) : null; }
/** All descendant elements with the given local name. */
export function descendants(el, local) { return el ? Array.from(el.getElementsByTagNameNS('*', local)) : []; }

/** Resolve a relationship target relative to the part that owns the .rels file. */
export function resolvePath(basePart, target) {
  if (/^[a-z]+:/i.test(target)) return target;
  if (target.startsWith('/')) return target.slice(1);
  const parts = basePart.split('/'); parts.pop();
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop(); else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

/** Read a .rels part into Map(id → {type,target,external}). */
export async function readRels(zip, partPath) {
  const dir = partPath.split('/').slice(0, -1).join('/');
  const file = partPath.split('/').pop();
  const relsPath = `${dir ? `${dir}/` : ''}_rels/${file}.rels`;
  const doc = await readXml(zip, relsPath);
  const map = new Map();
  if (!doc) return map;
  for (const r of descendants(doc.documentElement, 'Relationship')) {
    const external = attr(r, 'TargetMode') === 'External';
    const target = attr(r, 'Target') || '';
    map.set(attr(r, 'Id'), { type: attr(r, 'Type') || '', target: external ? target : resolvePath(partPath, target), external });
  }
  return map;
}
