/** Serves apps/game/dist on the treaty port (5273) for the LOCAL backend. Reuses an existing server if one is already there. */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.wasm': 'application/wasm',
};

export async function ensureGameServer({ dist, port, log = console.log }) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1500) });
    if (r.ok) { log(`game: reusing existing server on :${port}`); return { url: `http://127.0.0.1:${port}/`, owned: false }; }
  } catch { /* nothing there — we serve it */ }

  try { await stat(join(dist, 'index.html')); } catch {
    log(`game: WARNING ${dist}/index.html missing — run \`pnpm --filter station-kepler build\`. Serving 404s on :${port}.`);
  }

  const server = createServer(async (req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = join(dist, normalize(p === '/' ? '/index.html' : p).replace(/^(\.\.[/\\])+/, ''));
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(body);
    } catch { res.writeHead(404); res.end('not found'); }
  });
  await new Promise((ok, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', ok); });
  log(`game: serving ${dist} on http://127.0.0.1:${port}/`);
  return { url: `http://127.0.0.1:${port}/`, owned: true, server };
}
