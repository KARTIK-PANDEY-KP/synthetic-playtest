/** HTTP + WS API — every route in docs/INTERFACES.md "ORCHESTRATOR — HTTP/WS API". */
import express from 'express';
import { WebSocketServer } from 'ws';
import archiver from 'archiver';
import sharp from 'sharp';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { validatePersona } from './personas.mjs';
import { readAnalysis, ask } from './analysis.mjs';

const TERMINAL = new Set(['done', 'failed', 'stopped']);

export function createApi({ cfg, root, registry, runs, governor, log }) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.use(express.json({ limit: '1mb' }));

  const getRun = (req, res) => {
    const run = runs.get(req.params.id);
    if (!run) { res.status(404).json({ error: `no such run: ${req.params.id}` }); return null; }
    return run;
  };
  const getPersona = (req, res) => {
    const run = getRun(req, res); if (!run) return {};
    const p = run.personas.get(req.params.persona);
    if (!p) { res.status(404).json({ error: `no such persona in run: ${req.params.persona}` }); return {}; }
    return { run, p };
  };

  app.get('/api/health', (_req, res) => res.json({ ok: true, runs: runs.runs.size, governor: governor.snapshot() }));

  // ── personas ──────────────────────────────────────────────────────────────
  app.get('/api/personas', (_req, res) => res.json(registry.list()));
  app.post('/api/personas', (req, res) => {
    const errs = validatePersona(req.body);
    if (errs.length) return res.status(400).json({ error: 'invalid PersonaConfig', details: errs });
    const saved = registry.save(req.body);
    log(`personas: saved ${saved.id}`);
    res.status(201).json(saved);
  });

  // ── runs ──────────────────────────────────────────────────────────────────
  app.get('/api/runs', (_req, res) => res.json(runs.list()));
  app.post('/api/runs', (req, res) => {
    const { personas, seed, backend = 'local', maxSteps } = req.body ?? {};
    if (!Array.isArray(personas) || !personas.length || !personas.every((p) => typeof p === 'string')) return res.status(400).json({ error: 'personas: non-empty string[] required' });
    if (maxSteps !== undefined && !(Number.isInteger(maxSteps) && maxSteps > 0)) return res.status(400).json({ error: 'maxSteps: positive integer' });
    try {
      const runId = runs.create({ personas, seed, backend, maxSteps });
      res.status(201).json({ runId });
    } catch (err) { res.status(err.status ?? 500).json({ error: err.message }); }
  });
  app.get('/api/runs/:id', (req, res) => { const run = getRun(req, res); if (run) res.json(runs.runView(run)); });
  app.post('/api/runs/:id/stop', (req, res) => {
    const run = getRun(req, res); if (!run) return;
    const status = runs.stop(req.params.id);
    res.json({ ok: true, runId: run.meta.runId, status });
  });

  // ── per-persona ───────────────────────────────────────────────────────────
  app.get('/api/runs/:id/:persona/session', (req, res) => {
    const { run, p } = getPersona(req, res); if (!p) return;
    res.json(runs.sessionEvents(run, p.key) ?? []);
  });

  app.get('/api/runs/:id/:persona/stream', (req, res) => {
    const { run, p } = getPersona(req, res); if (!p) return;
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(': connected\n\n');
    const send = (ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
    const end = () => { res.write('event: end\ndata: {}\n\n'); res.end(); };
    for (const ev of runs.sessionEvents(run, p.key) ?? []) send(ev);
    if (TERMINAL.has(p.status) && !p.handle) return end();
    const unsub = runs.subscribe(run, p.key, (ev) => (ev.kind === '__end' ? end() : send(ev)));
    const hb = setInterval(() => res.write(': hb\n\n'), 15_000);
    req.on('close', () => { clearInterval(hb); unsub?.(); });
  });

  app.get('/api/runs/:id/:persona/live', async (req, res) => {
    const { run, p } = getPersona(req, res); if (!p) return;
    const viewer = p.handle?.viewerUrl?.();
    if (viewer && await proxyStream(req, res, `${viewer}/live`)) return;
    framesMjpeg(req, res, p);   // no viewer (yet / any more): stream the frames the agent saw
  });

  app.get('/api/runs/:id/:persona/frames/:n', async (req, res) => {
    const { p } = getPersona(req, res); if (!p) return;
    const n = String(req.params.n).replace(/\.png$/, '');
    const file = join(p.dir, 'frames', /^\d+$/.test(n) ? `${String(Number(n)).padStart(5, '0')}.png` : n);
    if (existsSync(file)) return res.type('png').send(readFileSync(file));
    const viewer = p.handle?.viewerUrl?.();
    if (viewer) {
      try {
        const up = await fetch(`${viewer}/frames/${encodeURIComponent(n)}`, { signal: AbortSignal.timeout(10_000) });
        if (up.ok) return res.type('png').send(Buffer.from(await up.arrayBuffer()));
      } catch { /* fall through */ }
    }
    res.status(404).json({ error: `no frame ${n} for ${p.key}` });
  });

  app.get('/api/runs/:id/:persona/report', (req, res) => {
    const { p } = getPersona(req, res); if (!p) return;
    const file = join(p.dir, 'report.json');
    if (!existsSync(file)) return res.status(404).json({ error: 'report not written yet', status: p.status });
    res.type('json').send(readFileSync(file));
  });

  // ── analysis ──────────────────────────────────────────────────────────────
  app.get('/api/runs/:id/analysis', (req, res) => {
    const run = getRun(req, res); if (!run) return;
    const a = readAnalysis(run.dir);
    if (a) return res.json({ findings: a.findings, score: a.score, reportMd: a.reportMd, source: a.meta?.source, errors: a.meta?.errors });
    if (run.meta.status === 'running' || run.analysis.status === 'pending') return res.status(202).json({ status: run.meta.status === 'running' ? 'running' : 'pending', findings: [], score: null, reportMd: '' });
    res.status(404).json({ error: run.analysis.reason ?? run.analysis.error ?? 'no analysis for this run', findings: [], score: null, reportMd: '' });
  });
  app.post('/api/runs/:id/analysis/ask', async (req, res) => {
    const run = getRun(req, res); if (!run) return;
    const question = String(req.body?.question ?? '').trim();
    if (!question) return res.status(400).json({ error: 'question: non-empty string' });
    try { res.json({ answer: await ask({ cfg, root, run, question, log }) }); }
    catch (err) { res.status(err.status ?? 500).json({ error: err.message, answer: '' }); }
  });

  app.get('/api/runs/:id/export.zip', (req, res) => {
    const run = getRun(req, res); if (!run) return;
    res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${run.meta.runId}.zip"` });
    const zip = archiver('zip', { zlib: { level: 6 } });
    zip.on('error', (err) => { log(`export: ${err.message}`); res.end(); });
    zip.pipe(res);
    zip.directory(run.dir, run.meta.runId);
    zip.finalize();
  });

  app.use((err, _req, res, _next) => { log(`api: ${err.stack ?? err}`); res.status(err.status ?? 500).json({ error: err.message ?? 'internal error' }); });

  // ── WS /ws — FleetEvents ──────────────────────────────────────────────────
  const attachWs = (server) => {
    const wss = new WebSocketServer({ server, path: '/ws' });
    const broadcast = (ev) => { const s = JSON.stringify(ev); for (const c of wss.clients) if (c.readyState === 1) c.send(s); };
    runs.on('fleet', broadcast);
    governor.on('governor', broadcast);
    governor.on('throttle', (t) => broadcast({ type: 'governor.throttle', ...t }));
    wss.on('connection', (ws) => {
      ws.isAlive = true; ws.on('pong', () => { ws.isAlive = true; });
      ws.send(JSON.stringify(governor.snapshot()));
      // catch-up: current status of every persona in every running run
      for (const run of runs.runs.values()) {
        if (run.meta.status !== 'running') continue;
        for (const p of run.personas.values()) ws.send(JSON.stringify({ type: 'persona.status', runId: run.meta.runId, persona: p.key, status: p.status }));
      }
    });
    const ping = setInterval(() => { for (const c of wss.clients) { if (!c.isAlive) return c.terminate(); c.isAlive = false; c.ping(); } }, 30_000);
    wss.on('close', () => clearInterval(ping));
    return wss;
  };

  return { app, attachWs };

  // ── helpers ───────────────────────────────────────────────────────────────
  /** Pipe an upstream streaming response (MJPEG/SSE) through. Returns false if upstream is unreachable. */
  async function proxyStream(req, res, url) {
    const ac = new AbortController();
    req.on('close', () => ac.abort());
    let up;
    try { up = await fetch(url, { signal: ac.signal, headers: { accept: '*/*' } }); }
    catch (err) { if (ac.signal.aborted) return true; log(`proxy: ${url}: ${err.message}`); return false; }
    if (!up.ok || !up.body) return false;
    res.writeHead(200, { 'Content-Type': up.headers.get('content-type') ?? 'application/octet-stream', 'Cache-Control': 'no-cache, no-store', Connection: 'keep-alive' });
    const body = Readable.fromWeb(up.body);
    body.on('error', () => res.end());
    body.pipe(res);
    return true;
  }

  /** Fallback MJPEG: the newest frame the agent saw, 1 fps, re-encoded as JPEG. */
  function framesMjpeg(req, res, p) {
    const B = 'orchestratorframe';
    res.writeHead(200, { 'Content-Type': `multipart/x-mixed-replace; boundary=${B}`, 'Cache-Control': 'no-cache, no-store', Connection: 'keep-alive' });
    let lastFile = null, lastJpg = null, closed = false;
    req.on('close', () => { closed = true; });
    const placeholder = (text) => sharp(Buffer.from(`<svg width="640" height="360" xmlns="http://www.w3.org/2000/svg"><rect width="640" height="360" fill="#0b0f14"/><text x="320" y="180" fill="#7f9bb5" font-family="system-ui,sans-serif" font-size="22" text-anchor="middle">${text}</text></svg>`)).jpeg({ quality: 70 }).toBuffer();
    const tick = async () => {
      if (closed) return;
      try {
        const frames = existsSync(join(p.dir, 'frames')) ? readdirSync(join(p.dir, 'frames')).filter((f) => f.endsWith('.png')).sort() : [];
        const newest = frames.at(-1);
        if (newest && newest !== lastFile) { lastJpg = await sharp(join(p.dir, 'frames', newest)).jpeg({ quality: 70 }).toBuffer(); lastFile = newest; }
        const jpg = lastJpg ?? await placeholder(`${p.key} · ${p.status}${TERMINAL.has(p.status) ? '' : ' · waiting for first frame'}`);
        res.write(`--${B}\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpg.length}\r\n\r\n`); res.write(jpg); res.write('\r\n');
      } catch (err) { log(`live-fallback: ${err.message}`); }
      if (!closed) setTimeout(tick, 1000);
    };
    tick();
  }
}
