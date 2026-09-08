/**
 * The governor — a global token bucket over the whole fleet.
 *
 * Fed by `usage` SessionEvents. Tracks a sliding 60s window of tokens (TPM) and
 * requests (RPM). Persona starts are queued and released only while headroom
 * is above `headroomMin`, at most one every `startStaggerMs`, with at most
 * `maxStarting` personas booting at once. When the fleet actually exceeds the
 * TPM limit and the runner supports pause signals, playing personas are paused
 * one at a time (heaviest recent consumer first) and resumed as headroom returns.
 */
import { EventEmitter } from 'node:events';

export class Governor extends EventEmitter {
  constructor(cfg, log = console.log) {
    super();
    this.cfg = cfg; this.log = log;
    this.window = [];              // { t, tokens, requests, key }
    this.queue = [];               // { key, start: () => Promise<void>, enqueuedAt }
    this.starting = new Set();     // keys currently booting (until status=playing/failed)
    this.paused = new Map();       // key -> handle
    this.lastStartAt = 0;
    this.tick = setInterval(() => this.#tick(), 500);
    this.pulse = setInterval(() => this.emit('governor', this.snapshot()), 2000);
  }

  close() { clearInterval(this.tick); clearInterval(this.pulse); }

  /** Called for every `usage` SessionEvent. */
  recordUsage(key, u) {
    const tokens = (this.cfg.governorCountCached ? u.input : Math.max(0, u.input - (u.cached ?? 0))) + (u.output ?? 0);
    this.window.push({ t: Date.now(), tokens, requests: 1, key });
  }

  #prune() {
    const cutoff = Date.now() - 60_000;
    while (this.window.length && this.window[0].t < cutoff) this.window.shift();
  }

  snapshot() {
    this.#prune();
    let tpmUsed = 0, rpmUsed = 0;
    for (const w of this.window) { tpmUsed += w.tokens; rpmUsed += w.requests; }
    return {
      type: 'governor', tpmUsed, tpmLimit: this.cfg.tpmLimit, queued: this.queue.length + this.paused.size,
      rpmUsed, rpmLimit: this.cfg.rpmLimit, starting: this.starting.size, paused: this.paused.size,
      headroom: +(1 - tpmUsed / this.cfg.tpmLimit).toFixed(3),
    };
  }

  headroom() { const s = this.snapshot(); return Math.min(1 - s.tpmUsed / s.tpmLimit, 1 - s.rpmUsed / s.rpmLimit); }

  /** Queue a persona start. `start` is invoked when the governor releases it. */
  enqueue(key, start) { this.queue.push({ key, start, enqueuedAt: Date.now() }); this.#tick(); }
  dequeue(pred) { const before = this.queue.length; this.queue = this.queue.filter((q) => !pred(q.key)); return before - this.queue.length; }

  /** Boot bookkeeping: a persona counts as "starting" until it reports playing/failed/etc. */
  bootDone(key) { this.starting.delete(key); }

  /** Register a live handle for pause/resume if the backend supports it. */
  handles = new Map();
  track(key, handle) { this.handles.set(key, handle); }
  untrack(key) { this.handles.delete(key); this.paused.delete(key); this.starting.delete(key); }

  #tick() {
    const now = Date.now();
    const headroom = this.headroom();

    // 1. release queued starts while there is headroom
    if (this.queue.length && headroom >= this.cfg.headroomMin
        && this.starting.size < this.cfg.maxStarting
        && now - this.lastStartAt >= this.cfg.startStaggerMs) {
      const next = this.queue.shift();
      this.lastStartAt = now;
      this.starting.add(next.key);
      this.log(`governor: releasing ${next.key} (headroom ${(headroom * 100).toFixed(0)}%, queued ${this.queue.length})`);
      Promise.resolve().then(next.start).catch((err) => { this.log(`governor: start ${next.key} failed: ${err.message}`); this.starting.delete(next.key); });
    }

    // 2. over the limit: pause the heaviest recent consumer; well under: resume one
    if (!this.cfg.runnerPauseSignals) return;
    if (headroom < 0) {
      const usage = new Map();
      for (const w of this.window) usage.set(w.key, (usage.get(w.key) ?? 0) + w.tokens);
      const candidates = [...this.handles].filter(([k, h]) => !this.paused.has(k) && h.pause && h.status === 'playing')
        .sort((a, b) => (usage.get(b[0]) ?? 0) - (usage.get(a[0]) ?? 0));
      if (candidates.length) {
        const [k, h] = candidates[0];
        this.paused.set(k, h); h.pause();
        this.log(`governor: PAUSED ${k} (tpm ${this.snapshot().tpmUsed} > ${this.cfg.tpmLimit})`);
        this.emit('throttle', { key: k, action: 'pause' });
      }
    } else if (headroom > this.cfg.headroomMin + 0.1 && this.paused.size) {
      const [k, h] = [...this.paused][0];
      this.paused.delete(k); h.resume?.();
      this.log(`governor: resumed ${k} (headroom ${(headroom * 100).toFixed(0)}%)`);
      this.emit('throttle', { key: k, action: 'resume' });
    }
  }
}

/**
 * Deterministic ±stagger of a step budget so a fleet's reports land at different
 * times. Seeded by (seed, index) so re-running the same fleet is reproducible.
 */
export function staggerBudget(budget, seed, index, stagger = 0.15) {
  let x = ((seed + 1) * 2654435761 + (index + 1) * 40503) >>> 0;
  x = (x * 1664525 + 1013904223) >>> 0;
  const u = x / 4294967296;                 // 0..1
  const f = 1 + (u * 2 - 1) * stagger;      // 1±stagger
  return Math.max(1, Math.round(budget * f));
}
