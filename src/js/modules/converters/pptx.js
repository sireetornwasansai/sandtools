import { ConversionError, openZip, readXml, readRels, kid, kids, attr, relAttr, descendants, mdTable, escapeInline } from './common.js';

/** Plain text of a DrawingML paragraph (a:p). */
function paraText(p) {
  let out = '';
  for (const c of Array.from(p.children)) {
    if (c.localName === 'r' || c.localName === 'fld') out += (kid(c, 't') ? kid(c, 't').textContent : '');
    else if (c.localName === 'br') out += ' ';
  }
  return out;
}

/** Convert a .pptx package to Markdown (MarkItDown-style: slide marker comments, title as H1, notes section). */
export async function convertPptx(buf, opts = {}) {
  const zip = await openZip(buf);
  const pres = await readXml(zip, 'ppt/presentation.xml');
  if (!pres) throw new ConversionError('CORRUPT', 'ไฟล์นี้ไม่ใช่งานนำเสนอ PowerPoint (.pptx) ที่ถูกต้อง');
  const presRels = await readRels(zip, 'ppt/presentation.xml');
  const slidePaths = [];
  for (const id of descendants(pres.documentElement, 'sldId')) {
    const rel = presRels.get(relAttr(id, 'id'));
    if (rel && !rel.external) slidePaths.push(rel.target);
  }
  const warnings = [];
  let skippedCharts = 0;
  const out = [];

  for (let n = 0; n < slidePaths.length; n++) {
    if (opts.deadline) opts.deadline.check();
    if (opts.onProgress) opts.onProgress((n + 1) / slidePaths.length);
    const path = slidePaths[n];
    const slide = await readXml(zip, path);
    if (!slide) continue;
    const rels = await readRels(zip, path);
    const lines = [`<!-- Slide number: ${n + 1} -->`];
    let title = '';

    const shapeBody = (sp, isBody) => {
      const tx = kid(sp, 'txBody');
      if (!tx) return [];
      const res = [];
      for (const p of kids(tx, 'p')) {
        const t = paraText(p).trim();
        if (!t) continue;
        const pPr = kid(p, 'pPr');
        const lvl = pPr ? Number(attr(pPr, 'lvl') || 0) : 0;
        const explicit = pPr && (kid(pPr, 'buChar') || kid(pPr, 'buAutoNum'));
        const none = pPr && kid(pPr, 'buNone');
        const bullet = !none && (explicit || (isBody && lvl >= 0 && isBody === 'body'));
        res.push(bullet ? `${'  '.repeat(lvl)}* ${escapeInline(t)}` : escapeInline(t));
      }
      return res;
    };

    const walk = (container) => {
      for (const sh of Array.from(container.children)) {
        const name = sh.localName;
        if (name === 'sp') {
          const nv = kid(sh, 'nvSpPr'); const nvPr = nv && kid(nv, 'nvPr'); const ph = nvPr && kid(nvPr, 'ph');
          const type = ph ? (attr(ph, 'type') || 'body') : null;
          if (type === 'title' || type === 'ctrTitle') { const t = shapeBody(sh, false).join(' ').replace(/\\([*_])/g, '$1'); if (t) { title = t; lines.push(`# ${t}`); } }
          else if (type === 'sldNum' || type === 'ftr' || type === 'dt') { /* footer furniture */ }
          else { const b = shapeBody(sh, type === 'body' || type === 'obj' ? 'body' : false); if (b.length) lines.push(...b); }
        } else if (name === 'graphicFrame') {
          const tbl = descendants(sh, 'tbl')[0];
          if (tbl) {
            const rows = kids(tbl, 'tr').map((tr) => kids(tr, 'tc').map((tc) => kids(kid(tc, 'txBody'), 'p').map((p) => paraText(p).trim()).filter(Boolean).join(' ')));
            const t = mdTable(rows); if (t) lines.push(t);
          } else if (descendants(sh, 'chart').length) skippedCharts++;
        } else if (name === 'pic') {
          const c = kid(kid(sh, 'nvPicPr'), 'cNvPr');
          const blip = descendants(sh, 'blip')[0];
          const rel = blip && rels.get(relAttr(blip, 'embed'));
          const alt = ((c && (attr(c, 'descr') || attr(c, 'name'))) || '').replace(/[\[\]\n]/g, ' ').trim();
          lines.push(`![${alt}](${rel ? rel.target.split('/').pop() : (alt || 'image')})`);
        } else if (name === 'grpSp') walk(sh);
      }
    };
    const tree = descendants(slide.documentElement, 'spTree')[0];
    if (tree) walk(tree);

    // speaker notes
    for (const rel of rels.values()) {
      if (/\/notesSlide$/.test(rel.type) && !rel.external) {
        const notes = await readXml(zip, rel.target);
        if (notes) {
          const texts = [];
          for (const sp of descendants(notes.documentElement, 'sp')) {
            const ph = descendants(sp, 'ph')[0];
            if (ph && attr(ph, 'type') === 'body') texts.push(...kids(kid(sp, 'txBody'), 'p').map((p) => paraText(p).trim()).filter(Boolean));
          }
          if (texts.length) lines.push('', '### Notes:', texts.map(escapeInline).join('\n'));
        }
      }
    }
    out.push(lines.join('\n\n').replace(/\n\n\n### Notes:\n\n/, '\n\n### Notes:\n'));
    void title;
  }
  if (skippedCharts) warnings.push(`กราฟ ${skippedCharts} รายการในสไลด์ไม่ถูกแปล (แปลงเฉพาะข้อความ ตาราง และคำอธิบายรูป)`);
  if (!out.length) warnings.push('ไม่พบสไลด์ในไฟล์');
  return { markdown: `${out.join('\n\n')}\n`, warnings };
}
