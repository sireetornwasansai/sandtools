// Vercel Edge Function: POST /api/telegram — the Telegram bot webhook for หนังสือรับเข้า (Inbox).
//
// SILENT BY DESIGN: this function never calls the Telegram API and never answers with a "method" body, so the bot can not post, reply or
// react in the group. Telegram only receives an empty 200. The bot only LISTENS (privacy mode off / admin in a channel).
//
// 1. checks Telegram's secret header (set with setWebhook secret_token)      → anything else gets 401 and is dropped
// 2. keeps only chats listed in SAND_TG_CHATS (comma-separated chat ids)      → a bot added to a stranger's group is ignored
// 3. keeps only messages that carry a link or a file, trims them to the few fields the inbox needs (no sender name, no phone, no photo)
// 4. forwards ONE small record to Apps Script (action "tg") in the background.
// Environment variables: SAND_GAS_URL, SAND_EDGE_SECRET, SAND_TG_WEBHOOK_SECRET, SAND_TG_CHATS
export const config = { runtime: 'edge' };

const OK = () => new Response(null, { status: 200, headers: { 'cache-control': 'no-store' } });
const str = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, max);

function same(a, b) {                                                           // constant-time compare
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || !a) return false;
  let r = 0; for (let i = 0; i < a.length; i += 1) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** Pure: Telegram update → the slim record Apps Script needs, or null when the update must be ignored. */
export function slim(update, allowed) {
  const m = update && (update.message || update.channel_post || update.edited_message || update.edited_channel_post);
  if (!m || !m.chat || m.chat.id === undefined) return null;
  if (!allowed.has(String(m.chat.id))) return null;
  const text = str(m.text || m.caption || '', 3500);
  const ents = (m.entities || m.caption_entities || []);
  const urls = [];
  for (const e of ents) {
    if (e.type === 'text_link' && e.url) urls.push(str(e.url, 600));
    else if (e.type === 'url') urls.push(str((m.text || m.caption || '').slice(e.offset, e.offset + e.length), 600));
    if (urls.length >= 6) break;
  }
  const d = m.document;
  const doc = d && d.file_id ? { file_id: str(d.file_id, 200), file_name: str(d.file_name || '', 120), size: Number(d.file_size) || 0 } : null;
  if (!urls.length && !doc && !/https?:\/\//i.test(text)) return null;          // nothing a letter could be
  return { chat: { id: m.chat.id, title: str(m.chat.title || '', 120) }, mid: Number(m.message_id) || 0, date: Number(m.date) || 0, text, urls, doc };
}

export default async function handler(request, context) {
  if (request.method !== 'POST') return OK();
  const want = process.env.SAND_TG_WEBHOOK_SECRET || '';
  if (!want || !same(request.headers.get('x-telegram-bot-api-secret-token') || '', want)) return new Response(null, { status: 401 });
  const gas = process.env.SAND_GAS_URL; const secret = process.env.SAND_EDGE_SECRET || '';
  const allowed = new Set(String(process.env.SAND_TG_CHATS || '').split(/[,\s]+/).filter(Boolean));
  if (!gas || !secret || !allowed.size) return OK();

  let update = null;
  try { const text = await request.text(); if (text.length <= 200000) update = JSON.parse(text); } catch { update = null; }
  const u = slim(update, allowed);
  if (!u) return OK();

  const job = (async () => {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 25000);
    try { await fetch(gas, { method: 'POST', headers: { 'content-type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'tg', secret, u }), redirect: 'follow', signal: ctrl.signal }); } finally { clearTimeout(t); }
  })().catch(() => {});
  if (context && typeof context.waitUntil === 'function') context.waitUntil(job); else await Promise.race([job, new Promise((r) => setTimeout(r, 1500))]);
  return OK();                                                                   // empty 200: Telegram sees no reply, the group sees nothing
}
