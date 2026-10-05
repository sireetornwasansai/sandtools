// Small polyfills for features that the bundled pdf.js uses but older browsers (Chrome/Edge < 145, Firefox < 144, Safari < 26) lack.
for (const C of [Map, WeakMap]) {
  const p = C.prototype;
  if (!p.getOrInsert) Object.defineProperty(p, 'getOrInsert', { value(k, v) { if (!this.has(k)) this.set(k, v); return this.get(k); }, writable: true, configurable: true });
  if (!p.getOrInsertComputed) Object.defineProperty(p, 'getOrInsertComputed', { value(k, f) { if (!this.has(k)) this.set(k, f(k)); return this.get(k); }, writable: true, configurable: true });
}
