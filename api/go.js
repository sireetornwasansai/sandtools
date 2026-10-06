// Vercel Edge Function: GET /s/<code>  →  302 to the target, and records the visit (without storing any IP address).
//   1. asks the Apps Script backend to resolve the code (cached there, so it is fast)
//   2. redirects immediately
//   3. in the background (waitUntil) posts one anonymous click record: country, device class, browser, OS, referring host
//      and a salted one-way hash of IP+User-Agent that is only used to count unique visitors.
// Environment variables (Vercel → Settings → Environment Variables):  SAND_GAS_URL, SAND_EDGE_SECRET
export const config = { runtime: 'edge' };

const CODE_RE = /^[a-z0-9_-]{3,32}$/;
const BOT_RE = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|quora|pinterest|vkshare|whatsapp|telegram|discord|slack|skype|line-poker|linebot|curl|wget|python-requests|httpclient|go-http|okhttp|java\/|libwww|headless|lighthouse|monitor|uptime|pingdom|google-read-aloud|bingpreview|yandex/i;

export function parseUa(ua = '') {
  const s = String(ua);
  const bot = !s || BOT_RE.test(s);
  const device = bot ? 'bot' : /ipad|tablet|(android(?!.*mobile))/i.test(s) ? 'tablet' : /mobi|iphone|ipod|android|windows phone/i.test(s) ? 'mobile' : 'desktop';
  const browser = /line\//i.test(s) ? 'LINE' : /fb_iab|fban|fbav/i.test(s) ? 'Facebook' : /edg(e|a|ios)?\//i.test(s) ? 'Edge' : /opr\/|opera/i.test(s) ? 'Opera' : /samsungbrowser/i.test(s) ? 'Samsung' : /firefox|fxios/i.test(s) ? 'Firefox' : /chrome|crios/i.test(s) ? 'Chrome' : /safari/i.test(s) ? 'Safari' : 'Other';
  const os = /windows nt/i.test(s) ? 'Windows' : /iphone|ipad|ipod|ios/i.test(s) ? 'iOS' : /android/i.test(s) ? 'Android' : /mac os x|macintosh/i.test(s) ? 'macOS' : /cros/i.test(s) ? 'ChromeOS' : /linux/i.test(s) ? 'Linux' : 'Other';
  return { bot, device, browser, os };
}

async function sha(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join(''); // 12 hex chars
}

export async function visitorMeta(request, secret) {
  const h = request.headers; const ua = h.get('user-agent') || '';
  const ip = (h.get('x-forwarded-for') || h.get('x-real-ip') || '').split(',')[0].trim();
  let ref = ''; try { const r = h.get('referer'); if (r) ref = new URL(r).hostname.replace(/^www\./, ''); } catch { /* none */ }
  const country = (h.get('x-vercel-ip-country') || '').toUpperCase();
  const p = parseUa(ua);
  return { country: /^[A-Z]{2}$/.test(country) ? country : '', device: p.device, browser: p.browser, os: p.os, bot: p.bot, ref, vid: ip || ua ? await sha(`${secret}|${ip}|${ua}`) : '' };
}

const REASONS = {
  notfound: [404, 'ไม่พบลิงก์นี้', 'ลิงก์อาจพิมพ์ผิด หรือถูกลบไปแล้ว'],
  disabled: [410, 'ลิงก์นี้ถูกปิดใช้งาน', 'เจ้าของลิงก์ปิดการใช้งานชั่วคราว กรุณาติดต่อผู้ส่งลิงก์'],
  expired: [410, 'ลิงก์นี้หมดอายุแล้ว', 'กรุณาติดต่อผู้ส่งลิงก์เพื่อขอลิงก์ใหม่'],
  error: [503, 'ระบบไม่พร้อมใช้งานชั่วคราว', 'กรุณาลองใหม่อีกครั้งในอีกสักครู่']
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function errorPage(reason) {
  const [status, title, text] = REASONS[reason] || REASONS.notfound;
  const html = `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;padding:1rem;font-family:"Noto Sans Thai",Sarabun,"Leelawadee UI",Tahoma,system-ui,sans-serif;background:#f6f7fb;color:#111827}
.c{max-width:420px;text-align:center;background:#fff;border:1px solid #e5e7eb;border-radius:20px;padding:2.4rem 2rem;box-shadow:0 16px 40px -8px rgba(16,24,40,.15)}
.i{width:64px;height:64px;margin:0 auto 1rem;border-radius:18px;display:grid;place-items:center;font-size:30px;background:#eff3ff;color:#3758f9}h1{margin:0 0 .4rem;font-size:1.4rem}p{margin:0 0 1.4rem;color:#6b7280;line-height:1.6}
a{display:inline-block;padding:.6rem 1.2rem;border-radius:10px;background:#3758f9;color:#fff;text-decoration:none;font-weight:500}@media(prefers-color-scheme:dark){body{background:#0b0f19;color:#f3f4f6}.c{background:#111827;border-color:#243044}p{color:#9ca3af}}</style></head>
<body><main class="c"><div class="i">${status === 503 ? '!' : '🔗'}</div><h1>${esc(title)}</h1><p>${esc(text)}</p><a href="/">ไปที่หน้าแรก</a></main></body></html>`;
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
}

async function gasJson(url, init, ms) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), ms);
  try { const r = await fetch(url, { ...init, redirect: 'follow', signal: ctrl.signal }); return await r.json(); } finally { clearTimeout(t); }
}

export default async function handler(request, context) {
  const url = new URL(request.url);
  const code = (url.searchParams.get('c') || url.pathname.split('/').filter(Boolean).pop() || '').toLowerCase();
  const gas = process.env.SAND_GAS_URL; const secret = process.env.SAND_EDGE_SECRET || '';
  if (!CODE_RE.test(code)) return errorPage('notfound');
  if (!gas) return errorPage('error');
  let res;
  try { res = await gasJson(`${gas}${gas.includes('?') ? '&' : '?'}action=go&c=${encodeURIComponent(code)}`, { method: 'GET' }, 6000); } catch { return errorPage('error'); }
  if (!res || res.success !== true) return errorPage('error');
  const d = res.data || {};
  let target = '';
  try { const u = new URL(d.url); if (u.protocol === 'http:' || u.protocol === 'https:') target = u.href; } catch { /* invalid */ }
  if (!target) return errorPage(d.reason || 'notfound');

  if (request.method === 'GET' && secret) {
    const job = visitorMeta(request, secret).then((meta) => gasJson(gas, { method: 'POST', headers: { 'content-type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'click', secret, code, ...meta }) }, 10000)).catch(() => {});
    if (context && typeof context.waitUntil === 'function') context.waitUntil(job); else await Promise.race([job, new Promise((r) => setTimeout(r, 1500))]);
  }
  return new Response(null, { status: 302, headers: { location: target, 'cache-control': 'no-store, max-age=0', 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex' } });
}
