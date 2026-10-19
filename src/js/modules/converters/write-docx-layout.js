// Layout model (pdf-layout.js) → .docx that looks like the PDF: one Word section per PDF page (own page size and margins), paragraphs with exact
// indents / tab stops / justification, real Word tables (merged cells, borders, shading) and pictures anchored at their PDF position.
// Fonts: TH Sarabun New / TH SarabunPSK (or whatever the PDF uses) are written by family name with the complex-script slots (w:cs, w:szCs)
// filled, so Word keeps the font AND the size for Thai text. The fonts are not embedded: they must be installed where the file is opened.
import { WDRAW, docxPackage } from './write-docx.js';
import { DOCX_FONTS, chooseFont } from './docx-fonts.js';

const bad = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g;
const esc = (s) => String(s).replace(bad, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const tw = (pt) => Math.round(pt * 20);
const THAI = /[\u0e00-\u0e7f]/;

/** Word family name for a non-Thai PDF font ("TimesNewRomanPSMT" → "Times New Roman"); null = unknown. */
export function latinFamily(pdfName) {
  const s = String(pdfName || '').replace(/^[A-Z]{6}\+/, '').toLowerCase().replace(/[\s_,.\-]+/g, '');
  const map = [[/timesnewroman|^times/, 'Times New Roman'], [/arial|helvetica/, 'Arial'], [/calibri/, 'Calibri'], [/cambria/, 'Cambria'], [/couriernew|^courier/, 'Courier New'],
    [/verdana/, 'Verdana'], [/georgia/, 'Georgia'], [/segoeui/, 'Segoe UI'], [/trebuchet/, 'Trebuchet MS'], [/garamond/, 'Garamond'], [/consolas/, 'Consolas']];
  for (const [re, name] of map) if (re.test(s)) return name;
  return null;
}

/**
 * @param {{pages:any[],ratio:number}} model result of layoutDocument()
 * @param {{title?:string,fontChoice?:string,fontUsage?:Record<string,number>}} [opts] fontChoice 'auto' = follow the PDF, or a key of DOCX_FONTS
 * @returns {Promise<{blob:Blob,font:import('./docx-fonts.js').DocxFont,detected:import('./docx-fonts.js').DocxFont|null,pages:number,images:number,fontsUsed:string[]}>}
 */
export async function writeDocxLayout(model, { title = 'document', fontChoice = 'auto', fontUsage = {} } = {}) {
  const { font, detected } = chooseFont(fontChoice, fontUsage);
  const forced = fontChoice && fontChoice !== 'auto';
  const used = new Set([font.family]);
  const images = []; let docPrId = 1;

  /** rFonts + size for one run */
  const runProps = (p) => {
    let ascii = font.family; let cs = font.family;
    if (!forced) {
      const own = p.fid ? DOCX_FONTS[p.fid] : null;
      if (own) { ascii = own.family; cs = own.family; } else { const lat = latinFamily(p.font); if (lat) ascii = lat; }
    }
    used.add(ascii); used.add(cs);
    const sz = Math.max(2, Math.round(p.fs * 2));
    return `<w:rFonts w:ascii="${esc(ascii)}" w:hAnsi="${esc(ascii)}" w:eastAsia="${esc(ascii)}" w:cs="${esc(cs)}"/>${p.b ? '<w:b/><w:bCs/>' : ''}${p.i ? '<w:i/><w:iCs/>' : ''}<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>${p.u ? '<w:u w:val="single"/>' : ''}`;
  };
  const runs = (tokens, fallback) => tokens.map((t) => {
    if (t.tab) return `<w:r><w:rPr>${runProps(fallback)}</w:rPr><w:tab/></w:r>`;
    if (!t.text) return '';
    return `<w:r><w:rPr>${runProps(t)}</w:rPr><w:t xml:space="preserve">${esc(t.text)}</w:t></w:r>`;
  }).join('');

  const microPara = (heightTw, extra = '', inner = '') => `<w:p><w:pPr><w:widowControl w:val="0"/>${extra}<w:spacing w:before="0" w:after="0" w:line="${Math.max(20, heightTw)}" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr></w:pPr>${inner}</w:p>`;

  const para = (b, { keepNextToTable = false } = {}) => {
    const ref = b.tokens.find((t) => !t.tab) || { fs: b.fs, font: '', fid: null, b: false, i: false };
    const tabs = b.tabs.length ? `<w:tabs>${b.tabs.map((t) => `<w:tab w:val="${t.kind}" w:pos="${tw(t.pos)}"/>`).join('')}</w:tabs>` : '';
    const ind = (b.indL > 0.4 || b.indR > 0.4 || Math.abs(b.first) > 0.4)
      ? `<w:ind w:left="${tw(b.indL)}" w:right="${tw(b.indR)}"${b.first > 0.4 ? ` w:firstLine="${tw(b.first)}"` : b.first < -0.4 ? ` w:hanging="${tw(-b.first)}"` : ''}/>` : '';
    const jc = b.jc && b.jc !== 'left' ? `<w:jc w:val="${b.jc}"/>` : '';
    const mark = `<w:rPr>${runProps(ref)}</w:rPr>`;
    void keepNextToTable;
    return `<w:p><w:pPr><w:widowControl w:val="0"/>${tabs}<w:spacing w:before="${tw(b.before)}" w:after="0" w:line="${tw(b.pitch)}" w:lineRule="atLeast"/>${ind}${jc}${mark}</w:pPr>${runs(b.tokens, ref)}</w:p>`;
  };

  const ruleXml = (b) => `<w:p><w:pPr><w:widowControl w:val="0"/><w:pBdr><w:bottom w:val="single" w:sz="${Math.max(2, Math.round(b.w * 8))}" w:space="0" w:color="000000"/></w:pBdr><w:spacing w:before="${tw(b.gapBefore)}" w:after="0" w:line="20" w:lineRule="exact"/><w:ind w:left="${tw(b.indL)}" w:right="${tw(b.indR)}"/><w:rPr><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr></w:pPr></w:p>`;

  const border = (name, w) => (w > 0 ? `<w:${name} w:val="single" w:sz="${Math.max(2, Math.min(96, Math.round(w * 8)))}" w:space="0" w:color="000000"/>` : `<w:${name} w:val="nil"/>`);

  const tableXml = (t) => {
    const widths = []; let acc = 0;
    for (let c = 0; c < t.C; c++) { const edge = tw(t.xs[c + 1] - t.xs[0]); widths.push(edge - acc); acc = edge; }
    const grid = widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('');
    const origin = new Map(t.cells.map((c) => [`${c.r}:${c.c}`, c]));
    const cover = new Map();   // "r:c" → origin cell, for the cells swallowed by a merge
    for (const c of t.cells) for (let r = c.r; r < c.r + c.rs; r++) for (let k = c.c; k < c.c + c.cs; k++) if (r !== c.r || k !== c.c) cover.set(`${r}:${k}`, c);
    const padTw = tw(t.pad);
    let rowsXml = '';
    for (let r = 0; r < t.R; r++) {
      let tcs = '';
      for (let c = 0; c < t.C; c++) {
        const o = origin.get(`${r}:${c}`); const cov = cover.get(`${r}:${c}`);
        if (cov && cov.r === r) continue;                                     // swallowed by a horizontal merge
        if (cov) {                                                            // continuation of a vertical merge
          const w = tw(cov.x1 - cov.x0);
          tcs += `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${cov.cs > 1 ? `<w:gridSpan w:val="${cov.cs}"/>` : ''}<w:vMerge/><w:tcBorders>${border('top', 0)}${border('left', cov.borders.l)}${border('bottom', cov.r + cov.rs - 1 === r ? cov.borders.b : 0)}${border('right', cov.borders.r)}</w:tcBorders></w:tcPr>${microPara(20)}</w:tc>`;
          c += cov.cs - 1; continue;
        }
        if (!o) continue;
        const w = widths.slice(c, c + o.cs).reduce((a, b) => a + b, 0);
        const body = o.paras.length ? o.paras.map((p) => para(p)).join('') : microPara(20);
        tcs += `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${o.cs > 1 ? `<w:gridSpan w:val="${o.cs}"/>` : ''}${o.rs > 1 ? '<w:vMerge w:val="restart"/>' : ''}<w:tcBorders>${border('top', o.borders.t)}${border('left', o.borders.l)}${border('bottom', o.borders.b)}${border('right', o.borders.r)}</w:tcBorders>${o.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.fill}"/>` : ''}${o.vAlign !== 'top' ? `<w:vAlign w:val="${o.vAlign === 'center' ? 'center' : 'bottom'}"/>` : ''}</w:tcPr>${body}</w:tc>`;
        c += o.cs - 1;
      }
      rowsXml += `<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="${tw(t.ys[r + 1] - t.ys[r])}" w:hRule="atLeast"/></w:trPr>${tcs}</w:tr>`;
    }
    return `<w:tbl><w:tblPr><w:tblW w:w="${acc}" w:type="dxa"/><w:tblInd w:w="${tw(t.ind)}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="${padTw}" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="${padTw}" w:type="dxa"/></w:tblCellMar><w:tblLook w:val="0000"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${rowsXml}</w:tbl>`;
  };

  const anchorXml = (im, rid, behind, z) => {
    const cx = Math.round((im.x1 - im.x0) * 12700), cy = Math.round((im.y1 - im.y0) * 12700); const id = docPrId++;
    return `<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${z}" behindDoc="${behind ? 1 : 0}" locked="0" layoutInCell="0" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>${Math.round(im.x0 * 12700)}</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>${Math.round(im.y0 * 12700)}</wp:posOffset></wp:positionV><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="${id}" name="Picture ${id}"/><wp:cNvGraphicFramePr/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="${esc(rid)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`;
  };

  // Every PDF page is its own Word section (explicit "next page" break), so spare room at the bottom can never pull the next page's text up.
  // The bottom margin is therefore kept small (about 1.3 cm) instead of the measured one: Word / LibreOffice break Thai words by dictionary
  // (many PDFs break anywhere), so a reflowed paragraph can come out a line or two longer than in the PDF, and a page filled exactly to
  // its margin would push its last lines onto an extra page.
  const BOTTOM_MARGIN_MAX = 57, BOTTOM_SLACK = 21;
  const CARRIER_PT = 1;                                                           // height of the paragraph that carries a page's pictures
  const sectXml = (pg) => {
    const landscape = pg.width > pg.height;
    const m = pg.margins;
    const top = Math.max(0, m.t - (pg.images.length ? CARRIER_PT : 0));
    const bottom = Math.max(14, Math.min(m.b, BOTTOM_MARGIN_MAX) - BOTTOM_SLACK);
    return `<w:sectPr><w:type w:val="nextPage"/><w:pgSz w:w="${tw(pg.width)}" w:h="${tw(pg.height)}"${landscape ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="${tw(top)}" w:right="${tw(m.r)}" w:bottom="${tw(bottom)}" w:left="${tw(m.l)}" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>`;
  };

  let body = ''; let prevWasTable = false; let nImg = 0; let lastSect = '';
  model.pages.forEach((pg, pi) => {
    prevWasTable = false;
    // carrier paragraph FIRST: a picture is anchored to the page by absolute position, but it stays on the page of the paragraph that holds it,
    // so it must not sit behind content that could overflow onto the next page
    let anchors = '';
    pg.images.forEach((im, k) => {
      nImg += 1; const name = `image${nImg}.png`; const rid = `rIdImg${nImg}`; images.push({ rid, name, bytes: im.bytes });
      const big = (im.x1 - im.x0) * (im.y1 - im.y0) > pg.width * pg.height * 0.25;
      anchors += anchorXml(im, rid, big, 251658240 + k);
    });
    if (anchors) body += microPara(tw(CARRIER_PT), '', anchors);
    for (const b of pg.blocks) {
      if (b.type === 'p') { body += para(b); prevWasTable = false; }
      else if (b.type === 'rule') { body += ruleXml(b); prevWasTable = false; }
      else {
        if (prevWasTable) body += microPara(20);                                 // two tables in a row would merge in Word
        else if (b.gapBefore >= 1.2) body += microPara(tw(b.gapBefore));
        body += tableXml(b); prevWasTable = true;
      }
    }
    const sect = sectXml(pg);
    // the last paragraph of the page holds the section break (the final page uses the body-level sectPr instead)
    if (pi === model.pages.length - 1) { body += microPara(20); lastSect = sect; }
    else body += `<w:p><w:pPr><w:widowControl w:val="0"/><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr>${sect}</w:pPr></w:p>`;
  });
  const blob = await docxPackage({ body, sect: lastSect, font, title, images, settings: true, compact: true, extraFonts: [...used] });
  void WDRAW; void THAI;
  return { blob, font, detected, pages: model.pages.length, images: images.length, fontsUsed: [...used] };
}
