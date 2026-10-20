// Safe interpreter for the data-hr-click / data-hr-change / data-hr-input attributes of the HR page.
// SAND's CSP forbids inline onclick="…", so the markup carries a tiny subset of JavaScript instead: one or more calls separated by ";",
// each  name(arg, …)  where an argument is a quoted string (with \\' \\\\ \\n escapes), a number, true / false / null, `this`, `this.value` or `event`.
// Nothing is ever eval()ed — names are looked up in an explicit whitelist object (the page's own functions).

/** @param {string} src @returns {{name:string,args:any[]}[]} */
export function parseHandler(src) {
  const s = String(src || ''); const calls = []; let i = 0;
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i += 1; };
  const fail = () => { throw new Error('bad handler'); };
  const str = () => {
    const q = s[i]; i += 1; let out = '';
    while (i < s.length && s[i] !== q) {
      if (s[i] === '\\') { i += 1; const c = s[i]; out += c === 'n' ? '\n' : c === 't' ? '\t' : c; } else out += s[i];
      i += 1;
    }
    if (s[i] !== q) fail(); i += 1; return { t: 'str', v: out };
  };
  while (true) {
    ws(); if (i >= s.length) break;
    const m = /^[A-Za-z_$][\w$]*/.exec(s.slice(i)); if (!m) fail();
    const name = m[0]; i += name.length; ws(); if (s[i] !== '(') fail(); i += 1;
    const args = []; ws();
    if (s[i] === ')') i += 1; else {
      while (true) {
        ws(); const c = s[i];
        if (c === "'" || c === '"') args.push(str());
        else {
          const t = /^(this\.value|this|event|true|false|null|-?\d+(?:\.\d+)?)/.exec(s.slice(i)); if (!t) fail();
          i += t[0].length; const v = t[0];
          args.push(v === 'this.value' ? { t: 'value' } : v === 'this' ? { t: 'this' } : v === 'event' ? { t: 'event' } : v === 'true' ? { t: 'lit', v: true } : v === 'false' ? { t: 'lit', v: false } : v === 'null' ? { t: 'lit', v: null } : { t: 'lit', v: Number(v) });
        }
        ws();
        if (s[i] === ',') { i += 1; continue; }
        if (s[i] === ')') { i += 1; break; }
        fail();
      }
    }
    calls.push({ name, args }); ws();
    if (s[i] === ';') { i += 1; continue; }
    if (i < s.length) fail();
  }
  return calls;
}

/** Run parsed calls against the whitelist `H`; `ctx` = {event, el}. Unknown names are ignored (reported to `onError`). */
export function runHandler(src, H, ctx, onError) {
  let calls; try { calls = parseHandler(src); } catch (e) { if (onError) onError(e); return false; }
  for (const c of calls) {
    if (!Object.prototype.hasOwnProperty.call(H, c.name) || typeof H[c.name] !== 'function') { if (onError) onError(new Error(`unknown handler ${c.name}`)); continue; }
    const args = c.args.map((a) => (a.t === 'str' || a.t === 'lit' ? a.v : a.t === 'event' ? ctx.event : a.t === 'this' ? ctx.el : ctx.el && 'value' in ctx.el ? ctx.el.value : undefined));
    try { H[c.name](...args); } catch (e) { if (onError) onError(e); }
  }
  return true;
}
