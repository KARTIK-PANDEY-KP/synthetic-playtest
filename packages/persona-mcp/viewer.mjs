/**
 * The human view. Never reaches the model, so it costs nothing.
 *
 *   GET /live    multipart/x-mixed-replace MJPEG, ~3 fps, JPEG q60, straight from the page
 *                (un-redacted: this is what a spectator sees, not what the persona sees)
 *   GET /stream  text/event-stream of SessionEvents: history replayed, then live
 *   GET /        a bare page that shows both, for eyeballing a run
 *   GET /health  { ok }
 */
import { createServer } from 'node:http';

const FPS = 3;
const BOUNDARY = 'frame';

export async function startViewer({ port, session, events }) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: true, steps: session.steps })); }
    if (url.pathname === '/live') return mjpeg(req, res, session);
    if (url.pathname === '/stream') return sse(req, res, events);
    if (url.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(PAGE); }
    res.writeHead(404); res.end('not found');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => { server.off('error', reject); resolve(); });
  });
  return { server, port: server.address().port, close: () => new Promise((r) => server.close(r)) };
}

async function mjpeg(req, res, session) {
  res.writeHead(200, {
    'content-type': `multipart/x-mixed-replace; boundary=${BOUNDARY}`,
    'cache-control': 'no-cache, no-store', connection: 'keep-alive', pragma: 'no-cache',
  });
  let open = true;
  req.on('close', () => { open = false; });
  while (open) {
    const started = Date.now();
    try {
      const page = session.page;
      if (!page || page.isClosed()) break;
      const jpg = await page.screenshot({ type: 'jpeg', quality: 60 });
      res.write(`--${BOUNDARY}\r\ncontent-type: image/jpeg\r\ncontent-length: ${jpg.length}\r\n\r\n`);
      res.write(jpg);
      res.write('\r\n');
    } catch { break; }
    const wait = Math.max(0, 1000 / FPS - (Date.now() - started));
    await new Promise((r) => setTimeout(r, wait));
  }
  try { res.end(); } catch { /* already gone */ }
}

function sse(req, res, events) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  const send = (e) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  for (const e of events.history()) send(e);
  const unsub = events.subscribe(send);
  const beat = setInterval(() => res.write(': keep-alive\n\n'), 15_000);
  req.on('close', () => { unsub(); clearInterval(beat); });
}

const PAGE = `<!doctype html><meta charset="utf-8"><title>persona live</title>
<style>body{margin:0;background:#0b0f14;color:#e8eef5;font:13px ui-monospace,monospace;display:grid;grid-template-columns:1fr 520px;height:100vh}
img{width:100%;display:block;background:#000}#log{overflow:auto;padding:8px;border-left:1px solid #24384f;white-space:pre-wrap;word-break:break-word}
.codex{color:#7f9bb5}.action{color:#e8eef5}.finding{color:#ffd166}.gate{color:#ef476f}.telemetry{color:#4b5563}.usage,.status{color:#06d6a0}</style>
<div><img src="/live"></div><div id="log"></div>
<script>const log=document.getElementById('log');const es=new EventSource('/stream');
es.onmessage=(m)=>{const e=JSON.parse(m.data);const d=document.createElement('div');d.className=e.kind;
d.textContent=e.kind==='codex'?JSON.stringify(e.event).slice(0,400):JSON.stringify(e).slice(0,400);log.appendChild(d);log.scrollTop=log.scrollHeight;};</script>`;
