// Upload keys (idempotency of archive copies) and the retry notice the screens show.
import test from 'node:test';
import assert from 'node:assert/strict';
import { uploadKey } from '../../src/js/core/files.js';

test('uploadKey: keeps the characters the backend accepts, so different files never share a key', () => {
  const ok = /^[\w.:-]{6,80}$/;
  const a = uploadKey('Ab12Cd', 'input', 1, 1000); const b = uploadKey('Zz99Yy', 'input', 1, 1000); const c = uploadKey('Ab12Cd', 'output', 1, 1000); const d = uploadKey('Ab12Cd', 'input', 2, 1000);
  [a, b, c, d].forEach((k) => assert.match(k, ok));
  assert.equal(new Set([a, b, c, d]).size, 4);
  assert.ok(a.includes('Ab12Cd'));
});
test('uploadKey: odd characters are replaced, length is capped, an empty log id still gives a valid key', () => {
  assert.match(uploadKey('a b/ü?', 'input', 1, 5), /^[\w.:-]{6,80}$/);
  assert.ok(uploadKey('x'.repeat(200), 'input', 1, 5).length <= 80);
  assert.match(uploadKey('', 'input', 1, 5), /^[\w.:-]{6,80}$/);
});
