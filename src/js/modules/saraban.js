import { h, svgIcon, debounce, field } from '../core/dom.js';
import { ICONS } from '../core/icons.js';
import { getSession, signOut } from '../core/auth.js';
import { gasCall } from '../core/api.js';
import { notice } from '../core/notices.js';
import { toast } from '../core/toast.js';
import { modal, confirmBox } from '../core/layers.js';
import { loadCss } from '../core/css.js';
import { URGENCY, SECRECY, STAGE, TO_STATUS, ACTION, EVENT, MONTHS, MONTH_FULL, WEEKDAY_SHORT, thaiDate, thaiDateTime, thaiDateLong, ageLabel, stageIndex, STAGE_STEPS, buildRegisterHtml, buildReceiptHtml, dueLabel, stageTone, stageLabel, changeLabel, pct, toCsv, fileToBase64 } from './saraban-engine.js';
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

/** Placeholder shapes shown while a sub-menu loads (CSS shimmer; static when the user prefers reduced motion). */
const sk = (cls) => h('i', { class: `sar-sk ${cls || ''}`, 'aria-hidden': 'true' });
/** Placeholder rows (same shape as a register row) shown while a list is being fetched. */
function rowSkeletons(n) { return Array.from({ length: n }, () => h('div', { class: 'sar-row sar-skel-card', 'aria-hidden': 'true' }, h('div', { class: 'sar-no' }, sk('num s'), sk('line xs')), h('div', { class: 'sar-main' }, sk('line l'), sk('line m')))); }
function skeleton(tab) {
  const kind = { home: 'dash', my: 'list', register: 'list', track: 'list' }[tab] || 'form';
  const wrap = h('div', { class: 'sar-skel', role: 'status', 'aria-label': 'กำลังโหลด' }, h('span', { class: 'sar-sr' }, 'กำลังโหลด…'));
  if (kind === 'dash') {
    wrap.append(h('div', { class: 'sar-skel-groups' }, sk('pill'), sk('pill'), sk('pill')), h('div', { class: 'sar-kpis' }, ...[1, 2, 3, 4, 5, 6].map(() => h('div', { class: 'sar-kpi sar-skel-card' }, sk('num'), sk('line s')))), h('div', { class: 'card' }, sk('line m'), sk('chart')));
  } else if (kind === 'list') {
    wrap.append(h('div', { class: 'card' }, sk('input'), sk('input')), ...rowSkeletons(5));
  } else {
    wrap.append(h('div', { class: 'card' }, sk('line m'), ...[1, 2, 3].map(() => h('div', { class: 'sar-skel-field' }, sk('line xs'), sk('input'))), sk('btn')));
  }
  return wrap;
}

export async function mount(root) {
  await loadCss('saraban');
  const s = getSession();
  const body = h('div');
  root.append(h('div', { class: 'page sar' }, h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'สารบรรณ'), h('p', null, 'ลงรับ ส่งออก ทะเบียน เลขทะเบียน ส่งต่อ/สั่งการ และติดตามหนังสือราชการ ในที่เดียว'))), body));
  if (!s) { body.append(notice('warn', 'ต้องเข้าสู่ระบบก่อน', 'ใช้อีเมลหน่วยงานเพื่อเข้าใช้งานสารบรรณ')); return; }

  async function raw(op, params, timeout) {
    try { return (await gasCall('saraban', { session: s.token, op, ...params }, timeout)).data; } catch (e) {
      if (e && (e.code === 'INVALID_SESSION' || e.code === 'DOMAIN_NOT_ALLOWED')) signOut();
      throw e;
    }
  }
  /* Screens people flip between (dashboard, my work, lists …) are remembered for 25 s, so a tab switch is instant and the slow Apps Script is hit less.
     Any write (everything not listed here) drops all of it, and clicking the open tab again always reloads. Backend keeps its own 30 s cache too. */
  const READ_OPS = new Set(['config', 'dash', 'my', 'units', 'numbers', 'nextno', 'queue', 'list']); const PASS_OPS = new Set(['get', 'track', 'dup', 'rows', 'parties', 'impscan']);
  const memo = new Map(); const MEMO_MS = 25000;
  const seed = (op, params, data) => memo.set(`${op}:${JSON.stringify(params)}`, { t: Date.now(), p: Promise.resolve(data) });
  function call(op, params = {}, timeout = 30000) {
    if (PASS_OPS.has(op)) return raw(op, params, timeout);
    if (!READ_OPS.has(op)) { memo.clear(); return raw(op, params, timeout); }
    const key = `${op}:${JSON.stringify(params)}`; const hit = memo.get(key);
    if (hit && Date.now() - hit.t < MEMO_MS) return hit.p;
    const p = raw(op, params, timeout); const ent = { t: Date.now(), p }; memo.set(key, ent);
    p.catch(() => { if (memo.get(key) === ent) memo.delete(key); });
    return p;
  }
  /* First screen in ONE round trip (config + dashboard + queue) — it used to be three sequential calls. */
  const first = h('div', { class: 'sar-boot' }, skeleton('home')); body.append(first);
  let cfg; let boot = null;
  try { boot = await call('boot'); cfg = boot.config; } catch (e) {
    let err = e;
    if (e && e.code === 'UNKNOWN_ACTION') { try { cfg = await call('config'); } catch (e2) { err = e2; } }   // an older backend without "boot"
    if (!cfg) { first.remove(); body.append(notice('error', 'เปิดสารบรรณไม่ได้', errText(err) + ' — ถ้าเพิ่งติดตั้ง ให้ผู้ดูแลระบบรัน setupSaraban() และ Deploy เวอร์ชันใหม่ของ Apps Script')); return; }
  }
  first.remove();
  if (boot) { seed('config', {}, cfg); if (boot.dash) seed('dash', {}, boot.dash); if (boot.queue) seed('queue', {}, boot.queue); }
  const me = cfg.me; const unitName = (c) => { const u = cfg.units.find((x) => x.code === c); return u ? u.short || u.name : c; };
  const staff = me.staff; const reader = me.staff || me.exec;
  const TABS = [['home', 'ศูนย์สารบรรณ', reader], ['my', 'งานของฉัน', true], ['receive', 'รับหนังสือ', staff], ['send', 'ส่งออก', staff], ['register', 'ทะเบียน', reader], ['track', 'ติดตาม', true], ['numbers', 'เลขทะเบียน', staff], ['units', 'หน่วยงาน', me.admin], ['import', 'นำเข้าทะเบียนเดิม', me.admin]].filter((t) => t[2]);
  const bar = h('div', { class: 'sar-tabs', role: 'tablist', 'aria-label': 'เมนูสารบรรณ' }); const view = h('div', { class: 'sar-view' }); const loadbar = h('div', { class: 'sar-loadbar', hidden: true, 'aria-hidden': 'true' }, h('i'));
  let current = ''; let ver = 0;
  /* The clerk's own work group (งานยุทธศาสตร์ฯ / งานพัฒนาคุณภาพฯ …): last one chosen, else the registry of a unit they belong to. */
  const regCodes = cfg.units.filter((u) => u.registry && u.active).map((u) => u.code);
  const myReg = regCodes.find((c) => me.units.indexOf(c) >= 0 || (me.headOf || []).indexOf(c) >= 0) || '';
  const GKEY = 'sand.sar.group';
  const rememberRegistry = (code) => { try { localStorage.setItem(GKEY, code); } catch { /* private mode */ } };
  const defaultRegistry = () => { let v = ''; try { v = localStorage.getItem(GKEY) || ''; } catch { v = ''; } return v === 'central' || regCodes.indexOf(v) >= 0 ? v : myReg || 'central'; };
  const X = { call, cfg, openDoc, go, refresh: (t) => go(t || current), me, unitName, defaultRegistry, rememberRegistry };
  function go(tab, params = {}) {
    if (!TABS.some((t) => t[0] === tab)) tab = TABS[0][0];
    if (tab === current && !Object.keys(params).length) memo.clear();   // the open tab clicked again = reload with fresh data
    current = tab; ver += 1; const my = ver;
    [...bar.children].forEach((b) => { const on = b.dataset.tab === tab; b.setAttribute('aria-selected', String(on)); b.classList.toggle('on', on); b.classList.toggle('loading', on); });
    loadbar.hidden = false; view.replaceChildren(skeleton(tab)); view.setAttribute('aria-busy', 'true');
    const pane = h('div', { class: 'sar-pane' });
    (async () => { await VIEWS[tab](pane, X, params); })()
      .then(() => { if (my === ver) view.replaceChildren(pane); })
      .catch((e) => { if (my === ver) view.replaceChildren(notice('error', 'โหลดข้อมูลไม่สำเร็จ', errText(e))); })
      .finally(() => { if (my === ver) { view.removeAttribute('aria-busy'); loadbar.hidden = true; [...bar.children].forEach((b) => b.classList.remove('loading')); } });
  }
  /* Start fetching the two most-used screens while the pointer is still on the tab — by the click the answer is usually there. */
  const PREFETCH = { home: () => call('dash'), my: () => call('my') };
  TABS.forEach(([k, l]) => { const warm = () => { if (k !== current && PREFETCH[k]) PREFETCH[k]().catch(() => {}); }; bar.append(h('button', { class: 'sar-tab', type: 'button', role: 'tab', dataset: { tab: k }, onclick: () => go(k), onpointerenter: warm, onfocus: warm }, l)); });
  body.append(bar, loadbar, view);
  const VIEWS = { home: homeView, my: myView, receive: receiveTab, send: (el, x, p) => sendView(el, x, p), register: registerView, track: trackView, numbers: numbersView, units: unitsView, import: importView };
  const want = new URLSearchParams((location.hash.split('?')[1]) || '').get('tab');
  go(TABS.some((t) => t[0] === want) ? want : reader ? 'home' : 'my');

  /* ----------------------------- small building blocks ----------------------------- */
  function docRow(d, extra) {
    const out = d.kind === 'out';
    return h('button', { class: `sar-row tone-${stageTone(d.stage, d.overdue)}`, type: 'button', onclick: (e) => openDoc(d.id, e.currentTarget) },
      h('div', { class: 'sar-no' }, h('strong', null, d.reg), h('span', null, out ? 'เลขส่ง' : 'เลขรับ')),
      h('div', { class: 'sar-main' }, h('div', { class: 'sar-subject' }, d.subject || '(ไม่มีเรื่อง)'), h('div', { class: 'muted sar-sub' }, [d.docNo, d.party, d.at ? thaiDate(String(d.at).slice(0, 10)) : ''].filter(Boolean).join(' · ')),
        h('div', { class: 'sar-badges' }, regCodes.length && d.registry ? badge(d.registry === 'central' ? 'สารบรรณกลาง' : unitName(d.registry), 'info') : null, d.urgency !== 'normal' ? badge(URGENCY[d.urgency], d.urgency === 'urgent' ? 'warn' : 'bad') : null, d.secrecy !== 'normal' ? badge(SECRECY[d.secrecy], 'bad') : null, stageLabel(d.stage) ? badge(stageLabel(d.stage), stageTone(d.stage, 0)) : null, d.overdue ? badge(`เลยกำหนด ${d.overdue} วัน`, 'bad') : null, ...(extra || []))));
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
    const at = d.kind === 'out' || d.stage === 'registered' ? -1 : stageIndex(d.stage); if (at < 0) return null;   // no bar for a letter nobody routed here: its real status is unknown
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
  let actN = 0;
  /** Run an action with the top progress bar visible; shows a success / error toast. */
  async function act(fn, okMsg) {
    actN += 1; loadbar.hidden = false;
    try { const r = await fn(); if (okMsg) toast(okMsg, 'success'); return r || true; } catch (e) { toast(errText(e), 'error', 6000); return false; } finally { actN -= 1; if (!actN && !view.hasAttribute('aria-busy')) loadbar.hidden = true; }
  }
  /** Full-screen "loading" veil + a spinner on the clicked row, shown while a detail page is fetched. Returns a function that removes both. */
  function busyShow(label, src) {
    if (src && src.classList) { src.classList.add('is-loading'); src.setAttribute('aria-busy', 'true'); }
    const veil = h('div', { class: 'sar-busy', role: 'status', 'aria-live': 'polite' }, h('div', { class: 'sar-busy-box' }, h('i', { class: 'sar-spin', 'aria-hidden': 'true' }), h('span', null, label))); document.body.append(veil);
    return () => { veil.remove(); if (src && src.classList) { src.classList.remove('is-loading'); src.removeAttribute('aria-busy'); } };
  }

  /* ----------------------------- ลงรับ: คิว Telegram + แบบฟอร์ม ----------------------------- */
  async function receiveTab(el, x, p) {
    const qbox = h('div'); el.append(qbox);
    if (!p.inboxId && cfg.queue) (async () => {
      qbox.append(h('div', { class: 'card sar-skel-card' }, sk('line m'), sk('line l')));
      let q = { items: [] }; try { q = await call('queue'); } catch (e) { qbox.replaceChildren(notice('warn', 'อ่านคิว Telegram ไม่ได้', errText(e))); return; }
      qbox.replaceChildren();
      if (q.items.length) {
        const box = h('div', { class: 'card sar-queue' }, h('h3', { class: 'sar-h3' }, `รอลงรับจากกลุ่ม Telegram (${q.items.length})`), h('p', { class: 'muted' }, 'ตรวจข้อมูลที่ระบบดึงมา แล้วกด “ลงรับ” เพื่อออกเลขรับในทะเบียนเดียวกัน — ฉบับที่ไม่ใช่หนังสือถึงหน่วยงานกด “ไม่นำเข้า”'));
        q.items.forEach((i) => box.append(h('div', { class: 'sar-qrow' }, h('div', { class: 'sar-main' }, h('div', { class: 'sar-subject' }, i.subject || '(ไม่มีเรื่อง)'), h('div', { class: 'muted sar-sub' }, [i.bookNo, i.from, i.bookDate ? `ลงวันที่ ${thaiDate(i.bookDate)}` : '', i.received ? thaiDateTime(i.received) : ''].filter(Boolean).join(' · ')),
          h('div', { class: 'sar-badges' }, i.urgency ? badge(URGENCY[i.urgency], i.urgency === 'urgent' ? 'warn' : 'bad') : i.urgentHint ? badge('มีคำว่าด่วน', 'bad') : null, i.registered ? badge(`อาจลงรับแล้ว เลขรับ ${i.registered}`, 'warn') : null, i.age != null ? badge(`รอ ${ageLabel(i.age)}`, i.age >= 3 ? 'bad' : 'muted') : null, ...(i.suggest || []).slice(0, 2).map((g) => badge(`น่าจะเกี่ยวกับ ${g.name}`, 'info')), ...(i.urls || []).slice(0, 2).map((u) => h('a', { class: 'sar-badge sar-muted', href: safeUrl(u), target: '_blank', rel: 'noopener noreferrer' }, `เปิดลิงก์ · ${host(u)}`)))),
        h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => go('receive', { inboxId: i.id, subject: i.subject, docNo: i.bookNo, docDate: i.bookDate, party: i.from, urgency: i.urgency || 'normal', channel: 'telegram', file: i.file || (i.urls || [])[0] || '' }) }, 'ลงรับ'),
          h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => { const a = await ask('ไม่นำเข้าหนังสือนี้', [{ name: 'reason', label: 'เหตุผล *', type: 'textarea', rows: 2, required: true, min: 5, placeholder: 'เช่น ไม่เกี่ยวข้องกับโรงพยาบาล / ซ้ำกับฉบับที่ลงรับแล้ว' }], 'ไม่นำเข้า', { danger: true }); if (a && await act(() => call('reject', { id: i.id, reason: a.reason }), 'ย้ายไป “ไม่นำเข้า” แล้ว')) go('receive'); } }, 'ไม่นำเข้า')))));
        qbox.append(box);
      }
    })();
    const host2 = h('div'); el.append(host2); receiveView(host2, x, p);
  }

  /* ----------------------------- ศูนย์สารบรรณ: ทะเบียนรับ-ส่ง + วิเคราะห์ข้อมูล ----------------------------- */
  const miniRows = (n) => Array.from({ length: n }, () => h('div', { class: 'sar-mini sar-skel-card', 'aria-hidden': 'true' }, sk('num s'), h('div', { class: 'sar-mini-main' }, sk('line l'), sk('line m'))));
  const retryBox = (title, e, again) => h('div', null, notice('error', title, errText(e)), h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-sm', type: 'button', onclick: again }, 'ลองอีกครั้ง')));
  /** Horizontal bars: [{name, n}] → label · bar · number. */
  function hbars(items, { total, tone = 'in', emptyText = 'ยังไม่มีข้อมูล' } = {}) {
    if (!items || !items.length) return empty(emptyText);
    const max = Math.max(1, ...items.map((i) => i.n)); const sum = total || items.reduce((a, i) => a + i.n, 0);
    return h('div', { class: 'sar-hbars' }, items.map((i) => h('div', { class: 'sar-hbar', title: `${i.name}: ${i.n} ฉบับ (${pct(i.n, sum)}%)` }, h('span', { class: 'sar-hbar-l' }, i.name), h('span', { class: 'sar-hbar-t' }, h('i', { class: tone, style: `width:${Math.max(3, Math.round((i.n / max) * 100))}%` })), h('strong', null, String(i.n)))));
  }
  const tile = (label, value, sub, tone) => h('div', { class: `sar-tile${tone ? ` tone-${tone}` : ''}` }, h('span', null, label), h('strong', null, String(value)), sub ? h('em', null, sub) : null);

  /** One compact register (รับ or ส่ง) for the centre page: newest first, quick search, every change shows a loading state. */
  function regCard(H, kind, reg) {
    const out = kind === 'out'; let seq = 0; let q = '';
    const list = h('div', { class: 'sar-mini-list', 'aria-live': 'polite' }); const meta = h('p', { class: 'muted sar-sub' }); const bar = h('div', { class: 'sar-loadbar', hidden: true, 'aria-hidden': 'true' }, h('i'));
    const search = h('input', { type: 'search', placeholder: out ? 'ค้นหาทะเบียนส่ง เลขส่ง เรื่อง ผู้รับ…' : 'ค้นหาทะเบียนรับ เลขรับ เรื่อง ผู้ส่ง…', 'aria-label': out ? 'ค้นหาทะเบียนส่ง' : 'ค้นหาทะเบียนรับ' });
    const card = h('div', { class: `card sar-reg-card ${out ? 'is-out' : 'is-in'}` }, h('div', { class: 'sar-qhead' }, h('h3', { class: 'sar-h3' }, out ? 'ทะเบียนส่ง' : 'ทะเบียนรับ'), h('button', { class: 'btn btn-sm', type: 'button', onclick: () => go('register', { kind, registry: reg }) }, 'ดูทะเบียนทั้งหมด')), search, bar, meta, list);
    const item = (d) => h('button', { class: `sar-mini tone-${stageTone(d.stage, d.overdue)}`, type: 'button', onclick: (e) => openDoc(d.id, e.currentTarget) },
      h('strong', { class: 'sar-mini-no' }, d.reg), h('div', { class: 'sar-mini-main' }, h('div', { class: 'sar-mini-subject' }, d.subject || '(ไม่มีเรื่อง)'), h('div', { class: 'muted sar-sub' }, [d.docNo, d.party, d.at ? thaiDate(String(d.at).slice(0, 10)) : ''].filter(Boolean).join(' · ')),
        (d.urgency !== 'normal' || d.secrecy !== 'normal' || stageLabel(d.stage) || d.overdue) ? h('div', { class: 'sar-badges' }, d.urgency !== 'normal' ? badge(URGENCY[d.urgency], d.urgency === 'urgent' ? 'warn' : 'bad') : null, d.secrecy !== 'normal' ? badge(SECRECY[d.secrecy], 'bad') : null, stageLabel(d.stage) ? badge(stageLabel(d.stage), stageTone(d.stage, 0)) : null, d.overdue ? badge(`เลยกำหนด ${d.overdue} วัน`, 'bad') : null) : null));
    async function load() {
      const my = ++seq; bar.hidden = false; card.setAttribute('aria-busy', 'true'); meta.textContent = 'กำลังโหลด…'; list.replaceChildren(...miniRows(5));
      try {
        const r = await call('list', { kind, year: H.year, registry: reg, q, limit: 8 }); if (my !== seq) return;
        meta.textContent = `พ.ศ. ${r.year}: ${r.counts.total} ฉบับ · เลข${out ? 'ส่ง' : 'รับ'}ล่าสุด ${r.counts.lastNo || '-'}${q ? ` · ตรงเงื่อนไข ${r.total}` : ''}`;
        list.replaceChildren(...(r.items.length ? r.items.map(item) : [empty(q ? 'ไม่พบรายการตามคำค้น' : 'ยังไม่มีรายการในปีนี้')]));
        if (r.more) list.append(h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-sm', type: 'button', onclick: () => go('register', { kind, registry: reg }) }, `ดูอีก ${r.total - r.items.length} รายการ`)));
      } catch (e) { if (my !== seq) return; meta.textContent = ''; list.replaceChildren(retryBox('โหลดทะเบียนไม่สำเร็จ', e, () => load())); } finally { if (my === seq) { bar.hidden = true; card.removeAttribute('aria-busy'); } }
    }
    search.addEventListener('input', debounce(() => { q = search.value.trim(); load(); }, 350));
    load(); return card;
  }

  /** The analytics block: everything comes from ONE backend call (`analytics`) that reads the register once. */
  function analyticsBlock(H, reg) {
    const box = h('div', { class: 'sar-an', 'aria-live': 'polite' }); let seq = 0;
    const skel = () => h('div', { class: 'sar-skel', role: 'status', 'aria-label': 'กำลังวิเคราะห์ข้อมูล' }, h('span', { class: 'sar-sr' }, 'กำลังวิเคราะห์ข้อมูล…'), h('div', { class: 'sar-tiles' }, ...[1, 2, 3, 4].map(() => h('div', { class: 'sar-tile sar-skel-card' }, sk('line xs'), sk('num')))), h('div', { class: 'card' }, sk('line m'), sk('chart')));
    function paint(a) {
      const hasData = a.total.in + a.total.out + a.total.void > 0;
      const head = h('div', { class: 'sar-qhead' }, h('h3', { class: 'sar-h3' }, `วิเคราะห์ข้อมูลทะเบียน พ.ศ. ${a.year} · ${a.registryName}`));
      if (!hasData) { box.replaceChildren(head, h('div', { class: 'card' }, empty('ยังไม่มีข้อมูลทะเบียนในปีนี้ — เมื่อมีการลงรับ/ส่งออก ระบบจะวิเคราะห์ให้อัตโนมัติ'))); return; }
      const mmax = Math.max(1, ...a.months.map((m) => Math.max(m.in, m.out)));
      const ratio = a.total.in ? (a.total.out / a.total.in).toFixed(2).replace(/\.?0+$/, '') : '-';
      const tiles = h('div', { class: 'sar-tiles' }, tile('หนังสือรับ', a.total.in, changeLabel(a.total.in, a.total.prevIn), 'in'), tile('หนังสือส่ง', a.total.out, changeLabel(a.total.out, a.total.prevOut), 'out'),
        tile('สัดส่วนส่ง : รับ', ratio, a.total.in ? `ส่ง ${ratio} ฉบับ ต่อรับ 1 ฉบับ` : ''), tile('รับล่าช้าเฉลี่ย', a.lag.n ? `${a.lag.avg} วัน` : '-', a.lag.n ? `จากวันที่ลงหนังสือถึงวันลงรับ (${a.lag.n} ฉบับ, นานสุด ${a.lag.max} วัน)` : 'ไม่มีวันที่ลงหนังสือให้คำนวณ'),
        a.busiestMonth ? tile('เดือนที่คึกคักที่สุด', MONTH_FULL[a.busiestMonth.m - 1], `${a.busiestMonth.n} ฉบับ (รับ+ส่ง)`) : null, a.busiestWeekday ? tile('วันที่ลงทะเบียนมากสุด', `วัน${['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'][a.busiestWeekday.d]}`, `${a.busiestWeekday.n} ฉบับ`) : null, a.total.void ? tile('เลขที่ยกเลิก', a.total.void, 'ยังคงอยู่ในทะเบียน', 'warn') : null);
      const months = h('div', { class: 'card' }, h('h3', { class: 'sar-h3' }, 'ปริมาณหนังสือรายเดือน'), h('div', { class: 'sar-mbars', role: 'img', 'aria-label': 'แผนภูมิแท่งหนังสือรับและส่งรายเดือน' }, a.months.map((m) => h('div', { class: 'sar-mbar', title: `${MONTH_FULL[m.m - 1]}: รับ ${m.in} · ส่ง ${m.out}` }, h('div', { class: 'sar-mbar-cols' }, h('i', { class: 'in', style: `height:${Math.round((m.in / mmax) * 100)}%` }, m.in ? h('b', null, String(m.in)) : null), h('i', { class: 'out', style: `height:${Math.round((m.out / mmax) * 100)}%` }, m.out ? h('b', null, String(m.out)) : null)), h('span', null, MONTHS[m.m - 1])))), h('p', { class: 'muted' }, h('span', { class: 'sar-dot in' }), 'รับ ', h('span', { class: 'sar-dot out' }), 'ส่ง'));
      const wmax = Math.max(1, ...a.weekday);
      const urg = Object.entries(a.urgency).filter(([, n]) => n).map(([k, n]) => ({ name: URGENCY[k], n }));
      const typeSum = a.bookType.circular + a.bookType.normal;
      const cards = h('div', { class: 'sar-two' },
        h('div', { class: 'card' }, h('h3', { class: 'sar-h3' }, 'หนังสือรับ: หน่วยงานต้นทาง'), hbars(a.issuers, { emptyText: 'ยังไม่มีเลขที่หนังสือให้วิเคราะห์' }), h('p', { class: 'hint' }, 'นับจากรหัสหน้าเลขที่หนังสือ เช่น สธ · ชม · อว'), a.senders.length ? h('div', null, h('h4', { class: 'sar-h4' }, 'ผู้ส่งที่ระบุชื่อ'), hbars(a.senders)) : null),
        h('div', { class: 'card' }, h('h3', { class: 'sar-h3' }, 'หนังสือส่ง: ส่งถึง'), hbars(a.recipients, { tone: 'out', emptyText: 'ยังไม่ได้ระบุผู้รับในทะเบียนส่ง' }), a.unspecifiedOut ? h('p', { class: 'hint' }, `ไม่ได้ระบุผู้รับ ${a.unspecifiedOut} ฉบับ`) : null),
        h('div', { class: 'card' }, h('h3', { class: 'sar-h3' }, 'เรื่องที่รับเข้า (ประมาณจากคำในหัวเรื่อง)'), hbars(a.cats.in, { emptyText: 'ยังไม่มีข้อมูล' }), h('p', { class: 'hint' }, 'ใช้หมวดที่เจ้าหน้าที่เลือกไว้ ถ้าไม่ได้เลือกจะเดาจากคำในเรื่อง')),
        h('div', { class: 'card' }, h('h3', { class: 'sar-h3' }, 'ประเภทและความเร่งด่วนของหนังสือรับ'), typeSum ? h('div', null, h('div', { class: 'sar-split', role: 'img', 'aria-label': `หนังสือเวียน ${a.bookType.circular} ฉบับ ปกติ ${a.bookType.normal} ฉบับ` }, a.bookType.circular ? h('i', { class: 'a', style: `width:${pct(a.bookType.circular, typeSum)}%` }) : null, a.bookType.normal ? h('i', { class: 'b', style: `width:${pct(a.bookType.normal, typeSum)}%` }) : null), h('p', { class: 'muted sar-sub' }, h('span', { class: 'sar-dot a' }), `หนังสือเวียน (ว) ${a.bookType.circular} (${pct(a.bookType.circular, typeSum)}%) `, h('span', { class: 'sar-dot b' }), `หนังสือทั่วไป ${a.bookType.normal}`)) : null, hbars(urg, { tone: 'warn', emptyText: 'ยังไม่มีข้อมูล' })),
        h('div', { class: 'card' }, h('h3', { class: 'sar-h3' }, 'วันที่ลงทะเบียน (ตามวันในสัปดาห์)'), h('div', { class: 'sar-wbars', role: 'img', 'aria-label': 'จำนวนหนังสือตามวันในสัปดาห์' }, a.weekday.map((n, i) => h('div', { class: 'sar-wbar', title: `${WEEKDAY_SHORT[i]} ${n} ฉบับ` }, h('i', { style: `height:${Math.round((n / wmax) * 100)}%` }), h('b', null, n ? String(n) : ''), h('span', null, WEEKDAY_SHORT[i]))))),
        h('div', { class: 'card' }, h('h3', { class: 'sar-h3' }, 'ส่งต่อไปยังหน่วยงาน'), a.units.length ? hbars(a.units, { tone: 'info' }) : empty('ยังไม่มีการส่งต่อในระบบนี้'), a.forwarded ? h('p', { class: 'hint' }, `ส่งต่อแล้ว ${a.forwarded} จาก ${a.total.in} ฉบับ`) : h('p', { class: 'hint' }, 'ทะเบียนเดิมไม่มีข้อมูลการส่งต่อ — ข้อมูลจะเริ่มสะสมเมื่อใช้ขั้นตอน “รับหนังสือ → ส่งต่อ”')));
      const q = a.quality; const qrows = [['วันที่ลงหนังสือ', q.pct.docDate], ['ผู้ส่ง (จาก)', q.pct.party], ['ช่องทางที่ได้รับ', q.pct.channel], ['ไฟล์ต้นฉบับ', q.pct.file], ['หมวดเรื่อง', q.pct.cat]];
      const quality = h('div', { class: 'card' }, h('h3', { class: 'sar-h3' }, 'ความครบถ้วนของข้อมูลหนังสือรับ'), h('div', { class: 'sar-hbars' }, qrows.map(([l, v]) => h('div', { class: 'sar-hbar', title: `${l}: ${v}%` }, h('span', { class: 'sar-hbar-l' }, l), h('span', { class: 'sar-hbar-t' }, h('i', { class: v >= 80 ? 'ok' : v >= 40 ? 'warn' : 'bad', style: `width:${Math.max(3, v)}%` })), h('strong', null, `${v}%`)))), h('p', { class: 'hint' }, 'ยิ่งครบ การวิเคราะห์ยิ่งแม่นยำ — เติมข้อมูลได้ที่ “รายละเอียดหนังสือ → แก้ไขข้อมูล” หรือแนบไฟล์ต้นฉบับ'));
      const gap = (k, l) => h('div', { class: 'sar-line' }, h('span', null, l), h('strong', { class: a.seq[k].gaps ? 'sar-bad-t' : '' }, `ล่าสุด ${a.seq[k].last || '-'} · ใช้ ${a.seq[k].used}${a.seq[k].gaps ? ` · เลขขาด ${a.seq[k].gaps}` : ' · ต่อเนื่อง'}`));
      const seqCard = h('div', { class: 'card' }, h('h3', { class: 'sar-h3' }, 'ความต่อเนื่องของเลขทะเบียน'), gap('in', 'ทะเบียนรับ'), gap('out', 'ทะเบียนส่ง'), (a.seq.in.gaps || a.seq.out.gaps) && staff ? h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-sm', type: 'button', onclick: () => go('numbers', { registry: reg }) }, 'ดูเลขที่ขาด')) : null);
      box.replaceChildren(head, a.imported ? notice('info', `ข้อมูล ${a.imported} ฉบับนำเข้าจากทะเบียนเดิม`, 'ทะเบียนนี้เป็นข้อมูลสำรองจากสมุดทะเบียนของธุรการ — ระบบไม่ทราบสถานะการดำเนินงานจริง จึงไม่แสดงสถานะ/เลยกำหนด และวิเคราะห์เฉพาะข้อมูลที่มีอยู่') : null, a.masked ? h('p', { class: 'muted' }, `มีหนังสือชั้นความลับ ${a.masked} ฉบับที่นับรวมในตัวเลขแต่ไม่แสดงเนื้อหา`) : null, tiles, months, cards, h('div', { class: 'sar-two' }, quality, seqCard));
    }
    async function load() {
      const my = ++seq; box.replaceChildren(skel());
      try { const a = await call('analytics', { year: H.year, registry: reg }, 45000); if (my === seq) paint(a); } catch (e) { if (my === seq) box.replaceChildren(retryBox('วิเคราะห์ข้อมูลไม่สำเร็จ', e, load)); }
    }
    load(); return box;
  }

  async function homeView(el) {
    const d = await call('dash');
    let q = null; if (staff && cfg.queue && d.queue && d.queue.enabled && d.queue.n) { try { q = await call('queue'); } catch { q = null; } }
    const queueCard = q && q.items.length ? h('div', { class: 'card sar-queue' }, h('div', { class: 'sar-qhead' }, h('h3', { class: 'sar-h3' }, `คิวรอลงรับ (${d.queue.n})`), d.queue.urgent ? badge(`${d.queue.urgent} ฉบับมีคำว่า “ด่วน”`, 'bad') : null),
        ...q.items.slice(0, 6).map((i) => h('div', { class: 'sar-qrow' }, h('div', { class: 'sar-main' }, h('div', { class: 'sar-subject' }, i.subject || '(ไม่มีเรื่อง)'), h('div', { class: 'muted sar-sub' }, [i.bookNo, i.from].filter(Boolean).join(' · ')),
          h('div', { class: 'sar-badges' }, i.urgency ? badge(URGENCY[i.urgency], i.urgency === 'urgent' ? 'warn' : 'bad') : null, i.registered ? badge(`อาจลงรับแล้ว ${i.registered}`, 'warn') : null, badge(`รอ ${ageLabel(i.age)}`, i.age >= 3 ? 'bad' : 'muted'))),
          h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => go('receive', { inboxId: i.id, subject: i.subject, docNo: i.bookNo, docDate: i.bookDate, party: i.from, urgency: i.urgency || 'normal', channel: 'telegram', file: i.file || (i.urls || [])[0] || '' }) }, 'รับหนังสือ'))),
        d.queue.n > 6 ? h('div', { class: 'btn-row' }, h('button', { class: 'btn', type: 'button', onclick: () => go('receive') }, `ดูทั้งหมด ${d.queue.n} ฉบับ`)) : null) : null;
    /* One tab per registry (งานยุทธศาสตร์ฯ · งานพัฒนาคุณภาพฯ · สารบรรณกลาง) + an overall tab. The registers and the analytics below follow the chosen group and year. */
    const groups = d.groups || [];
    const all = { code: 'all', name: 'ภาพรวมทั้งหมด', short: 'ภาพรวมทั้งหมด', kpi: d.kpi, days: d.days, channels: d.channels, pending: d.pending };
    const tabs = groups.length > 1 ? [...groups, all] : [];
    let pref = ''; try { pref = localStorage.getItem('sand.sar.home') || ''; } catch { pref = ''; }
    let sel = tabs.length ? (tabs.some((t) => t.code === pref) ? pref : me.exec ? 'all' : (groups.find((g) => g.code === myReg) || groups[0]).code) : 'all';
    const H = { year: cfg.year };
    const pane = h('div', { class: 'sar-gpane' }); const gbar = tabs.length ? h('div', { class: 'sar-groups', role: 'tablist', 'aria-label': 'กลุ่มงาน' }) : null;
    const years = []; for (let y = cfg.year; y >= cfg.year - 4; y -= 1) years.push(y);
    const yearSel = h('select', { 'aria-label': 'ปี พ.ศ. ที่ต้องการดู' }, years.map((y) => opt(String(y), `พ.ศ. ${y}`))); yearSel.addEventListener('change', () => { H.year = Number(yearSel.value); draw(sel); });
    function draw(code) {
      const g = code === 'all' || !groups.length ? (groups.length === 1 ? groups[0] : all) : groups.find((x) => x.code === code) || all; const k = g.kpi; const reg = g.code === 'all' ? '' : g.code;
      const card = (label, value, tone, tab, params) => h('button', { class: `sar-kpi tone-${tone}`, type: 'button', onclick: () => go(tab, { registry: reg, ...params }) }, h('strong', null, String(value)), h('span', null, label));
      /* No "รอเสนอ" / "ยังไม่ส่งต่อ" count any more: the register is a backup of the clerks' books, so nobody can know the real status of an old letter.
         Alerts appear only for letters that were really forwarded in this system. */
      const kpis = [card('ลงรับวันนี้', k.inToday, 'info', 'register'), card('ส่งออกวันนี้', k.outToday, 'info', 'register', { kind: 'out' }), card('รับเดือนนี้', k.inMonth || 0, 'info', 'register'), card('ส่งเดือนนี้', k.outMonth || 0, 'info', 'register', { kind: 'out' })];
      if (k.routedOpen) kpis.push(card('ส่งต่อแล้ว กำลังดำเนินการ', k.routedOpen, 'info', 'register', { stage: 'open' }));
      if (k.returned) kpis.push(card('ส่งคืน รอส่งต่อใหม่', k.returned, 'warn', 'register', { stage: 'returned' }));
      if (k.overdue) kpis.push(card('เลยกำหนด (ที่ส่งต่อแล้ว)', k.overdue, 'bad', 'register', { stage: 'overdue' }));
      if (k.urgentOpen) kpis.push(card('ด่วนที่ยังค้าง (ที่ส่งต่อแล้ว)', k.urgentOpen, 'bad', 'register', { urgent: true }));
      const max = Math.max(1, ...g.days.map((x) => Math.max(x.in, x.out)));
      const recent = h('div', { class: 'sar-two' }, h('div', { class: 'card' }, h('h3', { class: 'sar-h3' }, 'ปริมาณหนังสือ 14 วันล่าสุด'), h('div', { class: 'sar-bars', role: 'img', 'aria-label': 'แผนภูมิแท่งจำนวนหนังสือรับและส่งรายวัน' }, g.days.map((x) => h('div', { class: 'sar-bar', title: `${thaiDate(x.day)}: รับ ${x.in} ส่ง ${x.out}` }, h('i', { class: 'in', style: `height:${Math.round((x.in / max) * 100)}%` }), h('i', { class: 'out', style: `height:${Math.round((x.out / max) * 100)}%` }), h('span', null, x.day.slice(8))))), h('p', { class: 'muted' }, h('span', { class: 'sar-dot in' }), 'รับ ', h('span', { class: 'sar-dot out' }), 'ส่ง')),
        h('div', { class: 'card' }, h('h3', { class: 'sar-h3' }, 'งานที่ส่งต่อและยังไม่เสร็จ แยกตามหน่วยงาน'), g.pending.length ? g.pending.map((p) => h('div', { class: 'sar-line' }, h('span', null, p.name), h('strong', null, String(p.n)))) : empty('ไม่มีงานค้างที่ส่งต่อในระบบ'), g.channels.length ? h('div', null, h('h4', { class: 'sar-h4' }, 'ช่องทางที่ได้รับ (30 วัน)'), g.channels.map((c) => h('div', { class: 'sar-line' }, h('span', null, (cfg.channels.find((x) => x[0] === c.channel) || [0, c.channel])[1]), h('strong', null, String(c.n))))) : null));
      pane.replaceChildren(
        h('div', { class: 'sar-ghead' }, h('div', null, h('h2', { class: 'sar-gtitle' }, g.name), h('p', { class: 'muted' }, `ปี พ.ศ. ${d.year}: รับ ${k.inYear} · ส่ง ${k.outYear} · เลขรับล่าสุด ${k.lastIn || '-'} · เลขส่งล่าสุด ${k.lastOut || '-'}`)),
          staff && reg ? h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => go('receive', { registry: reg }) }, 'รับหนังสือ'), h('button', { class: 'btn btn-sm', type: 'button', onclick: () => go('send', { registry: reg }) }, 'ส่งออก')) : null),
        h('div', { class: 'sar-kpis' }, kpis), regBlock(reg), analyticsBlock(H, reg), recent);
    }
    const regBlock = (reg) => h('div', { class: 'sar-two sar-regs' }, regCard(H, 'in', reg), regCard(H, 'out', reg));
    if (gbar) {
      const mine = (t) => t.code === myReg;
      [...tabs].sort((a, b2) => (mine(b2) - mine(a)) || 0).forEach((t) => gbar.append(h('button', { class: `sar-gtab${t.code === sel ? ' on' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(t.code === sel), dataset: { g: t.code },
        onclick: () => { sel = t.code; [...gbar.children].forEach((b) => { const on = b.dataset.g === sel; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); }); try { localStorage.setItem('sand.sar.home', sel); } catch { /* private mode */ } if (sel !== 'all') rememberRegistry(sel); draw(sel); } },
        t.short || t.name, t.kpi.overdue ? h('em', { class: 'sar-gcount', title: `เลยกำหนด ${t.kpi.overdue} ฉบับ (ที่ส่งต่อแล้ว)` }, String(t.kpi.overdue)) : null)));
    }
    draw(sel);
    el.append(h('div', { class: 'sar-center-top' }, h('p', { class: 'muted' }, `${thaiDateLong(d.today)} · ${d.org}`), h('label', { class: 'sar-yearpick' }, h('span', null, 'ดูข้อมูลปี'), yearSel)), queueCard, gbar, pane);
  }

  /* ----------------------------- งานของฉัน ----------------------------- */
  async function myView(el) {
    const r = await call('my');
    if (!r.items.length) { el.append(h('div', { class: 'card' }, empty(me.units.length ? 'ยังไม่มีหนังสือส่งถึงหน่วยงานของคุณ' : 'บัญชีของคุณยังไม่ได้ถูกกำหนดเป็นสมาชิกของหน่วยงานใด — ติดต่อผู้ดูแลระบบเพื่อเพิ่มอีเมลในหน้า “หน่วยงาน”'))); return; }
    el.append(h('p', { class: 'muted' }, `ค้างดำเนินการ ${r.open} เรื่อง${r.overdue ? ` · เลยกำหนด ${r.overdue} เรื่อง` : ''}`));
    r.items.forEach((i) => {
      const closed = i.status === 'done'; const late = !closed && i.due && i.due < r.today;
      el.append(h('button', { class: `sar-row tone-${late ? 'bad' : closed ? 'ok' : i.status === 'pending' ? 'warn' : 'info'}`, type: 'button', onclick: (e) => openDoc(i.id, e.currentTarget) },
        h('div', { class: 'sar-no' }, h('strong', null, i.reg), h('span', null, i.unitName)),
        h('div', { class: 'sar-main' }, h('div', { class: 'sar-subject' }, i.subject), h('div', { class: 'muted sar-sub' }, [i.docNo, i.party].filter(Boolean).join(' · ')),
          h('div', { class: 'sar-badges' }, i.urgency !== 'normal' ? badge(URGENCY[i.urgency], 'bad') : null, i.secrecy !== 'normal' ? badge(SECRECY[i.secrecy], 'bad') : null, badge(ACTION[i.action]), badge(TO_STATUS[i.status], closed ? 'ok' : i.status === 'pending' ? 'warn' : 'info'), i.mine ? badge('มอบหมายให้ฉัน', 'info') : null, i.due ? badge(`กำหนด ${dueLabel(i.due, r.today, closed)}`, late ? 'bad' : 'muted') : null))));
    });
  }

  /* ----------------------------- ทะเบียน ----------------------------- */
  async function registerView(el, x, p) {
    const st = { kind: p.kind || 'in', year: cfg.year, q: '', stage: p.stage && p.stage !== 'registered' ? p.stage : '', urgent: !!p.urgent, from: '', to: '', registry: p.registry || '', offset: 0 };
    const list = h('div', { class: 'sar-list', 'aria-live': 'polite' }); const info = h('p', { class: 'muted' }); const more = h('button', { class: 'btn', type: 'button', hidden: true }, 'โหลดเพิ่ม');
    const bar = h('div', { class: 'sar-loadbar', hidden: true, 'aria-hidden': 'true' }, h('i'));
    const kindBar = h('div', { class: 'sar-seg' }, [['in', 'ทะเบียนรับ'], ['out', 'ทะเบียนส่ง']].map(([k, l]) => h('button', { type: 'button', class: st.kind === k ? 'on' : '', onclick: (e) => { st.kind = k; [...kindBar.children].forEach((b) => b.classList.toggle('on', b === e.currentTarget)); stageSel.hidden = k === 'out'; load(true); } }, l)));
    const years = []; for (let y = cfg.year; y >= cfg.year - 4; y -= 1) years.push(y);
    const yearSel = h('select', { 'aria-label': 'ปี พ.ศ.' }, years.map((y) => opt(String(y), `พ.ศ. ${y}`))); yearSel.addEventListener('change', () => { st.year = Number(yearSel.value); load(true); });
    /* No "ลงรับแล้ว รอเสนอ" filter: the register is a backup, so an unrouted letter has no known status. */
    const stageSel = h('select', { 'aria-label': 'สถานะการส่งต่อ', hidden: st.kind === 'out' }, opt('', 'ทุกรายการ'), ...['open', 'routed', 'inprogress', 'returned', 'done', 'void'].map((k) => opt(k, k === 'open' ? 'ส่งต่อแล้ว ยังไม่เสร็จ' : STAGE[k])), opt('overdue', 'เลยกำหนด (ที่ส่งต่อแล้ว)')); stageSel.value = st.stage; stageSel.addEventListener('change', () => { st.stage = stageSel.value; load(true); });
    const urg = h('label', { class: 'sar-check' }, h('input', { type: 'checkbox', checked: st.urgent }), h('span', null, 'เฉพาะด่วนมาก/ด่วนที่สุด')); urg.firstChild.addEventListener('change', () => { st.urgent = urg.firstChild.checked; load(true); });
    const search = h('input', { type: 'search', placeholder: 'ค้นหาเลขรับ เลขที่หนังสือ เรื่อง หน่วยงาน…', 'aria-label': 'ค้นหา' }); search.addEventListener('input', debounce(() => { st.q = search.value.trim(); load(true); }, 350));
    const from = h('input', { type: 'date', 'aria-label': 'ตั้งแต่วันที่ลงทะเบียน' }); const to = h('input', { type: 'date', 'aria-label': 'ถึงวันที่ลงทะเบียน' }); from.addEventListener('change', () => { st.from = from.value; load(true); }); to.addEventListener('change', () => { st.to = to.value; load(true); });
    const regSel = regCodes.length ? h('select', { 'aria-label': 'กลุ่มงาน/ทะเบียน' }, opt('', 'ทุกกลุ่มงาน'), opt('central', 'สารบรรณกลาง'), cfg.units.filter((u) => u.registry && u.active).map((u) => opt(u.code, u.name))) : null;
    if (regSel) { regSel.value = st.registry; regSel.addEventListener('change', () => { st.registry = regSel.value; load(true); }); }
    const csv = h('button', { class: 'btn', type: 'button', onclick: () => exportCsv() }, svgIcon(ICONS.download, 18), 'ส่งออก Excel (CSV)');
    const filters = h('div', { class: 'card sar-filters' }, kindBar, h('div', { class: 'sar-fgrid' }, regSel, yearSel, stageSel, from, to, urg), search, bar, h('div', { class: 'btn-row' }, csv, h('button', { class: 'btn', type: 'button', onclick: () => printReg() }, 'พิมพ์ทะเบียน (A4)')));
    el.append(filters, info, list, h('div', { class: 'btn-row' }, more));
    let seq = 0;
    /** Every filter change shows the loading state (top bar + placeholder rows); a slower, older answer can never overwrite a newer one. */
    async function load(reset) {
      const my = ++seq; bar.hidden = false; filters.setAttribute('aria-busy', 'true'); list.setAttribute('aria-busy', 'true');
      if (reset) { st.offset = 0; more.hidden = true; info.textContent = 'กำลังโหลดทะเบียน…'; list.replaceChildren(...rowSkeletons(5)); } else { more.classList.add('is-loading'); more.disabled = true; }
      try {
        const r = await call('list', { ...st, limit: 40 }); if (my !== seq) return;
        if (reset) list.replaceChildren();
        info.textContent = `ปี พ.ศ. ${r.year}: ${r.counts.total} ฉบับ (วันนี้ ${r.counts.today}) · เลขล่าสุด ${r.counts.lastNo || '-'} · ยกเลิก ${r.counts.void}${r.total !== r.counts.total ? ` · ตรงเงื่อนไข ${r.total}` : ''}`;
        r.items.forEach((d) => list.append(docRow(d)));
        if (!r.items.length && reset) list.append(empty('ไม่พบหนังสือตามเงื่อนไข'));
        st.offset += r.items.length; more.hidden = !r.more;
      } catch (e) {
        if (my !== seq) return; if (reset) { list.replaceChildren(); info.textContent = ''; }
        list.append(notice('error', 'โหลดทะเบียนไม่สำเร็จ', errText(e)), h('div', { class: 'btn-row' }, h('button', { class: 'btn', type: 'button', onclick: () => load(reset) }, 'ลองอีกครั้ง')));
      } finally { if (my === seq) { bar.hidden = true; filters.removeAttribute('aria-busy'); list.removeAttribute('aria-busy'); more.classList.remove('is-loading'); more.disabled = false; } }
    }
    more.addEventListener('click', () => load(false));
    async function printReg() {
      const r = await act(() => call('rows', st, 60000)); if (!r) return;
      printHtml(buildRegisterHtml({ org: cfg.org, kind: r.kind, year: r.year, rows: r.rows }));
      if (r.truncated) toast('พิมพ์ได้สูงสุด 5,000 รายการ — กรองช่วงวันที่แล้วพิมพ์ใหม่', 'info', 6000);
    }
    async function exportCsv() {
      const r = await act(() => call('rows', st, 60000)); if (!r) return;
      const out = r.kind === 'out';
      const head = ['เลข' + (out ? 'ส่ง' : 'รับ'), 'วันที่ลงทะเบียน', 'เลขที่หนังสือ', 'ลงวันที่', out ? 'ถึง' : 'จาก', 'เรื่อง', 'ชั้นความเร็ว', 'ชั้นความลับ', 'สถานะการส่งต่อ', 'การปฏิบัติ', 'หมายเหตุ'];
      const rows = r.rows.map((d) => [d.reg, thaiDateTime(d.at), d.docNo, thaiDate(d.docDate), d.party, d.subject, URGENCY[d.urgency], SECRECY[d.secrecy], stageLabel(d.stage), d.action, d.note]);
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
    const st = { year: cfg.year, registry: defaultRegistry() }; const box = h('div');
    const years = []; for (let y = cfg.year; y >= cfg.year - 4; y -= 1) years.push(y);
    const yearSel = h('select', { 'aria-label': 'ปี พ.ศ.' }, years.map((y) => opt(String(y), `พ.ศ. ${y}`))); yearSel.addEventListener('change', () => { st.year = Number(yearSel.value); load(); });
    const regs = cfg.units.filter((u) => u.registry && u.active); const regSel = regs.length ? h('select', { 'aria-label': 'ทะเบียน' }, opt('central', 'สารบรรณกลาง'), regs.map((u) => opt(u.code, u.name))) : null; if (regSel) { regSel.value = st.registry; regSel.addEventListener('change', () => { st.registry = regSel.value; rememberRegistry(st.registry); load(); }); }
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

  /* ----------------------------- นำเข้าทะเบียนเดิม (Google Sheet ของธุรการ → ทะเบียนสารบรรณ) ----------------------------- */
  async function importView(el) {
    const st = { sheet: '', scan: null, rows: [] };
    const out = h('div'); const tabsBox = h('div'); const actions = h('div', { class: 'btn-row' });
    const input = h('input', { type: 'url', class: 'sar-imp-url', placeholder: 'วางลิงก์ Google Sheet ทะเบียนหนังสือของธุรการ (https://docs.google.com/spreadsheets/d/…)', 'aria-label': 'ลิงก์ Google Sheet', autocomplete: 'off', maxlength: '400' });
    const scanBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: scan }, 'ตรวจไฟล์');
    const syncBtn = h('button', { class: 'btn', type: 'button', onclick: sync }, 'ซิงก์แถวใหม่จากไฟล์เดิม');
    el.append(h('div', { class: 'card' },
      h('p', { class: 'muted' }, 'นำทะเบียนรับ-ส่งเดิมของธุรการ (Google Sheet) เข้าสู่ทะเบียนสารบรรณ — ระบบหาคอลัมน์จาก “ชื่อหัวตาราง” ไฟล์เดิมไม่ถูกแก้ไข นำเข้าซ้ำได้อย่างปลอดภัย (เพิ่มเฉพาะแถวใหม่) และเลขใหม่จะต่อจากเลขล่าสุดที่นำเข้า'),
      h('p', { class: 'hint' }, 'ต้องแชร์ไฟล์ให้บัญชีที่ Deploy Apps Script (สิทธิ์ “ผู้ดู” ก็พอ) · ก่อนนำเข้า ควรสร้างหน่วยงานที่ “มีทะเบียนของตนเอง” (เช่น งานยุทธศาสตร์ฯ งานพัฒนาคุณภาพฯ) ที่แท็บ “หน่วยงาน” ก่อน'),
      h('div', { class: 'sar-imp-row' }, input, scanBtn, syncBtn)), tabsBox, actions, out);
    syncBtn.hidden = true;
    const regs = () => cfg.units.filter((u) => u.registry && u.active);
    const guessRegistry = (t, saved) => {
      if (saved && saved.registry) return saved.registry;
      if (t.suggest) { const u = regs().find((x) => String(x.name).includes(t.suggest)); if (u) return u.code; }
      return 'central';
    };
    async function scan() {
      const v = input.value.trim(); if (!v) { toast('วางลิงก์ Google Sheet ก่อน', 'error'); return; }
      out.replaceChildren(); tabsBox.replaceChildren(); actions.replaceChildren();
      let r; try { r = await call('impscan', { sheet: v }, 60000); } catch (e) { out.append(notice('error', 'ตรวจไฟล์ไม่สำเร็จ', errText(e))); return; }
      st.sheet = v; st.scan = r; const saved = (r.saved && r.saved.tabs) || [];
      st.rows = r.tabs.map((t) => { const sv = saved.find((x) => String(x.gid) === String(t.gid)); return { t, include: !!t.kind && t.rows > 0 && t.problems.length === 0, registry: guessRegistry(t, sv), numbering: sv ? sv.numbering : (t.noIsNumber || t.kind === 'out' ? 'keep' : 'new') }; });
      syncBtn.hidden = !saved.length;
      draw();
    }
    function draw() {
      const r = st.scan; tabsBox.replaceChildren(); actions.replaceChildren();
      tabsBox.append(h('div', { class: 'card' }, h('h3', { class: 'sar-h3' }, `ไฟล์: ${r.name}`), h('p', { class: 'muted' }, `พบ ${r.tabs.length} แท็บ — เลือกแท็บที่จะนำเข้า ทะเบียนปลายทาง และวิธีออกเลข`)));
      st.rows.forEach((x) => {
        const t = x.t; const kindTxt = t.kind === 'in' ? 'ทะเบียนรับ' : t.kind === 'out' ? 'ทะเบียนส่ง' : 'ไม่ทราบชนิด';
        const chk = h('input', { type: 'checkbox', checked: x.include, 'aria-label': `นำเข้าแท็บ ${t.name}` }); chk.addEventListener('change', () => { x.include = chk.checked; });
        const reg = h('select', { 'aria-label': 'ทะเบียนปลายทาง' }, opt('central', 'สารบรรณกลาง', x.registry === 'central'), regs().map((u) => opt(u.code, u.name, x.registry === u.code))); reg.addEventListener('change', () => { x.registry = reg.value; });
        const num = h('select', { 'aria-label': 'วิธีออกเลข' }, opt('keep', 'ใช้เลขเดิมในไฟล์ (ซ้ำ/ว่าง → ออกเลขใหม่)', x.numbering === 'keep'), opt('new', 'ออกเลขใหม่เรียงตามวันที่', x.numbering === 'new')); num.addEventListener('change', () => { x.numbering = num.value; });
        const m = t.mapped || {};
        tabsBox.append(h('div', { class: `card sar-imp-tab${t.problems.length ? ' has-problem' : ''}` },
          h('label', { class: 'sar-imp-head' }, chk, h('strong', null, t.name), badge(kindTxt, t.kind === 'in' ? 'info' : t.kind === 'out' ? 'ok' : 'bad'), h('span', { class: 'muted' }, `${t.rows} แถว${t.skipped ? ` · ข้าม ${t.skipped}` : ''}${t.from ? ` · ${thaiDate(t.from)} – ${thaiDate(t.to || t.from)}` : ''}`)),
          t.problems.length ? notice('warn', 'อ่านโครงสร้างตารางไม่ครบ', t.problems.join(' · ')) : null,
          h('p', { class: 'hint' }, `คอลัมน์ที่จับคู่: เรื่อง ← ${m.subject || '-'} · เลข ← ${m.number || '-'} · เลขที่หนังสือ ← ${m.docNo || '-'} · ${t.kind === 'out' ? 'ผู้รับ' : 'ผู้ส่ง'} ← ${m.party || '-'} · วันที่ ← ${m.date || '-'}`),
          (t.sample || []).length ? h('div', { class: 'sar-imp-sample' }, t.sample.map((e) => h('div', { class: 'muted' }, `แถว ${e.row}: ${[e.no, e.docNo, e.date, e.subject, e.party].filter(Boolean).join(' · ')}`))) : null,
          h('div', { class: 'sar-imp-opts' }, h('label', null, h('span', null, 'ทะเบียนปลายทาง'), reg), h('label', null, h('span', null, 'วิธีออกเลข'), num))));
      });
      actions.append(h('button', { class: 'btn', type: 'button', onclick: () => run(true) }, 'ทดลองนำเข้า (ไม่บันทึก)'), h('button', { class: 'btn btn-primary', type: 'button', onclick: () => run(false) }, 'นำเข้าจริง'));
    }
    const planOf = () => ({ tabs: st.rows.filter((x) => x.include).map((x) => ({ gid: x.t.gid, registry: x.registry, numbering: x.numbering, include: true })) });
    async function run(dry) {
      const plan = planOf(); if (!plan.tabs.length) { toast('ยังไม่ได้เลือกแท็บที่จะนำเข้า', 'error'); return; }
      if (!dry && !(await confirmBox({ title: 'นำเข้าทะเบียนเดิม', message: `นำเข้า ${plan.tabs.length} แท็บ เข้าทะเบียนสารบรรณ — ทำซ้ำได้ ระบบจะเพิ่มเฉพาะแถวใหม่ (ควรกด “ทดลองนำเข้า” ตรวจผลก่อน)`, confirm: 'นำเข้าจริง' }))) return;
      out.replaceChildren(h('p', { class: 'muted' }, dry ? 'กำลังทดลองนำเข้า…' : 'กำลังนำเข้า… (อาจใช้เวลาสักครู่)'));
      let r; try { r = await call('import', { sheet: st.sheet, plan, dry }, 180000); } catch (e) { out.replaceChildren(notice('error', 'นำเข้าไม่สำเร็จ', errText(e))); return; }
      report(r);
      if (!dry) { toast(`นำเข้าแล้ว ${r.imported} แถว`, 'success'); syncBtn.hidden = false; try { Object.assign(cfg, await call('config')); } catch { /* the register is already written */ } }
    }
    async function sync() {
      if (!(await confirmBox({ title: 'ซิงก์แถวใหม่', message: 'ดึงเฉพาะแถวใหม่จากไฟล์เดิมที่เคยนำเข้า เข้าทะเบียนสารบรรณ', confirm: 'ซิงก์' }))) return;
      out.replaceChildren(h('p', { class: 'muted' }, 'กำลังซิงก์…'));
      try { const r = await call('impsync', {}, 180000); report(r); toast(`ซิงก์แล้ว ${r.imported} แถวใหม่`, 'success'); } catch (e) { out.replaceChildren(notice('error', 'ซิงก์ไม่สำเร็จ', errText(e))); }
    }
    function report(r) {
      out.replaceChildren(notice(r.dry ? 'info' : 'success', r.dry ? `ทดลอง: จะนำเข้า ${r.imported} แถว (ยังไม่บันทึก)` : `นำเข้าแล้ว ${r.imported} แถว`, 'รายละเอียดแต่ละแท็บ'),
        ...r.tabs.map((t) => h('div', { class: 'card' }, h('strong', null, t.tab),
          t.error ? notice('error', 'ข้ามแท็บนี้', t.error) : h('p', { class: 'muted' }, `พบ ${t.found} · นำเข้า ${t.imported} · มีอยู่แล้ว ${t.already}${t.renumbered ? ` · ออกเลขใหม่ ${t.renumbered}` : ''}${(t.skipped || []).length ? ` · ข้าม ${t.skipped.length}` : ''}`),
          (t.warnings || []).length ? h('ul', { class: 'sar-imp-warn' }, t.warnings.map((w) => h('li', null, `แถว ${w.row}: ${w.text}`))) : null)));
    }
  }

  /* ----------------------------- รายละเอียดหนังสือ ----------------------------- */
  let closeDetail = null;
  async function openDoc(id, src) {
    const stop = busyShow('กำลังเปิดรายละเอียดหนังสือ…', src);
    let r; try { r = await call('get', { id }); } catch (e) { stop(); toast(errText(e), 'error', 6000); return; }
    stop();
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
      h('div', { class: 'sar-badges' }, stageLabel(d.stage) ? badge(stageLabel(d.stage), stageTone(d.stage, 0)) : null, d.urgency !== 'normal' ? badge(URGENCY[d.urgency], 'bad') : null, d.secrecy !== 'normal' ? badge(SECRECY[d.secrecy], 'bad') : null, d.overdue ? badge(`เลยกำหนด ${d.overdue} วัน`, 'bad') : null),
      d.legacy ? notice('info', 'ข้อมูลจากทะเบียนเดิม', 'นำเข้าจากสมุดทะเบียนของธุรการ (ข้อมูลสำรอง) — ไม่ทราบสถานะการดำเนินงานจริง ระบบจึงไม่แสดงสถานะ ถ้าต้องการให้หน่วยงานดำเนินการ กด “ส่งต่อ”') : null,
      r.access === 'masked' ? notice('warn', 'หนังสือชั้นความลับ', 'คุณเห็นได้เฉพาะเลขทะเบียนและสถานะ — เนื้อหาเปิดให้ผู้ที่ได้รับอนุญาตและผู้รับที่ระบุเท่านั้น') : null,
      h('div', { class: 'sar-kvs' }, row('เรื่อง', d.subject), row('เลขที่หนังสือ', d.docNo), row('ลงวันที่', thaiDate(d.docDate)), row(out ? 'ถึง' : 'จาก', d.party), row('เรียน', d.salut), row('อ้างถึง', d.refs), row('สิ่งที่ส่งมาด้วย', d.encl),
        row('กำหนดเสร็จ', !out && r.dueDate ? dueLabel(d.due || r.dueDate, cfg.today, d.stage === 'done') + (d.due ? '' : ' (ตามชั้นความเร็ว)') : thaiDate(d.due)), row('ช่องทาง', (cfg.channels.find((c) => c[0] === d.channel) || [0, ''])[1]), row('หมวด', (cfg.categories.find((c) => c[0] === d.cat) || [0, ''])[1]),
        row('ลงทะเบียน', `${thaiDateTime(d.at)} โดย ${d.by}`), row('รหัสตรวจสอบ', r.verify), row('การปฏิบัติ', d.action), row('หมายเหตุ', d.note), row('เหตุผลยกเลิก', d.voidWhy), row('ผู้รับ', parties.length ? h('div', null, parties) : '')),
      files.length ? h('div', { class: 'sar-files' }, files) : null,
      recv.length ? h('div', null, h('h3', { class: 'sar-h3' }, 'การส่งต่อและผู้ปฏิบัติ'), recv) : null,
      h('div', null, h('h3', { class: 'sar-h3' }, 'ประวัติ'), h('ol', { class: 'sar-timeline' }, (r.events || []).map((e) => h('li', null, h('strong', null, EVENT[e.type] || e.type), ` ${e.unit ? `[${unitName(e.unit)}] ` : ''}${e.text || ''}`, h('div', { class: 'muted' }, `${thaiDateTime(e.at)} · ${e.by}`)))))],
    [r.can.route ? btn('ส่งต่อหนังสือ', () => routeDlg(false), 'btn btn-primary') : null, r.can.command ? btn('สั่งการ', () => routeDlg(true), 'btn btn-primary') : null, r.can.edit ? btn('แก้ไขข้อมูล', editDlg) : null, r.can.attach ? btn('แนบไฟล์', () => attach.click()) : null, !out && d.stage !== 'void' && r.access !== 'masked' ? btn('พิมพ์ตรารับ', () => printHtml(buildReceiptHtml({ org: cfg.org, doc: d }))) : null,
      r.can.cancel ? btn('ยกเลิกเลข', cancelDlg, 'btn btn-danger') : null, btn('ปิด', () => m.close()), attach], { wide: true, onClose: () => { if (closeDetail === m.close) closeDetail = null; } });
    closeDetail = m.close;
  }
}
