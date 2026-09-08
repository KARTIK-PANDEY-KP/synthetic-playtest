/**
 * One persona's play session: the browser, the session log, and the gates.
 *
 * Everything with state lives here, in ONE process — the runner's. The MCP
 * server that Codex spawns (`server.mjs`) is a stateless shim that forwards
 * tool calls to this object over a loopback HTTP endpoint (`startControl`).
 * One owner means one writer of session.jsonl, one browser for both the agent's
 * frames and the human MJPEG view, and nothing lost if Codex restarts its MCP
 * server mid-run.
 *
 * Gates are enforced here, not asked for in the prompt: patience trips on
 * ground-truth stall, the step budget is a hard cap, and after enough nudging
 * every action tool refuses to act until the persona calls abandon().
 */
import { createServer } from 'node:http';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { GameDriver } from './driver.js';
import { ACTION_TOOLS, toolNames } from './tools.mjs';

/** How many nudged steps a persona tolerates after patience trips before it is forced to quit. */
const NUDGE_STEPS = 3;

const PATIENCE_NUDGES = [
  'You have been at this a while and nothing you do seems to change anything. You are getting annoyed.',
  'You are properly irritated now. If something about this game is why you are stuck, say so with note_finding.',
  'This is the last of your patience. One more pointless step and you are walking away.',
];
const PATIENCE_FORCED =
  'You have had enough — you are done with this game. Call abandon(reason) now and then write your report. No further actions will be carried out.';
const BUDGET_NUDGE = (left) =>
  `You are nearly out of time for this session — about ${left} more ${left === 1 ? 'action' : 'actions'} before you have to stop. Note anything you still want to say.`;
const BUDGET_FORCED =
  'You are out of time. Call abandon(reason) now and write your report. No further actions will be carried out.';
const OVER =
  'You have already put this game down. Do not take more actions — write your final report now.';

export class GameSession {
  static async create(opts) { const s = new GameSession(opts); await s.start(); return s; }

  constructor({ persona, gameUrl, seed = 1, runDir }) {
    this.persona = persona;
    this.gameUrl = gameUrl;
    this.seed = Number(seed) || 1;
    this.runDir = runDir;
    this.frameDir = join(runDir, 'frames');
    this.sessionPath = join(runDir, 'session.jsonl');
    this.tools = new Set(toolNames(persona));
    this.history = [];
    this.listeners = new Set();
    this.findings = [];
    this.lastFrame = null;
    this.lastCueIdx = 0;
    this.toolCalls = 0;
    this.nudged = 0;          // action steps taken while the patience gate is tripped
    this.abandoned = false;
    this.forced = false;
    this.driver = null;
  }

  async start() {
    mkdirSync(this.frameDir, { recursive: true });
    this.driver = new GameDriver({
      gameUrl: this.gameUrl, persona: this.persona, frameDir: this.frameDir, seed: this.seed,
      onEvent: (e) => this.emit({ kind: 'telemetry', event: e }),
    });
    await this.driver.start();
    return this;
  }

  get page() { return this.driver?.page; }
  get steps() { return this.driver?.stepNo ?? 0; }
  get budget() { return this.persona.enforcement.step_budget ?? 120; }

  /** Append a SessionEvent to the log, the in-memory history, and every live subscriber. */
  emit(event) {
    const e = { t: Date.now(), ...event };
    this.history.push(e);
    try { appendFileSync(this.sessionPath, JSON.stringify(e) + '\n'); } catch { /* disk hiccup must not stop play */ }
    for (const cb of this.listeners) { try { cb(e); } catch { /* listener bugs are theirs */ } }
    return e;
  }

  subscribe(cb) { this.listeners.add(cb); return () => this.listeners.delete(cb); }

  /**
   * Execute one tool call on behalf of the agent. Returns { text, isError }.
   * The text is the ONLY thing the agent sees. Keep it free of world state.
   */
  async call(name, args = {}) {
    this.toolCalls++;
    if (!this.tools.has(name)) return { text: `Unknown tool: ${name}`, isError: true };
    args = args ?? {};

    if (name === 'abandon') return this.#abandon(String(args.reason ?? ''));
    if (name === 'note_finding') return this.#noteFinding(args);
    if (this.abandoned) return { text: OVER, isError: false };

    if (name === 'screenshot') {
      const path = await this.driver.screenshot();
      this.lastFrame = relative(this.runDir, path);
      const text = `Screenshot saved to: ${path}\nOpen that image file now to see the screen — nothing about it is described here.`;
      this.emit({ kind: 'action', step: this.steps, tool: name, args, frame: this.lastFrame });
      return { text: this.#withGate(text), isError: false };
    }

    if (name === 'listen') {
      const cues = await this.driver.listen();
      const fresh = cues.slice(this.lastCueIdx);
      this.lastCueIdx = cues.length;
      const text = fresh.length ? `You heard:\n${fresh.map((c) => `- "${c.transcript}"`).join('\n')}` : 'Nothing new to hear.';
      this.emit({ kind: 'action', step: this.steps, tool: name, args, result: text });
      return { text: this.#withGate(text), isError: false };
    }

    if (!ACTION_TOOLS.has(name)) return { text: `Unknown tool: ${name}`, isError: true };

    // Hard stops come BEFORE the action: a forced persona does not get to act.
    const stop = this.#forcedMessage();
    if (stop) {
      this.emit({ kind: 'action', step: this.steps, tool: name, args, result: '(refused: session over)' });
      return { text: stop, isError: false };
    }

    let text;
    try {
      text = await this.#act(name, args);
    } catch (err) {
      return { text: `That did not work: ${err.message}`, isError: true };
    }
    this.emit({ kind: 'action', step: this.steps, tool: name, args, result: text, frame: this.lastFrame ?? undefined });
    return { text: this.#withGate(text, true), isError: false };
  }

  async #act(name, a) {
    const d = this.driver;
    const ms = (v, dflt) => Math.max(100, Math.min(3000, Number.isFinite(+v) ? +v : dflt));
    switch (name) {
      case 'move': await d.move(a.direction, ms(a.ms, 600)); return `Walked ${a.direction} for ${ms(a.ms, 600)} ms. Take a screenshot to see where you are.`;
      case 'look': await d.look(a.direction, ms(a.ms, 400)); return `Turned to look ${a.direction} for ${ms(a.ms, 400)} ms. Take a screenshot to see what you are looking at.`;
      case 'crouch': await d.crouch(!!a.on); return a.on ? 'You are now low to the ground.' : 'You are standing again.';
      case 'interact': await d.interact(); return 'Done. Take a screenshot to see if anything happened.';
      case 'use_item': await d.useItem(String(a.name ?? '')); return `Tried to use "${a.name}" on what is in front of you. Take a screenshot to see if anything happened.`;
      case 'open_inventory': await d.openInventory(); return 'Done. Take a screenshot to see what you are carrying.';
      case 'type_text': await d.typeText(String(a.text ?? '')); return `Typed "${String(a.text ?? '').slice(0, 120)}". Take a screenshot to see the result.`;
      default: throw new Error(`unknown action ${name}`);
    }
  }

  /** The message that replaces an action once the persona is out of patience or time, or null. */
  #forcedMessage() {
    if (this.abandoned) return OVER;
    if (this.steps >= this.budget) {
      if (!this.forced) { this.forced = true; this.emit({ kind: 'gate', gate: 'budget', detail: `step budget ${this.budget} spent; actions refused until abandon()` }); }
      return BUDGET_FORCED;
    }
    if (this.driver.frustrated && this.nudged >= NUDGE_STEPS) {
      if (!this.forced) { this.forced = true; this.emit({ kind: 'gate', gate: 'patience', detail: `patience ${this.persona.enforcement.patience} exhausted after ${this.nudged} nudged steps; actions refused until abandon()` }); }
      return PATIENCE_FORCED;
    }
    // A hard ceiling on total tool calls (screenshots included) so a looping agent cannot spend forever.
    if (this.toolCalls > this.budget * 3) {
      if (!this.forced) { this.forced = true; this.emit({ kind: 'gate', gate: 'budget', detail: `tool-call ceiling ${this.budget * 3} hit` }); }
      return BUDGET_FORCED;
    }
    return null;
  }

  /** Append the in-character nudge to a tool result when a gate is active. */
  #withGate(text, wasAction = false) {
    if (this.abandoned) return text;
    const left = this.budget - this.steps;
    if (left <= 0) return `${text}\n\n${BUDGET_FORCED}`;

    if (this.driver.frustrated) {
      if (wasAction) {
        const level = Math.min(this.nudged, PATIENCE_NUDGES.length - 1);
        this.nudged++;
        this.emit({ kind: 'gate', gate: 'patience', detail: `stall ${this.driver.stallSteps} steps; nudge ${this.nudged}/${NUDGE_STEPS}` });
        return `${text}\n\n${PATIENCE_NUDGES[level]}`;
      }
      return `${text}\n\n${PATIENCE_NUDGES[Math.min(Math.max(this.nudged - 1, 0), PATIENCE_NUDGES.length - 1)]}`;
    }
    this.nudged = 0; // progress happened; patience resets with it

    if (left <= NUDGE_STEPS && wasAction) {
      this.emit({ kind: 'gate', gate: 'budget', detail: `${left} steps left of ${this.budget}` });
      return `${text}\n\n${BUDGET_NUDGE(left)}`;
    }
    return text;
  }

  #noteFinding(a) {
    const finding = {
      id: `${this.persona.id}-f${this.findings.length + 1}`,
      severity: ['critical', 'high', 'medium', 'low'].includes(a.severity) ? a.severity : 'medium',
      category: ['bug', 'confusion', 'boredom', 'unfair', 'accessibility', 'other'].includes(a.category) ? a.category : 'other',
      title: String(a.title ?? '').slice(0, 200),
      description: String(a.description ?? ''),
      ...(a.room ? { room: String(a.room) } : {}),
      reproSteps: Array.isArray(a.reproSteps) ? a.reproSteps.map(String) : [],
      ...(this.lastFrame ? { frame: this.lastFrame } : {}),
      step: this.steps,
    };
    this.findings.push(finding);
    this.emit({ kind: 'finding', finding });
    return { text: `Noted as ${finding.id}. ${this.abandoned ? 'Include it in your report.' : 'Keep playing if you still would.'}`, isError: false };
  }

  #abandon(reason) {
    if (!this.abandoned) {
      this.abandoned = true;
      this.emit({ kind: 'gate', gate: 'abandon', detail: reason });
    }
    return { text: 'You have put the game down. Write your final report now — it is the last thing you do.', isError: false };
  }

  async close() { await this.driver?.stop(); }
}

/**
 * Loopback control endpoint for the MCP shim. POST /call {name, args} → {text, isError}.
 * Bound to 127.0.0.1 on an ephemeral port; the URL goes to the shim via its env.
 */
export async function startControl(session) {
  const server = createServer(async (req, res) => {
    const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.method === 'GET' && req.url === '/health') return send(200, { ok: true, steps: session.steps });
    if (req.method !== 'POST' || req.url !== '/call') return send(404, { error: 'not found' });
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      try {
        const { name, args } = JSON.parse(body || '{}');
        send(200, await session.call(name, args));
      } catch (err) {
        send(500, { text: `control error: ${err.message}`, isError: true });
      }
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}
