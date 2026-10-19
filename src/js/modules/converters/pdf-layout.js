// Page model (pdf-pages.js) → Word layout model: paragraphs (alignment, indents, tab stops, justified text), tables rebuilt from ruling lines
// (merged cells, borders, shading), spacing, page margins and anchored pictures. Pure functions, no DOM: unit tested in Node.
// All lengths are in points; y grows downward. write-docx-layout.js turns the result into WordprocessingML.
import { normalizeThai } from './pdf-actualtext.js';

/** Baseline position inside a Word line box (fraction of the line height from the top). Used both to place the first line of a paragraph
 *  and to turn baseline distances into "space before". Calibrated against Word/LibreOffice renderings of TH Sarabun. */
export const BASE_R = 0.8;

const THAI = /[\u0e00-\u0e7f]/;
const THAI_MARK = /^[\u0e31\u0e34-\u0e3a\u0e47-\u0e4e]/;
const BULLET_CH = /[\u2022\u25cf\u25aa\u25e6\u2023\u2219\u00b7\uF0B7\uF0A7\uF0D8\uF076\u25a0\u25cb]/;
const MARKER = /^(?:[\u2022\u25cf\u25aa\u25e6\u2023\u2219\u00b7\uF0B7\uF0A7\uF0D8\uF076\u25a0\u25cb\-–]|[0-9\u0e50-\u0e59]{1,3}[.)]|\([0-9\u0e50-\u0e59]{1,3}\)|[ก-ฮ]\.)\s/;
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const quant = (a, q) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))] : 0; };
const fixBullets = (t) => t.replace(/[\uF0B7\uF0A7\uF0D8\uF076]/g, '\u2022');

/* ------------------------------------------------------------------ lines */

/** @typedef {{text:string,fid:string|null,font:string,fs:number,b:boolean,i:boolean,u:boolean}} Part */
/** @typedef {{x0:number,x1:number,parts:Part[]}} Seg */
/** @typedef {{base:number,fs:number,x0:number,x1:number,segs:Seg[],b:boolean,text:string,thai:boolean}} Line */

const styleKey = (p) => `${p.fid || p.font}|${p.b ? 1 : 0}|${p.i ? 1 : 0}|${Math.round(p.fs * 2) / 2}|${p.u ? 1 : 0}`;
const pushPart = (parts, text, w) => {
  const part = { text, fid: w.fid, font: w.font, fs: Math.round(w.fs * 2) / 2, b: w.b, i: w.i, u: !!w.ul };
  const last = parts[parts.length - 1];
  if (last && styleKey(last) === styleKey(part)) last.text += text; else parts.push(part);
};

/**
 * Group page words into visual lines, split each line into segments at wide gaps (those become tab stops).
 * @param {import('./pdf-pages.js').PdfWord[]} words
 * @returns {Line[]}
 */
export function buildLines(words) {
  const seen = new Set();
  const ws = words.filter((w) => w.text.trim()).filter((w) => { const k = `${w.text}|${Math.round(w.x0)}|${Math.round(w.base)}`; if (seen.has(k)) return false; seen.add(k); return true; })   // "fake bold" = same text drawn twice
    .sort((a, b) => a.base - b.base || a.x0 - b.x0);
  const groups = [];
  for (const w of ws) {
    let g = null;
    for (let k = groups.length - 1; k >= 0 && k >= groups.length - 4; k--) {
      const c = groups[k]; if (Math.abs(c.base - w.base) <= Math.max(1.2, 0.35 * Math.min(c.fs, w.fs))) { g = c; break; }
    }
    if (g) g.words.push(w); else groups.push({ base: w.base, fs: w.fs, words: [w] });
  }
  return groups.map((g) => {
    g.words.sort((a, b) => a.x0 - b.x0);
    const chars = (w) => w.text.length;
    const dom = g.words.reduce((m, w) => (chars(w) > chars(m) ? w : m), g.words[0]);
    const base = median(g.words.filter((w) => Math.abs(w.base - dom.base) < 3).map((w) => w.base)) || dom.base;
    const fs = dom.fs;
    const gapMax = Math.max(2 * fs, 18);
    /** @type {Seg[]} */ const segs = []; let cur = null; let prev = null; let prevEnd = -1e9;
    for (const w of g.words) {
      const text = fixBullets(normalizeThai(w.text));
      if (!text) continue;
      const gap = w.x0 - prevEnd;
      if (!cur || gap > gapMax) { cur = { x0: w.x0, x1: w.x1, parts: [] }; segs.push(cur); prev = null; }
      else if (prev) {
        const t0 = prev.text; const need = gap > 0.18 * Math.min(fs, w.fs) && !/\s$/.test(t0) && !/^\s/.test(text) && !THAI_MARK.test(text);
        if (need) pushPart(cur.parts, ' ', prev);
      }
      pushPart(cur.parts, text, w);
      cur.x1 = Math.max(cur.x1, w.x1); prevEnd = Math.max(prevEnd, w.x1); prev = { ...w, text };
    }
    for (const s of segs) { const last = s.parts[s.parts.length - 1]; if (last) last.text = last.text.replace(/\s+$/, ''); const first = s.parts[0]; if (first) first.text = first.text.replace(/^\s+/, ''); }
    const text = segs.map((s) => s.parts.map((p) => p.text).join('')).join('\t');
    const boldChars = g.words.filter((w) => w.b).reduce((n, w) => n + w.text.length, 0);
    return { base, fs, x0: segs[0].x0, x1: Math.max(...segs.map((s) => s.x1)), segs, b: boldChars > text.length * 0.5, text, thai: THAI.test(text) };
  }).filter((l) => l.segs.length).sort((a, b) => a.base - b.base);
}

/** Typical line pitch ÷ font size over the whole document (falls back to 1.2). */
export function estimatePitchRatio(pagesLines) {
  const r = [];
  for (const lines of pagesLines) for (let i = 1; i < lines.length; i++) {
    const a = lines[i - 1], b = lines[i];
    if (Math.abs(a.fs - b.fs) > 0.5 || a.segs.length > 1 || b.segs.length > 1) continue;
    const q = (b.base - a.base) / b.fs; if (q >= 1.0 && q <= 1.7) r.push(Math.round(q * 100) / 100);
  }
  return r.length >= 3 ? Math.min(1.6, Math.max(1.05, median(r))) : 1.2;
}

/* ------------------------------------------------------------------ paragraphs */

/**
 * @typedef {{type:'p',tokens:Array<Part|{tab:true}>,jc:string,indL:number,indR:number,first:number,before:number,pitch:number,tabs:Array<{pos:number,kind:string}>,top:number,bottom:number,base:number,lastBase:number,thai:boolean,fs:number,lines:number}} Para
 */

/**
 * Turn the lines of one region (page body or one table cell) into paragraphs.
 * @param {Line[]} lines sorted top → bottom
 * @param {{L:number,R:number,ratio:number,minGap?:number}} reg text area; ratio = line pitch ÷ font size
 * @returns {Para[]}  (`before` is filled in by the caller from the vertical positions)
 */
export function buildParas(lines, reg) {
  const { L, R, ratio } = reg; const W = Math.max(1, R - L);
  const full = (l) => l.x1 >= R - Math.max(3, 0.055 * W);
  const gapMin = reg.minGap == null ? 6 : reg.minGap;
  const kind = (l) => {
    if (l.segs.length > 1) return 'tabs';
    const cx = (l.x0 + l.x1) / 2, mid = (L + R) / 2;
    if (Math.abs(cx - mid) <= 2.5 && l.x0 - L >= gapMin && R - l.x1 >= gapMin) return 'center';
    if (l.x1 >= R - 3 && l.x0 > L + 0.35 * W) return 'right';
    return 'left';
  };
  const groups = [];
  for (const l of lines) {
    const k = kind(l); const g = groups[groups.length - 1];
    if (g && g.kind === 'left' && k === 'left') {
      const prev = g.lines[g.lines.length - 1]; const dy = l.base - prev.base; const p = g.lines.length > 1 ? g.pitch : prev.fs * ratio;
      const sameSize = Math.abs(prev.fs - l.fs) <= 0.6;
      const tight = dy >= 0.8 * p && dy <= 1.35 * p && dy >= 0.8 * l.fs * 1.0;
      let indentOk = false;
      if (g.lines.length > 1) indentOk = Math.abs(l.x0 - g.contLeft) <= 3;
      else if (Math.abs(l.x0 - prev.x0) <= 3) indentOk = true;                                             // plain wrap
      else if (l.x0 < prev.x0 - 4 && prev.x0 - L > 4 && Math.abs(l.x0 - L) <= 3) indentOk = true;          // first-line indent
      else if (MARKER.test(prev.text) && l.x0 > prev.x0 + 0.4 * prev.fs && l.x0 < prev.x0 + 3.5 * prev.fs) indentOk = true;   // hanging bullet / number
      if (sameSize && tight && indentOk && full(prev) && !MARKER.test(l.text)) {
        if (g.lines.length === 1) g.contLeft = l.x0;
        g.lines.push(l); g.pitch = median(g.lines.slice(1).map((x, i) => x.base - g.lines[i].base));
        continue;
      }
    }
    groups.push({ kind: k, lines: [l], pitch: l.fs * ratio, contLeft: l.x0 });
  }
  return groups.map((g) => {
    const ls = g.lines; const first = ls[0]; const lastL = ls[ls.length - 1];
    const pitch = ls.length > 1 ? Math.max(g.pitch, first.fs * 0.9) : first.fs * ratio;
    /** @type {Array<Part|{tab:true}>} */ const tokens = []; const tabs = [];
    ls.forEach((l, li) => {
      if (li) {   // soft join of wrapped lines: Thai runs together, other text needs a space
        const prevText = ls[li - 1].segs[ls[li - 1].segs.length - 1].parts.slice(-1)[0].text; const nextText = l.segs[0].parts[0].text;
        const noSpace = (THAI.test(prevText.slice(-1)) && THAI.test(nextText[0])) || /[\s(\[“"'‘-]$/.test(prevText) || /^[\s)\].,;:!?”"'’]/.test(nextText);
        if (!noSpace) tokens.push({ ...l.segs[0].parts[0], text: ' ' });
      }
      l.segs.forEach((s, si) => {
        if (si) {
          tokens.push({ tab: true });
          const isRight = s.x1 >= R - 3 && si === l.segs.length - 1 && s.x0 > l.segs[si - 1].x1 + 4;
          tabs.push(isRight ? { pos: s.x1 - L, kind: 'right' } : { pos: s.x0 - L, kind: 'left' });
        }
        for (const p of s.parts) tokens.push({ ...p });
      });
    });
    let jc = 'left'; let indL = 0; let indR = 0; let firstInd = 0; let wrapR = null;
    const cx = (first.x0 + first.x1) / 2;
    if (g.kind === 'center') {
      const half = Math.min(cx - L, R - cx);
      jc = 'center'; indL = Math.max(0, cx - half - L); indR = Math.max(0, R - (cx + half));
    } else if (g.kind === 'right') { jc = 'right'; indR = Math.max(0, R - lastL.x1); }
    else if (g.kind === 'tabs') { indL = Math.max(0, first.x0 - L); }
    else {
      const cont = ls.length > 1 ? g.contLeft : first.x0;
      indL = Math.max(0, cont - L); firstInd = first.x0 - cont;
      if (ls.length > 1) {
        const ends = ls.slice(0, -1).map((l) => l.x1);
        wrapR = Math.max(...ends);                                   // wrap where the longest line ended, so every original line still fits
        if (Math.max(...ends) - Math.min(...ends) <= 1.6 && wrapR >= R - Math.max(3, 0.055 * W)) jc = thaiShare(ls) >= 0.5 ? 'thaiDistribute' : 'both';
        indR = Math.max(0, R - wrapR);
      }
    }
    return { type: 'p', tokens, jc, indL, indR, first: firstInd, before: 0, pitch, tabs, top: first.base - BASE_R * pitch, bottom: lastL.base + (1 - BASE_R) * pitch, base: first.base, lastBase: lastL.base, thai: ls.some((l) => l.thai), fs: first.fs, lines: ls.length, cx, x1: lastL.x1, wrapR };
  });
}
function thaiShare(ls) { const t = ls.map((l) => l.text).join(''); const n = (t.match(/[\u0e00-\u0e7f]/g) || []).length; const a = (t.match(/[A-Za-z]/g) || []).length; return n / Math.max(1, n + a); }

/* ------------------------------------------------------------------ rules → tables */

const TOL = 2.2;
function mergeSegs(segs, key, lo, hi) {   // merge collinear, touching segments
  const sorted = segs.slice().sort((a, b) => a[key] - b[key] || a[lo] - b[lo]); const out = [];
  for (const s of sorted) {
    const l = out[out.length - 1];
    if (l && Math.abs(l[key] - s[key]) <= 1 && s[lo] <= l[hi] + 2.5) { l[hi] = Math.max(l[hi], s[hi]); l.w = Math.max(l.w, s.w); } else out.push({ ...s });
  }
  return out;
}
const cluster = (vals, tol = TOL) => { const s = [...vals].sort((a, b) => a - b); const out = []; for (const v of s) { const l = out[out.length - 1]; if (l && v - l.max <= tol) { l.max = v; l.sum += v; l.n++; } else out.push({ max: v, sum: v, n: 1 }); } return out.map((c) => c.sum / c.n); };

/**
 * Find tables: connected groups of horizontal + vertical rules.
 * @returns {{tables:Array<any>,loose:Array<any>}} tables = grid description; loose = rules that belong to no table
 */
export function findTables(rules) {
  const H = mergeSegs(rules.filter((r) => r.y0 === r.y1).map((r) => ({ y: r.y0, x0: r.x0, x1: r.x1, w: r.w })), 'y', 'x0', 'x1');
  const V = mergeSegs(rules.filter((r) => r.x0 === r.x1).map((r) => ({ x: r.x0, y0: r.y0, y1: r.y1, w: r.w })), 'x', 'y0', 'y1');
  const nodes = [...H.map((s) => ({ t: 'h', s })), ...V.map((s) => ({ t: 'v', s }))];
  const parent = nodes.map((_, i) => i); const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const a = nodes[i], b = nodes[j]; if (a.t === b.t) continue;
    const h = a.t === 'h' ? a.s : b.s, v = a.t === 'v' ? a.s : b.s;
    if (v.x >= h.x0 - TOL && v.x <= h.x1 + TOL && h.y >= v.y0 - TOL && h.y <= v.y1 + TOL) parent[find(i)] = find(j);
  }
  const comps = new Map(); nodes.forEach((n, i) => { const r = find(i); if (!comps.has(r)) comps.set(r, []); comps.get(r).push(n); });
  const tables = []; const loose = [];
  for (const list of comps.values()) {
    const hs = list.filter((n) => n.t === 'h').map((n) => n.s), vs = list.filter((n) => n.t === 'v').map((n) => n.s);
    if (hs.length >= 2 && vs.length >= 2) { const t = buildGrid(hs, vs); if (t) { tables.push(t); continue; } }
    if (hs.length >= 1 && vs.length === 0) loose.push(...hs.map((s) => ({ kind: 'h', ...s })));
    else loose.push(...hs.map((s) => ({ kind: 'h', ...s })), ...vs.map((s) => ({ kind: 'v', ...s })));
  }
  return { tables, loose };
}

function buildGrid(hs, vs) {
  let xs = cluster(vs.map((v) => v.x)); let ys = cluster(hs.map((h) => h.y));
  const minHx = Math.min(...hs.map((h) => h.x0)), maxHx = Math.max(...hs.map((h) => h.x1)), minVy = Math.min(...vs.map((v) => v.y0)), maxVy = Math.max(...vs.map((v) => v.y1));
  if (minHx < xs[0] - 3) xs = [minHx, ...xs]; if (maxHx > xs[xs.length - 1] + 3) xs = [...xs, maxHx];
  if (minVy < ys[0] - 3) ys = [minVy, ...ys]; if (maxVy > ys[ys.length - 1] + 3) ys = [...ys, maxVy];
  const C = xs.length - 1, R = ys.length - 1; if (C < 1 || R < 1 || C > 40 || R > 400) return null;
  const idx = (arr, v) => { let best = 0; for (let i = 1; i < arr.length; i++) if (Math.abs(arr[i] - v) < Math.abs(arr[best] - v)) best = i; return best; };
  // horiz[k][c] = rule width on grid line k across column c;  vert[r][k] = rule width on grid line k beside row r
  const horiz = Array.from({ length: R + 1 }, () => Array(C).fill(0)); const vert = Array.from({ length: R }, () => Array(C + 1).fill(0));
  for (const h of hs) { const k = idx(ys, h.y); if (Math.abs(ys[k] - h.y) > TOL + 1) continue; for (let c = 0; c < C; c++) if (h.x0 <= xs[c] + TOL + 1 && h.x1 >= xs[c + 1] - TOL - 1) horiz[k][c] = Math.max(horiz[k][c], h.w); }
  for (const v of vs) { const k = idx(xs, v.x); if (Math.abs(xs[k] - v.x) > TOL + 1) continue; for (let r = 0; r < R; r++) if (v.y0 <= ys[r] + TOL + 1 && v.y1 >= ys[r + 1] - TOL - 1) vert[r][k] = Math.max(vert[r][k], v.w); }
  const covered = Array.from({ length: R }, () => Array(C).fill(false)); const cells = [];
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    if (covered[r][c]) continue;
    let cs = 1; while (c + cs < C && !vert[r][c + cs] && !covered[r][c + cs]) cs++;
    let rs = 1;
    while (r + rs < R) { let open = true; for (let k = c; k < c + cs; k++) if (horiz[r + rs][k] || covered[r + rs][k]) open = false; if (!open) break; rs++; }
    for (let i = r; i < r + rs; i++) for (let k = c; k < c + cs; k++) covered[i][k] = true;
    const wTop = Math.max(...horiz[r].slice(c, c + cs)), wBot = Math.max(...horiz[r + rs].slice(c, c + cs));
    const wL = Math.max(...vert.slice(r, r + rs).map((row) => row[c])), wR = Math.max(...vert.slice(r, r + rs).map((row) => row[c + cs]));
    cells.push({ r, c, rs, cs, x0: xs[c], x1: xs[c + cs], y0: ys[r], y1: ys[r + rs], borders: { t: wTop, b: wBot, l: wL, r: wR }, fill: null, lines: [], paras: [], vAlign: 'top' });
  }
  return { xs, ys, C, R, cells, x0: xs[0], x1: xs[C], y0: ys[0], y1: ys[R] };
}

/* ------------------------------------------------------------------ page layout */

const hex = (c) => String(c || '').replace('#', '').toUpperCase();

/**
 * Lay out one page.
 * @param {import('./pdf-pages.js').PdfPage} page
 * @param {{ratio:number}} doc
 * @returns {{width:number,height:number,margins:{l:number,t:number,r:number,b:number},blocks:any[],images:any[],dropped:number}}
 */
export function layoutPage(page, doc) {
  const W = page.width, H = page.height; const ratio = doc.ratio;
  let { tables, loose } = findTables(page.rules);
  // words → table cells
  const taken = new Set();
  const inRect = (w, x0, y0, x1, y1, pad = 1.5) => { const cx = (w.x0 + w.x1) / 2, cy = w.base - w.fs * 0.3; return cx >= x0 - pad && cx <= x1 + pad && cy >= y0 - pad && cy <= y1 + pad; };
  for (const t of tables) {
    const cellWords = new Map(t.cells.map((c) => [c, []]));
    page.words.forEach((w, wi) => {
      if (taken.has(wi) || !inRect(w, t.x0, t.y0, t.x1, t.y1)) return;
      const c = t.cells.find((cl) => inRect(w, cl.x0, cl.y0, cl.x1, cl.y1, 0.5)) || t.cells.find((cl) => inRect(w, cl.x0, cl.y0, cl.x1, cl.y1, 2.5));
      if (c) { cellWords.get(c).push(w); taken.add(wi); }
    });
    for (const c of t.cells) c.words = cellWords.get(c);
    for (const f of page.fills) for (const c of t.cells) {
      const ox = Math.min(f.x1, c.x1) - Math.max(f.x0, c.x0), oy = Math.min(f.y1, c.y1) - Math.max(f.y0, c.y0);
      if (ox > 0 && oy > 0 && (ox * oy) / ((c.x1 - c.x0) * (c.y1 - c.y0)) >= 0.7) c.fill = hex(f.color);
    }
  }
  // underlines: a loose horizontal rule just under a word (a rule covering only part of a run splits the run)
  const rest = []; let flowWords = page.words.filter((_, i) => !taken.has(i));
  for (const r of loose) {
    let used = false;
    if (r.kind === 'h') {
      const next = [];
      for (const w of flowWords) {
        const ov = Math.min(r.x1, w.x1) - Math.max(r.x0, w.x0);
        if (r.y > w.base && r.y <= w.base + 0.42 * w.fs && ov >= 0.5 * Math.min(w.x1 - w.x0, r.x1 - r.x0) && ov > 2) { used = true; next.push(...underlinePart(w, r)); } else next.push(w);
      }
      flowWords = next;
    }
    if (!used) rest.push(r);
  }
  const lines = buildLines(flowWords);
  const allX0 = lines.map((l) => l.x0), allX1 = lines.map((l) => l.x1);
  const L0 = allX0.length ? quant(allX0, 0.1) : 0; const R0 = allX1.length ? quant(allX1, 0.9) : W;
  const bodyReg = { L: L0, R: Math.max(R0, L0 + 10), ratio };
  const paras = buildParas(lines, bodyReg);
  // tables → blocks
  const tblBlocks = tables.map((t) => tableBlock(t, ratio));
  /** loose horizontal rules become bordered empty paragraphs */
  const ruleBlocks = rest.filter((r) => r.kind === 'h' && r.x1 - r.x0 >= 30).map((r) => ({ type: 'rule', top: r.y - 1, y: r.y, x0: r.x0, x1: r.x1, w: r.w }));
  const dropped = rest.filter((r) => !(r.kind === 'h' && r.x1 - r.x0 >= 30)).length + page.fills.filter((f) => !tables.some((t) => f.x0 >= t.x0 - 2 && f.x1 <= t.x1 + 2 && f.y0 >= t.y0 - 2 && f.y1 <= t.y1 + 2)).length;
  const blocks = [...paras.map((p) => ({ ...p, _top: p.top })), ...tblBlocks.map((t) => ({ ...t, _top: t.y0 })), ...ruleBlocks.map((r) => ({ ...r, _top: r.top }))].sort((a, b) => a._top - b._top);
  // margins
  const edgesL = [...lines.map((l) => l.x0), ...tables.map((t) => t.x0), ...ruleBlocks.map((r) => r.x0)];
  const edgesR = [...lines.map((l) => l.x1), ...tables.map((t) => t.x1), ...ruleBlocks.map((r) => r.x1)];
  const left = edgesL.length ? Math.max(0, Math.min(...edgesL)) : 36; const right = edgesR.length ? Math.max(0, W - Math.max(...edgesR)) : 36;
  const textL = left, textR = W - right;
  // paragraph indents were computed against the body region; re-base them on the real margins (wrap only where the original text wrapped)
  const shift = L0 - textL;
  for (const b of blocks) {
    if (b.type !== 'p') continue;
    if (b.jc === 'center') { const half = Math.max(0, Math.min(b.cx - textL, textR - b.cx)); b.indL = b.cx - half - textL; b.indR = textR - (b.cx + half); }
    else if (b.jc === 'right') { b.indL = 0; b.indR = Math.max(0, textR - b.x1); }
    else { b.indL += shift; b.indR = b.wrapR != null ? Math.max(0, textR - b.wrapR) : 0; }
    b.tabs = b.tabs.map((t) => ({ ...t, pos: t.pos + shift }));
  }
  for (const b of blocks) if (b.type === 'rule') { b.indL = b.x0 - textL; b.indR = textR - b.x1; }
  for (const b of blocks) if (b.type === 'table') b.ind = b.x0 - textL;
  const topY = blocks.length ? Math.max(0, blocks[0]._top) : 36;
  // flow: space before each block
  let cursor = topY;
  for (const b of blocks) {
    if (b.type === 'p') { b.before = Math.max(0, b.top - cursor); cursor = Math.max(cursor, b.top) + (b.lastBase - b.base) + b.pitch; }
    else if (b.type === 'table') { b.gapBefore = Math.max(0, b.y0 - cursor); cursor = Math.max(cursor, b.y0) + (b.y1 - b.y0); }
    else { b.gapBefore = Math.max(0, b.top - cursor); cursor = Math.max(cursor, b.top) + 1; }
  }
  const bottom = Math.max(0, H - cursor - 6);
  return { width: W, height: H, margins: { l: left, t: topY, r: right, b: Math.min(bottom, H * 0.45) }, blocks, images: page.images, dropped, ocr: page.ocr };
}


/** Mark the part of a run lying under a rule as underlined; the run is cut at the nearest space when only part of it is covered. */
function underlinePart(w, r) {
  const width = w.x1 - w.x0; const a = (Math.max(r.x0, w.x0) - w.x0) / width, b = (Math.min(r.x1, w.x1) - w.x0) / width;
  if (a <= 0.04 && b >= 0.96) return [{ ...w, ul: true }];
  const n = w.text.length;
  const cut = (f) => { let k = Math.round(f * n); let best = k; for (let d = 0; d <= 4; d++) for (const kk of [k - d, k + d]) if (kk > 0 && kk < n && /\s/.test(w.text[kk - 1] + w.text[kk])) { best = kk; d = 5; break; } return Math.min(n, Math.max(0, best)); };
  const i0 = a <= 0.04 ? 0 : cut(a), i1 = b >= 0.96 ? n : cut(b);
  const pieces = []; const px = (i) => w.x0 + (i / n) * width;
  const add = (from, to, ul) => { if (to > from && w.text.slice(from, to).trim()) pieces.push({ ...w, text: w.text.slice(from, to), x0: px(from), x1: px(to), ul }); };
  add(0, i0, false); add(i0, i1, true); add(i1, n, false);
  return pieces.length ? pieces : [w];
}

function tableBlock(t, ratio) {
  const pad = (() => { const d = t.cells.filter((c) => c.words && c.words.length).map((c) => Math.min(...c.words.map((w) => w.x0)) - c.x0).filter((v) => v >= 0); return Math.min(10, Math.max(1.5, d.length ? median(d) : 3)); })();
  for (const c of t.cells) {
    const L = c.x0 + pad, R = c.x1 - pad;
    const lines = buildLines(c.words || []);
    c.paras = buildParas(lines, { L, R: Math.max(R, L + 4), ratio, minGap: 2.5 });
    for (const p of c.paras) { p.indL = Math.max(0, p.indL); p.indR = Math.max(0, p.indR); }
    if (lines.length) {
      const first = lines[0], last = lines[lines.length - 1];
      const p0 = first.fs * ratio;
      const gt = (first.base - BASE_R * p0) - c.y0, gb = c.y1 - (last.base + (1 - BASE_R) * p0);
      c.vAlign = Math.abs(gt - gb) <= Math.max(3, 0.12 * (c.y1 - c.y0)) ? 'center' : gb < gt ? 'bottom' : 'top';
      let cursor = c.y0 + (c.borders.t || 0) / 2;
      for (const p of c.paras) { p.before = c.vAlign === 'top' ? Math.max(0, p.top - cursor) : (p === c.paras[0] ? 0 : Math.max(0, p.top - cursor)); cursor = Math.max(cursor, p.top) + (p.lastBase - p.base) + p.pitch; }
    }
  }
  return { type: 'table', x0: t.x0, x1: t.x1, y0: t.y0, y1: t.y1, xs: t.xs, ys: t.ys, C: t.C, R: t.R, cells: t.cells, pad, ind: 0, gapBefore: 0 };
}

/**
 * Lay out a whole document.
 * @param {import('./pdf-pages.js').PdfPage[]} pages
 */
export function layoutDocument(pages) {
  const ratio = estimatePitchRatio(pages.map((p) => buildLines(p.words)));
  const out = pages.map((p) => layoutPage(p, { ratio }));
  return { pages: out, ratio, dropped: out.reduce((n, p) => n + p.dropped, 0) };
}
