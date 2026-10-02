// Builds the public runtime config (config.js) from environment variables.
// Only NON-SECRET values belong here: everything in config.js is visible to every visitor.

const bool = (v) => ['1', 'true', 'yes', 'on'].includes(String(v || '').toLowerCase());
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };

/** @param {Record<string,string|undefined>} env @param {string} version */
export function buildConfig(env, version) {
  return {
    gasUrl: (env.SAND_GAS_URL || '').trim(),
    googleClientId: (env.SAND_GOOGLE_CLIENT_ID || '').trim(),
    googleApiKey: (env.SAND_GOOGLE_API_KEY || '').trim(),
    googleAppId: (env.SAND_GOOGLE_APP_ID || '').trim(),
    requireLogin: bool(env.SAND_REQUIRE_LOGIN),
    archiveFiles: env.SAND_ARCHIVE_FILES === undefined ? true : bool(env.SAND_ARCHIVE_FILES),
    maxFileSizeMB: num(env.SAND_MAX_FILE_SIZE_MB, 25),
    conversionTimeoutSec: num(env.SAND_CONVERSION_TIMEOUT_SEC, 60),
    version
  };
}
export function configJs(env, version) {
  return `// Generated at build time. Public values only.\nwindow.SAND_CONFIG = ${JSON.stringify(buildConfig(env, version), null, 2)};\n`;
}
