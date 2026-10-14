// Small polyfills for features that the bundled pdf.js uses but older browsers (Chrome/Edge < 145, Firefox < 144, Safari < 26) lack.
for (const C of [Map, WeakMap]) {
  const p = C.prototype;
  if (!p.getOrInsert) Object.defineProperty(p, 'getOrInsert', { value(k, v) { if (!this.has(k)) this.set(k, v); return this.get(k); }, writable: true, configurable: true });
  if (!p.getOrInsertComputed) Object.defineProperty(p, 'getOrInsertComputed', { value(k, f) { if (!this.has(k)) this.set(k, f(k)); return this.get(k); }, writable: true, configurable: true });
}

// Element.replaceChildren(...) turns null / undefined / false into the TEXT "null" / "undefined" / "false" (unlike h()), and does not flatten arrays.
// The pages pass conditional children such as `cond ? h(...) : null`, so drop the empty values here once instead of in every call.
{
  const native = Element.prototype.replaceChildren;
  if (native && !native.__sandSafe) {
    const safe = function replaceChildren(...nodes) { return native.apply(this, nodes.flat(Infinity).filter((n) => n !== null && n !== undefined && n !== false)); };
    safe.__sandSafe = true;
    Object.defineProperty(Element.prototype, 'replaceChildren', { value: safe, writable: true, configurable: true });
  }
}
