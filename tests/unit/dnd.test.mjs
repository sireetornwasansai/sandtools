// A file dropped on a page's own drop zone must stay with that page; only an unhandled drop is routed to a tool by main.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { routableDrop } from '../../src/js/core/dnd.js';

const file = { name: 'letter.pdf' };
const ev = (o = {}) => ({ defaultPrevented: false, dataTransfer: { types: ['Files'], files: [file] }, ...o });

test('routableDrop: an unhandled file drop is routed (first file)', () => assert.equal(routableDrop(ev()), file));
test('routableDrop: a drop a page zone already handled (preventDefault) is NOT routed to another tool', () => assert.equal(routableDrop(ev({ defaultPrevented: true })), null));
test('routableDrop: text/link drags and empty drops are ignored', () => {
  assert.equal(routableDrop(ev({ dataTransfer: { types: ['text/plain'], files: [] } })), null);
  assert.equal(routableDrop(ev({ dataTransfer: { types: ['Files'], files: [] } })), null);
  assert.equal(routableDrop({ defaultPrevented: false }), null);
});
