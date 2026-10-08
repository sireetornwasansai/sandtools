// Markdown → .docx (Word), written by hand with JSZip: headings, bold/italic/strike/code, links, nested lists, tables, quotes, code blocks.
// Thai text is tagged as complex script (w:cs + bidi language) so Word applies Thai line breaking and the right font.
import { Lexer } from '../../vendor/marked.esm.js';
import { getJSZip } from './common.js';
import { ent } from './write-text.js';

const bad = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g;
const x = (s) => String(s).replace(bad, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const TEXT_W = 9638; // A4 minus 2 cm margins, in twips

export async function writeDocx(md, { title = 'document' } = {}) {
  const JSZip = await getJSZip();
  const rels = []; // hyperlinks
  let images = 0; let numSeq = 0; const nums = []; // ordered lists each get their own numbering instance (restart at 1)

  /** inline tokens → runs. `st` = {b,i,s,code,link} */
  function runs(tokens, st = {}) {
    let out = '';
    const run = (text, s) => {
      if (text === '') return '';
      const rpr = `${s.link ? '<w:rStyle w:val="Hyperlink"/>' : ''}${s.code ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>' : ''}${s.b ? '<w:b/><w:bCs/>' : ''}${s.i ? '<w:i/><w:iCs/>' : ''}${s.s ? '<w:strike/>' : ''}${s.code ? '<w:shd w:val="clear" w:color="auto" w:fill="F1F3F7"/>' : ''}`;
      const parts = String(text).split('\n');
      return parts.map((p, i) => `${i ? '<w:r><w:br/></w:r>' : ''}${p === '' ? '' : `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t xml:space="preserve">${x(p)}</w:t></w:r>`}`).join('');
    };
    for (const t of tokens || []) {
      switch (t.type) {
        case 'strong': out += runs(t.tokens, { ...st, b: true }); break;
        case 'em': out += runs(t.tokens, { ...st, i: true }); break;
        case 'del': out += runs(t.tokens, { ...st, s: true }); break;
        case 'codespan': out += run(ent(t.text), { ...st, code: true }); break;
        case 'br': out += '<w:r><w:br/></w:r>'; break;
        case 'checkbox': out += run(t.checked ? '☒ ' : '☐ ', st); break;
        case 'image': images += 1; out += run(`[รูปภาพ${t.text ? `: ${ent(t.text)}` : ''}]`, { ...st, i: true }); break;
        case 'link': {
          const href = String(t.href || '');
          if (/^(https?:|mailto:)/i.test(href)) { rels.push(href); out += `<w:hyperlink r:id="rIdL${rels.length}" w:history="1">${runs(t.tokens, { ...st, link: true })}</w:hyperlink>`; } else out += runs(t.tokens, st);
          break;
        }
        case 'html': out += run(ent(String(t.text).replace(/<br\s*\/?>/gi, '\n').replace(/<\/?[a-z][^>]*>/gi, '')), st); break;
        default: out += t.tokens ? runs(t.tokens, st) : run(ent(t.text ?? ''), st);
      }
    }
    return out;
  }

  const para = (inner, ppr = '') => `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${inner}</w:p>`;

  function list(t, level = 0, numId) {
    let out = '';
    const id = t.ordered ? (() => { numSeq += 1; nums.push({ id: numSeq + 2, start: Number(t.start) || 1 }); return numSeq + 2; })() : 1;
    for (const it of t.items) {
      let first = true;
      for (const k of it.tokens || []) {
        if (k.type === 'list') { out += list(k, Math.min(level + 1, 8)); continue; }
        if (k.type === 'text' || k.type === 'paragraph') {
          out += para(runs(k.tokens || [{ type: 'text', text: k.text }]), `<w:pStyle w:val="ListParagraph"/>${first ? `<w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${id}"/></w:numPr>` : `<w:ind w:left="${720 + level * 360}"/>`}`);
          first = false;
        } else { out += block(k); }
      }
    }
    return out;
  }

  function table(t) {
    const cols = t.header.length; const cw = Math.floor(TEXT_W / cols);
    const cell = (c, head) => `<w:tc><w:tcPr><w:tcW w:w="${cw}" w:type="dxa"/>${head ? '<w:shd w:val="clear" w:color="auto" w:fill="E8ECF4"/>' : ''}</w:tcPr>${para(runs(c.tokens, head ? { b: true } : {}), '<w:spacing w:before="40" w:after="40"/>')}</w:tc>`;
    const rows = [t.header, ...t.rows].map((r, i) => `<w:tr>${i === 0 ? '<w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>' : '<w:trPr><w:cantSplit/></w:trPr>'}${r.map((c) => cell(c, i === 0)).join('')}</w:tr>`).join('');
    return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="${TEXT_W}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="9AA3B5"/>`).join('')}</w:tblBorders></w:tblPr><w:tblGrid>${Array(cols).fill(`<w:gridCol w:w="${cw}"/>`).join('')}</w:tblGrid>${rows}</w:tbl>${para('', '<w:spacing w:after="0"/>')}`;
  }

  function block(t) {
    switch (t.type) {
      case 'heading': return para(runs(t.tokens), `<w:pStyle w:val="Heading${Math.min(t.depth, 6)}"/>`);
      case 'paragraph': case 'text': return para(runs(t.tokens || [{ type: 'text', text: t.text }]));
      case 'code': return String(t.text).split('\n').map((l, i, a) => para(l === '' ? '' : `<w:r><w:t xml:space="preserve">${x(l)}</w:t></w:r>`, `<w:pStyle w:val="Code"/>${i === 0 ? '' : '<w:contextualSpacing/>'}`)).join('') + para('', '<w:spacing w:after="0"/>');
      case 'blockquote': return (t.tokens || []).map((k) => (k.type === 'paragraph' || k.type === 'text' ? para(runs(k.tokens || [{ type: 'text', text: k.text }]), '<w:pStyle w:val="Quote"/>') : block(k))).join('');
      case 'hr': return para('', '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="9AA3B5"/></w:pBdr><w:spacing w:before="120" w:after="120"/>');
      case 'list': return list(t);
      case 'table': return table(t);
      case 'html': { const txt = ent(String(t.text).replace(/<br\s*\/?>/gi, '\n').replace(/<\/?[a-z][^>]*>/gi, '')).trim(); return txt ? para(`<w:r><w:t xml:space="preserve">${x(txt)}</w:t></w:r>`) : ''; }
      case 'space': return '';
      default: return t.tokens ? para(runs(t.tokens)) : '';
    }
  }

  const tokens = new Lexer({ gfm: true }).lex(md);
  const body = tokens.map(block).join('') || para('');
  const sect = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>';
  const font = '<w:rFonts w:ascii="Tahoma" w:hAnsi="Tahoma" w:eastAsia="Tahoma" w:cs="Tahoma"/>';
  const heading = (n, sz, before) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="${before}" w:after="100"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:bCs/><w:color w:val="1F2A5C"/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr></w:style>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr>${font}<w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US" w:eastAsia="en-US" w:bidi="th-TH"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
${[[1, 40, 360], [2, 32, 300], [3, 28, 240], [4, 25, 200], [5, 23, 160], [6, 22, 160]].map(([n, sz, b]) => heading(n, sz, b)).join('')}
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60"/><w:ind w:left="720"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="9AA3B5"/></w:pBdr><w:ind w:left="567"/></w:pPr><w:rPr><w:i/><w:iCs/><w:color w:val="4A5368"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F1F3F7"/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="2237EE"/><w:u w:val="single"/></w:rPr></w:style>
<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:style></w:styles>`;
  const lvl = (i, fmt, text, left) => `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${left}" w:hanging="360"/></w:pPr>${fmt === 'bullet' ? '<w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"/></w:rPr>' : ''}</w:lvl>`;
  const bulletLvls = Array.from({ length: 9 }, (_, i) => lvl(i, 'bullet', i % 2 ? 'o' : '\uF0B7', 720 + i * 360)).join('');
  const decLvls = Array.from({ length: 9 }, (_, i) => lvl(i, i % 3 === 0 ? 'decimal' : i % 3 === 1 ? 'lowerLetter' : 'lowerRoman', `%${i + 1}.`, 720 + i * 360)).join('');
  const numbering = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${bulletLvls}</w:abstractNum><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${decLvls}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>${nums.map((n) => `<w:num w:numId="${n.id}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="${n.start}"/></w:lvlOverride></w:num>`).join('')}</w:numbering>`;
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdN" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>${rels.map((h, i) => `<Relationship Id="rIdL${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${x(h)}" TargetMode="External"/>`).join('')}</Relationships>`;
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>');
  zip.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${x(title)}</dc:title><dc:creator>SAND Office Tools</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created></cp:coreProperties>`);
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body}${sect}</w:body></w:document>`);
  zip.file('word/styles.xml', styles); zip.file('word/numbering.xml', numbering); zip.file('word/_rels/document.xml.rels', docRels);
  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression: 'DEFLATE' });
  return { blob, images };
}
