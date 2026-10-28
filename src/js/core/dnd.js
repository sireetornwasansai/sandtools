// Drag & drop routing helper for the app shell (main.js).
// A page with its own drop zone (สารบรรณ รับหนังสือ, PDF, converter …) calls preventDefault() on the drop, which means "this page took the file".
// Only a drop nobody took is handed to the tool that fits the file type — otherwise a letter dropped on สารบรรณ also jumped to the converter.

/** @param {{defaultPrevented?:boolean, dataTransfer?:{types?:ArrayLike<string>, files?:ArrayLike<File>}|null}} e @returns {File|null} the file to route, or null when the drop is not ours to route */
export function routableDrop(e) {
  const dt = e && e.dataTransfer;
  if (!dt || !Array.from(dt.types || []).includes('Files')) return null;
  if (e.defaultPrevented) return null;
  return (dt.files && dt.files[0]) || null;
}
