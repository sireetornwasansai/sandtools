// Vercel Edge Function: POST/GET /api/collect — receives page views and events from the tracker (/t.js) or the 1×1 pixel,
// adds country/device/browser/OS and a one-way DAILY visitor hash, then forwards ONE anonymous record to the Apps Script
// backend in the background. The IP address and the full User-Agent never leave this function. Responds immediately.
// Environment variables: SAND_GAS_URL, SAND_EDGE_SECRET
import { parseUa } from './go.js';

export const config = { runtime: 'edge' };

const KEY_RE = /^p[a-z0-9]{9}$/;
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, GET, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' };
const GIF = Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), (c) => c.charCodeAt(0));

async function sha(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join('');
}
const bangkokDay = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const str = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max);
const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } };

/** Pure: turns a request + parsed fields into the record sent to Apps Script (or null if it must be dropped). */
export async function buildHit(request, f, secret) {
  const h = request.headers;
  if (h.get('dnt') === '1' || h.get('sec-gpc') === '1') return null;                  // respect Do-Not-Track / Global Privacy Control
  if (!KEY_RE.test(String(f.k || ''))) return null;
  const ua = h.get('user-agent') || ''; const p = parseUa(ua);
  const ip = (h.get('x-forwarded-for') || h.get('x-real-ip') || '').split(',')[0].trim();
  const origin = hostOf(h.get('origin') || '');
  const host = origin || hostOf(h.get('referer') || '');
  const country = (h.get('x-vercel-ip-country') || '').toUpperCase();
  let path = str(f.p, 200); if (path && path[0] !== '/') path = `/${path}`;
  const type = f.t === 'ev' ? 'ev' : 'pv';
  return {
    action: 'hit', secret, k: f.k, t: type, p: path || '/', e: type === 'ev' ? str(f.e, 60) : '', host, src: request.method === 'GET' ? 'px' : 'js',
    ref: str(f.r, 80).toLowerCase().replace(/^www\./, ''), utm: str(f.u, 40), lang: str(f.l, 12).slice(0, 12), w: Number(f.w) || 0,
    country: /^[A-Z]{2}$/.test(country) ? country : '', device: p.device, browser: p.browser, os: p.os, bot: p.bot,
    vid: ip || ua ? await sha(`${secret}|${bangkokDay()}|${f.k}|${ip}|${ua}`) : ''
  };
}

export default async function handler(request, context) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const gas = process.env.SAND_GAS_URL; const secret = process.env.SAND_EDGE_SECRET || '';
  const url = new URL(request.url); let fields = {}; let pixel = false;
  try {
    if (request.method === 'POST') { const text = await request.text(); if (text.length <= 2048) fields = JSON.parse(text); }
    else if (request.method === 'GET') { pixel = true; for (const [k, v] of url.searchParams) fields[k] = v; }
  } catch { fields = {}; }
  const done = () => (pixel
    ? new Response(GIF, { status: 200, headers: { ...CORS, 'content-type': 'image/gif', 'cache-control': 'no-store, max-age=0' } })
    : new Response(null, { status: 204, headers: { ...CORS, 'cache-control': 'no-store' } }));
  if (!gas || !secret || request.method === 'HEAD') return done();

  const job = buildHit(request, fields, secret).then(async (hit) => {
    if (!hit || hit.bot) return;                                                      // robots are never forwarded
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 10000);
    try { await fetch(gas, { method: 'POST', headers: { 'content-type': 'text/plain;charset=utf-8' }, body: JSON.stringify(hit), redirect: 'follow', signal: ctrl.signal }); } finally { clearTimeout(t); }
  }).catch(() => {});
  if (context && typeof context.waitUntil === 'function') context.waitUntil(job); else await Promise.race([job, new Promise((r) => setTimeout(r, 1500))]);
  return done();
}
