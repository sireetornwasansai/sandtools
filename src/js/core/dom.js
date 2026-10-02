/**
 * Tiny hyperscript helper. Never uses innerHTML, so values are always treated as text.
 * @param {string} tag
 * @param {Record<string, any>|null} [props]
 * @param {...any} children
 * @returns {any} a DOM element (typed loosely: callers set .value, .files, .dataset etc.)
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'onclick' && typeof v === 'function') el.addEventListener('click', (e) => { const r = v(e); if (r && typeof r.then === 'function') trackBusy(el, r); });
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') /** @type {any} */ (el)[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

/** @param {HTMLElement} el @param {any[]} children */
export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** Replace all children of an element. */
export function setChildren(el, ...children) { el.replaceChildren(); append(el, children); return el; }

/** @param {string} svgInner @param {number} [size] */
export function svgIcon(svgInner, size = 20) {
  const wrap = document.createElement('span');
  wrap.className = 'icon';
  wrap.setAttribute('aria-hidden', 'true');
  wrap.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" focusable="false">${svgInner}</svg>`;
  return wrap;
}

let uid = 0;
/** Unique id for label/aria wiring. */
export function nextId(prefix = 'id') { uid += 1; return `${prefix}-${uid}`; }

/** Labelled form field: returns {root, input}. */
export function field(label, input, hint) {
  const id = input.id || nextId('f');
  input.id = id;
  const root = h('div', { class: 'field' }, h('label', { for: id }, label), input, hint ? h('p', { class: 'hint' }, hint) : null);
  return { root, input };
}

/** Debounce helper. */
export function debounce(fn, ms) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); fn(...a); };
  d.cancel = () => clearTimeout(t);
  return d;
}

/** Human readable file size. */
export function formatBytes(n) {
  if (!Number.isFinite(n)) return '-';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/** Lazy-load a classic script once. */
const scriptCache = new Map();
export function loadScript(src) {
  if (!scriptCache.has(src)) {
    scriptCache.set(src, new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = () => resolve(undefined);
      s.onerror = () => { scriptCache.delete(src); reject(new Error(`โหลดสคริปต์ไม่สำเร็จ: ${src}`)); };
      document.head.append(s);
    }));
  }
  return scriptCache.get(src);
}

/** Show a spinner on a button while an async click handler runs (applies to every h() button whose onclick returns a Promise). */
function trackBusy(el, promise) {
  if (!el.classList.contains('btn')) return;
  el.classList.add('is-loading'); el.setAttribute('aria-busy', 'true');
  const done = () => { el.classList.remove('is-loading'); el.removeAttribute('aria-busy'); };
  promise.then(done, done);
}
