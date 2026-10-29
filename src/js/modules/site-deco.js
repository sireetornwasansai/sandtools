// Drawing helpers for the 3D home page (site-sim.js) — canvas 2D only, no library:
//   layoutPlate / paintPlate  dark base plate standing on the floor at the foot of a model: system name · the usage number as embossed 3D digits (counts up) · the place (โรงพยาบาลสันทราย)
//   layoutSign  / paintSign   every other label: a sign on a post with a shadow on the ground — nothing floats in the air
//   placeSigns                moves overlapping signs / plates apart and drops unimportant ones when the screen is crowded (phones)
//   drawFigure  a person with head, neck, torso, two arms, two legs, hair and shoes; outfit and prop follow the ROLE (or the kind of person on the campus)
// Every function takes a drawing kit `g` built by site-sim.js (getters, because the camera / scale / theme change between frames):
//   { ctx, pal, font, tw, camZ, width, reduced }
// Pure drawing: nothing here reads the page, the network or any person's data. `seed` only picks hair / skin / build, so the same visitor looks the same every frame.

export const HOSPITAL_NAME = 'โรงพยาบาลสันทราย';

const fmt = (n) => Number(n || 0).toLocaleString('th-TH');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const isHex = (c) => /^#[0-9a-f]{6}$/i.test(String(c));
/** Lighter (f > 1) or darker (f < 1) version of a #rrggbb colour. Anything that is not a hex colour is returned unchanged. */
export function mix(c, f) {
  if (!isHex(c)) return c;
  const v = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  return `#${v.map((x) => Math.round(clamp(f <= 1 ? x * f : x + (255 - x) * (f - 1), 0, 255)).toString(16).padStart(2, '0')).join('')}`;
}

/* ------------------------------------------------------------------------------------------------ count-up */
const shown = new Map();
/** The value to DRAW: it runs up to `target` in about a third of a second, so a changing number is seen changing. Same value in = same value out when motion is reduced. */
export function eased(key, target, now, reduced) {
  let e = shown.get(key);
  if (!e) { if (shown.size > 300) shown.delete(shown.keys().next().value); e = { v: reduced ? target : 0, t: now }; shown.set(key, e); }
  if (reduced) { e.v = target; e.t = now; return target; }
  const dt = clamp(now - e.t, 0, 100); e.t = now;
  e.v += (target - e.v) * (1 - Math.pow(0.0015, dt / 1000));
  if (Math.abs(target - e.v) < 0.5) e.v = target;
  return e.v;
}
export const _resetEase = () => shown.clear();   // tests

/* ------------------------------------------------------------------------------------------------ signs & plates
 * Nothing floats: a base PLATE stands on the floor at the foot of a model (name · embossed 3D number · the hospital), and every other label is a SIGN on a post with a
 * shadow on the ground. planSigns() then moves overlapping ones apart (or drops the unimportant ones) so no label ever covers another. */
const fw = (g, size, weight, text) => { g.ctx.font = `${weight} ${size}px ${g.font}`; return g.ctx.measureText(text).width; };
function ellipsize(g, text, size, weight, maxW) {
  if (fw(g, size, weight, text) <= maxW) return text; let s = String(text);
  while (s.length > 2 && fw(g, size, weight, `${s}…`) > maxW) s = s.slice(0, -1);
  return `${s}…`;
}

/**
 * Measure a base plate. p = { key, name, sub (default: the hospital), col, value (number | null), approx, unit, online, status (word shown when value is null), sc, maxW, hov, dim }
 * Returns the drawable item { kind: 'plate', w, h, x, y, prio } — x, y = the floor point under the plate's centre-top.
 */
export function layoutPlate(g, p, now) {
  const kz = Math.pow(g.camZ, -0.6) * (p.sc || 1); const has = p.value !== undefined && p.value !== null; const sub = p.sub === undefined ? HOSPITAL_NAME : p.sub;
  const numText = has ? `${p.approx ? '≈' : ''}${fmt(Math.round(eased(p.key || p.name, p.value, now, g.reduced)))}` : '';
  const unit = has ? p.unit || '' : ''; const online = has && p.online > 0 ? `ออนไลน์ ${fmt(p.online)}` : ''; const stat = !has ? p.status || '' : '';
  const maxW = Math.max(150, p.maxW || g.tw * 3.9 * kz);
  let k = 1; let m;
  const measure = () => {
    const f1 = Math.max(10, g.tw * 0.135 * kz) * k; const f2 = Math.max(8.8, f1 * 0.78); const fn = f1 * 1.8; const bar = Math.max(3, f1 * 0.34); const padX = f1 * 0.7; const gap = f1 * 0.9;
    const name = p.name; const left = Math.max(fw(g, f1, 700, name), sub ? f2 * 1.5 + fw(g, f2, 600, sub) : 0);
    const capW = has ? fw(g, f2, 600, unit) + (online ? f2 * 1.9 + fw(g, f2, 700, online) : 0) : 0;
    const right = has ? Math.max(fw(g, fn, 800, numText) + fn * 0.12, capW) : stat ? fw(g, f2 * 1.1, 700, stat) + f2 : 0;
    const top = has ? fn * 1.05 : f1 * 1.25; const bottom = f2 * 1.45; const padY = f1 * 0.4;
    return { f1, f2, fn, bar, padX, gap, left, right, capW, name, w: padX * 2 + bar + f1 * 0.5 + left + (right ? gap + right : 0), h: padY * 2 + top + bottom, top, bottom, padY };
  };
  m = measure();
  for (let it = 0; it < 4 && m.w > maxW && m.f1 > 8.5; it++) { k *= Math.max(0.6, (maxW / m.w) * 0.97); m = measure(); }
  if (m.w > maxW) { m.name = ellipsize(g, p.name, m.f1, 700, Math.max(40, m.left - (m.w - maxW))); m.left = Math.max(fw(g, m.f1, 700, m.name), sub ? m.f2 * 1.5 + fw(g, m.f2, 600, sub) : 0); m.w = m.padX * 2 + m.bar + m.f1 * 0.5 + m.left + (m.right ? m.gap + m.right : 0); }
  return { kind: 'plate', p, m, w: m.w, h: m.h + Math.max(3, m.f1 * 0.38), x: p.x, y: p.y, ax: p.x, ay: p.y, prio: 3, numText, unit, online, stat, sub, has };
}

/** Draw a measured plate with its centre-top on the floor point (x, y). */
function paintPlate(g, it, x, y, now) {
  const { ctx } = g; const { p, m } = it; const col = p.col || '#3758f9'; const dark = g.pal.wk < 1; const th = Math.max(3, m.f1 * 0.38); const h = m.h; const w = m.w;
  const x0 = x - w / 2; const y0 = y + 2; const r = Math.min(h / 2, m.f1 * 0.55);
  ctx.save(); ctx.globalAlpha = p.dim ? 0.78 : 1;
  // the model's footprint on the floor (a ring), and when the plate had to step aside to keep a model uncovered, a leader line from the plate down to that ring
  { const rx = Math.max(7, g.tw * 0.16); const ry = rx * 0.5; ctx.fillStyle = col; ctx.globalAlpha = 0.16; ctx.beginPath(); ctx.ellipse(it.ax, it.ay, rx, ry, 0, 0, 7); ctx.fill(); ctx.globalAlpha = p.dim ? 0.7 : 0.95; ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
    const near = Math.abs(it.ax - x) > w / 2 || it.ay < y0 - 3 || it.ay > y0 + h + 3;
    if (near) { const px = clamp(it.ax, x0 + r, x0 + w - r); const py = it.ay < y0 ? y0 : y0 + h; ctx.lineWidth = 1.8; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(it.ax, it.ay); ctx.stroke(); }
    ctx.globalAlpha = p.dim ? 0.78 : 1; }
  ctx.fillStyle = 'rgba(0,0,0,.24)'; ctx.beginPath(); ctx.ellipse(x, y0 + h + th, w * 0.52, th * 1.15, 0, 0, 7); ctx.fill();        // contact shadow on the floor
  ctx.fillStyle = dark ? '#05080f' : '#0b1220'; ctx.beginPath(); ctx.roundRect(x0, y0 + th, w, h, r); ctx.fill();                       // the slab's thickness
  const gr = ctx.createLinearGradient(0, y0, 0, y0 + h); gr.addColorStop(0, '#3b4a63'); gr.addColorStop(1, '#1e293b'); ctx.fillStyle = gr; ctx.beginPath(); ctx.roundRect(x0, y0, w, h, r); ctx.fill();
  ctx.lineWidth = p.hov ? 2.4 : 1; ctx.strokeStyle = p.hov ? '#ffffff' : 'rgba(255,255,255,.22)'; ctx.stroke();
  ctx.fillStyle = col; ctx.beginPath(); ctx.roundRect(x0 + m.f1 * 0.3, y0 + m.f1 * 0.3, m.bar, h - m.f1 * 0.6, m.bar / 2); ctx.fill();
  const tx = x0 + m.f1 * 0.3 + m.bar + m.f1 * 0.5; const rowTop = y0 + m.padY; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.font = `700 ${m.f1}px ${g.font}`; ctx.fillStyle = '#ffffff'; ctx.fillText(m.name, tx, rowTop + m.top / 2);
  const by = rowTop + m.top + m.bottom / 2;
  if (it.sub) {   // small white cross = the hospital
    const cr = m.f2 * 0.5; ctx.fillStyle = '#e2e8f0'; ctx.beginPath(); ctx.roundRect(tx, by - cr * 0.3, cr * 2, cr * 0.6, cr * 0.2); ctx.fill(); ctx.beginPath(); ctx.roundRect(tx + cr * 0.7, by - cr, cr * 0.6, cr * 2, cr * 0.2); ctx.fill();
    ctx.font = `600 ${m.f2}px ${g.font}`; ctx.fillStyle = '#cbd5e1'; ctx.fillText(it.sub, tx + m.f2 * 1.5, by);
  }
  const rx = x0 + w - m.padX;   // right block: the number, embossed (extruded digits) — a fixed part of the plate, not floating
  if (it.has) {
    ctx.textAlign = 'right'; ctx.font = `800 ${m.fn}px ${g.font}`; const ny = rowTop + m.top / 2; const dp = Math.max(2, Math.round(m.fn * 0.1));
    for (let q = dp; q >= 1; q--) { ctx.fillStyle = mix(col, 0.42 + 0.2 * (1 - q / dp)); ctx.fillText(it.numText, rx + q * 0.45, ny + q * 0.7); }
    const ng = ctx.createLinearGradient(0, ny - m.fn * 0.5, 0, ny + m.fn * 0.5); ng.addColorStop(0, mix(col, 1.7)); ng.addColorStop(0.6, mix(col, 1.3)); ng.addColorStop(1, mix(col, 1.05)); ctx.fillStyle = ng; ctx.fillText(it.numText, rx, ny);
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.strokeText(it.numText, rx, ny);
    ctx.font = `600 ${m.f2}px ${g.font}`; ctx.fillStyle = '#cbd5e1';
    if (it.online) {
      const ow = fw(g, m.f2, 700, it.online); const pulse = g.reduced ? 1 : 0.55 + 0.45 * Math.sin(now / 350 + x); ctx.font = `700 ${m.f2}px ${g.font}`; ctx.fillStyle = '#4ade80'; ctx.fillText(it.online, rx, by);
      ctx.globalAlpha = (p.dim ? 0.78 : 1) * pulse; ctx.beginPath(); ctx.arc(rx - ow - m.f2 * 0.55, by, m.f2 * 0.3, 0, 7); ctx.fill(); ctx.globalAlpha = p.dim ? 0.78 : 1;
      ctx.font = `600 ${m.f2}px ${g.font}`; ctx.fillStyle = '#cbd5e1'; ctx.fillText(it.unit, rx - ow - m.f2 * 1.3, by);
    } else ctx.fillText(it.unit, rx, by);
  } else if (it.stat) {
    ctx.textAlign = 'right'; ctx.font = `700 ${m.f2 * 1.1}px ${g.font}`; ctx.fillStyle = col; ctx.fillText(it.stat, rx, rowTop + m.top / 2 + m.bottom * 0.2);
  }
  ctx.restore();
}

/** A label that stands on a short post with a shadow on the ground (no floating text). s = { text, x, y (floor point), col, sc, prio } */
export function layoutSign(g, s) {
  const kz = Math.pow(g.camZ, -0.6) * (s.sc || 1); const fs = Math.max(9.5, g.tw * 0.15 * kz); const w = fw(g, fs, 600, s.text) + 14 * kz; const hh = Math.max(16, g.tw * 0.27 * kz); const post = Math.max(5, hh * 0.5);
  return { kind: 'sign', s, w, h: hh + post, fs, hh, post, x: s.x, y: s.y, prio: s.prio === undefined ? 1 : s.prio };
}
function paintSign(g, it, x, y) {
  const { ctx, pal } = g; const { s, hh, post, w, fs } = it; const col = s.col || null; const cy = y - post;
  ctx.save(); ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.beginPath(); ctx.ellipse(x, y + 1, Math.max(4, hh * 0.35), Math.max(1.6, hh * 0.13), 0, 0, 7); ctx.fill();
  ctx.strokeStyle = col || pal.pillLine; ctx.lineWidth = Math.max(1.6, hh * 0.1); ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x, cy + hh / 2 - 1); ctx.lineTo(x, y); ctx.stroke();
  ctx.fillStyle = pal.pill; ctx.strokeStyle = col || pal.pillLine; ctx.lineWidth = 1; ctx.beginPath(); ctx.roundRect(x - w / 2, cy - hh / 2, w, hh, hh / 2); ctx.fill(); ctx.stroke();
  ctx.font = `600 ${fs}px ${g.font}`; ctx.fillStyle = col || pal.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(s.text, x, cy + 0.5); ctx.restore();
}

/**
 * Put every sign / plate of the frame where it overlaps nothing: most important first (plates 3 › signs 1); each tries its own spot, then a little up / down / sideways.
 * An unimportant sign (prio ≤ 1) that finds no free spot is dropped (only when `g.dropWhenCrowded`), so a small phone screen never turns into a wall of labels.
 * Returns the items to paint, in painting order (signs first, plates on top), each with its final x, y.
 */
export function placeSigns(g, items) {
  const placed = []; const out = []; const obst = g.obstacles || [];
  const rectOf = (it, x, y) => (it.kind === 'plate' ? { x0: x - it.w / 2, x1: x + it.w / 2, y0: y, y1: y + it.h } : { x0: x - it.w / 2, x1: x + it.w / 2, y0: y - it.h, y1: y + 1 });
  const area = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) - 2) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) - 2);
  const order = items.map((it, i) => ({ it, i })).sort((a, b) => b.it.prio - a.it.prio || a.i - b.i);
  const cw = g.width; const clampOn = g.clampX !== false;
  for (const { it } of order) {
    const x = clampOn ? clamp_(it.x, it.w / 2 + 4, Math.max(it.w / 2 + 4, cw - it.w / 2 - 4)) : it.x;
    const d = it.h * 1.0; const plate = it.kind === 'plate'; const own = plate ? it.p.own : undefined;
    const dys = plate ? [0, d, -d, d * 2, -d * 2, d * 3, -d * 3] : [0, -d, d, -d * 2, d * 2]; const dxs = plate ? [0, it.w * 0.55, -it.w * 0.55, it.w * 1.05, -it.w * 1.05] : [0, it.w * 0.6, -it.w * 0.6];
    let best = null;
    for (const dy of dys) for (const dx of dxs) {
      const r = rectOf(it, x + dx, it.y + dy); let cs = 0; for (const b of placed) cs += area(r, b); let co = 0;
      if (plate) for (const o of obst) if (!(o.own !== undefined && o.own === own)) co += area(r, o);   // never count the model the plate belongs to
      const cost = cs * 60 + co + (Math.abs(dx) + Math.abs(dy)) * 0.25;
      if (!best || cost < best.cost) best = { cost, cs, x: x + dx, y: it.y + dy, r };
      if (cost === 0) break;
    }
    if (!plate && best.cs > 0 && g.dropWhenCrowded && it.prio <= 1) continue;   // an unimportant sign with no free spot is left out
    placed.push(best.r); out.push({ ...it, x: best.x, y: best.y });
  }
  return out.sort((a, b) => a.prio - b.prio);
}
const clamp_ = clamp;
/** Paint the result of placeSigns(). */
export function paintSigns(g, list, now) { for (const it of list) { if (it.kind === 'plate') paintPlate(g, it, it.x, it.y, now); else paintSign(g, it, it.x, it.y); } }

/* ------------------------------------------------------------------------------------------------ people */
const SKINS = ['#f1c9a5', '#e0ac82', '#c68e64', '#8d5a3b'];
const HAIRS = ['#1f2937', '#3b2f2f', '#111827', '#4b3621', '#2a1b12'];
/** Outfit + prop per ROLE (the colours are the legend colours of site-engine ROLES). */
export const ROLE_LOOK = {
  admin: { top: '#7c3aed', pants: '#1f2937', tie: '#312e81', glasses: true },                                // แอดมิน: purple blazer, tie, glasses
  head: { top: '#ea580c', pants: '#374151', item: 'clip', gray: true },                                      // หัวหน้า: orange blazer, clipboard, grey hair
  officer: { top: '#0891b2', pants: '#1f2937', badge: true },                                                // เจ้าหน้าที่: cyan shirt, lanyard + ID card
  committee: { top: '#16a34a', pants: '#1f2937', item: 'papers' },                                           // กรรมการ: green jacket, papers to review
  researcher: { top: '#f8fafc', pants: '#334155', item: 'vial', coat: true, trim: '#db2777', glasses: true }, // ผู้วิจัย: white lab coat, pink collar, test tube
  user: { top: '#94a3b8', pants: '#475569', item: 'phone', bag: '#475569' },                                 // ผู้ใช้ทั่วไป: casual, phone, backpack
};
/** People of the campus (ambient figures of site-sim.js). */
export const KIND_LOOK = {
  doctor: { top: '#f8fafc', pants: '#334155', coat: true, trim: '#cbd5e1', steth: true },
  nurse: { top: '#14b8a6', pants: '#0f766e', cap: true, fem: 0.75 },
  patient: { top: '#bfdbfe', pants: '#93c5fd' },
  worker: { top: '#f97316', pants: '#6b7280', helmet: true, vest: true },
  visitor: { pants: '#475569' },
  kid: { pants: '#475569' },
};

const limb = (ctx, x0, y0, x1, y1, w, col) => { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); };
const rrect = (ctx, x, y, w, h, r, fill) => { ctx.fillStyle = fill; ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill(); };

/**
 * @param {object} o  { sx, sy (screen point between the feet), s (size unit: the figure is ≈ 5 s tall), now, walk, seed, role, kind, col (shirt colour when no role), back, dot (role colour) }
 */
export function drawFigure(g, o) {
  const { ctx } = g; const { sx, sy, s } = o; const now = o.now || 0; const seed = (o.seed | 0) >>> 0;
  const L = (o.role && ROLE_LOOK[o.role]) || (o.kind && KIND_LOOK[o.kind]) || {};
  const top = L.top || o.col || '#64748b'; const skin = SKINS[(seed >> 1) % SKINS.length]; const hair = L.gray ? '#9ca3af' : HAIRS[(seed >> 2) % HAIRS.length];
  const fem = L.fem !== undefined ? (seed % 4) / 4 < L.fem : (seed & 1) === 1; const skirt = fem && !L.coat && !L.helmet && !L.vest && (o.role === 'officer' || o.role === 'committee' || o.role === 'head' || o.kind === 'nurse' || o.kind === 'visitor');
  if (s < 1.9) {   // far away / tiny: the simple capsule is enough
    ctx.fillStyle = top; ctx.beginPath(); ctx.roundRect(sx - s * 0.85, sy - s * 3.3, s * 1.7, s * 3.3, s * 0.7); ctx.fill();
    if (o.back) { ctx.strokeStyle = g.pal.ink; ctx.lineWidth = Math.max(1.5, s * 0.4); ctx.stroke(); }
    ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(sx, sy - s * 4, s * 0.85, 0, 7); ctx.fill(); if (o.back) { ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = Math.max(1.5, s * 0.42); ctx.stroke(); }
    if (o.dot) { ctx.fillStyle = o.dot; ctx.beginPath(); ctx.arc(sx, sy - s * 5.6, s * 0.75, 0, 7); ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1, s * 0.25); ctx.stroke(); }
    return;
  }
  const walk = !!o.walk && !g.reduced; const ph = now / 140 + seed * 1.7; const sw = walk ? Math.sin(ph) : 0;
  const by = sy - (walk ? Math.abs(Math.sin(ph)) * s * 0.14 : 0);
  const hipY = by - s * 2.05; const shY = by - s * 3.55; const headY = by - s * 4.42; const half = s * (fem ? 0.84 : 1.0); const hip = s * (fem ? 0.8 : 0.74); const pants = L.pants || '#334155';
  ctx.lineJoin = 'round';
  // backpack / long hair sit BEHIND the body
  const bag = L.bag || (o.kind === 'visitor' && seed % 3 === 0 ? '#7c3aed' : '');   // backpack: general users · some visitors of the campus
  if (bag) rrect(ctx, sx + half - s * 0.15, shY + s * 0.15, s * 0.75, s * 1.55, s * 0.28, bag);
  if (fem && !L.cap && !L.helmet) rrect(ctx, sx - s * 0.86, headY - s * 0.6, s * 1.72, shY - headY + s * 1.5, s * 0.6, hair);
  // legs (skin below a skirt) with shoes; they swing while the person walks
  for (const side of [-1, 1]) {
    const ex = sx + side * s * 0.34; const sg = side === -1 ? sw : -sw; const fx = ex + sg * s * 0.55; const lift = walk ? Math.max(0, side === -1 ? -Math.cos(ph) : Math.cos(ph)) * s * 0.28 : 0; const fy = sy - lift;
    limb(ctx, ex, hipY, fx, fy - s * 0.2, s * 0.58, skirt ? skin : pants);
    ctx.fillStyle = '#111827'; ctx.beginPath(); ctx.ellipse(fx + side * s * 0.05, fy - s * 0.08, s * 0.4, s * 0.2, 0, 0, 7); ctx.fill();
  }
  // torso (shoulders wider than hips; a coat / skirt continues below the hips)
  const torso = () => { ctx.beginPath(); ctx.moveTo(sx - half, shY + s * 0.35); ctx.quadraticCurveTo(sx - half, shY, sx - half + s * 0.4, shY); ctx.lineTo(sx + half - s * 0.4, shY); ctx.quadraticCurveTo(sx + half, shY, sx + half, shY + s * 0.35); ctx.lineTo(sx + hip, hipY + s * 0.1); ctx.lineTo(sx - hip, hipY + s * 0.1); ctx.closePath(); };
  if (skirt) { ctx.fillStyle = pants; ctx.beginPath(); ctx.moveTo(sx - hip, hipY - s * 0.1); ctx.lineTo(sx + hip, hipY - s * 0.1); ctx.lineTo(sx + hip * 1.35, by - s * 1.05); ctx.lineTo(sx - hip * 1.35, by - s * 1.05); ctx.closePath(); ctx.fill(); }
  if (L.coat) { ctx.fillStyle = top; ctx.beginPath(); ctx.moveTo(sx - half, shY + s * 0.3); ctx.quadraticCurveTo(sx - half, shY, sx - half + s * 0.4, shY); ctx.lineTo(sx + half - s * 0.4, shY); ctx.quadraticCurveTo(sx + half, shY, sx + half, shY + s * 0.3); ctx.lineTo(sx + hip * 1.25, by - s * 1.0); ctx.lineTo(sx - hip * 1.25, by - s * 1.0); ctx.closePath(); ctx.fill(); ctx.strokeStyle = L.trim || '#cbd5e1'; ctx.lineWidth = Math.max(1, s * 0.16); ctx.beginPath(); ctx.moveTo(sx, shY + s * 0.05); ctx.lineTo(sx, by - s * 1.05); ctx.stroke(); }
  else { ctx.fillStyle = top; torso(); ctx.fill(); }
  if (o.back) { ctx.strokeStyle = g.pal.ink; ctx.lineWidth = Math.max(1.4, s * 0.34); if (L.coat) ctx.stroke(); else { torso(); ctx.stroke(); } }
  if (L.vest) { ctx.fillStyle = '#e5e7eb'; ctx.fillRect(sx - half * 0.55, shY + s * 0.1, s * 0.22, hipY - shY); ctx.fillRect(sx + half * 0.55 - s * 0.22, shY + s * 0.1, s * 0.22, hipY - shY); }
  if (L.tie) { ctx.fillStyle = L.tie; ctx.beginPath(); ctx.moveTo(sx - s * 0.16, shY + s * 0.05); ctx.lineTo(sx + s * 0.16, shY + s * 0.05); ctx.lineTo(sx + s * 0.1, shY + s * 1.15); ctx.lineTo(sx, shY + s * 1.3); ctx.lineTo(sx - s * 0.1, shY + s * 1.15); ctx.closePath(); ctx.fill(); }
  if (L.badge) { ctx.strokeStyle = '#0e7490'; ctx.lineWidth = Math.max(1, s * 0.14); ctx.beginPath(); ctx.moveTo(sx - s * 0.32, shY); ctx.lineTo(sx, shY + s * 1.0); ctx.lineTo(sx + s * 0.32, shY); ctx.stroke(); rrect(ctx, sx - s * 0.22, shY + s * 0.95, s * 0.44, s * 0.55, s * 0.08, '#ffffff'); }
  if (L.steth) { ctx.strokeStyle = '#334155'; ctx.lineWidth = Math.max(1, s * 0.15); ctx.beginPath(); ctx.arc(sx, shY + s * 0.3, s * 0.55, 0.15, Math.PI - 0.15); ctx.stroke(); }
  // arms: swing against the legs while walking; one hand holds the role's prop when standing
  for (const side of [-1, 1]) {
    const hold = !walk && L.item && side === 1; const shx = sx + side * (half - s * 0.05); const shyy = shY + s * 0.3;
    const hx = hold ? sx + side * s * 1.0 : sx + side * (half + s * 0.12) + (side === -1 ? -sw : sw) * s * 0.18; const hy = hold ? by - s * 2.75 : by - s * 1.75 + (side === -1 ? -sw : sw) * s * 0.3;
    limb(ctx, shx, shyy, hx, hy, s * 0.5, top);
    ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(hx, hy, s * 0.27, 0, 7); ctx.fill();
    if (hold) {
      if (L.item === 'clip') { rrect(ctx, hx - s * 0.1, hy - s * 0.9, s * 0.95, s * 1.25, s * 0.1, '#f8fafc'); rrect(ctx, hx + s * 0.2, hy - s * 1.0, s * 0.35, s * 0.2, s * 0.06, '#475569'); }
      else if (L.item === 'papers') { rrect(ctx, hx - s * 0.05, hy - s * 0.75, s * 0.8, s * 1.0, s * 0.06, '#e2e8f0'); rrect(ctx, hx + s * 0.05, hy - s * 0.85, s * 0.8, s * 1.0, s * 0.06, '#ffffff'); }
      else if (L.item === 'vial') { rrect(ctx, hx - s * 0.1, hy - s * 0.95, s * 0.28, s * 0.95, s * 0.12, '#f9a8d4'); rrect(ctx, hx - s * 0.1, hy - s * 0.95, s * 0.28, s * 0.3, s * 0.1, '#e5e7eb'); }
      else if (L.item === 'phone') { rrect(ctx, hx - s * 0.05, hy - s * 0.75, s * 0.42, s * 0.72, s * 0.08, '#111827'); rrect(ctx, hx, hy - s * 0.7, s * 0.32, s * 0.55, s * 0.05, '#7dd3fc'); }
    }
  }
  // neck, head, hair, face
  ctx.fillStyle = skin; ctx.fillRect(sx - s * 0.24, shY - s * 0.35, s * 0.48, s * 0.5);
  ctx.beginPath(); ctx.arc(sx, headY, s * 0.8, 0, 7); ctx.fill();
  if (o.back) { ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = Math.max(1.5, s * 0.4); ctx.stroke(); }
  if (L.helmet) { ctx.fillStyle = '#facc15'; ctx.beginPath(); ctx.arc(sx, headY - s * 0.05, s * 0.88, Math.PI, 0); ctx.fill(); ctx.fillRect(sx - s * 1.05, headY - s * 0.08, s * 2.1, s * 0.2); }
  else if (L.cap) { ctx.fillStyle = hair; ctx.beginPath(); ctx.arc(sx, headY - s * 0.05, s * 0.84, Math.PI * 1.05, Math.PI * 1.95); ctx.fill(); rrect(ctx, sx - s * 0.62, headY - s * 1.12, s * 1.24, s * 0.5, s * 0.14, '#ffffff'); ctx.fillStyle = '#dc2626'; ctx.fillRect(sx - s * 0.08, headY - s * 1.04, s * 0.16, s * 0.34); ctx.fillRect(sx - s * 0.17, headY - s * 0.95, s * 0.34, s * 0.16); }
  else { ctx.fillStyle = hair; ctx.beginPath(); ctx.arc(sx, headY - s * 0.06, s * 0.86, Math.PI * 1.0, Math.PI * 2.0); ctx.fill(); if (fem) { ctx.fillRect(sx - s * 0.86, headY - s * 0.08, s * 0.2, s * 0.9); ctx.fillRect(sx + s * 0.66, headY - s * 0.08, s * 0.2, s * 0.9); } }
  if (s >= 3) {
    ctx.fillStyle = '#1f2937'; ctx.beginPath(); ctx.arc(sx - s * 0.28, headY + s * 0.05, s * 0.075, 0, 7); ctx.arc(sx + s * 0.28, headY + s * 0.05, s * 0.075, 0, 7); ctx.fill();
    if (L.glasses) { ctx.strokeStyle = '#111827'; ctx.lineWidth = Math.max(1, s * 0.09); ctx.beginPath(); ctx.arc(sx - s * 0.3, headY + s * 0.05, s * 0.21, 0, 7); ctx.moveTo(sx + s * 0.09, headY + s * 0.05); ctx.arc(sx + s * 0.3, headY + s * 0.05, s * 0.21, 0, 7); ctx.moveTo(sx - s * 0.09, headY + s * 0.05); ctx.lineTo(sx + s * 0.09, headY + s * 0.05); ctx.stroke(); }
  }
  // role dot over the head = the legend colour (kept so the legend of the page still reads)
  if (o.dot) { ctx.fillStyle = o.dot; ctx.beginPath(); ctx.arc(sx, by - s * 6.0, s * 0.62, 0, 7); ctx.fill(); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(1, s * 0.22); ctx.stroke(); }
}
