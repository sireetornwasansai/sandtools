// Zero-dependency static dev server: serves src/ (+ public/) and generates config.js from env.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configJs } from './config-gen.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 5173);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8' };

export function createServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    if (rel === '/config.js') { res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-store' }); res.end(configJs(process.env, 'dev')); return; }
    for (const base of [path.join(root, 'src'), path.join(root, 'public'), path.join(root, 'tests')]) {
      const file = path.normalize(path.join(base, rel));
      if (!file.startsWith(base + path.sep)) continue; // path traversal guard
      if (fs.existsSync(file) && fs.statSync(file).isFile()) {
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        fs.createReadStream(file).pipe(res); return;
      }
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found');
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  createServer().listen(port, () => console.log(`SAND Office Tools dev server → http://localhost:${port}`));
}
