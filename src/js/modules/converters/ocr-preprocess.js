// Image clean-up before OCR (pure functions on a grayscale plane — no DOM, so they are unit-testable in Node).
// Thai is the hard case for OCR: tone marks and vowels sit above/below the line and are only 2–4 px at low resolution, so a photo of a
// letter (uneven light, slight tilt, low dpi) loses them first. The steps below fix exactly that, in this order:
//   gray → flatten uneven lighting → stretch contrast → straighten (deskew) → scale up to ≥ ~300 dpi equivalent.
// A "plane" is {w, h, d: Uint8ClampedArray} with one byte per pixel.

/** RGBA → gray plane (Rec.601 luma). Fully transparent pixels count as white. */
export function toGray(rgba, w, h) {
  const d = new Uint8ClampedArray(w * h);
  for (let i = 0, j = 0; i < d.length; i += 1, j += 4) {
    const a = rgba[j + 3] / 255;
    const y = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
    d[i] = y * a + 255 * (1 - a);
  }
  return { w, h, d };
}

/** gray plane → RGBA (opaque). */
export function toRgba(p) {
  const out = new Uint8ClampedArray(p.w * p.h * 4);
  for (let i = 0, j = 0; i < p.d.length; i += 1, j += 4) { out[j] = out[j + 1] = out[j + 2] = p.d[i]; out[j + 3] = 255; }
  return out;
}

/** Box-average downscale by integer factor f. */
function shrink(p, f) {
  const w = Math.max(1, Math.floor(p.w / f)), h = Math.max(1, Math.floor(p.h / f));
  const d = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    let s = 0, n = 0;
    for (let yy = y * f; yy < y * f + f && yy < p.h; yy += 1) for (let xx = x * f; xx < x * f + f && xx < p.w; xx += 1) { s += p.d[yy * p.w + xx]; n += 1; }
    d[y * w + x] = s / n;
  }
  return { w, h, d };
}

/** Sliding max then min (grey closing) with square radius r — wipes out dark text so only the paper/lighting remains. */
function closing(p, r) {
  const pass = (src, w, h, horizontal, useMax) => {
    const out = new Uint8ClampedArray(src.length);
    const len = horizontal ? w : h, lines = horizontal ? h : w;
    for (let l = 0; l < lines; l += 1) {
      for (let i = 0; i < len; i += 1) {
        let v = useMax ? 0 : 255;
        const a = Math.max(0, i - r), b = Math.min(len - 1, i + r);
        for (let k = a; k <= b; k += 1) { const q = src[horizontal ? l * w + k : k * w + l]; if (useMax ? q > v : q < v) v = q; }
        out[horizontal ? l * w + i : i * w + l] = v;
      }
    }
    return out;
  };
  let d = p.d;
  d = pass(d, p.w, p.h, true, true); d = pass(d, p.w, p.h, false, true);   // dilate
  d = pass(d, p.w, p.h, true, false); d = pass(d, p.w, p.h, false, false); // erode
  return { w: p.w, h: p.h, d };
}

function blur3(p) {
  const out = new Uint8ClampedArray(p.d.length), { w, h, d } = p;
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    let s = 0, n = 0;
    for (let yy = Math.max(0, y - 1); yy <= Math.min(h - 1, y + 1); yy += 1) for (let xx = Math.max(0, x - 1); xx <= Math.min(w - 1, x + 1); xx += 1) { s += d[yy * w + xx]; n += 1; }
    out[y * w + x] = s / n;
  }
  return { w, h, d: out };
}

/** Bilinear sample helper for upscaling the low-res background back to full size. */
function bilinear(p, x, y) {
  x = Math.min(Math.max(x, 0), p.w - 1); y = Math.min(Math.max(y, 0), p.h - 1);
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(p.w - 1, x0 + 1), y1 = Math.min(p.h - 1, y0 + 1), fx = x - x0, fy = y - y0;
  const a = p.d[y0 * p.w + x0], b = p.d[y0 * p.w + x1], c = p.d[y1 * p.w + x0], e = p.d[y1 * p.w + x1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + e * fx) * fy;
}

/**
 * Remove uneven lighting / shadows / yellow paper tint: estimate the paper brightness at low resolution (grey closing + blur) and divide it out.
 * Text stays dark, the background becomes uniformly white.
 */
export function flattenIllumination(p) {
  const f = Math.max(2, Math.round(Math.max(p.w, p.h) / 400));
  const small = shrink(p, f);
  const r = Math.max(2, Math.round(small.w / 60));       // must be wider than a stroke, narrower than the lighting gradient
  const bg = blur3(blur3(closing(small, r)));
  const d = new Uint8ClampedArray(p.d.length);
  for (let y = 0; y < p.h; y += 1) for (let x = 0; x < p.w; x += 1) {
    const b = Math.max(40, bilinear(bg, (x + 0.5) / f - 0.5, (y + 0.5) / f - 0.5));
    d[y * p.w + x] = Math.min(255, (p.d[y * p.w + x] * 255) / b);
  }
  return { w: p.w, h: p.h, d };
}

/** Percentile contrast stretch: darkest 0.5 % → 0, paper level → 255. */
export function stretchContrast(p, lowPct = 0.005) {
  const hist = new Uint32Array(256); for (const v of p.d) hist[v] += 1;
  const total = p.d.length; let acc = 0, lo = 0;
  for (; lo < 255; lo += 1) { acc += hist[lo]; if (acc >= total * lowPct) break; }
  // paper level = most common bright value
  let hi = 255, best = 0; for (let v = 128; v < 256; v += 1) if (hist[v] > best) { best = hist[v]; hi = v; }
  hi = Math.max(hi, lo + 40);
  const d = new Uint8ClampedArray(p.d.length), k = 255 / (hi - lo);
  for (let i = 0; i < d.length; i += 1) d[i] = (p.d[i] - lo) * k;
  return { w: p.w, h: p.h, d };
}

/** Otsu threshold of a plane (0–255). */
export function otsu(p) {
  const hist = new Uint32Array(256); for (const v of p.d) hist[v] += 1;
  const total = p.d.length; let sum = 0; for (let i = 0; i < 256; i += 1) sum += i * hist[i];
  let wB = 0, sB = 0, best = 0, th = 128;
  for (let t = 0; t < 256; t += 1) {
    wB += hist[t]; if (!wB) continue; const wF = total - wB; if (!wF) break;
    sB += t * hist[t]; const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
    if (v > best) { best = v; th = t; }
  }
  return th;
}

/**
 * Estimate the skew angle (degrees, −maxDeg…+maxDeg) of a page of text: the angle at which the horizontal ink projection is "sharpest".
 * Runs on a ~600 px wide copy so it costs a few milliseconds.
 */
export function estimateSkew(p, maxDeg = 4, step = 0.25) {
  const f = Math.max(1, Math.round(p.w / 600)), s = shrink(p, f), th = otsu(s) + 1;
  const pts = []; for (let y = 0; y < s.h; y += 1) for (let x = 0; x < s.w; x += 1) if (s.d[y * s.w + x] < th) pts.push(x, y);
  if (pts.length < 200) return 0;
  const cx = s.w / 2, cy = s.h / 2; let best = -1, bestA = 0;
  const score = (a) => {
    const t = (a * Math.PI) / 180, sn = Math.sin(t), cs = Math.cos(t), bins = new Float64Array(s.h * 2);
    for (let i = 0; i < pts.length; i += 2) { const yy = Math.round((pts[i + 1] - cy) * cs - (pts[i] - cx) * sn + s.h); if (yy >= 0 && yy < bins.length) bins[yy] += 1; }
    let v = 0; for (let i = 1; i < bins.length; i += 1) { const dd = bins[i] - bins[i - 1]; v += dd * dd; }
    return v;
  };
  for (let a = -maxDeg; a <= maxDeg + 1e-9; a += step) { const v = score(a); if (v > best) { best = v; bestA = a; } }
  // a tie-ish result (no clear text lines) is not worth rotating for
  return Math.abs(bestA) < 0.3 ? 0 : bestA;
}

/** Rotate by `deg` degrees about the centre (bilinear), filling with white. Use the angle estimateSkew returns: rotating by it makes the text lines horizontal. */
export function rotate(p, deg) {
  if (!deg) return p;
  const t = (deg * Math.PI) / 180, sn = Math.sin(t), cs = Math.cos(t), cx = p.w / 2, cy = p.h / 2, d = new Uint8ClampedArray(p.d.length);
  for (let y = 0; y < p.h; y += 1) for (let x = 0; x < p.w; x += 1) {
    const dx = x - cx, dy = y - cy, sx = cs * dx - sn * dy + cx, sy = sn * dx + cs * dy + cy;
    d[y * p.w + x] = sx < 0 || sy < 0 || sx > p.w - 1 || sy > p.h - 1 ? 255 : bilinear(p, sx, sy);
  }
  return { w: p.w, h: p.h, d };
}

/** Bilinear resize to (w,h). */
export function resize(p, w, h) {
  const d = new Uint8ClampedArray(w * h), kx = p.w / w, ky = p.h / h;
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) d[y * w + x] = bilinear(p, (x + 0.5) * kx - 0.5, (y + 0.5) * ky - 0.5);
  return { w, h, d };
}

/** Light unsharp mask — restores stroke edges that scaling/JPEG softened. */
export function sharpen(p, amount = 0.6) {
  const b = blur3(p), d = new Uint8ClampedArray(p.d.length);
  for (let i = 0; i < d.length; i += 1) d[i] = p.d[i] + amount * (p.d[i] - b.d[i]);
  return { w: p.w, h: p.h, d };
}

/** Text-line band height (px) OCR likes best: tall enough that Thai tone marks are ≥ 4–5 px, small enough to stay fast. */
export const TARGET_BAND = 70;
export const MAX_SIDE = 4600;

/**
 * Median height of the text-line bands (rows that contain ink), in px. A 16 pt Thai letter at 300 dpi gives ≈ 60–70; a phone photo of
 * the same sheet at 100 dpi gives ≈ 20. Returns 0 when no clear lines are found (then the caller falls back to the page width).
 */
export function textBandHeight(p) {
  const th = otsu(p) + 1, rows = new Uint32Array(p.h);
  for (let y = 0; y < p.h; y += 1) { let c = 0; for (let x = 0, o = y * p.w; x < p.w; x += 1) if (p.d[o + x] < th) c += 1; rows[y] = c; }
  const cut = Math.max(2, p.w * 0.004), runs = []; let start = -1;
  for (let y = 0; y <= p.h; y += 1) {
    const on = y < p.h && rows[y] >= cut;
    if (on && start < 0) start = y; else if (!on && start >= 0) { if (y - start >= 6) runs.push(y - start); start = -1; }
  }
  if (runs.length < 4) return 0;
  runs.sort((a, b) => a - b); return runs[Math.floor(runs.length / 2)];
}

/** True when ≥ 97 % of the pixels are (nearly) pure black or white — a scanner/fax already thresholded the page. */
export function isBilevel(p) {
  let n = 0; for (const v of p.d) if (v <= 20 || v >= 235) n += 1;
  return n / p.d.length >= 0.97;
}

/** Share of dark pixels that have no dark neighbour (salt-and-pepper noise of a bad fax/photocopy). Clean text is ≈ 0. */
export function speckle(p) {
  const th = 128; let ink = 0, lone = 0;
  for (let y = 1; y < p.h - 1; y += 1) for (let x = 1; x < p.w - 1; x += 1) {
    const i = y * p.w + x; if (p.d[i] >= th) continue; ink += 1;
    if (p.d[i - 1] >= th && p.d[i + 1] >= th && p.d[i - p.w] >= th && p.d[i + p.w] >= th) lone += 1;
  }
  return ink ? lone / ink : 0;
}

/**
 * Full pipeline. `opt.deskew` / `opt.flatten` / `opt.scale` default on. Returns {plane, skew, scaled, steps}.
 * Never throws for odd input: a plane too small to process is returned as is.
 */
export function preprocess(p, opt = {}) {
  const steps = []; let cur = p;
  if (p.w < 32 || p.h < 32) return { plane: p, skew: 0, scaled: 1, steps };
  if (isBilevel(p) && speckle(p) > 0.03) return { plane: p, skew: 0, scaled: 1, steps: ['bilevel'] };   // 1-bit fax / thresholded scan: already clean, enlarging only magnifies its speckle
  if (opt.flatten !== false) { cur = flattenIllumination(cur); steps.push('flatten'); }
  cur = stretchContrast(cur); steps.push('contrast');
  let skew = 0;
  if (opt.deskew !== false) { skew = estimateSkew(cur); if (skew) { cur = rotate(cur, skew); steps.push('deskew'); } }
  let scaled = 1;
  if (opt.scale !== false) {
    const band = textBandHeight(cur);
    scaled = Math.min(band ? TARGET_BAND / band : 2480 / cur.w, 4, MAX_SIDE / Math.max(cur.w, cur.h));
    if (scaled > 1.05) {
      if (opt.denoise) { cur = blur3(cur); steps.push('denoise'); }   // speckled 1-bit fax/photocopy: smooth before enlarging, or the speckles become "letters"
      cur = resize(cur, Math.round(cur.w * scaled), Math.round(cur.h * scaled));
      if (!opt.denoise) cur = sharpen(cur);
      steps.push('scale');
    }
    else scaled = 1;
  }
  return { plane: cur, skew, scaled, steps };
}
