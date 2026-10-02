import { getSettings } from './store.js';

const mq = window.matchMedia('(prefers-color-scheme: dark)');

/** Apply the theme from settings to <html>. */
export function applyTheme() {
  const t = getSettings().theme;
  const dark = t === 'dark' || (t === 'system' && mq.matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#0f1720' : '#0b2a4a');
}
export function initTheme() {
  applyTheme();
  mq.addEventListener('change', applyTheme);
  window.addEventListener('sand:settings', applyTheme);
}
export function isDark() { return document.documentElement.getAttribute('data-theme') === 'dark'; }
