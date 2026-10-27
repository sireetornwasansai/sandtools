// api/line.js (Vercel edge relay for the LINE webhook): signature check + slimming of events. No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const src = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'api', 'line.js');
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'line-edge-')), 'line.mjs');
fs.copyFileSync(src, tmp);                                   // the repo has no "type":"module" for api/, so import a .mjs copy
const { verifySignature, slim, refusal } = await import(pathToFileURL(tmp).href);

const sign = (secret, body) => crypto.createHmac('sha256', secret).update(body).digest('base64');

test('signature: only the real HMAC-SHA256 of the raw body is accepted', async () => {
  const body = Buffer.from('{"events":[]}');
  assert.equal(await verifySignature('s3cret', body, sign('s3cret', body)), true);
  assert.equal(await verifySignature('s3cret', body, sign('other', body)), false);
  assert.equal(await verifySignature('s3cret', Buffer.from('{"events":[1]}'), sign('s3cret', body)), false);
  assert.equal(await verifySignature('', body, sign('', body)), false);        // no secret configured = nothing is trusted
  assert.equal(await verifySignature('s3cret', body, ''), false);
});

test('slim: keeps text / postback / follow / unfollow / join only, drops stickers, images and non-active events', () => {
  const src = { type: 'user', userId: 'U1' };
  const out = slim({ events: [
    { type: 'message', webhookEventId: 'a', replyToken: 'r1', source: src, message: { type: 'text', text: 'สัปดาห์นี้ใครลา' } },
    { type: 'message', webhookEventId: 'b', replyToken: 'r2', source: src, message: { type: 'sticker' } },
    { type: 'message', webhookEventId: 'c', replyToken: 'r3', source: src, message: { type: 'image' } },
    { type: 'postback', webhookEventId: 'd', replyToken: 'r4', source: src, postback: { data: 'action=leave_next_week' } },
    { type: 'follow', webhookEventId: 'e', replyToken: 'r5', source: src },
    { type: 'unfollow', webhookEventId: 'f', source: src },
    { type: 'join', webhookEventId: 'g', replyToken: 'r6', source: { type: 'group', groupId: 'C1' } },
    { type: 'message', mode: 'standby', webhookEventId: 'h', source: src, message: { type: 'text', text: 'x' } },
    { type: 'beacon', webhookEventId: 'i', source: src }
  ] });
  assert.deepEqual(out.map((e) => e.id), ['a', 'd', 'e', 'f', 'g']);
  assert.equal(out[0].text, 'สัปดาห์นี้ใครลา'); assert.equal(out[1].data, 'action=leave_next_week');
  assert.equal(out[4].source.groupId, 'C1');
  assert.ok(!('message' in out[0]) && !('profile' in out[0]));
});

test('slim: long text is cut, control characters are removed, at most 20 events, garbage is ignored', () => {
  const ev = (i) => ({ type: 'message', webhookEventId: 'x' + i, source: { type: 'user', userId: 'U1' }, message: { type: 'text', text: 'a\u0000b' + 'z'.repeat(500) } });
  const out = slim({ events: Array.from({ length: 50 }, (_, i) => ev(i)) });
  assert.equal(out.length, 20); assert.ok(out[0].text.length <= 200); assert.ok(!out[0].text.includes('\u0000'));
  assert.deepEqual(slim(null), []); assert.deepEqual(slim({ events: 'nope' }), []); assert.deepEqual(slim({ events: [null, 5, 'x'] }), []);
});


test('refusal: tells the admin WHY a call is refused (header x-sand-reason) without leaking anything', async () => {
  const good = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';                          // a channel secret is 32 hex characters
  const body = Buffer.from('{"events":[]}');                                // what the Verify button sends
  assert.equal(await refusal('', body, sign(good, body)), 'no-secret');
  assert.equal(await refusal('eyJhbGciOi-this-is-an-access-token-not-a-secret', body, 'x'), 'bad-secret');
  assert.equal(await refusal(good, body, ''), 'no-signature');
  assert.equal(await refusal(good, body, sign('ffffffffffffffffffffffffffffffff', body)), 'bad-signature');
  assert.equal(await refusal(good, body, sign(good, body)), '');
});

test('slim: the date chosen in the LINE date picker is passed on (and only if it is a plain date)', () => {
  const src = { type: 'user', userId: 'U1' };
  const out = slim({ events: [
    { type: 'postback', webhookEventId: 'p1', replyToken: 'r', source: src, postback: { data: 'action=leave_pick', params: { date: '2026-11-05' } } },
    { type: 'postback', webhookEventId: 'p2', replyToken: 'r', source: src, postback: { data: 'action=leave_pick', params: { date: '5 Nov <script>' } } },
    { type: 'postback', webhookEventId: 'p3', replyToken: 'r', source: src, postback: { data: 'action=leave_day&date=2026-11-04' } }
  ] });
  assert.equal(out[0].date, '2026-11-05'); assert.ok(!('date' in out[1])); assert.ok(!('date' in out[2])); assert.equal(out[2].data, 'action=leave_day&date=2026-11-04');
});
