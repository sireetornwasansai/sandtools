// Loads the polyfills inside the pdf.js worker before the worker itself (imports run in order).
// `export *` is REQUIRED: when the browser cannot start a real Worker, pdf.js falls back to a "fake worker" that imports this file
// on the main thread and reads WorkerMessageHandler from it. Without the re-export that fallback fails with
// "Setting up fake worker failed: Cannot read properties of undefined (reading 'setup')".
import '../core/polyfills.js';
export * from './pdf.worker.min.mjs';
