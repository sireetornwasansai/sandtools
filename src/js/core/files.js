// เตรียมไฟล์แนบก่อนส่งขึ้นเซิร์ฟเวอร์ (ใช้กับหน้า HR "บันทึกการปฏิบัติงาน")
//
// ปัญหาเดิมที่ทำให้ "อัปโหลดไฟล์ไม่สมบูรณ์":
//   • รูปถ่ายจากมือถือใหญ่ 4–12 MB → เมื่อเป็น base64 ≈ 5–16 MB ในคำขอเดียว บนเน็ตมือถือหมดเวลา/หลุดกลางทาง (และบางครั้งเกินเพดาน 10 MB ของระบบ)
//   • iPhone ส่ง HEIC → ฝั่งเซิร์ฟเวอร์รับเฉพาะ PDF/JPG/PNG จึงปฏิเสธ
//   • เลือกได้ไฟล์เดียว และเลือกผิดแล้วเอาออกไม่ได้
// ที่นี่: รูป → ย่อด้านยาวไม่เกิน 2000 px แล้วแปลงเป็น JPEG (ปกติเหลือ 200–600 KB อ่านเอกสารยังชัด) · EXIF หมุนภาพถูกต้อง · PDF → ตรวจขนาด
export const ATTACH = { maxFiles: 3, maxBytes: 10 * 1024 * 1024, maxSide: 2000, quality: 0.85 };
export const ACCEPT = 'application/pdf,image/*,.pdf,.jpg,.jpeg,.png,.heic,.heif';

const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '');
const isImage = (f) => /^image\//.test(f.type || '') || /\.(jpe?g|png|heic|heif|webp|gif|bmp)$/i.test(f.name || '');

export function fmtSize(bytes) {
  const b = Number(bytes) || 0;
  return b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
}

/** @param {Blob} blob @returns {Promise<string>} base64 without the data: prefix */
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => { const s = String(r.result || ''); const i = s.indexOf(','); resolve(i >= 0 ? s.slice(i + 1) : ''); };
    r.onerror = () => reject(new Error('อ่านไฟล์ไม่ได้ — ลองเลือกไฟล์ใหม่อีกครั้ง'));
    r.readAsDataURL(blob);
  });
}

/** Decode an image honouring EXIF rotation. Throws when the browser cannot read the format (e.g. HEIC outside Safari). */
async function decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* older engines: options not supported, or format unknown → try <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image(); img.decoding = 'async'; img.src = url;
    if (img.decode) await img.decode(); else await new Promise((ok, no) => { img.onload = ok; img.onerror = () => no(new Error('decode')); });
    return img;
  } finally { setTimeout(() => URL.revokeObjectURL(url), 30000); }
}

async function toJpeg(file, maxSide, quality) {
  const img = await decodeImage(file);
  const w0 = img.naturalWidth || img.width; const h0 = img.naturalHeight || img.height;
  if (!w0 || !h0) throw new Error('decode');
  const k = Math.min(1, maxSide / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * k)); const h = Math.max(1, Math.round(h0 * k));
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);   // white behind transparent PNGs
  if (img.close) img.close();
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
  canvas.width = canvas.height = 0;
  if (!blob) throw new Error('encode');
  return { blob, resized: k < 1 };
}

/**
 * @param {File} file
 * @returns {Promise<{name:string,mime:string,size:number,base64:string,note:string}>}   throws Error with a Thai message a person can act on
 */
export async function prepareAttachment(file, opts = {}) {
  const o = { ...ATTACH, ...opts };
  const baseName = String(file.name || 'file').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_');
  if (isPdf(file)) {
    if (file.size > o.maxBytes) throw new Error(`ไฟล์ PDF "${baseName}" ใหญ่เกิน ${o.maxBytes / 1048576} MB (${fmtSize(file.size)}) — ลดขนาดไฟล์ก่อนแนบ`);
    return { name: baseName, mime: 'application/pdf', size: file.size, base64: await blobToBase64(file), note: '' };
  }
  if (!isImage(file)) throw new Error(`"${baseName}" — แนบได้เฉพาะไฟล์ PDF และรูปภาพ (JPG / PNG)`);
  let out = null;
  try {
    const { blob } = await toJpeg(file, o.maxSide, o.quality);
    const keepOriginal = file.type === 'image/jpeg' && file.size <= blob.size && file.size <= o.maxBytes;   // already small: re-encoding would only lose quality
    out = keepOriginal ? { blob: file, name: baseName, note: '' } : { blob, name: baseName.replace(/\.[A-Za-z0-9]{1,5}$/, '') + '.jpg', note: `ย่อจาก ${fmtSize(file.size)}` };
  } catch {
    if ((file.type === 'image/jpeg' || file.type === 'image/png') && file.size <= o.maxBytes) out = { blob: file, name: baseName, note: '' };   // cannot re-encode, but the original is acceptable as it is
    else throw new Error(`เปิดรูป "${baseName}" ไม่ได้ (ไฟล์ HEIC/HEIF บางเครื่องอ่านไม่ได้) — ถ่ายใหม่เป็น JPG หรือเลือกรูปจากแกลเลอรี่แทน`);
  }
  if (out.blob.size > o.maxBytes) throw new Error(`รูป "${baseName}" ยังใหญ่เกิน ${o.maxBytes / 1048576} MB หลังย่อ (${fmtSize(out.blob.size)})`);
  return { name: out.name, mime: out.blob.type === 'image/png' ? 'image/png' : 'image/jpeg', size: out.blob.size, base64: await blobToBase64(out.blob), note: out.note };
}

/** URLs stored in the sheet cell (one per line; older rows hold a single URL) → clean list of http(s) links. */
export function splitFiles(cell) {
  return String(cell == null ? '' : cell).split(/\s+/).filter((u) => /^https?:\/\//i.test(u)).slice(0, ATTACH.maxFiles);
}
