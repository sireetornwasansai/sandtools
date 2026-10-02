import { h, svgIcon } from './dom.js';
import { ICONS } from './icons.js';

/** Mandatory healthcare data-protection notice (verbatim sentence required by the product spec). */
export const PRIVACY_SENTENCE = 'หลีกเลี่ยงการอัปโหลดข้อมูลผู้ป่วยหรือข้อมูลสุขภาพที่สามารถระบุตัวบุคคลได้ หากระบบไม่ได้รับการอนุมัติให้ใช้กับข้อมูลดังกล่าว';

/** @param {{detail?:string}} [opts] */
export function privacyNotice(opts = {}) {
  return h('div', { class: 'notice notice-warn notice-privacy', role: 'note' }, svgIcon(ICONS.alert),
    h('div', null,
      h('strong', null, 'ข้อควรระวังด้านข้อมูลส่วนบุคคล'),
      h('p', null, PRIVACY_SENTENCE),
      opts.detail ? h('p', { class: 'muted' }, opts.detail) : null));
}

/** @param {'info'|'success'|'error'|'warn'} kind */
export function notice(kind, title, body) {
  const icon = kind === 'success' ? ICONS.check : kind === 'info' ? ICONS.eye : ICONS.alert;
  return h('div', { class: `notice notice-${kind}`, role: kind === 'error' ? 'alert' : 'status' }, svgIcon(icon),
    h('div', null, title ? h('strong', null, title) : null, body ? h('p', null, body) : null));
}
