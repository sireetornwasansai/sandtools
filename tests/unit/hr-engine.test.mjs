import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHandler, runHandler } from '../../src/js/modules/hr-engine.js';

test('parseHandler: quoted strings with escapes, several calls, this / event', () => {
  const c = parseHandler("deleteStaff('O\\'Neil \"x\" \\\\'); closeAllMenus(); go(this.value, event, 3, true)");
  assert.equal(c[0].name, 'deleteStaff'); assert.equal(c[0].args[0].v, 'O\'Neil "x" \\');
  assert.equal(c.length, 3); assert.deepEqual(c[2].args.map((a) => a.t), ['value', 'event', 'lit', 'lit']);
});
test('runHandler only calls whitelisted functions and never evals', () => {
  const seen = []; const H = { ok: (a) => seen.push(a) };
  runHandler("ok('1'); alert('2'); constructor('3')", H, {}, () => {});
  assert.deepEqual(seen, ['1']);
  assert.equal(runHandler("fetch('x').then(y)", H, {}, () => {}), false);
});
