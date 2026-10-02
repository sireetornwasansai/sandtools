/** @typedef {{gasUrl:string,googleClientId:string,googleApiKey:string,googleAppId:string,requireLogin:boolean,archiveFiles:boolean,maxFileSizeMB:number,conversionTimeoutSec:number,version:string}} SandConfig */

/** @type {SandConfig} */
const defaults = {
  gasUrl: '', googleClientId: '', googleApiKey: '', googleAppId: '',
  requireLogin: false, archiveFiles: true, maxFileSizeMB: 25, conversionTimeoutSec: 60, version: 'dev'
};

/** Runtime configuration injected by config.js (generated at build time). */
export const config = /** @type {SandConfig} */ (Object.assign({}, defaults, (typeof window !== 'undefined' && window.SAND_CONFIG) || {}));
export const APP_NAME = 'SAND Office Tools';
export const APP_FULL_NAME = 'SAND — Sansai Administration Network';
export const MAX_FILE_BYTES = Math.max(1, Number(config.maxFileSizeMB) || 25) * 1024 * 1024;
