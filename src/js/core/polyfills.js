// Small polyfills for features that the bundled pdf.js uses but older browsers (Chrome/Edge < 145, Firefox < 144, Safari < 26) lack.
for (const C of [Map, WeakMap]) {
  const p = C.prototype;
  if (!p.getOrInsert) Object.defineProperty(p, 'getOrInsert', { value(k, v) { if (!this.has(k)) this.set(k, v); return this.get(k); }, writable: true, configurable: true });
  if (!p.getOrInsertComputed) Object.defineProperty(p, 'getOrInsertComputed', { value(k, f) { if (!this.has(k)) this.set(k, f(k)); return this.get(k); }, writable: true, configurable: true });
}

// Element.replaceChildren(...) turns null / undefined / false into the TEXT "null" / "undefined" / "false" (unlike h()), and does not flatten arrays.
// The pages pass conditional children such as `cond ? h(...) : null`, so drop the empty values here once instead of in every call.
// NOTE: this file is ALSO imported by the pdf.js Web Worker (vendor/pdf.worker.shim.mjs), where there is no DOM at all.
// Everything that touches `Element` / `document` must be guarded, otherwise the worker dies at start-up, pdf.js falls back to a
// "fake worker" and every PDF conversion fails with "ไฟล์ PDF เสียหายหรือเปิดไม่ได้" (Setting up fake worker failed).
if (typeof Element !== 'undefined') {
  const native = Element.prototype.replaceChildren;
  if (native && !native.__sandSafe) {
    const safe = function replaceChildren(...nodes) { return native.apply(this, nodes.flat(Infinity).filter((n) => n !== null && n !== undefined && n !== false)); };
    safe.__sandSafe = true;
    Object.defineProperty(Element.prototype, 'replaceChildren', { value: safe, writable: true, configurable: true });
  }
}

// ---- ECMAScript / Web API features used by the bundled pdf.js 5.x and its worker. Each one is added ONLY when missing,
// so modern browsers are untouched. Must work without a DOM (this file runs inside the pdf.js worker too).
const def = (obj, name, value) => { if (obj && !(name in obj)) Object.defineProperty(obj, name, { value, writable: true, configurable: true }); };
if (typeof Uint8Array !== 'undefined') {
  const P = Uint8Array.prototype;
  const bad = () => new SyntaxError('Invalid encoded string');
  def(P, 'toHex', function toHex() { let s = ''; for (let i = 0; i < this.length; i++) s += this[i].toString(16).padStart(2, '0'); return s; });
  def(P, 'toBase64', function toBase64(opts) {
    const url = !!(opts && opts.alphabet === 'base64url'); const omit = !!(opts && opts.omitPadding);
    let bin = ''; for (let i = 0; i < this.length; i += 0x8000) bin += String.fromCharCode.apply(null, this.subarray(i, i + 0x8000));
    let out = btoa(bin); if (url) out = out.replace(/\+/g, '-').replace(/\//g, '_'); if (omit) out = out.replace(/=+$/, '');
    return out;
  });
  def(P, 'setFromHex', function setFromHex(str) {
    if (str.length % 2) throw bad(); const n = Math.min(str.length / 2, this.length);
    for (let i = 0; i < n; i++) { const v = parseInt(str.substr(i * 2, 2), 16); if (Number.isNaN(v)) throw bad(); this[i] = v; }
    return { read: n * 2, written: n };
  });
  def(Uint8Array, 'fromHex', function fromHex(str) {
    if (str.length % 2) throw bad(); const out = new Uint8Array(str.length / 2);
    for (let i = 0; i < out.length; i++) { const v = parseInt(str.substr(i * 2, 2), 16); if (Number.isNaN(v)) throw bad(); out[i] = v; }
    return out;
  });
  def(Uint8Array, 'fromBase64', function fromBase64(str) {
    const bin = atob(String(str).replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '')); const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out;
  });
}
if (typeof Promise !== 'undefined') {
  def(Promise, 'withResolvers', function withResolvers() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; });
  def(Promise, 'try', function (fn, ...args) { return new Promise((res) => res(fn(...args))); });
}
if (typeof Blob !== 'undefined') def(Blob.prototype, 'bytes', function bytes() { return this.arrayBuffer().then((b) => new Uint8Array(b)); });
if (typeof Response !== 'undefined') def(Response.prototype, 'bytes', function bytes() { return this.arrayBuffer().then((b) => new Uint8Array(b)); });
if (typeof URL !== 'undefined') def(URL, 'parse', function parse(u, base) { try { return new URL(u, base); } catch { return null; } });
def(Math, 'sumPrecise', function sumPrecise(arr) { let s = 0, c = 0; for (const x of arr) { const y = x - c; const t = s + y; c = (t - s) - y; s = t; } return s; });
def(Array, 'fromAsync', async function fromAsync(it, map) { const out = []; let i = 0; for await (const v of it) out.push(map ? await map(v, i++) : v); return out; });
def(Array.prototype, 'findLast', function findLast(fn, t) { for (let i = this.length - 1; i >= 0; i--) if (fn.call(t, this[i], i, this)) return this[i]; return undefined; });
def(Array.prototype, 'findLastIndex', function findLastIndex(fn, t) { for (let i = this.length - 1; i >= 0; i--) if (fn.call(t, this[i], i, this)) return i; return -1; });
def(Array.prototype, 'at', function at(n) { n = Math.trunc(n) || 0; if (n < 0) n += this.length; return this[n]; });
def(Object, 'hasOwn', function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); });
// Iterator helpers (Chrome 122+, Safari 18.4+): pdf.js calls .some() / .map() ... directly on Map / Set iterators.
{
  const IterProto = Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]()));
  const helpers = {
    some(fn) { let i = 0; for (const v of this) if (fn(v, i++)) return true; return false; },
    every(fn) { let i = 0; for (const v of this) if (!fn(v, i++)) return false; return true; },
    find(fn) { let i = 0; for (const v of this) if (fn(v, i++)) return v; return undefined; },
    forEach(fn) { let i = 0; for (const v of this) fn(v, i++); },
    reduce(fn, init) { let i = 0; let acc = init; let first = arguments.length < 2; for (const v of this) { if (first) { acc = v; first = false; i++; continue; } acc = fn(acc, v, i++); } return acc; },
    toArray() { return Array.from(this); },
    map(fn) { const it = this; return (function* () { let i = 0; for (const v of it) yield fn(v, i++); })(); },
    filter(fn) { const it = this; return (function* () { let i = 0; for (const v of it) if (fn(v, i++)) yield v; })(); },
    take(n) { const it = this; return (function* () { let i = 0; if (n <= 0) return; for (const v of it) { yield v; if (++i >= n) return; } })(); },
    drop(n) { const it = this; return (function* () { let i = 0; for (const v of it) { if (i++ >= n) yield v; } })(); },
    flatMap(fn) { const it = this; return (function* () { let i = 0; for (const v of it) yield* fn(v, i++); })(); }
  };
  if (IterProto) for (const [k, fn] of Object.entries(helpers)) def(IterProto, k, fn);
}
