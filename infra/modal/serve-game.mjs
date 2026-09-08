#!/usr/bin/env node
/**
 * Serves the static game build INSIDE a sandbox on 0.0.0.0:5273 (treaty port).
 * The game is served from inside each sandbox so a run never depends on the
 * network mid-demo and the exact build is pinned per run.
 *
 *   node infra/modal/serve-game.mjs [--root /app/apps/game/dist] [--port 5273]
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const root = arg('root', '/app/apps/game/dist');
const port = Number(arg('port', 5273));

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.wasm': 'application/wasm',
};

createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = join(root, normalize(p === '/' ? '/index.html' : p).replace(/^(\.\.[/\\])+/, ''));
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
}).listen(port, '0.0.0.0', () => console.log(`serve-game: ${root} on http://0.0.0.0:${port}/`));
