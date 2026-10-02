import { Marked } from '../vendor/marked.esm.js';
import DOMPurify from '../vendor/purify.es.mjs';
import hljs from '../vendor/highlight.js';

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const marked = new Marked({ gfm: true, breaks: false });
marked.use({
  renderer: {
    code({ text, lang }) {
      const l = (lang || '').trim().split(/\s+/)[0];
      let body;
      if (l && hljs.getLanguage(l)) body = hljs.highlight(text, { language: l, ignoreIllegals: true }).value;
      else body = escapeHtml(text);
      return `<pre><code class="hljs${l ? ` language-${escapeHtml(l)}` : ''}">${body}\n</code></pre>`;
    }
  }
});

let allowRemote = false;
let hooked = false;
function installHooks() {
  if (hooked) return; hooked = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      const href = node.getAttribute('href') || '';
      if (/^https?:/i.test(href)) { node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer nofollow'); }
    }
    if (node.tagName === 'IMG') {
      const src = node.getAttribute('src') || '';
      if (/^https?:|^\/\//i.test(src) && !allowRemote) {
        node.setAttribute('data-blocked-src', src);
        node.removeAttribute('src');
        node.setAttribute('alt', `[รูปภาพภายนอกถูกบล็อกเพื่อความเป็นส่วนตัว] ${node.getAttribute('alt') || ''}`.trim());
      }
    }
    if (node.tagName === 'INPUT') { node.setAttribute('disabled', ''); }
  });
}

/**
 * Render Markdown to sanitized HTML. Remote images are blocked unless the user opts in (privacy).
 * @param {string} md @param {{remoteImages?:boolean}} [opts]
 */
export function renderMarkdown(md, opts = {}) {
  installHooks();
  allowRemote = Boolean(opts.remoteImages);
  const raw = /** @type {string} */ (marked.parse(md, { async: false }));
  return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'form', 'iframe', 'object', 'embed', 'script'], FORBID_ATTR: ['style', 'srcset'], ALLOW_DATA_ATTR: false });
}
