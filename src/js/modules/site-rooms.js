// 3D "rooms": one small model per kind of page, drawn with the isometric helpers of site-sim.js (box / faceX / faceY / disc / poly).
// The model tells the viewer at a glance what the page is for — an odometer for "บันทึกไมล์", a car on a checklist stand for "ตรวจสภาพรถ", a calendar wall for "ตารางงาน" …
// Add a new kind: put it in PAGE_KINDS + PAGE_RULES (site-engine.js), give it a colour in PAGE_COL and a `case` in drawRoom() below.

export const PAGE_COL = {
  'p:home': '#3758f9', 'p:dash': '#7c3aed', 'p:map': '#0891b2', 'p:ems': '#dc2626', 'p:check': '#16a34a', 'p:mile': '#d97706', 'p:cal': '#0b7a7c',
  'p:swap': '#be185d', 'p:report': '#64748b', 'p:admin': '#475569', 'p:form': '#c2410c', 'p:login': '#0f766e', 'p:page': '#3758f9', 'p:other': '#94a3b8',
};
export const roomColor = (kind) => PAGE_COL[kind] || PAGE_COL['p:page'];

/**
 * @param {object} g  drawing kit from site-sim.js: {ctx, P, Z, tw, pal, reduced, box, faceX, faceY, disc, poly, shade}
 * @param {string} kind page kind (see PAGE_KINDS)  @param {number} cx room centre x  @param {number} cy room centre y
 * @param {string} col room colour  @param {boolean} lit people are in the room → lights / screens animate  @param {number} now ms
 */
export function drawRoom(g, kind, cx, cy, col, lit, now) {
  const { ctx, P, Z, tw, pal, box, faceY, disc, poly, shade } = g;
  const anim = lit && !g.reduced; const blink = anim ? Math.floor(now / 320) % 2 : 0; const sw = anim ? Math.sin(now / 700) : 0;
  const u = tw / 2;   // pixels per world unit
  /** Draw on the wall that faces the viewer (+y side): fn(u) works in world units, x → right, y → *down* (so pass -height). */
  const wall = (x, y, z, fn) => { const [sx, sy] = P(x, y, Z(z)); ctx.save(); ctx.translate(sx, sy); ctx.transform(1, 0.5, 0, 1, 0, 0); fn(u); ctx.restore(); };
  const rect = (x, z, w, hgt, fill) => { ctx.fillStyle = fill; ctx.fillRect(x * u, -(z + hgt) * u, w * u, hgt * u); };
  const board = (x, y, w, hgt, z0, fill) => box(x, y, w, 0.06, hgt, fill, z0);           // upright panel; its front face is at y + 0.03
  const front = (y) => y + 0.031;

  const car = (x, y, body) => {
    box(x - 0.3, y - 0.26, 0.2, 0.08, 0.2, '#111827'); box(x + 0.3, y - 0.26, 0.2, 0.08, 0.2, '#111827');
    box(x, y, 1.0, 0.5, 0.2, body, 0.1); box(x - 0.08, y, 0.52, 0.46, 0.2, shade(body, 1.12), 0.3);
    faceY(x - 0.3, x + 0.1, y + 0.231, 0.33, 0.47, '#bae6fd'); box(x + 0.48, y, 0.06, 0.4, 0.07, blink ? '#fde047' : '#fef9c3', 0.18);
    box(x - 0.3, y + 0.26, 0.2, 0.08, 0.2, '#111827'); box(x + 0.3, y + 0.26, 0.2, 0.08, 0.2, '#111827');
  };
  const ambulance = (x, y) => {
    box(x - 0.4, y - 0.33, 0.24, 0.1, 0.24, '#111827'); box(x + 0.5, y - 0.33, 0.24, 0.1, 0.24, '#111827');
    box(x - 0.1, y, 1.2, 0.7, 0.55, '#f8fafc', 0.14); box(x + 0.62, y, 0.5, 0.7, 0.38, '#e2e8f0', 0.14);
    faceY(x - 0.7, x + 0.5, y + 0.351, 0.2, 0.28, '#dc2626'); faceY(x - 0.22, x + 0.02, y + 0.352, 0.5, 0.56, '#dc2626'); faceY(x - 0.13, x - 0.07, y + 0.352, 0.41, 0.65, '#dc2626');
    box(x - 0.4, y + 0.33, 0.24, 0.1, 0.24, '#111827'); box(x + 0.5, y + 0.33, 0.24, 0.1, 0.24, '#111827');
    box(x + 0.45, y, 0.14, 0.4, 0.08, blink ? '#ef4444' : '#3b82f6', 0.52); box(x - 0.55, y, 0.14, 0.3, 0.07, blink ? '#3b82f6' : '#ef4444', 0.69);
  };
  const desk = (x, y, w = 1.2, d = 0.5) => box(x, y, w, d, 0.3, pal.desk);
  const clip = (x, y, rows) => {   // clipboard stand with a ticked checklist
    box(x, y, 0.62, 0.06, 0.78, '#cbd5e1', 0.28); box(x, y, 0.5, 0.07, 0.66, '#f8fafc', 0.34);
    wall(x - 0.22, front(y) + 0.005, 0.38, () => rows.forEach((done, i) => {
      const zz = 0.56 - i * 0.14; rect(0.12, zz, 0.26, 0.035, '#94a3b8');
      ctx.strokeStyle = done ? '#16a34a' : '#cbd5e1'; ctx.lineWidth = Math.max(1.2, u * 0.035); ctx.beginPath(); ctx.moveTo(0.02 * u, -(zz + 0.02) * u); ctx.lineTo(0.05 * u, -(zz - 0.02) * u); ctx.lineTo(0.1 * u, -(zz + 0.07) * u); ctx.stroke();
    }));
  };

  switch (kind) {
    case 'p:home': {   // reception: welcome desk, coloured sign, plant, globe
      board(cx, cy - 0.78, 1.6, 0.8, 0.5, col); box(cx, cy - 0.78, 1.7, 0.08, 0.06, '#e2e8f0', 0.5);
      wall(cx - 0.55, front(cy - 0.78), 0.8, () => { rect(0, 0.18, 1.1, 0.07, 'rgba(255,255,255,.95)'); rect(0, 0.04, 0.7, 0.05, 'rgba(255,255,255,.7)'); });
      desk(cx, cy + 0.1, 1.3, 0.42); box(cx - 0.4, cy + 0.05, 0.3, 0.05, 0.24, '#334155', 0.3); box(cx + 0.1, cy + 0.12, 0.2, 0.14, 0.02, '#fde047', 0.3);
      box(cx + 0.78, cy - 0.4, 0.2, 0.2, 0.2, '#92400e'); disc(cx + 0.78, cy - 0.4, 0.34, tw * 0.1, '#16a34a'); disc(cx + 0.78, cy - 0.4, 0.45, tw * 0.06, '#22c55e');
      disc(cx + 0.55, cy + 0.12, 0.6 + 0.02 * sw, tw * 0.06, '#38bdf8'); break;
    }
    case 'p:mile': {   // odometer: big dial + digit strip on the wall, car beside it
      board(cx + 0.3, cy - 0.78, 0.95, 0.95, 0.4, '#1e293b');
      wall(cx + 0.3, front(cy - 0.78), 0.72, () => {
        ctx.fillStyle = '#0f172a'; ctx.strokeStyle = col; ctx.lineWidth = Math.max(2, u * 0.05); ctx.beginPath(); ctx.arc(0, -0.3 * u, 0.36 * u, 0, 7); ctx.fill(); ctx.stroke();
        for (let k = 0; k <= 8; k++) { const a = Math.PI * (1.15 + 0.7 * (k / 8)) ; ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(Math.cos(a) * 0.3 * u, -0.3 * u + Math.sin(a) * 0.3 * u); ctx.lineTo(Math.cos(a) * 0.35 * u, -0.3 * u + Math.sin(a) * 0.35 * u); ctx.stroke(); }
        const a = Math.PI * (1.15 + 0.7 * (0.5 + 0.5 * sw)); ctx.strokeStyle = '#ef4444'; ctx.lineWidth = Math.max(2, u * 0.035); ctx.beginPath(); ctx.moveTo(0, -0.3 * u); ctx.lineTo(Math.cos(a) * 0.3 * u, -0.3 * u + Math.sin(a) * 0.3 * u); ctx.stroke();
        for (let k = 0; k < 6; k++) { rect(-0.3 + k * 0.105, -0.34, 0.09, 0.13, k > 3 ? col : '#e2e8f0'); }
      });
      car(cx - 0.45, cy + 0.25, '#e2e8f0'); break;
    }
    case 'p:check': {   // vehicle inspection: car + checklist stand, ticks appear one by one
      car(cx - 0.3, cy + 0.2, '#f1f5f9'); const done = anim ? Math.floor(now / 800) % 5 : 3; clip(cx + 0.62, cy - 0.35, [done > 0, done > 1, done > 2, done > 3]);
      box(cx - 0.3, cy - 0.5, 0.9, 0.12, 0.05, '#fbbf24', 0); break;
    }
    case 'p:ems': {   // EMS vehicle check: ambulance + checklist
      ambulance(cx - 0.2, cy + 0.2); const done = anim ? Math.floor(now / 800) % 5 : 3; clip(cx + 0.72, cy - 0.45, [done > 0, done > 1, done > 2, done > 3]); break;
    }
    case 'p:cal': {   // work roster: wall calendar grid + table
      board(cx, cy - 0.8, 1.7, 1.0, 0.36, '#f8fafc');
      wall(cx - 0.75, front(cy - 0.8), 0.5, () => {
        rect(0, 0.78, 1.5, 0.16, col);
        for (let r = 0; r < 4; r++) for (let c = 0; c < 7; c++) { const on = (r * 7 + c + Math.floor(anim ? now / 900 : 0)) % 9 === 0; rect(c * 0.215, 0.58 - r * 0.17, 0.19, 0.14, on ? '#f59e0b' : r === 0 && c % 7 > 4 ? '#cbd5e1' : '#e2e8f0'); }
      });
      desk(cx, cy + 0.3, 1.3, 0.45); box(cx - 0.3, cy + 0.3, 0.4, 0.28, 0.03, '#ffffff', 0.3); box(cx + 0.35, cy + 0.3, 0.14, 0.14, 0.1, '#0b7a7c', 0.3); break;
    }
    case 'p:dash': {   // dashboard: monitor wall with animated bars + two stand screens
      board(cx, cy - 0.78, 1.7, 0.85, 0.42, '#0f172a');
      wall(cx - 0.72, front(cy - 0.78), 0.55, () => {
        for (let k = 0; k < 6; k++) { const hh = 0.18 + 0.16 * (1 + Math.sin(k * 1.3 + (anim ? now / 500 : 0))); rect(k * 0.12, 0.05, 0.085, hh, k % 2 ? col : '#38bdf8'); }
        ctx.strokeStyle = '#4ade80'; ctx.lineWidth = Math.max(1.5, u * 0.03); ctx.beginPath(); for (let k = 0; k <= 8; k++) { const px = (0.85 + k * 0.08) * u; const py = -(0.3 + 0.12 * Math.sin(k * 1.1 + (anim ? now / 600 : 0))) * u; if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py); } ctx.stroke();
      });
      box(cx - 0.4, cy + 0.3, 0.5, 0.06, 0.4, '#1e293b', 0.1); box(cx - 0.4, cy + 0.3, 0.42, 0.04, 0.3, shade(col, 1.2), 0.15); box(cx + 0.35, cy + 0.3, 0.4, 0.06, 0.34, '#1e293b', 0.1); break;
    }
    case 'p:swap': {   // exchange: two desks, a token travelling both ways + arrows on the floor
      desk(cx - 0.62, cy + 0.15, 0.6, 0.55); desk(cx + 0.62, cy + 0.15, 0.6, 0.55);
      const k = cx + sw * 0.5; box(k, cy + 0.15, 0.2, 0.2, 0.14, col, 0.55 + 0.04 * Math.abs(sw)); box(cx - 0.62, cy + 0.15, 0.22, 0.22, 0.12, '#f59e0b', 0.3); box(cx + 0.62, cy + 0.15, 0.22, 0.22, 0.12, '#38bdf8', 0.3);
      const arrow = (y, dir) => poly([P(cx - 0.28 * dir, y - 0.05, Z(0.02)), P(cx + 0.12 * dir, y - 0.05, Z(0.02)), P(cx + 0.12 * dir, y - 0.13, Z(0.02)), P(cx + 0.32 * dir, y, Z(0.02)), P(cx + 0.12 * dir, y + 0.13, Z(0.02)), P(cx + 0.12 * dir, y + 0.05, Z(0.02)), P(cx - 0.28 * dir, y + 0.05, Z(0.02))], col);
      arrow(cy - 0.5, 1); arrow(cy - 0.8, -1); break;
    }
    case 'p:map': {   // route map: map table with roads, dashed route and a bouncing pin
      box(cx, cy, 1.6, 1.0, 0.3, '#cbd5e1'); const z = Z(0.305); const T = (x, y) => P(cx + x, cy + y, z);
      poly([T(-0.75, -0.45), T(0.75, -0.45), T(0.75, 0.45), T(-0.75, 0.45)], '#d1fae5'); poly([T(-0.75, 0.05), T(0.1, 0.05), T(0.1, 0.45), T(-0.75, 0.45)], '#bae6fd'); poly([T(0.35, -0.45), T(0.75, -0.45), T(0.75, -0.05), T(0.35, -0.05)], '#fef3c7');
      ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = Math.max(2, tw * 0.03); ctx.beginPath(); [[-0.75, -0.1, 0.75, -0.1], [0.1, -0.45, 0.1, 0.45]].forEach(([a, b, c, d]) => { const p1 = T(a, b); const p2 = T(c, d); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); }); ctx.stroke();
      ctx.strokeStyle = col; ctx.lineWidth = Math.max(2, tw * 0.035); ctx.setLineDash([6, 5]); ctx.lineDashOffset = anim ? -now / 60 : 0; ctx.beginPath(); [[-0.6, 0.3], [-0.6, -0.1], [0.1, -0.1], [0.1, -0.3], [0.55, -0.3]].forEach(([a, b], i) => { const p = T(a, b); if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }); ctx.stroke(); ctx.setLineDash([]);
      const [px, py] = P(cx + 0.55, cy - 0.3, Z(0.3 + 0.06 * Math.abs(sw))); const r = tw * 0.075; ctx.fillStyle = '#ef4444'; ctx.beginPath(); ctx.arc(px, py - r * 2.2, r, 0, 7); ctx.fill(); poly([[px - r * 0.85, py - r * 1.5], [px + r * 0.85, py - r * 1.5], [px, py]], '#ef4444'); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(px, py - r * 2.2, r * 0.4, 0, 7); ctx.fill(); break;
    }
    case 'p:report': {   // report: printer with paper sliding out + chart sheet
      box(cx - 0.3, cy - 0.1, 0.7, 0.5, 0.3, '#e2e8f0'); box(cx - 0.3, cy - 0.1, 0.5, 0.35, 0.05, '#94a3b8', 0.3); box(cx - 0.3, cy + 0.25, 0.4, 0.22, 0.02 + (anim ? 0.01 * (Math.floor(now / 300) % 3) : 0), '#ffffff', 0.12);
      box(cx + 0.55, cy + 0.15, 0.5, 0.35, 0.3, pal.desk); box(cx + 0.55, cy + 0.15, 0.38, 0.26, 0.02, '#ffffff', 0.3); for (let k = 0; k < 3; k++) box(cx + 0.42 + k * 0.1, cy + 0.15, 0.06, 0.06, 0.04 + k * 0.03, k === 1 ? col : '#38bdf8', 0.32);
      for (let k = 0; k < 4; k++) box(cx - 0.75, cy + 0.5, 0.3, 0.22, 0.04, '#f8fafc', 0.02 + k * 0.045); break;
    }
    case 'p:admin': {   // admin: server racks with blinking LEDs + console desk
      for (const k of [-1, 0]) { const x = cx + k * 0.5 - 0.1; box(x, cy - 0.45, 0.45, 0.5, 1.1, '#334155'); for (let r = 0; r < 4; r++) { faceY(x - 0.19, x + 0.19, cy - 0.199, 0.12 + r * 0.24, 0.26 + r * 0.24, '#1e293b'); box(x + 0.12, cy - 0.2, 0.04, 0.02, 0.04, (r + k + blink) % 2 ? '#4ade80' : '#f59e0b', 0.16 + r * 0.24); } }
      desk(cx + 0.45, cy + 0.3, 0.8, 0.45); box(cx + 0.45, cy + 0.2, 0.4, 0.05, 0.3, '#0f172a', 0.3); disc(cx + 0.45, cy + 0.17, 0.46, tw * 0.05, col); break;
    }
    case 'p:form': {   // request form: desk, big form sheet with lines, pen, stamp
      desk(cx, cy + 0.2, 1.4, 0.7); const z = Z(0.305); const T = (x, y) => P(cx + x, cy + 0.2 + y, z);
      poly([T(-0.4, -0.28), T(0.25, -0.28), T(0.25, 0.28), T(-0.4, 0.28)], '#ffffff', '#cbd5e1', 1);
      ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1.5; ctx.beginPath(); for (let k = 0; k < 5; k++) { const a = T(-0.33, -0.2 + k * 0.1); const b = T(0.18 - (k % 2) * 0.1, -0.2 + k * 0.1); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); } ctx.stroke();
      box(cx + 0.5, cy + 0.15, 0.1, 0.1, 0.12, '#dc2626', 0.3); box(cx + 0.5 + 0.1 * sw, cy + 0.38, 0.28, 0.05, 0.02, col, 0.3); board(cx, cy - 0.78, 1.0, 0.6, 0.5, col); wall(cx - 0.35, front(cy - 0.78), 0.78, () => { rect(0, 0.05, 0.7, 0.07, 'rgba(255,255,255,.95)'); rect(0, 0.17, 0.5, 0.05, 'rgba(255,255,255,.7)'); }); break;
    }
    case 'p:login': {   // sign in: gate with a swinging arm + padlock sign
      box(cx - 0.55, cy + 0.05, 0.16, 0.16, 0.9, '#475569'); box(cx + 0.55, cy + 0.05, 0.16, 0.16, 0.9, '#475569'); box(cx - 0.55, cy + 0.05, 0.2, 0.2, 0.06, col, 0.9);
      box(cx - 0.55 + 0.55 * (anim ? 0.5 + 0.5 * sw : 0) + 0.45 * (anim ? 0 : 1), cy + 0.05, 0.9 * (anim ? 1 - 0.5 * (0.5 + 0.5 * sw) : 1), 0.06, 0.07, '#f59e0b', 0.55);
      board(cx, cy - 0.75, 0.8, 0.7, 0.45, '#0f172a'); wall(cx, front(cy - 0.75), 0.7, () => { ctx.fillStyle = '#e2e8f0'; ctx.beginPath(); ctx.roundRect(-0.14 * u, -0.13 * u, 0.28 * u, 0.22 * u, 3); ctx.fill(); ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = Math.max(2, u * 0.05); ctx.beginPath(); ctx.arc(0, -0.13 * u, 0.09 * u, Math.PI, 0); ctx.stroke(); }); break;
    }
    case 'p:other': {   // other pages: stacked boxes and folders
      box(cx - 0.35, cy, 0.5, 0.45, 0.3, '#94a3b8'); box(cx + 0.25, cy + 0.1, 0.5, 0.45, 0.3, '#cbd5e1'); box(cx - 0.05, cy + 0.05, 0.45, 0.4, 0.3, shade('#94a3b8', 1.15), 0.3); box(cx - 0.35, cy - 0.4, 0.36, 0.2, 0.1, col, 0.3); break;
    }
    default: {   // any other page: desk + monitor
      desk(cx, cy, 1.3, 0.5); const glow = anim ? 1 + 0.12 * Math.sin(now / 260) : 1; box(cx, cy - 0.05, 0.55, 0.08, 0.5, lit ? shade(col, glow) : pal.screen, 0.3); box(cx + 0.45, cy + 0.12, 0.16, 0.12, 0.08, '#ffffff', 0.3);
    }
  }
}
