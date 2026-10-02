// Runs before first paint to avoid a theme flash. Kept tiny and dependency-free.
(function () {
  try {
    var raw = localStorage.getItem('sand:settings');
    var theme = (raw && JSON.parse(raw).theme) || 'system';
    var dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  } catch (e) { /* storage unavailable: keep default light */ }
})();
