// Drawing helpers for the 3D home page (site-sim.js) — canvas 2D only, no library:
//   drawNumber  floating 3D usage figure above a model (extruded digits, floor shadow, gentle bob, counts up) — replaces the number on the white tab
//   drawPlate   dark base plate in front of a model: the system name + the place (โรงพยาบาลสันทราย) — replaces the name on the white tab
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

/* ------------------------------------------------------------------------------------------------ text with a halo (readable on any floor colour) */
function haloText(g, text, x, y, size, color, weight = 700, halo) {
  const { ctx } = g; ctx.font = `${weight} ${size}px ${g.font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2.5, size * 0.3); ctx.strokeStyle = halo || g.pal.pill; ctx.strokeText(text, x, y); ctx.fillStyle = color; ctx.fillText(text, x, y);
}

/* ------------------------------------------------------------------------------------------------ floating 3D number */
/**
 * @param {object} n  { key, x, y (screen point of the number's centre), fx, fy (screen point on the floor right under it), value (number | null), approx, text (shown instead when value is null),
 *                      unit, online, col, sc, phase, busy }
 */
export function drawNumber(g, n, now) {
  const { ctx, pal } = g; const kz = Math.pow(g.camZ, -0.6) * (n.sc || 1); const has = n.value !== null && n.value !== undefined;
  const dark = pal.wk < 1; const col = n.col || '#3758f9';
  let f = Math.max(18, g.tw * 0.44 * kz) * (has ? 1 : 0.5);
  const text = has ? `${n.approx ? '≈' : ''}${fmt(Math.round(eased(n.key, n.value, now, g.reduced)))}` : String(n.text || '');
  ctx.save(); ctx.font = `800 ${f}px ${g.font}`;
  let w = ctx.measureText(text).width; const maxW = g.tw * (has ? 2.5 : 1.9) * kz; if (w > maxW) { f *= maxW / w; w = maxW; ctx.font = `800 ${f}px ${g.font}`; }
  const depth = Math.max(3, Math.min(9, Math.round(f * 0.18))); const ph = n.phase || 0;
  const bob = g.reduced ? 0 : Math.sin(now / 640 + ph) * f * 0.1; const sway = g.reduced ? 0 : Math.sin(now / 1300 + ph) * 0.07;
  const cw = g.width; const x = g.clampX === false ? n.x : clamp(n.x, w / 2 + depth + 6, Math.max(w / 2 + depth + 6, cw - w / 2 - depth - 6)); const y = n.y - bob;
  // 1 · floor shadow + a thin dotted tether down to the model (the number "floats", it is not stuck on the roof)
  ctx.globalAlpha = dark ? 0.34 : 0.16; ctx.fillStyle = '#000'; ctx.beginPath(); ctx.ellipse(n.fx, n.fy, Math.max(8, w * 0.36) * (1 - bob / (f * 3)), Math.max(3, f * 0.2), 0, 0, 7); ctx.fill();
  ctx.globalAlpha = 0.42; ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.setLineDash([2, 4]); ctx.beginPath(); ctx.moveTo(n.fx, n.fy); ctx.lineTo(x, y + f * 0.55 + depth); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
  // 2 · the digits: halo, then the extrusion (back to front, darker at the back), then the lit face with a rim light
  ctx.translate(x, y); ctx.transform(1, 0, sway, 1, 0, 0); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(3, f * 0.24); ctx.strokeStyle = pal.pill; ctx.strokeText(text, depth * 0.55, depth * 0.8); ctx.strokeText(text, 0, 0);
  for (let k = depth; k >= 1; k--) { ctx.fillStyle = mix(col, (dark ? 0.62 : 0.4) + 0.2 * (1 - k / depth)); ctx.fillText(text, k * 0.55, k * 0.8); }
  const gr = ctx.createLinearGradient(0, -f * 0.5, 0, f * 0.5); gr.addColorStop(0, mix(col, dark ? 1.5 : 1.3)); gr.addColorStop(0.55, col); gr.addColorStop(1, mix(col, 0.82));
  ctx.fillStyle = gr; ctx.fillText(text, 0, 0); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.strokeText(text, 0, 0);
  ctx.restore();
  // 3 · small captions right under the digits (no white tab): the unit, and the people online now
  const cs = Math.max(9, f * 0.36); let cy = y + f * 0.62 + depth + cs * 0.4;
  if (has && n.unit) { haloText(g, n.unit, x, cy, cs, pal.ink, 600); cy += cs * 1.2; }
  if (has && n.online > 0) {
    const label = `ออนไลน์ ${fmt(n.online)}`; ctx.save(); ctx.font = `700 ${cs}px ${g.font}`; const lw = ctx.measureText(label).width; ctx.restore();
    const pulse = g.reduced ? 1 : 0.55 + 0.45 * Math.sin(now / 350 + ph); const gx = x - lw / 2 - cs * 0.55;
    ctx.save(); ctx.globalAlpha = pulse; ctx.fillStyle = '#16a34a'; ctx.strokeStyle = pal.pill; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(gx, cy, cs * 0.28, 0, 7); ctx.stroke(); ctx.fill(); ctx.restore();
    haloText(g, label, x + cs * 0.15, cy, cs, '#16a34a', 700);
  }
}

/* ------------------------------------------------------------------------------------------------ base plate */
/**
 * A dark plate with a coloured edge, standing on the floor at the foot of a model.
 * @param {object} p  { x, y (screen point on the floor, front of the model), name, sub (defaults to the hospital), col, sc, hov, dim }
 */
export function drawPlate(g, p) {
  const { ctx, pal } = g; const kz = Math.pow(g.camZ, -0.6) * (p.sc || 1); const dark = pal.wk < 1; const col = p.col || '#3758f9';
  let f1 = Math.max(10, g.tw * 0.16 * kz); let f2 = Math.max(8.5, f1 * 0.78); const sub = p.sub === undefined ? HOSPITAL_NAME : p.sub;
  const maxW = Math.max(120, p.maxW || g.tw * 3.1 * kz);
  ctx.save();
  const meas = () => { ctx.font = `700 ${f1}px ${g.font}`; const a = ctx.measureText(p.name).width; ctx.font = `600 ${f2}px ${g.font}`; const b = sub ? ctx.measureText(sub).width + f2 * 1.5 : 0; return Math.max(a, b); };
  let tw0 = meas(); if (tw0 > maxW - f1 * 1.9) { const k = (maxW - f1 * 1.9) / tw0; f1 *= k; f2 *= k; tw0 = meas(); }
  const bar = Math.max(3, f1 * 0.34); const padX = f1 * 0.7; const w = tw0 + padX * 2 + bar; const h = f1 * 1.15 + (sub ? f2 * 1.25 : 0) + f1 * 0.4; const th = Math.max(3, f1 * 0.38);
  let x = p.x; if (g.clampX !== false) x = clamp(x, w / 2 + 4, Math.max(w / 2 + 4, g.width - w / 2 - 4)); const y = p.y + h * 0.42;   // sits just below the model's foot
  const x0 = x - w / 2; const y0 = y - h / 2; const r = Math.min(h / 2, f1 * 0.55);
  ctx.globalAlpha = p.dim ? 0.72 : 1;
  // contact shadow · front face (thickness) · top face · accent bar · text
  ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.beginPath(); ctx.ellipse(x, y + h / 2 + th, w * 0.52, th * 1.1, 0, 0, 7); ctx.fill();
  ctx.fillStyle = dark ? '#0b1220' : '#0f172a'; ctx.beginPath(); ctx.roundRect(x0, y0 + th, w, h, r); ctx.fill();
  const gr = ctx.createLinearGradient(0, y0, 0, y0 + h); gr.addColorStop(0, dark ? '#334155' : '#334155'); gr.addColorStop(1, dark ? '#1e293b' : '#1e293b');
  ctx.fillStyle = gr; ctx.beginPath(); ctx.roundRect(x0, y0, w, h, r); ctx.fill();
  ctx.lineWidth = p.hov ? 2.2 : 1; ctx.strokeStyle = p.hov ? pal.ink : 'rgba(255,255,255,.22)'; ctx.stroke();
  ctx.fillStyle = col; ctx.beginPath(); ctx.roundRect(x0 + f1 * 0.3, y0 + f1 * 0.28, bar, h - f1 * 0.56, bar / 2); ctx.fill();
  const tx = x0 + f1 * 0.3 + bar + padX * 0.8; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.font = `700 ${f1}px ${g.font}`; ctx.fillStyle = '#ffffff'; ctx.fillText(p.name, tx, y0 + f1 * 0.78);
  if (sub) {
    const cy = y0 + f1 * 0.78 + f1 * 0.62 + f2 * 0.5; const cr = f2 * 0.5;   // a small white cross = the hospital
    ctx.fillStyle = '#e2e8f0'; ctx.beginPath(); ctx.roundRect(tx, cy - cr * 0.3, cr * 2, cr * 0.6, cr * 0.2); ctx.fill(); ctx.beginPath(); ctx.roundRect(tx + cr * 0.7, cy - cr, cr * 0.6, cr * 2, cr * 0.2); ctx.fill();
    ctx.font = `600 ${f2}px ${g.font}`; ctx.fillStyle = '#cbd5e1'; ctx.fillText(sub, tx + f2 * 1.5, cy);
  }
  ctx.restore();
}

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
