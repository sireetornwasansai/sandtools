// Passes a file dropped anywhere in the app to the module that should handle it.
/** @type {File|null} */
let pending = null;
export function setPendingFile(f) { pending = f; }
export function takePendingFile() { const f = pending; pending = null; return f; }

const CONVERT_EXT = ['pdf', 'docx', 'pptx', 'xlsx', 'xls', 'csv', 'html', 'htm', 'txt'];
/** @param {string} name @returns {string|null} route path for a dropped file */
export function routeForFile(name) {
  const ext = name.toLowerCase().split('.').pop() || '';
  if (CONVERT_EXT.includes(ext)) return '/converter';
  return null;
}
