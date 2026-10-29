// The rotatable 3D view of the home page (a real 3D scene, three.js): drag / one finger = rotate · wheel / pinch = zoom · right-drag / two fingers = move · tap a system = focus + details.
// Loaded only when the visitor asks for it ("3D หมุนได้"); the engine (src/js/vendor/three/, ≈0.7 MB) is then cached by the service worker. If WebGL is missing the caller keeps the flat view.
//
// Nothing floats: the name, the usage number and the hospital are printed on the PLINTH (a dark block) in front of every model, readable from all four sides. The scene is laid out on a grid,
// so models can never overlap each other. Colours / numbers / people come from the same data as the flat view (see mount3d() in site-sim.js, which feeds update()).

import { bake, buildModel, buildPerson, makeKit } from './site-models3d.js';
import { HOSPITAL_NAME, mix as mixHex } from './site-deco.js';

const fmt = (n) => Number(n || 0).toLocaleString('th-TH');
const SPACING = 7.6; const PAD = 5.8;

/** @typedef {{ key: string, name: string, icon: string, theme: string, col: string, state: string, stateText: string, value: number|null, approx: boolean, unit: string, online: number, people: string[], top: boolean }} Station */

/**
 * @param {HTMLElement} host   an empty element (the caller sizes it)
 * @param {{ onOpen?: (key: string) => void, onEnter?: (index: number, key: string) => void, onFail?: (why: string) => void, reduced?: boolean, font?: string, sub?: string }} api
 */
export async function mountScene3D(host, api) {
  const base = new URL('../vendor/three/', import.meta.url).href;
  /** @type {any} */ const THREE = await import(/* @vite-ignore */ `${base}three.module.min.js`);
  /** @type {any} */ const { OrbitControls } = await import(/* @vite-ignore */ `${base}OrbitControls.js`);
  const reduced = !!api.reduced; const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const font = api.font || 'sans-serif';
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: !coarse, alpha: false, powerPreference: 'high-performance' }); } catch (e) { throw new Error('WebGL ใช้ไม่ได้บนอุปกรณ์นี้'); }
  const dom = renderer.domElement; dom.className = 's3d-canvas'; dom.tabIndex = 0; dom.setAttribute('role', 'application'); dom.setAttribute('aria-label', 'ภาพ 3 มิติของระบบทั้งหมด ลากเพื่อหมุน บีบสองนิ้วเพื่อซูม ลากสองนิ้วเพื่อเลื่อน แตะระบบเพื่อดูรายละเอียด ใช้ลูกศรหมุน + / - ซูม');
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.75 : 2));
  const kit = makeKit(THREE); const scene = new THREE.Scene(); const camera = new THREE.PerspectiveCamera(42, 1, 0.5, 400);
  const controls = new OrbitControls(camera, dom);
  controls.enableDamping = !reduced; controls.dampingFactor = 0.09; controls.rotateSpeed = 0.7; controls.zoomSpeed = 0.9; controls.panSpeed = 0.8; controls.screenSpacePanning = false;
  controls.minPolarAngle = 0.2; controls.maxPolarAngle = Math.PI * 0.47; controls.minDistance = 7; controls.maxDistance = 90; controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

  /* ---------- lights, ground ---------- */
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 0.95)); const sun = new THREE.DirectionalLight(0xffffff, 1.05); sun.position.set(14, 22, 12); scene.add(sun); scene.add(new THREE.AmbientLight(0xffffff, 0.18));
  const ground = new THREE.Mesh(new THREE.CircleGeometry(90, 48), new THREE.MeshStandardMaterial({ color: 0xdfe7f1, roughness: 1 })); ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; scene.add(ground);
  const world = new THREE.Group(); scene.add(world);   // everything that is rebuilt when the set of systems changes
  const shadowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); const gr = x.createRadialGradient(32, 32, 2, 32, 32, 32); gr.addColorStop(0, 'rgba(0,0,0,.42)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();

  /* ---------- plate textures: name · hospital · number (printed on the plinth) ---------- */
  const texList = []; const tex = (w = 1024, h = 320) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; texList.push(t); return { c, t }; };
  const fit = (x, text, weight, size, maxW) => { x.font = `${weight} ${size}px ${font}`; let s = size; while (x.measureText(text).width > maxW && s > 20) { s -= 2; x.font = `${weight} ${s}px ${font}`; } return s; };
  function paintFront(c, st, shown) {
    const x = c.getContext('2d'); const W = c.width; const H = c.height; const col = st.state === 'ok' ? st.col : ({ paused: '#f59e0b', idle: '#94a3b8', silent: '#ef4444' }[st.state] || '#94a3b8');
    const gr = x.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#3b4a63'); gr.addColorStop(1, '#1e293b'); x.fillStyle = gr; x.fillRect(0, 0, W, H); x.fillStyle = col; x.fillRect(0, 0, 26, H);
    x.textBaseline = 'middle'; x.textAlign = 'left'; const has = st.value !== null && st.state === 'ok'; const leftMax = has ? 560 : 920;
    fit(x, `${st.icon} ${st.name}`, 700, 70, leftMax); x.fillStyle = '#ffffff'; x.fillText(`${st.icon} ${st.name}`, 58, 100);
    x.font = `600 40px ${font}`; x.fillStyle = '#e2e8f0'; x.fillRect(58, 205, 40, 12); x.fillRect(72, 191, 12, 40); x.fillStyle = '#cbd5e1'; fit(x, HOSPITAL_NAME, 600, 42, leftMax - 60); x.fillText(HOSPITAL_NAME, 118, 212);
    x.textAlign = 'right';
    if (has) {
      const txt = `${st.approx ? '≈' : ''}${fmt(Math.round(shown))}`; const size = fit(x, txt, 800, 150, 400); const nx = W - 50; const ny = 112;
      for (let q = 8; q >= 1; q--) { x.fillStyle = mixHex(col, 0.42 + 0.2 * (1 - q / 8)); x.fillText(txt, nx + q * 0.9, ny + q * 1.3); }
      const ng = x.createLinearGradient(0, ny - size * 0.5, 0, ny + size * 0.5); ng.addColorStop(0, mixHex(col, 1.7)); ng.addColorStop(0.6, mixHex(col, 1.3)); ng.addColorStop(1, mixHex(col, 1.05)); x.fillStyle = ng; x.fillText(txt, nx, ny); x.lineWidth = 2; x.strokeStyle = 'rgba(255,255,255,.4)'; x.strokeText(txt, nx, ny);
      x.font = `600 40px ${font}`; x.fillStyle = '#cbd5e1'; let ux = nx; const cy = 238;
      if (st.online > 0) { x.font = `700 40px ${font}`; x.fillStyle = '#4ade80'; const label = `ออนไลน์ ${fmt(st.online)}`; x.fillText(label, ux, cy); ux -= x.measureText(label).width + 26; x.beginPath(); x.arc(ux, cy, 9, 0, 7); x.fill(); ux -= 30; x.font = `600 40px ${font}`; x.fillStyle = '#cbd5e1'; }
      x.fillText(st.unit, ux, cy);
    } else { x.font = `700 52px ${font}`; x.fillStyle = col; x.fillText(st.stateText, W - 50, 112); }
    x.fillStyle = 'rgba(255,255,255,.14)'; x.fillRect(0, H - 6, W, 6);
  }
  function paintSide(c, st, shown) {
    const x = c.getContext('2d'); const W = c.width; const H = c.height; const col = st.state === 'ok' ? st.col : '#94a3b8'; x.fillStyle = '#1e293b'; x.fillRect(0, 0, W, H); x.fillStyle = col; x.fillRect(0, 0, W, 22);
    x.textAlign = 'center'; x.textBaseline = 'middle'; const has = st.value !== null && st.state === 'ok'; x.font = `700 46px ${font}`; fit(x, `${st.icon} ${st.name}`, 700, 46, W - 80); x.fillStyle = '#ffffff'; x.fillText(`${st.icon} ${st.name}`, W / 2, 84);
    const txt = has ? `${st.approx ? '≈' : ''}${fmt(Math.round(shown))}` : st.stateText; const size = fit(x, txt, 800, has ? 140 : 70, W - 80); x.fillStyle = mixHex(col, 1.35); x.fillText(txt, W / 2, 190); x.font = `600 38px ${font}`; x.fillStyle = '#cbd5e1'; if (has) x.fillText(st.unit, W / 2, 268);
  }

  /* ---------- scene content ---------- */
  /** @type {Station[]} */ let stations = []; let units = [];   // units[i] = { group, front, side, shown, target, tickers, people, pad, label }
  let dark = false; let structKey = ''; const focus = { i: -1 }; const clock = { t: 0 };
  const people = []; let sign = null;
  const gridOf = (n) => { const cols = Math.max(1, Math.ceil(Math.sqrt(n * 1.2))); const rows = Math.ceil(n / cols); return { cols, rows }; };
  const posOf = (i, n) => { const { cols, rows } = gridOf(n); const r = Math.floor(i / cols); const c = i % cols; const inRow = r === rows - 1 ? n - r * cols : cols; return [(c - (inRow - 1) / 2) * SPACING, (r - (rows - 1) / 2) * SPACING]; };

  function clearWorld() { while (world.children.length) world.children.pop(); texList.splice(0).forEach((t) => t.dispose()); units = []; people.length = 0; sign = null; }

  function rebuild() {
    clearWorld(); const n = stations.length; if (!n) return; const g0 = gridOf(n);
    const cols = g0.cols; const hospZ = -(g0.rows - 1) / 2 * SPACING - 8.2;
    // the hospital (landmark at the back) with its name board
    { const hb = new THREE.Group(); hb.position.set(0, 0, hospZ); world.add(hb); const w = Math.max(14, cols * SPACING * 0.8);
      kit.B(hb, w, 4.2, 3.2, '#f4f6fa', 0, 0, 0); kit.B(hb, w * 0.62, 2.2, 3.0, '#e6ebf3', 0, 4.2, 0); kit.B(hb, w + 0.4, 0.3, 3.4, '#0f766e', 0, 4.0, 0); kit.B(hb, 3.2, 2.0, 0.2, '#0f766e', 0, 0, 1.7);
      for (let i = 0; i < Math.floor(w / 2.2); i++) { kit.B(hb, 1.1, 0.9, 0.06, '#9ec9e8', -w / 2 + 1.6 + i * 2.2, 1.7, 1.62); kit.B(hb, 1.1, 0.9, 0.06, '#9ec9e8', -w / 2 + 1.6 + i * 2.2, 3.0, 1.62); }
      kit.B(hb, 0.5, 1.7, 0.2, '#ef4444', 0, 6.6, 1.2); kit.B(hb, 1.7, 0.5, 0.2, '#ef4444', 0, 7.2, 1.2);
      const c = document.createElement('canvas'); c.width = 1024; c.height = 256; const x = c.getContext('2d'); x.fillStyle = '#0f766e'; x.fillRect(0, 0, 1024, 256); x.fillStyle = '#ffffff'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = `800 110px ${font}`; x.fillText(HOSPITAL_NAME, 512, 100); x.font = `600 50px ${font}`; x.fillStyle = '#d1fae5'; x.fillText(api.sub || '', 512, 190);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; texList.push(t); const board = new THREE.Mesh(new THREE.BoxGeometry(8.4, 2.1, 0.3), [kit.M('#0f766e'), kit.M('#0f766e'), kit.M('#0f766e'), kit.M('#0f766e'), new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 }), kit.M('#0f766e')]);
      board.position.set(0, 2.6, 2.0); hb.add(board); for (const sx of [-3.8, 3.8]) kit.B(hb, 0.25, 1.6, 0.25, '#475569', sx, 0, 2.0); bake(kit, hb); }
    // trees around (a fixed pattern, not random: the same on every visit)
    const forest = new THREE.Group(); world.add(forest);
    for (let i = 0; i < 26; i++) { const a = i * 2.399; const r = 20 + (i % 5) * 4.2 + Math.sqrt(n) * 3.2; const tx = Math.cos(a) * r; const tz = Math.sin(a) * r * 0.8; const tr = new THREE.Group(); tr.position.set(tx, 0, tz); forest.add(tr); kit.C(tr, 0.18, 0.22, 1.0, '#7c5a3a', 0, 0, 0, {}, 0, 0, 7); const cone = new THREE.Mesh(new THREE.ConeGeometry(1.1, 2.6, 8), kit.M(i % 3 ? '#3f9b5a' : '#2f7d4b')); cone.position.y = 2.2; tr.add(cone); }
    bake(kit, forest);
    stations.forEach((st, i) => {
      const [px, pz] = posOf(i, n); const grp = new THREE.Group(); grp.position.set(px, 0, pz); world.add(grp);
      const state = st.state; const colSt = state === 'ok' ? st.col : '#94a3b8';
      const sh = new THREE.Mesh(new THREE.PlaneGeometry(PAD + 1.8, PAD + 1.8), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false })); sh.rotation.x = -Math.PI / 2; sh.position.y = 0.01; grp.add(sh);
      kit.B(grp, PAD, 0.18, PAD, kit.mix(colSt, 1.6), 0, 0, 0);
      kit.B(grp, PAD - 0.5, 0.04, PAD - 0.5, kit.mix(colSt, 1.82), 0, 0.18, 0); if (st.top) kit.B(grp, PAD + 0.4, 0.08, PAD + 0.4, '#f59e0b', 0, -0.02, 0, { e: 0.5 });
      const m = buildModel(kit, st.theme, colSt); m.group.position.set(0, 0.22, -0.45); grp.add(m.group);
      if (state !== 'ok') m.group.traverse((o) => { if (o.material && !o.userData.dim) { o.userData.dim = true; o.material = o.material.clone(); o.material.color.lerp(new THREE.Color('#9aa5b5'), 0.55); } });
      bake(kit, grp);   // pad + model: static parts merged into one mesh
      // the plinth (a dark block carrying the plate on its four sides)
      const fr = tex(1024, 320); const sdt = tex(512, 320);
      const mFront = new THREE.MeshStandardMaterial({ map: fr.t, roughness: 0.55 }); const mSide = new THREE.MeshStandardMaterial({ map: sdt.t, roughness: 0.55 }); const mTop = kit.M('#0f172a');
      const plinth = new THREE.Mesh(new THREE.BoxGeometry(3.5, 1.05, 1.1), [mSide, mSide, mTop, mTop, mFront, mFront]); plinth.position.set(0, 0.22 + 0.525, 2.05); grp.add(plinth);
      kit.B(grp, 3.5, 0.07, 1.1, colSt, 0, 0.22 + 1.05, 2.05);
      const pick = new THREE.Mesh(new THREE.BoxGeometry(PAD, 3.4, PAD), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false })); pick.position.set(0, 1.7, 0); pick.userData.index = i; pick.visible = false; grp.add(pick);   // invisible but still hit by the ray
      const u = { group: grp, front: fr, side: sdt, shown: reduced ? st.value || 0 : 0, target: st.value || 0, tick: m.tick, st, pick, pos: [px, pz], dirty: true };
      units.push(u);
      // people: standing near the plinth or walking round the pad
      const crowd = st.people.slice(0, 8); crowd.forEach((role, q) => {
        const walking = q % 3 === 0; const pe = buildPerson(kit, role === 'kid' ? '' : role, i * 13 + q * 7 + 1, role === 'nurse' ? 'nurse' : '', walking); 
        const side = q % 2 ? 1 : -1; const o = { ...pe, walking, u: (q * 0.37 + i * 0.11) % 1, dir: q % 4 < 2 ? 1 : -1, lane: (q % 3) * 0.28, stand: [side * (2.3 + 0.42 * Math.floor(q / 2)), 2.2 + (q % 3) * 0.18] };
        pe.group.scale.setScalar(1.15); grp.add(pe.group); people.push(o);
      });
      paintUnit(u, true);
    });
    camera.userData.n = n;
  }

  /** U-shaped walkway round the back and sides of a pad (the plinth stands at the front): position + heading at u ∈ [0,1]; `lane` pushes it a little inwards. */
  function walkAt(u, lane) {
    const a = 2.62 - lane; const pts = [[-a, 2.4], [-a, -a], [a, -a], [a, 2.4]]; const seg = pts.slice(1).map((p, k) => Math.hypot(p[0] - pts[k][0], p[1] - pts[k][1])); const total = seg[0] + seg[1] + seg[2]; let d = u * total;
    for (let k = 0; k < 3; k++) { if (d <= seg[k] || k === 2) { const f = Math.min(1, d / seg[k]); const p0 = pts[k]; const p1 = pts[k + 1]; return [p0[0] + (p1[0] - p0[0]) * f, p0[1] + (p1[1] - p0[1]) * f, (p1[0] - p0[0]) / seg[k], (p1[1] - p0[1]) / seg[k]]; } d -= seg[k]; }
    return [0, 0, 0, 1];
  }
  function paintUnit(u, force) {
    const st = u.st; if (!force && !u.dirty) return; u.dirty = false;
    paintFront(u.front.c, st, u.shown); u.front.t.needsUpdate = true; paintSide(u.side.c, st, u.shown); u.side.t.needsUpdate = true;
  }

  /* ---------- camera ---------- */
  const home = { az: 0.55, polar: 1.0, dist: 40, target: new THREE.Vector3(0, 1.2, 0) };
  /** Camera distance that shows the whole campus for this window shape (tall phone or wide desktop). */
  function fitHome() {
    const n = Math.max(1, stations.length); const { cols, rows } = gridOf(n); const halfW = (cols * SPACING) / 2 + 2; const D = rows * SPACING + 12; const eff = D * 0.62 + 6;
    const v = (camera.fov * Math.PI) / 360; const hh = Math.atan(Math.tan(v) * camera.aspect);
    home.dist = Math.min(controls.maxDistance, Math.max(14, Math.max(halfW / Math.tan(hh), eff / 2 / Math.tan(v)) * 1.08)); home.target.set(0, 1.0, -3.0);
  }
  function placeCamera(az, polar, dist, target) { camera.position.set(target.x + dist * Math.sin(polar) * Math.sin(az), target.y + dist * Math.cos(polar), target.z + dist * Math.sin(polar) * Math.cos(az)); controls.target.copy(target); camera.lookAt(target); controls.update(); }
  let fly = null;
  function flyTo(target, dist, polar, az) {
    const s = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target)); const from = { t: controls.target.clone(), d: s.radius, p: s.phi, a: s.theta };
    const toA = az === undefined ? from.a : az; let da = toA - from.a; da = Math.atan2(Math.sin(da), Math.cos(da));
    fly = { t0: performance.now(), dur: reduced ? 1 : 650, from, to: { t: target.clone(), d: dist, p: polar, a: from.a + da } }; wake();
  }
  function stepFly(now) {
    if (!fly) return; const k = Math.min(1, (now - fly.t0) / fly.dur); const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; const f = fly.from; const t = fly.to;
    placeCamera(f.a + (t.a - f.a) * e, f.p + (t.p - f.p) * e, f.d + (t.d - f.d) * e, new THREE.Vector3().lerpVectors(f.t, t.t, e)); if (k >= 1) fly = null;
  }
  const overview = () => { fitHome(); focus.i = -1; card.hidden = true; list.hidden = false; flyTo(home.target, home.dist, home.polar, home.az); };
  const topView = () => { fitHome(); flyTo(home.target, home.dist * 1.05, 0.28, 0); };

  /* ---------- HUD (plain HTML on top: buttons, hint, detail card) ---------- */
  const mk = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };
  const hud = mk('div', 's3d-hud');
  const btn = (label, title, fn, pressed, cls = 'btn btn-sm s3d-btn') => { const b = mk('button', cls); const [ic, ...rest] = String(label).split(' '); b.append(mk('span', 's3d-ic', ic)); if (rest.length) b.append(mk('span', 's3d-bt', ` ${rest.join(' ')}`)); /* 'icon word…' → the word hides on phones */ b.type = 'button'; b.title = title; b.setAttribute('aria-label', title); if (pressed !== undefined) b.setAttribute('aria-pressed', 'false'); b.addEventListener('click', fn); return b; };
  const bReset = btn('↺ รีเซ็ตมุม', 'รีเซ็ตมุมมอง กลับภาพรวม', () => overview()); const bTop = btn('⬆ มุมบน', 'มองจากด้านบน', () => topView());
  const bSpin = btn('⟳ หมุนเอง', 'หมุนรอบอัตโนมัติ', () => { controls.autoRotate = !controls.autoRotate; bSpin.setAttribute('aria-pressed', String(controls.autoRotate)); wake(); }, false);
  hud.append(bReset, bTop, bSpin);
  const hint = mk('p', 's3d-hint', coarse ? 'ลากหมุน · บีบซูม · ลาก 2 นิ้วเลื่อน · แตะระบบ' : 'ลาก = หมุน · ล้อเมาส์ = ซูม · คลิกขวาลาก = เลื่อน · คลิกระบบ = ดูรายละเอียด · ลูกศร / + − = ควบคุมด้วยแป้นพิมพ์');
  const card = mk('section', 's3d-card'); card.hidden = true; card.setAttribute('aria-live', 'polite');
  const list = mk('nav', 's3d-list'); list.setAttribute('aria-label', 'รายชื่อระบบ แตะเพื่อซูมไปที่ระบบนั้น');
  host.classList.add('s3d'); host.append(dom, hud, hint, list, card);
  let listKey = '';
  function drawList() {
    const key = stations.map((s) => `${s.key}|${Math.round(s.value || 0)}|${s.state}`).join(';'); if (key === listKey) return; listKey = key;
    list.replaceChildren(...stations.map((s, i) => { const b = mk('button', 's3d-chip'); b.type = 'button'; b.style.setProperty('--c', s.state === 'ok' ? s.col : '#94a3b8'); b.append(mk('i', 's3d-dot')); b.append(mk('span', 's3d-chip-n', `${s.icon} ${s.name}`)); b.append(mk('b', 's3d-chip-v', s.value !== null && s.state === 'ok' ? `${s.approx ? '≈' : ''}${fmt(Math.round(s.value))}` : s.stateText)); b.addEventListener('click', () => focusOn(i)); return b; }));
  }
  function showCard(i) {
    const st = stations[i]; if (!st) return; const has = st.value !== null && st.state === 'ok'; card.replaceChildren();
    const head = mk('div', 's3d-card-h'); head.append(mk('b', '', `${st.icon} ${st.name}`)); const x = btn('✕', 'ปิดรายละเอียด', () => overview(), undefined, 'btn s3d-x'); head.append(x);
    const body = mk('p', 's3d-card-b', has ? `${st.approx ? '≈' : ''}${fmt(Math.round(st.value))} ${st.unit}${st.online ? ` · ออนไลน์ ${fmt(st.online)} คน` : ''}` : st.stateText); const sub = mk('small', '', `${HOSPITAL_NAME} · ${st.state === 'ok' ? 'ปกติ' : st.stateText}`);
    const act = mk('div', 's3d-card-a'); if (api.onOpen) { const o = mk('button', 'btn btn-primary', 'ดูรายละเอียดโครงการ'); o.type = 'button'; o.addEventListener('click', () => api.onOpen(st.key)); act.append(o); }
    if (api.onEnter) { const e = mk('button', 'btn', 'เข้าไปดูภายในระบบ'); e.type = 'button'; e.addEventListener('click', () => api.onEnter(i, st.key)); act.append(e); }
    card.append(head, body, sub, act); card.hidden = false; list.hidden = true;
  }
  function focusOn(i) { const u = units[i]; if (!u) return; focus.i = i; showCard(i); const lift = host.clientHeight < 700 || host.clientWidth < 700 ? 3.4 : 1.2; flyTo(new THREE.Vector3(u.pos[0], 0.9, u.pos[1] + lift), 17, 0.98, 0.0); }

  /* ---------- picking (a tap / click that was not a drag) ---------- */
  const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2(); let down = null;
  dom.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; controls.autoRotate = false; bSpin.setAttribute('aria-pressed', 'false'); hint.hidden = true; fly = null; wake(); });
  dom.addEventListener('pointerup', (e) => {
    if (!down) return; const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y); const dt = performance.now() - down.t; down = null; if (moved > 8 || dt > 600) return;
    const r = dom.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(units.map((u) => u.pick), false)[0]; if (hit) focusOn(hit.object.userData.index); else if (focus.i >= 0) overview();
  });
  dom.addEventListener('keydown', (e) => {
    const k = e.key; const s = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target)); const t = controls.target.clone(); let ok = true;
    if (k === 'ArrowLeft') s.theta -= 0.15; else if (k === 'ArrowRight') s.theta += 0.15; else if (k === 'ArrowUp') s.phi = Math.max(0.25, s.phi - 0.1); else if (k === 'ArrowDown') s.phi = Math.min(1.45, s.phi + 0.1);
    else if (k === '+' || k === '=') s.radius = Math.max(controls.minDistance, s.radius * 0.88); else if (k === '-' || k === '_') s.radius = Math.min(controls.maxDistance, s.radius * 1.14);
    else if (k === 'Escape') { overview(); return; } else if (k === 'Tab' || k === 'Enter') ok = false; else ok = false;
    if (!ok) return; e.preventDefault(); placeCamera(s.theta, s.phi, s.radius, t); wake();
  });
  controls.addEventListener('change', () => wake());
  controls.addEventListener('end', () => { const t = controls.target; const lim = Math.max(20, Math.hypot(...[gridOf(Math.max(1, stations.length)).cols * SPACING, gridOf(Math.max(1, stations.length)).rows * SPACING]) * 0.7); const h = Math.hypot(t.x, t.z); if (h > lim) { t.x *= lim / h; t.z *= lim / h; controls.update(); } });

  /* ---------- loop: draws only while something moves; stops when hidden / off screen ---------- */
  let raf = 0; let last = 0; let onScreen = true; let dead = false; let idleFrames = 0; const fpsGap = coarse ? 1000 / 40 : 0;
  function wake() { idleFrames = 0; if (!raf && !dead) raf = requestAnimationFrame(loop); }
  function loop(now) {
    raf = 0; if (dead) return; if (document.hidden || !onScreen) { return; }
    if (fpsGap && now - last < fpsGap) { raf = requestAnimationFrame(loop); return; } const dt = last ? Math.min(0.1, (now - last) / 1000) : 0; last = now; clock.t += dt;
    stepFly(now); controls.update();
    let busy = !!fly || controls.autoRotate || units.some((u) => u.tick) || people.length > 0;
    if (!reduced) {
      for (const u of units) { if (u.tick) u.tick(clock.t, u.st.online > 0 && u.st.state === 'ok'); const d = u.target - u.shown; if (Math.abs(d) > 0.4) { u.shown += d * Math.min(1, dt * 6); u.dirty = true; busy = true; } else if (u.shown !== u.target) { u.shown = u.target; u.dirty = true; } if (u.dirty) paintUnit(u); }
      for (const p of people) { if (p.walking) { p.u += p.dir * dt * 0.045; if (p.u > 1) { p.u = 1; p.dir = -1; } else if (p.u < 0) { p.u = 0; p.dir = 1; } const [x1, z1, hx, hz] = walkAt(p.u, p.lane); p.group.position.set(x1, 0.22, z1); p.group.rotation.y = Math.atan2(hx * p.dir, hz * p.dir); p.pose(clock.t * 7 + p.u * 40, true); } else { p.group.position.set(p.stand[0], 0.22, p.stand[1]); p.group.rotation.y = p.stand[0] > 0 ? -0.5 : 0.5; p.group.rotation.z = Math.sin(clock.t * 1.4 + p.stand[0] * 2) * 0.02; } }
    } else { for (const u of units) { if (u.shown !== u.target) { u.shown = u.target; u.dirty = true; } if (u.dirty) paintUnit(u); } for (const p of people) { const w = p.walking ? walkAt(p.u, p.lane) : null; p.group.position.set(w ? w[0] : p.stand[0], 0.22, w ? w[1] : p.stand[1]); p.pose(0, false); } busy = !!fly || controls.autoRotate; }
    renderer.render(scene, camera);
    if (busy) { idleFrames = 0; raf = requestAnimationFrame(loop); } else if (++idleFrames < 3) raf = requestAnimationFrame(loop);
  }
  const ro = new ResizeObserver(() => { const w = Math.max(200, host.clientWidth); const h = Math.max(260, host.clientHeight); renderer.setSize(w, h, false); /* the canvas is absolutely positioned (CSS): it can never push its box wider */ camera.aspect = w / h; camera.updateProjectionMatrix(); if (camera.userData.n !== undefined && focus.i < 0 && !fly) { fitHome(); placeCamera(home.az, home.polar, home.dist, home.target); } wake(); });
  ro.observe(host);
  const io = typeof IntersectionObserver === 'function' ? new IntersectionObserver((e) => { onScreen = e[e.length - 1].isIntersecting; if (onScreen) wake(); }) : null; if (io) io.observe(host);
  const onVis = () => { if (!document.hidden) wake(); }; document.addEventListener('visibilitychange', onVis);
  dom.addEventListener('webglcontextlost', (e) => { e.preventDefault(); if (api.onFail) api.onFail('หน่วยความจำกราฟิกหมด — กลับไปใช้ภาพแบน'); });

  function applyTheme(isDark) {
    dark = isDark; const bg = new THREE.Color(isDark ? '#0b1220' : '#e8eef7'); scene.background = bg; scene.fog = new THREE.Fog(bg, 70, 150); ground.material.color.set(isDark ? '#141c2e' : '#dfe7f1');
    for (const l of scene.children) if (l.isHemisphereLight) l.intensity = isDark ? 0.55 : 0.95; sun.intensity = isDark ? 0.7 : 1.05;
  }
  /** Feed new data: rebuilds only when the set of systems / their themes change, otherwise repaints the plates (the numbers run up). */
  function update(snap) {
    if (dead) return; if (snap.dark !== dark) applyTheme(snap.dark); const key = snap.stations.map((s) => `${s.key}|${s.theme}|${s.col}|${s.state}|${s.top ? 1 : 0}|${s.people.join(',')}`).join(';');
    stations = snap.stations;
    if (key !== structKey) { structKey = key; const keepFocus = focus.i >= 0 ? stations[focus.i] && stations[focus.i].key : ''; rebuild(); fitHome(); if (!camera.userData.placed) { placeCamera(home.az, home.polar, home.dist, home.target); camera.userData.placed = true; } focus.i = keepFocus ? stations.findIndex((s) => s.key === keepFocus) : -1; if (focus.i < 0) card.hidden = true; }
    else units.forEach((u, i) => { const st = stations[i]; const changed = st.value !== u.st.value || st.online !== u.st.online || st.stateText !== u.st.stateText; u.st = st; u.target = st.value || 0; if (changed) u.dirty = true; if (reduced) u.shown = u.target; });
    drawList(); list.hidden = focus.i >= 0; if (focus.i >= 0) showCard(focus.i); wake();
  }
  applyTheme(false); ro.disconnect(); ro.observe(host);
  return {
    update, resetView: overview,
    destroy() {
      dead = true; cancelAnimationFrame(raf); ro.disconnect(); if (io) io.disconnect(); document.removeEventListener('visibilitychange', onVis); controls.dispose(); clearWorld();
      kit.dispose(); shadowTex.dispose(); renderer.dispose(); try { renderer.forceContextLoss(); } catch { /* already gone */ } host.replaceChildren(); host.classList.remove('s3d');
    },
  };
}
