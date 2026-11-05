// 静的配信: /town.json, / → web/index.html, /web/*, /art/*（このリポジトリの web/ と art/ だけ）
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve, sep, extname } from 'node:path';

const APP_ROOT = resolve(import.meta.dirname, '..');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};

export function serveTown(town, { port = 4317, host = '127.0.0.1' } = {}) {
  const body = JSON.stringify(town);
  const server = createServer(async (req, res) => {
    const send = (code, data, type = 'text/plain; charset=utf-8') => {
      res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(data);
    };
    let path;
    try { path = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { return send(400, 'bad request'); }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'method not allowed');
    if (path === '/town.json') return send(200, body, TYPES['.json']);
    if (path === '/') path = '/web/index.html';
    const top = path.split('/')[1];
    if (top !== 'web' && top !== 'art') return send(404, 'not found');
    const base = join(APP_ROOT, top);
    const file = resolve(APP_ROOT, '.' + path);
    if (!file.startsWith(base + sep)) return send(403, 'forbidden');
    try {
      send(200, await readFile(file), TYPES[extname(file).toLowerCase()] || 'application/octet-stream');
    } catch {
      send(404, path === '/web/index.html' ? 'web/index.html がまだありません（/town.json は配信中）' : 'not found');
    }
  });
  return new Promise((ok, fail) => {
    const listen = (p) => server.listen(p, host);
    server.on('error', (e) => {
      if (e.code === 'EADDRINUSE' && server.listening === false && port !== 0) { port = 0; listen(0); }   // 使用中なら空いている番号で
      else fail(e);
    });
    server.on('listening', () => ok({ server, url: `http://${host}:${server.address().port}/` }));
    listen(port);
  });
}
