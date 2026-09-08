#!/usr/bin/env node
/**
 * fake-runner — a stand-in for `packages/persona-mcp/runner.mjs`.
 *
 * Implements the RUNNER CLI contract from docs/INTERFACES.md so the orchestrator
 * and dashboard can be built and demoed before the real Codex-driven runner
 * lands. It drives the REAL game in a REAL Chromium via Playwright, walks
 * around at random, and emits realistic SessionEvents. It does not call Codex
 * and costs $0 — the `usage` numbers are modelled on the Spike-01 measurements.
 *
 *   node apps/orchestrator/dev/fake-runner.mjs \
 *     --persona <persona.json> --game-url http://127.0.0.1:5273/ --seed 7 \
 *     --out runs/<runId>/<persona> --viewer-port 9101 [--max-steps N]
 *
 * stdout: one SessionEvent JSON per line (also appended to <out>/session.jsonl)
 * <out>/: persona.json, session.jsonl, frames/NNNNN.png, report.json, cost.json
 * viewer (on --viewer-port): /live MJPEG 3fps · /stream SSE · /frames/:n · /health
 * signals: SIGUSR1 pause · SIGUSR2 resume · SIGTERM stop (status: stopped, exit 143)
 * env: FAKE_STEP_MS (default 4000) · FAKE_FINDING_RATE (0..1, default 0.7)
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { appendFileSync, mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';

// ── args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : dflt;
};
const personaPath = arg('persona');
const gameUrl = arg('game-url', 'http://127.0.0.1:5273/');
const seed = Number(arg('seed', 1));
const outDir = resolve(arg('out', `runs/fake-${Date.now()}`));
const viewerPort = Number(arg('viewer-port', 0));
const stepMs = Number(process.env.FAKE_STEP_MS ?? 4000);
const findingRate = Number(process.env.FAKE_FINDING_RATE ?? 0.7);

if (!personaPath || !existsSync(personaPath)) {
  process.stderr.write(`fake-runner: --persona <file> is required (got ${personaPath})\n`);
  process.exit(2);
}
const persona = JSON.parse(readFileSync(personaPath, 'utf8'));
const maxSteps = Number(arg('max-steps', persona.enforcement?.step_budget ?? 60));
const patience = Number(persona.enforcement?.patience ?? 6);

mkdirSync(join(outDir, 'frames'), { recursive: true });
const personaOut = join(outDir, 'persona.json');
if (resolve(personaPath) !== personaOut) copyFileSync(personaPath, personaOut);
writeFileSync(join(outDir, 'session.jsonl'), '');

// ── deterministic RNG (seeded per persona so a fleet is not in lockstep) ────
let s = (seed * 2654435761 + [...persona.id].reduce((h, c) => h * 31 + c.charCodeAt(0), 7)) >>> 0;
const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const jitter = (ms, k = 0.3) => Math.round(ms * (1 - k + rand() * 2 * k));

// ── session log ─────────────────────────────────────────────────────────────
const t0 = Date.now();
const events = [];
const sseClients = new Set();
function emit(ev) {
  const e = { t: Date.now() - t0, ...ev };
  events.push(e);
  const line = JSON.stringify(e);
  process.stdout.write(line + '\n');
  appendFileSync(join(outDir, 'session.jsonl'), line + '\n');
  for (const res of sseClients) res.write(`data: ${line}\n\n`);
  return e;
}
const status = (st, detail) => emit({ kind: 'status', status: st, ...(detail ? { detail } : {}) });

// ── control: pause/resume/stop ──────────────────────────────────────────────
let paused = false, stopping = false;
let wake = () => {};
process.on('SIGUSR1', () => { if (!paused) { paused = true; status('playing', 'paused by governor'); } });
process.on('SIGUSR2', () => { if (paused) { paused = false; status('playing', 'resumed'); wake(); } });
const onStop = async () => { if (stopping) return; stopping = true; paused = false; wake(); };
process.on('SIGTERM', onStop);
process.on('SIGINT', onStop);
const sleep = (ms) => new Promise((r) => { const id = setTimeout(r, ms); wake = () => { clearTimeout(id); r(); }; });

// ── browser ─────────────────────────────────────────────────────────────────
status('starting', `fake-runner on ${hostname()} · ${maxSteps} steps · game ${gameUrl}`);
const launchArgs = process.platform === 'linux' && process.getuid?.() === 0 ? ['--no-sandbox'] : [];
const browser = await chromium.launch({ args: launchArgs });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();

const telemetry = [];
let stallSteps = 0;
const PROGRESS = new Set(['room_entered', 'item_picked', 'item_used', 'puzzle_solved', 'flaw_triggered']);
const pendingFlaws = [];
await ctx.exposeBinding('__harnessEvent', (_src, e) => {
  telemetry.push(e);
  emit({ kind: 'telemetry', event: e });
  if (PROGRESS.has(e.type)) stallSteps = 0;
  if (e.type === 'flaw_triggered') pendingFlaws.push(e.flawId);
});
await page.addInitScript(() => {
  const install = () => {
    if (!window.__telemetry) return false;
    window.__telemetry.subscribe((e) => window.__harnessEvent(e));
    return true;
  };
  if (!install()) { const iv = setInterval(() => { if (install()) clearInterval(iv); }, 30); }
});

const runUuid = randomUUID();
try {
  await page.goto(`${gameUrl}${gameUrl.includes('?') ? '&' : '?'}seed=${seed}&run=${runUuid}`, { waitUntil: 'load', timeout: 30_000 });
  await page.waitForFunction(() => !!window.__telemetry, null, { timeout: 15_000 });
} catch (err) {
  status('failed', `could not load game: ${err.message}`);
  await browser.close();
  process.exit(1);
}

// ── viewer: /live MJPEG · /stream SSE · /frames/:n · /health ────────────────
const BOUNDARY = 'fakerunnerframe';
const mjpegClients = new Set();
let mjpegTimer = null;
async function mjpegTick() {
  if (!mjpegClients.size) { mjpegTimer = null; return; }
  const started = Date.now();
  try {
    const jpg = await page.screenshot({ type: 'jpeg', quality: 55 });
    const head = `--${BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpg.length}\r\n\r\n`;
    for (const res of mjpegClients) { res.write(head); res.write(jpg); res.write('\r\n'); }
  } catch { /* page closing */ }
  // one capture per client tick regardless of client count; hold ~3 fps net of capture time
  mjpegTimer = setTimeout(mjpegTick, Math.max(40, 333 - (Date.now() - started)));
}
const viewer = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (url.pathname === '/live') {
    res.writeHead(200, {
      'Content-Type': `multipart/x-mixed-replace; boundary=${BOUNDARY}`,
      'Cache-Control': 'no-cache, no-store', Connection: 'keep-alive', Pragma: 'no-cache',
    });
    mjpegClients.add(res);
    req.on('close', () => mjpegClients.delete(res));
    if (!mjpegTimer) mjpegTimer = setTimeout(mjpegTick, 0);
    return;
  }
  if (url.pathname === '/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    for (const e of events) res.write(`data: ${JSON.stringify(e)}\n\n`);
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }
  const m = url.pathname.match(/^\/frames\/(\d+)(?:\.png)?$/);
  if (m) {
    const file = join(outDir, 'frames', `${String(Number(m[1])).padStart(5, '0')}.png`);
    if (!existsSync(file)) { res.writeHead(404); return res.end('no such frame'); }
    res.writeHead(200, { 'Content-Type': 'image/png' });
    return res.end(readFileSync(file));
  }
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, persona: persona.id, step: stepNo, frames: frameNo, paused, events: events.length }));
  }
  res.writeHead(404); res.end('not found');
});
if (viewerPort) await new Promise((r) => viewer.listen(viewerPort, '0.0.0.0', r));

// ── the "agent" loop ────────────────────────────────────────────────────────
let stepNo = 0, frameNo = 0;
const cost = { steps: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, usd: 0 };
const PRICE = { input: 10, cachedInput: 1, output: 50 }; // per 1M — mirrors ASTRA_PRICE in contract.ts
const findings = [];
const experience = { confused: [], bored: [], unfair: [], enjoyed: [] };

const FLAW_FINDINGS = {
  C1: { severity: 'high', category: 'confusion', title: 'Controls text vanished before I finished reading it', description: 'A tutorial box appeared for a few seconds and then disappeared. I could not find any way to bring it back.' },
  C3: { severity: 'medium', category: 'confusion', title: 'Keycard was almost invisible behind a crate', description: 'The item I needed was a tiny sliver on the floor behind a crate with no highlight or prompt until I was right on top of it.' },
  G1: { severity: 'high', category: 'unfair', title: 'Vent says it is too low but never tells me how to crouch', description: 'The prompt says the vent is too low to walk through. Nothing in the game mentions a crouch control.' },
  D1: { severity: 'low', category: 'bug', title: 'Sealed bulkhead cannot be opened', description: 'A large door in the corridor does nothing when I interact with it. It looks like it should open.' },
};
const REASONING = {
  skim: ['Chat wants action. Moving on.', 'Not reading that. Where is the door?', 'This looks like every other sim, W to go forward.', 'Okay, something over there. Interact.'],
  normal: ['Let me take a screenshot and see where I am.', 'There is a prompt on screen — trying E.', 'The room changed colour, so I probably moved rooms.', 'Nothing happened. Let me look around first.'],
  thorough: ['I want to read every label before I touch anything.', 'Checking the corners of this room before leaving.', 'The objective says restore power; I have not found a power room yet.', 'That door has a card reader. I need a card.'],
};
const reasoning = REASONING[persona.enforcement?.reading] ?? REASONING.normal;

const codex = (event) => emit({ kind: 'codex', event });
codex({ type: 'thread.started', thread_id: `thr_fake_${runUuid.slice(0, 8)}` });
status('playing');

async function screenshotFrame() {
  const file = join(outDir, 'frames', `${String(frameNo).padStart(5, '0')}.png`);
  await page.screenshot({ path: file, type: 'png' });
  return `frames/${basename(file)}`;
}

const KEY = { forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD' };
const LOOK = { left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown' };
const hold = async (code, ms) => { await page.keyboard.down(code); await page.waitForTimeout(Math.min(3000, ms)); await page.keyboard.up(code); };

let lastFrame;
while (stepNo < maxSteps && !stopping) {
  while (paused && !stopping) await sleep(250);
  if (stopping) break;

  const step = ++stepNo;
  codex({ type: 'turn.started' });
  const thought = pick(reasoning);
  codex({ type: 'item.completed', item: { id: `item_${step}_r`, type: 'reasoning', text: thought } });

  // choose an action — screenshots are frequent because that is how the agent sees
  const r = rand();
  let tool, args, result, frame;
  if (step === 1 || r < 0.3) {
    tool = 'screenshot'; args = {};
    frame = lastFrame = await screenshotFrame(); frameNo++;
    result = `${frame} (1280x720)`;
  } else if (r < 0.65) {
    const direction = pick(['forward', 'forward', 'forward', 'back', 'left', 'right']);
    const ms = jitter(persona.enforcement?.exploration === 'low' ? 1400 : 900, 0.5);
    tool = 'move'; args = { direction, ms }; await hold(KEY[direction], ms); result = 'ok';
  } else if (r < 0.88) {
    const direction = pick(['left', 'right', 'left', 'right', 'up', 'down']);
    const ms = jitter(500, 0.5);
    tool = 'look'; args = { direction, ms }; await hold(LOOK[direction], ms); result = 'ok';
  } else if (r < 0.95) {
    tool = 'interact'; args = {}; await page.keyboard.press('KeyE'); await page.waitForTimeout(150); result = 'ok';
  } else {
    tool = 'crouch'; args = { on: rand() < 0.5 }; result = 'ok';
  }
  stallSteps++;
  codex({ type: 'item.completed', item: { id: `item_${step}_t`, type: 'mcp_tool_call', server: 'game', tool, arguments: args, status: 'completed' } });
  emit({ kind: 'action', step, tool, args, result, ...(frame ? { frame } : {}) });

  // usage — modelled on Spike-01: ~46K cached system prefix + growing transcript
  const input = 46_000 + Math.min(step, 60) * 300 + Math.round(rand() * 1500);
  const cached = Math.round(input * (0.9 + rand() * 0.05));
  const output = 90 + Math.round(rand() * 160);
  cost.steps = step; cost.inputTokens += input; cost.cachedInputTokens += cached; cost.outputTokens += output;
  cost.usd = ((cost.inputTokens - cost.cachedInputTokens) * PRICE.input + cost.cachedInputTokens * PRICE.cachedInput + cost.outputTokens * PRICE.output) / 1e6;
  codex({ type: 'turn.completed', usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output } });
  emit({ kind: 'usage', input, cached, output });

  // findings — when the answer key fires, this persona may (or may not) notice
  while (pendingFlaws.length) {
    const flawId = pendingFlaws.shift();
    const tpl = FLAW_FINDINGS[flawId];
    if (!tpl || rand() > findingRate) continue;
    if (findings.some((f) => f.title === tpl.title)) continue;
    const state = await page.evaluate(() => window.__telemetry.snapshot()).catch(() => ({}));
    const finding = {
      id: `${persona.id}-f${findings.length + 1}`, ...tpl, room: state.room,
      reproSteps: [`Start a new game with seed ${seed}`, `Walk to the ${state.room}`, `Observe: ${tpl.title.toLowerCase()}`],
      ...(lastFrame ? { frame: lastFrame } : {}), step,
    };
    findings.push(finding);
    codex({ type: 'item.completed', item: { id: `item_${step}_f`, type: 'mcp_tool_call', server: 'game', tool: 'note_finding', arguments: finding, status: 'completed' } });
    emit({ kind: 'finding', finding });
    (tpl.category === 'confusion' ? experience.confused : tpl.category === 'unfair' ? experience.unfair : experience.enjoyed).push(tpl.title);
  }

  // patience gate — from ground truth, never self-report
  if (stallSteps >= patience * 3) {
    emit({ kind: 'gate', gate: 'patience', detail: `${stallSteps} steps without progress (patience ${patience})` });
    if (rand() < 0.15 && persona.enforcement?.patience <= 3) {
      emit({ kind: 'gate', gate: 'abandon', detail: 'frustration threshold reached' });
      experience.bored.push('Wandering the corridor with nothing new happening');
      break;
    }
    stallSteps = 0;
  }
  await sleep(jitter(stepMs));
}

// ── report ──────────────────────────────────────────────────────────────────
if (!stopping) {
  if (stepNo >= maxSteps) emit({ kind: 'gate', gate: 'budget', detail: `step budget ${maxSteps} spent` });
  status('reporting');
  const state = await page.evaluate(() => window.__telemetry.snapshot()).catch(() => ({ room: '?' }));
  if (!experience.enjoyed.length) experience.enjoyed.push('The rooms have distinct colours, so I always knew when I had moved somewhere new');
  if (!experience.bored.length && stepNo > 40) experience.bored.push('Long stretches of corridor with nothing to interact with');
  const abandoned = events.some((e) => e.kind === 'gate' && e.gate === 'abandon');
  const report = {
    persona: persona.id,
    summary: `${persona.name} here. I spent ${stepNo} actions on Station Kepler and got as far as the ${state.room}. ${findings.length ? `I noted ${findings.length} thing${findings.length > 1 ? 's' : ''} that got in my way.` : 'Nothing got badly in my way, but I did not get far either.'} (synthetic report from fake-runner — no model was involved)`,
    completed: false,
    ...(abandoned ? { abandonedReason: 'Too many steps without progress' } : {}),
    findings,
    experience,
    wouldRecommend: findings.some((f) => f.severity === 'high') ? 2 : 3,
  };
  await sleep(jitter(1500));
  writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(outDir, 'cost.json'), JSON.stringify(cost, null, 2));
  codex({ type: 'turn.completed', usage: { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 } });
  status('done', `report.json written · ${findings.length} findings · $${cost.usd.toFixed(2)}`);
} else {
  writeFileSync(join(outDir, 'cost.json'), JSON.stringify(cost, null, 2));
  status('stopped', `stopped after ${stepNo} steps`);
}

for (const res of sseClients) { res.write('event: end\ndata: {}\n\n'); res.end(); }
for (const res of mjpegClients) res.end();
viewer.close();
await browser.close().catch(() => {});
process.exit(stopping ? 143 : 0);
