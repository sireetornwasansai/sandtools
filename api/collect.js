// Vercel Edge Function: POST/GET /api/collect — receives page views and events from the tracker (/t.js) or the 1×1 pixel,
// adds country/device/browser/OS and a one-way DAILY visitor hash, then forwards ONE anonymous record to the Apps Script
// backend in the background. The IP address and the full User-Agent never leave this function. Responds immediately.
// Also takes LOG lines (t=lg, POST only) for the Monitor page: c = er | lg | tk, v = level, e = name/task, m = message, s = task status, d = ms, x = extra.
// A website's SERVER (Apps Script UrlFetchApp) has no Origin header, so it says its own host in h (the backend checks it against the allowed domains).
// Free text is scrubbed here and again in Apps Script (no query strings, e-mails, phones, long numbers, token-like strings).
// Environment variables: SAND_GAS_URL, SAND_EDGE_SECRET
import { parseUa } from './go.js';

export const config = { runtime: 'edge' };

const KEY_RE = /^p[a-z0-9]{9}$/;
const ROLE_OK = new Set(['admin', 'head', 'officer', 'committee', 'researcher', 'user']);   // role WORDS a website may report; never a name or an id
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, GET, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' };
const LEVELS = new Set(['info', 'warn', 'error']);
const KINDS = new Set(['er', 'lg', 'tk']);
const TASK_STATUS = new Set(['start', 'ok', 'fail']);
const GIF = Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), (c) => c.charCodeAt(0));

async function sha(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join('');
}
const bangkokDay = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const str = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max);
/** Pure: free text from a website → safe to keep (same rules as anaScrub in Analytics.gs). */
export function scrub(v, max = 300) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/https?:\/\/[^\s"'<>)\]]+/gi, (u) => u.replace(/[?#].*$/, ''))
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+/g, '[อีเมล]')
    .replace(/\b0\d{1,2}[- ]?\d{3}[- ]?\d{4}\b/g, '[เบอร์]')
    .replace(/\b\d-\d{4}-\d{5}-\d{2}-\d\b/g, '[เลข]')
    .replace(/\b\d{7,}\b/g, '[เลข]')
    .replace(/\b[A-Za-z0-9_-]{28,}\b/g, '[รหัส]')
    .replace(/\s+/g, ' ').trim().slice(0, max);
}
const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } };

/** Pure: turns a request + parsed fields into the record sent to Apps Script (or null if it must be dropped). */
export async function buildHit(request, f, secret) {
  const h = request.headers;
  if (h.get('dnt') === '1' || h.get('sec-gpc') === '1') return null;                  // respect Do-Not-Track / Global Privacy Control
  if (!KEY_RE.test(String(f.k || ''))) return null;
  const ua = h.get('user-agent') || ''; const p = parseUa(ua);
  const ip = (h.get('x-forwarded-for') || h.get('x-real-ip') || '').split(',')[0].trim();
  const type = f.t === 'ev' ? 'ev' : f.t === 'lg' ? 'lg' : 'pv';
  if (type === 'lg' && request.method !== 'POST') return null;                       // never through the 1×1 pixel
  const origin = hostOf(h.get('origin') || '');
  let host = origin || hostOf(h.get('referer') || '');
  const srv = type === 'lg' && !host && !!f.h;                                        // sent by a website's server
  if (srv) host = hostOf(`https://${str(f.h, 100)}`);
  const country = (h.get('x-vercel-ip-country') || '').toUpperCase();
  let path = str(f.p, 200); if (path && path[0] !== '/') path = `/${path}`;
  const log = type === 'lg' ? {
    kind: KINDS.has(f.c) ? f.c : 'lg', lv: LEVELS.has(f.v) ? f.v : '', msg: scrub(f.m, 300), st: TASK_STATUS.has(f.s) ? f.s : '', ms: Math.max(0, Math.min(86400000, Math.round(Number(f.d) || 0))), x: scrub(f.x, 300)
  } : {};
  if (type === 'lg' && !scrub(f.e, 60) && !log.msg) return null;
  return {
    action: 'hit', secret, k: f.k, t: type, p: path || '/', e: type !== 'pv' ? (type === 'lg' ? scrub(f.e, 60) : str(f.e, 60)) : '', host, src: srv ? 'srv' : request.method === 'GET' ? 'px' : 'js', ...log,
    role: ROLE_OK.has(f.o) ? f.o : '', ref: str(f.r, 80).toLowerCase().replace(/^www\./, ''), utm: str(f.u, 40), lang: str(f.l, 12).slice(0, 12), w: Number(f.w) || 0,
    country: /^[A-Z]{2}$/.test(country) ? country : '', device: srv ? 'server' : p.device, browser: srv ? '' : p.browser, os: srv ? '' : p.os, bot: srv ? false : p.bot,
    vid: !srv && (ip || ua) ? await sha(`${secret}|${bangkokDay()}|${f.k}|${ip}|${ua}`) : ''
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
