// Helper for the Telegram intake of หนังสือรับเข้า. Run from your own computer (the token never goes into the repository).
//   TG_BOT_TOKEN=123:abc node scripts/telegram-webhook.mjs chats                      list the groups the bot has seen (before the webhook is set)
//   TG_BOT_TOKEN=… SAND_TG_WEBHOOK_SECRET=… node scripts/telegram-webhook.mjs set https://your-site.example/api/telegram
//   TG_BOT_TOKEN=… node scripts/telegram-webhook.mjs info                              show the webhook state / last error
//   TG_BOT_TOKEN=… node scripts/telegram-webhook.mjs remove                            stop the intake
// These commands only configure Telegram's delivery of updates to us. None of them sends a message to any chat.
const [cmd, arg] = process.argv.slice(2);
const token = process.env.TG_BOT_TOKEN;
if (!token || !cmd) { console.error('ใช้: TG_BOT_TOKEN=… node scripts/telegram-webhook.mjs chats | set <url> | info | remove'); process.exit(1); }
const api = async (method, body) => {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  const j = await res.json().catch(() => ({}));
  if (!j.ok) throw new Error(`${method}: ${j.description || res.status}`);
  return j.result;
};
try {
  if (cmd === 'chats') {
    const ups = await api('getUpdates', { timeout: 0, allowed_updates: ['message', 'channel_post'] });
    const seen = new Map();
    for (const u of ups) { const c = (u.message || u.channel_post || {}).chat; if (c) seen.set(c.id, `${c.type} · ${c.title || c.username || ''}`); }
    if (!seen.size) console.log('ยังไม่เห็นแชทใด — ให้ใครสักคนพิมพ์ข้อความในกลุ่ม 1 ข้อความ (บอทต้องปิด Privacy Mode แล้ว) แล้วรันใหม่');
    for (const [id, name] of seen) console.log(`${id}\t${name}`);
  } else if (cmd === 'set') {
    const secret = process.env.SAND_TG_WEBHOOK_SECRET;
    if (!arg || !/^https:\/\//.test(arg)) throw new Error('ระบุ URL แบบ https://…/api/telegram');
    if (!secret || !/^[A-Za-z0-9_-]{16,256}$/.test(secret)) throw new Error('SAND_TG_WEBHOOK_SECRET ต้องเป็น A-Z a-z 0-9 _ - ยาว 16 ตัวขึ้นไป');
    await api('setWebhook', { url: arg, secret_token: secret, allowed_updates: ['message', 'channel_post'], max_connections: 5, drop_pending_updates: false });
    console.log('ตั้ง webhook แล้ว:', arg);
  } else if (cmd === 'info') {
    const i = await api('getWebhookInfo'); console.log({ url: i.url, pending: i.pending_update_count, lastError: i.last_error_message || null, lastErrorAt: i.last_error_date ? new Date(i.last_error_date * 1000).toISOString() : null });
  } else if (cmd === 'remove') { await api('deleteWebhook', { drop_pending_updates: false }); console.log('ลบ webhook แล้ว'); }
  else throw new Error('คำสั่งไม่ถูกต้อง');
} catch (e) { console.error(String(e.message).replace(token, '***')); process.exit(1); }
