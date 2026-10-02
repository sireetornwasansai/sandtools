// Ambient types for browser globals injected at runtime (config.js, Google scripts).
interface Window {
  SAND_CONFIG?: Record<string, unknown>;
  google?: any;
  gapi?: any;
}
