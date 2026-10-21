// Vercel Edge Function: POST /api/line — the LINE Messaging API webhook for the HR notifications (rich-menu "สัปดาห์นี้ใครลา" / "สัปดาห์หน้าใครลา").
//
// Why a relay instead of pointing LINE straight at Apps Script: a Google Apps Script web app cannot read the X-Line-Signature header, so it could not
// tell a real LINE call from a forged one. Here the signature (HMAC-SHA256 of the raw body with the channel secret) is checked first.
//
// 1. verifies X-Line-Signature                                   → anything else gets 401 and is dropped
// 2. keeps only the few fields the backend needs (no profile, no stickers, no images), max 20 events per call
// 3. answers LINE with an empty 200 at once and forwards the slim events to Apps Script (action "line") in the background
//    (Apps Script replies to the user itself with the reply token, which costs no message quota)
// Environment variables: SAND_GAS_URL, SAND_EDGE_SECRET (both already used by the other edge functions), SAND_LINE_CHANNEL_SECRET (new)
//
// Troubleshooting "Verify → 401": the only 401 this function returns is a signature mismatch. The reason is in the response header  x-sand-reason
//   no-secret      SAND_LINE_CHANNEL_SECRET is empty in the deployment that answered (not set for Production, or set but NOT redeployed — Vercel applies variables only to NEW deployments)
//   bad-secret     the value is set but is not a LINE channel secret (a channel secret is exactly 32 hex characters — the access token / another channel's secret was pasted)
//   no-signature   the call carries no X-Line-Signature (not from LINE)
//   bad-signature  well-formed secret, wrong value (secret of another channel / old secret / a hidden space or line break was copied with it)
// Open  https://<domain>/api/line  in a browser (GET) to see a safe self-check: which variables exist and whether the secret has the right shape.
export const config = { runtime: 'edge' };

const OK = () => new Response(null, { status: 200, headers: { 'cache-control': 'no-store' } });
const str = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, max);
const BATCH = 6;
const JSON_HEAD = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
/** Variables pasted into Vercel often carry a trailing space / line break or surrounding quotes — none of them is ever part of a real secret. */
const clean = (v) => String(v == null ? '' : v).trim().replace(/^(["'])(.*)\1$/s, '$2').trim();
const looksLikeChannelSecret = (v) => /^[0-9a-f]{32}$/i.test(v);                                                   // events per request to Apps Script (its body limit is 8 KB)

function same(a, b) {                                              // constant-time compare
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || !a) return false;
  let r = 0; for (let i = 0; i < a.length; i += 1) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** Pure: is `signature` the base64 HMAC-SHA256 of `bodyBytes` under `secret`? */
export async function verifySignature(secret, bodyBytes, signature) {
  if (!secret || !signature) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, bodyBytes));
  let bin = ''; for (const b of mac) bin += String.fromCharCode(b);
  return same(btoa(bin), signature);
}

/** Pure: LINE webhook body → the slim events Apps Script understands (text / postback / follow / unfollow / join only, active mode only). */
export function slim(body) {
  const events = body && Array.isArray(body.events) ? body.events : [];
  const out = [];
  for (const e of events.slice(0, 20)) {
    if (!e || typeof e !== 'object' || (e.mode && e.mode !== 'active')) continue;
    const s = e.source || {};
    const source = { type: str(s.type, 12), userId: str(s.userId, 60), groupId: str(s.groupId, 60), roomId: str(s.roomId, 60) };
    const base = { id: str(e.webhookEventId, 40), type: str(e.type, 12), replyToken: str(e.replyToken, 60), source };
    if (e.type === 'message') {
      if (!e.message || e.message.type !== 'text') continue;       // stickers, images … are ignored
      out.push({ ...base, text: str(e.message.text, 200) });
    } else if (e.type === 'postback') {
      if (!e.postback) continue;
      out.push({ ...base, data: str(e.postback.data, 200) });
    } else if (e.type === 'follow' || e.type === 'unfollow' || e.type === 'join') out.push(base);
  }
  return out;
}

/** Pure: why a call is refused (only the category — never any part of the secret or the signature). */
export async function refusal(secret, bodyBytes, signature) {
  if (!secret) return 'no-secret';
  if (!looksLikeChannelSecret(secret)) return 'bad-secret';
  if (!signature) return 'no-signature';
  return (await verifySignature(secret, bodyBytes, signature)) ? '' : 'bad-signature';
}

export default async function handler(request, context) {
  const channelSecret = clean(process.env.SAND_LINE_CHANNEL_SECRET);
  if (request.method === 'GET') {                                  // safe self-check for the admin: booleans only, nothing secret
    return new Response(JSON.stringify({ route: 'line', ok: true, secretSet: !!channelSecret, secretLooksValid: looksLikeChannelSecret(channelSecret),
      gasUrlSet: !!clean(process.env.SAND_GAS_URL), edgeSecretSet: !!clean(process.env.SAND_EDGE_SECRET), deployment: process.env.VERCEL_ENV || '' }), { status: 200, headers: JSON_HEAD });
  }
  if (request.method !== 'POST') return OK();
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > 200000) return new Response(null, { status: 413 });
  const why = await refusal(channelSecret, bytes, request.headers.get('x-line-signature') || '');
  if (why) return new Response(null, { status: 401, headers: { 'x-sand-reason': why, 'cache-control': 'no-store' } });

  let body = null;
  try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { body = null; }
  const events = slim(body);
  const gas = clean(process.env.SAND_GAS_URL); const secret = clean(process.env.SAND_EDGE_SECRET);
  if (!events.length || !gas || !secret) return OK();              // LINE's "Verify" button sends no events: 200 is the right answer

  const job = (async () => {
    for (let i = 0; i < events.length; i += BATCH) {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 25000);
      try { await fetch(gas, { method: 'POST', headers: { 'content-type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'line', secret, events: events.slice(i, i + BATCH) }), redirect: 'follow', signal: ctrl.signal }); } finally { clearTimeout(t); }
    }
  })().catch(() => {});
  if (context && typeof context.waitUntil === 'function') context.waitUntil(job); else await Promise.race([job, new Promise((r) => setTimeout(r, 1500))]);
  return OK();
}