/**
 * RunManager — creates runs, starts personas through the governor, tails their
 * SessionEvents into PersonaLive state, persists runs/<runId>/run.json, and
 * fires FleetEvents ('fleet') for the WS layer. Runs may contain ANY number of
 * personas; duplicates are allowed and keyed by occurrence (maya, maya-2, …).
 */
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { costUsd, emptyCost } from './pricing.mjs';
import { staggerBudget } from './governor.mjs';
import { startLocal } from './backends/local.mjs';
import { startModal } from './backends/modal.mjs';
import { runAnalysis } from './analysis.mjs';

const TERMINAL = new Set(['done', 'failed', 'stopped']);
const firstLine = (s) => String(s ?? '').split('\n').map((x) => x.trim()).find(Boolean)?.slice(0, 200);

export class RunManager extends EventEmitter {
  constructor({ cfg, root, registry, governor, log = console.log }) {
    super();
    this.cfg = cfg; this.root = root; this.registry = registry; this.governor = governor; this.log = log;
    this.runs = new Map();
    mkdirSync(cfg.runsDir, { recursive: true });
    this.#loadFromDisk();
  }

  // ── persistence ───────────────────────────────────────────────────────────
  #loadFromDisk() {
    for (const id of readdirSync(this.cfg.runsDir).sort()) {
      const file = join(this.cfg.runsDir, id, 'run.json');
      if (!existsSync(file)) continue;
      try {
        const meta = JSON.parse(readFileSync(file, 'utf8'));
        if (meta.status === 'running') { meta.status = 'stopped'; meta.finishedAt ??= new Date().toISOString(); writeFileSync(file, JSON.stringify(meta, null, 2)); }
        const run = { meta, dir: join(this.cfg.runsDir, id), personas: new Map(), analysis: { status: existsSync(join(this.cfg.runsDir, id, 'analysis', 'findings.json')) ? 'ready' : 'none' }, stopping: false, live: false };
        for (const key of meta.personas) run.personas.set(key, this.#coldPersona(run, key));
        this.runs.set(id, run);
      } catch (err) { this.log(`runs: skipping ${id}: ${err.message}`); }
    }
    this.log(`runs: ${this.runs.size} loaded from ${this.cfg.runsDir}`);
  }

  /** A persona from a previous process: state is reconstructed from disk on demand. */
  #coldPersona(run, key) {
    const dir = join(run.dir, key);
    const readJson = (f) => { try { return JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { return null; } };
    const cost = readJson('cost.json') ?? emptyCost();
    const report = readJson('report.json');
    let status = report ? 'done' : run.meta.status === 'stopped' ? 'stopped' : 'failed';
    let steps = cost.steps ?? 0, lastReasoning;
    const events = this.#readSession(dir);
    for (const e of events) {
      if (e.kind === 'status') status = e.status;
      if (e.kind === 'action') steps = Math.max(steps, e.step);
    }
    // A valid report.json is definitive: the runner's final status line can trail the
    // session copy, and a persona that wrote its report finished, whatever the log says.
    if (report && !TERMINAL.has(status)) status = 'done';
    if (!TERMINAL.has(status)) status = 'stopped';
    return { key, id: readJson('persona.json')?.id ?? key.replace(/-\d+$/, ''), dir, status, steps, cost, lastReasoning, events, subscribers: new Set(), handle: null, cold: true };
  }

  #readSession(dir) {
    try { return readFileSync(join(dir, 'session.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); }
    catch { return []; }
  }

  #saveMeta(run) { writeFileSync(join(run.dir, 'run.json'), JSON.stringify(run.meta, null, 2)); }

  // ── creation ──────────────────────────────────────────────────────────────
  create({ personas, seed, backend, maxSteps }) {
    const configs = personas.map((id) => {
      const p = this.registry.get(id);
      if (!p) throw Object.assign(new Error(`unknown persona: ${id}`), { status: 400 });
      return p;
    });
    if (!configs.length) throw Object.assign(new Error('personas: non-empty string[] required'), { status: 400 });
    if (backend !== 'local' && backend !== 'modal') throw Object.assign(new Error("backend: 'local' | 'modal'"), { status: 400 });
    seed = Number.isInteger(seed) ? seed : Math.floor(Math.random() * 1_000_000);

    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
    const runId = `${stamp}-${randomBytes(2).toString('hex')}`;
    const dir = join(this.cfg.runsDir, runId);
    mkdirSync(dir, { recursive: true });

    // unique keys for duplicates: maya, maya-2, maya-3 …
    const seen = new Map(); const keys = [];
    for (const p of configs) { const n = (seen.get(p.id) ?? 0) + 1; seen.set(p.id, n); keys.push(n === 1 ? p.id : `${p.id}-${n}`); }

    const meta = { runId, startedAt: new Date().toISOString(), gameUrl: backend === 'local' ? this.cfg.gameUrl : 'http://127.0.0.1:5273/ (in-sandbox)', seed, backend, personas: keys, status: 'running' };
    const run = { meta, dir, personas: new Map(), analysis: { status: 'none' }, stopping: false, live: true };

    configs.forEach((p, i) => {
      const key = keys[i];
      const pdir = join(dir, key);
      mkdirSync(join(pdir, 'frames'), { recursive: true });
      // stagger step budgets ±15% so reports land at different times (demo requirement)
      const budget = staggerBudget(p.enforcement.step_budget, seed, i, this.cfg.budgetStagger);
      const used = { ...p, enforcement: { ...p.enforcement, step_budget: budget } };
      writeFileSync(join(pdir, 'persona.json'), JSON.stringify(used, null, 2));
      const cap = maxSteps ?? this.cfg.runnerMaxSteps;
      run.personas.set(key, {
        key, id: p.id, index: i, config: used, dir: pdir, status: 'queued', steps: 0, cost: emptyCost(), lastReasoning: undefined,
        events: [], subscribers: new Set(), handle: null, cold: false,
        maxSteps: cap ? Math.min(budget, staggerBudget(cap, seed, i, this.cfg.budgetStagger)) : null,
      });
    });
    this.#saveMeta(run);
    this.runs.set(runId, run);
    this.log(`runs: created ${runId} backend=${backend} seed=${seed} personas=${keys.join(',')}`);

    for (const p of run.personas.values()) {
      this.#pushEvent(run, p, { t: 0, kind: 'status', status: 'queued', detail: `budget ${p.config.enforcement.step_budget}${p.maxSteps ? ` · max-steps ${p.maxSteps}` : ''}` });
      this.governor.enqueue(`${runId}/${p.key}`, () => this.#startPersona(run, p));
    }
    return runId;
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────
  async #startPersona(run, p) {
    if (run.stopping) { this.governor.bootDone(`${run.meta.runId}/${p.key}`); return; }
    const start = run.meta.backend === 'modal' ? startModal : startLocal;
    const gkey = `${run.meta.runId}/${p.key}`;
    let handle;
    try {
      handle = start({ cfg: this.cfg, root: this.root, runId: run.meta.runId, key: p.key, personaFile: join(p.dir, 'persona.json'), outDir: p.dir, seed: run.meta.seed, maxSteps: p.maxSteps, log: this.log });
    } catch (err) {
      this.#pushEvent(run, p, { t: 0, kind: 'status', status: 'failed', detail: `spawn failed: ${err.message}` });
      this.governor.bootDone(gkey); this.#checkRunDone(run); return;
    }
    p.handle = handle; p.startedAt = Date.now();
    this.governor.track(gkey, handle);
    this.#pushEvent(run, p, { t: 0, kind: 'status', status: 'starting', detail: `${run.meta.backend} pid ${handle.pid}` });
    handle.on('event', (ev) => this.#onEvent(run, p, ev));
    handle.on('stderr', (line) => this.log(`${gkey} [stderr] ${line.slice(0, 300)}`));
    handle.on('log', (line) => this.log(`${gkey} [stdout] ${line.slice(0, 300)}`));
    handle.on('exit', (info) => this.#onExit(run, p, info));
  }

  #pushEvent(run, p, ev) {
    p.events.push(ev);
    for (const fn of p.subscribers) { try { fn(ev); } catch { /* subscriber gone */ } }
    if (ev.kind === 'status') {
      p.status = ev.status; if (p.handle) p.handle.status = ev.status;
      this.emit('fleet', { type: 'persona.status', runId: run.meta.runId, persona: p.key, status: ev.status, ...(ev.detail ? { detail: ev.detail } : {}) });
    }
  }

  #onEvent(run, p, ev) {
    const runId = run.meta.runId, gkey = `${runId}/${p.key}`;
    switch (ev.kind) {
      case 'status':
        if (ev.status !== 'starting' && ev.status !== 'queued') this.governor.bootDone(gkey);
        break;
      case 'action':
        p.steps = Math.max(p.steps, ev.step ?? 0); p.cost.steps = p.steps;
        this.emit('fleet', { type: 'persona.step', runId, persona: p.key, step: ev.step, ...(p.lastReasoning ? { reasoning: p.lastReasoning } : {}), ...(ev.frame ? { frame: ev.frame } : {}), tool: ev.tool });
        break;
      case 'codex': {
        const item = ev.event?.item;
        if (item && (item.type === 'reasoning' || item.type === 'agent_message') && item.text) p.lastReasoning = firstLine(item.text);
        else if (ev.event?.type === 'item.completed' && item?.type === 'mcp_tool_call' && item.tool === 'note_finding') p.lastReasoning = `noting: ${firstLine(item.arguments?.title)}`;
        break;
      }
      case 'finding':
        this.emit('fleet', { type: 'persona.finding', runId, persona: p.key, finding: ev.finding });
        break;
      case 'usage':
        this.governor.recordUsage(gkey, ev);
        p.cost.inputTokens += ev.input ?? 0; p.cost.cachedInputTokens += ev.cached ?? 0; p.cost.outputTokens += ev.output ?? 0;
        p.cost.usd = +costUsd(p.cost).toFixed(6);
        this.emit('fleet', { type: 'persona.cost', runId, persona: p.key, cost: { ...p.cost } });
        break;
      case 'gate':
        p.lastReasoning = `[${ev.gate}] ${firstLine(ev.detail)}`;
        break;
      default: break; // telemetry: stored, never surfaced as reasoning
    }
    this.#pushEvent(run, p, ev);
  }

  #onExit(run, p, { code, stopRequested }) {
    const gkey = `${run.meta.runId}/${p.key}`;
    this.governor.untrack(gkey); this.governor.bootDone(gkey);
    if (!TERMINAL.has(p.status)) {
      const status = stopRequested || run.stopping ? 'stopped' : code === 0 ? 'done' : 'failed';
      this.#pushEvent(run, p, { t: p.startedAt ? Date.now() - p.startedAt : 0, kind: 'status', status, detail: `runner exited with code ${code}` });
    } else if (p.status === 'done' && code !== 0 && !stopRequested) {
      this.log(`${gkey}: reported done but exited ${code}`);
    }
    // cost.json is the runner's ground truth once it exists
    try { const c = JSON.parse(readFileSync(join(p.dir, 'cost.json'), 'utf8')); p.cost = { ...p.cost, ...c }; } catch { /* keep streamed totals */ }
    for (const fn of p.subscribers) { try { fn({ kind: '__end' }); } catch { /* gone */ } }
    p.handle = null;
    this.#checkRunDone(run);
  }

  #checkRunDone(run) {
    if (run.meta.status !== 'running') return;
    const ps = [...run.personas.values()];
    if (!ps.every((p) => TERMINAL.has(p.status))) return;
    run.meta.status = run.stopping ? 'stopped' : ps.every((p) => p.status === 'failed') ? 'failed' : 'done';
    run.meta.finishedAt = new Date().toISOString();
    this.#saveMeta(run);
    this.log(`runs: ${run.meta.runId} ${run.meta.status} (${ps.map((p) => `${p.key}=${p.status}`).join(' ')})`);
    this.#analyse(run).finally(() => this.emit('fleet', { type: 'run.done', runId: run.meta.runId, status: run.meta.status }));
  }

  async #analyse(run) {
    const hasReport = [...run.personas.values()].some((p) => existsSync(join(p.dir, 'report.json')));
    if (!hasReport) { run.analysis = { status: 'none', reason: 'no report.json in any persona dir' }; return; }
    run.analysis = { status: 'pending' };
    try {
      const result = await runAnalysis({ cfg: this.cfg, root: this.root, run, log: this.log });
      run.analysis = { status: 'ready', source: result.source, errors: result.errors };
    } catch (err) { run.analysis = { status: 'failed', error: err.message }; this.log(`analysis: ${run.meta.runId} failed: ${err.message}`); }
  }

  stop(runId) {
    const run = this.runs.get(runId);
    if (!run) return null;
    if (run.meta.status !== 'running') return run.meta.status;
    run.stopping = true;
    const removed = this.governor.dequeue((k) => k.startsWith(`${runId}/`));
    for (const p of run.personas.values()) {
      if (p.status === 'queued') this.#pushEvent(run, p, { t: 0, kind: 'status', status: 'stopped', detail: 'stopped before start' });
      else if (p.handle) p.handle.stop();
    }
    this.log(`runs: stopping ${runId} (${removed} dequeued)`);
    this.#checkRunDone(run);
    return 'stopping';
  }

  stopAll() { for (const id of this.runs.keys()) this.stop(id); }

  // ── read model ────────────────────────────────────────────────────────────
  get(runId) { return this.runs.get(runId); }
  list() { return [...this.runs.values()].map((r) => r.meta).sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)); }

  personaLive(run, p) {
    const base = `${this.cfg.publicBaseUrl}/api/runs/${run.meta.runId}/${p.key}`;
    return {
      id: p.key, personaId: p.id, status: p.status, steps: p.steps, cost: { ...p.cost },
      ...(p.lastReasoning ? { lastReasoning: p.lastReasoning } : {}),
      liveUrl: `${base}/live`, streamUrl: `${base}/stream`,
      ...(p.config ? { budget: p.config.enforcement.step_budget } : {}),
      ...(p.handle?.sandboxId ? { sandboxId: p.handle.sandboxId } : {}),
    };
  }

  runView(run) { return { ...run.meta, analysis: run.analysis.status, personas: [...run.personas.values()].map((p) => this.personaLive(run, p)) }; }

  sessionEvents(run, key) {
    const p = run.personas.get(key);
    if (!p) return null;
    return p.events.length || !p.cold ? p.events : this.#readSession(p.dir);
  }

  /** Subscribe to live SessionEvents. Calls fn({kind:'__end'}) when the persona exits. Returns unsubscribe. */
  subscribe(run, key, fn) {
    const p = run.personas.get(key);
    if (!p) return null;
    p.subscribers.add(fn);
    return () => p.subscribers.delete(fn);
  }
}
