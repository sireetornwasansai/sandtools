import { h, svgIcon } from '../core/dom.js';
import { ICONS } from '../core/icons.js';
import { TOOLS } from '../core/routes.js';
import { privacyNotice, notice } from '../core/notices.js';
import { recording, recordingNote } from '../core/logger.js';
import { openPalette } from '../core/palette.js';
import { getSession } from '../core/auth.js';
import { backendConfigured } from '../core/api.js';
import { loadCss } from '../core/css.js';
import { mountProjectsPanel } from './projects.js';

/* The 3D floor is loaded lazily so a stale/mismatched cached module can never take the whole home page down.
 * If the import fails (typically "does not provide an export named …" after a partial deploy or an old service-worker cache)
 * we clear the service worker + Cache Storage once and reload; if it still fails we show a readable message instead of a blank page. */
async function healCaches() {
  try { const regs = (await (navigator.serviceWorker && navigator.serviceWorker.getRegistrations())) || []; await Promise.all(regs.map((r) => r.unregister())); } catch { /* ignore */ }
  try { const keys = await caches.keys(); await Promise.all(keys.filter((k) => !k.startsWith('ocr-assets-')).map((k) => caches.delete(k))); } catch { /* ignore */ }
}
async function mountFloorSafe(host, opts) {
  let mod;
  try { mod = await import('./site-sim.js'); }
  catch (e) {
    console.error('[site-sim] load failed', e);
    let tried = false; try { tried = sessionStorage.getItem('sand-heal') === '1'; } catch { /* ignore */ }
    if (!tried) { try { sessionStorage.setItem('sand-heal', '1'); } catch { /* ignore */ } await healCaches(); location.reload(); return () => {}; }
    host.append(notice('warn', 'โหลดผัง 3 มิติไม่สำเร็จ', `ไฟล์บนเซิร์ฟเวอร์ยังเป็นคนละเวอร์ชัน — อัปโหลด site-engine.js, site-sim.js, site-rooms.js, site-deco.js และ site3d.css ให้ครบชุดเดียวกัน แล้วกด Ctrl+Shift+R (${String(e && e.message || e).slice(0, 140)})`));
    return () => {};
  }
  try { sessionStorage.removeItem('sand-heal'); } catch { /* ignore */ }
  return mod.mountSiteFloor(host, opts);
}

/**
 * Home = 3D floor of the projects and websites you monitor.
 *  1. paint the shell + tool tiles immediately (no network)
 *  2. mount the 3D floor (site-sim.js): last cached numbers first, then ONE call `projects/floor` (cached 60 s on the server); sample data when signed out
 *  3. below it the projects panel (search · cards · create · detail drawer); clicking a station on the floor opens that project's drawer
 * Replaces the previous "ภาพรวมการใช้งาน" statistics dashboard — its numbers (page views, visitors, online now, peak hour, insights, CSV) now live in the floor's own panels.
 */
function greeting(user) {
  const hr = (new Date().getUTCHours() + 7) % 24; const g = hr < 12 ? 'สวัสดีตอนเช้า' : hr < 17 ? 'สวัสดีตอนบ่าย' : 'สวัสดีตอนเย็น';
  const name = user && (user.name || user.email) ? String(user.name || user.email).split(/[\s@]/)[0] : '';
  return name ? `${g} คุณ${name}` : g;
}

export async function mount(root) {
  const sess = getSession(); const logged = !!sess;
  await Promise.all([loadCss('dashboard'), loadCss('site3d'), ...(logged ? [loadCss('links'), loadCss('projects')] : [])]);

  /* ---------------------------------- hero + tools (no network) ---------------------------------- */
  const today = new Date().toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const hero = h('section', { class: 'dsh-hero' },
    h('div', null, h('p', { class: 'dsh-eyebrow' }, today), h('h1', null, greeting(sess && sess.user)),
      h('p', { class: 'dsh-sub' }, logged ? 'ดูว่าวันนี้ใครเข้าเว็บไซต์และระบบของหน่วยงานบ้าง — ไม่เก็บ IP และไม่ใช้คุกกี้' : 'เครื่องมือดิจิทัลสำหรับงานสำนักงาน และผังสถิติเว็บไซต์ของหน่วยงานแบบ 3 มิติ')),
    h('div', { class: 'dsh-hero-actions' },
      h('button', { class: 'btn', type: 'button', onclick: openPalette }, svgIcon(ICONS.search, 18), 'ค้นหาเครื่องมือ'),
      h('a', { class: 'btn btn-primary', href: '#/qr' }, svgIcon(ICONS.qr, 18), 'สร้าง QR Code')));
  const toolStrip = h('nav', { class: 'dsh-tools', 'aria-label': 'เครื่องมือ' }, TOOLS.map((t) => h('a', { class: 'dsh-tool', href: `#${t.path}`, title: t.desc }, svgIcon(t.icon, 22), h('span', null, h('b', null, t.title), h('small', null, t.desc)))));

  const floorHost = h('div', { class: 'dsh-floor' }); const prjHost = h('div', { class: 'dsh-prj' });
  const projects = h('section', { class: 'dsh-sec', id: 'dsh-projects', 'aria-labelledby': 'dsh-t2' },
    h('div', { class: 'dsh-sec-head' }, h('div', null, h('h2', { id: 'dsh-t2' }, 'โครงการและเว็บไซต์'), h('p', { class: 'dsh-sub' }, 'แนบเว็บไซต์หรือระบบของหน่วยงาน แล้วดูว่ามีคนเข้าใช้กี่ครั้ง ช่วงไหนคนเข้ามากสุด'))), prjHost);
  const page = h('div', { class: 'page page-wide dash' }, hero, toolStrip, floorHost);
  root.append(page);

  if (!logged) {
    page.append(notice('info', 'เข้าสู่ระบบเพื่อดูโครงการจริงของคุณ', backendConfigured() ? 'ผังด้านบนเป็นข้อมูลตัวอย่าง เมื่อล็อกอินแล้วจะแสดงสถิติผู้เข้าชมเว็บไซต์ของหน่วยงานคุณแบบเรียลไทม์' : 'ผังด้านบนเป็นข้อมูลตัวอย่าง — ตั้งค่า Backend (Apps Script) เพื่อดูข้อมูลจริง'),
      privacyNotice({ detail: recording() ? `เครื่องมือทำงานในเบราว์เซอร์ของคุณ · ${recordingNote()}` : 'เครื่องมือทำงานในเบราว์เซอร์ของคุณ ไฟล์ไม่ถูกอัปโหลด' }));
    let stopDemo = () => {}; let gone = false;
    mountFloorSafe(floorHost).then((st) => { stopDemo = st; if (gone) st(); });
    return () => { gone = true; stopDemo(); };
  }

  page.append(projects, privacyNotice({ detail: 'สถิติไม่ใช้คุกกี้ ไม่เก็บ IP ไม่นับบอท และไม่นับผู้ที่เปิด Do-Not-Track' }));
  const panel = mountProjectsPanel(prjHost);
  let stopFloor = () => {}; let gone = false;
  mountFloorSafe(floorHost, { onOpen: (key) => panel && panel.open(key) }).then((st) => { stopFloor = st; if (gone) st(); });
  return () => { gone = true; stopFloor(); if (panel) panel(); };
}
