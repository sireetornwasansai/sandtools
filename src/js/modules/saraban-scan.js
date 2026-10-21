// สแกนด้วยกล้อง — in-page document scanner for the receive screen. Opens the device camera (rear camera on phones), lets the clerk
// photograph one or several pages, and resolves with the photos as File objects. The photos never leave the device until the clerk confirms.
// Falls back (returns null) when the browser has no camera API or permission is refused, so the caller can use the plain file picker.
import { h } from '../core/dom.js';
import { modal } from '../core/layers.js';

export const cameraSupported = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.isSecureContext);

/** Why the camera could not start, in Thai, for a toast. */
export function cameraErrorText(e) {
  const n = e && e.name;
  if (n === 'NotAllowedError' || n === 'SecurityError') return 'เบราว์เซอร์ไม่อนุญาตให้ใช้กล้อง — กดไอคอนกุญแจ/กล้องข้างช่องที่อยู่เว็บแล้วเลือก “อนุญาต” หรือใช้ปุ่ม “เลือกไฟล์” แทน';
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'ไม่พบกล้องในอุปกรณ์นี้ — ใช้ปุ่ม “เลือกไฟล์” แทน';
  if (n === 'NotReadableError') return 'กล้องถูกใช้งานโดยโปรแกรมอื่นอยู่ — ปิดโปรแกรมนั้นแล้วลองใหม่';
  return 'เปิดกล้องไม่สำเร็จ — ใช้ปุ่ม “เลือกไฟล์” แทน';
}

async function openStream(facing) {
  const tries = [
    { video: { facingMode: { ideal: facing }, width: { ideal: 2560 }, height: { ideal: 1920 } }, audio: false },
    { video: true, audio: false }
  ];
  let last;
  for (const c of tries) { try { return await navigator.mediaDevices.getUserMedia(c); } catch (e) { last = e; if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) break; } }
  throw last;
}

/**
 * Show the scanner. Resolves with the captured pages (File[], in order) or null when cancelled.
 * Rejects only when the camera cannot be opened (use cameraErrorText).
 * @returns {Promise<File[]|null>}
 */
export async function openScanner() {
  if (!cameraSupported()) throw Object.assign(new Error('no camera api'), { name: 'NotFoundError' });
  let facing = 'environment'; let stream = await openStream(facing);
  return new Promise((resolve) => {
    const shots = []; let done = false; let m = null;
    const video = h('video', { class: 'sar-cam-video', autoplay: true, playsinline: true, muted: true, 'aria-label': 'ภาพจากกล้อง' });
    video.srcObject = stream;
    const strip = h('div', { class: 'sar-cam-strip', 'aria-live': 'polite' });
    const count = h('span', { class: 'muted' }, 'ยังไม่มีหน้า');
    const stop = () => { if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; video.srcObject = null; };
    const finish = (v) => { if (done) return; done = true; stop(); shots.forEach((s) => URL.revokeObjectURL(s.url)); resolve(v); if (m) m.close(); };
    const paint = () => {
      count.textContent = shots.length ? `ถ่ายแล้ว ${shots.length} หน้า` : 'ยังไม่มีหน้า';
      strip.replaceChildren(...shots.map((s, i) => h('figure', { class: 'sar-cam-thumb' }, h('img', { src: s.url, alt: `หน้า ${i + 1}` }), h('button', { class: 'sar-cam-x', type: 'button', 'aria-label': `ลบหน้า ${i + 1}`, onclick: () => { URL.revokeObjectURL(s.url); shots.splice(i, 1); paint(); } }, '×'))));
      ok.disabled = !shots.length;
    };
    const snap = async () => {
      if (!video.videoWidth) return;
      const c = document.createElement('canvas'); c.width = video.videoWidth; c.height = video.videoHeight;
      c.getContext('2d').drawImage(video, 0, 0);
      const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.92)); c.width = 0;
      if (!blob) return;
      const file = new File([blob], `scan-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${shots.length + 1}.jpg`, { type: 'image/jpeg' });
      shots.push({ file, url: URL.createObjectURL(file) }); paint();
    };
    const flip = async () => {
      facing = facing === 'environment' ? 'user' : 'environment';
      try { const s = await openStream(facing); stop(); stream = s; video.srcObject = s; } catch { facing = facing === 'environment' ? 'user' : 'environment'; }
    };
    const ok = h('button', { class: 'btn btn-primary', type: 'button', disabled: true, onclick: () => finish(shots.map((s) => s.file)) }, 'เสร็จ — อ่านหนังสือ');
    const shoot = h('button', { class: 'btn btn-lg sar-cam-shoot', type: 'button', onclick: snap }, 'ถ่ายหน้านี้');
    const body = [
      h('p', { class: 'muted' }, 'วางหนังสือบนพื้นเรียบแสงสว่างพอ ให้เห็นทั้งแผ่นในกรอบ ถ่ายตรง ๆ ไม่เอียง — ถ่ายได้หลายหน้า'),
      h('div', { class: 'sar-cam-stage' }, video, h('div', { class: 'sar-cam-frame', 'aria-hidden': 'true' })),
      h('div', { class: 'btn-row sar-cam-bar' }, shoot, h('button', { class: 'btn', type: 'button', onclick: flip }, 'สลับกล้อง'), count),
      strip
    ];
    m = modal('สแกนหนังสือด้วยกล้อง', body, [ok, h('button', { class: 'btn', type: 'button', onclick: () => finish(null) }, 'ยกเลิก')], { wide: true, onDismiss: () => finish(null), onClose: () => finish(null) });
    video.play().catch(() => { /* autoplay is allowed after a user gesture; ignore */ });
  });
}
