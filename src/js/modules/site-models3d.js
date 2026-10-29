// Procedural low-poly 3D models for the rotatable 3D view (site-3d.js). No files, no textures: every model is a handful of boxes / cylinders, built with three.js.
// One function per system theme (site-engine THEMES): ems (SAND vehicles) · hrd · ec (research ethics) · vaccine · eval (performance follow-up / อวช.) · plan · dental · pt · doc · visit · fte · web (fallback).
// Models stand on the point (0, 0, 0), about 3.4 × 3.4 units wide, the FRONT is +z. `build()` returns { group, tick(t, live) } — tick animates (blinking light bar …).
// People: head, neck, torso, two arms, two legs — arms and legs swing while `walking`; the outfit follows the role (ROLE_LOOK of site-deco.js).

import { ROLE_LOOK, KIND_LOOK } from './site-deco.js';

/** @param {any} THREE */
export function makeKit(THREE) {
  const mats = new Map(); const geos = new Map();
  const M = (c, o = {}) => { const k = `${c}|${o.t ? 1 : 0}|${o.e || 0}|${o.r ?? ''}`; let m = mats.get(k); if (!m) { m = new THREE.MeshStandardMaterial({ color: c, roughness: o.r ?? 0.72, metalness: 0.04, flatShading: true, transparent: !!o.t, opacity: o.t ? 0.62 : 1, emissive: o.e ? c : 0x000000, emissiveIntensity: o.e || 0 }); mats.set(k, m); } return m; };
  const G = (k, mk) => { let g = geos.get(k); if (!g) { g = mk(); geos.set(k, g); } return g; };
  const at = (g, mesh, x, y, z, rx = 0, ry = 0, rz = 0) => { mesh.position.set(x, y, z); mesh.rotation.set(rx, ry, rz); g.add(mesh); return mesh; };
  /** box standing on y (bottom), centre x / z */
  const B = (g, w, h, d, c, x, y, z, o, ry = 0) => at(g, new THREE.Mesh(G(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d)), M(c, o)), x, y + h / 2, z, 0, ry, 0);
  const C = (g, rt, rb, h, c, x, y, z, o, rx = 0, rz = 0, seg = 14) => at(g, new THREE.Mesh(G(`c${rt},${rb},${h},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg)), M(c, o)), x, y + h / 2, z, rx, 0, rz);
  const S = (g, r, c, x, y, z, o) => at(g, new THREE.Mesh(G(`s${r}`, () => new THREE.SphereGeometry(r, 14, 10)), M(c, o)), x, y, z);
  const mix = (c, f) => { const col = new THREE.Color(c); return f < 1 ? col.multiplyScalar(f).getStyle() : col.lerp(new THREE.Color('#ffffff'), f - 1).getStyle(); };
  const baked = () => { let b = mats.get('baked'); if (!b) { b = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.04, flatShading: true }); mats.set('baked', b); } return b; };
  const dispose = () => { mats.forEach((x) => x.dispose()); geos.forEach((x) => x.dispose()); mats.clear(); geos.clear(); };
  return { THREE, M, G, at, B, C, S, mix, dispose, baked };
}

/* --------------------------------------------------------------------------------------------------------------------------------- models */
const MODELS = {
  ems(k, col) {   // SAND vehicles: an ambulance with a light bar that blinks when somebody is online
    const { B, C, THREE } = k; const g = new THREE.Group(); const a = new THREE.Group(); g.add(a); a.rotation.y = -0.45; a.position.set(0, 0, -0.1);
    B(a, 2.6, 0.95, 1.25, '#f8fafc', -0.2, 0.32, 0); B(a, 0.95, 0.75, 1.25, '#f1f5f9', 1.45, 0.32, 0); B(a, 0.06, 0.38, 1.05, '#1e293b', 1.95, 0.78, 0); B(a, 2.62, 0.16, 1.27, '#dc2626', -0.2, 0.72, 0);
    for (const z of [-0.64, 0.64]) { B(a, 0.62, 0.16, 0.03, '#dc2626', -0.45, 1.0, z); B(a, 0.16, 0.62, 0.03, '#dc2626', -0.45, 0.77, z); }
    for (const x of [-1.0, 1.2]) for (const z of [-0.6, 0.6]) C(a, 0.3, 0.3, 0.22, '#111827', x, 0.3, z, {}, Math.PI / 2);
    const r = B(a, 0.36, 0.1, 0.5, '#ef4444', 1.3, 1.27, 0, { e: 0.1 }); const bl = B(a, 0.36, 0.1, 0.5, '#3b82f6', 1.7, 1.27, 0, { e: 0.1 }); B(a, 0.7, 0.04, 0.5, '#e2e8f0', 1.5, 1.3, 0); r.material = r.material.clone(); bl.material = bl.material.clone();
    return { group: g, tick: (t, live) => { const on = live && Math.floor(t * 4) % 2 === 0; r.material.emissiveIntensity = live ? (on ? 1.4 : 0.1) : 0.1; bl.material.emissiveIntensity = live ? (on ? 0.1 : 1.4) : 0.1; } };
  },
  hrd(k, col) {   // training room: whiteboard, lectern, 3 × 2 desks with chairs
    const { B, THREE } = k; const g = new THREE.Group(); B(g, 3.4, 0.08, 3.0, '#e8edf5', 0, 0, 0); B(g, 2.4, 1.1, 0.08, '#ffffff', 0, 0.9, -1.35); B(g, 2.5, 0.06, 0.1, k.mix(col, 0.8), 0, 0.84, -1.34); B(g, 2.5, 0.06, 0.1, k.mix(col, 0.8), 0, 2.0, -1.34);
    B(g, 0.9, 0.5, 0.06, '#38bdf8', -0.5, 1.25, -1.3); B(g, 0.7, 0.06, 0.06, '#f59e0b', 0.5, 1.5, -1.3); B(g, 0.5, 0.06, 0.06, '#10b981', 0.4, 1.3, -1.3); B(g, 0.55, 0.95, 0.4, k.mix(col, 0.9), -1.15, 0.08, -0.7);
    for (let r = 0; r < 2; r++) for (let c = -1; c <= 1; c++) { const x = c * 1.0; const z = 0.05 + r * 1.0; B(g, 0.8, 0.5, 0.45, '#d9c7a6', x, 0.08, z); B(g, 0.84, 0.05, 0.5, '#efe3c8', x, 0.58, z); B(g, 0.32, 0.03, 0.22, '#334155', x, 0.64, z); B(g, 0.4, 0.4, 0.4, k.mix(col, 1.1), x, 0.08, z + 0.5); B(g, 0.4, 0.4, 0.06, k.mix(col, 1.1), x, 0.48, z + 0.7); }
    return { group: g };
  },
  ec(k, col) {   // research ethics: lab bench with microscope, flasks, documents and a shield
    const { B, C, S, THREE } = k; const g = new THREE.Group(); B(g, 2.6, 0.8, 0.9, '#e2e8f0', -0.1, 0, -0.3); B(g, 2.7, 0.08, 1.0, '#334155', -0.1, 0.8, -0.3);
    B(g, 0.5, 0.06, 0.4, '#111827', -0.9, 0.88, -0.3); C(g, 0.07, 0.07, 0.7, '#475569', -0.9, 0.9, -0.42); C(g, 0.09, 0.09, 0.42, '#0f172a', -0.9, 1.25, -0.2, {}, 0.6); C(g, 0.06, 0.06, 0.2, '#94a3b8', -0.9, 1.52, -0.08, {}, 0.6);
    C(g, 0.04, 0.2, 0.5, '#f9a8d4', 0.1, 0.88, -0.3, { t: 1 }); C(g, 0.04, 0.2, 0.5, '#86efac', 0.45, 0.88, -0.2, { t: 1 }); C(g, 0.1, 0.1, 0.5, '#7dd3fc', 0.8, 0.88, -0.4, { t: 1 }); B(g, 0.5, 0.1, 0.36, '#ffffff', 1.0, 0.88, 0.0); B(g, 0.5, 0.06, 0.36, '#e2e8f0', 1.0, 0.98, 0.0, {}, 0.2);
    const sh = new THREE.Shape(); sh.moveTo(0, 0.95); sh.lineTo(0.62, 0.75); sh.lineTo(0.62, 0.15); sh.quadraticCurveTo(0.62, -0.5, 0, -0.85); sh.quadraticCurveTo(-0.62, -0.5, -0.62, 0.15); sh.lineTo(-0.62, 0.75); sh.closePath();
    const sm = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.14, bevelEnabled: false }), k.M('#16a34a')); sm.position.set(1.15, 1.4, 0.7); sm.rotation.y = -0.5; g.add(sm);
    B(g, 0.14, 0.52, 0.04, '#ffffff', 1.15, 1.23, 0.88, {}, -0.5); B(g, 0.46, 0.14, 0.04, '#ffffff', 1.15, 1.42, 0.88, {}, -0.5); C(g, 0.06, 0.06, 0.55, '#475569', 1.15, 0.0, 0.7); B(g, 0.6, 0.06, 0.4, '#475569', 1.15, 0, 0.7);
    return { group: g };
  },
  vaccine(k, col) {   // vaccine: fridge, cold box, vials, and a big syringe
    const { B, C, THREE } = k; const g = new THREE.Group(); B(g, 0.95, 1.9, 0.85, '#f8fafc', -1.15, 0, -0.5); B(g, 0.03, 1.7, 0.87, '#38bdf8', -1.15, 0.1, -0.5); B(g, 0.07, 0.45, 0.07, '#94a3b8', -0.62, 0.85, -0.05); B(g, 0.8, 0.14, 0.05, '#0ea5e9', -1.15, 1.5, -0.06);
    B(g, 1.7, 0.7, 0.85, '#e2e8f0', 0.55, 0, -0.3); B(g, 1.74, 0.06, 0.9, '#cbd5e1', 0.55, 0.7, -0.3);
    for (let i = 0; i < 5; i++) { C(g, 0.075, 0.075, 0.2, '#2dd4bf', 0.0 + i * 0.2, 0.76, -0.25, {}, 0, 0, 10); C(g, 0.08, 0.08, 0.05, '#f8fafc', 0.0 + i * 0.2, 0.96, -0.25, {}, 0, 0, 10); }
    B(g, 0.95, 0.5, 0.6, '#2563eb', 0.6, 0, 0.75); B(g, 0.99, 0.1, 0.64, '#f8fafc', 0.6, 0.5, 0.75);
    const sy = new THREE.Group(); sy.position.set(0.45, 1.05, 0.75); sy.rotation.set(0, 0.5, 0.25); g.add(sy); C(sy, 0.17, 0.17, 1.2, '#f1f5f9', 0, -0.6, 0, { t: 1 }, 0, Math.PI / 2); C(sy, 0.1, 0.1, 0.7, '#fb7185', -0.1, -0.35, 0, {}, 0, Math.PI / 2); C(sy, 0.04, 0.04, 0.6, '#e2e8f0', -0.9, -0.3, 0, {}, 0, Math.PI / 2); B(sy, 0.05, 0.4, 0.4, '#e2e8f0', -1.2, -0.4, 0); C(sy, 0.015, 0.05, 0.5, '#94a3b8', 0.9, -0.3, 0, {}, 0, -Math.PI / 2);
    return { group: g };
  },
  eval(k, col) {   // performance follow-up / submission (อวช.): progress wall → submitted folders → review desk → podium with trophy
    const { B, C, S, THREE } = k; const g = new THREE.Group(); B(g, 3.0, 1.9, 0.1, '#f8fafc', 0.15, 0.12, -1.4);
    [[1.5, 2.1, col], [1.25, 1.7, '#16a34a'], [1.0, 1.2, '#f59e0b'], [0.75, 0.7, '#8b5cf6']].forEach(([y, len, c]) => { B(g, 2.2, 0.14, 0.04, '#e2e8f0', -0.25, y, -1.33); B(g, len, 0.14, 0.06, c, -0.25 - (2.2 - len) / 2, y, -1.32); B(g, 0.2, 0.2, 0.06, len >= 2.1 ? '#16a34a' : '#cbd5e1', 1.1, y - 0.03, -1.32); });
    B(g, 0.85, 0.5, 0.7, '#d9c7a6', -1.05, 0.08, 0.1); B(g, 0.68, 0.07, 0.52, '#60a5fa', -1.05, 0.58, 0.1); B(g, 0.64, 0.07, 0.5, '#fbbf24', -1.05, 0.65, 0.1, {}, 0.1); B(g, 0.6, 0.07, 0.46, col, -1.05, 0.72, 0.1, {}, -0.08);
    B(g, 1.1, 0.7, 0.65, '#d9c7a6', -0.1, 0.08, 0.5); B(g, 0.62, 0.42, 0.05, '#0f172a', -0.1, 0.85, 0.28); B(g, 0.1, 0.18, 0.1, '#475569', -0.1, 0.78, 0.32); B(g, 0.5, 0.3, 0.02, '#22c55e', -0.1, 0.9, 0.31, { e: 0.35 });
    B(g, 0.56, 0.55, 0.56, '#cbd5e1', 0.72, 0.08, 0.15); B(g, 0.56, 0.9, 0.56, '#e2e8f0', 1.25, 0.08, 0.15); B(g, 0.56, 0.35, 0.56, '#94a3b8', 1.78, 0.08, 0.15);
    const cup = new THREE.Mesh(new THREE.LatheGeometry([[0.0, 0], [0.12, 0], [0.12, 0.06], [0.05, 0.1], [0.05, 0.3], [0.22, 0.52], [0.26, 0.6], [0.0, 0.6]].map(([x, y]) => new THREE.Vector2(x, y)), 14), k.M('#fbbf24', { r: 0.35 })); cup.position.set(1.25, 0.98, 0.15); cup.userData.keep = true; g.add(cup); B(g, 0.3, 0.06, 0.3, '#92400e', 1.25, 0.98, 0.15);
    return { group: g, tick: (t) => { cup.rotation.y = t * 0.8; } };
  },
  plan(k, col) {   // plan / KPI: bar chart board and a target
    const { B, C, THREE } = k; const g = new THREE.Group(); B(g, 2.6, 1.6, 0.1, '#f8fafc', 0, 0.5, -1.0); [0.5, 0.9, 0.7, 1.15].forEach((h, i) => B(g, 0.32, h, 0.1, i % 2 ? '#10b981' : col, -0.8 + i * 0.5, 0.6, -0.92));
    const t = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.09, 8, 20), k.M('#dc2626')); t.position.set(0.9, 0.65, 0.6); t.rotation.y = -0.4; g.add(t); const t2 = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.07, 8, 16), k.M('#f8fafc')); t2.position.set(0.9, 0.65, 0.6); t2.rotation.y = -0.4; g.add(t2);
    C(g, 0.08, 0.08, 0.5, '#ef4444', 0.9, 0.5, 0.6, {}, 0, 0, 10); B(g, 0.5, 0.08, 0.4, '#475569', 0.9, 0, 0.6); B(g, 1.3, 0.55, 0.7, '#d9c7a6', -0.7, 0, 0.5); return { group: g };
  },
  dental(k, col) {   // dental chair + lamp
    const { B, C, THREE } = k; const g = new THREE.Group(); B(g, 0.9, 0.25, 0.9, '#334155', 0, 0, 0); C(g, 0.12, 0.12, 0.6, '#94a3b8', 0, 0.25, 0); B(g, 0.8, 0.2, 1.1, col, 0, 0.85, 0.1); B(g, 0.8, 0.9, 0.2, col, 0, 1.0, -0.6, {}, 0); B(g, 0.4, 0.3, 0.16, k.mix(col, 1.3), 0, 1.85, -0.62);
    C(g, 0.04, 0.04, 1.6, '#cbd5e1', 1.0, 0, -0.6); B(g, 0.9, 0.05, 0.05, '#cbd5e1', 0.55, 1.6, -0.6); B(g, 0.5, 0.2, 0.4, '#f8fafc', 0.2, 1.5, -0.6, { e: 0.4 }); B(g, 0.5, 0.5, 0.5, '#e2e8f0', -1.1, 0, 0.5); return { group: g };
  },
  pt(k, col) {   // physical therapy: bed + parallel bars
    const { B, C, THREE } = k; const g = new THREE.Group(); B(g, 1.6, 0.5, 0.85, '#e2e8f0', -0.95, 0, -0.2); B(g, 1.6, 0.14, 0.85, '#2dd4bf', -0.95, 0.5, -0.2); B(g, 0.45, 0.1, 0.7, '#f8fafc', -1.55, 0.64, -0.2);
    for (const z of [0.55, 1.2]) { C(g, 0.04, 0.04, 0.85, '#94a3b8', 0.35, 0, z); C(g, 0.04, 0.04, 0.85, '#94a3b8', 1.85, 0, z); B(g, 1.5, 0.05, 0.05, '#cbd5e1', 1.1, 0.85, z); } B(g, 1.7, 0.02, 0.9, '#cbd5e1', 1.1, 0, 0.88); return { group: g };
  },
  doc(k, col) {   // documents: filing cabinets + paper stacks
    const { B, THREE } = k; const g = new THREE.Group(); [-1, 0, 1].forEach((x, i) => { B(g, 0.9, 1.3 + (i === 1 ? 0.3 : 0), 0.7, '#94a3b8', x, 0, -0.4); [0.2, 0.6, 1.0].forEach((y) => { B(g, 0.7, 0.04, 0.02, '#475569', x, y, -0.04); B(g, 0.2, 0.05, 0.03, '#f8fafc', x, y + 0.12, -0.03); }); });
    B(g, 1.0, 0.1, 0.7, '#f8fafc', 0.4, 0, 0.8); B(g, 0.9, 0.1, 0.65, '#e2e8f0', 0.4, 0.1, 0.8, {}, 0.15); B(g, 0.8, 0.1, 0.6, col, 0.4, 0.2, 0.8, {}, -0.1); return { group: g };
  },
  visit(k, col) {   // home visits / map: a house and a map pin
    const { B, S, THREE } = k; const g = new THREE.Group(); B(g, 1.5, 1.0, 1.3, '#fde68a', -0.5, 0, -0.3); const roof = new THREE.Mesh(new THREE.ConeGeometry(1.2, 0.8, 4), k.M('#dc2626')); roof.position.set(-0.5, 1.4, -0.3); roof.rotation.y = Math.PI / 4; g.add(roof);
    B(g, 0.4, 0.65, 0.04, '#78350f', -0.5, 0, 0.37); B(g, 0.36, 0.34, 0.04, '#7dd3fc', -1.0, 0.4, 0.37); const pin = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.65, 12), k.M('#ef4444')); pin.rotation.x = Math.PI; pin.position.set(1.1, 1.0, 0.4); pin.userData.keep = true; g.add(pin); S(g, 0.26, '#ef4444', 1.1, 1.45, 0.4); S(g, 0.09, '#ffffff', 1.1, 1.45, 0.64); B(g, 0.9, 0.04, 0.7, '#bbf7d0', 1.1, 0, 0.4); return { group: g, tick: (t) => { pin.position.y = 1.0 + Math.sin(t * 2) * 0.05; } };
  },
  fte(k, col) {   // workforce plan: a small organisation chart
    const { B, THREE } = k; const g = new THREE.Group(); B(g, 0.9, 0.5, 0.5, col, 0, 1.4, -0.5); [-1.1, 0, 1.1].forEach((x) => { B(g, 0.8, 0.4, 0.45, k.mix(col, 1.25), x, 0.6, 0.2); B(g, 0.06, 0.4, 0.06, '#94a3b8', x, 1.0, -0.15); }); B(g, 2.3, 0.06, 0.06, '#94a3b8', 0, 1.2, -0.15); B(g, 0.06, 0.3, 0.06, '#94a3b8', 0, 1.2, -0.5); B(g, 3.0, 0.06, 1.7, '#e2e8f0', 0, 0, -0.1); return { group: g };
  },
  web(k, col) {   // generic website: monitor + server rack
    const { B, THREE } = k; const g = new THREE.Group(); B(g, 1.5, 0.9, 0.08, '#0f172a', -0.5, 0.85, -0.2); B(g, 1.36, 0.76, 0.02, k.mix(col, 1.1), -0.5, 0.92, -0.15, { e: 0.35 }); B(g, 0.12, 0.5, 0.12, '#475569', -0.5, 0.35, -0.2); B(g, 0.7, 0.06, 0.4, '#475569', -0.5, 0.3, -0.2); B(g, 1.1, 0.3, 0.7, '#d9c7a6', -0.5, 0, 0.5);
    B(g, 0.8, 1.7, 0.7, '#1f2937', 1.2, 0, -0.1); [0.3, 0.7, 1.1, 1.45].forEach((y, i) => { B(g, 0.66, 0.2, 0.04, '#334155', 1.2, y, 0.27); B(g, 0.06, 0.06, 0.04, i % 2 ? '#22c55e' : '#38bdf8', 1.0, y + 0.07, 0.3, { e: 0.9 }); }); return { group: g };
  },
};
export const MODEL_IDS = Object.keys(MODELS);
/** @returns {{group: any, tick?: (t: number, live: boolean) => void}} */
export function buildModel(k, theme, col) {
  const m = (MODELS[theme] || MODELS.web)(k, col || '#3758f9'); m.group.updateMatrixWorld(true);
  const b = new k.THREE.Box3().setFromObject(m.group); m.group.position.x -= (b.min.x + b.max.x) / 2;   // every model is centred left-right on its pad
  return m;
}

/* --------------------------------------------------------------------------------------------------------------------------------- people */
const SKINS = ['#f1c9a5', '#e0ac82', '#c68e64', '#8d5a3b']; const HAIRS = ['#1f2937', '#3b2f2f', '#111827', '#4b3621', '#2a1b12'];
/**
 * A person: head, neck, torso, two arms, two legs, hair — and the prop of the role. Returns { group, pose(phase, walking) }.
 * `role` ∈ site-deco ROLE_LOOK (admin / head / officer / committee / researcher / user), or `kind` ∈ KIND_LOOK (nurse …).
 */
export function buildPerson(k, role, seed = 0, kind = '', walkingPerson = false) {
  const { B, C, S, THREE, M } = k; const L = (role && ROLE_LOOK[role]) || (kind && KIND_LOOK[kind]) || {}; const skin = SKINS[(seed >> 1) % 4]; const hair = L.gray ? '#9ca3af' : HAIRS[(seed >> 2) % 5];
  const fem = (seed & 1) === 1; const top = L.top || '#64748b'; const pants = L.pants || '#334155'; const g = new THREE.Group(); const body = new THREE.Group(); g.add(body);
  const pivot = (x, y) => { const p = new THREE.Group(); p.position.set(x, y, 0); body.add(p); return p; };
  const legL = pivot(-0.1, 0.5); const legR = pivot(0.1, 0.5); const armL = pivot(-0.25, 1.12); const armR = pivot(0.25, 1.12);
  for (const lg of [legL, legR]) { C(lg, 0.07, 0.06, 0.5, fem && !L.coat ? skin : pants, 0, -0.5, 0, {}, 0, 0, 8); B(lg, 0.12, 0.07, 0.2, '#111827', 0, -0.52, 0.04); }
  for (const am of [armL, armR]) { C(am, 0.055, 0.05, 0.42, top, 0, -0.42, 0, {}, 0, 0, 8); S(am, 0.055, skin, 0, -0.44, 0); }
  const torso = C(body, fem ? 0.2 : 0.22, fem ? 0.17 : 0.18, 0.62, top, 0, 0.5, 0, {}, 0, 0, 10); if (L.coat) C(body, 0.23, 0.27, 0.62, top, 0, 0.1, 0, {}, 0, 0, 10);
  if (fem && (role === 'officer' || role === 'committee' || role === 'head' || kind === 'nurse')) C(body, 0.17, 0.26, 0.28, pants, 0, 0.36, 0, {}, 0, 0, 10);
  C(body, 0.05, 0.05, 0.1, skin, 0, 1.1, 0, {}, 0, 0, 8); S(body, 0.15, skin, 0, 1.33, 0); S(body, 0.16, hair, 0, 1.38, -0.025);
  if (fem) C(body, 0.15, 0.15, 0.3, hair, 0, 1.12, -0.07, {}, 0, 0, 8);
  if (L.helmet) { const h = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), M('#facc15')); h.position.set(0, 1.4, 0); body.add(h); }
  if (L.cap) { B(body, 0.3, 0.1, 0.22, '#ffffff', 0, 1.5, 0); B(body, 0.05, 0.12, 0.02, '#dc2626', 0, 1.52, 0.12); }
  if (L.glasses) { B(body, 0.26, 0.04, 0.02, '#111827', 0, 1.34, 0.145); }
  if (L.tie) B(body, 0.05, 0.3, 0.02, L.tie, 0, 0.78, 0.2);
  if (L.badge) { B(body, 0.03, 0.4, 0.02, '#0e7490', 0, 0.7, 0.2); B(body, 0.12, 0.14, 0.02, '#ffffff', 0, 0.62, 0.21); }
  if (L.vest) B(body, 0.46, 0.4, 0.02, '#e5e7eb', 0, 0.62, 0.2);
  if (L.bag) B(body, 0.28, 0.4, 0.14, L.bag, 0, 0.75, -0.2);
  const hold = (m) => { m.position.set(0.0, -0.42, 0.14); armR.add(m); armR.userData.holds = true; };
  if (L.item === 'clip') { const c = new THREE.Group(); B(c, 0.2, 0.28, 0.02, '#f8fafc', 0, -0.14, 0); B(c, 0.08, 0.04, 0.03, '#475569', 0, 0.0, 0); hold(c); }
  else if (L.item === 'papers') { const c = new THREE.Group(); B(c, 0.22, 0.28, 0.03, '#ffffff', 0, -0.14, 0); hold(c); }
  else if (L.item === 'vial') { const c = new THREE.Group(); C(c, 0.025, 0.025, 0.2, '#f9a8d4', 0, -0.1, 0, {}, 0, 0, 8); hold(c); }
  else if (L.item === 'phone') { const c = new THREE.Group(); B(c, 0.08, 0.14, 0.015, '#111827', 0, -0.07, 0); hold(c); }
  const holds = !!armR.userData.holds;
  if (walkingPerson) { bake(k, body, [legL, legR, armL, armR]); [legL, legR, armL, armR].forEach((p) => bake(k, p)); }
  else { armR.rotation.x = holds ? -1.05 : 0; bake(k, g); }   // standing: posed once, then merged into a single mesh
  return {
    group: g, holds,
    /** phase: radians; walking: swing arms and legs; otherwise stand (the holding arm is raised) */
    pose(phase, walking) {
      if (!walkingPerson) return;
      const s = walking ? Math.sin(phase) : 0; legL.rotation.x = s * 0.7; legR.rotation.x = -s * 0.7; armL.rotation.x = -s * 0.6; armR.rotation.x = holds && !walking ? -1.05 : s * 0.6;
      body.position.y = walking ? Math.abs(Math.sin(phase)) * 0.04 : 0; if (!walking) body.rotation.z = Math.sin(phase * 0.2) * 0.02;
    },
  };
}

/**
 * Merge every STATIC, opaque, untextured mesh under `root` into ONE mesh with a colour per vertex (a handful of draw calls instead of hundreds — what makes the scene light enough for a phone).
 * Left alone: transparent / glowing / textured meshes, meshes marked `userData.keep` (they move by themselves) and everything under the objects in `skip`.
 * @returns the merged mesh (already added to `root`) or null
 */
export function bake(k, root, skip = []) {
  const { THREE } = k; root.updateMatrixWorld(true); const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(); const pos = []; const nor = []; const col = []; const dead = []; const mt = new THREE.Matrix4();
  const visit = (o) => {
    if (skip.includes(o)) return;
    if (o.isMesh && !o.userData.keep && o.visible) {
      const mat = o.material;
      if (mat && !Array.isArray(mat) && !mat.transparent && !(mat.emissiveIntensity > 0) && !mat.map && mat.color) {
        const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone(); g.applyMatrix4(mt.multiplyMatrices(inv, o.matrixWorld));
        const p = g.attributes.position.array; const n = g.attributes.normal.array; for (let i = 0; i < p.length; i++) { pos.push(p[i]); nor.push(n[i]); }
        for (let i = 0; i < p.length / 3; i++) col.push(mat.color.r, mat.color.g, mat.color.b); g.dispose(); dead.push(o);
      }
    }
    for (const c of o.children) visit(c);
  };
  visit(root); dead.forEach((o) => { if (o.parent) o.parent.remove(o); }); if (!pos.length) return null;
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const mesh = new THREE.Mesh(geo, k.baked()); mesh.userData.baked = true; root.add(mesh); return mesh;
}
