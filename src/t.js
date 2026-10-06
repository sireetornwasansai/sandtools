/*! SAND Office Tools — website statistics tracker. No cookies, no IP, no query strings.
 *  <script defer src="https://YOUR-DOMAIN/t.js" data-site="SITE_KEY"></script>
 *  Optional attributes:  data-dnt="off" (ignore Do-Not-Track)   data-local (also count localhost)   data-api="https://…/api/collect"
 *  Custom events:        sandTrack('ดาวน์โหลดแบบฟอร์ม')
 */
(function () {
  'use strict';
  var w = window, d = document, n = navigator, l = location;
  if (w.__sandTrack) return; w.__sandTrack = 1;
  var s = d.currentScript || d.querySelector('script[data-site][src*="t.js"]');
  if (!s) return;
  var key = s.getAttribute('data-site');
  if (!key || l.protocol === 'file:') return;
  if (s.getAttribute('data-dnt') !== 'off' && (n.doNotTrack === '1' || w.doNotTrack === '1' || n.msDoNotTrack === '1' || n.globalPrivacyControl === true)) return;
  if (/^(localhost|127\.|\[::1\]|0\.0\.0\.0)/.test(l.hostname) && !s.hasAttribute('data-local')) return;
  var api = s.getAttribute('data-api');
  if (!api) { var a = d.createElement('a'); a.href = s.src; api = a.protocol + '//' + a.host + '/api/collect'; }

  function path() {
    var p = l.pathname || '/';
    try { p = decodeURI(p); } catch (e) { /* keep encoded */ }
    if (/^#!?\//.test(l.hash)) p += l.hash.replace(/[?].*$/, '');
    return p.slice(0, 200);
  }
  function utm() { var m = /[?&]utm_source=([^&#]*)/.exec(l.search); try { return m ? decodeURIComponent(m[1]).slice(0, 40) : ''; } catch (e) { return ''; } }
  function ref() {
    if (!d.referrer) return '';
    var r = d.createElement('a'); r.href = d.referrer;
    return r.hostname && r.hostname !== l.hostname ? r.hostname.replace(/^www\./, '') : '';
  }
  function send(type, name, first) {
    var body = JSON.stringify({ k: key, t: type, p: path(), e: name || '', r: first ? ref() : '', u: first ? utm() : '', w: w.innerWidth || 0, l: n.language || '' });
    try { if (n.sendBeacon && n.sendBeacon(api, new Blob([body], { type: 'text/plain' }))) return; } catch (e) { /* fall through */ }
    try { fetch(api, { method: 'POST', body: body, headers: { 'Content-Type': 'text/plain' }, keepalive: true, mode: 'no-cors', credentials: 'omit' }); } catch (e) { /* ignore */ }
  }

  var last = '', firstView = true;
  function view() {
    var p = path(); if (p === last) return;
    last = p; send('pv', '', firstView); firstView = false;
  }
  function start() { if (d.visibilityState === 'prerender') { d.addEventListener('visibilitychange', start, { once: true }); return; } view(); }

  ['pushState', 'replaceState'].forEach(function (m) {
    var orig = w.history && w.history[m]; if (!orig) return;
    w.history[m] = function () { var r = orig.apply(this, arguments); setTimeout(view, 0); return r; };
  });
  w.addEventListener('popstate', function () { setTimeout(view, 0); });
  w.addEventListener('hashchange', function () { setTimeout(view, 0); });
  w.sandTrack = function (name) { if (name) send('ev', String(name).slice(0, 60), false); };
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', start); else start();
})();
