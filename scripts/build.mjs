// Zero-dependency build: copies src/ → dist/, writes config.js from environment variables,
// and generates a service worker with a content-hashed precache list.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { configJs } from './config-gen.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src'); const dist = path.join(root, 'dist');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

fs.rmSync(dist, { recursive: true, force: true });
fs.cpSync(src, dist, { recursive: true, filter: (f) => !/\.d\.m?ts$/.test(f) }); // type shims are dev-only

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p); else files.push(path.relative(dist, p).split(path.sep).join('/'));
  }
})(dist);

const hash = crypto.createHash('sha256');
for (const f of files.sort()) { hash.update(f); hash.update(fs.readFileSync(path.join(dist, f))); }
const build = hash.digest('hex').slice(0, 10);
const version = `${pkg.version}+${build}`;

fs.writeFileSync(path.join(dist, 'config.js'), configJs(process.env, version));
// js/vendor/ocr/ (≈8 MB OCR engine for scanned PDFs) is cached by the service worker on first use instead of being precached
const precache = files.filter((f) => f !== 'sw.js' && f !== 'config.js' && !f.startsWith('js/vendor/ocr/'));
const sw = fs.readFileSync(path.join(src, 'sw.js'), 'utf8')
  .replace('__CACHE_VERSION__', build).replace('__PRECACHE__', JSON.stringify(['./', ...precache], null, 2));
fs.writeFileSync(path.join(dist, 'sw.js'), sw);

if (!files.includes('js/vendor/ocr/tesseract.esm.min.js')) console.warn('Note: OCR engine files are missing (src/js/vendor/ocr/) — scanned PDFs cannot be read. Run: npm run ocr:fetch');
const missing = [];
if (!process.env.SAND_GAS_URL) missing.push('SAND_GAS_URL');
if (!process.env.SAND_GOOGLE_CLIENT_ID) missing.push('SAND_GOOGLE_CLIENT_ID');
console.log(`Built SAND Office Tools ${version} → dist/ (${files.length} files)`);
if (missing.length) console.warn(`Note: ${missing.join(', ')} not set — login, Drive and backend status are disabled in this build.`);
if (process.env.SAND_REQUIRE_LOGIN && !process.env.SAND_GAS_URL) { console.error('SAND_REQUIRE_LOGIN=true needs SAND_GAS_URL and SAND_GOOGLE_CLIENT_ID.'); process.exit(1); }
