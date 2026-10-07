// Downloads the OCR engine used by the File Converter for scanned PDFs and copies exactly the files the app needs into
// src/js/vendor/ocr/. Run once (and again only to upgrade):   npm run ocr:fetch      — needs Node ≥ 20 and access to the npm registry.
// Nothing is loaded from a CDN at runtime; the app serves these files itself.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dest = path.join(root, 'src', 'js', 'vendor', 'ocr');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sand-ocr-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (args, cwd) => { const r = spawnSync(npm, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' }); if (r.status !== 0) throw new Error(`npm ${args.join(' ')} failed`); };

try {
  fs.writeFileSync(path.join(tmp, 'package.json'), '{"private":true}');
  run(['install', '--no-audit', '--no-fund', 'tesseract.js@7', '@tesseract.js-data/tha', '@tesseract.js-data/eng'], tmp);
  const nm = path.join(tmp, 'node_modules');
  const ver = (p) => JSON.parse(fs.readFileSync(path.join(nm, p, 'package.json'), 'utf8')).version;
  const pick = (dir, ...names) => { for (const n of names) { const f = path.join(nm, dir, n); if (fs.existsSync(f)) return f; } throw new Error(`missing ${dir}/${names[0]}`); };
  const files = [
    [pick('tesseract.js/dist', 'tesseract.esm.min.js'), 'tesseract.esm.min.js'],
    [pick('tesseract.js/dist', 'worker.min.js'), 'worker.min.js'],
    [pick('tesseract.js-core', 'tesseract-core-simd-lstm.wasm.js'), 'tesseract-core-simd-lstm.wasm.js'],
    [pick('@tesseract.js-data/tha', '4.0.0_best_int/tha.traineddata.gz'), 'tha.traineddata.gz'],
    [pick('@tesseract.js-data/eng', '4.0.0_best_int/eng.traineddata.gz'), 'eng.traineddata.gz'],
    [pick('tesseract.js', 'LICENSE.md', 'LICENSE'), 'LICENSE-tesseract.js.txt'],
    [pick('tesseract.js-core', 'LICENSE'), 'LICENSE-tesseract.js-core.txt']
  ];
  fs.mkdirSync(dest, { recursive: true });
  for (const [from, to] of files) { fs.copyFileSync(from, path.join(dest, to)); console.log(`  ${to}  ${(fs.statSync(from).size / 1024 / 1024).toFixed(2)} MB`); }
  fs.writeFileSync(path.join(dest, 'tesseract.esm.min.d.ts'), 'declare const Tesseract: { createWorker(langs: string | string[], oem?: number, options?: Record<string, any>): Promise<any> };\nexport default Tesseract;\n');
  fs.writeFileSync(path.join(dest, 'THIRD-PARTY.txt'), `Self-hosted OCR engine used by the File Converter (src/js/modules/converters/ocr.js). Unmodified upstream files, Apache License 2.0.

- tesseract.esm.min.js, worker.min.js   : tesseract.js ${ver('tesseract.js')}  (https://github.com/naptha/tesseract.js)
- tesseract-core-simd-lstm.wasm.js      : tesseract.js-core ${ver('tesseract.js-core')}  (Tesseract OCR compiled to WebAssembly, LSTM-only, SIMD)
- tha.traineddata.gz, eng.traineddata.gz: @tesseract.js-data/{tha,eng} 4.0.0_best_int  (Tesseract "best" models, integer-quantised)

To upgrade: run \`npm run ocr:fetch\` again and bump OCR_CACHE in src/sw.js so browsers fetch the new copy.
`);
  console.log(`\nOCR engine installed in ${path.relative(root, dest)}. Now run: npm run build`);
} catch (e) {
  console.error(`\nocr:fetch failed: ${e.message}`);
  process.exitCode = 1;
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
