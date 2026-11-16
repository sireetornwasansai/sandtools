// v1.21: Saraban op "ocr" — Typhoon OCR relay (key stays in Script Properties; off unless TYPHOON_API_KEY is set; staff only; images only)
import test from 'node:test';
import assert from 'node:assert/strict';
import { env } from './helpers/saraban-env.mjs';

const C = 'clerk@x.go.th';
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]).toString('base64');
const PDF = Buffer.from('%PDF-1.4 hello').toString('base64');
const reply = (code, body) => ({ getResponseCode: () => code, getContentText: () => (typeof body === 'string' ? body : JSON.stringify(body)) });
const ok = (content) => reply(200, { choices: [{ message: { content } }] });

function setup(props = { TYPHOON_API_KEY: 'sk-test' }, answer = ok('ที่ สธ 0208.02/ว 10440\nเรื่อง ขอเชิญประชุม')) {
  const e = env(props); const seen = [];
  e.ctx.UrlFetchApp = { fetch(url, o) { seen.push({ url, o, body: JSON.parse(o.payload) }); return typeof answer === 'function' ? answer() : answer; } };
  return { e, seen };
}
const fails = (e, who, body, code) => assert.throws(() => e.call(who, 'ocr', body), (x) => x.code === code, `expected ${code}`);

test('off by default: no TYPHOON_API_KEY → NOT_CONFIGURED, and config says typhoon is off', () => {
  const { e, seen } = setup({});
  fails(e, C, { data: JPG }, 'NOT_CONFIGURED'); assert.equal(seen.length, 0);
  assert.equal(e.call(C, 'config', {}).ocr.typhoon, false);
});

test('config tells the page Typhoon is on when the key is set (and never leaks the key)', () => {
  const { e } = setup(); const cfg = e.call(C, 'config', {});
  assert.equal(cfg.ocr.typhoon, true); assert.ok(!JSON.stringify(cfg).includes('sk-test'));
});

test('only staff may use it; only JPG/PNG page images; size capped', () => {
  const { e, seen } = setup();
  fails(e, 'nobody@x.go.th', { data: JPG }, 'FORBIDDEN');
  fails(e, C, { data: PDF }, 'BAD_FILE');
  fails(e, C, {}, 'BAD_REQUEST');
  fails(e, C, { data: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(3 * 1024 * 1024)]).toString('base64') }, 'FILE_TOO_LARGE');
  assert.equal(seen.length, 0, 'nothing is forwarded for a refused request');
});

test('success: forwards the page to Typhoon with the official v1.5 prompt, key in the header only, and returns the text', () => {
  const { e, seen } = setup(); const r = e.call(C, 'ocr', { data: JPG });
  assert.equal(r.text, 'ที่ สธ 0208.02/ว 10440\nเรื่อง ขอเชิญประชุม'); assert.equal(r.model, 'typhoon-ocr');
  const s = seen[0];
  assert.equal(s.url, 'https://api.opentyphoon.ai/v1/chat/completions'); assert.equal(s.o.headers.Authorization, 'Bearer sk-test');
  assert.ok(!s.o.payload.includes('sk-test'), 'the key is not in the body');
  assert.equal(s.body.model, 'typhoon-ocr'); assert.equal(s.body.temperature, 0.1); assert.equal(s.body.top_p, 0.6); assert.equal(s.body.repetition_penalty, 1.1);
  const [txt, img] = s.body.messages[0].content;
  assert.match(txt.text, /^Extract all text from the image\./); assert.match(txt.text, /<page_number>/); assert.match(txt.text, /Describe in Thai\./);
  assert.ok(img.image_url.url.startsWith('data:image/jpeg;base64,'));
});

test('older models answer {"natural_text": …} and some wrap the answer in a code fence — both are unwrapped', () => {
  assert.equal(setup(undefined, ok(JSON.stringify({ natural_text: 'เรื่อง ทดสอบ' }))).e.call(C, 'ocr', { data: JPG }).text, 'เรื่อง ทดสอบ');
  assert.equal(setup(undefined, ok('```markdown\nเรื่อง ทดสอบ\n```')).e.call(C, 'ocr', { data: JPG }).text, 'เรื่อง ทดสอบ');
});

test('model and base URL can be overridden (https only — an http URL is ignored)', () => {
  const a = setup({ TYPHOON_API_KEY: 'k', TYPHOON_OCR_MODEL: 'typhoon-ocr-1.5', TYPHOON_BASE_URL: 'https://ocr.example.go.th/v1/' }); a.e.call(C, 'ocr', { data: JPG });
  assert.equal(a.seen[0].url, 'https://ocr.example.go.th/v1/chat/completions'); assert.equal(a.seen[0].body.model, 'typhoon-ocr-1.5');
  const b = setup({ TYPHOON_API_KEY: 'k', TYPHOON_BASE_URL: 'http://evil.example/v1' }); b.e.call(C, 'ocr', { data: JPG });
  assert.equal(b.seen[0].url, 'https://api.opentyphoon.ai/v1/chat/completions');
});

test('service problems map to codes the page treats as "read on this device instead", without echoing the service reply', () => {
  fails(setup(undefined, reply(401, 'bad key sk-test')).e, C, { data: JPG }, 'OCR_AUTH');
  fails(setup(undefined, reply(403, '{}')).e, C, { data: JPG }, 'OCR_AUTH');
  fails(setup(undefined, reply(429, '{}')).e, C, { data: JPG }, 'OCR_BUSY');
  fails(setup(undefined, reply(500, 'oops')).e, C, { data: JPG }, 'OCR_FAILED');
  fails(setup(undefined, () => { throw new Error('timeout'); }).e, C, { data: JPG }, 'OCR_FAILED');
  fails(setup(undefined, ok('   ')).e, C, { data: JPG }, 'OCR_EMPTY');
  fails(setup(undefined, reply(200, 'not json')).e, C, { data: JPG }, 'OCR_EMPTY');
  const { e } = setup(undefined, reply(500, 'secret page text')); try { e.call(C, 'ocr', { data: JPG }); } catch (x) { assert.ok(!/secret page text/.test(x.message)); }
});

test('Code.gs lets an ocr request (one page image) through the body limit like an upload', async () => {
  const { readFileSync } = await import('node:fs'); const src = readFileSync(new URL('../gas/Code.gs', import.meta.url), 'utf8');
  assert.match(src, /isSarUp = body\.action === 'saraban' && \(body\.op === 'upload' \|\| body\.op === 'ocr'\)/);
});
