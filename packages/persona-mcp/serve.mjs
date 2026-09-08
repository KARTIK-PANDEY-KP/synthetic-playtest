/** Serves the built game over http. Used by the smoke test, the proof renderer,
 *  and (inside a sandbox) the agent's own copy of the game. */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not .pathname — the repo path may contain a space, which
// .pathname percent-encodes into a directory that does not exist.
export const GAME_DIST = fileURLToPath(new URL('../../apps/game/dist/', import.meta.url));

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
};

export async function serveGame(root = GAME_DIST) {
  const server = createServer(async (req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    // Resolve first, then key the content type off the FILE, not the URL:
    // '/' has no extension and would otherwise be served as octet-stream,
    // which Chromium downloads instead of rendering.
    const file = join(root, normalize(p === '/' ? '/index.html' : p).replace(/^(\.\.[/\\])+/, ''));
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch { res.writeHead(404); res.end('not found'); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, url: `http://127.0.0.1:${server.address().port}/` };
}
