// Minimal TrueType reader — only what is needed to look at glyph OUTLINES of the fonts embedded in a PDF
// (simple glyphs, hmtx advances, cmap formats 0 / 4 / 6 / 12). No DOM, no dependencies: runs on the main thread and in Node tests.
const tag = (dv, o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));

/** @returns {null | {unitsPerEm:number,numGlyphs:number,advance:(gid:number)=>number,glyph:(gid:number)=>null|{points:number[][],xMin:number,yMin:number,xMax:number,yMax:number},cmaps:{mac:Map<number,number>|null,w30:Map<number,number>|null,w31:Map<number,number>|null}}} */
export function parseTtf(u8) {
  try {
    if (!u8 || u8.length < 12) return null;
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let base = 0;
    if (tag(dv, 0) === 'ttcf') base = dv.getUint32(12);
    const numTables = dv.getUint16(base + 4);
    const T = {};
    for (let i = 0; i < numTables; i++) { const o = base + 12 + i * 16; T[tag(dv, o)] = { off: dv.getUint32(o + 8), len: dv.getUint32(o + 12) }; }
    if (!T.head || !T.maxp || !T.loca || !T.glyf) return null;
    const unitsPerEm = dv.getUint16(T.head.off + 18) || 1000;
    const locaFmt = dv.getInt16(T.head.off + 50);
    const numGlyphs = dv.getUint16(T.maxp.off + 4);
    const nHM = T.hhea ? dv.getUint16(T.hhea.off + 34) : 0;
    const loca = (g) => (locaFmt === 0 ? dv.getUint16(T.loca.off + g * 2) * 2 : dv.getUint32(T.loca.off + g * 4));
    const advance = (g) => {
      if (!T.hmtx || !nHM) return unitsPerEm;
      const k = g < nHM ? g : nHM - 1;
      return dv.getUint16(T.hmtx.off + k * 4);
    };
    const glyph = (g) => {
      if (g < 0 || g >= numGlyphs) return null;
      const a = loca(g), b = loca(g + 1);
      if (b <= a) return null;
      let p = T.glyf.off + a;
      const nc = dv.getInt16(p);
      if (nc <= 0) return null;                       // empty or composite — not needed for marks
      const xMin = dv.getInt16(p + 2), yMin = dv.getInt16(p + 4), xMax = dv.getInt16(p + 6), yMax = dv.getInt16(p + 8);
      p += 10;
      const ends = []; for (let i = 0; i < nc; i++) { ends.push(dv.getUint16(p)); p += 2; }
      const n = ends[nc - 1] + 1;
      const il = dv.getUint16(p); p += 2 + il;
      const flags = [];
      while (flags.length < n) {
        const f = dv.getUint8(p++); flags.push(f);
        if (f & 8) { let r = dv.getUint8(p++); while (r-- > 0 && flags.length < n) flags.push(f); }
      }
      const xs = []; let x = 0;
      for (let i = 0; i < n; i++) {
        const f = flags[i];
        if (f & 2) { const d = dv.getUint8(p++); x += (f & 16) ? d : -d; } else if (!(f & 16)) { x += dv.getInt16(p); p += 2; }
        xs.push(x);
      }
      const points = []; let y = 0;
      for (let i = 0; i < n; i++) {
        const f = flags[i];
        if (f & 4) { const d = dv.getUint8(p++); y += (f & 32) ? d : -d; } else if (!(f & 32)) { y += dv.getInt16(p); p += 2; }
        points.push([xs[i], y]);
      }
      return { points, xMin, yMin, xMax, yMax };
    };
    const cmaps = { mac: null, w30: null, w31: null };
    if (T.cmap) {
      const co = T.cmap.off; const nt = dv.getUint16(co + 2);
      for (let i = 0; i < nt; i++) {
        const pid = dv.getUint16(co + 4 + i * 8), eid = dv.getUint16(co + 6 + i * 8), so = co + dv.getUint32(co + 8 + i * 8);
        const key = pid === 1 && eid === 0 ? 'mac' : pid === 3 && eid === 0 ? 'w30' : pid === 3 && eid === 1 ? 'w31' : null;
        if (!key || cmaps[key]) continue;
        const m = new Map(); const fmt = dv.getUint16(so);
        if (fmt === 0) { for (let c = 0; c < 256; c++) { const g = dv.getUint8(so + 6 + c); if (g) m.set(c, g); } }
        else if (fmt === 6) { const first = dv.getUint16(so + 6), cnt = dv.getUint16(so + 8); for (let k = 0; k < cnt; k++) { const g = dv.getUint16(so + 10 + k * 2); if (g) m.set(first + k, g); } }
        else if (fmt === 4) {
          const sc = dv.getUint16(so + 6) / 2; const endO = so + 14, startO = endO + sc * 2 + 2, deltaO = startO + sc * 2, rangeO = deltaO + sc * 2;
          for (let s = 0; s < sc; s++) {
            const end = dv.getUint16(endO + s * 2), start = dv.getUint16(startO + s * 2), delta = dv.getInt16(deltaO + s * 2), ro = dv.getUint16(rangeO + s * 2);
            for (let c = start; c <= end && c !== 0xffff; c++) {
              let g;
              if (ro === 0) g = (c + delta) & 0xffff;
              else { const ga = rangeO + s * 2 + ro + (c - start) * 2; if (ga + 2 > dv.byteLength) continue; g = dv.getUint16(ga); if (g) g = (g + delta) & 0xffff; }
              if (g) m.set(c, g);
            }
          }
        } else if (fmt === 12) {
          const ng = dv.getUint32(so + 12);
          for (let k = 0; k < ng && k < 20000; k++) { const s = dv.getUint32(so + 16 + k * 12), e = dv.getUint32(so + 20 + k * 12), g0 = dv.getUint32(so + 24 + k * 12); for (let c = s; c <= e && c - s < 70000; c++) m.set(c, g0 + c - s); }
        }
        cmaps[key] = m;
      }
    }
    return { unitsPerEm, numGlyphs, advance, glyph, cmaps };
  } catch { return null; }
}
