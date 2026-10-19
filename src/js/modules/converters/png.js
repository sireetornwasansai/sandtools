// Minimal PNG encoder (8-bit grey / RGB / RGBA) for images pulled out of PDF pages. DOM-free: runs in the browser and in Node tests.
// Compression uses CompressionStream('deflate') (zlib format, which is what PNG needs); without it the data is stored uncompressed (valid, just larger).

const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(bytes) { let c = 0xffffffff; for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
const u32 = (n) => Uint8Array.of((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
function concat(parts) { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; }

async function deflate(data) {
  if (typeof CompressionStream === 'function') {
    const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  // zlib container with stored blocks
  const parts = [Uint8Array.of(0x78, 0x01)];
  for (let i = 0; i < data.length || i === 0; i += 65535) {
    const chunk = data.subarray(i, Math.min(data.length, i + 65535)); const last = i + 65535 >= data.length;
    parts.push(Uint8Array.of(last ? 1 : 0, chunk.length & 255, chunk.length >> 8, ~chunk.length & 255, (~chunk.length >> 8) & 255), chunk);
    if (last) break;
  }
  let a = 1, b = 0; for (let i = 0; i < data.length; i++) { a = (a + data[i]) % 65521; b = (b + a) % 65521; }
  parts.push(u32(((b << 16) | a) >>> 0));
  return concat(parts);
}
function chunk(type, data) {
  const body = concat([new TextEncoder().encode(type), data]);
  return concat([u32(data.length), body, u32(crc32(body))]);
}

/**
 * Expand pdf.js image data (kind 1 = 1-bit grey, 2 = RGB, 3 = RGBA) to a flat 8-bit buffer.
 * @param {{width:number,height:number,kind:number,data:Uint8Array|Uint8ClampedArray}} img
 * @returns {{width:number,height:number,channels:1|3|4,data:Uint8Array}}
 */
export function pdfImageToPixels(img) {
  const { width: w, height: h, kind } = img; const src = img.data;
  if (kind === 1) {
    const rowBytes = (w + 7) >> 3; const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = (src[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1 ? 255 : 0;
    return { width: w, height: h, channels: 1, data: out };
  }
  if (kind === 3) return { width: w, height: h, channels: 4, data: Uint8Array.from(src.subarray(0, w * h * 4)) };
  const per = Math.round(src.length / (w * h)) || 3;
  if (per === 4) return { width: w, height: h, channels: 4, data: Uint8Array.from(src.subarray(0, w * h * 4)) };
  if (per === 1) return { width: w, height: h, channels: 1, data: Uint8Array.from(src.subarray(0, w * h)) };
  return { width: w, height: h, channels: 3, data: Uint8Array.from(src.subarray(0, w * h * 3)) };
}

/** Nearest-neighbour shrink so one embedded image never exceeds `maxPixels`. */
export function shrinkPixels(p, maxPixels = 4e6) {
  if (p.width * p.height <= maxPixels) return p;
  const k = Math.ceil(Math.sqrt((p.width * p.height) / maxPixels)); const w = Math.max(1, Math.floor(p.width / k)), h = Math.max(1, Math.floor(p.height / k)); const c = p.channels;
  const out = new Uint8Array(w * h * c);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const s = ((y * k) * p.width + x * k) * c; for (let i = 0; i < c; i++) out[(y * w + x) * c + i] = p.data[s + i]; }
  return { width: w, height: h, channels: c, data: out };
}

/** @param {{width:number,height:number,channels:1|3|4,data:Uint8Array}} p @returns {Promise<Uint8Array>} PNG file bytes */
export async function encodePng(p) {
  const { width: w, height: h, channels: c, data } = p;
  const colorType = c === 1 ? 0 : c === 3 ? 2 : 6;
  const raw = new Uint8Array((w * c + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * c + 1)] = 0; raw.set(data.subarray(y * w * c, (y + 1) * w * c), y * (w * c + 1) + 1); }
  const ihdr = concat([u32(w), u32(h), Uint8Array.of(8, colorType, 0, 0, 0)]);
  return concat([Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10), chunk('IHDR', ihdr), chunk('IDAT', await deflate(raw)), chunk('IEND', new Uint8Array(0))]);
}
