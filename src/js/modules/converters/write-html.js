// Markdown → a standalone, self-contained HTML page (no external requests) and the shared document stylesheet.
import { renderMarkdown } from '../markdown-render.js';

const FONT = '"Leelawadee UI","Tahoma","Thonburi","Noto Sans Thai","Sarabun","Segoe UI",Arial,sans-serif';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Stylesheet scoped to `scope` (e.g. ".sand-doc"). Contains no "&" or "<" so it can sit inside XML/SVG unchanged. */
export function docCss(scope = 'body', { print = false } = {}) {
  const s = scope;
  return `${s}{font-family:${FONT};font-size:14px;line-height:1.65;color:#1b2033;overflow-wrap:anywhere;word-break:normal}
${s} > *{margin-top:0;margin-bottom:12px}
${s} h1,${s} h2,${s} h3,${s} h4,${s} h5,${s} h6{line-height:1.3;color:#1f2a5c;margin-bottom:8px;font-weight:700}
${s} h1{font-size:27px;margin-top:6px}${s} h2{font-size:21px;margin-top:10px}${s} h3{font-size:18px}${s} h4,${s} h5,${s} h6{font-size:15px}
${s} p{margin:0}${s} ul,${s} ol{padding-left:26px}${s} li{margin:2px 0}${s} li > ul,${s} li > ol{margin:2px 0}
${s} a{color:#2237ee;text-decoration:underline}
${s} blockquote{border-left:4px solid #9aa3b5;padding:2px 14px;color:#4a5368;margin-left:0;margin-right:0}
${s} code{font-family:Consolas,"Courier New",monospace;font-size:.9em;background:#f1f3f7;padding:1px 4px;border-radius:3px}
${s} pre{background:#f1f3f7;padding:10px 12px;border-radius:6px;white-space:pre-wrap;overflow-wrap:anywhere}${s} pre code{background:none;padding:0}
${s} table{border-collapse:collapse;width:100%;table-layout:auto;font-size:13px}
${s} th,${s} td{border:1px solid #9aa3b5;padding:5px 8px;text-align:left;vertical-align:top}
${s} th{background:#e8ecf4;font-weight:700}
${s} hr{border:0;border-top:1px solid #9aa3b5;margin:14px 0}
${s} img{max-width:100%}
${print ? '' : ''}`;
}

/** @param {string} md @param {{title?:string}} [o] @returns {string} full HTML document */
export function markdownToHtmlDoc(md, { title = 'document' } = {}) {
  const body = renderMarkdown(md, { remoteImages: false });
  return `<!doctype html>
<html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
body{margin:0;background:#f4f5f9}
.sand-doc{max-width:860px;margin:24px auto;background:#fff;padding:40px 48px;box-shadow:0 1px 4px rgb(0 0 0 / .12)}
@media print{body{background:#fff}.sand-doc{box-shadow:none;margin:0;max-width:none;padding:0}}
@media (max-width:640px){.sand-doc{padding:20px;margin:0}}
${docCss('.sand-doc')}
</style></head><body><main class="sand-doc">
${body}
</main></body></html>
`;
}
