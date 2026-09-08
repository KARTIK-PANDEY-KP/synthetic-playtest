/**
 * The contract between the GAME and the PLATFORM.
 *
 * The game agent must ship exactly this. The platform agent may assume exactly this
 * and nothing more. Neither needs to read the other's plan.
 */

// ── 1. How the game is addressed ────────────────────────────────────────────
//   <origin>/?seed=<int>&run=<uuid>        normal play, deterministic given the seed
//   <origin>/?seed=<int>&replay=<logUrl>   deterministic replay, for verification

// ── 2. Input surface ────────────────────────────────────────────────────────
// ONLY real input, driven by Playwright keyboard/mouse. No semantic helpers —
// no goToDoor(), no listInteractables(). If the agent could call it, a human
// tester could not, and the finding would be worthless.
// Pointer lock is NOT required: mouse-drag look AND arrow-key look both work.

/** Ground-truth events. The HARNESS reads these. The AGENT NEVER SEES THEM. */
export type GameEvent =
  | { t: number; type: 'room_entered'; room: string }
  | { t: number; type: 'item_picked' | 'item_used'; item: string }
  | { t: number; type: 'puzzle_solved' | 'puzzle_failed'; puzzle: string }
  | { t: number; type: 'softlock_entered'; flawId: string }
  | { t: number; type: 'died' | 'respawned' | 'menu_opened' | 'menu_closed' }
  | { t: number; type: 'idle'; ms: number }
  | { t: number; type: 'position'; x: number; y: number; z: number; yaw: number } // 2 Hz
  /** The answer key firing: the tester has just encountered a known injected flaw. */
  | { t: number; type: 'flaw_triggered'; flawId: string };

export interface GameState {
  room: string;
  inventory: string[];
  objective: string;
  oxygen: number | null;
  solved: string[];
  softlocked: boolean;
}

export type TextRegionKind = 'tutorial' | 'hud' | 'log' | 'label' | 'menu';

export interface TextRegion {
  x: number; y: number; w: number; h: number;
  kind: TextRegionKind;
  /** Word count, so the harness can enforce a reading budget without OCR. */
  words: number;
}

export interface AudioCue {
  t: number;
  id: string;
  /** Present so the harness can grant it ONLY to personas with audio enabled. */
  transcript: string;
}

/**
 * The harness's private observation channel, exposed on `window`.
 *
 * This is the single most important interface in the project. It must never
 * influence rendering, and must never be reachable from anything the agent can
 * perceive. If it leaks into the agent's screenshots, every finding is worthless.
 */
export interface Telemetry {
  subscribe(cb: (e: GameEvent) => void): () => void;
  snapshot(): GameState;
  /** Bounding boxes of on-screen text, so the harness can redact pixels per persona. */
  textRegions(): TextRegion[];
  /** Audio cues fired this session, for the audio-enabled personas only. */
  audioCues(): AudioCue[];
}

declare global {
  interface Window { __telemetry: Telemetry }
}

// ── 4. The flaw ledger — ground truth, shipped with the game ────────────────
// apps/game/src/flaws/ledger.json

export type FlawClass =
  | 'objective'      // crashes, soft-locks, state loss — what incumbents already find
  | 'confusion'      // unclear labels, unrepeatable tutorials, hidden affordances
  | 'familiarity'    // requires a genre convention the game never taught
  | 'pacing'         // grind, dead time, no new information
  | 'fairness'       // unscaffolded inference, unannounced failure states
  | 'accessibility'  // information delivered in one modality only
  | 'decoy';         // intentional and CORRECT — measures false positives

export interface FlawLedgerEntry {
  id: string;                 // 'C1', 'B2', 'D1'…
  class: FlawClass;
  room: string;
  title: string;
  /** Which event/condition proves a tester actually hit this. */
  groundTruthSignal: string;
  /** Who we PREDICT catches it — the hypothesis the scoring pass tests. */
  expectedPersonas: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// PLATFORM-SIDE TYPES — shared by persona-mcp, orchestrator, analysis, dashboard
// ═══════════════════════════════════════════════════════════════════════════

export type ReadingLevel = 'skim' | 'normal' | 'thorough';
export type Familiarity = 'none' | 'medium' | 'high';
export type Exploration = 'low' | 'medium' | 'high';
export type ReasoningEffort = 'low' | 'medium' | 'high';

/** A persona is a PERSON. `enforcement` is how the harness makes that person real. */
export interface PersonaConfig {
  id: string;
  name: string;
  age: number;
  bio: string;
  goal: string;
  enforcement: {
    reading: ReadingLevel;          // words visible per text region before pixels are blurred
    genre_familiarity: Familiarity; // whether control conventions are ever mentioned
    patience: number;               // no-progress steps before frustration escalates
    exploration: Exploration;
    audio: 'on' | 'off';            // whether the listen() tool exists at all
    step_budget: number;            // hard cap on actions
    reasoning_effort: ReasoningEffort;
  };
}

export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type FindingCategory = 'bug' | 'confusion' | 'boredom' | 'unfair' | 'accessibility' | 'other';

/** One thing a tester noticed. Emitted via the note_finding tool and in the final report. */
export interface Finding {
  id: string;
  severity: Severity;
  category: FindingCategory;
  title: string;
  description: string;
  room?: string;
  /** Human-readable repro steps. The verifier replays the ACTION LOG, not these. */
  reproSteps: string[];
  /** Frame path (relative to the persona dir) captured when the finding was noted. */
  frame?: string;
  /** Step index when noted — lets the verifier slice the action log. */
  step: number;
  /** Stamped by the runner: the agent's last message before it noted this — what it was thinking, in its own words. */
  thinking?: string;
  /** Stamped by the runner: the last few actions before the note, humanized ("pressed E ×3, walked forward"). */
  actionsBefore?: string[];
  /** Stamped by the runner from ground-truth telemetry at the moment of the note. The agent never sees this. */
  state?: {
    room?: string;
    objective?: string;
    inventory: string[];
    solved: string[];
    roomsVisited: string[];   // in order, deduplicated
    stepsSoFar: number;
    stepBudget: number;
    minutesIn: number;
  };
}

/** The agent's final message, forced by `codex exec --output-schema report.schema.json`. */
export interface PlaytestReport {
  persona: string;
  summary: string;
  completed: boolean;
  abandonedReason?: string;
  findings: Finding[];
  experience: {
    confused: string[];
    bored: string[];
    unfair: string[];
    enjoyed: string[];
  };
  wouldRecommend: 1 | 2 | 3 | 4 | 5;
}

/** One line of `<persona>/session.jsonl`. Everything that happened, in order. */
export type SessionEvent =
  | { t: number; kind: 'codex'; event: unknown }                    // raw `codex exec --json` line
  | { t: number; kind: 'telemetry'; event: GameEvent }              // ground truth, never shown to agent
  | { t: number; kind: 'action'; step: number; tool: string; args: unknown; result?: string; frame?: string }
  | { t: number; kind: 'finding'; finding: Finding }
  | { t: number; kind: 'gate'; gate: 'patience' | 'budget' | 'abandon'; detail: string }
  | { t: number; kind: 'usage'; input: number; cached: number; output: number }
  | { t: number; kind: 'status'; status: PersonaStatus; detail?: string };

export type PersonaStatus = 'queued' | 'starting' | 'playing' | 'reporting' | 'done' | 'failed' | 'stopped';

export interface CostSummary {
  steps: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  usd: number;
}

// Pricing for gpt-6-astra, verified 2026-09-08. Per million tokens.
export const ASTRA_PRICE = { input: 10, cachedInput: 1, output: 50 } as const;
export const costUsd = (c: Omit<CostSummary, 'usd' | 'steps'>) =>
  ((c.inputTokens - c.cachedInputTokens) * ASTRA_PRICE.input
    + c.cachedInputTokens * ASTRA_PRICE.cachedInput
    + c.outputTokens * ASTRA_PRICE.output) / 1_000_000;

// ── Run archive layout ──────────────────────────────────────────────────────
//   runs/<runId>/
//     run.json                      RunMeta
//     <personaId>/
//       persona.json                PersonaConfig actually used
//       session.jsonl               SessionEvent per line
//       frames/00000.png …          what the agent SAW (post-redaction)
//       report.json                 PlaytestReport
//       cost.json                   CostSummary
//     analysis/
//       findings.json               ClusteredFinding[]
//       score.json                  Score
//       report.md                   rendered cross-persona report

export interface RunMeta {
  runId: string;
  startedAt: string;              // ISO
  finishedAt?: string;
  gameUrl: string;
  seed: number;
  backend: 'local' | 'modal';
  personas: string[];
  status: 'running' | 'done' | 'failed' | 'stopped';
}

/** A finding after dedup across personas. */
export interface ClusteredFinding {
  id: string;
  title: string;
  category: FindingCategory;
  severity: Severity;
  description: string;
  room?: string;
  /** Which personas reported it, and how many times each. */
  reporters: Array<{ persona: string; count: number; findingIds: string[] }>;
  /** 3+ of 4 stalling at the same ground-truth spot = the game; 1 = the agent. */
  attribution: 'game' | 'agent' | 'unclear';
  verified: boolean | null;       // null = not yet replayed
  verificationNote?: string;
  /** Matched ledger id, if the analysis joined it to a known injected flaw. */
  ledgerId?: string;
  frames: string[];
}

export interface Score {
  recall: number;                 // ledger flaws found / ledger flaws (excl. decoys)
  precision: number;              // findings matched to ledger / all findings
  byClass: Record<FlawClass, { total: number; found: number }>;
  decoysFlagged: string[];        // false positives
  emergent: string[];             // unledgered findings that look real — triage manually
  found: string[];
  missed: string[];
}
