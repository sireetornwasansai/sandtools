import { config } from './config.js';
import { getSession } from './auth.js';
import { gasCall, backendConfigured } from './api.js';

export const MAX_ARCHIVE_BYTES = 10 * 1024 * 1024;
/** Logging/archiving happens only when the backend is set up and the user is signed in (the backend rejects anonymous writes). */
export const recording = () => backendConfigured() && config.archiveFiles !== false && !!getSession();
export const recordingNote = () => 'หน่วยงานบันทึกประวัติการใช้งาน (ชื่อผู้ใช้ เครื่องมือ ชื่อไฟล์ เวลา) และเก็บสำเนาไฟล์ไม่เกิน 10 MB ไว้ในคลังของหน่วยงาน (Google Drive/Sheet) เพื่อการตรวจสอบ';

function toBase64(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = rej; r.readAsDataURL(blob); });
}

/**
 * Write one usage log row, then archive input/output files (best effort: never blocks or breaks the tool).
 * @param {string} tool @param {string} op
 * @param {{fileName?:string,sizeIn?:number,sizeOut?:number,status?:string,extra?:object,inputs?:File[],outputs?:Blob[],outputName?:string}} d
 * @returns {Promise<boolean>} true when the log row was written
 */
export async function record(tool, op, d = {}) {
  if (!recording()) return false;
  const token = getSession().token;
  let logId = '';
  try {
    logId = (await gasCall('log', { session: token, tool, op, meta: { fileName: d.fileName, sizeIn: d.sizeIn, sizeOut: d.sizeOut, status: d.status, extra: d.extra } })).data.logId;
  } catch { return false; }
  /** @type {Array<{role:string,blob:Blob,name:string}>} */
  const files = [];
  for (const f of d.inputs || []) files.push({ role: 'input', blob: f, name: f.name });
  (d.outputs || []).forEach((b, i) => files.push({ role: 'output', blob: b, name: (b instanceof File && b.name) || d.outputName || `output-${i + 1}` }));
  for (const { role, blob, name } of files) {
    if (!blob || blob.size > MAX_ARCHIVE_BYTES) continue;
    try { await gasCall('archive', { session: token, tool, logId, role, name, mime: blob.type || 'application/octet-stream', data: await toBase64(blob) }, 120000); } catch { /* ignore */ }
  }
  return true;
}
