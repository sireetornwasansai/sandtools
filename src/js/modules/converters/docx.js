import { ConversionError, openZip, readXml, readRels, kid, kids, attr, relAttr, descendants, mdTable, escapeInline, escapeLineStart, wrapMarker } from './common.js';

const isOn = (el) => { if (!el) return false; const v = attr(el, 'val'); return v === null || !['0', 'false', 'off', 'none'].includes(v); };

/** Parse styles.xml into Map(styleId → {name, basedOn, numPr}). */
function parseStyles(doc) {
  const map = new Map();
  if (!doc) return map;
  for (const s of kids(doc.documentElement, 'style')) {
    const id = attr(s, 'styleId');
    const pPr = kid(s, 'pPr');
    const numPr = pPr && kid(pPr, 'numPr');
    map.set(id, {
      name: (attr(kid(s, 'name'), 'val') || '').toLowerCase(),
      basedOn: attr(kid(s, 'basedOn'), 'val'),
      numId: numPr ? attr(kid(numPr, 'numId'), 'val') : null,
      ilvl: numPr ? attr(kid(numPr, 'ilvl'), 'val') : null,
      outline: pPr && kid(pPr, 'outlineLvl') ? Number(attr(kid(pPr, 'outlineLvl'), 'val')) : null
    });
  }
  return map;
}

/** numbering.xml → {fmt(numId, ilvl) , start(numId, ilvl)} */
function parseNumbering(doc) {
  const nums = new Map(); const abstracts = new Map();
  if (doc) {
    for (const a of kids(doc.documentElement, 'abstractNum')) {
      const lv = new Map();
      for (const l of kids(a, 'lvl')) lv.set(attr(l, 'ilvl'), { fmt: attr(kid(l, 'numFmt'), 'val') || 'decimal', start: Number(attr(kid(l, 'start'), 'val') || 1) });
      abstracts.set(attr(a, 'abstractNumId'), lv);
    }
    for (const n of kids(doc.documentElement, 'num')) nums.set(attr(n, 'numId'), attr(kid(n, 'abstractNumId'), 'val'));
  }
  const level = (numId, ilvl) => { const lv = abstracts.get(nums.get(numId)); return (lv && lv.get(String(ilvl))) || { fmt: 'decimal', start: 1 }; };
  return { isBullet: (numId, ilvl) => level(numId, ilvl).fmt === 'bullet', start: (numId, ilvl) => level(numId, ilvl).start };
}

/**
 * Convert a .docx (OOXML WordprocessingML) package to Markdown.
 * @param {ArrayBuffer} buf
 * @param {{deadline?:import('./common.js').Deadline}} [opts]
 */
export async function convertDocx(buf, opts = {}) {
  const zip = await openZip(buf);
  const doc = await readXml(zip, 'word/document.xml');
  if (!doc) throw new ConversionError('CORRUPT', 'ไฟล์นี้ไม่ใช่เอกสาร Word (.docx) ที่ถูกต้อง');
  const styles = parseStyles(await readXml(zip, 'word/styles.xml'));
  const numbering = parseNumbering(await readXml(zip, 'word/numbering.xml'));
  const rels = await readRels(zip, 'word/document.xml');
  const warnings = [];

  /* footnotes */
  const footnotes = new Map();
  const fnDoc = await readXml(zip, 'word/footnotes.xml');
  if (fnDoc) {
    for (const fn of descendants(fnDoc.documentElement, 'footnote')) {
      const id = attr(fn, 'id'); const type = attr(fn, 'type');
      if (type === 'separator' || type === 'continuationSeparator' || Number(id) < 1) continue;
      const text = kids(fn, 'p').map((p) => plainText(p)).join(' ').trim();
      if (text) footnotes.set(id, text);
    }
  }
  const usedFootnotes = [];

  const counters = new Map(); // numId → array of counters per level
  const resolveStyle = (id, pick) => {
    for (let i = 0, cur = id; cur && i < 8; i++) { const s = styles.get(cur); if (!s) return null; const v = pick(s); if (v !== null && v !== undefined && v !== '') return v; cur = s.basedOn; }
    return null;
  };

  function headingLevel(pPr, styleId) {
    const style = styleId && styles.get(styleId);
    const names = [];
    for (let i = 0, cur = styleId; cur && i < 8; i++) { const s = styles.get(cur); if (!s) break; names.push(`${cur.toLowerCase()}|${s.name}`); cur = s.basedOn; }
    for (const n of names) {
      const m = n.match(/heading\s*([1-9])/); if (m) return Math.min(6, Number(m[1]));
      if (/(^|\|)title$/.test(n)) return 1;
    }
    const ol = pPr && kid(pPr, 'outlineLvl');
    if (ol) { const v = Number(attr(ol, 'val')); if (v >= 0 && v <= 8) return Math.min(6, v + 1); }
    const so = style && resolveStyle(styleId, (s) => s.outline);
    if (so !== null && so !== undefined && so >= 0 && so <= 8) return Math.min(6, so + 1);
    return 0;
  }

  /** Paragraph → array of segments. */
  function segments(container, fmt = {}, link = null, out = []) {
    for (const c of Array.from(container.children)) {
      const name = c.localName;
      if (name === 'r') run(c, link, out);
      else if (name === 'hyperlink') {
        const rid = relAttr(c, 'id'); const anchor = attr(c, 'anchor');
        const target = rid && rels.get(rid) ? rels.get(rid).target : (anchor ? `#${anchor}` : null);
        segments(c, fmt, target, out);
      } else if (['ins', 'smartTag', 'sdt', 'sdtContent', 'fldSimple', 'customXml', 'bdo', 'dir'].includes(name)) segments(c, fmt, link, out);
      else if (name === 'AlternateContent') { const ch = kid(c, 'Choice') || kid(c, 'Fallback'); if (ch) segments(ch, fmt, link, out); }
    }
    return out;
  }
  function run(r, link, out) {
    const rPr = kid(r, 'rPr');
    const f = { b: rPr && isOn(kid(rPr, 'b')), i: rPr && isOn(kid(rPr, 'i')), s: rPr && isOn(kid(rPr, 'strike')), link };
    for (const c of Array.from(r.children)) {
      switch (c.localName) {
        case 't': out.push({ t: 'text', text: c.textContent || '', ...f }); break;
        case 'tab': out.push({ t: 'text', text: ' ', ...f, b: false, i: false, s: false }); break;
        case 'noBreakHyphen': out.push({ t: 'text', text: '-', ...f }); break;
        case 'br': case 'cr': if (attr(c, 'type') !== 'page') out.push({ t: 'br' }); break;
        case 'footnoteReference': { const id = attr(c, 'id'); if (footnotes.has(id)) { usedFootnotes.push(id); out.push({ t: 'raw', text: `[^${id}]` }); } break; }
        case 'drawing': case 'pict': {
          const dp = descendants(c, 'docPr')[0];
          const blip = descendants(c, 'blip')[0];
          if (descendants(c, 'txbxContent').length && !warnings.includes('กล่องข้อความ (text box) ในเอกสารไม่ถูกแปลง')) warnings.push('กล่องข้อความ (text box) ในเอกสารไม่ถูกแปลง');
          if (blip) {
            const rel = rels.get(relAttr(blip, 'embed'));
            const alt = ((dp && (attr(dp, 'descr') || attr(dp, 'title'))) || '').replace(/[\[\]\n]/g, ' ').trim();
            out.push({ t: 'raw', text: `![${alt}](${rel ? rel.target.split('/').pop() : 'image'})` });
          }
          break;
        }
        default: break;
      }
    }
  }
  function render(segs) {
    // merge adjacent text segments with identical formatting
    const merged = [];
    for (const s of segs) {
      const p = merged[merged.length - 1];
      if (s.t === 'text' && p && p.t === 'text' && p.b === s.b && p.i === s.i && p.s === s.s && p.link === s.link) p.text += s.text; else merged.push({ ...s });
    }
    let out = ''; let i = 0;
    while (i < merged.length) {
      const s = merged[i];
      if (s.t === 'br') { out += '  \n'; i++; continue; }
      if (s.t === 'raw') { out += s.text; i++; continue; }
      if (s.link) {
        let inner = ''; const link = s.link;
        while (i < merged.length && merged[i].link === link && merged[i].t === 'text') { inner += fmtText(merged[i]); i++; }
        out += inner.trim() ? `${inner.match(/^\s*/)[0]}[${inner.trim()}](${link.replace(/ /g, '%20')})${inner.match(/\s*$/)[0]}` : inner;
        continue;
      }
      out += fmtText(s); i++;
    }
    return out;
  }
  function fmtText(s) {
    let t = escapeInline(s.text);
    if (s.s) t = wrapMarker('~~', t);
    if (s.i) t = wrapMarker('*', t);
    if (s.b) t = wrapMarker('**', t);
    return t;
  }
  function plainText(p) { return segments(p).map((s) => (s.t === 'text' ? s.text : s.t === 'br' ? ' ' : '')).join(''); }

  function paragraph(p) {
    const pPr = kid(p, 'pPr');
    const styleId = pPr && attr(kid(pPr, 'pStyle'), 'val');
    let text = render(segments(p)).replace(/\u00a0/g, ' ');
    const trimmed = text.trim();
    const level = headingLevel(pPr, styleId);
    if (level && trimmed) return { kind: 'block', text: `${'#'.repeat(level)} ${trimmed.replace(/\n/g, ' ').replace(/ {2,}$/, '')}` };
    // list membership: direct numPr, else via style
    const numPr = pPr && kid(pPr, 'numPr');
    let numId = numPr ? attr(kid(numPr, 'numId'), 'val') : resolveStyle(styleId, (s) => s.numId);
    let ilvl = numPr ? (attr(kid(numPr, 'ilvl'), 'val') ?? '0') : (resolveStyle(styleId, (s) => s.ilvl) ?? '0');
    if (numId && numId !== '0' && trimmed) {
      const lvl = Number(ilvl) || 0;
      let marker = '* ';
      if (!numbering.isBullet(numId, lvl)) {
        const arr = counters.get(numId) || []; counters.set(numId, arr);
        arr[lvl] = (arr[lvl] === undefined ? numbering.start(numId, lvl) : arr[lvl] + 1);
        arr.length = lvl + 1;
        marker = `${arr[lvl]}. `;
      } else { const arr = counters.get(numId); if (arr) arr.length = Math.min(arr.length, lvl); }
      return { kind: 'list', listKey: `${numId}`, text: `${'   '.repeat(lvl)}${marker}${trimmed.replace(/\n/g, ' ').replace(/ {2,}$/, '')}` };
    }
    if (!trimmed) return null;
    return { kind: 'block', text: escapeLineStart(text.trim()) };
  }

  function table(tbl) {
    const rows = [];
    for (const tr of kids(tbl, 'tr')) {
      const cells = [];
      for (const tc of kids(tr, 'tc')) {
        const tcPr = kid(tc, 'tcPr');
        const vm = tcPr && kid(tcPr, 'vMerge');
        const text = vm && attr(vm, 'val') !== 'restart' ? '' : descendants(tc, 'p').map((p) => render(segments(p)).trim()).filter(Boolean).join('<br>');
        cells.push(text);
        const span = tcPr && attr(kid(tcPr, 'gridSpan'), 'val');
        for (let i = 1; i < (Number(span) || 1) && i < 50; i++) cells.push('');
      }
      if (cells.length) rows.push(cells);
    }
    return mdTable(rows);
  }

  const blocks = [];
  const walk = (container) => {
    for (const c of Array.from(container.children)) {
      if (opts.deadline) opts.deadline.check();
      switch (c.localName) {
        case 'p': { const b = paragraph(c); if (b) blocks.push(b); break; }
        case 'tbl': { const t = table(c); if (t) blocks.push({ kind: 'block', text: t }); break; }
        case 'sdt': { const sc = kid(c, 'sdtContent'); if (sc) walk(sc); break; }
        default: break;
      }
    }
  };
  const body = kid(doc.documentElement, 'body');
  if (body) walk(body);

  let md = '';
  blocks.forEach((b, idx) => { const prev = blocks[idx - 1]; md += idx === 0 ? b.text : `${prev.kind === 'list' && b.kind === 'list' && prev.listKey === b.listKey ? '\n' : '\n\n'}${b.text}`; });
  const seen = new Set();
  const notes = usedFootnotes.filter((id) => (seen.has(id) ? false : seen.add(id))).map((id) => `[^${id}]: ${escapeInline(footnotes.get(id))}`);
  if (notes.length) md += `\n\n${notes.join('\n\n')}`;
  if (!md.trim()) warnings.push('ไม่พบข้อความในเอกสาร');
  return { markdown: `${md.trim()}\n`, warnings };
}
