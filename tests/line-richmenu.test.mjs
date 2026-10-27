// scripts/line-richmenu.mjs: the menu object must be exactly what LINE accepts, and must match what gas/HrLine.gs answers.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildMenu, SIZE, TEXT_THIS, TEXT_DAY } from '../scripts/line-richmenu.mjs';

const m = buildMenu('https://sandtools.vercel.app/');
test('three buttons that tile the 2500×843 canvas without gaps or overlap', () => {
  assert.deepEqual(m.size, { width: 2500, height: 843 }); assert.equal(m.areas.length, 3);
  let x = 0; for (const a of m.areas) { assert.equal(a.bounds.x, x); assert.equal(a.bounds.y, 0); assert.equal(a.bounds.height, SIZE.height); x += a.bounds.width; }
  assert.equal(x, SIZE.width);
});
test('LINE limits: chatBarText ≤ 14, labels ≤ 20, name ≤ 300, https uri ≤ 1000', () => {
  assert.ok(m.chatBarText.length <= 14 && m.name.length <= 300);
  m.areas.forEach((a) => { assert.ok(a.action.label.length <= 20); if (a.action.uri) { assert.match(a.action.uri, /^https:\/\//); assert.ok(a.action.uri.length <= 1000); } });
});
test('order: link · this week · which day. The text buttons send words the bot really answers; the link opens the phone browser', () => {
  assert.equal(m.areas[0].action.type, 'uri'); assert.equal(m.areas[0].action.uri, 'https://sandtools.vercel.app/?openExternalBrowser=1#/leave');
  assert.equal(m.areas[1].action.text, TEXT_THIS); assert.equal(m.areas[2].action.text, TEXT_DAY);
  const gas = fs.readFileSync(new URL('../gas/HrLine.gs', import.meta.url), 'utf8');       // the keyword handling lives in the backend
  assert.ok(gas.includes('วันไหน') && gas.includes('dayask'), 'HrLine.gs must answer the “which day” button');
});
test('rejects http and garbage urls; shipped image is a PNG of the right size under 1 MB', () => {
  assert.throws(() => buildMenu('http://x.example')); assert.throws(() => buildMenu('sandtools'));
  const b = fs.readFileSync(new URL('../docs/line-richmenu.png', import.meta.url));
  assert.equal(b.readUInt32BE(16), 2500); assert.equal(b.readUInt32BE(20), 843); assert.ok(b.length < 1024 * 1024);
});

// ---- run the real script with LINE replaced by a stub (fetch preloaded), to check the call order and the clean-up on failure
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
const stub = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rm-')), 'stub.mjs');
fs.writeFileSync(stub, `const log = []; globalThis.__log = log;
globalThis.fetch = async (url, init = {}) => {
  log.push(((init.method || 'GET') + ' ' + url).replace('https://', ''));
  const fail = process.env.STUB_FAIL && url.includes(process.env.STUB_FAIL);
  const body = fail ? JSON.stringify({ message: 'boom Bearer-' + process.env.LINE_CHANNEL_ACCESS_TOKEN }) : url.endsWith('/richmenu') ? JSON.stringify({ richMenuId: 'richmenu-abc123' }) : '{}';
  return new Response(body, { status: fail ? 400 : 200 });
};
process.on('exit', () => console.log('LOG ' + JSON.stringify(log)));`);
const run = (env, ...args) => spawnSync(process.execPath, ['--import', stub, new URL('../scripts/line-richmenu.mjs', import.meta.url).pathname, ...args], { env: { ...process.env, LINE_CHANNEL_ACCESS_TOKEN: 'sekret', ...env }, encoding: 'utf8' });
const logOf = (r) => JSON.parse((/LOG (.*)/.exec(r.stdout) || [])[1] || '[]');

test('create: makes the menu, uploads the image, sets it as default — in that order', () => {
  const r = run({}, 'create', 'https://sandtools.vercel.app'); assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(logOf(r), ['POST api.line.me/v2/bot/richmenu', 'POST api-data.line.me/v2/bot/richmenu/richmenu-abc123/content', 'POST api.line.me/v2/bot/user/all/richmenu/richmenu-abc123']);
});
test('create: when the upload fails the half-made menu is deleted, and the token never appears in the error', () => {
  const r = run({ STUB_FAIL: '/content' }, 'create', 'https://sandtools.vercel.app'); assert.equal(r.status, 1);
  assert.ok(logOf(r).includes('DELETE api.line.me/v2/bot/richmenu/richmenu-abc123')); assert.ok(!r.stderr.includes('sekret'));
});
test('delete refuses anything that is not a rich menu id', () => { assert.equal(run({}, 'delete', '../../x').status, 1); });
