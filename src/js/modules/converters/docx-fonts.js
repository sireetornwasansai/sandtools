// Fonts for Word output (.docx). Pure functions, no DOM: runs and is tested in Node.
//
// Word needs the font *family name* installed on the reader's machine: "TH Sarabun New" and "TH SarabunPSK" (note: no space before PSK)
// are the names Windows/Office use for the national Thai fonts. PDF files carry the PostScript names instead ("AAAAAA+THSarabunNew-Bold"),
// so a PDF font name is classified here and mapped back to the Word family name. Thai text is always tagged with the complex-script
// font + size (w:cs / w:szCs) by the writers, otherwise Word falls back to the default Thai font and ignores the size.

/**
 * @typedef {{id:string,family:string,size:number,thai:boolean,alt:string,re:RegExp|null,label:string}} DocxFont
 * size = body size in points when the writer has to choose one (the layout writer keeps the sizes measured in the PDF instead).
 */

/** @type {Record<string,DocxFont>} */
export const DOCX_FONTS = {
  THSarabunNew: { id: 'THSarabunNew', family: 'TH Sarabun New', size: 16, thai: true, alt: 'Tahoma', re: /sarabun(?:new|(?!psk|it))/, label: 'TH Sarabun New' },
  THSarabunPSK: { id: 'THSarabunPSK', family: 'TH SarabunPSK', size: 16, thai: true, alt: 'Tahoma', re: /sarabunpsk/, label: 'TH Sarabun PSK' },
  THSarabunIT: { id: 'THSarabunIT', family: 'TH SarabunIT\u0e59', size: 16, thai: true, alt: 'Tahoma', re: /sarabunit/, label: 'TH Sarabun IT\u0e59' },
  AngsanaNew: { id: 'AngsanaNew', family: 'Angsana New', size: 16, thai: true, alt: 'Tahoma', re: /angsananew/, label: 'Angsana New' },
  AngsanaUPC: { id: 'AngsanaUPC', family: 'AngsanaUPC', size: 16, thai: true, alt: 'Tahoma', re: /angsanaupc/, label: 'AngsanaUPC' },
  CordiaNew: { id: 'CordiaNew', family: 'Cordia New', size: 14, thai: true, alt: 'Tahoma', re: /cordianew/, label: 'Cordia New' },
  CordiaUPC: { id: 'CordiaUPC', family: 'CordiaUPC', size: 14, thai: true, alt: 'Tahoma', re: /cordiaupc/, label: 'CordiaUPC' },
  BrowalliaNew: { id: 'BrowalliaNew', family: 'Browallia New', size: 14, thai: true, alt: 'Tahoma', re: /browallianew/, label: 'Browallia New' },
  Tahoma: { id: 'Tahoma', family: 'Tahoma', size: 11, thai: true, alt: 'Arial', re: /tahoma/, label: 'Tahoma' }
};

/** What the font chips on the page offer ('auto' = follow the PDF). */
export const FONT_CHOICES = ['auto', 'THSarabunNew', 'THSarabunPSK', 'Tahoma'];
export const DEFAULT_FONT_CHOICE = 'auto';

/** Drop the 6-letter subset tag PDF generators put in front of embedded fonts ("ABCDEF+Name"). */
export const stripSubset = (name) => String(name == null ? '' : name).replace(/^[A-Z]{6}\+/, '');

const squash = (name) => stripSubset(name).toLowerCase().replace(/[\s_,.\-]+/g, '');

/**
 * Classify a PDF font name.
 * @param {string} name e.g. "AAAAAA+THSarabunNew-Bold", "TH SarabunPSK,Bold"
 * @returns {{font:DocxFont|null,bold:boolean,italic:boolean}}
 */
export function classifyFont(name) {
  const s = squash(name);
  let font = null;
  for (const f of Object.values(DOCX_FONTS)) if (f.re && f.re.test(s)) { font = f; break; }
  if (!font && /sarabun/.test(s)) font = DOCX_FONTS.THSarabunNew;   // plain "THSarabun" / Google "Sarabun"
  return { font, bold: /bold|black|heavy|demi/.test(s), italic: /italic|oblique/.test(s) };
}

/**
 * Pick the Word font.
 * @param {string} choice 'auto' | a key of DOCX_FONTS
 * @param {Record<string,number>} [usage] PDF font name → number of characters set in it (from the PDF; empty for other sources)
 * @returns {{font:DocxFont,detected:DocxFont|null}} detected = what the PDF itself uses (null when unknown), even if the user overrode it
 */
export function chooseFont(choice, usage = {}) {
  const weight = new Map();
  for (const [name, n] of Object.entries(usage || {})) {
    const c = classifyFont(name).font;
    if (c) weight.set(c.id, (weight.get(c.id) || 0) + (Number(n) || 0));
  }
  let detected = null; let best = -1;
  for (const [id, n] of weight) if (n > best) { best = n; detected = DOCX_FONTS[id]; }
  if (choice && choice !== 'auto' && DOCX_FONTS[choice]) return { font: DOCX_FONTS[choice], detected };
  return { font: detected || DOCX_FONTS.Tahoma, detected };
}

/** "Chrome-style" bold detection helper for PDF font objects + names. */
export const isBoldName = (name) => classifyFont(name).bold;
