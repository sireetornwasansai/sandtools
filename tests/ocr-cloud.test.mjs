// Cloud OCR: api/ocr.js (edge relay, no network) + converters/ocr-cloud.js (output cleaning, quota handling, engine choice).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-cloud-'));
fs.copyFileSync(path.join(root, 'api', 'ocr.js'), path.join(tmp, 'ocr.mjs'));      // the repo has no "type":"module" for api/
const edge = await import(pathToFileURL(path.join(tmp, 'ocr.mjs')).href);
const cloud = await import(pathToFileURL(path.join(root, 'src', 'js', 'modules', 'converters', 'ocr-cloud.js')).href);

/* ---------------------------------------------------------------- api/ocr.js */

test('edge: model id and base URL come only from safe environment values', () => {
  assert.equal(edge.modelId({}), 'typhoon-ocr');
  assert.equal(edge.modelId({ SAND_TYPHOON_MODEL: 'typhoon-ocr-v1.5' }), 'typhoon-ocr-v1.5');
  assert.equal(edge.modelId({ SAND_TYPHOON_MODEL: 'x y;rm -rf' }), 'typhoon-ocr');
  assert.equal(edge.baseUrl({}), 'https://api.opentyphoon.ai/v1');
  assert.equal(edge.baseUrl({ SAND_TYPHOON_URL: 'https://example.org/v1/' }), 'https://example.org/v1');
  assert.equal(edge.baseUrl({ SAND_TYPHOON_URL: 'http://insecure.example/v1' }), 'https://api.opentyphoon.ai/v1');   // https only
});

test('edge: only small JPEG/PNG/WebP data URLs are accepted', () => {
  assert.equal(edge.checkImage('data:image/jpeg;base64,/9j/4AAQSkZJRg=='), '');
  assert.equal(edge.checkImage('data:image/png;base64,iVBORw0KGgo='), '');
  assert.notEqual(edge.checkImage('data:text/html;base64,PHNjcmlwdD4='), '');
  assert.notEqual(edge.checkImage('https://evil.example/x.jpg'), '');
  assert.notEqual(edge.checkImage(null), '');
  assert.notEqual(edge.checkImage(`data:image/jpeg;base64,${'A'.repeat(3_500_000)}`), '');
});

test('edge: the request carries the model, one image and the sampling Typhoon OCR 1.5 expects', () => {
  const r = edge.buildRequest('typhoon-ocr', 'data:image/jpeg;base64,AAAA');
  assert.equal(r.model, 'typhoon-ocr');
  assert.equal(r.messages[0].content[1].image_url.url, 'data:image/jpeg;base64,AAAA');
  assert.match(r.messages[0].content[0].text, /Extract all text from the image/);
  assert.equal(r.temperature, 0.1); assert.equal(r.repetition_penalty, 1.1);
});

test('edge: Retry-After is read as seconds or a date and kept within 1–120 s', () => {
  assert.equal(edge.retryAfterSeconds('7'), 7);
  assert.equal(edge.retryAfterSeconds(null), 20);
  assert.equal(edge.retryAfterSeconds('9999'), 120);
  assert.equal(edge.retryAfterSeconds(new Date(1_000_000 + 30_000).toUTCString(), 1_000_000), 30);
});

test('edge: GET says whether the cloud engine is configured; POST without a key or session is refused', async () => {
  const keep = { ...process.env };
  try {
    delete process.env.TYPHOON_API_KEY; delete process.env.SAND_GAS_URL;
    let r = await edge.default(new Request('https://x.test/api/ocr')); assert.equal((await r.json()).cloud, false);
    r = await edge.default(new Request('https://x.test/api/ocr', { method: 'POST', body: '{}' })); assert.equal(r.status, 503);
    process.env.TYPHOON_API_KEY = 'k'; process.env.SAND_GAS_URL = 'https://gas.test/exec';
    r = await edge.default(new Request('https://x.test/api/ocr')); assert.equal((await r.json()).cloud, true);
    r = await edge.default(new Request('https://x.test/api/ocr', { method: 'POST', body: 'not json' })); assert.equal(r.status, 400);
    r = await edge.default(new Request('https://x.test/api/ocr', { method: 'POST', body: JSON.stringify({ image: 'data:image/png;base64,AAAA' }) }));
    assert.equal(r.status, 401);                                                      // no session token: the key is never used
  } finally { for (const k of ['TYPHOON_API_KEY', 'SAND_GAS_URL']) { if (k in keep) process.env[k] = keep[k]; else delete process.env[k]; } }
});

/* ---------------------------------------------------------------- converters/ocr-cloud.js */

test('clean: figure descriptions and page numbers are removed, tables become one line per row', () => {
  const raw = 'ที่ สร 0123/456\n<figure>\nตราครุฑสีดำ เอกสารราชการ\n</figure>\nเรื่อง ขอเชิญประชุม\n<table><tr><th>ลำดับ</th><th>รายการ</th></tr><tr><td>1</td><td>ประชุม<br>ใหญ่</td></tr></table>\n<page_number>1</page_number>';
  const out = cloud.cleanTyphoonText(raw);
  assert.ok(!/ตราครุฑ|figure|page_number|<t/.test(out), out);
  assert.match(out, /^ที่ สร 0123\/456/);
  assert.match(out, /เรื่อง ขอเชิญประชุม/);
  assert.match(out, /ลำดับ \| รายการ\n1 \| ประชุม ใหญ่/);
});

test('clean: a surrounding code fence, entities and stray tags are dropped; checkboxes stay', () => {
  assert.equal(cloud.cleanTyphoonText('```markdown\nA &amp; B <b>bold</b> ☑ ทำแล้ว\n```'), 'A & B bold ☑ ทำแล้ว');
  assert.equal(cloud.cleanTyphoonText('ก\n<figure>ตัดกลางคัน'), 'ก');                  // unclosed figure at the end
  assert.equal(cloud.cleanTyphoonText(null), '');
  assert.equal(cloud.cleanTyphoonText('a < 5 และ b > 3'), 'a < 5 และ b > 3');         // comparison signs are not tags
});

test('usableText: needs a few real characters', () => {
  assert.equal(cloud.usableText(''), false); assert.equal(cloud.usableText('  .. \n'), false); assert.equal(cloud.usableText('เรื่อง ขอเชิญประชุม'), true);
});

test('failure: a 429 sets a wait, a bad key or lost session does not, and only a lost session is not retried locally', () => {
  assert.deepEqual(cloud.describeFailure({ code: 'RATE_LIMIT', retryAfter: 12 }, 429).wait, 12);
  assert.equal(cloud.describeFailure({ code: 'KEY_REJECTED' }, 502).wait, 0);
  assert.equal(cloud.describeFailure(null, 401).code, 'AUTH');
  assert.equal(cloud.describeFailure({ code: 'RATE_LIMIT', retryAfter: 500 }, 429).wait, 120);
  assert.match(cloud.describeFailure({ code: 'QUOTA' }, 502).message, /เครดิต/);
});

test('engine choice: invalid or missing values mean the private on-device engine', () => {
  assert.equal(cloud.getOcrEngine(), 'local');
  assert.equal(cloud.setOcrEngine('auto'), 'auto'); assert.equal(cloud.getOcrEngine(), 'auto');
  assert.equal(cloud.setOcrEngine('typhoon'), 'typhoon');
  assert.equal(cloud.setOcrEngine('gpt-9000'), 'local'); assert.equal(cloud.getOcrEngine(), 'local');
});

const okRes = (obj, status = 200) => ({ status, json: async () => obj });
const read = (fetchFn, mode = 'auto') => cloud.typhoonRead({}, { token: 't'.repeat(30), mode, fetchFn, imageToUrl: async () => 'data:image/jpeg;base64,AAAA' });

test('read: a good answer is cleaned and returned', async () => {
  cloud.resetCloudState();
  const r = await read(async () => okRes({ ok: true, text: 'เรื่อง ขอเชิญประชุมวิชาการ', model: 'typhoon-ocr' }));
  assert.equal(r.engine, 'typhoon'); assert.match(r.markdown, /ขอเชิญประชุม/);
});

test('read: in auto mode a 429 falls back at once and the next page does not even ask until the cooldown ends', async () => {
  cloud.resetCloudState(); let calls = 0;
  const f = async () => { calls += 1; return okRes({ ok: false, code: 'RATE_LIMIT', retryAfter: 30 }, 429); };
  await assert.rejects(read(f, 'auto'), (e) => e.code === 'CLOUD_FAILED' && e.fallback === true);
  await assert.rejects(read(f, 'auto'), (e) => e.code === 'CLOUD_COOLDOWN' && e.fallback === true);
  assert.equal(calls, 1);
  assert.ok(cloud.cloudCooldownMs() > 25000);
});

test('read: typhoon-only mode never claims success on failure — it throws with advice to switch mode', async () => {
  cloud.resetCloudState();
  await assert.rejects(read(async () => okRes({ ok: false, code: 'KEY_REJECTED' }, 502), 'typhoon'), (e) => e.code === 'CLOUD_FAILED' && /อัตโนมัติ/.test(e.message));
});

test('read: an empty answer or a dropped connection counts as a failure, not as a blank page', async () => {
  cloud.resetCloudState();
  await assert.rejects(read(async () => okRes({ ok: true, text: '<figure>x</figure>' })), (e) => e.code === 'CLOUD_FAILED');
  cloud.resetCloudState();
  await assert.rejects(read(async () => { throw new TypeError('fetch failed'); }), (e) => e.code === 'CLOUD_FAILED' && e.fallback === true);
});

test('read: the probe says whether the server has a key, and never throws', async () => {
  cloud.resetCloudState(); assert.equal(await cloud.cloudConfigured(async () => okRes({ cloud: true })), true);
  cloud.resetCloudState(); assert.equal(await cloud.cloudConfigured(async () => { throw new Error('offline'); }), false);
});
