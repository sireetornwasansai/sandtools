// Loads the polyfills inside the pdf.js worker before the worker itself (imports run in order).
import '../core/polyfills.js';
import './pdf.worker.min.mjs';
