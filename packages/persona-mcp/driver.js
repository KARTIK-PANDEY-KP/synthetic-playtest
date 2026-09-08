/**
 * The sensory gate.
 *
 * Every byte the agent perceives about the game passes through here, and this is
 * where personas are physically enforced. A persona that "doesn't read" has the
 * text blurred out of its screenshots; a persona that "can't hear" is never given
 * the listen tool. That is the difference between a persona and a prompt asking
 * nicely to behave like one.
 */
import { chromium } from 'playwright';
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** Words visible per text region before the rest is blurred out of the pixels. */
const READING_BUDGET = { skim: 12, normal: 60, thorough: Infinity };

export class GameDriver {
  constructor({ gameUrl, persona, frameDir, seed = 1, onEvent = null, deferLoad = false }) {
    this.gameUrl = gameUrl;
    this.persona = persona;
    this.frameDir = frameDir;
    this.seed = seed;
    this.deferLoad = deferLoad;
    this.loaded = false;
    /** Ground-truth listener (session logging). Never wired to anything the agent can read. */
    this.onEvent = onEvent;
    this.events = [];
    this.frameNo = 0;
    this.stepNo = 0;
    /** Steps since the last ground-truth progress event. Drives the patience gate. */
    this.stallSteps = 0;
  }

  async start() {
    mkdirSync(this.frameDir, { recursive: true });
    this.browser = await chromium.launch();
    this.ctx = await this.browser.newContext({ viewport: { width: 1280, height: 720 } });
    this.page = await this.ctx.newPage();

    // Ground-truth channel. Bound BEFORE navigation so no event is missed.
    await this.ctx.exposeBinding('__harnessEvent', (_src, e) => {
      this.events.push(e);
      if (PROGRESS.has(e.type)) this.stallSteps = 0;
      try { this.onEvent?.(e); } catch { /* a logging failure must never break play */ }
    });
    await this.page.addInitScript(() => {
      const install = () => {
        if (!window.__telemetry) return false;
        window.__telemetry.subscribe((e) => window.__harnessEvent(e));
        return true;
      };
      if (!install()) {
        const iv = setInterval(() => { if (install()) clearInterval(iv); }, 30);
      }
    });

    if (!this.deferLoad) await this.load();
    return this;
  }

  /**
   * Start the game. With `deferLoad`, this happens on the persona's FIRST look or
   * action rather than at browser launch: a human sees the opening frame the
   * instant the game starts, whereas the model's first screenshot arrives
   * ~15 s after spawn — long enough for a 3.5 s tutorial to have come and gone
   * unseen. The game clock starts when the player sits down, not before.
   */
  async load() {
    if (this.loaded) return;
    this.loaded = true;
    await this.page.goto(`${this.gameUrl}?seed=${this.seed}`, { waitUntil: 'load' });
    await this.page.waitForFunction(() => !!window.__telemetry, null, { timeout: 10_000 });
    await this.#backfillBootEvents();
  }

  /**
   * The game emits its first events (room_entered for the spawn room) synchronously at
   * boot, up to 30ms before the init-script subscription lands, so live sessions never
   * recorded the spawn room. Pull the game's own event list once and log what we missed.
   */
  async #backfillBootEvents() {
    try {
      const all = await this.page.evaluate(() => window.__telemetry.events());
      const key = (e) => `${e.t}|${e.type}|${e.room ?? e.item ?? e.flawId ?? e.puzzle ?? ''}`;
      const seen = new Set(this.events.map(key));
      const missed = all.filter((e) => e.type !== 'position' && !seen.has(key(e)));
      for (const e of missed) { this.events.push(e); try { this.onEvent?.(e); } catch { /* logging must never break play */ } }
      return missed.length;
    } catch { return 0; }
  }

  /**
   * Capture the screen as the persona is able to perceive it.
   * Returns a FILE PATH — Codex drops image content blocks from MCP results
   * (openai/codex#4819), so the agent opens the file itself. See docs/SPIKE-01.
   */
  async screenshot() {
    const raw = await this.page.screenshot({ type: 'png' });
    const budget = READING_BUDGET[this.persona.enforcement.reading] ?? Infinity;

    let out = raw;
    if (Number.isFinite(budget)) {
      const regions = await this.page.evaluate(() => window.__telemetry.textRegions());
      const { width, height } = await sharp(raw).metadata();
      const composites = [];
      for (const r of regions) {
        if (r.words <= budget) continue;
        const left = Math.max(0, Math.min(width - 1, r.x));
        const top = Math.max(0, Math.min(height - 1, r.y));
        const w = Math.max(1, Math.min(width - left, r.w));
        const h = Math.max(1, Math.min(height - top, r.h));
        composites.push({
          input: await sharp(raw).extract({ left, top, width: w, height: h }).blur(9).toBuffer(),
          left, top,
        });
      }
      if (composites.length) out = await sharp(raw).composite(composites).png().toBuffer();
    }

    const path = join(this.frameDir, `${String(this.frameNo++).padStart(5, '0')}.png`);
    await sharp(out).toFile(path);
    return path;
  }

  async move(direction, ms = 500) {
    const code = { forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD' }[direction];
    if (!code) throw new Error(`unknown direction: ${direction}`);
    await this.page.keyboard.down(code);
    await this.page.waitForTimeout(Math.min(3000, ms));
    await this.page.keyboard.up(code);
    this.#step();
  }

  async look(direction, ms = 400) {
    const code = { left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown' }[direction];
    if (!code) throw new Error(`unknown direction: ${direction}`);
    await this.page.keyboard.down(code);
    await this.page.waitForTimeout(Math.min(3000, ms));
    await this.page.keyboard.up(code);
    this.#step();
  }

  async crouch(on) { await this.page.keyboard[on ? 'down' : 'up']('ControlLeft'); this.#step(); }
  async interact() { await this.page.keyboard.press('KeyE'); await this.page.waitForTimeout(150); this.#step(); }
  async typeText(text) { await this.page.keyboard.type(String(text).slice(0, 120)); this.#step(); }
  /** Inventory toggle. Input-level: the game binds it to I. */
  async openInventory() { await this.page.keyboard.press('KeyI'); await this.page.waitForTimeout(150); this.#step(); }
  /** Items are consumed by interacting with the thing they fit; `name` is intent, logged
   *  for the action record. Still just a key press — nothing semantic. */
  async useItem(_name) { await this.page.keyboard.press('KeyE'); await this.page.waitForTimeout(150); this.#step(); }

  /** Audio cues, granted only to personas that can hear. */
  async listen() {
    if (this.persona.enforcement.audio !== 'on') throw new Error('this persona cannot hear');
    return this.page.evaluate(() => window.__telemetry.audioCues());
  }

  /** Ground truth only — never surfaced to the agent. */
  state() { return this.page.evaluate(() => window.__telemetry.snapshot()); }

  #step() { this.stepNo++; this.stallSteps++; }

  /** True once the persona's patience is spent on a genuinely stuck state. */
  get frustrated() { return this.stallSteps >= (this.persona.enforcement.patience ?? 6) * 3; }
  get budgetSpent() { return this.stepNo >= (this.persona.enforcement.step_budget ?? 120); }

  async stop() { await this.browser?.close(); }
}

/** Events that count as real forward progress, for stall detection. */
const PROGRESS = new Set(['room_entered', 'item_picked', 'item_used', 'puzzle_solved', 'flaw_triggered']);
