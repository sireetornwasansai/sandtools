import { h, field, svgIcon, debounce } from '../core/dom.js';
import { ICONS } from '../core/icons.js';
import { getSession } from '../core/auth.js';
import { backendConfigured } from '../core/api.js';
import { notice } from '../core/notices.js';
import { toast } from '../core/toast.js';
import { copyText, downloadBlob, safeFileName } from '../core/download.js';
import { modal, confirmBox, closeAllLayers } from '../core/layers.js';
import { loadCss } from '../core/css.js';
import { fmt, ago, bkk } from '../core/charts.js';
import { QR_CATS, QR_TYPES, KIND_LABEL, catLabel, typeLabel, linksCall, shortUrl, savedPayload, savedDesign } from '../core/qrsaved.js';
import { buildMatrix, drawToCanvas, toSvg } from './qr-engine.js';

/** QR history: every QR the user saved (static copies and tracked QR), with what it is for, its category and — for tracked QR — how many people scanned it. */

const PAGE = 48;
const dateOf = (s) => { const d = bkk(s); return d ? d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }) : '-'; };

/** The picture of a saved QR as a canvas (optionally with the caption bar under it). null when it cannot be rebuilt (e.g. Wi-Fi with a password). */
function renderCanvas(item, base, { size, caption = false } = {}) {
  const payload = savedPayload(item, base); if (!payload) return null;
  const d = savedDesign(item); let matrix;
  try { matrix = buildMatrix(payload, d.ec); } catch { return null; }
  const qrCanvas = document.createElement('canvas');
  drawToCanvas(qrCanvas, matrix, { size: size || d.size, margin: d.margin, fg: d.fg, bg: d.bg, style: d.style, logoImage: null, logoRatio: 0 });
  if (!caption || !d.cap) return qrCanvas;
  const bar = Math.round(qrCanvas.width * 0.11); const out = document.createElement('canvas'); out.width = qrCanvas.width; out.height = qrCanvas.height + bar;
  const g = out.getContext('2d'); g.fillStyle = d.bg; g.fillRect(0, 0, out.width, out.height); g.drawImage(qrCanvas, 0, 0); g.fillStyle = d.fg;
  g.font = `600 ${Math.round(bar * 0.5)}px "Noto Sans Thai", Tahoma, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(d.cap, out.width / 2, qrCanvas.height + bar / 2, out.width * 0.92);
  return out;
}

export async function mount(root) {
  await loadCss('links'); await loadCss('qrs');
  const s = getSession();
  const host = h('div');
  root.append(h('div', { class: 'page' }, h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'ประวัติ QR Code'),
    h('p', null, 'QR ที่คุณสร้างและบันทึกไว้ พร้อมชื่อ หมวดงาน และจำนวนผู้สแกน (เฉพาะ QR ที่เลือก "ติดตามสถิติ") — ไม่เก็บ IP ของผู้สแกน')),
    h('a', { class: 'btn btn-primary', href: '#/qr' }, svgIcon(ICONS.plus, 18), 'สร้าง QR ใหม่')), host));
  if (!backendConfigured() || !s) { host.append(notice('warn', 'ต้องเข้าสู่ระบบก่อน', 'ประวัติ QR ใช้ได้เฉพาะผู้ที่ล็อกอินแล้ว (ข้อมูลเก็บไว้ในระบบของหน่วยงาน)')); return () => {}; }

  const st = { items: [], base: '', admin: false, q: '', cat: '', kind: '', type: '', sort: 'new', limit: PAGE, loaded: false };
  const me = ((s.user && s.user.email) || '').toLowerCase();
  let seq = 0;

  const kpi = h('div', { class: 'lnk-kpis' });
  const search = h('input', { type: 'search', placeholder: 'ค้นหาชื่อ QR หมายเหตุ หรือปลายทาง…', 'aria-label': 'ค้นหา QR' });
  search.addEventListener('input', debounce(() => { st.q = search.value.trim().toLowerCase(); st.limit = PAGE; draw(); }, 150));
  const sel = (label, key, opts) => h('select', { 'aria-label': label, onchange: (e) => { st[key] = e.target.value; st.limit = PAGE; draw(); } }, opts.map(([v, t]) => h('option', { value: v }, t)));
  const catSel = sel('กรองตามหมวดงาน', 'cat', [['', 'ทุกหมวดงาน'], ...QR_CATS.map((c) => [c[0], c[1]])]);
  const kindSel = sel('กรองตามรูปแบบ', 'kind', [['', 'ทุกรูปแบบ'], ['qr', 'ติดตามสถิติ'], ['qrs', 'เก็บประวัติอย่างเดียว']]);
  const typeSel = sel('กรองตามชนิด', 'type', [['', 'ทุกชนิด'], ...QR_TYPES]);
  const sortSel = sel('เรียงลำดับ', 'sort', [['new', 'ใหม่สุดก่อน'], ['scans', 'สแกนมากสุด'], ['week', 'สแกน 7 วันมากสุด'], ['name', 'ชื่อ ก–ฮ']]);
  const refreshBtn = h('button', { class: 'btn', type: 'button', onclick: () => load(true) }, svgIcon(ICONS.rotate, 18), 'รีเฟรช');
  const csvBtn = h('button', { class: 'btn', type: 'button', onclick: exportCsv }, svgIcon(ICONS.download, 18), 'ส่งออก CSV');
  const grid = h('div', { class: 'qrh-grid' });
  const moreBtn = h('button', { class: 'btn', type: 'button', hidden: true, onclick: () => { st.limit += PAGE; draw(); } }, 'แสดงเพิ่ม');
  const foot = h('p', { class: 'hint' });
  host.append(kpi, h('div', { class: 'card' }, h('div', { class: 'hist-tools qrh-tools' }, search, catSel, kindSel, typeSel, sortSel, refreshBtn, csvBtn), grid, h('div', { class: 'btn-row', style: 'justify-content:center' }, moreBtn), foot));

  async function load(skeleton = true) {
    const my = ++seq;
    if (skeleton) grid.replaceChildren(...[1, 2, 3, 4].map(() => h('div', { class: 'skeleton', style: 'height:170px' })));
    try {
      const d = await linksCall('list'); if (my !== seq) return;
      st.items = d.items.filter((l) => l.kind === 'qr' || l.kind === 'qrs'); st.base = d.base || ''; st.admin = !!d.admin; st.scanned = !!d.scanned; st.loaded = true; draw();
    } catch (e) {
      if (my !== seq) return;
      grid.replaceChildren(notice('error', 'โหลดประวัติ QR ไม่ได้', e.message));
    }
  }

  function filtered() {
    const q = st.q;
    const items = st.items.filter((l) => {
      const d = savedDesign(l);
      if (st.cat && d.cat !== st.cat) return false; if (st.kind && l.kind !== st.kind) return false; if (st.type && ((l.qr && l.qr.t) || 'url') !== st.type) return false;
      return !q || `${l.title} ${l.note} ${l.url} ${l.code} ${l.owner} ${catLabel(d.cat)} ${typeLabel((l.qr && l.qr.t) || 'url')}`.toLowerCase().includes(q);
    });
    const by = { new: (a, b) => (a.created < b.created ? 1 : -1), scans: (a, b) => b.clicks - a.clicks, week: (a, b) => b.week - a.week, name: (a, b) => (a.title || '').localeCompare(b.title || '', 'th') }[st.sort];
    return items.sort(by);
  }

  function drawKpi() {
    const tracked = st.items.filter((l) => l.kind === 'qr'); const total = tracked.reduce((a, l) => a + l.clicks, 0); const week = tracked.reduce((a, l) => a + l.week, 0);
    const top = [...tracked].sort((a, b) => b.clicks - a.clicks)[0];
    const card = (label, value, sub, icon) => h('div', { class: 'lnk-kpi' }, h('span', { class: 'lnk-kpi-ico' }, svgIcon(icon, 20)), h('div', null, h('small', null, label), h('b', null, value), sub ? h('span', { class: 'muted' }, sub) : null));
    kpi.replaceChildren(card('QR ที่บันทึกไว้', fmt(st.items.length), `ติดตามสถิติ ${fmt(tracked.length)} · เก็บประวัติ ${fmt(st.items.length - tracked.length)}`, ICONS.qr),
      card('สแกนทั้งหมด', fmt(total), 'เฉพาะ QR ที่ติดตามสถิติ ไม่นับบอท', ICONS.eye), card('สแกน 7 วันล่าสุด', fmt(week), null, ICONS.clock || ICONS.rotate),
      card('QR ยอดนิยม', top && top.clicks ? fmt(top.clicks) : '-', top && top.clicks ? top.title : 'ยังไม่มีคนสแกน', ICONS.list));
  }

  function draw() {
    if (!st.loaded) return;
    drawKpi();
    const all = filtered(); const shown = all.slice(0, st.limit);
    if (!shown.length) {
      grid.replaceChildren(h('div', { class: 'empty qrh-empty' }, svgIcon(ICONS.qr, 28), h('p', null, st.items.length ? 'ไม่พบ QR ที่ตรงกับเงื่อนไข' : 'ยังไม่มี QR ที่บันทึกไว้ — สร้าง QR แล้วกด “บันทึกลงประวัติ QR” ได้ที่หน้า QR Code'),
        st.items.length ? null : h('a', { class: 'btn btn-primary', href: '#/qr' }, 'ไปสร้าง QR')));
    } else grid.replaceChildren(...shown.map(card));
    moreBtn.hidden = all.length <= st.limit;
    foot.textContent = `แสดง ${fmt(Math.min(all.length, st.limit))} จาก ${fmt(all.length)} รายการ${st.scanned ? ' · สถิติคำนวณจากการสแกนล่าสุด 60,000 รายการ' : ''}${st.admin ? ' · ผู้ดูแลระบบเห็น QR ของทุกคน' : ''}`;
  }

  function card(l) {
    const d = savedDesign(l); const tracked = l.kind === 'qr'; const full = tracked ? shortUrl(st.base, l.code) : '';
    const thumb = renderCanvas(l, st.base, { size: 160 });
    const png = () => {
      const c = renderCanvas(l, st.base, { size: Math.max(d.size, 512), caption: true });
      if (!c) { toast('QR นี้มีรหัสผ่าน Wi-Fi ซึ่งไม่ได้เก็บไว้ — เปิดแก้ไขแล้วกรอกรหัสผ่านใหม่ก่อน', 'error', 6000); return; }
      c.toBlob((b) => { if (b) downloadBlob(b, `${safeFileName(l.title, 'qr')}.png`); else toast('สร้างไฟล์ PNG ไม่สำเร็จ', 'error'); }, 'image/png');
    };
    const svg = () => {
      const payload = savedPayload(l, st.base);
      if (!payload) { toast('QR นี้มีรหัสผ่าน Wi-Fi ซึ่งไม่ได้เก็บไว้ — เปิดแก้ไขแล้วกรอกรหัสผ่านใหม่ก่อน', 'error', 6000); return; }
      downloadBlob(new Blob([toSvg(buildMatrix(payload, d.ec), { size: d.size, margin: d.margin, fg: d.fg, bg: d.bg, style: d.style, logo: null })], { type: 'image/svg+xml;charset=utf-8' }), `${safeFileName(l.title, 'qr')}.svg`);
    };
    const img = thumb ? (thumb.className = 'qrh-thumb-img', thumb.setAttribute('role', 'img'), thumb.setAttribute('aria-label', `QR Code: ${l.title}`), thumb) : h('span', { class: 'qrh-nothumb', title: 'QR นี้ต้องกรอกรหัสผ่านใหม่' }, svgIcon(ICONS.alert, 22));
    return h('article', { class: 'qrh-card' },
      h('div', { class: 'qrh-top' }, h('div', { class: 'qrh-thumb' }, img),
        h('div', { class: 'qrh-info' }, h('b', { class: 'qrh-title', title: l.title }, l.title),
          h('div', { class: 'qrh-pills' }, h('span', { class: 'pill' }, catLabel(d.cat)), h('span', { class: 'pill lib-tag' }, typeLabel((l.qr && l.qr.t) || 'url')), h('span', { class: `pill ${tracked ? 'qrh-trk' : 'lib-tag'}` }, KIND_LABEL[l.kind]),
            l.status === 'disabled' ? h('span', { class: 'pill pill-err' }, 'ปิดอยู่') : null),
          l.note ? h('small', { class: 'muted qrh-note', title: l.note }, l.note) : null,
          tracked ? h('small', { class: 'qrh-short', title: l.url }, `${full.replace(/^https?:\/\//, '')} → ${l.url}`) : null,
          h('small', { class: 'muted' }, `สร้าง ${dateOf(l.created)}${st.admin && l.owner !== me ? ` · ${l.owner.split('@')[0]}` : ''}`))),
      tracked ? h('button', { class: 'qrh-scans', type: 'button', title: `สแกนล่าสุด: ${ago(l.last)} — กดเพื่อดูสถิติ`, onclick: () => { location.hash = `#/links?stats=${encodeURIComponent(l.code)}`; } },
        h('span', null, h('b', null, fmt(l.clicks)), h('small', null, 'ครั้งที่สแกน')), h('span', null, h('b', null, fmt(l.week)), h('small', null, '7 วันล่าสุด')), h('span', { class: 'qrh-go' }, 'ดูสถิติ ›'))
        : h('p', { class: 'qrh-scans qrh-static muted' }, 'ไม่นับผู้สแกน — ต้องการสถิติ ให้เปิดแก้ไขแล้วบันทึกเป็น “ติดตามสถิติ”'),
      h('div', { class: 'qrh-acts' },
        h('a', { class: 'btn btn-sm btn-primary', href: `#/qr?load=${encodeURIComponent(l.code)}` }, svgIcon(ICONS.edit, 16), 'เปิดแก้ไข'),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: png }, svgIcon(ICONS.download, 16), 'PNG'),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: svg }, 'SVG'),
        tracked ? h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => { toast((await copyText(full)) ? 'คัดลอกลิงก์ย่อแล้ว' : 'คัดลอกไม่สำเร็จ', 'info'); } }, svgIcon(ICONS.copy, 16), 'คัดลอกลิงก์') : null,
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => editInfo(l) }, 'แก้ชื่อ/หมวด'),
        h('button', { class: 'icon-btn qrh-del', type: 'button', 'aria-label': `ลบ ${l.title}`, title: 'ลบ', onclick: () => remove(l) }, svgIcon(ICONS.trash, 18))));
  }

  function editInfo(l) {
    const d = savedDesign(l);
    const t = h('input', { type: 'text', maxlength: 120, value: l.title }); const n = h('input', { type: 'text', maxlength: 300, value: l.note || '' });
    const c = h('select', { 'aria-label': 'หมวดงาน' }, QR_CATS.map(([v, label]) => h('option', { value: v, selected: v === d.cat }, label)));
    const u = h('input', { type: 'text', value: l.url, inputmode: 'url' });
    const on = h('input', { type: 'checkbox', id: 'qrh-on', checked: l.status !== 'disabled' });
    let mm = null;
    const save = h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
      if (!t.value.trim()) { t.focus(); toast('กรุณาตั้งชื่อ QR', 'error'); return; }
      try {
        const q = { t: (l.qr && l.qr.t) || 'url', d: { ...(l.qr && l.qr.d), cat: c.value } }; if (l.kind === 'qrs') q.f = (l.qr && l.qr.f) || {};
        const body = { code: l.code, title: t.value.trim(), note: n.value.trim(), qr: q };
        if (l.kind === 'qr') { body.url = u.value.trim(); body.status = on.checked ? 'active' : 'disabled'; }
        await linksCall('update', body); mm.close(); toast('บันทึกแล้ว', 'success'); await load(false);
      } catch (err) { toast(err.message, 'error', 6000); }
    } }, 'บันทึก');
    mm = modal('แก้ไขข้อมูล QR', [field('ชื่อ QR (เป็น QR ของอะไร)', t).root, field('หมวดงาน', c).root, field('หมายเหตุ', n).root,
      l.kind === 'qr' ? field('ลิงก์ปลายทาง', u, 'เปลี่ยนแล้ว QR เดิมที่พิมพ์ไปแล้วจะพาไปที่ปลายทางใหม่ทันที').root : null,
      l.kind === 'qr' ? h('div', { class: 'check' }, on, h('label', { for: 'qrh-on' }, 'เปิดใช้งาน (ปิด = ผู้สแกนจะเห็นหน้าแจ้งว่าใช้งานไม่ได้)')) : null].filter(Boolean),
    [save, h('button', { class: 'btn', type: 'button', onclick: () => mm.close() }, 'ยกเลิก')], { wide: true });
  }

  async function remove(l) {
    const tracked = l.kind === 'qr';
    if (!(await confirmBox({ title: 'ลบ QR นี้?', danger: true, confirm: 'ลบ', message: tracked ? `“${l.title}” จะหายจากประวัติ และ QR ที่พิมพ์ไปแล้วจะใช้งานไม่ได้ทันที (สถิติเดิมยังถูกเก็บไว้ในระบบ)` : `“${l.title}” จะถูกลบออกจากประวัติ QR` }))) return;
    try { await linksCall('delete', { code: l.code }); toast('ลบแล้ว', 'success'); await load(false); } catch (e) { toast(e.message, 'error', 5000); }
  }

  function exportCsv() {
    const rows = filtered(); if (!rows.length) { toast('ไม่มีรายการให้ส่งออก', 'error'); return; }
    const esc = (v) => { let t = String(v ?? ''); if (/^[=+\-@]/.test(t)) t = `'${t}`; return `"${t.replace(/"/g, '""')}"`; };
    const lines = [['ชื่อ QR', 'หมวดงาน', 'ชนิด', 'รูปแบบ', 'ลิงก์ย่อ', 'ปลายทาง', 'หมายเหตุ', 'สร้างเมื่อ', 'สแกนทั้งหมด', 'สแกน 7 วัน', 'สถานะ'].map(esc).join(',')];
    rows.forEach((l) => lines.push([l.title, catLabel(savedDesign(l).cat), typeLabel((l.qr && l.qr.t) || 'url'), KIND_LABEL[l.kind], l.kind === 'qr' ? shortUrl(st.base, l.code) : '', l.url, l.note, l.created, l.kind === 'qr' ? l.clicks : '', l.kind === 'qr' ? l.week : '', l.status === 'disabled' ? 'ปิด' : 'ใช้งาน'].map(esc).join(',')));
    downloadBlob(new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' }), `ประวัติ_QR_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.csv`);
    toast(`ส่งออก ${fmt(rows.length)} รายการ`, 'success');
  }

  load();
  return () => { seq += 1; closeAllLayers(); };
}
