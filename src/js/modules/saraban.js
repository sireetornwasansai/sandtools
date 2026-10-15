import { h, svgIcon, debounce, field } from '../core/dom.js';
import { ICONS } from '../core/icons.js';
import { getSession, signOut } from '../core/auth.js';
import { gasCall } from '../core/api.js';
import { notice } from '../core/notices.js';
import { toast } from '../core/toast.js';
import { modal, confirmBox } from '../core/layers.js';
import { loadCss } from '../core/css.js';
import { URGENCY, SECRECY, STAGE, TO_STATUS, ACTION, EVENT, thaiDate, thaiDateTime, thaiDateLong, ageLabel, stageIndex, STAGE_STEPS, buildRegisterHtml, buildReceiptHtml, dueLabel, stageTone, toCsv, fileToBase64 } from './saraban-engine.js';
import { receiveView, sendView, unitPicker } from './saraban-forms.js';

/**
 * สารบรรณอิเล็กทรอนิกส์ — one register for the organisation (the backend is gas/Saraban.gs).
 * Clerks: ลงรับ · ส่งออก · ทะเบียน · เลขทะเบียน.  Everyone: งานของฉัน (what was routed to their unit) · ติดตาม.  Executives: ภาพรวม · สั่งการ.  Admins: หน่วยงาน.
 */

const opt = (value, label, selected) => h('option', { value, selected: selected ? true : null }, label);
const errText = (e) => (e && e.message) || 'ทำรายการไม่สำเร็จ';
const safeUrl = (u) => (/^https:\/\//i.test(u) ? u : '#');
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'ไฟล์'; } };
const badge = (text, tone = 'muted') => h('span', { class: `sar-badge sar-${tone}` }, text);

export async function mount(root) {
  await loadCss('saraban');
  const s = getSession();
  const body = h('div');
  root.append(h('div', { class: 'page sar' }, h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'สารบรรณ'), h('p', null, 'ลงรับ ส่งออก ทะเบียน เลขทะเบียน ส่งต่อ/สั่งการ และติดตามหนังสือราชการ ในที่เดียว'))), body));
  if (!s) { body.append(notice('warn', 'ต้องเข้าสู่ระบบก่อน', 'ใช้อีเมลหน่วยงานเพื่อเข้าใช้งานสารบรรณ')); return; }

  async function call(op, params = {}, timeout = 30000) {
    try { return (await gasCall('saraban', { session: s.token, op, ...params }, timeout)).data; } catch (e) {
      if (e && (e.code === 'INVALID_SESSION' || e.code === 'DOMAIN_NOT_ALLOWED')) signOut();
      throw e;
    }
  }
  let cfg;
  try { cfg = await call('config'); } catch (e) {
    body.append(notice('error', 'เปิดสารบรรณไม่ได้', errText(e) + ' — ถ้าเพิ่งติดตั้ง ให้ผู้ดูแลระบบรัน setupSaraban() และ Deploy เวอร์ชันใหม่ของ Apps Script'));
    return;
  }
  const me = cfg.me; const unitName = (c) => { const u = cfg.units.find((x) => x.code === c); return u ? u.short || u.name : c; };
  const staff = me.staff; const reader = me.staff || me.exec;
  const TABS = [['home', 'ศูนย์สารบรรณ', reader], ['my', 'งานของฉัน', true], ['receive', 'ลงรับ', staff], ['send', 'ส่งออก', staff], ['register', 'ทะเบียน', reader], ['track', 'ติดตาม', true], ['numbers', 'เลขทะเบียน', staff], ['units', 'หน่วยงาน', me.admin]].filter((t) => t[2]);
  const bar = h('div', { class: 'sar-tabs', role: 'tablist', 'aria-label': 'เมนูสารบรรณ' }); const view = h('div', { class: 'sar-view' });
  let current = ''; let ver = 0;
  const X = { call, cfg, openDoc, go, refresh: (t) => go(t || current), me, unitName };
  function go(tab, params = {}) {
    if (!TABS.some((t) => t[0] === tab)) tab = TABS[0][0];
    current = tab; ver += 1; const my = ver;
    [...bar.children].forEach((b) => { const on = b.dataset.tab === tab; b.setAttribute('aria-selected', String(on)); b.classList.toggle('on', on); });
    view.replaceChildren(); view.setAttribute('aria-busy', 'true');
    const p = (async () => { await VIEWS[tab](view, X, params); })();
    p.catch((e) => { if (my === ver) view.replaceChildren(notice('error', 'โหลดข้อมูลไม่สำเร็จ', errText(e))); }).finally(() => { if (my === ver) view.removeAttribute('aria-busy'); });
  }
  TABS.forEach(([k, l]) => bar.append(h('button', { class: 'sar-tab', type: 'button', role: 'tab', dataset: { tab: k }, onclick: () => go(k) }, l)));
  body.append(bar, view);
  const VIEWS = { home: homeView, my: myView, receive: receiveTab, send: (el, x, p) => sendView(el, x, p), register: registerView, track: trackView, numbers: numbersView, units: unitsView };
  const want = new URLSearchParams((location.hash.split('?')[1]) || '').get('tab');
  go(TABS.some((t) => t[0] === want) ? want : reader ? 'home' : 'my');

  /* ----------------------------- small building blocks ----------------------------- */
  function docRow(d, extra) {
    const out = d.kind === 'out';
    return h('button', { class: `sar-row tone-${stageTone(d.stage, d.overdue)}`, type: 'button', onclick: () => openDoc(d.id) },
      h('div', { class: 'sar-no' }, h('strong', null, d.reg), h('span', null, out ? 'เลขส่ง' : 'เลขรับ')),
      h('div', { class: 'sar-main' }, h('div', { class: 'sar-subject' }, d.subject || '(ไม่มีเรื่อง)'), h('div', { class: 'muted sar-sub' }, [d.docNo, d.party, d.at ? thaiDate(String(d.at).slice(0, 10)) : ''].filter(Boolean).join(' · ')),
        h('div', { class: 'sar-badges' }, d.urgency !== 'normal' ? badge(URGENCY[d.urgency], d.urgency === 'urgent' ? 'warn' : 'bad') : null, d.secrecy !== 'normal' ? badge(SECRECY[d.secrecy], 'bad') : null, badge(STAGE[d.stage] || d.stage, stageTone(d.stage, 0)), d.overdue ? badge(`เลยกำหนด ${d.overdue} วัน`, 'bad') : null, ...(extra || []))));
  }
  function empty(text) { return h('p', { class: 'muted sar-empty' }, text); }
  /** Print a finished HTML sheet (register / received stamp) from a new tab — no inline scripts needed. */
  function printHtml(html) {
    const w = window.open(URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' })), '_blank');
    if (!w) { toast('เบราว์เซอร์บล็อกหน้าต่างใหม่ — อนุญาตป๊อปอัปแล้วลองอีกครั้ง', 'error'); return; }
    w.addEventListener('load', () => { try { w.focus(); w.print(); } catch { /* Ctrl+P still works */ } });
  }
  /** ลงรับ → ส่งต่อ → ดำเนินการ → เสร็จสิ้น (received letters only; void / sent letters have no bar). */
  function progressBar(d) {
    const at = d.kind === 'out' ? -1 : stageIndex(d.stage); if (at < 0) return null;
    return h('ol', { class: 'sar-progress', 'aria-label': `ความคืบหน้า: ${STAGE[d.stage] || d.stage}` }, STAGE_STEPS.map(([k, l], i) => h('li', { class: i < at ? 'done' : i === at ? (d.stage === 'returned' ? 'warn' : 'now') : '', 'aria-current': i === at ? 'step' : null }, l)));
  }
  /** Small generic dialog: fields [{name,label,type,options,value,hint,rows}] → Promise<values|null>. */
  function ask(title, fields, confirm = 'ตกลง', { danger = false, intro } = {}) {
    return new Promise((resolve) => {
      const inputs = {}; let done = false; let m = null;
      const rows = fields.map((f) => {
        const el = f.type === 'select' ? h('select', null, f.options.map(([v, l]) => opt(v, l, v === f.value))) : f.type === 'textarea' ? h('textarea', { rows: f.rows || 3, maxlength: f.max || 400, value: f.value || '' }) : h('input', { type: f.type || 'text', maxlength: f.max || 300, value: f.value || '', placeholder: f.placeholder || '' });
        inputs[f.name] = el; return field(f.label, el, f.hint).root;
      });
      const finish = (v) => { if (done) return; done = true; resolve(v); if (m) m.close(); };
      const ok = h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'button', onclick: () => { const v = {}; for (const f of fields) { v[f.name] = inputs[f.name].value.trim(); if (f.required && !v[f.name]) { inputs[f.name].focus(); toast(`กรุณากรอก “${f.label.replace(/ \*$/, '')}”`, 'info'); return; } if (f.min && v[f.name].length < f.min) { inputs[f.name].focus(); toast(`“${f.label.replace(/ \*$/, '')}” อย่างน้อย ${f.min} ตัวอักษร`, 'info'); return; } } finish(v); } }, confirm);
      m = modal(title, [intro ? h('p', { class: 'muted' }, intro) : null, ...rows], [ok, h('button', { class: 'btn', type: 'button', onclick: () => finish(null) }, 'ยกเลิก')], { onDismiss: () => finish(null), onClose: () => finish(null) });
    });
  }
  async function act(fn, okMsg) { try { const r = await fn(); if (okMsg) toast(okMsg, 'success'); return r || true; } catch (e) { toast(errText(e), 'error', 6000); return false; } }

  /* ----------------------------- ลงรับ: คิว Telegram + แบบฟอร์ม ----------------------------- */
  async function receiveTab(el, x, p) {
    if (!p.inboxId && cfg.queue) {
      let q = { items: [] }; try { q = await call('queue'); } catch (e) { el.append(notice('warn', 'อ่านคิว Telegram ไม่ได้', errText(e))); }
      if (q.items.length) {
        const box = h('div', { class: 'card sar-queue' }, h('h3', { class: 'sar-h3' }, `รอลงรับจากกลุ่ม Telegram (${q.items.length})`), h('p', { class: 'muted' }, 'ตรวจข้อมูลที่ระบบดึงมา แล้วกด “ลงรับ” เพื่อออกเลขรับในทะเบียนเดียวกัน — ฉบับที่ไม่ใช่หนังสือถึงหน่วยงานกด “ไม่นำเข้า”'));
        q.items.forEach((i) => box.append(h('div', { class: 'sar-qrow' }, h('div', { class: 'sar-main' }, h('div', { class: 'sar-subject' }, i.subject || '(ไม่มีเรื่อง)'), h('div', { class: 'muted sar-sub' }, [i.bookNo, i.from, i.bookDate ? `ลงวันที่ ${thaiDate(i.bookDate)}` : '', i.received ? thaiDateTime(i.received) : ''].filter(Boolean).join(' · ')),
          h('div', { class: 'sar-badges' }, i.urgency ? badge(URGENCY[i.urgency], i.urgency === 'urgent' ? 'warn' : 'bad') : i.urgentHint ? badge('มีคำว่าด่วน', 'bad') : null, i.registered ? badge(`อาจลงรับแล้ว เลขรับ ${i.registered}`, 'warn') : null, i.age != null ? badge(`รอ ${ageLabel(i.age)}`, i.age >= 3 ? 'bad' : 'muted') : null, ...(i.suggest || []).slice(0, 2).map((g) => badge(`น่าจะเกี่ยวกับ ${g.name}`, 'info')), ...(i.urls || []).slice(0, 2).map((u) => h('a', { class: 'sar-badge sar-muted', href: safeUrl(u), target: '_blank', rel: 'noopener noreferrer' }, `เปิดลิงก์ · ${host(u)}`)))),
        h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => go('receive', { inboxId: i.id, subject: i.subject, docNo: i.bookNo, docDate: i.bookDate, party: i.from, urgency: i.urgency || 'normal', channel: 'telegram', file: i.file || (i.urls || [])[0] || '' }) }, 'ลงรับ'),
          h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => { const a = await ask('ไม่นำเข้าหนังสือนี้', [{ name: 'reason', label: 'เหตุผล *', type: 'textarea', rows: 2, required: true, min: 5, placeholder: 'เช่น ไม่เกี่ยวข้องกับโรงพยาบาล / ซ้ำกับฉบับที่ลงรับแล้ว' }], 'ไม่นำเข้า', { danger: true }); if (a && await act(() => call('reject', { id: i.id, reason: a.reason }), 'ย้ายไป “ไม่นำเข้า” แล้ว')) go('receive'); } }, 'ไม่นำเข้า')))));
        el.append(box);
      }
    }
    const host2 = h('div'); el.append(host2); receiveView(host2, x, p);
  }

  /* ----------------------------- ภาพรวม ----------------------------- */
  async function homeView(el) {
    const d = await call('dash'); const k = d.kpi;
    let q = null; if (staff && cfg.queue && d.queue && d.queue.enabled && d.queue.n) { try { q = await call('queue'); } catch { q = null; } }
    const card = (label, value, tone, tab, params) => h('button', { class: `sar-kpi tone-${tone}`, type: 'button', onclick: () => go(tab, params) }, h('strong', null, String(value)), h('span', null, label));
    const max = Math.max(1, ...d.days.map((x) => Math.max(x.in, x.out)));
    el.append(
      h('p', { class: 'muted' }, `${thaiDateLong(d.today)} · ${d.org}`),
      q && q.items.length ? h('div', { class: 'card sar-queue' }, h('div', { class: 'sar-qhead' }, h('h3', { class: 'sar-h3' }, `คิวรอลงรับ (${d.queue.n})`), d.queue.urgent ? badge(`${d.queue.urgent} ฉบับมีคำว่า “ด่วน”`, 'bad') : null),
        ...q.items.slice(0, 6).map((i) => h('div', { class: 'sar-qrow' }, h('div', { class: 'sar-main' }, h('div', { class: 'sar-subject' }, i.subject || '(ไม่มีเรื่อง)'), h('div', { class: 'muted sar-sub' }, [i.bookNo, i.from].filter(Boolean).join(' · ')),
          h('div', { class: 'sar-badges' }, i.urgency ? badge(URGENCY[i.urgency], i.urgency === 'urgent' ? 'warn' : 'bad') : null, i.registered ? badge(`อาจลงรับแล้ว ${i.registered}`, 'warn') : null, badge(`รอ ${ageLabel(i.age)}`, i.age >= 3 ? 'bad' : 'muted'))),
          h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => go('receive', { inboxId: i.id, subject: i.subject, docNo: i.bookNo, docDate: i.bookDate, party: i.from, urgency: i.urgency || 'normal', channel: 'telegram', file: i.file || (i.urls || [])[0] || '' }) }, 'ลงรับ'))),
        d.queue.n > 6 ? h('div', { class: 'btn-row' }, h('button', { class: 'btn', type: 'button', onclick: () => go('receive') }, `ดูทั้งหมด ${d.queue.n} ฉบับ`)) : null) : null,
      h('div', { class: 'sar-kpis' }, card('ลงรับวันนี้', k.inToday, 'info', 'register'), card('ส่งออกวันนี้', k.outToday, 'info', 'register', { kind: 'out' }), card('ยังไม่เสนอ/ส่งต่อ', k.unrouted, k.unrouted ? 'warn' : 'ok', 'register', { stage: 'registered' }),
        card('เลยกำหนด', k.overdue, k.overdue ? 'bad' : 'ok', 'register', { stage: 'overdue' }), card('ด่วนที่ยังค้าง', k.urgentOpen, k.urgentOpen ? 'bad' : 'ok', 'register', { urgent: true }), card('ส่งคืน รอส่งต่อใหม่', k.returned, k.returned ? 'warn' : 'ok', 'register', { stage: 'returned' })),
      h('div', { class: 'card' }, h('h3', { class: 'sar-h3' }, 'ปริมาณหนังสือ 14 วันล่าสุด'), h('div', { class: 'sar-bars', role: 'img', 'aria-label': 'แผนภูมิแท่งจำนวนหนังสือรับและส่งรายวัน' }, d.days.map((x) => h('div', { class: 'sar-bar', title: `${thaiDate(x.day)}: รับ ${x.in} ส่ง ${x.out}` }, h('i', { class: 'in', style: `height:${Math.round((x.in / max) * 100)}%` }), h('i', { class: 'out', style: `height:${Math.round((x.out / max) * 100)}%` }), h('span', null, x.day.slice(8))))), h('p', { class: 'muted' }, h('span', { class: 'sar-dot in' }), 'รับ ', h('span', { class: 'sar-dot out' }), 'ส่ง')),
      h('div', { class: 'sar-two' }, h('div', { class: 'card' }, h('h3', { class: 'sar-h3' }, 'งานค้างแยกตามหน่วยงาน'), d.pending.length ? d.pending.map((p) => h('div', { class: 'sar-line' }, h('span', null, p.name), h('strong', null, String(p.n)))) : empty('ไม่มีงานค้าง')),
        h('div', { class: 'card' }, h('h3', { class: 'sar-h3' }, 'ช่องทางที่ได้รับ (30 วัน)'), d.channels.length ? d.channels.map((c) => h('div', { class: 'sar-line' }, h('span', null, (cfg.channels.find((x) => x[0] === c.channel) || [0, c.channel])[1]), h('strong', null, String(c.n)))) : empty('ยังไม่มีข้อมูล'))),
      h('p', { class: 'muted' }, `เลขล่าสุดปี พ.ศ. ${d.year}: รับ ${k.lastIn || '-'} · ส่ง ${k.lastOut || '-'} · ${d.org}`));
  }

  /* ----------------------------- งานของฉัน ----------------------------- */
  async function myView(el) {
    const r = await call('my');
    if (!r.items.length) { el.append(h('div', { class: 'card' }, empty(me.units.length ? 'ยังไม่มีหนังสือส่งถึงหน่วยงานของคุณ' : 'บัญชีของคุณยังไม่ได้ถูกกำหนดเป็นสมาชิกของหน่วยงานใด — ติดต่อผู้ดูแลระบบเพื่อเพิ่มอีเมลในหน้า “หน่วยงาน”'))); return; }
    el.append(h('p', { class: 'muted' }, `ค้างดำเนินการ ${r.open} เรื่อง${r.overdue ? ` · เลยกำหนด ${r.overdue} เรื่อง` : ''}`));
    r.items.forEach((i) => {
      const closed = i.status === 'done'; const late = !closed && i.due && i.due < r.today;
      el.append(h('button', { class: `sar-row tone-${late ? 'bad' : closed ? 'ok' : i.status === 'pending' ? 'warn' : 'info'}`, type: 'button', onclick: () => openDoc(i.id) },
        h('div', { class: 'sar-no' }, h('strong', null, i.reg), h('span', null, i.unitName)),
        h('div', { class: 'sar-main' }, h('div', { class: 'sar-subject' }, i.subject), h('div', { class: 'muted sar-sub' }, [i.docNo, i.party].filter(Boolean).join(' · ')),
          h('div', { class: 'sar-badges' }, i.urgency !== 'normal' ? badge(URGENCY[i.urgency], 'bad') : null, i.secrecy !== 'normal' ? badge(SECRECY[i.secrecy], 'bad') : null, badge(ACTION[i.action]), badge(TO_STATUS[i.status], closed ? 'ok' : i.status === 'pending' ? 'warn' : 'info'), i.mine ? badge('มอบหมายให้ฉัน', 'info') : null, i.due ? badge(`กำหนด ${dueLabel(i.due, r.today, closed)}`, late ? 'bad' : 'muted') : null))));
    });
  }

  /* ----------------------------- ทะเบียน ----------------------------- */
  async function registerView(el, x, p) {
    const st = { kind: p.kind || 'in', year: cfg.year, q: '', stage: p.stage || '', urgent: !!p.urgent, from: '', to: '', registry: '', offset: 0 };
    const list = h('div', { class: 'sar-list' }); const info = h('p', { class: 'muted' }); const more = h('button', { class: 'btn', type: 'button', hidden: true }, 'โหลดเพิ่ม');
    const kindBar = h('div', { class: 'sar-seg' }, [['in', 'ทะเบียนรับ'], ['out', 'ทะเบียนส่ง']].map(([k, l]) => h('button', { type: 'button', class: st.kind === k ? 'on' : '', onclick: (e) => { st.kind = k; [...kindBar.children].forEach((b) => b.classList.toggle('on', b === e.currentTarget)); stageSel.hidden = k === 'out'; load(true); } }, l)));
    const years = []; for (let y = cfg.year; y >= cfg.year - 4; y -= 1) years.push(y);
    const yearSel = h('select', { 'aria-label': 'ปี พ.ศ.' }, years.map((y) => opt(String(y), `พ.ศ. ${y}`))); yearSel.addEventListener('change', () => { st.year = Number(yearSel.value); load(true); });
    const stageSel = h('select', { 'aria-label': 'สถานะ', hidden: st.kind === 'out' }, opt('', 'ทุกสถานะ'), ...['registered', 'routed', 'inprogress', 'returned', 'done', 'void'].map((k) => opt(k, STAGE[k], k === st.stage)), opt('overdue', 'เลยกำหนด', st.stage === 'overdue')); stageSel.value = st.stage; stageSel.addEventListener('change', () => { st.stage = stageSel.value; load(true); });
    const urg = h('label', { class: 'sar-check' }, h('input', { type: 'checkbox', checked: st.urgent }), h('span', null, 'เฉพาะด่วนมาก/ด่วนที่สุด')); urg.firstChild.addEventListener('change', () => { st.urgent = urg.firstChild.checked; load(true); });
    const search = h('input', { type: 'search', placeholder: 'ค้นหาเลขรับ เลขที่หนังสือ เรื่อง หน่วยงาน…', 'aria-label': 'ค้นหา' }); search.addEventListener('input', debounce(() => { st.q = search.value.trim(); load(true); }, 350));
    const from = h('input', { type: 'date', 'aria-label': 'ตั้งแต่วันที่ลงทะเบียน' }); const to = h('input', { type: 'date', 'aria-label': 'ถึงวันที่ลงทะเบียน' }); from.addEventListener('change', () => { st.from = from.value; load(true); }); to.addEventListener('change', () => { st.to = to.value; load(true); });
    const csv = h('button', { class: 'btn', type: 'button', onclick: () => exportCsv() }, svgIcon(ICONS.download, 18), 'ส่งออก Excel (CSV)');
    el.append(h('div', { class: 'card sar-filters' }, kindBar, h('div', { class: 'sar-fgrid' }, yearSel, stageSel, from, to, urg), search, h('div', { class: 'btn-row' }, csv, h('button', { class: 'btn', type: 'button', onclick: () => printReg() }, 'พิมพ์ทะเบียน (A4)'))), info, list, h('div', { class: 'btn-row' }, more));
    async function load(reset) {
      if (reset) { st.offset = 0; list.replaceChildren(); }
      const r = await call('list', { ...st, limit: 40 });
      info.textContent = `ปี พ.ศ. ${r.year}: ${r.counts.total} ฉบับ (วันนี้ ${r.counts.today}) · เลขล่าสุด ${r.counts.lastNo || '-'} · ยกเลิก ${r.counts.void}${r.total !== r.counts.total ? ` · ตรงเงื่อนไข ${r.total}` : ''}`;
      r.items.forEach((d) => list.append(docRow(d)));
      if (!r.items.length && reset) list.append(empty('ไม่พบหนังสือตามเงื่อนไข'));
      st.offset += r.items.length; more.hidden = !r.more;
    }
    more.addEventListener('click', () => load(false).catch((e) => toast(errText(e), 'error')));
    async function printReg() {
      const r = await act(() => call('rows', st, 60000)); if (!r) return;
      printHtml(buildRegisterHtml({ org: cfg.org, kind: r.kind, year: r.year, rows: r.rows }));
      if (r.truncated) toast('พิมพ์ได้สูงสุด 5,000 รายการ — กรองช่วงวันที่แล้วพิมพ์ใหม่', 'info', 6000);
    }
    async function exportCsv() {
      const r = await act(() => call('rows', st, 60000)); if (!r) return;
      const out = r.kind === 'out';
      const head = ['เลข' + (out ? 'ส่ง' : 'รับ'), 'วันที่ลงทะเบียน', 'เลขที่หนังสือ', 'ลงวันที่', out ? 'ถึง' : 'จาก', 'เรื่อง', 'ชั้นความเร็ว', 'ชั้นความลับ', 'สถานะ', 'การปฏิบัติ', 'หมายเหตุ'];
      const rows = r.rows.map((d) => [d.reg, thaiDateTime(d.at), d.docNo, thaiDate(d.docDate), d.party, d.subject, URGENCY[d.urgency], SECRECY[d.secrecy], STAGE[d.stage], d.action, d.note]);
      const blob = new Blob([toCsv(head, rows)], { type: 'text/csv;charset=utf-8' }); const a = h('a', { href: URL.createObjectURL(blob), download: `ทะเบียน${out ? 'ส่ง' : 'รับ'}_${r.year}.csv` }); document.body.append(a); a.click(); a.remove();
      toast(`ส่งออก ${r.rows.length} รายการ${r.truncated ? ' (ตัดที่ 5,000 รายการ — กรองช่วงวันที่แล้วส่งออกใหม่)' : ''}`, 'success');
    }
    await load(true);
  }

  /* ----------------------------- ติดตาม ----------------------------- */
  function trackView(el, x, p) {
    const out = h('div', { class: 'sar-list' }); const q = h('input', { type: 'search', placeholder: 'พิมพ์เลขรับ เลขที่หนังสือ รหัสตรวจสอบ หรือชื่อเรื่อง', 'aria-label': 'ค้นหาหนังสือ', value: p.q || '' });
    const run = async () => {
      const v = q.value.trim(); out.replaceChildren(); if (!v) return;
      try {
        const r = await call('track', { q: v });
        if (!r.items.length) { out.append(empty('ไม่พบหนังสือ — ลองพิมพ์เลขรับ (เช่น 125) หรือส่วนหนึ่งของชื่อเรื่อง')); return; }
        r.items.forEach((d) => out.append(h('div', { class: 'card sar-track' }, docRow(d), progressBar(d), d.steps && d.steps.length ? h('div', { class: 'sar-steps' }, d.steps.map((s) => h('span', { class: `sar-step st-${s.status}` }, `${s.unit}: ${TO_STATUS[s.status]}`))) : null)));
      } catch (e) { out.append(notice('error', 'ค้นหาไม่สำเร็จ', errText(e))); }
    };
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); }); q.addEventListener('input', debounce(run, 500));
    el.append(h('div', { class: 'card' }, h('div', { class: 'sar-search' }, q, h('button', { class: 'btn btn-primary', type: 'button', onclick: run }, svgIcon(ICONS.search, 18), 'ติดตาม')), h('p', { class: 'hint' }, reader ? 'ค้นหาได้ทุกเรื่อง' : 'แสดงเฉพาะหนังสือที่ส่งถึงหน่วยงานของคุณ')), out);
    if (p.q) run();
  }

  /* ----------------------------- เลขทะเบียน ----------------------------- */
  async function numbersView(el) {
    const st = { year: cfg.year, registry: 'central' }; const box = h('div');
    const years = []; for (let y = cfg.year; y >= cfg.year - 4; y -= 1) years.push(y);
    const yearSel = h('select', { 'aria-label': 'ปี พ.ศ.' }, years.map((y) => opt(String(y), `พ.ศ. ${y}`))); yearSel.addEventListener('change', () => { st.year = Number(yearSel.value); load(); });
    const regs = cfg.units.filter((u) => u.registry && u.active); const regSel = regs.length ? h('select', { 'aria-label': 'ทะเบียน' }, opt('central', 'สารบรรณกลาง'), regs.map((u) => opt(u.code, u.name))) : null; if (regSel) regSel.addEventListener('change', () => { st.registry = regSel.value; load(); });
    el.append(h('div', { class: 'card btn-row' }, yearSel, regSel), box);
    async function load() {
      const r = await call('numbers', st); box.replaceChildren();
      const gapNote = (g) => (g.length ? notice('warn', `เลขที่ไม่มีในทะเบียน ${g.length}${g.length >= 50 ? '+' : ''} เลข`, `${g.slice(0, 20).join(', ')}${g.length > 20 ? ' …' : ''} — ตรวจสอบว่าเป็นการข้ามเลขโดยตั้งใจ (ระบุเลขเอง) หรือไม่ ทะเบียนที่ถูกต้องต้องไม่มีเลขขาด`) : null);
      box.append(h('div', { class: 'sar-two' }, h('div', { class: 'card' }, h('h3', { class: 'sar-h3' }, 'ทะเบียนรับ'), h('div', { class: 'sar-bignum' }, h('span', { class: 'muted' }, 'เลขล่าสุด'), h('strong', null, String(r.in.last || '-'))), h('p', { class: 'muted' }, `ใช้งาน ${r.in.count} ฉบับ · เลขต่อไป ${r.in.last + 1}`), gapNote(r.in.gaps)),
        h('div', { class: 'card' }, h('h3', { class: 'sar-h3' }, 'ทะเบียนส่ง'), h('div', { class: 'sar-bignum' }, h('span', { class: 'muted' }, 'เลขล่าสุด'), h('strong', null, String(r.out.last || '-'))), h('p', { class: 'muted' }, `ใช้งาน ${r.out.count} ฉบับ · เลขต่อไป ${r.out.last + 1}`), gapNote(r.out.gaps))),
        h('div', { class: 'card' }, h('h3', { class: 'sar-h3' }, `เลขที่จองไว้ (${r.reserved.length})`), r.reserved.length ? r.reserved.map((v) => h('div', { class: `sar-line${v.stale ? ' stale' : ''}` }, h('div', null, h('strong', null, v.reg), ` ${v.docNo} — ${v.purpose}`, h('div', { class: 'muted' }, `${v.by} · ${thaiDateTime(v.at)}${v.stale ? ` · ค้างเกิน ${r.staleDays} วัน` : ''}`)),
          h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => go('send', { reserved: v }) }, 'ออกหนังสือ'), h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => { const a = await ask('ยกเลิกเลขที่จอง', [{ name: 'reason', label: 'เหตุผล *', required: true, min: 5, type: 'textarea', rows: 2 }], 'ยกเลิกเลข', { danger: true }); if (a && await act(() => call('cancelno', { id: v.id, reason: a.reason }), 'ยกเลิกเลขแล้ว')) load(); } }, 'ยกเลิก')))) : empty('ไม่มีเลขที่จองค้างอยู่')),
        h('div', { class: 'card' }, h('h3', { class: 'sar-h3' }, `เลขที่ยกเลิกแล้ว (${r.voids.length})`), r.voids.length ? r.voids.map((v) => h('div', { class: 'sar-line' }, h('div', null, h('strong', null, `${v.kind === 'out' ? 'ส่ง' : 'รับ'} ${v.reg}`), h('div', { class: 'muted' }, `${v.why || '-'} · ${v.by}`)))) : empty('ไม่มี')));
    }
    await load();
  }

  /* ----------------------------- หน่วยงาน (admin) ----------------------------- */
  async function unitsView(el) {
    const box = h('div');
    el.append(h('div', { class: 'card' }, h('p', { class: 'muted' }, 'กำหนดหน่วยงาน หัวหน้า สมาชิก และผู้รักษาราชการแทน — สิทธิ์ดูและรับหนังสือของบุคลากรมาจากอีเมลที่ระบุที่นี่ ชนิด “ผู้บริหาร” = ผู้สั่งการ/เห็นทุกเรื่อง'), h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: () => edit(null) }, svgIcon(ICONS.plus, 18), 'เพิ่มหน่วยงาน'))), box);
    async function load() {
      const r = await call('units'); box.replaceChildren();
      const kind = { internal: 'ภายใน', exec: 'ผู้บริหาร', external: 'ภายนอก' };
      r.units.forEach((u) => box.append(h('button', { class: `sar-row${u.active ? '' : ' tone-muted'}`, type: 'button', onclick: () => edit(u) }, h('div', { class: 'sar-no' }, h('strong', null, u.code), h('span', null, kind[u.type])),
        h('div', { class: 'sar-main' }, h('div', { class: 'sar-subject' }, u.name), h('div', { class: 'muted sar-sub' }, [u.head ? `หัวหน้า ${u.head}` : 'ยังไม่ระบุหัวหน้า', `สมาชิก ${u.members.length}`, u.delegate ? `รักษาการ ${u.delegate} ถึง ${thaiDate(u.delegateUntil)}` : '', u.prefix ? `เลขหนังสือ ${u.prefix}` : ''].filter(Boolean).join(' · ')),
          h('div', { class: 'sar-badges' }, u.registry ? badge('มีทะเบียนของตนเอง', 'info') : null, u.active ? null : badge('ปิดใช้งาน', 'muted'))))));
    }
    function edit(u) {
      const v = u || { code: '', name: '', short: '', type: 'internal', head: '', members: [], delegate: '', delegateUntil: '', prefix: '', active: true, email: '', parent: '', keywords: '', registry: false };
      ask(u ? `แก้ไขหน่วยงาน ${u.code}` : 'เพิ่มหน่วยงาน', [
        { name: 'code', label: 'รหัส * (a-z 0-9 _ -)', value: v.code, required: true, max: 20, hint: u ? 'รหัสแก้ไม่ได้' : undefined }, { name: 'name', label: 'ชื่อหน่วยงาน *', value: v.name, required: true, max: 120 }, { name: 'short', label: 'ชื่อย่อ', value: v.short, max: 30 },
        { name: 'type', label: 'ชนิด', type: 'select', value: v.type, options: [['internal', 'หน่วยงานภายใน'], ['exec', 'ผู้บริหาร (สั่งการ/เห็นทุกเรื่อง)'], ['external', 'หน่วยงานภายนอก (ใช้เป็นผู้รับหนังสือส่ง)']] },
        { name: 'head', label: 'อีเมลหัวหน้า', type: 'email', value: v.head, max: 120 }, { name: 'members', label: 'อีเมลสมาชิก (คั่นด้วย , หรือขึ้นบรรทัดใหม่)', type: 'textarea', value: v.members.join(', '), rows: 3, max: 3000 },
        { name: 'delegate', label: 'ผู้รักษาราชการแทน (อีเมล)', type: 'email', value: v.delegate, max: 120 }, { name: 'delegateUntil', label: 'รักษาราชการแทนถึงวันที่', type: 'date', value: v.delegateUntil }, { name: 'prefix', label: 'คำนำหน้าเลขที่หนังสือส่ง (เช่น สธ 0123.4)', value: v.prefix, max: 60 },
        { name: 'email', label: 'อีเมลหน่วยงาน (ผู้รับภายนอก)', type: 'email', value: v.email, max: 120 }, { name: 'keywords', label: 'คำค้นสำหรับแนะนำหน่วยงาน (คั่นด้วย ,)', value: v.keywords, max: 300 },
        { name: 'registry', label: 'มีทะเบียนรับ-ส่งของตนเอง', type: 'select', value: v.registry ? '1' : '0', options: [['0', 'ไม่มี (ใช้ทะเบียนกลาง)'], ['1', 'มี']] }, { name: 'active', label: 'สถานะ', type: 'select', value: v.active ? '1' : '0', options: [['1', 'ใช้งาน'], ['0', 'ปิดใช้งาน (ไม่ลบ เพื่อคงประวัติ)']] }], 'บันทึก').then(async (a) => {
        if (!a) return; if (u) a.code = u.code;
        if (await act(() => call('unitsave', { ...a, registry: a.registry === '1', active: a.active === '1' }), 'บันทึกหน่วยงานแล้ว')) { Object.assign(cfg, await call('config')); load(); }
      });
    }
    await load();
  }

  /* ----------------------------- รายละเอียดหนังสือ ----------------------------- */
  let closeDetail = null;
  async function openDoc(id) {
    let r; try { r = await call('get', { id }); } catch (e) { toast(errText(e), 'error', 6000); return; }
    if (closeDetail) closeDetail(); const d = r.doc; const out = d.kind === 'out';
    const row = (k, v) => (v ? h('div', { class: 'sar-kv' }, h('span', null, k), h('div', null, v)) : null);
    const reload = () => { openDoc(id); };
    const btn = (label, fn, cls = 'btn') => h('button', { class: cls, type: 'button', onclick: fn }, label);
    const recv = (r.to || []).map((t) => h('div', { class: `sar-recv st-${t.status}` }, h('div', { class: 'sar-recv-h' }, h('strong', null, t.name), badge(ACTION[t.action]), badge(TO_STATUS[t.status], t.status === 'done' ? 'ok' : t.status === 'pending' ? 'warn' : t.status === 'returned' ? 'bad' : 'info'), t.due ? badge(`กำหนด ${dueLabel(t.due, cfg.today, t.status === 'done')}`, t.due < cfg.today && t.status !== 'done' ? 'bad' : 'muted') : null),
      t.people.length ? h('div', { class: 'muted' }, `ผู้รับผิดชอบ: ${t.people.join(', ')}`) : null, t.note ? h('div', { class: 'muted' }, `หมายเหตุ: ${t.note}`) : null,
      h('div', { class: 'btn-row' },
        t.can.ack ? btn('รับทราบ/รับเรื่อง', async () => { if (await act(() => call('ack', { id, unit: t.unit }), 'รับเรื่องแล้ว')) reload(); }, 'btn btn-sm btn-primary') : null,
        t.can.assign ? btn('มอบหมายผู้รับผิดชอบ', async () => {
          const picks = new Map(); const boxes = h('div', { class: 'sar-pool' }, t.pool.map((e) => { const cb = h('input', { type: 'checkbox', checked: t.people.includes(e) }); picks.set(e, cb); return h('label', { class: 'sar-check' }, cb, h('span', null, e)); }));
          let m = null; const due = h('input', { type: 'date', value: t.due || '' });
          m = modal(`มอบหมายงาน — ${t.short}`, [t.pool.length ? boxes : h('p', { class: 'muted' }, 'หน่วยงานนี้ยังไม่มีสมาชิก — ให้ผู้ดูแลระบบเพิ่มอีเมลในหน้า “หน่วยงาน”'), field('กำหนดเสร็จ', due).root], [btn('มอบหมาย', async () => { const users = [...picks.entries()].filter(([, c]) => c.checked).map(([e]) => e); if (!users.length) { toast('เลือกผู้รับผิดชอบอย่างน้อย 1 คน', 'info'); return; } if (await act(() => call('assign', { id, unit: t.unit, users, due: due.value }), 'มอบหมายแล้ว')) { m.close(); reload(); } }, 'btn btn-primary'), btn('ยกเลิก', () => m.close())]);
        }, 'btn btn-sm') : null,
        t.can.done ? btn('ดำเนินการแล้ว', async () => { const a = await ask('ปิดงาน', [{ name: 'note', label: 'สรุปผลการดำเนินการ', type: 'textarea', rows: 3 }], 'ปิดงาน'); if (a && await act(() => call('done', { id, unit: t.unit, note: a.note }), 'ปิดงานแล้ว')) reload(); }, 'btn btn-sm') : null,
        t.can.ret ? btn('ส่งคืน', async () => { const a = await ask('ส่งคืนสารบรรณ', [{ name: 'reason', label: 'เหตุผล *', type: 'textarea', rows: 2, required: true, min: 3 }], 'ส่งคืน', { danger: true }); if (a && await act(() => call('return', { id, unit: t.unit, reason: a.reason }), 'ส่งคืนแล้ว')) reload(); }, 'btn btn-sm btn-danger') : null)));
    const files = (d.files || []).map((u, i) => h('a', { class: 'sar-file', href: safeUrl(u), target: '_blank', rel: 'noopener noreferrer' }, svgIcon(ICONS.file, 16), ` ไฟล์ ${i + 1} · ${host(u)}`));
    const routeDlg = async (command) => {
      const st = {}; let m = null; const picker = unitPicker(X, st); const text = h('textarea', { rows: 2, maxlength: 400, placeholder: command ? 'ข้อสั่งการ *' : 'ข้อความถึงผู้รับ (ถ้ามี)' });
      m = modal(command ? 'สั่งการ' : 'ส่งต่อหนังสือ', [field(command ? 'ข้อสั่งการ' : 'ข้อความ', text).root, picker], [btn(command ? 'บันทึกข้อสั่งการ' : 'ส่งต่อ', async () => { const toUnits = st.pick(); if (!toUnits.length) { toast('เลือกหน่วยงานอย่างน้อย 1 หน่วย', 'info'); return; } if (command && !text.value.trim()) { text.focus(); return; } if (await act(() => call('route', { id, kind: command ? 'command' : 'forward', text: text.value, toUnits }), 'ส่งต่อแล้ว')) { m.close(); reload(); } }, 'btn btn-primary'), btn('ยกเลิก', () => m.close())], { wide: true });
    };
    const editDlg = async () => {
      const a = await ask('แก้ไขข้อมูลหนังสือ', [{ name: 'subject', label: 'เรื่อง *', value: d.subject, type: 'textarea', rows: 2, required: true }, ...(out ? [] : [{ name: 'docNo', label: 'เลขที่หนังสือ', value: d.docNo }, { name: 'party', label: 'จาก *', value: d.party, required: true }]),
        { name: 'docDate', label: 'ลงวันที่', type: 'date', value: d.docDate }, { name: 'salut', label: 'เรียน', value: d.salut }, { name: 'urgency', label: 'ชั้นความเร็ว', type: 'select', value: d.urgency, options: Object.entries(URGENCY) },
        ...(me.admin || me.clear ? [{ name: 'secrecy', label: 'ชั้นความลับ', type: 'select', value: d.secrecy, options: Object.entries(SECRECY), hint: me.admin ? '' : 'ปรับเพิ่มได้เท่านั้น — ลดชั้นความลับต้องเป็นผู้ดูแลระบบ' }] : []),
        { name: 'due', label: 'กำหนดเสร็จ', type: 'date', value: d.due }, { name: 'cat', label: 'หมวดเรื่อง', type: 'select', value: d.cat, options: [['', '— ไม่ระบุ —'], ...cfg.categories] }, { name: 'refs', label: 'อ้างถึง', value: d.refs }, { name: 'encl', label: 'สิ่งที่ส่งมาด้วย', value: d.encl },
        { name: 'action', label: 'การปฏิบัติ (คอลัมน์ในทะเบียน)', value: d.action, max: 300 }, { name: 'note', label: 'หมายเหตุ', value: d.note, max: 500 }], 'บันทึกการแก้ไข', { intro: 'ทุกการแก้ไขถูกบันทึกในประวัติของหนังสือ (ไม่เก็บค่าเดิมของเรื่องที่เป็นความลับ)' });
      if (a && await act(() => call('update', { id, ...a }), 'บันทึกแล้ว')) reload();
    };
    const attach = h('input', { type: 'file', hidden: true, accept: 'application/pdf,image/*,.docx,.xlsx,.pptx' });
    attach.addEventListener('change', async () => { const f = attach.files && attach.files[0]; attach.value = ''; if (!f) return; if (f.size > 10 * 1048576) { toast('ไฟล์ใหญ่เกิน 10 MB', 'error'); return; } if (await act(async () => call('upload', { name: f.name, data: await fileToBase64(f), kind: d.kind, docId: id, label: 'แนบเพิ่ม' }, 120000), 'แนบไฟล์แล้ว')) reload(); });
    const cancelDlg = async () => { const a = await ask(`ยกเลิกเลข ${d.reg}`, [{ name: 'reason', label: 'เหตุผล *', type: 'textarea', rows: 2, required: true, min: 5 }], 'ยกเลิกเลข', { danger: true, intro: 'เลขนี้จะยังอยู่ในทะเบียนในสถานะ “ยกเลิก” และนำกลับมาใช้ไม่ได้' }); if (a && await act(() => call('cancelno', { id, reason: a.reason }), 'ยกเลิกเลขแล้ว')) reload(); };
    const parties = (d.parties || []).map((p) => h('div', { class: 'muted' }, `${p.name} — ${(cfg.channels.find((c) => c[0] === p.channel) || [0, p.channel])[1]}${p.email ? ` · ${p.email}` : ''}${p.trackingNo ? ` · พัสดุ ${p.trackingNo}` : ''}${p.receivedBy ? ` · ผู้รับ ${p.receivedBy}` : ''}`));
    const m = modal(`${out ? 'เลขส่ง' : 'เลขรับ'} ${d.reg}`, [
      h('div', { class: 'sar-badges' }, badge(STAGE[d.stage] || d.stage, stageTone(d.stage, 0)), d.urgency !== 'normal' ? badge(URGENCY[d.urgency], 'bad') : null, d.secrecy !== 'normal' ? badge(SECRECY[d.secrecy], 'bad') : null, d.overdue ? badge(`เลยกำหนด ${d.overdue} วัน`, 'bad') : null),
      r.access === 'masked' ? notice('warn', 'หนังสือชั้นความลับ', 'คุณเห็นได้เฉพาะเลขทะเบียนและสถานะ — เนื้อหาเปิดให้ผู้ที่ได้รับอนุญาตและผู้รับที่ระบุเท่านั้น') : null,
      h('div', { class: 'sar-kvs' }, row('เรื่อง', d.subject), row('เลขที่หนังสือ', d.docNo), row('ลงวันที่', thaiDate(d.docDate)), row(out ? 'ถึง' : 'จาก', d.party), row('เรียน', d.salut), row('อ้างถึง', d.refs), row('สิ่งที่ส่งมาด้วย', d.encl),
        row('กำหนดเสร็จ', !out && r.dueDate ? dueLabel(d.due || r.dueDate, cfg.today, d.stage === 'done') + (d.due ? '' : ' (ตามชั้นความเร็ว)') : thaiDate(d.due)), row('ช่องทาง', (cfg.channels.find((c) => c[0] === d.channel) || [0, ''])[1]), row('หมวด', (cfg.categories.find((c) => c[0] === d.cat) || [0, ''])[1]),
        row('ลงทะเบียน', `${thaiDateTime(d.at)} โดย ${d.by}`), row('รหัสตรวจสอบ', r.verify), row('การปฏิบัติ', d.action), row('หมายเหตุ', d.note), row('เหตุผลยกเลิก', d.voidWhy), row('ผู้รับ', parties.length ? h('div', null, parties) : '')),
      files.length ? h('div', { class: 'sar-files' }, files) : null,
      recv.length ? h('div', null, h('h3', { class: 'sar-h3' }, 'การส่งต่อและผู้ปฏิบัติ'), recv) : null,
      h('div', null, h('h3', { class: 'sar-h3' }, 'ประวัติ'), h('ol', { class: 'sar-timeline' }, (r.events || []).map((e) => h('li', null, h('strong', null, EVENT[e.type] || e.type), ` ${e.unit ? `[${unitName(e.unit)}] ` : ''}${e.text || ''}`, h('div', { class: 'muted' }, `${thaiDateTime(e.at)} · ${e.by}`)))))],
    [r.can.route ? btn('ส่งต่อ', () => routeDlg(false), 'btn btn-primary') : null, r.can.command ? btn('สั่งการ', () => routeDlg(true), 'btn btn-primary') : null, r.can.edit ? btn('แก้ไขข้อมูล', editDlg) : null, r.can.attach ? btn('แนบไฟล์', () => attach.click()) : null, !out && d.stage !== 'void' && r.access !== 'masked' ? btn('พิมพ์ตรารับ', () => printHtml(buildReceiptHtml({ org: cfg.org, doc: d }))) : null,
      r.can.cancel ? btn('ยกเลิกเลข', cancelDlg, 'btn btn-danger') : null, btn('ปิด', () => m.close()), attach], { wide: true, onClose: () => { if (closeDetail === m.close) closeDetail = null; } });
    closeDetail = m.close;
  }
}
