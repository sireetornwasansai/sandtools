/** Trigger a browser download for a Blob. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener';
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
/** Download text exactly as given (UTF-8, no BOM, no newline changes). */
export function downloadText(text, filename, mime = 'text/plain') {
  downloadBlob(new Blob([text], { type: `${mime};charset=utf-8` }), filename);
}
/** Strip characters that are unsafe in file names while keeping Thai and spaces. */
export function safeFileName(name, fallback = 'document') {
  const cleaned = String(name || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '').trim();
  return cleaned || fallback;
}
/** report.docx + md -> report.md (keeps the original base name). */
export function withExt(name, ext) {
  const clean = safeFileName(name);
  const i = clean.lastIndexOf('.');
  const base = i > 0 ? clean.slice(0, i) : clean;
  return `${base}.${ext.replace(/^\./, '')}`;
}
export function baseName(name) { const c = safeFileName(name); const i = c.lastIndexOf('.'); return i > 0 ? c.slice(0, i) : c; }
export function extOf(name) { const i = String(name).lastIndexOf('.'); return i > 0 ? name.slice(i + 1).toLowerCase() : ''; }

/** Copy text to the clipboard with a legacy fallback. */
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.setAttribute('readonly', ''); ta.className = 'sr-only';
  document.body.append(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

/** Read a File as text, decoding UTF-8 first and falling back to Thai Windows-874 (TIS-620). */
export async function readFileText(file) {
  return decodeText(await file.arrayBuffer());
}
/** @param {ArrayBuffer} buf */
export function decodeText(buf) {
  const bytes = new Uint8Array(buf);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes).replace(/^\uFEFF/, '');
  } catch {
    return new TextDecoder('windows-874').decode(bytes);
  }
}
