// Creates the LINE rich menu (3 buttons: ลงลา/ไปราชการ [link] · สัปดาห์นี้ใครลา · ใครลาวันไหน). Run from your own computer — the token never goes into the repository.
//   LINE_CHANNEL_ACCESS_TOKEN=xxxx node scripts/line-richmenu.mjs create https://sandtools.vercel.app [path/to/image.png]
//   LINE_CHANNEL_ACCESS_TOKEN=xxxx node scripts/line-richmenu.mjs list
//   LINE_CHANNEL_ACCESS_TOKEN=xxxx node scripts/line-richmenu.mjs delete <richMenuId>
//   LINE_CHANNEL_ACCESS_TOKEN=xxxx node scripts/line-richmenu.mjs unset            (stop showing the menu; menus are kept)
// "create" makes the menu, uploads docs/line-richmenu.png (2500×843 — or your own image of that size, PNG/JPEG ≤ 1 MB) and makes it the default for everybody.
// The two "ใครลา" buttons send text, which the bot answers in the chat (no web login, no message quota); "ใครลาวันไหน" answers with a date picker. The first opens #/leave in the phone's own browser.
// Typed words still work too: สัปดาห์หน้าใครลา · วันนี้ใครลา · ใครลา 5 พ.ย. · ใครลาวันพุธ · สรุปลาเดือนนี้
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SIZE = { width: 2500, height: 843 };
export const TEXT_THIS = 'สัปดาห์นี้ใครลา';
export const TEXT_DAY = 'ใครลาวันไหน';

/** The rich-menu object LINE expects. Throws on anything LINE would reject, so a typo fails here and not half-way through. */
export function buildMenu(siteUrl) {
  let u;
  try { u = new URL(siteUrl); } catch { throw new Error('ต้องเป็น URL เช่น https://sandtools.vercel.app'); }
  if (u.protocol !== 'https:') throw new Error('LINE เปิดลิงก์ได้เฉพาะ https://');
  const leave = `${u.origin}/?openExternalBrowser=1#/leave`;       // openExternalBrowser: Google sign-in does not work inside LINE's own browser
  const w = Math.floor(SIZE.width / 3);
  const area = (i, action) => ({ bounds: { x: i * w, y: 0, width: i === 2 ? SIZE.width - 2 * w : w, height: SIZE.height }, action });
  return {
    size: SIZE, selected: true, name: 'SAND HR — ใครลา', chatBarText: 'เมนูลา',
    areas: [
      area(0, { type: 'uri', label: 'ลงลา / ไปราชการ', uri: leave }),
      area(1, { type: 'message', label: 'สัปดาห์นี้ใครลา', text: TEXT_THIS }),
      area(2, { type: 'message', label: 'ใครลาวันไหน', text: TEXT_DAY })
    ]
  };
}

const sniff = (b) => (b[0] === 0x89 && b[1] === 0x50 ? 'image/png' : b[0] === 0xff && b[1] === 0xd8 ? 'image/jpeg' : '');

async function main() {
  const [cmd, arg, imgArg] = process.argv.slice(2);
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token || !cmd) { console.error('ใช้: LINE_CHANNEL_ACCESS_TOKEN=… node scripts/line-richmenu.mjs create <https://โดเมน> [รูป.png] | list | delete <id> | unset'); process.exit(1); }
  const call = async (url, init = {}) => {
    const res = await fetch(url, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers || {}) } });
    const text = await res.text(); let j = {}; try { j = text ? JSON.parse(text) : {}; } catch { /* empty body */ }
    if (!res.ok) throw new Error(`${res.status} ${j.message || text || ''}`.trim());
    return j;
  };
  const json = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    if (cmd === 'create') {
      const menu = buildMenu(arg);
      const file = imgArg || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'line-richmenu.png');
      const bytes = fs.readFileSync(file); const type = sniff(bytes);
      if (!type) throw new Error('รูปต้องเป็น PNG หรือ JPEG');
      if (bytes.length > 1024 * 1024) throw new Error('รูปต้องไม่เกิน 1 MB');
      const { richMenuId } = await call('https://api.line.me/v2/bot/richmenu', json(menu));
      try {
        await call(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, { method: 'POST', headers: { 'content-type': type }, body: bytes });
        await call(`https://api.line.me/v2/bot/user/all/richmenu/${richMenuId}`, { method: 'POST' });
      } catch (e) { await call(`https://api.line.me/v2/bot/richmenu/${richMenuId}`, { method: 'DELETE' }).catch(() => {}); throw e; }   // no half-made menu left behind
      console.log('สร้างริชเมนูและตั้งเป็นค่าเริ่มต้นแล้ว:', richMenuId, '\nปุ่มลงลา →', menu.areas[0].action.uri);
    } else if (cmd === 'list') {
      const { richmenus = [] } = await call('https://api.line.me/v2/bot/richmenu/list');
      if (!richmenus.length) console.log('ยังไม่มีริชเมนู');
      for (const m of richmenus) console.log(`${m.richMenuId}\t${m.name}`);
    } else if (cmd === 'delete') {
      if (!/^richmenu-[0-9a-f]+$/.test(arg || '')) throw new Error('ระบุ richMenuId เช่น richmenu-abc123 (ดูจากคำสั่ง list)');
      await call(`https://api.line.me/v2/bot/richmenu/${arg}`, { method: 'DELETE' }); console.log('ลบแล้ว:', arg);
    } else if (cmd === 'unset') { await call('https://api.line.me/v2/bot/user/all/richmenu', { method: 'DELETE' }); console.log('เลิกใช้ริชเมนูเริ่มต้นแล้ว'); }
    else throw new Error('ไม่รู้จักคำสั่ง');
  } catch (e) { console.error(String(e.message).split(token).join('***')); process.exit(1); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
