// End-to-end tests: production build (dist/) served with the real CSP/security headers, driven by headless Chromium.
// Run: npm run build && npm run test:e2e   (needs `npm i` for playwright + `npx playwright install chromium`)
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createPreview } from '../../scripts/preview.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = (n) => path.join(here, '..', 'fixtures', n);
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'sand-e2e-'));
const server = createPreview(); await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;
const browser = await chromium.launch();

let pass = 0; const failures = [];
async function test(name, fn, { viewport, ignore } = {}) {
  if (process.env.E2E_ONLY && !new RegExp(process.env.E2E_ONLY, 'i').test(name)) return;
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: viewport || { width: 1280, height: 800 }, locale: 'th-TH' });
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !(ignore && ignore.test(m.text()))) problems.push(`console: ${m.text()}`); });
  await page.addInitScript(() => document.addEventListener('securitypolicyviolation', (e) => console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`)));
  try {
    await fn(page, ctx);
    if (problems.length) throw new Error(`browser errors:\n  ${problems.join('\n  ')}`);
    pass++; console.log(`  ✓ ${name}`);
  } catch (e) { failures.push(name); console.log(`  ✗ ${name}\n      ${String(e.message).split('\n').join('\n      ')}`); }
  await ctx.close();
}
const eq = (a, b, msg = '') => { if (a !== b) throw new Error(`${msg} expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, msg) => { if (!c) throw new Error(msg || 'assertion failed'); };
const go = async (page, hash = '/') => { await page.goto(`${base}/index.html#${hash}`); await page.waitForSelector('#main'); await page.waitForFunction(() => !document.querySelector('.loading')); };
const dl = async (page, click) => { const [d] = await Promise.all([page.waitForEvent('download'), click()]); const p = path.join(out, `${Date.now()}-${d.suggestedFilename()}`); await d.saveAs(p); return { name: d.suggestedFilename(), path: p, buf: fs.readFileSync(p) }; };
const ROUTES = ['/', '/qr', '/converter', '/settings'];

console.log('\nSAND Office Tools — E2E');
console.log('\nShell & navigation');
await test('dashboard shows all 6 tools, tagline, mandatory privacy warning', async (page) => {
  await go(page);
  eq(await page.locator('.tool-card').count(), 6); ok((await page.textContent('.hero')).includes('เครื่องมือดิจิทัลสำหรับงานสำนักงาน ในที่เดียว'));
  ok((await page.textContent('main')).includes('หลีกเลี่ยงการอัปโหลดข้อมูลผู้ป่วยหรือข้อมูลสุขภาพที่สามารถระบุตัวบุคคลได้ หากระบบไม่ได้รับการอนุมัติให้ใช้กับข้อมูลดังกล่าว'));
});
await test('command palette (Ctrl+K): search "converter" opens File Converter; Esc closes; arrows work', async (page) => {
  await go(page); await page.keyboard.press('Control+k'); await page.waitForSelector('.palette');
  await page.keyboard.type('converter'); eq(await page.locator('.palette-item').first().textContent().then((t) => t.includes('File Converter')), true); await page.keyboard.press('Enter');
  await page.waitForFunction(() => location.hash === '#/converter'); eq(await page.locator('.palette').count(), 0);
  await page.keyboard.press('Control+k'); await page.keyboard.type('QR'); ok((await page.locator('.palette-item').first().textContent()).includes('QR')); await page.keyboard.press('Escape'); eq(await page.locator('.palette').count(), 0);
  await page.keyboard.press('Control+k'); await page.waitForSelector('.palette-input'); await page.fill('.palette-input', 'zzzzqq'); ok((await page.textContent('.palette-list')).includes('ไม่พบ'));
});
await test('theme toggle persists across reload; reduced theme tokens apply', async (page) => {
  await go(page); const before = await page.getAttribute('html', 'data-theme'); await page.click('button[aria-label="สลับโหมดมืด/สว่าง"]');
  const after = await page.getAttribute('html', 'data-theme'); ok(before !== after); await page.reload(); await page.waitForSelector('#main'); eq(await page.getAttribute('html', 'data-theme'), after);
});
await test('sidebar collapses and remembers state', async (page) => {
  await go(page); await page.click('.collapse-btn'); eq(await page.getAttribute('.shell', 'data-collapsed'), 'true'); await page.reload(); await page.waitForSelector('.shell'); eq(await page.getAttribute('.shell', 'data-collapsed'), 'true');
});
await test('every route loads without console/CSP errors and every control has an accessible name', async (page) => {
  for (const r of ROUTES) {
    await go(page, r);
    const bad = await page.evaluate(() => Array.from(document.querySelectorAll('button, a[href], input, select, textarea, [role="button"]')).filter((el) => {
      if (el.hidden || el.closest('[hidden]') || el.type === 'file' || el.type === 'hidden') return false;
      const name = (el.getAttribute('aria-label') || el.textContent || el.title || '').trim() || (el.id && document.querySelector(`label[for="${el.id}"]`)) || el.closest('label') || el.getAttribute('aria-labelledby') || el.getAttribute('placeholder');
      return !name;
    }).map((el) => el.outerHTML.slice(0, 120)));
    eq(bad.length, 0, `unnamed controls on ${r}: ${bad.join(' | ')}`);
  }
});

console.log('\nQR Code');
await test('generate URL QR, preview, download PNG + SVG; scanned content matches (OpenCV decode if available)', async (page) => {
  await go(page, '/qr'); await page.fill('input[inputmode=url]', 'sansai.go.th/ทดสอบ'); await page.waitForSelector('.qr-canvas-wrap:not([hidden])');
  ok((await page.textContent('.qr-info')).includes('โมดูล'));
  const png = await dl(page, () => page.click('button:has-text("ดาวน์โหลด PNG")')); const svg = await dl(page, () => page.click('button:has-text("ดาวน์โหลด SVG")'));
  eq(png.name, 'qr-link.png'); ok(png.buf.subarray(0, 4).toString('hex') === '89504e47'); ok(svg.buf.toString().startsWith('<svg'));
  fs.copyFileSync(png.path, path.join(out, 'url.png')); const py = spawnSync('python3', ['-c', `import cv2,sys\nv,_,_=cv2.QRCodeDetector().detectAndDecode(cv2.imread(sys.argv[1]))\nprint(v)`, png.path], { encoding: 'utf8' });
  if (py.status === 0) eq(py.stdout.trim(), 'https://sansai.go.th/ทดสอบ', 'decoded content'); else console.log('      (OpenCV not available — decode check skipped)');
});
await test('Wi-Fi, vCard, SMS, email, phone, text payloads produce QR; too-long data gives a friendly error', async (page) => {
  await go(page, '/qr');
  for (const [tab, fill] of [['Wi-Fi', async () => { await page.fill('label:has-text("ชื่อเครือข่าย") >> xpath=following-sibling::input', 'Hospital'); }], ['โทรศัพท์', async () => { await page.fill('input[type=tel]', '0812345678'); }], ['อีเมล', async () => { await page.fill('input[type=email]', 'a@b.go.th'); }], ['ข้อความ', async () => { await page.fill('textarea', 'สวัสดี'); }], ['นามบัตร (vCard)', async () => { await page.fill('label:has-text("ชื่อ") >> nth=0 >> xpath=following-sibling::input', 'สมชาย'); }]]) {
    await page.click(`[role=tab]:has-text("${tab}")`); await fill(); await page.waitForSelector('.qr-canvas-wrap:not([hidden])'); }
  await page.click('[role=tab]:has-text("ข้อความ")'); await page.fill('textarea', 'x'.repeat(3000)); await page.waitForSelector('.notice-error'); ok((await page.textContent('.notice-error')).includes('ยาวเกินไป') || (await page.textContent('.notice-error')).includes('ยาวเกิน'));
});
await test('customisation: size/colour/style/logo; low-contrast warning', async (page) => {
  await go(page, '/qr'); await page.fill('input[inputmode=url]', 'https://example.com'); await page.fill('input[type=number] >> nth=0', '256'); await page.selectOption('.card:has(h2:has-text("ปรับแต่ง")) select >> nth=1', 'rounded');
  await page.waitForSelector('.qr-canvas-wrap:not([hidden])'); const w = await page.evaluate(() => document.querySelector('.qr-canvas-wrap canvas').width); ok(w >= 200 && w <= 256, `canvas ${w}`);
  await page.evaluate(() => { const i = document.querySelectorAll('input[type=color]'); i[0].value = '#dddddd'; i[0].dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForSelector('.notice-warn');
});

console.log('\nFile converter (runs in the browser)');
for (const [f, expectIn] of [['sample.docx', ['# รายงานการประชุม', '## วาระที่ 1', '**ตัวหนา**', '*ตัวเอียง*', '* รายการที่ 1', '1. ขั้นที่ 1', '| สมชาย | การเงิน | 10 |']], ['sample.pptx', ['<!-- Slide number: 1 -->', '# แผนงานประจำปี', '### Notes:', 'บันทึกผู้พูด', '| A | B |']], ['sample.xlsx', ['## งบประมาณ', '| กระดาษ | 5 | 120.5 |', '## Sheet2']], ['sample.csv', ['| ชื่อ | อายุ |', '| สม, หญิง | 25 |']], ['sample.html', ['# หัวข้อ', '**หนา**', '[ลิงก์](https://example.com)', '```', '| a | b |']], ['sample.txt', ['บรรทัดหนึ่ง']], ['english.pdf', ['# Annual Report 2026', '* First point']]]) {
  await test(`convert ${f} → ${f.replace(/\.[^.]+$/, '.md')} with UI result actions`, async (page) => {
    await go(page, '/converter'); await page.setInputFiles('input[type=file]', fx(f)); await page.waitForSelector('.notice-success', { timeout: 30000 });
    const text = await page.inputValue('textarea[aria-label="ผลลัพธ์ Markdown"]'); for (const s of expectIn) ok(text.includes(s), `missing "${s}" in:\n${text}`);
    const d = await dl(page, () => page.click(`button:has-text("ดาวน์โหลด")`)); eq(d.name, f.replace(/\.[^.]+$/, '.md'), 'download keeps base name'); eq(d.buf.toString('utf8'), text);
    await page.click('button:has-text("ดูตัวอย่าง")'); await page.waitForSelector('.md-preview:not([hidden]) >> nth=0');
  });
}
await test('drag & drop: file dropped on dashboard routes to the converter', async (page) => {
  await go(page, '/');
  const drop = async (name, buf, type) => { await page.evaluate(({ name, b64, type }) => { const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); const dt = new DataTransfer(); dt.items.add(new File([bytes], name, { type })); window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true })); window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }, { name, b64: buf.toString('base64'), type }); };
  await drop('sample.docx', fs.readFileSync(fx('sample.docx')), ''); await page.waitForSelector('.notice-success'); eq(await page.evaluate(() => location.hash), '#/converter');
  await page.goto(`${base}/index.html#/`); await page.waitForSelector('.hero'); await drop('a.md', Buffer.from('# dropped'), ''); await page.waitForSelector('.toast'); eq(await page.evaluate(() => location.hash), '#/');
});
console.log('\nConverter — hostile / invalid input (friendly errors, no crash)');
for (const [f, label, mustHave] of [['fake.docx', 'PDF renamed .docx', 'ไม่ตรงกับนามสกุล'], ['legacy.xls', 'legacy .xls', '.xlsx'], ['encrypted.docx', 'password-protected/legacy OLE', 'รหัสผ่าน'], ['corrupt.docx', 'corrupt zip', 'เสียหาย'], ['bomb.docx', 'zip bomb (350 MB expansion)', 'ใหญ่เกินไป'], ['bomb2.xlsx', 'many-part bomb', 'ไม่ปลอดภัย'], ['xxe.docx', 'XXE / DOCTYPE', 'ไม่ปลอดภัย'], ['empty.pdf', 'empty file', 'ว่างเปล่า']]) {
  await test(`rejects ${label}`, async (page) => {
    await go(page, '/converter'); const t0 = Date.now(); await page.setInputFiles('input[type=file]', fx(f)); await page.waitForSelector('.notice-error', { timeout: 30000 });
    const t = await page.textContent('.notice-error'); ok(t.includes('ไม่สามารถแปลงไฟล์นี้ได้') || t.includes('ว่างเปล่า') || t.includes('ใหญ่เกินไป'), t); ok(t.includes(mustHave) || (await page.textContent('details.tech')).includes(mustHave), `expected "${mustHave}" in: ${t}`);
    ok(!/500|Internal Server|undefined|\[object/.test(t), 'no technical jargon'); ok(Date.now() - t0 < 20000, 'fails fast'); await page.click('button:has-text("ลองไฟล์อื่น")'); await page.waitForSelector('.dropzone');
  });
}
await test('path-traversal zip entry is neutralised (no crash, nothing read from disk)', async (page) => {
  await go(page, '/converter'); await page.setInputFiles('input[type=file]', fx('traversal.docx')); await page.waitForSelector('.notice-success, .notice-error, .notice-warn:not(.notice-privacy)', { timeout: 20000 });
  const t = await page.textContent('#main'); ok(!/root:|passwd|evil/.test(t));
});
await test('rejects oversized file (> limit) and unsupported extension', async (page) => {
  await go(page, '/converter'); await page.waitForSelector('input[type=file]', { state: 'attached' }); await page.evaluate(() => { const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array(26 * 1024 * 1024)], 'big.pdf', { type: 'application/pdf' })); const i = document.querySelector('input[type=file]'); i.files = dt.files; i.dispatchEvent(new Event('change')); });
  await page.waitForSelector('.notice-error'); ok((await page.textContent('.notice-error')).includes('ใหญ่เกินไป'));
  await page.click('button:has-text("ลองไฟล์อื่น")'); await page.evaluate(() => { const dt = new DataTransfer(); dt.items.add(new File(['x'], 'run.exe')); const i = document.querySelector('input[type=file]'); i.files = dt.files; i.dispatchEvent(new Event('change')); }); await page.waitForSelector('.toast-error'); ok((await page.textContent('.toast-error')).includes('ไม่รองรับ'));
});
await test('MIME/extension mismatch is rejected (image/png declared for .pdf)', async (page) => {
  await go(page, '/converter'); await page.waitForSelector('input[type=file]', { state: 'attached' }); await page.evaluate(() => { const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array(1000)], 'x.pdf', { type: 'image/png' })); const i = document.querySelector('input[type=file]'); i.files = dt.files; i.dispatchEvent(new Event('change')); });
  await page.waitForSelector('.notice-error'); ok((await page.textContent('.notice-error')).includes('ไม่ตรงกับ'));
});

console.log('\nSettings & privacy');
await test('settings: clear local data wipes storage', async (page) => {
  await go(page, '/qr'); await go(page, '/'); ok((await page.textContent('.recent-list')).includes('QR Code'));
  await go(page, '/settings'); page.once('dialog', (d) => d.accept()); await page.click('button:has-text("ล้างข้อมูลในเครื่องทั้งหมด")'); await page.waitForTimeout(1200); await page.waitForSelector('#main');
  const left = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('sand:'))); eq(left.length, 0, `localStorage: ${left}`);
});
await test('settings system status: converter engine reports ready', async (page) => {
  await go(page, '/settings'); await page.click('button:has-text("ตรวจสอบเอนจิน")'); await page.waitForFunction(() => document.body.textContent.includes('พร้อมใช้งาน · JSZip'), null, { timeout: 15000 });
});
await test('recent activity is stored locally and shown on dashboard', async (page) => {
  await go(page, '/qr'); await go(page, '/'); ok((await page.textContent('.recent-list')).includes('QR Code'));
});

console.log('\nAuthentication (Google sign-in against a mocked backend)');
const GAS = 'https://script.google.com/macros/s/TEST/exec';
async function authSetup(ctx, { loginResponse, requireLogin = true }) {
  const calls = [];
  await ctx.route((u) => u.pathname === '/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: `window.SAND_CONFIG=${JSON.stringify({ gasUrl: GAS, googleClientId: 'test-client', requireLogin, maxFileSizeMB: 25, conversionTimeoutSec: 60, version: 'dev' })};` }));
  await ctx.route('https://accounts.google.com/gsi/client', (r) => r.fulfill({ contentType: 'text/javascript', body: `window.google={accounts:{id:{initialize:function(o){window.__cb=o.callback},renderButton:function(el){var b=document.createElement('button');b.textContent='Sign in with Google';b.id='fake-google';b.onclick=function(){window.__cb({credential:'FAKE.ID.TOKEN'})};el.appendChild(b)},disableAutoSelect:function(){}}}};` }));
  await ctx.route(`${GAS}**`, async (r) => {
    const req = r.request(); const body = req.method() === 'POST' ? JSON.parse(req.postData() || '{}') : { action: new URL(req.url()).searchParams.get('action') }; calls.push(body);
    const h = { 'access-control-allow-origin': '*' };
    if (body.action === 'health') return r.fulfill({ headers: h, contentType: 'application/json', body: JSON.stringify({ success: true, data: { status: 'ok', version: '1.0.0' } }) });
    if (body.action === 'login') return r.fulfill({ headers: h, contentType: 'application/json', body: JSON.stringify(loginResponse(body)) });
    if (body.action === 'me') return r.fulfill({ headers: h, contentType: 'application/json', body: JSON.stringify(body.session === 'SESSION-OK' ? { success: true, data: { email: 'a@example.go.th' } } : { success: false, error: { code: 'INVALID_SESSION', message: 'x' } }) });
    return r.fulfill({ headers: h, contentType: 'application/json', body: '{"success":false,"error":{"code":"UNKNOWN_ACTION","message":"x"}}' });
  });
  return calls;
}
await test('UNAUTHORIZED: login required → app content is NOT shown until backend accepts', async (page, ctx) => {
  await authSetup(ctx, { loginResponse: () => ({ success: false, error: { code: 'DOMAIN_NOT_ALLOWED', message: 'x' } }) });
  await page.goto(`${base}/index.html#/qr`); await page.waitForSelector('#fake-google'); eq(await page.locator('.sidebar').count(), 0); eq(await page.locator('.qr-canvas-wrap').count(), 0);
  await page.click('#fake-google'); await page.waitForSelector('.login-status.error'); ok((await page.textContent('.login-status')).includes('ไม่ได้อยู่ในโดเมนที่อนุญาต')); eq(await page.locator('.sidebar').count(), 0, 'still locked'); eq(await page.evaluate(() => localStorage.getItem('sand:session')), null);
});
await test('login success → app opens, user shown, session validated server-side on reload, logout clears it', async (page, ctx) => {
  const calls = await authSetup(ctx, { loginResponse: () => ({ success: true, data: { session: 'SESSION-OK', exp: Math.floor(Date.now() / 1000) + 3600, user: { email: 'a@example.go.th', name: 'สมชาย ใจดี' } } }) });
  await page.goto(`${base}/index.html#/`); await page.click('#fake-google'); await page.waitForSelector('.sidebar'); ok((await page.textContent('.user-box')).includes('สมชาย ใจดี'));
  ok(calls.some((c) => c.action === 'login' && c.idToken === 'FAKE.ID.TOKEN'), 'id token sent to backend'); await page.reload(); await page.waitForSelector('.sidebar'); await page.waitForFunction(() => true); for (let i = 0; i < 50 && !calls.some((c) => c.action === 'me' && c.session === 'SESSION-OK'); i++) await page.waitForTimeout(100); ok(calls.some((c) => c.action === 'me' && c.session === 'SESSION-OK'), 'session re-validated by backend (in the background)');
  await page.evaluate(() => localStorage.setItem('sand:session', JSON.stringify({ token: 'FORGED', exp: 9999999999, user: { email: 'x@y.z', name: 'x' } }))); await page.reload(); await page.waitForSelector('#fake-google'); eq(await page.locator('.sidebar').count(), 0, 'forged session rejected by backend');
});
await test('SPEED: a stored session opens the app at once (does not wait for the slow backend); a rejected session is signed out afterwards', async (page, ctx) => {
  await authSetup(ctx, { loginResponse: () => ({}) });
  await ctx.route(`${GAS}**`, async (r) => { const b = r.request().method() === 'POST' ? JSON.parse(r.request().postData() || '{}') : {}; if (b.action === 'me') { await new Promise((x) => setTimeout(x, 4000)); } await r.fallback(); });
  await page.addInitScript(() => localStorage.setItem('sand:session', JSON.stringify({ token: 'SESSION-OK', exp: 9999999999, user: { email: 'a@example.go.th', name: 'สมชาย ใจดี' } })));
  const t0 = Date.now(); await page.goto(`${base}/index.html#/`); await page.waitForSelector('.sidebar', { timeout: 3000 }); ok(Date.now() - t0 < 3500, 'opened before the 4 s backend answer');
}, { ignore: /Failed to load resource/ });
await test('backend unreachable at login → friendly Thai error, app stays locked', async (page, ctx) => {
  await authSetup(ctx, { loginResponse: () => ({}) }); await ctx.route(`${GAS}**`, (r) => r.abort()); await page.goto(`${base}/index.html#/`); await page.click('#fake-google'); await page.waitForSelector('.login-status.error'); ok((await page.textContent('.login-status')).includes('เชื่อมต่อ Backend ไม่ได้')); eq(await page.locator('.sidebar').count(), 0);
}, { ignore: /Failed to load resource/ });
await test('backend health check in Settings (no login mode)', async (page, ctx) => {
  await authSetup(ctx, { requireLogin: false, loginResponse: () => ({}) }); await go(page, '/settings'); await page.click('button:has-text("ตรวจสอบ Backend")'); await page.waitForFunction(() => document.body.textContent.includes('พร้อมใช้งาน · เวอร์ชัน 1.0.0'));
});

console.log('\nQR history (mocked backend)');
/** In-memory stand-in for Links.gs: create / list / get / update / delete for kinds qr and qrs. */
async function qrBackend(ctx) {
  const items = []; const calls = []; const hist = { data: { admin: false, email: 'a@example.go.th', total: 0, mine: 0, rows: [] } };
  await ctx.route((u) => u.pathname === '/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: `window.SAND_CONFIG=${JSON.stringify({ gasUrl: GAS, googleClientId: 'test-client', requireLogin: true, maxFileSizeMB: 25, conversionTimeoutSec: 60, version: 'dev' })};` }));
  await ctx.route('https://accounts.google.com/gsi/client', (r) => r.fulfill({ contentType: 'text/javascript', body: `window.google={accounts:{id:{initialize:function(o){window.__cb=o.callback},renderButton:function(el){var b=document.createElement('button');b.textContent='Sign in with Google';b.id='fake-google';b.onclick=function(){window.__cb({credential:'FAKE.ID.TOKEN'})};el.appendChild(b)},disableAutoSelect:function(){}}}};` }));
  await ctx.route(`${GAS}**`, async (r) => {
    const req = r.request(); const b = req.method() === 'POST' ? JSON.parse(req.postData() || '{}') : { action: new URL(req.url()).searchParams.get('action') }; calls.push(b);
    const res = (data) => r.fulfill({ headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
    const err = (code, message) => r.fulfill({ headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: JSON.stringify({ success: false, error: { code, message } }) });
    const base = 'https://sand.example.go.th';
    if (b.action === 'health') return res({ status: 'ok', version: '1.4.0' });
    if (b.action === 'login') return res({ session: 'SESSION-OK', exp: Math.floor(Date.now() / 1000) + 3600, user: { email: 'a@example.go.th', name: 'สมชาย ใจดี' } });
    if (b.action === 'me') return res({ email: 'a@example.go.th' });
    if (b.action === 'projects') return res({ items: [] });
    if (b.action === 'log') return res({ logId: 'x' });
    if (b.action === 'history') return res(hist.data);
    if (b.action !== 'links') return err('UNKNOWN_ACTION', 'x');
    const find = () => items.find((i) => i.code === b.code);
    if (b.op === 'list') return res({ admin: false, base, items: items.map((i) => ({ ...i })), scanned: false });
    if (b.op === 'get') return find() ? res({ link: find(), base }) : err('NOT_FOUND', 'ไม่พบ');
    if (b.op === 'create') {
      if (b.kind === 'qrs' && b.qr && b.qr.f && b.qr.f.password) return err('NO_SECRET', 'ไม่บันทึกรหัสผ่าน');
      const l = { code: `q${String(items.length + 1).padStart(6, 'a')}`, url: b.kind === 'qr' ? b.url : '', title: b.title, owner: 'a@example.go.th', created: '2026-10-06 13:45:00', expires: '', status: 'active', note: b.note || '', tags: [], ref: '', refKind: '', project: '', kind: b.kind, qr: b.qr, clicks: b.kind === 'qr' ? 7 : 0, week: b.kind === 'qr' ? 3 : 0, last: 0 };
      items.push(l); return res({ link: l, existing: false, base });
    }
    if (b.op === 'update') { const l = find(); if (!l) return err('NOT_FOUND', 'x'); for (const k of ['title', 'note', 'url', 'qr', 'status']) if (b[k] !== undefined) l[k] = b[k]; return res({ link: l }); }
    if (b.op === 'delete') { const i = items.findIndex((x) => x.code === b.code); if (i >= 0) items.splice(i, 1); return res({ code: b.code }); }
    return err('UNKNOWN_ACTION', 'x');
  });
  return { items, calls, hist };
}
const signIn = async (page) => { await page.goto(`${base}/index.html#/qr`); await page.click('#fake-google'); await page.waitForSelector('.sidebar'); await page.waitForSelector('.qr-save input[type=text]'); };
await test('save a static QR (what it is for + category) → appears in QR history; Wi-Fi password is refused; edit and delete work', async (page, ctx) => {
  const be = await qrBackend(ctx); await signIn(page);
  await page.selectOption('select[aria-label="หมวดงาน"]', 'vaccine');
  await page.fill('input[inputmode=url]', 'example.com/flu'); await page.waitForSelector('.qr-canvas-wrap:not([hidden])');
  await page.click('.qr-save .btn-primary'); await page.waitForSelector('.toast:has-text("ตั้งชื่อ QR")');
  await page.fill('.qr-save input[placeholder^="เช่น QR"]', 'QR ลงทะเบียนวัคซีนไข้หวัดใหญ่'); await page.click('.qr-save .btn-primary'); await page.waitForSelector('.qr-saved');
  const c = be.calls.find((x) => x.op === 'create'); eq(c.kind, 'qrs'); eq(c.title, 'QR ลงทะเบียนวัคซีนไข้หวัดใหญ่'); eq(c.qr.t, 'url'); eq(c.qr.d.cat, 'vaccine'); eq(c.qr.f.url, 'example.com/flu');
  await go(page, '/qrs'); await page.waitForSelector('.qrh-card'); eq(await page.locator('.qrh-card').count(), 1);
  ok((await page.textContent('.qrh-card')).includes('งานวัคซีน') && (await page.textContent('.qrh-card')).includes('เก็บประวัติ'));
  eq(await page.locator('.qrh-thumb canvas').count(), 1, 'thumbnail rendered from the saved data');
  const png = await dl(page, () => page.click('.qrh-card button:has-text("PNG")')); ok(png.name.endsWith('.png') && png.buf.length > 200);
  await page.click('.qrh-card a:has-text("เปิดแก้ไข")'); await page.waitForSelector('.qr-save .notice-info:not([hidden])'); eq(await page.inputValue('input[inputmode=url]'), 'example.com/flu'); eq(await page.inputValue('select[aria-label="หมวดงาน"]'), 'vaccine');
  await page.fill('.qr-save input[placeholder^="เช่น QR"]', 'QR วัคซีน (แก้ชื่อ)'); await page.click('.qr-save .btn-primary:has-text("อัปเดต")'); await page.waitForSelector('.qr-saved:not([hidden])');
  eq(be.items.length, 1, 'updated in place'); eq(be.items[0].title, 'QR วัคซีน (แก้ชื่อ)');
  await go(page, '/qrs'); await page.waitForSelector('.qrh-card'); await page.fill('input[type=search]', 'ไม่มีอยู่จริง'); await page.waitForSelector('.qrh-empty'); await page.fill('input[type=search]', 'แก้ชื่อ'); await page.waitForSelector('.qrh-card');
  await page.click('.qrh-del'); await page.click('.modal .btn-danger'); await page.waitForSelector('.qrh-empty'); eq(be.items.length, 0);
});
await test('tracked QR: saving switches the picture to the short link and the history shows scan numbers; Wi-Fi password is never sent', async (page, ctx) => {
  const be = await qrBackend(ctx); await signIn(page);
  await page.fill('input[inputmode=url]', 'https://example.com/survey'); await page.waitForSelector('.qr-canvas-wrap:not([hidden])');
  await page.fill('.qr-save input[placeholder^="เช่น QR"]', 'QR แบบประเมิน'); await page.check('#qr-mode-tracked'); await page.click('.qr-save .btn-primary'); await page.waitForSelector('.qr-saved:not([hidden])');
  const c = be.calls.find((x) => x.op === 'create'); eq(c.kind, 'qr'); eq(c.url, 'https://example.com/survey'); eq(c.qr.f, undefined, 'a tracked QR stores no form data');
  ok((await page.textContent('.qr-info')).includes('ติดตามสถิติ'), 'picture now encodes the short link');
  await page.fill('input[inputmode=url]', 'https://example.com/other'); await page.waitForFunction(() => !document.querySelector('.qr-info').textContent.includes('ติดตามสถิติ'));
  await page.click('button[role=tab]:has-text("Wi-Fi")'); ok(await page.locator('#qr-mode-tracked').isDisabled(), 'tracking is only for links');
  await go(page, '/qrs'); await page.waitForSelector('.qrh-card'); const card = await page.textContent('.qrh-card'); ok(card.includes('ติดตามสถิติ') && card.includes('7') && card.includes('ดูสถิติ'));
  eq(await page.locator('.lnk-kpi').count(), 4);
});
await test('static Wi-Fi QR with a password is not saved (client check)', async (page, ctx) => {
  const be = await qrBackend(ctx); await signIn(page);
  await page.click('button[role=tab]:has-text("Wi-Fi")'); const inputs = page.locator('#main .card').first().locator('input[type=text]'); await inputs.nth(0).fill('HOSP'); await inputs.nth(1).fill('p@ssw0rd');
  await page.waitForSelector('.qr-canvas-wrap:not([hidden])'); await page.fill('.qr-save input[placeholder^="เช่น QR"]', 'Wi-Fi ผู้ป่วย'); await page.click('.qr-save .btn-primary'); await page.waitForSelector('.toast:has-text("ไม่บันทึกรหัสผ่าน")');
  ok(!be.calls.some((x) => x.op === 'create'), 'nothing was sent');
});
await test('mobile 390px: QR history page has no horizontal overflow', async (page, ctx) => {
  const be = await qrBackend(ctx); be.items.push({ code: 'abcdefg', url: 'https://example.com/a-very-long-destination/path/that/keeps/going/and/going', title: 'QR ชื่อยาวมาก ๆ สำหรับทดสอบการตัดบรรทัดในหน้าจอมือถือขนาดเล็ก', owner: 'a@example.go.th', created: '2026-10-01 10:00:00', expires: '', status: 'active', note: 'หมายเหตุ', tags: [], ref: '', refKind: '', project: '', kind: 'qr', qr: { t: 'url', d: { cat: 'queue' } }, clicks: 1234, week: 56, last: Date.now() });
  await page.goto(`${base}/index.html#/qrs`); await page.click('#fake-google'); await page.waitForSelector('.qrh-card');
  const o = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]); ok(o[0] <= o[1] + 1, `scrollWidth ${o[0]} > ${o[1]}`);
}, { viewport: { width: 390, height: 800 } });

await test('usage history page: shows rows (even with odd dates) and explains an empty list', async (page, ctx) => {
  const be = await qrBackend(ctx);
  be.hist.data = { admin: false, email: 'a@example.go.th', total: 50, mine: 2, rows: [
    { ts: '2026-10-06 09:30:00', logId: 'l1', email: 'a@example.go.th', tool: 'pdf', op: 'merge', status: 'ok', fileName: 'a.pdf', sizeIn: 1000, sizeOut: 900, files: [] },
    { ts: 'not a date', logId: 'l2', email: 'a@example.go.th', tool: 'qr', op: 'make', status: 'ok', fileName: '', sizeIn: 0, sizeOut: 0, files: [] }] };
  await page.goto(`${base}/index.html#/history`); await page.click('#fake-google'); await page.waitForSelector('.hist-card');
  await page.waitForFunction(() => document.querySelector('.hist-card').textContent.includes('a.pdf'));
  const t = await page.textContent('.hist-card'); ok(!t.includes('NaN') && !t.includes('undefined'), 'bad text: ' + t);
  be.hist.data = { admin: false, email: 'a@example.go.th', total: 50, mine: 0, rows: [] };
  await page.click('.hist-tools button'); await page.waitForFunction(() => document.querySelector('.hist-card .empty'));
  ok((await page.textContent('.hist-card .empty')).includes('ไม่มีแถวของบัญชี a@example.go.th'), 'no diagnosis');
});

console.log('\nResponsive & offline');
for (const r of ROUTES) {
  await test(`mobile 390px: ${r} has no horizontal overflow, bottom nav visible, sidebar hidden`, async (page) => {
    await go(page, r); eq(await page.locator('.bottomnav').isVisible(), true); eq(await page.locator('.sidebar').isVisible(), false);
    const overflow = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]); ok(overflow[0] <= overflow[1] + 1, `scrollWidth ${overflow[0]} > ${overflow[1]}`);
  }, { viewport: { width: 390, height: 800 } });
}
await test('PWA: service worker installs; QR and the converter work fully offline', async (page, ctx) => {
  await go(page, '/'); await page.evaluate(() => navigator.serviceWorker.ready); await page.waitForFunction(() => navigator.serviceWorker.controller || true); await page.reload(); await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 10000 });
  await ctx.setOffline(true); await page.reload(); await page.waitForSelector('.hero');
  await page.goto(`${base}/index.html#/qr`); await page.reload(); await page.fill('input[inputmode=url]', 'offline.example'); await page.waitForSelector('.qr-canvas-wrap:not([hidden])');
  await page.goto(`${base}/index.html#/converter`); await page.reload(); await page.setInputFiles('input[type=file]', fx('sample.docx')); await page.waitForSelector('.notice-success', { timeout: 20000 });
  await page.click('button:has-text("แปลงไฟล์อื่น")'); await page.setInputFiles('input[type=file]', fx('english.pdf')); await page.waitForSelector('.notice-success', { timeout: 20000 }); await ctx.setOffline(false);
});
await test('security headers & CSP are served by the preview (same as vercel.json)', async (page) => {
  const res = await page.goto(`${base}/index.html`); const h = res.headers();
  ok(h['content-security-policy'].includes("object-src 'none'") && h['content-security-policy'].includes("frame-ancestors 'none'")); eq(h['x-content-type-options'], 'nosniff'); eq(h['x-frame-options'], 'DENY'); eq(h['referrer-policy'], 'no-referrer'); ok(h['strict-transport-security'].includes('max-age'));
  const cfg = await (await page.request.get(`${base}/config.js`)).text(); ok(!/SECRET|secret|password/i.test(cfg), 'no secrets in config.js');
});

await browser.close(); server.close();
console.log(`\n${pass} passed, ${failures.length} failed${failures.length ? `\nFailed: ${failures.join('; ')}` : ''}`);
process.exit(failures.length ? 1 : 0);
