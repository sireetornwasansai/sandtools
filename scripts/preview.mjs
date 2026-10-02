// Serves the production build (dist/) locally with the same security headers as Vercel.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const vercel = JSON.parse(fs.readFileSync(path.resolve(dist, '..', 'vercel.json'), 'utf8'));
const headers = Object.fromEntries((vercel.headers.find((h) => h.source === '/(.*)') || { headers: [] }).headers.map((h) => [h.key, h.value]));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
export function createPreview() {
  return http.createServer((req, res) => {
    let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(dist, rel));
    if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { ...headers, 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
  });
}
if (import.meta.url === `file://${process.argv[1]}`) createPreview().listen(Number(process.env.PORT || 4173), () => console.log('Preview → http://localhost:' + (process.env.PORT || 4173)));
