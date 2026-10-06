// Loads a page stylesheet (css/<name>.css) once and resolves when it is ready (or after 1.5 s).
import { h } from './dom.js';

export function loadCss(name) {
  const id = `${name}-css`;
  if (document.getElementById(id)) return Promise.resolve();
  return new Promise((resolve) => {
    const l = h('link', { id, rel: 'stylesheet', href: `css/${name}.css` });
    l.addEventListener('load', () => resolve(), { once: true }); l.addEventListener('error', () => resolve(), { once: true });
    document.head.append(l); setTimeout(resolve, 1500);
  });
}
