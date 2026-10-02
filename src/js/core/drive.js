// Google Drive integration (browser-side, least privilege).
//
// Scope: drive.file ONLY — the app can see just the files it created or that the user explicitly picks in the Picker.
// Access tokens live in memory only (never stored) and are requested on the user's click.
import { config } from './config.js';
import { loadScript } from './dom.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

export class DriveError extends Error { constructor(code, message) { super(message); this.code = code; } }
export function driveAvailable() { return Boolean(config.googleClientId); }

let tokenClient = null; let token = null; let tokenExp = 0;

async function accessToken() {
  if (token && Date.now() < tokenExp - 30_000) return token;
  await loadScript('https://accounts.google.com/gsi/client');
  return new Promise((resolve, reject) => {
    tokenClient = tokenClient || window.google.accounts.oauth2.initTokenClient({
      client_id: config.googleClientId, scope: SCOPE, callback: () => {},
      error_callback: (e) => reject(new DriveError(e && e.type === 'popup_closed' ? 'CANCELLED' : 'AUTH', 'ไม่ได้รับอนุญาตให้เข้าถึง Google Drive'))
    });
    tokenClient.callback = (r) => {
      if (r.error || !r.access_token) { reject(new DriveError('AUTH', 'ไม่ได้รับอนุญาตให้เข้าถึง Google Drive')); return; }
      token = r.access_token; tokenExp = Date.now() + Number(r.expires_in || 3600) * 1000; resolve(token);
    };
    tokenClient.requestAccessToken({ prompt: token ? '' : 'consent' });
  });
}

async function call(url, init = {}) {
  const t = await accessToken();
  const res = await fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${t}` }, referrerPolicy: 'no-referrer' });
  if (res.status === 401) { token = null; throw new DriveError('AUTH', 'การอนุญาตหมดอายุ กรุณาลองใหม่'); }
  if (res.status === 403) throw new DriveError('FORBIDDEN', 'ไม่มีสิทธิ์เข้าถึงไฟล์นี้');
  if (res.status === 404) throw new DriveError('NOT_FOUND', 'ไม่พบไฟล์ใน Google Drive');
  if (!res.ok) throw new DriveError('HTTP', `Google Drive ตอบกลับผิดปกติ (${res.status})`);
  return res;
}

/**
 * Save text as a file the app owns in Drive. Pass fileId to update an earlier save.
 * @returns {Promise<{id:string,name:string,webViewLink?:string}>}
 */
export async function saveToDrive({ name, content, mimeType = 'text/markdown', fileId = null }) {
  const boundary = `sand${Math.random().toString(16).slice(2)}`;
  const meta = JSON.stringify(fileId ? { name } : { name, mimeType });
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mimeType}; charset=UTF-8\r\n\r\n${content}\r\n--${boundary}--`;
  const url = fileId ? `${UPLOAD}/files/${encodeURIComponent(fileId)}?uploadType=multipart&fields=id,name,webViewLink` : `${UPLOAD}/files?uploadType=multipart&fields=id,name,webViewLink`;
  const res = await call(url, { method: fileId ? 'PATCH' : 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
  return res.json();
}

/** Show Google Picker and download the chosen text file. Resolves null if cancelled. */
export async function openFromDrive() {
  const t = await accessToken();
  await loadScript('https://apis.google.com/js/api.js');
  await new Promise((resolve, reject) => window.gapi.load('picker', { callback: resolve, onerror: reject }));
  const picked = await new Promise((resolve) => {
    const g = window.google.picker;
    const view = new g.DocsView(g.ViewId.DOCS).setMimeTypes('text/markdown,text/plain,text/x-markdown').setIncludeFolders(true);
    const b = new g.PickerBuilder().addView(view).setOAuthToken(t).setLocale('th').setCallback((d) => {
      if (d.action === g.Action.PICKED) resolve(d.docs[0]); else if (d.action === g.Action.CANCEL) resolve(null);
    });
    if (config.googleApiKey) b.setDeveloperKey(config.googleApiKey);
    if (config.googleAppId) b.setAppId(config.googleAppId);
    b.build().setVisible(true);
  });
  if (!picked) return null;
  const meta = await (await call(`${DRIVE}/files/${encodeURIComponent(picked.id)}?fields=id,name,size`)).json();
  if (Number(meta.size || 0) > 20 * 1024 * 1024) throw new DriveError('TOO_LARGE', 'ไฟล์ใหญ่เกินไป (สูงสุด 20 MB)');
  const content = await (await call(`${DRIVE}/files/${encodeURIComponent(picked.id)}?alt=media`)).text();
  return { id: meta.id, name: meta.name, content };
}

export function forgetDriveToken() {
  if (token && window.google && window.google.accounts) window.google.accounts.oauth2.revoke(token, () => {});
  token = null; tokenExp = 0;
}
